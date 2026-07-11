// AI-MUSIC-3 — Adaptive Music Intelligence & Continuous Learning. Rule-based (NO LLM, NO RL model) learning
// loop over the AI-MUSIC-1/2 outputs + READ-ONLY real operation data. Every output is a Recommendation —
// the AI never changes the real Player / Playback / Queue / Playlist / ranking / settlement. Operator
// approval is required before any real change (requiresApproval:true, automated:false).
export * from './types';
export * from './thresholds';
export { computeReinforcement } from './reinforcement';
export { computeAdaptiveScore } from './adaptiveScore';
export { computeTrackReputation } from './reputation';
export { buildEvolution } from './evolution';
export { explorationPlan } from './exploration';
export { evaluateExpansion } from './discoveryExpansion';
export {
  seasonalLearning, timeLearning, industryLearning, buildSegmentLearning, seasonForMonth, dayPartForHour,
  SEASONS, DAY_PARTS,
} from './segmentLearning';
export { computePlaylistDrift } from './drift';
export { buildExplainV2, type ExplainV2Input } from './explainV2';
export { runLearningLoop, type LearningLoopInput } from './learningLoop';
export { getAiLearningConfig, __resetAiLearningConfig, type AiLearningConfig } from './config';
