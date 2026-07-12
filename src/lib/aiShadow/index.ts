// AI-MUSIC-6 — Shadow Playlist Resolution & Runtime Certification. Rule-based (NO LLM/ML). Computes a pilot
// override resolution IN PARALLEL with the authoritative existing resolution and compares them, WITHOUT ever
// changing the real playlist, queue, or playback. The existing result is always used for actual playback; the
// shadow result is analysis/log/dashboard only. Every shadow failure fails OPEN to the existing result. No
// runtime integration is performed — this phase certifies readiness only (max READY_FOR_MANUAL_CANARY_REVIEW;
// no actual canary is started). Every certification output carries automated:false.
export * from './types';
export * from './thresholds';
export { resolveShadow } from './shadowResolver';
export { classifyDivergence } from './divergence';
export { buildShadowEvent, eventName } from './events';
export {
  certifyControlPreservation, certifyTreatmentEligibility, certifyFailOpen,
  computeCoverage, computeCertification, computeReadiness,
} from './certification';
export { getAiShadowConfig, shadowEvaluationAllowed, __resetAiShadowConfig, type AiShadowConfig } from './config';
