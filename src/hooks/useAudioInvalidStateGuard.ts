/**
 * useAudioInvalidStateGuard — Phase 6-2 Invalid State Detector / State Consistency Guard.
 *
 * 목적:
 *   React state (playing/crossfading) / HTMLAudioElement 실 상태 (paused/volume/
 *   readyState/sinkId) / Phase 6-1 SessionState 가 서로 어긋나는 "불가능한 조합"
 *   을 감지. **재생 흐름은 절대 변경하지 않고** 치명적 케이스만 pause 계열로
 *   최소 보정. 그 외는 log 만.
 *
 * 규칙:
 *   • play() 신규 호출 금지 (자동재생 회귀 방지 핵심).
 *   • audio.load() / src 재설정 / currentTime 초기화 금지.
 *   • sink mismatch 는 log 만 · Recovery Manager 의 sink-mismatch 경로가 처리.
 *   • Recovery 진행 중이면 pause 계열 보정도 skip (충돌 방지).
 *   • 이슈별 1s cooldown.
 *   • 모든 로그는 audioDebugWarn gate (Production 콘솔 침묵).
 *   • pause() / volume=0 계열 보정은 flag OFF 여도 실행 가능
 *     (사용자 재생 의도 없는데 오디오가 재생 중인 상태를 즉시 정리 · UX 안전).
 *
 * 감지 10종:
 *   1. playing=false && !active.paused                        → CORRECT: active.pause()
 *   2. playing=false && !inactive.paused                      → CORRECT: inactive.pause() + volume=0
 *   3. !crossfading && !active.paused && !inactive.paused     → CORRECT: inactive.pause() + volume=0
 *   4. !crossfading && inactive.volume > 0                    → CORRECT: inactive.volume=0
 *   5. playing=true && active.paused && sessionState=playing  → LOG only (Recovery stalled 처리)
 *   6. sessionState=playing && active.readyState < 2          → LOG only (Recovery waiting 처리)
 *   7. sessionState=crossfading && !crossfading (React state) → LOG only
 *   8. sessionState=paused && !active.paused                  → CORRECT: active.pause()
 *   9. sinkReady && active.sinkId !== desiredSinkId           → LOG only (Recovery sink-mismatch)
 *  10. sessionState=recovering 이 60s 초과 지속                → LOG only (escalation 신호)
 */
import { type MutableRefObject, useCallback, useRef } from 'react';
import { audioDebugWarn } from '@/lib/audioDebug';
import type { SessionSummary } from '@/hooks/useAudioSessionState';

/** invalid issue 식별자. */
export type InvalidIssue =
  | 'active-playing-without-intent'      // 1
  | 'inactive-playing-without-intent'    // 2
  | 'both-playing-no-crossfade'          // 3
  | 'inactive-volume-nonzero'            // 4
  | 'playing-intent-but-paused'          // 5 · LOG only
  | 'playing-but-readyState-low'         // 6 · LOG only
  | 'session-crossfading-but-react-not'  // 7 · LOG only
  | 'session-paused-but-audio-not'       // 8
  | 'sink-mismatch-observed'             // 9 · LOG only
  | 'recovering-too-long';               // 10 · LOG only

const CORRECTABLE_ISSUES = new Set<InvalidIssue>([
  'active-playing-without-intent',
  'inactive-playing-without-intent',
  'both-playing-no-crossfade',
  'inactive-volume-nonzero',
  'session-paused-but-audio-not',
]);

export interface InvalidStateSummary {
  totalInvalid: number;
  totalCorrected: number;
  perIssueCounts: Partial<Record<InvalidIssue, number>>;
  lastIssue: InvalidIssue | null;
  lastIssueTs: number;
  lastCorrectionIssue: InvalidIssue | null;
  lastCorrectionTs: number;
  /** 마지막 tick 에서 관측된 issue 목록 (관찰 편의). */
  currentIssues: InvalidIssue[];
}

export interface InvalidStateGuardInputs {
  audioARef: MutableRefObject<HTMLAudioElement | null>;
  audioBRef: MutableRefObject<HTMLAudioElement | null>;
  getActiveIdx: () => 0 | 1;
  getPlaying: () => boolean;
  getCrossfading: () => boolean;
  getSinkReady: () => boolean;
  getDesiredSinkId: () => string | null;
  getSessionSummary: () => SessionSummary;
  /** Recovery Manager 진행 중이면 보정을 skip 하여 경합 방지. */
  getIsRecovering?: () => boolean;
}

export interface InvalidStateGuardHandle {
  /** 이벤트 진입 시 호출 · 감지 + 필요 시 최소 보정. */
  runCheck: (reason: string) => void;
  getInvalidStateSummary: () => InvalidStateSummary;
}

const COOLDOWN_MS = 1000;
const RECOVERING_STUCK_MS = 60_000;
const HAVE_CURRENT_DATA = 2; // HTMLMediaElement.HAVE_CURRENT_DATA

export function useAudioInvalidStateGuard(
  inputs: InvalidStateGuardInputs,
): InvalidStateGuardHandle {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const totalsRef = useRef({
    totalInvalid: 0,
    totalCorrected: 0,
    perIssueCounts: {} as Partial<Record<InvalidIssue, number>>,
    lastIssue: null as InvalidIssue | null,
    lastIssueTs: 0,
    lastCorrectionIssue: null as InvalidIssue | null,
    lastCorrectionTs: 0,
    currentIssues: [] as InvalidIssue[],
  });
  const cooldownRef = useRef<Map<InvalidIssue, number>>(new Map());

  const runCheck = useCallback((reason: string): void => {
    const c = inputsRef.current;
    const now = performance.now();
    const activeIdx = c.getActiveIdx();
    const active = activeIdx === 0 ? c.audioARef.current : c.audioBRef.current;
    const inactive = activeIdx === 0 ? c.audioBRef.current : c.audioARef.current;
    const playing = c.getPlaying();
    const crossfading = c.getCrossfading();
    const sinkReady = c.getSinkReady();
    const desiredSinkId = c.getDesiredSinkId();
    const session = c.getSessionSummary();
    const isRecovering = c.getIsRecovering ? c.getIsRecovering() : false;

    // active / inactive 존재하지 않으면 검사 skip (mount 이전).
    if (!active && !inactive) return;

    const issues: InvalidIssue[] = [];
    const detail: Record<string, unknown> = {
      reason,
      activeIdx,
      playing,
      crossfading,
      sinkReady,
      activePaused: active?.paused,
      inactivePaused: inactive?.paused,
      activeVolume: active?.volume,
      inactiveVolume: inactive?.volume,
      activeReadyState: active?.readyState,
      activeSinkId: (active as HTMLAudioElement & { sinkId?: string } | null)?.sinkId,
      desiredSinkId,
      sessionState: session.currentState,
      sessionDurationMs: session.currentStateDurationMs,
    };

    // 1. active playing without intent
    if (!playing && active && !active.paused) {
      issues.push('active-playing-without-intent');
    }
    // 2. inactive playing without intent
    if (!playing && inactive && !inactive.paused) {
      issues.push('inactive-playing-without-intent');
    }
    // 3. both playing while no crossfade
    if (!crossfading && active && inactive && !active.paused && !inactive.paused) {
      issues.push('both-playing-no-crossfade');
    }
    // 4. inactive volume nonzero outside crossfade
    if (!crossfading && inactive && inactive.volume > 0) {
      issues.push('inactive-volume-nonzero');
    }
    // 5. playing intent but active paused & session says playing
    if (playing && active && active.paused && session.currentState === 'playing') {
      issues.push('playing-intent-but-paused');
    }
    // 6. session playing but readyState too low
    if (session.currentState === 'playing' && active && active.readyState < HAVE_CURRENT_DATA) {
      issues.push('playing-but-readyState-low');
    }
    // 7. session=crossfading but React crossfading=false
    if (session.currentState === 'crossfading' && !crossfading) {
      issues.push('session-crossfading-but-react-not');
    }
    // 8. session=paused but audio not paused
    if (session.currentState === 'paused' && active && !active.paused) {
      issues.push('session-paused-but-audio-not');
    }
    // 9. sink mismatch (sinkReady=true 인데 실제 sinkId 가 desired 와 다름)
    if (
      sinkReady &&
      desiredSinkId &&
      active &&
      (active as HTMLAudioElement & { sinkId?: string }).sinkId !== undefined &&
      (active as HTMLAudioElement & { sinkId?: string }).sinkId !== desiredSinkId
    ) {
      issues.push('sink-mismatch-observed');
    }
    // 10. recovering 이 60s 이상 지속
    if (
      session.currentState === 'recovering' &&
      session.currentStateDurationMs > RECOVERING_STUCK_MS
    ) {
      issues.push('recovering-too-long');
    }

    totalsRef.current.currentIssues = issues;
    if (issues.length === 0) return;

    // 개별 처리 · cooldown 별도.
    for (const issue of issues) {
      const last = cooldownRef.current.get(issue) ?? 0;
      if (now - last < COOLDOWN_MS) continue;
      cooldownRef.current.set(issue, now);

      totalsRef.current.perIssueCounts[issue] =
        (totalsRef.current.perIssueCounts[issue] ?? 0) + 1;
      totalsRef.current.totalInvalid += 1;
      totalsRef.current.lastIssue = issue;
      totalsRef.current.lastIssueTs = now;

      audioDebugWarn('[audio:state-invalid]', { issue, ...detail });

      // Recovery Manager 진행 중이면 보정 skip — 경합 방지.
      if (isRecovering) continue;

      // pause / volume=0 계열만 보정. play() / load() / src / currentTime 손대지 않음.
      if (!CORRECTABLE_ISSUES.has(issue)) continue;

      const correctionParts: string[] = [];
      try {
        switch (issue) {
          case 'active-playing-without-intent': {
            if (active && !active.paused) {
              active.pause();
              correctionParts.push('active.pause');
            }
            break;
          }
          case 'inactive-playing-without-intent': {
            if (inactive && !inactive.paused) {
              inactive.pause();
              correctionParts.push('inactive.pause');
            }
            if (inactive) {
              inactive.volume = 0;
              correctionParts.push('inactive.volume=0');
            }
            break;
          }
          case 'both-playing-no-crossfade': {
            // active 는 유지 · inactive 만 정리 (이중 재생 → active 만 남김).
            if (inactive && !inactive.paused) {
              inactive.pause();
              correctionParts.push('inactive.pause');
            }
            if (inactive) {
              inactive.volume = 0;
              correctionParts.push('inactive.volume=0');
            }
            break;
          }
          case 'inactive-volume-nonzero': {
            if (inactive) {
              inactive.volume = 0;
              correctionParts.push('inactive.volume=0');
            }
            break;
          }
          case 'session-paused-but-audio-not': {
            if (active && !active.paused) {
              active.pause();
              correctionParts.push('active.pause');
            }
            break;
          }
        }
      } catch { /* silent */ }

      if (correctionParts.length > 0) {
        totalsRef.current.totalCorrected += 1;
        totalsRef.current.lastCorrectionIssue = issue;
        totalsRef.current.lastCorrectionTs = now;
        audioDebugWarn('[audio:state-corrected]', {
          issue,
          actions: correctionParts.join(','),
          activeIdx,
          activePaused: active?.paused,
          inactivePaused: inactive?.paused,
          inactiveVolume: inactive?.volume,
        });
      }
    }
  }, []);

  const getInvalidStateSummary = useCallback((): InvalidStateSummary => {
    const t = totalsRef.current;
    return {
      totalInvalid: t.totalInvalid,
      totalCorrected: t.totalCorrected,
      perIssueCounts: { ...t.perIssueCounts },
      lastIssue: t.lastIssue,
      lastIssueTs: t.lastIssueTs,
      lastCorrectionIssue: t.lastCorrectionIssue,
      lastCorrectionTs: t.lastCorrectionTs,
      currentIssues: t.currentIssues.slice(),
    };
  }, []);

  return { runCheck, getInvalidStateSummary };
}
