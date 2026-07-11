// WEB-OBS-8 — Predictive warning + release risk + progressive incident. ALL rule-based / statistical —
// NO ML, NO probability model. A "prediction" is a rule-derived likelihood BAND from multiple signals
// trending worse at once; it is a recommendation to observe/prepare, never an automated action. Every
// output degrades to INSUFFICIENT_DATA when the sample cannot support the claim.

import { round } from '../observability/math';
import { computeQualityRegression } from '../streamingQuality/analysis';
import type { StreamingQualityResult } from '../streamingQuality/types';
import {
  PREDICT_MIN_BUCKETS, PREDICT_MIN_SESSIONS_PER_BUCKET,
  PREDICT_TTFA_RISE_MS, PREDICT_TTFA_RISE_REL, PREDICT_RECOVERY_RISE_ABS, PREDICT_RECOVERY_RISE_REL,
  PREDICT_MEDIA_RISE_ABS, PREDICT_MEDIA_RISE_REL, PREDICT_STALL_RISE_ABS, PREDICT_STALL_RISE_REL,
  PREDICT_ELEVATED_SIGNALS, PREDICT_HIGH_SIGNALS,
  RELEASE_RISK_MIN_SESSIONS, RELEASE_RISK_MIN_STORES,
  RELEASE_RISK_SCORE_DROP_WATCH, RELEASE_RISK_SCORE_DROP_HIGH, RELEASE_RISK_SCORE_DROP_CRITICAL,
  PROGRESSIVE_MIN_SPIKES, PROGRESSIVE_MAJOR_SPIKES,
} from './thresholds';
import type {
  SqTimeBucket, PredictiveWarning, RisingSignal, WarningLikelihood,
  ReleaseRisk, ReleaseRiskBand, IncidentTick, ProgressiveIncident, ProgressivePattern,
} from './types';

const APPROVAL = { requiresApproval: true, automated: false, remoteControl: false } as const;

/** Mean of the first third vs the last third of a numeric series (nulls skipped). */
function firstLastThird(vals: Array<number | null>): { from: number | null; to: number | null } {
  const xs = vals.filter((v): v is number => v != null);
  if (xs.length < 2) return { from: null, to: null };
  const k = Math.max(1, Math.floor(xs.length / 3));
  const head = xs.slice(0, k), tail = xs.slice(xs.length - k);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { from: avg(head), to: avg(tail) };
}

function rising(from: number | null, to: number | null, absFloor: number, relFloor: number): boolean {
  if (from == null || to == null) return false;
  const d = to - from;
  if (d < absFloor) return false;
  const rel = from !== 0 ? d / from : (d >= absFloor ? Infinity : 0);
  return rel >= relFloor;
}

/**
 * Predictive warning from recent time buckets. Fires only when ≥2 independent signals are rising AND
 * enough usable buckets exist. Never asserts a probability — only a likelihood band with evidence.
 */
export function computePredictiveWarning(scope: string, buckets: SqTimeBucket[]): PredictiveWarning {
  const usable = buckets.filter((b) => b.sessions >= PREDICT_MIN_SESSIONS_PER_BUCKET);
  const base = (likelihood: WarningLikelihood, signals: RisingSignal[], evidence: string[], rec: string): PredictiveWarning => ({
    scope, likelihood, risingCount: signals.filter((s) => s.rising).length, signals,
    horizon: '향후 1~2시간 (규칙 기반 추세 — 예측 확률 아님)', evidence, recommendation: rec, ...APPROVAL,
  });

  if (usable.length < PREDICT_MIN_BUCKETS) {
    return base('INSUFFICIENT_DATA', [], [`usable buckets ${usable.length} < ${PREDICT_MIN_BUCKETS}`], '표본 부족 — 추세 판단 보류, 관찰 지속.');
  }
  const ttfa = firstLastThird(usable.map((b) => b.ttfaP75));
  const media = firstLastThird(usable.map((b) => b.mediaErrorRate));
  const recov = firstLastThird(usable.map((b) => b.recoveryFailedRate));
  const stall = firstLastThird(usable.map((b) => b.stallRate));

  const signals: RisingSignal[] = [
    { signal: 'ttfa', label: 'TTFA_APPROX p75', from: round(ttfa.from, 0), to: round(ttfa.to, 0), rising: rising(ttfa.from, ttfa.to, PREDICT_TTFA_RISE_MS, PREDICT_TTFA_RISE_REL) },
    { signal: 'media', label: 'Media Error rate', from: round(media.from, 4), to: round(media.to, 4), rising: rising(media.from, media.to, PREDICT_MEDIA_RISE_ABS, PREDICT_MEDIA_RISE_REL) },
    { signal: 'recovery', label: 'Recovery Fail rate', from: round(recov.from, 4), to: round(recov.to, 4), rising: rising(recov.from, recov.to, PREDICT_RECOVERY_RISE_ABS, PREDICT_RECOVERY_RISE_REL) },
    { signal: 'stall', label: 'Stall rate', from: round(stall.from, 4), to: round(stall.to, 4), rising: rising(stall.from, stall.to, PREDICT_STALL_RISE_ABS, PREDICT_STALL_RISE_REL) },
  ];
  const risingCount = signals.filter((s) => s.rising).length;
  const evidence = signals.filter((s) => s.rising).map((s) => `${s.label}: ${s.from} → ${s.to} (상승)`);
  const likelihood: WarningLikelihood = risingCount >= PREDICT_HIGH_SIGNALS ? 'HIGH' : risingCount >= PREDICT_ELEVATED_SIGNALS ? 'ELEVATED' : risingCount >= 1 ? 'LOW' : 'NONE';
  const rec = likelihood === 'HIGH' ? '다중 신호 동반 상승 — 사전 점검/대응 준비 권고(관측·분석만, 자동 조치 없음).'
    : likelihood === 'ELEVATED' ? '2개 신호 상승 — 관찰 강화 및 원인 후보 확인 권고.'
    : likelihood === 'LOW' ? '단일 신호 상승 — 계속 관찰.'
    : '상승 신호 없음 — 정상 범위.';
  return base(likelihood, signals, evidence.length ? evidence : ['상승 신호 없음'], rec);
}

/**
 * Release risk from a new release vs a baseline release. A small store/session sample can never assert
 * fleet risk → INSUFFICIENT_DATA. Risk is a graded label; nothing is blocked or rolled back.
 */
export function computeReleaseRisk(
  current: StreamingQualityResult, baseline: StreamingQualityResult | null, stores: number, fleetStores: number,
): ReleaseRisk {
  const canaryFraction = fleetStores > 0 ? round(stores / fleetStores, 3) : null;
  const build = (band: ReleaseRiskBand, delta: number | null, regressed: number, evidence: string[], rec: string): ReleaseRisk => ({
    release: current.scope, baseline: baseline?.scope ?? null, band, scoreDelta: round(delta, 1),
    regressedCount: regressed, sessions: current.sessions, stores, canaryFraction, evidence, recommendation: rec, ...APPROVAL,
  });

  if (current.sessions < RELEASE_RISK_MIN_SESSIONS || stores < RELEASE_RISK_MIN_STORES || baseline == null || baseline.score == null || current.score == null) {
    return build('INSUFFICIENT_DATA', null, 0, [`sessions ${current.sessions} / stores ${stores} — 위험 단정 불가`], '표본 부족 — 위험 판정 보류, canary 관찰 지속.');
  }
  const reg = computeQualityRegression(baseline, current);
  const delta = current.score - baseline.score; // negative = worse
  const drop = -delta;
  const band: ReleaseRiskBand = drop >= RELEASE_RISK_SCORE_DROP_CRITICAL ? 'CRITICAL'
    : drop >= RELEASE_RISK_SCORE_DROP_HIGH ? 'HIGH'
    : drop >= RELEASE_RISK_SCORE_DROP_WATCH ? 'WATCH' : 'LOW';
  const evidence = [`score ${baseline.score} → ${current.score} (Δ${round(delta, 1)})`, `회귀 지표 ${reg.regressedCount}개`, canaryFraction != null ? `canary 매장 비중 ${(canaryFraction * 100).toFixed(1)}%` : 'fleet 매장 수 미상'];
  const rec = band === 'CRITICAL' || band === 'HIGH' ? '릴리스 품질 위험 — 승격 보류/이전 릴리스 확인 검토 권고(표시만, 자동 차단·롤백 없음).'
    : band === 'WATCH' ? '경미한 품질 저하 — 표본 확대 후 재평가 권고.'
    : '위험 낮음 — 관찰 유지.';
  return build(band, delta, reg.regressedCount, evidence, rec);
}

/**
 * Progressive incident: same-type spike → recovery → spike repetition. ≥PROGRESSIVE_MAJOR_SPIKES spikes
 * → MAJOR (chronic); ≥PROGRESSIVE_MIN_SPIKES → RECURRING; one → SINGLE. Ticks must be time-ordered.
 */
export function detectProgressiveIncident(type: string, ticks: IncidentTick[]): ProgressiveIncident {
  const ordered = [...ticks].filter((t) => t.type === type).sort((a, b) => a.at.localeCompare(b.at));
  const spikes = ordered.filter((t) => t.kind === 'spike').length;
  const recoveries = ordered.filter((t) => t.kind === 'recovery').length;
  const pattern: ProgressivePattern = spikes >= PROGRESSIVE_MAJOR_SPIKES ? 'MAJOR'
    : spikes >= PROGRESSIVE_MIN_SPIKES ? 'RECURRING' : spikes === 1 ? 'SINGLE' : 'NONE';
  const note = pattern === 'MAJOR' ? '동일 유형 반복(Spike→Recovery→Spike) — 만성 장애 가능성, 근본 원인 조사 권고.'
    : pattern === 'RECURRING' ? '동일 유형 재발 — 재발 원인 확인 권고.'
    : pattern === 'SINGLE' ? '단발 발생 — 관찰.' : '해당 유형 스파이크 없음.';
  return {
    type, pattern, spikes, recoveries,
    firstAt: ordered[0]?.at ?? null, lastAt: ordered[ordered.length - 1]?.at ?? null,
    ticks: ordered, note,
  };
}
