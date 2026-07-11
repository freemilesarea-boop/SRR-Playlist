// WEB-OBS-2 — Incident candidate detection (pure, unit-tested, rule-based).
//
// Incidents are CANDIDATES for an operator to confirm — not auto-alerts (no Slack/email this phase).
// Every candidate is derived from an explicit, named rule with the threshold it crossed recorded in
// `threshold` and the numbers in `baselineValue`/`currentValue`, so the operator sees exactly WHY it
// fired. Sample/session gates (via detectSpike and MIN_* thresholds) keep low-traffic noise out.
// No persistence: candidates are recomputed from the query each load (a table would add write paths
// and RLS surface for no operator benefit this phase — deferred, see docs).

import { detectSpike } from './spike';
import { ErrorGroup } from './fingerprint';
import { MetricComparison } from './release';
import {
  MIN_SESSIONS_FOR_INCIDENT, MIN_SAMPLES_FOR_METRIC,
  CHUNK_FAILURE_RATE_CRITICAL, CRITICAL_ERROR_RATE_FLOOR,
} from './thresholds';

export type IncidentType =
  | 'ERROR_SPIKE' | 'CRITICAL_ERROR' | 'CHUNK_FAILURE_SPIKE' | 'HYDRATION_ERROR_SPIKE'
  | 'ROUTE_REGRESSION' | 'API_REGRESSION' | 'WEB_VITAL_REGRESSION' | 'LONG_TASK_SPIKE'
  | 'MEMORY_RISK' | 'BOOT_RECOVERY_FAILURE' | 'BROWSER_SPECIFIC_FAILURE' | 'RELEASE_SPECIFIC_FAILURE';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface IncidentCandidate {
  incidentKey: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: 'candidate';
  title: string;
  release: string | null;
  route: string | null;
  api: string | null;
  browser: string | null;
  affectedSessions: number;
  eventCount: number;
  baselineValue: number | null;
  currentValue: number | null;
  delta: number | null;
  threshold: string;
  evidence: string;
  suggestedAction: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface IncidentInputs {
  /** Current-window error group aggregates (from groupErrors). */
  errorGroups: readonly ErrorGroup[];
  /** Prior-period counts keyed by fingerprint for spike baselines (optional). */
  errorBaselineByFingerprint?: Record<string, { count: number; sessions: number }>;
  /** Window-level rates for critical/chunk/hydration floor rules. */
  criticalErrorRate: number;
  chunkFailureRate: number;
  chunkFailureSessions: number;
  hydrationErrorSessions: number;
  totalSessions: number;
  /** Release regression rows (current vs previous), already classified. */
  releaseRegressions?: readonly MetricComparison[];
  currentRelease?: string | null;
  previousRelease?: string | null;
  /** Browser-specific error findings (already gated for sample size). */
  browserAnomalies?: ReadonlyArray<{ browser: string; errorRate: number; baselineRate: number; sessions: number }>;
  /** Memory-risk session count in window. */
  memoryRiskSessions?: number;
  /** Boot recovery attempts/failures if available (else omit). */
  bootRecoveryAttempts?: number | null;
  bootRecoveryFailures?: number | null;
}

const RANK: Record<IncidentSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Build the ranked list of incident candidates. Empty array when nothing crosses a rule. */
export function buildIncidents(inp: IncidentInputs): IncidentCandidate[] {
  const out: IncidentCandidate[] = [];

  // 1) CRITICAL_ERROR — window critical-error rate over the hard floor.
  if (inp.criticalErrorRate >= CRITICAL_ERROR_RATE_FLOOR && inp.totalSessions >= MIN_SESSIONS_FOR_INCIDENT) {
    out.push({
      incidentKey: 'critical-error-rate', type: 'CRITICAL_ERROR', severity: 'critical', status: 'candidate',
      title: '심각(critical) 오류 비율 초과',
      release: inp.currentRelease ?? null, route: null, api: null, browser: null,
      affectedSessions: inp.totalSessions, eventCount: 0,
      baselineValue: CRITICAL_ERROR_RATE_FLOOR, currentValue: inp.criticalErrorRate,
      delta: inp.criticalErrorRate - CRITICAL_ERROR_RATE_FLOOR,
      threshold: `critical error rate ≥ ${(CRITICAL_ERROR_RATE_FLOOR * 100).toFixed(0)}%`,
      evidence: `현재 ${(inp.criticalErrorRate * 100).toFixed(2)}%`,
      suggestedAction: 'Errors 탭에서 critical severity fingerprint를 확인하고 최근 배포를 검토하세요.',
      firstSeen: null, lastSeen: null,
    });
  }

  // 2) CHUNK_FAILURE_SPIKE — chunk failures over the critical fraction of sessions.
  if (inp.chunkFailureRate >= CHUNK_FAILURE_RATE_CRITICAL && inp.chunkFailureSessions >= MIN_SESSIONS_FOR_INCIDENT) {
    out.push({
      incidentKey: 'chunk-failure-rate', type: 'CHUNK_FAILURE_SPIKE', severity: 'critical', status: 'candidate',
      title: 'Chunk 로드 실패 급증',
      release: inp.currentRelease ?? null, route: null, api: null, browser: null,
      affectedSessions: inp.chunkFailureSessions, eventCount: inp.chunkFailureSessions,
      baselineValue: CHUNK_FAILURE_RATE_CRITICAL, currentValue: inp.chunkFailureRate,
      delta: inp.chunkFailureRate - CHUNK_FAILURE_RATE_CRITICAL,
      threshold: `chunk failure sessions ≥ ${(CHUNK_FAILURE_RATE_CRITICAL * 100).toFixed(0)}%`,
      evidence: `${inp.chunkFailureSessions} 세션 · ${(inp.chunkFailureRate * 100).toFixed(2)}%`,
      suggestedAction: '새 배포의 정적 자산 캐시/버전 불일치를 의심하세요(Boot Recovery는 관측 전용).',
      firstSeen: null, lastSeen: null,
    });
  }

  // 3) HYDRATION_ERROR_SPIKE — hydration group sessions over the incident session floor.
  if (inp.hydrationErrorSessions >= Math.max(MIN_SESSIONS_FOR_INCIDENT, 3)) {
    out.push({
      incidentKey: 'hydration-errors', type: 'HYDRATION_ERROR_SPIKE', severity: 'high', status: 'candidate',
      title: 'Hydration 불일치 오류 다발',
      release: inp.currentRelease ?? null, route: null, api: null, browser: null,
      affectedSessions: inp.hydrationErrorSessions, eventCount: inp.hydrationErrorSessions,
      baselineValue: null, currentValue: inp.hydrationErrorSessions,
      delta: null, threshold: `hydration sessions ≥ ${Math.max(MIN_SESSIONS_FOR_INCIDENT, 3)}`,
      evidence: `${inp.hydrationErrorSessions} 세션`,
      suggestedAction: 'SSR/CSR 렌더 불일치(날짜/로케일/조건부 렌더)를 점검하세요.',
      firstSeen: null, lastSeen: null,
    });
  }

  // 4) ERROR_SPIKE per fingerprint vs baseline (when a baseline map is provided).
  if (inp.errorBaselineByFingerprint) {
    for (const g of inp.errorGroups) {
      if (g.groupClass === 'chunk' || g.groupClass === 'hydration') continue; // covered above
      const base = inp.errorBaselineByFingerprint[g.fingerprint] ?? { count: 0, sessions: 0 };
      const spike = detectSpike({
        current: g.count, baseline: base.count, currentSamples: g.count, affectedSessions: g.sessions,
        minSamples: MIN_SAMPLES_FOR_METRIC, relThreshold: 0.5, absThreshold: 10,
      });
      if (spike.isSpike) {
        out.push({
          incidentKey: `error-spike:${g.fingerprint}`, type: 'ERROR_SPIKE', severity: 'high', status: 'candidate',
          title: `오류 급증: ${g.normalizedMessage.slice(0, 60)}`,
          release: g.releases[0] ?? null, route: g.representativeRoute, api: null, browser: g.browsers[0] ?? null,
          affectedSessions: g.sessions, eventCount: g.count,
          baselineValue: base.count, currentValue: g.count, delta: spike.absChange,
          threshold: '+50% & +10 vs 직전 기간', evidence: spike.reason,
          suggestedAction: 'Errors 탭에서 fingerprint를 열어 영향 라우트/릴리스를 확인하세요.',
          firstSeen: g.firstSeen, lastSeen: g.lastSeen,
        });
      }
    }
  }

  // 5) Release regressions → typed incidents (vital / route / api / generic).
  for (const r of inp.releaseRegressions ?? []) {
    if (r.classification !== 'REGRESSED') continue;
    const isVital = ['lcpP75', 'inpP75', 'clsP75', 'ttfbP75'].includes(r.key);
    const type: IncidentType = isVital ? 'WEB_VITAL_REGRESSION'
      : r.key === 'slowRouteRate' ? 'ROUTE_REGRESSION'
        : r.key === 'slowApiRate' ? 'API_REGRESSION'
          : r.key === 'longTaskRate' ? 'LONG_TASK_SPIKE'
            : 'RELEASE_SPECIFIC_FAILURE';
    out.push({
      incidentKey: `release-regression:${r.key}`, type, severity: r.confidence === 'HIGH' ? 'high' : 'medium', status: 'candidate',
      title: `배포 회귀: ${r.label}`,
      release: inp.currentRelease ?? null, route: null, api: null, browser: null,
      affectedSessions: Math.min(r.sampleA, r.sampleB), eventCount: r.sampleB,
      baselineValue: r.valueA, currentValue: r.valueB, delta: r.absDelta,
      threshold: `${r.label} 회귀(abs+rel 임계 초과)`,
      evidence: `${inp.previousRelease ?? 'prev'} → ${inp.currentRelease ?? 'cur'} · confidence ${r.confidence}`,
      suggestedAction: 'Releases 탭에서 두 릴리스를 비교하고 승격을 보류할지 판단하세요.',
      firstSeen: null, lastSeen: null,
    });
  }

  // 6) Browser-specific failures (sample-gated upstream).
  for (const b of inp.browserAnomalies ?? []) {
    if (b.sessions < MIN_SESSIONS_FOR_INCIDENT) continue;
    out.push({
      incidentKey: `browser-failure:${b.browser}`, type: 'BROWSER_SPECIFIC_FAILURE', severity: 'medium', status: 'candidate',
      title: `${b.browser} 특정 오류 편중`,
      release: inp.currentRelease ?? null, route: null, api: null, browser: b.browser,
      affectedSessions: b.sessions, eventCount: b.sessions,
      baselineValue: b.baselineRate, currentValue: b.errorRate, delta: b.errorRate - b.baselineRate,
      threshold: '브라우저 error rate ≫ 전체 평균', evidence: `${b.browser} ${(b.errorRate * 100).toFixed(1)}% vs 전체 ${(b.baselineRate * 100).toFixed(1)}%`,
      suggestedAction: `${b.browser}에서 재현 후 브라우저별 호환성 회귀를 확인하세요.`,
      firstSeen: null, lastSeen: null,
    });
  }

  // 7) MEMORY_RISK.
  if ((inp.memoryRiskSessions ?? 0) >= Math.max(MIN_SESSIONS_FOR_INCIDENT, 3)) {
    const n = inp.memoryRiskSessions ?? 0;
    out.push({
      incidentKey: 'memory-risk', type: 'MEMORY_RISK', severity: 'medium', status: 'candidate',
      title: '메모리 압박 세션 다발',
      release: inp.currentRelease ?? null, route: null, api: null, browser: null,
      affectedSessions: n, eventCount: n, baselineValue: null, currentValue: n, delta: null,
      threshold: `used/limit ≥ 90% 세션 ≥ ${Math.max(MIN_SESSIONS_FOR_INCIDENT, 3)}`,
      evidence: `${n} 세션`, suggestedAction: 'Devices 탭 memory bucket 분포와 장시간 세션 누수를 점검하세요.',
      firstSeen: null, lastSeen: null,
    });
  }

  // 8) BOOT_RECOVERY_FAILURE (only when telemetry is present).
  if (inp.bootRecoveryAttempts && inp.bootRecoveryAttempts > 0) {
    const failRate = (inp.bootRecoveryFailures ?? 0) / inp.bootRecoveryAttempts;
    if (failRate >= 0.2 && (inp.bootRecoveryFailures ?? 0) >= MIN_SESSIONS_FOR_INCIDENT) {
      out.push({
        incidentKey: 'boot-recovery-failure', type: 'BOOT_RECOVERY_FAILURE', severity: 'high', status: 'candidate',
        title: 'Boot Recovery 실패율 상승',
        release: inp.currentRelease ?? null, route: null, api: null, browser: null,
        affectedSessions: inp.bootRecoveryFailures ?? 0, eventCount: inp.bootRecoveryAttempts,
        baselineValue: 0.2, currentValue: failRate, delta: failRate - 0.2,
        threshold: 'recovery failure rate ≥ 20%', evidence: `${inp.bootRecoveryFailures}/${inp.bootRecoveryAttempts} 실패`,
        suggestedAction: 'Boot Recovery는 관측 전용 — 로직 변경 없이 chunk/버전 불일치 원인을 조사하세요.',
        firstSeen: null, lastSeen: null,
      });
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.affectedSessions - a.affectedSessions);
}
