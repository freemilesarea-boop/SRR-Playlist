// WEB-OPS-10 — Unified Operations Platform (Final). Converges the WEB-OBS engines into one read-only
// Command Center layer. NO new Player/Streaming feature; nothing executes, rolls back, or controls the
// Player. Pure, rule-based (NO ML/LLM) summary + workspace helpers.
export * from './types';
export * from './thresholds';
export { computePlatformScore } from './platformScore';
export { computeSlaMetrics, deriveMttrMtbf, type SlaInput } from './sla';
export { buildExecutiveSummary, type ExecSummaryInput } from './executiveSummary';
export { buildCommandTimeline, type CommandTimelineInput } from './commandTimeline';
export { searchPlatform, type SearchableEntity } from './search';
export {
  WIDGET_CATALOG, defaultLayout, normalizeLayout, moveWidget, reorderWidget, updateWidget, addWidget, removeWidget,
} from './workspace';
export { getPlatformConfig, __resetPlatformConfig, type PlatformConfig } from './config';
