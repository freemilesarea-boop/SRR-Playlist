// WEB-OBS-8 — Intelligent Operations & Predictive Streaming Analytics. Pure, rule-based (NO ML/LLM)
// engines over the WEB-OBS-7 telemetry. Observation + analysis ONLY — no playback/Player/queue control.
export * from './types';
export * from './thresholds';
export { computeReliabilityIndex } from './reliability';
export { computeSignalCoverage } from './coverage';
export { buildQualityMatrix, type DimAggregate } from './matrix';
export { buildReleaseHeatmap, buildEnterpriseHeatmap, type ReleaseAgg, type BrandGroup } from './heatmap';
export { buildQualityTrend } from './trend';
export { computePredictiveWarning, computeReleaseRisk, detectProgressiveIncident } from './predictive';
export { buildPlaybackReplay, buildFleetReplay } from './replay';
export { buildRootCauseEvidence } from './rootCause';
