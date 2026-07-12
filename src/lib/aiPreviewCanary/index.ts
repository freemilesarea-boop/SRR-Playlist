// AI-MUSIC-7 — Preview Runtime Canary & Internal Test Store Certification. Rule-based (NO LLM/ML). Connects an
// approved pilot candidate to the REAL runtime path ONLY in a Preview deployment, ONLY for an explicitly
// allowlisted internal test store, ONLY for an operator-approved ACTIVE canary session, and ONLY at a safe next
// boundary. It NEVER runs in production, never touches a general/franchise/enterprise store, never changes a
// control store, never controls the Player (no play/pause/load/currentTime/volume), never force-stops a playing
// track, and never changes an original playlist. Every failure fails OPEN to the existing result. Certification
// is for INTERNAL PREVIEW only (production readiness maxes at READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST); no
// production canary is executed. Actual runtime queue application is DEFERRED (see the audit + docs).
export * from './types';
export * from './thresholds';
export { evaluateEnvironmentGate, environmentAllowsCanary } from './environment';
export { checkAllowlist, isAllowlisted } from './allowlist';
export { canTransition, transition, allowedNext, isTerminal } from './stateMachine';
export { computeCanaryApproval } from './approvalGate';
export { validateCandidateQueue } from './candidateQueue';
export { buildExistingQueueSnapshot } from './snapshots';
export { resolveCanary } from './canaryResolver';
export { evaluateGuardrails } from './guardrails';
export { computePreviewCertification, computeProductionReadiness } from './certification';
export { getAiPreviewCanaryConfig, __resetAiPreviewCanaryConfig, type AiPreviewCanaryConfig } from './config';
