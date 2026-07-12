// AI-MUSIC-9 — Isolated Preview Queue Hook & Single-Store Runtime Proof. Rule-based (NO LLM/ML). A PURE
// data/decision model + test harness for how an isolated Preview runtime hook WOULD hand a candidate queue to
// the existing player at a safe boundary in a SINGLE internal test store — WITHOUT touching the real player
// queue, the audio element, or playback. The runtime hook is DEFERRED this phase (Go/No-Go = NO-GO): no internal
// test store, the Preview canary migration is not applied (resolver uncallable), and crossfade/recovery/preload
// boundary state lives in Player.tsx component-local refs and is NOT observable from store state without
// modifying the forbidden Player.tsx. Every model output carries actualPlayerControl:false, directAudioMutation:
// false, automated:false, previewOnly:true. Certification cannot exceed NOT_RUN without real runtime evidence.
export * from './types';
export * from './thresholds';
export { getAiRuntimeHookConfig, __resetAiRuntimeHookConfig, type AiRuntimeHookConfig } from './config';
export { validateTestStore, isTestStoreValid, type TestStoreContext } from './storeContract';
export { computeQueueOnlyMutation } from './queueOnlyAdapter';
export { createReservation, canReservationTransition, transitionReservation } from './reservation';
export { resolveRuntimeArbitration } from './runtimeArbitration';
export { checkCurrentTrackPreservation, checkPlaybackStatePreservation } from './preservation';
export { runFailOpen, type FailOpenInput } from './failOpen';
export { evaluateGuardrails } from './guardrails';
export { buildEvidence, type EvidenceInput } from './evidence';
export { evaluateRollback } from './rollback';
export { evaluateRuntimeHook } from './hookContract';
export { computeSingleStoreCertification, computeProductionCrReadiness } from './certification';
export { evaluateGoNoGo, type GoNoGoInput } from './feasibility';
