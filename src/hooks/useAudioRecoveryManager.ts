/**
 * useAudioRecoveryManager — Phase 4-1 Self-Healing Audio Recovery Manager.
 *
 * Phase 3-2 health monitor 가 감지한 위험 상태 · onError · visibility/network
 * 복귀 시 사람이 개입하기 전에 단계적 자동 복구를 시도.
 *
 * 규칙:
 *   • reason 별 1s cooldown — 같은 reason 중복 recovery 금지
 *   • 10s window · 5회 이상 → escalation · 60s cooldown · toast 안내
 *   • recovery history 최근 20개 ref 보존
 *   • audio.load() / src 재설정 / currentTime 초기화 절대 X
 *   • debug flag 또는 long-run flag 켜졌을 때만 로그 출력
 *   • 사용자 toast 는 escalation · media-error DECODE 케이스만
 */
import { useCallback, useRef } from 'react';
import { audioDebugWarn } from '@/lib/audioDebug';
import { toast } from '@/store/toastStore';

export type RecoveryReason =
  | 'stalled'
  | 'sink-mismatch'
  | 'neither-playing'
  | 'inactive-playing'
  | 'both-playing'
  | 'crossfade-stuck'
  | 'media-error'
  | 'visibility-resume'
  | 'network-resume';

export interface RecoveryContext {
  audioARef: { current: HTMLAudioElement | null };
  audioBRef: { current: HTMLAudioElement | null };
  getActiveIdx: () => 0 | 1;
  getCrossfading: () => boolean;
  getForceCompleteCrossfade: () => ((reason: string) => void) | null;
  ensureSinkReady: (reason: string) => Promise<boolean>;
}

export interface RecoveryHistoryEntry {
  ts: number;
  reason: RecoveryReason;
  outcome: 'success' | 'failed' | 'skipped';
  detail: string;
}

export interface RecoverySummary {
  totalRecoveries: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  escalationCount: number;
  currentCooldownMs: number;
  perReasonCounts: Partial<Record<RecoveryReason, number>>;
  historySize: number;
  startedAtMs: number;
}

export interface RecoveryManagerHandle {
  recoverAudio: (reason: RecoveryReason, detail?: Record<string, unknown>) => Promise<void>;
  getRecoveryHistory: () => RecoveryHistoryEntry[];
  getRecoverySummary: () => RecoverySummary;
}

const REASON_COOLDOWN_MS = 1000;
const ESCALATION_WINDOW_MS = 10_000;
const ESCALATION_COUNT_THRESHOLD = 5;
const ESCALATION_COOLDOWN_MS = 60_000;
const HISTORY_MAX = 20;

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'ABORTED',
  2: 'NETWORK',
  3: 'DECODE',
  4: 'SRC_NOT_SUPPORTED',
};

function pushHistory(
  historyRef: React.MutableRefObject<RecoveryHistoryEntry[]>,
  entry: RecoveryHistoryEntry,
): void {
  historyRef.current.push(entry);
  if (historyRef.current.length > HISTORY_MAX) {
    historyRef.current.splice(0, historyRef.current.length - HISTORY_MAX);
  }
}

export function useAudioRecoveryManager(ctx: RecoveryContext): RecoveryManagerHandle {
  // Player state getter 를 stale closure 없이 참조하기 위한 ref
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const historyRef = useRef<RecoveryHistoryEntry[]>([]);
  const lastByReasonRef = useRef<Map<RecoveryReason, number>>(new Map());
  const escalatedUntilRef = useRef<number>(0);
  // Phase 4-2 — lifetime counters (history 는 최근 20개만 유지하므로 별도)
  const totalsRef = useRef({
    totalRecoveries: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    escalationCount: 0,
    perReasonCounts: {} as Partial<Record<RecoveryReason, number>>,
    startedAtMs: performance.now(),
  });

  const recoverAudio = useCallback(async (
    reason: RecoveryReason,
    detail: Record<string, unknown> = {},
  ): Promise<void> => {
    const now = performance.now();

    // Phase 4-2 — lifetime perReason counter (skipped 포함 모든 진입 카운트)
    totalsRef.current.perReasonCounts[reason] =
      (totalsRef.current.perReasonCounts[reason] ?? 0) + 1;

    // (1) escalation cooldown 중이면 skip
    if (now < escalatedUntilRef.current) {
      pushHistory(historyRef, { ts: now, reason, outcome: 'skipped', detail: 'escalated-cooldown' });
      totalsRef.current.skippedCount += 1;
      audioDebugWarn('[audio:recovery:start]', { reason, detail, skipped: 'escalated-cooldown' });
      return;
    }

    // (2) per-reason cooldown
    const last = lastByReasonRef.current.get(reason) ?? 0;
    if (now - last < REASON_COOLDOWN_MS) {
      pushHistory(historyRef, { ts: now, reason, outcome: 'skipped', detail: `cooldown ${Math.round(now - last)}ms` });
      totalsRef.current.skippedCount += 1;
      audioDebugWarn('[audio:recovery:start]', { reason, detail, skipped: 'cooldown' });
      return;
    }
    lastByReasonRef.current.set(reason, now);
    totalsRef.current.totalRecoveries += 1;

    audioDebugWarn('[audio:recovery:start]', { reason, detail });

    const c = ctxRef.current;
    const activeIdx = c.getActiveIdx();
    const a = c.audioARef.current;
    const b = c.audioBRef.current;
    const active = activeIdx === 0 ? a : b;
    const inactive = activeIdx === 0 ? b : a;

    let outcome: 'success' | 'failed' = 'success';
    const parts: string[] = [];

    const tryPlay = async (el: HTMLAudioElement | null, tag: string): Promise<boolean> => {
      if (!el) { parts.push(`${tag}=no-el;`); return false; }
      try {
        const p = el.play();
        if (p && typeof p.then === 'function') await p;
        parts.push(`${tag}=ok;`);
        return true;
      } catch (e) {
        const err = e as { name?: string; message?: string };
        parts.push(`${tag}=err(${err.name ?? err.message ?? String(e)});`);
        return false;
      }
    };

    try {
      switch (reason) {
        case 'sink-mismatch': {
          const ok = await c.ensureSinkReady('recovery-manager');
          parts.push(`ensureSink=${ok};`);
          if (!(await tryPlay(active, 'play'))) outcome = 'failed';
          break;
        }
        case 'stalled':
        case 'neither-playing':
        case 'visibility-resume':
        case 'network-resume': {
          if (!active) { outcome = 'failed'; parts.push('no-active;'); break; }
          if (!(await tryPlay(active, 'play1'))) {
            const ok = await c.ensureSinkReady('recovery-manager');
            parts.push(`ensureSink=${ok};`);
            if (!(await tryPlay(active, 'play2'))) outcome = 'failed';
          }
          break;
        }
        case 'inactive-playing':
        case 'both-playing': {
          if (c.getCrossfading()) {
            parts.push('crossfade-in-progress;skip-pause;');
            break;
          }
          if (inactive) {
            try { inactive.pause(); parts.push('inactive.pause=ok;'); }
            catch (e) { parts.push(`inactive.pause=err(${(e as Error).message});`); }
            try { inactive.volume = 0; parts.push('inactive.vol=0;'); }
            catch { /* silent */ }
          }
          if (active && active.paused) {
            if (!(await tryPlay(active, 'active.play'))) outcome = 'failed';
          }
          break;
        }
        case 'crossfade-stuck': {
          const fn = c.getForceCompleteCrossfade();
          if (fn) { fn('recovery-manager'); parts.push('forceComplete=ok;'); }
          else { parts.push('no-force-ref;'); }
          if (!(await tryPlay(active, 'play'))) outcome = 'failed';
          break;
        }
        case 'media-error': {
          const errCode = typeof detail.errorCode === 'number' ? detail.errorCode : 0;
          const codeName = MEDIA_ERROR_NAMES[errCode] ?? `code=${errCode}`;
          parts.push(`errCode=${codeName};`);
          if (errCode === 2 /* NETWORK */) {
            if (!(await tryPlay(active, 'play'))) outcome = 'failed';
          } else {
            // DECODE / SRC_NOT_SUPPORTED / ABORTED — auto-skip 하지 않고 로그+toast
            outcome = 'failed';
            try { toast.warning('재생 오류가 발생했어요.'); } catch { /* silent */ }
          }
          break;
        }
      }
    } catch (e) {
      outcome = 'failed';
      parts.push(`unexpected=${(e as Error).message};`);
    }

    const outcomeDetail = parts.join('');
    pushHistory(historyRef, { ts: now, reason, outcome, detail: outcomeDetail });
    // Phase 4-2 — lifetime outcome 카운터
    if (outcome === 'success') totalsRef.current.successCount += 1;
    else totalsRef.current.failedCount += 1;

    audioDebugWarn(
      outcome === 'success' ? '[audio:recovery:success]' : '[audio:recovery:failed]',
      { reason, detail: outcomeDetail, historySize: historyRef.current.length },
    );

    // (3) escalation check — 10s window · 5회 이상 · 60s cooldown
    const cutoff = now - ESCALATION_WINDOW_MS;
    const recent = historyRef.current.filter((h) => h.ts >= cutoff);
    if (recent.length >= ESCALATION_COUNT_THRESHOLD && now >= escalatedUntilRef.current) {
      escalatedUntilRef.current = now + ESCALATION_COOLDOWN_MS;
      totalsRef.current.escalationCount += 1;
      audioDebugWarn('[audio:recovery:escalated]', {
        recentCount: recent.length,
        windowMs: ESCALATION_WINDOW_MS,
        cooldownUntilMs: ESCALATION_COOLDOWN_MS,
        reasons: recent.map((h) => h.reason),
        outcomes: recent.map((h) => h.outcome),
      });
      try { toast.warning('재생 상태가 불안정해요. 다시 재생해 주세요.'); } catch { /* silent */ }
    }
  }, []);

  const getRecoveryHistory = useCallback((): RecoveryHistoryEntry[] => {
    return [...historyRef.current];
  }, []);

  const getRecoverySummary = useCallback((): RecoverySummary => {
    const t = totalsRef.current;
    const nowMs = performance.now();
    const cooldown = Math.max(0, escalatedUntilRef.current - nowMs);
    return {
      totalRecoveries: t.totalRecoveries,
      successCount: t.successCount,
      failedCount: t.failedCount,
      skippedCount: t.skippedCount,
      escalationCount: t.escalationCount,
      currentCooldownMs: cooldown,
      perReasonCounts: { ...t.perReasonCounts },
      historySize: historyRef.current.length,
      startedAtMs: t.startedAtMs,
    };
  }, []);

  return { recoverAudio, getRecoveryHistory, getRecoverySummary };
}
