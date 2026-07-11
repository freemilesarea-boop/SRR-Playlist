// AI-MUSIC-3 — Discovery Expansion. Rule-gated stage ladder Pilot → Small Group → Medium → Large → Global
// Recommendation. A track only *recommends* advancing when its pilot completion is high and skip is low;
// advancement is never automatic (requiresApproval:true, automated:false) — operator approval required.

import { EXPANSION_ORDER, EXPANSION_MIN_PLAYS, EXPANSION_ADVANCE_COMPLETION, EXPANSION_ADVANCE_SKIP_MAX } from './thresholds';
import type { DiscoveryExpansionInput, DiscoveryExpansion, ExpansionStage } from './types';

function nextStage(stage: ExpansionStage): ExpansionStage {
  const i = EXPANSION_ORDER.indexOf(stage);
  return i < 0 || i >= EXPANSION_ORDER.length - 1 ? stage : EXPANSION_ORDER[i + 1];
}

export function evaluateExpansion(input: DiscoveryExpansionInput): DiscoveryExpansion {
  const base = { trackId: input.trackId, title: input.title, currentStage: input.stage, requiresApproval: true as const, automated: false as const };
  if (input.plays < EXPANSION_MIN_PLAYS) {
    return { ...base, status: 'INSUFFICIENT_DATA', recommendedStage: input.stage, advance: false, reason: `표본 부족 (${input.plays} < ${EXPANSION_MIN_PLAYS})` };
  }
  const completion = input.completionRate ?? 0;
  const skip = input.skipRate ?? 1;
  const eligible = completion >= EXPANSION_ADVANCE_COMPLETION && skip <= EXPANSION_ADVANCE_SKIP_MAX && input.stage !== 'GLOBAL_RECOMMENDATION';
  const recommendedStage = eligible ? nextStage(input.stage) : input.stage;
  const reason = eligible
    ? `완주율 ${(completion * 100).toFixed(0)}% · 스킵 ${(skip * 100).toFixed(0)}% → ${recommendedStage} 확대 권고 (승인 필요)`
    : input.stage === 'GLOBAL_RECOMMENDATION' ? '최종 단계 — 확대 없음' : '기준 미달 — 현 단계 유지';
  return { ...base, status: 'READY', recommendedStage, advance: eligible, reason };
}
