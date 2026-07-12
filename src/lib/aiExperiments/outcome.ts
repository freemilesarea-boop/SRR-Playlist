// AI-MUSIC-4 — Experiment Outcome Engine. Compares control vs treatment on the primary + secondary metrics,
// factoring guardrail status, contamination, and per-arm sample sufficiency. NO statistical-significance is
// fabricated — significance is reported as DIRECTIONAL_ONLY (or SIGNIFICANCE_NOT_AVAILABLE). Small samples
// never confirm a winner. Store / Session / Playback counts are kept distinct.

import { clamp, round } from '../observability/math';
import {
  OUTCOME_MIN_SESSIONS_PER_ARM, OUTCOME_MIN_PLAYBACKS_PER_ARM,
  CONFIDENCE_WEIGHTS, CONFIDENCE_FULL_SESSIONS, CONFIDENCE_MAX,
} from './thresholds';
import { METRIC_DEFS, metricValue, computeLift, isMeaningful } from './metrics';
import type {
  ExperimentOutcome, OutcomeClass, MetricValue, GuardrailEvaluation, ContaminationResult, DataState,
} from './types';

export interface OutcomeInput {
  primaryMetric: string;
  primaryControl: number | null;
  primaryTreatment: number | null;
  secondary: Array<{ metric: string; control: number | null; treatment: number | null }>;
  sample: { controlStores: number; treatmentStores: number; controlSessions: number; treatmentSessions: number; controlPlaybacks: number; treatmentPlaybacks: number };
  guardrail: GuardrailEvaluation;
  contamination: ContaminationResult;
  balanceScore: number | null;    // from group design
  signalCoverage: number;         // 0..1
}

function confidence(input: OutcomeInput): number | null {
  const W = CONFIDENCE_WEIGHTS;
  const minSessions = Math.min(input.sample.controlSessions, input.sample.treatmentSessions);
  if (minSessions <= 0) return null;
  const sample = clamp((minSessions / CONFIDENCE_FULL_SESSIONS) * 100, 0, 100);
  const balance = clamp((input.balanceScore ?? 0.5) * 100, 0, 100);
  const guard = input.guardrail.status === 'PASS' ? 100 : input.guardrail.status === 'WARNING' ? 60 : input.guardrail.status === 'NOT_AVAILABLE' ? 40 : 10;
  const coverage = clamp(input.signalCoverage * 100, 0, 100);
  const contam = input.contamination.status === 'CLEAN' ? 100 : input.contamination.status === 'UNKNOWN' ? 50 : input.contamination.status === 'SUSPECTED' ? 40 : 0;
  const parts = [
    { v: sample, w: W.sampleSize }, { v: balance, w: W.balance }, { v: guard, w: W.guardrail },
    { v: coverage, w: W.coverage }, { v: contam, w: W.contamination },
  ];
  const tot = parts.reduce((s, p) => s + p.w, 0);
  return round(clamp(parts.reduce((s, p) => s + p.v * p.w, 0) / tot, 0, CONFIDENCE_MAX), 1);
}

export function computeOutcome(input: OutcomeInput): ExperimentOutcome {
  const primary = metricValue(input.primaryMetric, input.primaryControl, input.primaryTreatment);
  const secondary: MetricValue[] = input.secondary.map((s) => metricValue(s.metric, s.control, s.treatment));
  const lifts = [primary, ...secondary].map((mv) => computeLift(mv.metric, mv.control, mv.treatment));
  const conf = confidence(input);

  // per-arm sample sufficiency (Sessions AND Playbacks distinct)
  const enoughSample =
    Math.min(input.sample.controlSessions, input.sample.treatmentSessions) >= OUTCOME_MIN_SESSIONS_PER_ARM &&
    Math.min(input.sample.controlPlaybacks, input.sample.treatmentPlaybacks) >= OUTCOME_MIN_PLAYBACKS_PER_ARM;

  const dataQuality: DataState = enoughSample ? 'READY' : 'INSUFFICIENT_DATA';
  const notes: string[] = ['Directional only — 통계적 유의성 미산출 (p-value 없음)', 'RECOMMENDATION/SIMULATION only — 실제 배포/그룹배정 없음'];

  let classification: OutcomeClass;
  if (input.contamination.status === 'CONTAMINATED') classification = 'CONTAMINATED';
  else if (!enoughSample) classification = 'INSUFFICIENT_DATA';
  else if (input.guardrail.status === 'FAIL') classification = 'GUARDRAIL_FAILED';
  else if (!isMeaningful(primary)) classification = 'NO_MEANINGFUL_DIFFERENCE';
  else {
    const higherBetter = METRIC_DEFS[input.primaryMetric]?.higherIsBetter ?? true;
    const treatmentUp = (primary.absoluteDelta ?? 0) > 0;
    const treatmentBetter = higherBetter ? treatmentUp : !treatmentUp;
    classification = treatmentBetter ? 'TREATMENT_BETTER' : 'CONTROL_BETTER';
  }
  if (classification === 'INSUFFICIENT_DATA') notes.push('작은 표본 — 승리 Candidate 확정 금지');

  return {
    classification, significance: 'DIRECTIONAL_ONLY',
    primary, secondary, lifts, sample: input.sample,
    guardrail: input.guardrail, contaminationStatus: input.contamination.status,
    dataQuality, confidence: conf, notes,
  };
}
