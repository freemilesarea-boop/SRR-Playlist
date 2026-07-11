// WEB-OBS-9 — Release Readiness Score. Composes WEB-OBS-7 quality + WEB-OBS-8 reliability / regression /
// coverage / incidents into a 0..100 readiness score and a status label (READY … BLOCK_RECOMMENDED).
// Decision SUPPORT only — READY never triggers a merge/release; a live CRITICAL incident caps at
// BLOCK_RECOMMENDED; below the sample floor → INSUFFICIENT_DATA (no fabricated readiness).

import { clamp, round } from '../observability/math';
import type { StreamingQualityResult } from '../streamingQuality/types';
import type { ReliabilityIndex } from '../streamingOps';
import type { QualityRegression } from '../streamingQuality/analysis';
import {
  READINESS_WEIGHTS, READINESS_READY, READINESS_REVIEW, READINESS_HIGH_RISK,
  READINESS_MIN_SESSIONS, READINESS_MIN_STORES, READINESS_BLOCK_ON_CRITICAL,
} from './thresholds';
import { computeConfidence } from './confidence';
import type { ReleaseReadiness, ReadinessStatus, ReadinessComponent } from './types';

export interface ReadinessInput {
  release: string;
  quality: StreamingQualityResult;
  reliability: ReliabilityIndex;
  regression: QualityRegression | null;
  coverage: number | null;
  stores: number;
  browsers: number;
  criticalIncidents: number;
}

const APPROVAL = { requiresApproval: true, automated: false, remoteControl: false } as const;

export function computeReleaseReadiness(input: ReadinessInput): ReleaseReadiness {
  const { release, quality, reliability, regression, coverage, stores, browsers, criticalIncidents } = input;
  const W = READINESS_WEIGHTS;
  const sessions = quality.sessions;
  const regressed = regression?.regressedCount ?? 0;

  // sub-scores 0..100 (null → dropped)
  const regressionScore = regression == null ? null : clamp(100 - regressed * 22, 0, 100);
  const coverageScore = coverage == null ? null : clamp(coverage * 100, 0, 100);
  const incidentScore = clamp(100 - criticalIncidents * 30, 0, 100);
  const sampleScore = clamp(Math.min(sessions / 200, 1) * 60 + Math.min(stores / READINESS_MIN_STORES, 1) * 40, 0, 100);

  const defs: Array<{ key: string; label: string; weight: number; score: number | null; detail: string }> = [
    { key: 'streamingQuality', label: 'Streaming Quality', weight: W.streamingQuality, score: quality.score, detail: quality.status },
    { key: 'reliability', label: 'Reliability', weight: W.reliability, score: reliability.index, detail: reliability.band },
    { key: 'regression', label: 'Regression', weight: W.regression, score: regressionScore, detail: regression ? `${regressed} regressed` : 'no baseline' },
    { key: 'coverage', label: 'Coverage', weight: W.coverage, score: coverageScore, detail: coverage == null ? 'NO DATA' : `${Math.round(coverage * 100)}%` },
    { key: 'incidentStatus', label: 'Incident Status', weight: W.incidentStatus, score: incidentScore, detail: `${criticalIncidents} critical` },
    { key: 'sampleSufficiency', label: 'Sample Sufficiency', weight: W.sampleSufficiency, score: sampleScore, detail: `${sessions} sess · ${stores} stores` },
  ];
  const components: ReadinessComponent[] = defs.map((d) => ({ key: d.key, label: d.label, score: round(d.score, 1), weight: d.weight, detail: d.detail }));

  const confidence = computeConfidence({ coverage, sessions, stores, browsers }).value;
  const reasons: string[] = [];

  // Sample gate: can't assert readiness on a thin canary.
  if (sessions < READINESS_MIN_SESSIONS || stores < READINESS_MIN_STORES) {
    reasons.push(`표본 부족 (sessions ${sessions} / stores ${stores}) — 준비도 판정 불가`);
    return { release, score: null, status: 'INSUFFICIENT_DATA', components, sessions, stores, criticalIncidents, regressedMetrics: regressed, coverage: round(coverage, 3), confidence, reasons, ...APPROVAL };
  }

  const present = defs.filter((d) => d.score != null);
  const presentWeight = present.reduce((s, d) => s + d.weight, 0);
  const score = presentWeight > 0 ? clamp(present.reduce((s, d) => s + (d.score as number) * d.weight, 0) / presentWeight, 0, 100) : null;

  let status: ReadinessStatus;
  if (score == null) status = 'INSUFFICIENT_DATA';
  else if (READINESS_BLOCK_ON_CRITICAL && criticalIncidents > 0 && score < READINESS_READY) status = score >= READINESS_HIGH_RISK ? 'HIGH_RISK' : 'BLOCK_RECOMMENDED';
  else if (score >= READINESS_READY && criticalIncidents === 0) status = 'READY';
  else if (score >= READINESS_REVIEW) status = 'REVIEW_REQUIRED';
  else if (score >= READINESS_HIGH_RISK) status = 'HIGH_RISK';
  else status = 'BLOCK_RECOMMENDED';

  if (criticalIncidents > 0) reasons.push(`활성 CRITICAL incident ${criticalIncidents}건 — 승격 전 확인 필요`);
  if (regressed >= 2) reasons.push(`회귀 지표 ${regressed}개`);
  if (status === 'READY') reasons.push('지표 양호 — 운영자 승인 시 승격 가능(자동 merge 아님)');

  return { release, score: round(score, 1), status, components, sessions, stores, criticalIncidents, regressedMetrics: regressed, coverage: round(coverage, 3), confidence, reasons, ...APPROVAL };
}
