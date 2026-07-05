/**
 * useAudioBurnInCertification — Phase 6-3 24h Burn-in Certification / Stability Criteria.
 *
 * 목적:
 *   Phase 2 ~ 6-2 로 구축된 audio engine 스택에 대해 12h / 24h 장시간 재생
 *   테스트의 PASS/FAIL 판정 체계를 부여한다. **재생 로직 / queue / crossfade /
 *   sinkId / Recovery priority / Health / preload / Invalid State 보정 전부 무변경**
 *   — 측정 · 요약 · 판정 만 추가.
 *
 * 규칙:
 *   • 순수 계산 (side-effect 없음) — 신규 setInterval / rAF / polling 0.
 *   • LongRun ON 상태에서만 의미 있음. OFF 여도 hook 자체는 no-op 로 안전.
 *   • 로그는 audioDebugWarn gate. 10분 throttle 로 [audio:burnin:summary].
 *   • status 전이 시 [audio:burnin:pass] / [audio:burnin:fail].
 *   • Fail 은 즉시 판정 (elapsed 목표 미달이어도 심각 지표 감지 시 fail).
 *   • Pass 는 elapsedMs >= target 이고 fail 조건 0 일 때만.
 *
 * Target 결정 (우선순위):
 *   1. URL query `?audioBurnInHours=<n>`
 *   2. localStorage `deudda.audioBurnInHours`
 *   3. 기본값 12
 */
import { useCallback, useRef } from 'react';
import { audioDebugWarn } from '@/lib/audioDebug';
import type { LongRunSummary } from '@/hooks/useAudioLongRunDiagnostics';
import type { LifecycleSnapshot } from '@/hooks/useAudioLifecycleAudit';
import type { RecoverySummary } from '@/hooks/useAudioRecoveryManager';
import type { InvalidStateSummary } from '@/hooks/useAudioInvalidStateGuard';
import type { SessionSummary, AudioSessionState } from '@/hooks/useAudioSessionState';

export type BurnInStatus = 'not-started' | 'running' | 'pass' | 'fail';

export interface BurnInMetrics {
  recoveries: number;
  failedRecoveries: number;
  escalations: number;
  invalidStates: number;
  correctedInvalidStates: number;
  listenerDiff: number;
  heapGrowthBytes: number;
  healthIssueRatePerHour: number;
  trackTransitions: number;
  sessionState: AudioSessionState;
  currentStateDurationMs: number;
}

export interface BurnInSummary {
  targetHours: number;
  elapsedMs: number;
  progressPct: number;
  status: BurnInStatus;
  pass: boolean;
  failReasons: string[];
  warnings: string[];
  metrics: BurnInMetrics;
  generatedAt: string;
}

export interface BurnInInputs {
  getLongRunSummary: () => LongRunSummary;
  getLifecycleSummary?: () => LifecycleSnapshot;
  getRecoverySummary: () => RecoverySummary;
  getInvalidStateSummary?: () => InvalidStateSummary;
  getSessionSummary?: () => SessionSummary;
}

export interface BurnInHandle {
  getBurnInSummary: () => BurnInSummary;
  /** Dashboard tick / LongRun summary tick 에서 호출 · 10분 throttle. */
  maybeLogSummary: (reason: string) => void;
}

const STORAGE_KEY = 'deudda.audioBurnInHours';
const QUERY_KEY = 'audioBurnInHours';
const DEFAULT_TARGET_HOURS = 12;
const LOG_THROTTLE_MS = 10 * 60 * 1000; // 10분
const MB = 1024 * 1024;

/**
 * PASS / FAIL 기준 (문서와 1:1 매칭).
 *  - HEAP_GROWTH_MAX_BYTES         = 150MB
 *  - LISTENER_DIFF_MAX             = 4
 *  - RECOVERY_FAILED_MAX           = 3
 *  - HEALTH_RATE_MAX_PER_HOUR      = 1
 *  - AUTOPLAY_CORRECTION_MAX       = 1 (그 이상은 FAIL)
 *  - CROSSFADE_STUCK_MAX           = 2
 *  - SINK_MISMATCH_MAX             = 5 (관측 log 이슈이므로 여유 큼)
 */
const HEAP_GROWTH_MAX_BYTES = 150 * MB;
const HEAP_GROWTH_WARN_BYTES = 50 * MB;
const LISTENER_DIFF_MAX = 4;
const RECOVERY_FAILED_MAX = 3;
const HEALTH_RATE_MAX_PER_HOUR = 1;
const HEALTH_RATE_WARN_PER_HOUR = 0.5;
const AUTOPLAY_CORRECTION_MAX = 1;
const CROSSFADE_STUCK_MAX = 2;
const SINK_MISMATCH_MAX = 5;

function resolveTargetHours(): number {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get(QUERY_KEY);
      if (q) {
        const n = Number(q);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const ls = window.localStorage?.getItem(STORAGE_KEY);
      if (ls) {
        const n = Number(ls);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  } catch { /* silent */ }
  return DEFAULT_TARGET_HOURS;
}

export function useAudioBurnInCertification(inputs: BurnInInputs): BurnInHandle {
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  // Target hours 는 세션 시작 시 확정 (URL/localStorage 변경 후 새로고침 필요).
  const targetHoursRef = useRef<number>(resolveTargetHours());

  // 로그 throttle · status 전이 감지.
  const lastLoggedAtRef = useRef<number>(0);
  const lastStatusRef = useRef<BurnInStatus>('not-started');

  const evaluate = useCallback((): BurnInSummary => {
    const c = inputsRef.current;
    const targetHours = targetHoursRef.current;
    const targetMs = targetHours * 3600 * 1000;

    const longRun = c.getLongRunSummary();
    const recovery = c.getRecoverySummary();
    const lifecycle = c.getLifecycleSummary ? c.getLifecycleSummary() : null;
    const invalidState = c.getInvalidStateSummary ? c.getInvalidStateSummary() : null;
    const session = c.getSessionSummary ? c.getSessionSummary() : null;

    const elapsedMs = longRun.active ? longRun.elapsedMs : 0;
    const progressPct = Math.min(100, (elapsedMs / targetMs) * 100);

    // ---------------- metrics ----------------
    const heapGrowthBytes = lifecycle?.heapGrowthFromStartBytes ?? 0;
    const listenerDiff = lifecycle?.listenerDiff ?? 0;

    // health issue rate — 1시간 미만이면 rate 신뢰도 낮으니 그냥 healthIssueCount 로 산출.
    const elapsedHours = elapsedMs / 3600 / 1000;
    const healthIssueRatePerHour = elapsedHours > 0
      ? longRun.healthIssueCount / elapsedHours
      : 0;

    const metrics: BurnInMetrics = {
      recoveries: recovery.totalRecoveries,
      failedRecoveries: recovery.failedCount,
      escalations: recovery.escalationCount,
      invalidStates: invalidState?.totalInvalid ?? 0,
      correctedInvalidStates: invalidState?.totalCorrected ?? 0,
      listenerDiff,
      heapGrowthBytes,
      healthIssueRatePerHour,
      trackTransitions: longRun.trackTransitions,
      sessionState: session?.currentState ?? 'idle',
      currentStateDurationMs: session?.currentStateDurationMs ?? 0,
    };

    // ---------------- FAIL reasons ----------------
    const failReasons: string[] = [];
    const invalidCounts = invalidState?.perIssueCounts ?? {};
    const recoveryReasonCounts = recovery.perReasonCounts;

    if (recovery.escalationCount > 0) {
      failReasons.push(`escalation-detected=${recovery.escalationCount}`);
    }
    if ((invalidCounts['both-playing-no-crossfade'] ?? 0) > 0) {
      failReasons.push(`both-playing-detected=${invalidCounts['both-playing-no-crossfade']}`);
    }
    if ((invalidCounts['active-playing-without-intent'] ?? 0) > AUTOPLAY_CORRECTION_MAX) {
      failReasons.push(`autoplay-repeated=${invalidCounts['active-playing-without-intent']}`);
    }
    if (recovery.failedCount > RECOVERY_FAILED_MAX) {
      failReasons.push(`recovery-failed-excess=${recovery.failedCount}`);
    }
    if (heapGrowthBytes > HEAP_GROWTH_MAX_BYTES) {
      failReasons.push(`heap-growth-excess=${Math.round(heapGrowthBytes / MB)}MB`);
    }
    if (listenerDiff > LISTENER_DIFF_MAX) {
      failReasons.push(`listener-leak=${listenerDiff}`);
    }
    if ((invalidCounts['sink-mismatch-observed'] ?? 0) > SINK_MISMATCH_MAX) {
      failReasons.push(`sink-mismatch-persistent=${invalidCounts['sink-mismatch-observed']}`);
    }
    if ((invalidCounts['recovering-too-long'] ?? 0) > 0) {
      failReasons.push(`recovering-stuck=${invalidCounts['recovering-too-long']}`);
    }
    if ((recoveryReasonCounts['crossfade-stuck'] ?? 0) > CROSSFADE_STUCK_MAX) {
      failReasons.push(`crossfade-stuck-repeated=${recoveryReasonCounts['crossfade-stuck']}`);
    }
    if (elapsedHours > 1 && healthIssueRatePerHour > HEALTH_RATE_MAX_PER_HOUR) {
      failReasons.push(`health-issue-rate-excess=${healthIssueRatePerHour.toFixed(2)}/h`);
    }

    // ---------------- Warnings (soft) ----------------
    const warnings: string[] = [];
    if ((invalidCounts['active-playing-without-intent'] ?? 0) === 1) {
      warnings.push('autoplay-observed-once');
    }
    if (recovery.failedCount > 0 && recovery.failedCount <= RECOVERY_FAILED_MAX) {
      warnings.push(`recovery-failed-nonzero=${recovery.failedCount}`);
    }
    if (heapGrowthBytes > HEAP_GROWTH_WARN_BYTES && heapGrowthBytes <= HEAP_GROWTH_MAX_BYTES) {
      warnings.push(`heap-growth-moderate=${Math.round(heapGrowthBytes / MB)}MB`);
    }
    if (listenerDiff > 0 && listenerDiff <= LISTENER_DIFF_MAX) {
      warnings.push(`listener-diff-nonzero=${listenerDiff}`);
    }
    if (elapsedHours >= 1 && longRun.trackTransitions === 0) {
      warnings.push('no-track-transitions-yet');
    }
    if (elapsedHours > 1 && healthIssueRatePerHour > HEALTH_RATE_WARN_PER_HOUR && healthIssueRatePerHour <= HEALTH_RATE_MAX_PER_HOUR) {
      warnings.push(`health-issue-rate-elevated=${healthIssueRatePerHour.toFixed(2)}/h`);
    }
    if ((invalidCounts['sink-mismatch-observed'] ?? 0) > 0 && (invalidCounts['sink-mismatch-observed'] ?? 0) <= SINK_MISMATCH_MAX) {
      warnings.push(`sink-mismatch-observed=${invalidCounts['sink-mismatch-observed']}`);
    }

    // ---------------- Status ----------------
    let status: BurnInStatus;
    if (!longRun.active || elapsedMs === 0) {
      status = 'not-started';
    } else if (failReasons.length > 0) {
      status = 'fail';
    } else if (elapsedMs >= targetMs) {
      status = 'pass';
    } else {
      status = 'running';
    }

    return {
      targetHours,
      elapsedMs,
      progressPct,
      status,
      pass: status === 'pass',
      failReasons,
      warnings,
      metrics,
      // Date.now() 대신 진단용 stable string.
      generatedAt: `t+${Math.round(elapsedMs / 1000)}s`,
    };
  }, []);

  const getBurnInSummary = useCallback((): BurnInSummary => evaluate(), [evaluate]);

  const maybeLogSummary = useCallback((reason: string): void => {
    const now = performance.now();
    const summary = evaluate();

    // status 전이 로그 (running→pass / running→fail 등) — throttle 없이 즉시.
    if (summary.status !== lastStatusRef.current) {
      const prev = lastStatusRef.current;
      lastStatusRef.current = summary.status;
      if (summary.status === 'pass') {
        audioDebugWarn('[audio:burnin:pass]', {
          from: prev,
          reason,
          targetHours: summary.targetHours,
          elapsedMs: summary.elapsedMs,
          warnings: summary.warnings,
          metrics: summary.metrics,
        });
      } else if (summary.status === 'fail') {
        audioDebugWarn('[audio:burnin:fail]', {
          from: prev,
          reason,
          targetHours: summary.targetHours,
          elapsedMs: summary.elapsedMs,
          failReasons: summary.failReasons,
          warnings: summary.warnings,
          metrics: summary.metrics,
        });
      }
    }

    // running 상태에서 주기적 summary — 10분 throttle.
    if (now - lastLoggedAtRef.current < LOG_THROTTLE_MS) return;
    // not-started 는 시끄러우니 skip.
    if (summary.status === 'not-started') return;
    lastLoggedAtRef.current = now;
    audioDebugWarn('[audio:burnin:summary]', {
      reason,
      status: summary.status,
      progressPct: Math.round(summary.progressPct),
      targetHours: summary.targetHours,
      elapsedMs: summary.elapsedMs,
      failReasons: summary.failReasons,
      warnings: summary.warnings,
      metrics: summary.metrics,
    });
  }, [evaluate]);

  return { getBurnInSummary, maybeLogSummary };
}
