// AI-MUSIC-4 — Rollout Recommendation + Stop/Continue/Expand rules. RULE-based. Produces a recommendation
// only — never executes a rollout, expansion, stop, or rollback (automated:false, requiresApproval:true,
// remoteControl:false, actualDeployment:false). A good primary metric alone never justifies expansion — the
// guardrail must also PASS. Store / Session / Playback counts stay distinct.

import { clamp, round } from '../observability/math';
import {
  ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM, ROLLOUT_EXPAND_MEDIUM_SESSIONS_PER_ARM, ROLLOUT_READY_SESSIONS_PER_ARM,
  ROLLOUT_EXPAND_MIN_INDUSTRIES, OUTCOME_MIN_SESSIONS_PER_ARM,
} from './thresholds';
import type { ExperimentOutcome, RolloutRecommendation, RolloutClass } from './types';

export interface RolloutInput {
  outcome: ExperimentOutcome;
  industriesCovered: number;
  browserBias: boolean;          // treatment dominated by one browser
  deviceBias: boolean;
  driftWithinTolerance: boolean;
}

export function rolloutRecommendation(input: RolloutInput): RolloutRecommendation {
  const o = input.outcome;
  const minSessions = Math.min(o.sample.controlSessions, o.sample.treatmentSessions);
  const reasons: string[] = [];
  const risks: string[] = [];
  const supportingMetrics: string[] = [o.primary.metric];
  const base = {
    guardrails: o.guardrail.status, confidence: o.confidence,
    automated: false as const, requiresApproval: true as const, remoteControl: false as const, actualDeployment: false as const,
  };

  // ── Stop / rollback (safety-first) ──
  if (o.classification === 'CONTAMINATED') {
    return { ...base, recommendation: 'DO_NOT_ROLLOUT', reasons: ['오염된 실험 — 결과 신뢰 불가'], risks: ['Contamination'], supportingMetrics, suggestedNextSample: null, suggestedNextDurationDays: null };
  }
  if (o.guardrail.status === 'FAIL' || o.classification === 'GUARDRAIL_FAILED') {
    return { ...base, recommendation: 'ROLLBACK_RECOMMENDED', reasons: [`Guardrail FAIL: ${o.guardrail.failed.join(', ')}`, 'Primary 개선과 무관하게 확장 금지'], risks: ['Streaming/안정성 악화'], supportingMetrics, suggestedNextSample: null, suggestedNextDurationDays: null };
  }
  if (o.classification === 'CONTROL_BETTER') {
    return { ...base, recommendation: 'DO_NOT_ROLLOUT', reasons: ['Control 우위 — Candidate 개선 없음'], risks: ['성과 하락'], supportingMetrics, suggestedNextSample: null, suggestedNextDurationDays: null };
  }

  // ── Insufficient data → continue / hold ──
  if (o.classification === 'INSUFFICIENT_DATA' || o.dataQuality !== 'READY') {
    const need = Math.max(OUTCOME_MIN_SESSIONS_PER_ARM - minSessions, OUTCOME_MIN_SESSIONS_PER_ARM);
    return { ...base, recommendation: 'INSUFFICIENT_DATA', reasons: ['표본 부족 — 판단 보류'], risks: ['조기 확정 위험'], supportingMetrics, suggestedNextSample: { sessions: need, playbacks: need * 5 }, suggestedNextDurationDays: 7 };
  }
  if (o.classification === 'NO_MEANINGFUL_DIFFERENCE') {
    return { ...base, recommendation: 'CONTINUE_PILOT', reasons: ['유의미한 차이 미검출 — 관찰 지속'], risks: ['효과 미미'], supportingMetrics, suggestedNextSample: { sessions: ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM, playbacks: ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM * 5 }, suggestedNextDurationDays: 7 };
  }

  // ── Treatment better: gate expansion on guardrail + diversity + bias + drift ──
  const guardOk = o.guardrail.status === 'PASS';
  if (input.browserBias) risks.push('Browser 편향');
  if (input.deviceBias) risks.push('Device 편향');
  if (!input.driftWithinTolerance) risks.push('Drift 허용 범위 초과');
  if (o.guardrail.status === 'WARNING') risks.push(`Guardrail WARNING: ${o.guardrail.warned.join(', ')}`);
  if (o.guardrail.status === 'NOT_AVAILABLE') risks.push('Guardrail 소스 NOT_AVAILABLE — 확장 신중');

  const diversityOk = input.industriesCovered >= ROLLOUT_EXPAND_MIN_INDUSTRIES;
  const biasFree = !input.browserBias && !input.deviceBias && input.driftWithinTolerance;

  let recommendation: RolloutClass;
  if (!guardOk || !diversityOk || !biasFree) {
    recommendation = 'CONTINUE_PILOT';
    reasons.push('Primary 개선 관찰 — 단, 확장 전 조건 미충족 (Guardrail/다양성/편향/Drift)');
  } else if (minSessions >= ROLLOUT_READY_SESSIONS_PER_ARM) {
    recommendation = 'READY_FOR_MANUAL_ROLLOUT';
    reasons.push('충분한 표본 + Guardrail PASS + 다양성/편향 조건 충족 — 수동 Rollout 준비 (승인 필요)');
  } else if (minSessions >= ROLLOUT_EXPAND_MEDIUM_SESSIONS_PER_ARM) {
    recommendation = 'EXPAND_MEDIUM';
    reasons.push('개선 + Guardrail PASS — 중간 규모 확대 권고');
  } else if (minSessions >= ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM) {
    recommendation = 'EXPAND_SMALL';
    reasons.push('개선 + Guardrail PASS — 소규모 확대 권고');
  } else {
    recommendation = 'CONTINUE_PILOT';
    reasons.push('개선 관찰되나 표본 부족 — Pilot 지속');
  }

  const nextSessions = recommendation === 'EXPAND_SMALL' ? ROLLOUT_EXPAND_MEDIUM_SESSIONS_PER_ARM
    : recommendation === 'EXPAND_MEDIUM' ? ROLLOUT_READY_SESSIONS_PER_ARM
    : ROLLOUT_EXPAND_MIN_SESSIONS_PER_ARM;

  return {
    ...base, recommendation, reasons, risks,
    supportingMetrics: [o.primary.metric, ...o.secondary.slice(0, 2).map((s) => s.metric)],
    suggestedNextSample: { sessions: nextSessions, playbacks: nextSessions * 5 }, suggestedNextDurationDays: 14,
    confidence: round(clamp(o.confidence ?? 0, 0, 90), 1),
  };
}
