// AI-MUSIC-5 — Expansion Approval Workflow. After a successful pilot an operator may consider widening the
// store set — but expansion is ALWAYS a NEW experiment version (newExperimentVersionRequired:true), never an
// in-place scope change, and NEVER a full production rollout (fullProductionRollout:false — out of scope for
// this phase). Every stage requires operator approval; this engine only recommends the next stage.

import type { ExpansionResult, ExpansionStage } from './types';

export interface ExpansionInput {
  pilotCompleted: boolean;                    // must be a cleanly COMPLETED pilot
  outcomePositive: boolean;                   // AI-MUSIC-4 outcome favored treatment
  guardrailsClean: boolean;
  contamination: 'CLEAN' | 'SUSPECTED' | 'CONTAMINATED' | 'UNKNOWN';
  currentStores: number;
  currentStage: ExpansionStage;               // where the workflow is now
  operatorApproved: boolean;                  // approval for the *current* recommended stage
}

export function evaluateExpansion(input: ExpansionInput): ExpansionResult {
  const base = {
    newExperimentVersionRequired: true as const,
    fullProductionRollout: false as const,
    requiresApproval: true as const,
    automated: false as const,
  };
  const reasons: string[] = [];

  if (!input.pilotCompleted) return { ...base, stage: 'NONE', reasons: ['Pilot 미완료 — 확장 불가'] };
  if (input.contamination === 'CONTAMINATED') return { ...base, stage: 'NONE', reasons: ['Contamination — 확장 불가'] };
  if (!input.guardrailsClean) return { ...base, stage: 'NONE', reasons: ['Guardrail 미충족 — 확장 불가'] };
  if (!input.outcomePositive) return { ...base, stage: 'NONE', reasons: ['Outcome 긍정 아님 — 확장 권고 없음'] };

  // Advance one stage at a time, each gated on the operator having approved the previous recommendation.
  switch (input.currentStage) {
    case 'NONE':
      reasons.push('소규모 확장 권고 — 새 Experiment 버전 필요 (자동 확장 아님)');
      return { ...base, stage: 'EXPAND_SMALL_RECOMMENDED', reasons };
    case 'EXPAND_SMALL_RECOMMENDED':
      if (!input.operatorApproved) return { ...base, stage: 'EXPAND_SMALL_RECOMMENDED', reasons: ['소규모 확장 승인 대기'] };
      return { ...base, stage: 'EXPAND_SMALL_APPROVED', reasons: ['소규모 확장 승인됨 — 새 Experiment로 수동 설정'] };
    case 'EXPAND_SMALL_APPROVED':
    case 'EXPAND_SMALL_ACTIVE':
      reasons.push('중규모 확장 권고 — 새 Experiment 버전 필요');
      return { ...base, stage: 'EXPAND_MEDIUM_RECOMMENDED', reasons };
    case 'EXPAND_MEDIUM_RECOMMENDED':
      if (!input.operatorApproved) return { ...base, stage: 'EXPAND_MEDIUM_RECOMMENDED', reasons: ['중규모 확장 승인 대기'] };
      return { ...base, stage: 'EXPAND_MEDIUM_APPROVED', reasons: ['중규모 확장 승인됨 — 새 Experiment로 수동 설정'] };
    case 'EXPAND_MEDIUM_APPROVED':
      reasons.push('수동 롤아웃 준비 상태 — 전체 자동 롤아웃 아님, 운영자 수동 진행');
      return { ...base, stage: 'READY_FOR_MANUAL_ROLLOUT', reasons };
    case 'READY_FOR_MANUAL_ROLLOUT':
      if (!input.operatorApproved) return { ...base, stage: 'READY_FOR_MANUAL_ROLLOUT', reasons: ['수동 롤아웃 승인 대기'] };
      return { ...base, stage: 'MANUAL_ROLLOUT_APPROVED', reasons: ['수동 롤아웃 승인됨 — 새 Experiment 버전으로만 진행'] };
    default:
      return { ...base, stage: 'NONE', reasons: ['추가 확장 단계 없음'] };
  }
}
