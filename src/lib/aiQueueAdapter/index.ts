// AI-MUSIC-8 — Safe Queue Boundary Adapter & Deterministic Runtime Harness. Rule-based (NO LLM/ML). A PURE
// data/decision model + test harness for how a future Preview canary WOULD safely hand a candidate queue to the
// existing player at a safe boundary. It NEVER writes to the real player queue, the audio element, or playback;
// no runtime hook is implemented this phase (deferred). Every simulation preserves the current track + playback
// state, fails open to the existing queue, keeps control stores unchanged, and honors the kill switch (default
// ON). Certification reaches at most READY_FOR_ISOLATED_PREVIEW_HOOK — no real preview runtime application.
export * from './types';
export * from './thresholds';
export { validateCommand, priorityForSource, type CommandContext } from './commandContract';
export { evaluateBoundary } from './boundary';
export { arbitrate } from './arbitration';
export { evaluateFreshness, isFresh } from './freshness';
export { createPending, canPendingTransition, transitionPending } from './pending';
export { getAiQueueAdapterConfig, __resetAiQueueAdapterConfig, type AiQueueAdapterConfig } from './config';
