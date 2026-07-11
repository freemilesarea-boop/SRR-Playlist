// AI-MUSIC-4 — Explainability v3. Operator-facing rationale for an experiment result — why these stores,
// why the groups are balanced, why the candidate improved/regressed, which metric drove the conclusion,
// which guardrail blocked expansion, and which signals are missing. It surfaces reasons, not raw internals.

import { METRIC_DEFS } from './metrics';
import type { ExperimentOutcome, RolloutRecommendation, ControlTreatmentDesign, ExplainV3, ExplainV3Item } from './types';

export interface ExplainV3Input {
  design: ControlTreatmentDesign | null;
  outcome: ExperimentOutcome | null;
  rollout: RolloutRecommendation | null;
}

export function buildExplainV3(input: ExplainV3Input): ExplainV3 {
  const items: ExplainV3Item[] = [];
  const missing: string[] = [];

  if (input.design) {
    const d = input.design;
    items.push({ question: '왜 Control/Treatment가 균형적인가?', answer: `Session 균형 기반 배분 · balance ${d.balanceScore ?? '—'} · ${d.status}${d.contaminationRisk.length ? ` · 위험: ${d.contaminationRisk.join(', ')}` : ''}` });
  }

  if (input.outcome) {
    const o = input.outcome;
    const pdef = METRIC_DEFS[o.primary.metric];
    items.push({ question: '왜 이 결론인가?', answer: `${o.classification} (${o.significance}) · Primary ${pdef?.label ?? o.primary.metric} Δ ${o.primary.absoluteDelta ?? '—'} · confidence ${o.confidence ?? '—'}` });
    items.push({ question: '어떤 Metric이 결론에 가장 영향을 줬나?', answer: `${pdef?.label ?? o.primary.metric} (${pdef?.numerator ?? '?'} / ${pdef?.denominator ?? '?'})` });
    if (o.guardrail.status === 'FAIL') items.push({ question: '왜 확장이 차단됐나?', answer: `Guardrail FAIL: ${o.guardrail.failed.join(', ')}` });
    else if (o.guardrail.status === 'WARNING') items.push({ question: 'Guardrail 상태는?', answer: `WARNING: ${o.guardrail.warned.join(', ')}` });
    else if (o.guardrail.status === 'NOT_AVAILABLE') missing.push('Guardrail 소스 (streaming/incident) NOT_AVAILABLE');
    if (o.dataQuality !== 'READY') items.push({ question: '표본은 충분한가?', answer: `INSUFFICIENT — control ${o.sample.controlSessions} / treatment ${o.sample.treatmentSessions} sessions (작은 표본으로 확정 금지)` });
    for (const g of o.guardrail.checks) if (g.status === 'NOT_AVAILABLE') missing.push(`${g.label} 신호`);
  }

  if (input.rollout) {
    items.push({ question: '다음 단계 권고는?', answer: `${input.rollout.recommendation} · ${input.rollout.reasons[0] ?? ''} (승인 필요 · 자동 실행 없음)` });
  }

  const summary = input.outcome
    ? `실험 결론: ${input.outcome.classification} · 권고: ${input.rollout?.recommendation ?? 'N/A'} — 모든 결과는 추천이며 자동 실행되지 않습니다.`
    : '실험 설계 단계 — 결과 없음.';

  return { summary, items, missingSignals: [...new Set(missing)] };
}
