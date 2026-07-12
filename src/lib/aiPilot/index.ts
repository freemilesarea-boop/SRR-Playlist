// AI-MUSIC-5 — Approval-Gated Pilot Execution & Safe Rollout Orchestration. Rule-based (NO LLM / NO ML) manual,
// operator-approval-gated orchestration of an approved AI-MUSIC-4 Experiment Plan over a limited Pilot Store
// set. This layer NEVER auto-starts a pilot, auto-assigns a store, auto-deploys a playlist, auto-expands,
// auto-stops, or auto-rolls-back; it NEVER modifies an original playlist, controls the Player, or interrupts
// playback. Outputs are DRAFT / recommendations + a fail-open, version-pinned PREVIEW resolver only. Runtime
// Player/Queue integration is DEFERRED (see the delivery audit). Every result carries requiresApproval:true,
// automated:false, executed:false.
export * from './types';
export * from './thresholds';
export { canTransition, transition, allowedNext, isTerminal } from './stateMachine';
export { computeApproval } from './approvalGate';
export { buildAssignmentSnapshot, verifyImmutable } from './assignmentSnapshot';
export { resolveStorePlaylist } from './overrideResolver';
export { monitorGuardrails } from './guardrailMonitor';
export { classifyWindow, windowForElapsed, nextObservationAt, buildObservationSnapshot, type ObservationInput } from './observation';
export { buildPilotProgress, type ProgressInput } from './progress';
export { evaluateCompletion } from './completion';
export { evaluateExpansion, type ExpansionInput } from './expansion';
export { getAiPilotConfig, __resetAiPilotConfig, type AiPilotConfig } from './config';
