// AI-MUSIC-10 — Runtime Boundary Observability Bridge. Rule-based (NO LLM/ML). A READ-ONLY observability layer:
// it publishes the player's runtime boundary state (crossfade/recovery/preload/audio-swap/player stability) to a
// separate, session-scoped store + admin harness so a future safe-boundary decision could READ it. It is an
// OBSERVER, not a controller — it never changes the queue, playback, audio element, or any crossfade/recovery/
// preload logic; observer errors are dropped, never thrown to the player; every snapshot is session-attributed,
// revisioned, and stale/duplicate-protected. `stableForQueueChange=SAFE` means "no observed conflict" — NOT a
// guarantee a queue change would succeed. No runtime queue hook, no candidate application, no canary this phase.
export * from './types';
export { getAiRuntimeBoundaryConfig, isObserverActive, __resetAiRuntimeBoundaryConfig, type AiRuntimeBoundaryConfig } from './config';
export { fnv1aHash } from './hash';
export { evaluateFreshness, isFreshBoundary } from './revision';
export { validateTransition, type SequenceInput } from './sequenceValidator';
export { computeStableBoundary, isStableBoundarySafe } from './stableBoundary';
export { computeBoundaryCoverage } from './coverage';
export { computeHookReadiness } from './readiness';
export { buildBoundaryEvidence, type BoundaryEvidence, type BoundaryEvidenceKind, type BoundaryEvidenceInput } from './evidence';
export {
  initialBoundaryState, applySignal, resetForSession, type BoundaryReducerState,
} from './reducer';
export {
  useRuntimeBoundaryStore, useRuntimeBoundarySnapshot, useRuntimeBoundaryCounters, useRuntimeBoundaryRevisions,
} from './store';
export {
  publishSession, publishCrossfade, publishRecovery, publishPreload, publishAudioSwap, publishPlayerState,
} from './publish';
