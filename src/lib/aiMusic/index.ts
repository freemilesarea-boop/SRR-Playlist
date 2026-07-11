// AI-MUSIC-1 — Intelligent Music OS Foundation. Rule-based (NO LLM, NO generative AI) music-operations
// engines over READ-ONLY existing telemetry + store learning + track metadata. Every output is a
// Recommendation or a Simulation — the AI never auto-deploys a playlist or executes an operating policy.
export * from './types';
export * from './thresholds';
export { computeStoreProfile } from './storeProfile';
export { computeTrackProfile } from './trackProfile';
export { computeCompatibility } from './compatibility';
export { analyzePlaylist } from './playlistIntelligence';
export { computeLearningProfile } from './learning';
export { musicDirectorPlan, allDirectorRuleTypes } from './director';
export { computeAiConfidence } from './confidence';
export { buildMusicRecommendations, type RecommendationInput } from './recommendation';
export { simulatePlaylist, type SimulationInput } from './simulation';
export { evaluateDiscovery, type DiscoveryInput } from './discovery';
export { getAiMusicConfig, __resetAiMusicConfig, type AiMusicConfig } from './config';
