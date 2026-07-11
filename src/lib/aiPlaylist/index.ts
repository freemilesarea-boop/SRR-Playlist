// AI-MUSIC-2 — Intelligent Playlist Generation & Optimization. Rule-based (NO LLM) playlist BUILDER over the
// READ-ONLY AI-MUSIC-1 profiles/compatibility + industry/time/energy-curve/fatigue rules. Every output is a
// proposal or simulation — the AI never writes to any real playlist / queue / player. Operator approval is
// required before any real change (requiresApproval:true, automated:false, simulationOnly:true).
export * from './types';
export * from './thresholds';
export { resolveTimeSlot, allTimeSlots, TIME_SLOTS } from './timeIntelligence';
export { industryPlaylistRule, allIndustryRuleTypes } from './industryIntelligence';
export { targetEnergyCurve, scoreEnergyCurve, targetEnergyAt } from './energyCurve';
export { fatigueFactor, playlistFatigueRisk } from './fatiguePrevention';
export { measureDiversity, localDestreak, optimizeDiversity, type DiversityMetrics } from './diversityOptimizer';
export { computePlaylistBuildConfidence } from './confidence';
export { buildPlaylist } from './playlistBuilder';
export { compareCandidates } from './candidateComparison';
export { getAiPlaylistConfig, __resetAiPlaylistConfig, type AiPlaylistConfig } from './config';
