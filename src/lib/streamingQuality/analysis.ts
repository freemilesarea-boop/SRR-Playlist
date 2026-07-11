// WEB-OBS-7 — Quality regression, incidents & advisor (pure, unit-tested, rule-based — NO ML).
//
// Regression compares a metric between two releases/windows and is HONEST about sample size (both
// abs & rel floors must clear; below the min sample → INSUFFICIENT_DATA). Incidents require a real
// affected-session sample; a small sample can never assert a RELEASE/BROWSER/DEVICE-wide failure. The
// advisor recommends only — automated=false, requiresApproval=true, no remote control.

import { percentChange, absDelta, round } from '../observability/math';
import type { Confidence } from '../observability/release';
import type { StreamingQualityResult } from './types';
import {
  MIN_SAMPLES_FOR_METRIC, CONFIDENCE_HIGH_SAMPLES, CONFIDENCE_MEDIUM_SAMPLES,
  REG_START_SUCCESS, REG_TTFA_MS, REG_GAP_MS, REG_CROSSFADE_RATE, REG_STALL_RATE,
  REG_MEDIA_ERROR_RATE, REG_PRELOAD_RATE, REG_RECOVERY_RATE, REG_SCORE,
  INCIDENT_SPIKE_REL, INCIDENT_SPIKE_ABS, INCIDENT_MIN_AFFECTED_SESSIONS, INCIDENT_RELEASE_MIN_SESSIONS,
  ADVISOR_ESCALATE_AFFECTED_SESSIONS, ADVISOR_HOLD_RELEASE_SCORE_DROP,
} from './thresholds';

export type MetricClass = 'IMPROVED' | 'REGRESSED' | 'STABLE' | 'INSUFFICIENT_DATA';

export interface MetricSpec { key: string; label: string; abs: number; rel: number; lowerIsBetter: boolean; unit: 'ms' | 'ratio' | 'score'; }

export const QUALITY_METRIC_SPECS: MetricSpec[] = [
  { key: 'startSuccessRate', label: 'Start Success Rate', ...REG_START_SUCCESS, unit: 'ratio' },
  { key: 'ttfaP75', label: 'TTFA_APPROX p75', ...REG_TTFA_MS, unit: 'ms' },
  { key: 'gapP75', label: 'Transition Gap p75', ...REG_GAP_MS, unit: 'ms' },
  { key: 'crossfadeCompletionRate', label: 'Crossfade Completion', ...REG_CROSSFADE_RATE, unit: 'ratio' },
  { key: 'stallSessionRate', label: 'Stall Session Rate', ...REG_STALL_RATE, unit: 'ratio' },
  { key: 'mediaErrorSessionRate', label: 'Media Error Session Rate', ...REG_MEDIA_ERROR_RATE, unit: 'ratio' },
  { key: 'preloadReadyRate', label: 'Preload Ready Rate', ...REG_PRELOAD_RATE, unit: 'ratio' },
  { key: 'recoverySuccessRate', label: 'Recovery Success Rate', ...REG_RECOVERY_RATE, unit: 'ratio' },
  { key: 'score', label: 'Streaming Quality Score', ...REG_SCORE, unit: 'score' },
];

export interface MetricComparison {
  key: string; label: string; unit: string; lowerIsBetter: boolean;
  baseline: number | null; current: number | null; absDelta: number | null; relDelta: number | null;
  classification: MetricClass; confidence: Confidence;
}

function confidenceFor(a: number, b: number): Confidence {
  const n = Math.min(a, b);
  if (n < MIN_SAMPLES_FOR_METRIC) return 'INSUFFICIENT';
  if (n >= CONFIDENCE_HIGH_SAMPLES) return 'HIGH';
  if (n >= CONFIDENCE_MEDIUM_SAMPLES) return 'MEDIUM';
  return 'LOW';
}

function metricValue(r: StreamingQualityResult, key: string): number | null {
  switch (key) {
    case 'startSuccessRate': return r.start.successRate;
    case 'ttfaP75': return r.ttfa.p75;
    case 'gapP75': return r.transition.gapP75;
    case 'crossfadeCompletionRate': return r.crossfade.completionRate;
    case 'stallSessionRate': return r.stall.sessionRate;
    case 'mediaErrorSessionRate': return r.mediaError.sessionRate;
    case 'preloadReadyRate': return r.preload.readyRate;
    case 'recoverySuccessRate': return r.recovery.successRate;
    case 'score': return r.score;
    default: return null;
  }
}

export function compareQualityMetric(spec: MetricSpec, baseline: StreamingQualityResult, current: StreamingQualityResult): MetricComparison {
  const bv = metricValue(baseline, spec.key);
  const cv = metricValue(current, spec.key);
  const conf = confidenceFor(baseline.sessions, current.sessions);
  const base: Omit<MetricComparison, 'classification' | 'confidence'> = {
    key: spec.key, label: spec.label, unit: spec.unit, lowerIsBetter: spec.lowerIsBetter,
    baseline: bv, current: cv,
    absDelta: bv != null && cv != null ? round(absDelta(cv, bv)) : null,
    relDelta: bv != null && cv != null ? round(percentChange(cv, bv), 4) : null,
  };
  if (conf === 'INSUFFICIENT' || bv == null || cv == null) return { ...base, classification: 'INSUFFICIENT_DATA', confidence: conf };
  const ad = cv - bv;
  const rel = bv !== 0 ? Math.abs(ad / bv) : (Math.abs(ad) >= spec.abs ? Infinity : 0);
  const cleared = Math.abs(ad) >= spec.abs && rel >= spec.rel;
  if (!cleared) return { ...base, classification: 'STABLE', confidence: conf };
  const worse = spec.lowerIsBetter ? ad > 0 : ad < 0;
  return { ...base, classification: worse ? 'REGRESSED' : 'IMPROVED', confidence: conf };
}

export interface QualityRegression {
  metrics: MetricComparison[];
  regressedCount: number;
  improvedCount: number;
  overall: MetricClass;
  scoreDelta: number | null;
}

export function computeQualityRegression(baseline: StreamingQualityResult, current: StreamingQualityResult): QualityRegression {
  const metrics = QUALITY_METRIC_SPECS.map((s) => compareQualityMetric(s, baseline, current));
  const decisive = metrics.filter((m) => m.classification !== 'INSUFFICIENT_DATA' && m.confidence !== 'INSUFFICIENT');
  const regressedCount = decisive.filter((m) => m.classification === 'REGRESSED').length;
  const improvedCount = decisive.filter((m) => m.classification === 'IMPROVED').length;
  const scoreCmp = metrics.find((m) => m.key === 'score');
  const overall: MetricClass = decisive.length === 0 ? 'INSUFFICIENT_DATA'
    : regressedCount > improvedCount ? 'REGRESSED'
    : improvedCount > regressedCount ? 'IMPROVED' : 'STABLE';
  return { metrics, regressedCount, improvedCount, overall, scoreDelta: scoreCmp?.absDelta ?? null };
}

// ── Incidents ───────────────────────────────────────────────────────────────
export type QualityIncidentType =
  | 'PLAYBACK_START_FAILURE_SPIKE' | 'TTFA_REGRESSION' | 'TRANSITION_GAP_SPIKE' | 'CROSSFADE_FAILURE_SPIKE'
  | 'STALL_SPIKE' | 'MEDIA_ERROR_SPIKE' | 'PRELOAD_FAILURE_SPIKE' | 'RECOVERY_FAILURE_SPIKE'
  | 'SESSION_CONTINUITY_DROP' | 'RELEASE_SPECIFIC_QUALITY_REGRESSION';
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface QualityIncident {
  incidentKey: string; type: QualityIncidentType; severity: IncidentSeverity; scope: string;
  release: string | null; affectedSessions: number; baseline: number | null; current: number | null;
  delta: number | null; confidence: Confidence; evidence: string[]; suggestedAction: string;
}

/** Detect rate-spike incidents for the CURRENT result vs a BASELINE result (same scope). */
export function detectQualityIncidents(baseline: StreamingQualityResult | null, current: StreamingQualityResult, release: string | null = null): QualityIncident[] {
  const out: QualityIncident[] = [];
  if (current.confidence === 'INSUFFICIENT') return out;
  const conf = current.confidence;
  const spike = (cur: number | null, base: number | null): boolean => {
    if (cur == null) return false;
    if (base == null) return cur >= INCIDENT_SPIKE_ABS;
    return cur >= base * INCIDENT_SPIKE_REL && cur - base >= INCIDENT_SPIKE_ABS;
  };
  const mk = (type: QualityIncidentType, severity: IncidentSeverity, affected: number, base: number | null, cur: number | null, ev: string[], action: string): QualityIncident => ({
    incidentKey: `${current.scope}:${type}`, type, severity, scope: current.scope, release,
    affectedSessions: affected, baseline: round(base, 4), current: round(cur, 4),
    delta: base != null && cur != null ? round(cur - base, 4) : null, confidence: conf, evidence: ev, suggestedAction: action,
  });

  // Media error spike
  if (current.mediaError.status === 'HIGH' || spike(current.mediaError.sessionRate, baseline?.mediaError.sessionRate ?? null)) {
    if (current.mediaError.events >= INCIDENT_MIN_AFFECTED_SESSIONS) {
      out.push(mk('MEDIA_ERROR_SPIKE', 'HIGH', current.mediaError.events, baseline?.mediaError.sessionRate ?? null, current.mediaError.sessionRate, [`${current.mediaError.events} media errors`], 'Decoder/코덱 호환성·소스 확인(브라우저별)'));
    }
  }
  // Stall spike
  if (current.stall.status === 'HIGH' || spike(current.stall.sessionRate, baseline?.stall.sessionRate ?? null)) {
    if (current.stall.stallSessions >= INCIDENT_MIN_AFFECTED_SESSIONS) {
      out.push(mk('STALL_SPIKE', 'HIGH', current.stall.stallSessions, baseline?.stall.sessionRate ?? null, current.stall.sessionRate, [`${current.stall.stallSessions} stalled sessions`], '매장 네트워크/버퍼링 확인'));
    }
  }
  // Start failure spike
  if (current.start.status === 'FAILING' && current.start.failed >= INCIDENT_MIN_AFFECTED_SESSIONS) {
    out.push(mk('PLAYBACK_START_FAILURE_SPIKE', 'CRITICAL', current.start.failed, baseline?.start.successRate ?? null, current.start.successRate, [`${current.start.failed} failed starts`], '재생 시작 실패 원인(자동재생 차단/미디어 오류) 확인'));
  }
  // Crossfade failure
  if (current.crossfade.status === 'FAILING' && (current.crossfade.fallback + current.crossfade.aborted) >= INCIDENT_MIN_AFFECTED_SESSIONS) {
    out.push(mk('CROSSFADE_FAILURE_SPIKE', 'MEDIUM', current.crossfade.fallback + current.crossfade.aborted, null, current.crossfade.completionRate, [`fallback ${current.crossfade.fallback} · aborted ${current.crossfade.aborted}`], 'Crossfade fallback/abort 경로 확인(관측만)'));
  }
  // TTFA regression (needs baseline)
  if (baseline?.ttfa.p75 != null && current.ttfa.p75 != null && current.ttfa.samples >= INCIDENT_MIN_AFFECTED_SESSIONS) {
    if (current.ttfa.p75 - baseline.ttfa.p75 >= REG_TTFA_MS.abs && current.ttfa.p75 >= baseline.ttfa.p75 * (1 + REG_TTFA_MS.rel)) {
      out.push(mk('TTFA_REGRESSION', 'MEDIUM', current.ttfa.samples, baseline.ttfa.p75, current.ttfa.p75, [`TTFA_APPROX p75 ${baseline.ttfa.p75}→${current.ttfa.p75}ms`], 'TTFA 악화 릴리스/네트워크 상관 확인'));
    }
  }
  // Recovery failure
  if (current.recovery.status === 'FAILING' && current.recovery.attempted >= INCIDENT_MIN_AFFECTED_SESSIONS) {
    out.push(mk('RECOVERY_FAILURE_SPIKE', 'HIGH', current.recovery.failed, baseline?.recovery.successRate ?? null, current.recovery.successRate, [`${current.recovery.failed}/${current.recovery.attempted} recovery failed`], 'Recovery 실패 원인 조사'));
  }
  // Release-specific quality regression
  if (release && baseline?.score != null && current.score != null && current.sessions >= INCIDENT_RELEASE_MIN_SESSIONS && baseline.score - current.score >= ADVISOR_HOLD_RELEASE_SCORE_DROP) {
    out.push(mk('RELEASE_SPECIFIC_QUALITY_REGRESSION', 'HIGH', current.sessions, baseline.score, current.score, [`score ${baseline.score}→${current.score}`], '릴리스 품질 회귀 — 승격 보류 검토'));
  }
  return out;
}

// ── Advisor (recommendation only — nothing executed, no remote control) ──────
export type QualityActionCategory =
  | 'MONITOR_RECOVERY' | 'VERIFY_MEDIA_SOURCE' | 'VERIFY_DECODER_COMPATIBILITY' | 'VERIFY_NETWORK'
  | 'VERIFY_TRANSITION' | 'VERIFY_CROSSFADE' | 'VERIFY_PRELOAD' | 'VERIFY_RECOVERY' | 'VERIFY_BROWSER'
  | 'VERIFY_DEVICE' | 'VERIFY_RELEASE' | 'HOLD_RELEASE' | 'PREPARE_ROLLBACK' | 'ESCALATE_PLAYER_ENGINEERING' | 'ESCALATE_INFRA';
export type Urgency = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface QualityAdvice {
  recommendedAction: QualityActionCategory;
  urgency: Urgency;
  reason: string;
  verificationSteps: string[];
  requiresApproval: true;
  automated: false;
  remoteControl: false;
  safetyWarning: string;
}

const CHECKLISTS: Partial<Record<QualityActionCategory, string[]>> = {
  VERIFY_MEDIA_SOURCE: ['미디어 소스/컨테이너 확인', '오류 코드 분포(1~4)', '특정 트랙 집중 여부'],
  VERIFY_DECODER_COMPATIBILITY: ['browser별 media error 집중', 'device/OS 분포', 'DECODE/SRC_NOT_SUPPORTED 비율'],
  VERIFY_NETWORK: ['MEDIA_ERR_NETWORK 비율', 'reconnect 상관', '매장 회선 확인 안내'],
  VERIFY_CROSSFADE: ['fallback/aborted 경로', 'safety_timeout 비율', '(business 모드는 crossfade 비활성 — NOT_AVAILABLE)'],
  VERIFY_PRELOAD: ['preload ready/failed 비율', '(consumed 는 NOT_AVAILABLE)', 'transition gap 상관'],
  VERIFY_RECOVERY: ['recovery 성공률', '재발(REGRESSED) 여부', 'post-recovery 안정 창'],
  VERIFY_RELEASE: ['release별 품질 점수', 'Release Gate/Root Cause(WEB-OBS-3/4) 확인'],
  HOLD_RELEASE: ['품질 회귀 지표 확인', '(표시만 — 실제 차단 아님)'],
  PREPARE_ROLLBACK: ['이전 안정 release 품질 확인', '(권고만 — 실제 rollback 아님)'],
  MONITOR_RECOVERY: ['표본 축적 대기', 'auto refresh 추세 관찰'],
};

const SAFETY_WARNING = '권고이며 자동 실행되지 않습니다. 자동 재생 제어/Reload/Rollback/원격 Player 제어는 수행되지 않습니다(운영자 승인 필요).';

export function computeQualityAdvice(result: StreamingQualityResult, regression: QualityRegression | null): QualityAdvice {
  const build = (category: QualityActionCategory, urgency: Urgency, reason: string): QualityAdvice => ({
    recommendedAction: category, urgency, reason, verificationSteps: CHECKLISTS[category] ?? CHECKLISTS.MONITOR_RECOVERY ?? [],
    requiresApproval: true, automated: false, remoteControl: false, safetyWarning: SAFETY_WARNING,
  });
  if (result.confidence === 'INSUFFICIENT') return build('MONITOR_RECOVERY', 'LOW', '표본 부족 — 확정 조치 없이 관찰.');
  if (regression && regression.overall === 'REGRESSED' && regression.regressedCount >= 2 && (regression.scoreDelta ?? 0) <= -ADVISOR_HOLD_RELEASE_SCORE_DROP) {
    return build('HOLD_RELEASE', 'CRITICAL', '릴리스 품질 회귀(다수 지표) — 승격 보류/롤백 검토 권고.');
  }
  if (result.mediaError.status === 'HIGH') return build('VERIFY_DECODER_COMPATIBILITY', 'HIGH', 'Media/Decoder 오류 급증 — 브라우저/디코더 호환성 확인 권고.');
  if (result.start.status === 'FAILING') return build('VERIFY_MEDIA_SOURCE', 'HIGH', '재생 시작 실패율 높음 — 소스/자동재생/네트워크 확인 권고.');
  if (result.stall.status === 'HIGH') return build('VERIFY_NETWORK', 'HIGH', 'Stall 급증 — 네트워크/버퍼링 확인 권고.');
  if (result.recovery.status === 'FAILING') return build('VERIFY_RECOVERY', 'MEDIUM', 'Recovery 실패율 높음 — 복구 경로 확인 권고.');
  if (result.crossfade.status === 'FAILING') return build('VERIFY_CROSSFADE', 'MEDIUM', 'Crossfade 완료율 저하 — 전환 경로 확인 권고(관측만).');
  if (result.status === 'DEGRADED' || result.status === 'CRITICAL') {
    const escalate = result.sessions >= ADVISOR_ESCALATE_AFFECTED_SESSIONS ? 'ESCALATE_PLAYER_ENGINEERING' : 'VERIFY_RELEASE';
    return build(escalate, 'HIGH', '품질 저하 — 상위 영향 요인 조사 권고.');
  }
  return build('MONITOR_RECOVERY', 'NONE', '품질 정상 범위 — 관찰 유지.');
}
