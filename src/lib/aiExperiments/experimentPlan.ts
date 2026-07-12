// AI-MUSIC-4 — Experiment Plan (Draft). Assembles a DRAFT experiment plan from the recommended groups +
// candidate + metrics. Status stays DRAFT / REVIEW_REQUIRED — nothing is started and no APPROVED status is
// connected to playback this phase. The experimentId is supplied by the caller (deterministic engine).

import {
  PLAN_MIN_SESSIONS, PLAN_MIN_PLAYBACKS, PLAN_MIN_DURATION_DAYS, PLAN_MAX_DURATION_DAYS,
} from './thresholds';
import type { ControlTreatmentDesign, ExperimentPlan, ExperimentStatus } from './types';

export interface PlanInput {
  experimentId: string;
  name: string;
  hypothesis: string;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  targetIndustry: string | null;
  design: ControlTreatmentDesign;
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  confidence: number | null;
}

export function buildExperimentPlan(input: PlanInput): ExperimentPlan {
  const control = input.design.control.members.map((m) => m.storeId);
  const treatment = input.design.treatment.members.map((m) => m.storeId);
  const targetStoreCount = control.length + treatment.length;

  // A plan whose groups are not designable stays REVIEW_REQUIRED (never auto-approved).
  let status: ExperimentStatus;
  if (input.design.status === 'INSUFFICIENT_DATA' || targetStoreCount === 0) status = 'REVIEW_REQUIRED';
  else if (input.design.status === 'CONTAMINATION_RISK' || input.design.status === 'IMBALANCED') status = 'REVIEW_REQUIRED';
  else status = 'DRAFT';

  return {
    experimentId: input.experimentId,
    name: input.name,
    hypothesis: input.hypothesis,
    candidatePlaylistId: input.candidatePlaylistId,
    candidateVersion: input.candidateVersion,
    controlDefinition: 'Control = 기존 Playlist 유지 (변경 없음)',
    treatmentDefinition: 'Treatment = Candidate Preview only (실제 배포/재생 연결 없음)',
    targetIndustry: input.targetIndustry,
    targetStoreCount,
    recommendedControlStores: control,
    recommendedTreatmentStores: treatment,
    primaryMetric: input.primaryMetric,
    secondaryMetrics: input.secondaryMetrics,
    guardrailMetrics: input.guardrailMetrics,
    minimumSessions: PLAN_MIN_SESSIONS,
    minimumPlaybacks: PLAN_MIN_PLAYBACKS,
    minimumDurationDays: PLAN_MIN_DURATION_DAYS,
    maximumDurationDays: PLAN_MAX_DURATION_DAYS,
    stopConditions: ['Guardrail FAIL', 'Streaming 품질 급락', 'Media Error 급증', 'Critical Incident', 'Severe Skip/Dislike 증가', 'Contamination', 'Data Integrity Failure'],
    expansionConditions: ['Primary 개선', 'Guardrail PASS', '충분한 Store/Session/Playback', 'Store 다양성 충족', 'Browser/Device 편향 없음', 'Drift 허용 범위', 'Confidence 임계 충족'],
    contaminationRules: ['동일 Store 양쪽 그룹 금지', '동일 Store 복수 실험 금지', '실험 중 Playlist/Release 변경 시 무효', '동일 Enterprise spillover 표시'],
    confidence: input.confidence,
    status,
    requiresApproval: true,
    automated: false,
  };
}
