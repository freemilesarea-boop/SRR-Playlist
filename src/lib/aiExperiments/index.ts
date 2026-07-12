// AI-MUSIC-4 — Controlled Playlist Experimentation & Pilot Rollout Intelligence. Rule-based (NO LLM / NO ML /
// NO stats-significance library) experiment DESIGN & ANALYSIS over the AI-MUSIC-1~3 outputs + READ-ONLY real
// operation data. This is a design/analysis/recommendation system, NOT an execution system: the AI never
// starts a pilot, assigns a store to a group, deploys a playlist, expands, stops, or rolls back. Every output
// is RECOMMENDATION_ONLY / SIMULATION_ONLY / DRAFT / NOT_STARTED / NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA
// with requiresApproval:true, automated:false.
export * from './types';
export * from './thresholds';
export { METRIC_DEFS, metricValue, computeLift, isMeaningful, type MetricDef } from './metrics';
export { computeEligibility } from './eligibility';
export { recommendPilotStores } from './pilotRecommendation';
export { designGroups } from './groupDesign';
export { buildExperimentPlan, type PlanInput } from './experimentPlan';
export { evaluateGuardrails, type GuardrailInput } from './guardrail';
export { detectContamination, type ContaminationInput } from './contamination';
export { computeOutcome, type OutcomeInput } from './outcome';
export { rolloutRecommendation, type RolloutInput } from './rollout';
export { buildLearningFeedback } from './learningFeedback';
export { buildExplainV3, type ExplainV3Input } from './explainV3';
export { getAiExperimentsConfig, __resetAiExperimentsConfig, type AiExperimentsConfig } from './config';
