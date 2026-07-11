// WEB-OPS-10 — Unified Operations Platform shared types. Everything here is a read-only summary composed
// from the WEB-OBS engines. No execution, no remote control, no Player/Streaming change.

// ── Global Health KPIs (top of the Command Center) ──────────────────────────
export interface GlobalHealth {
  platformAvailability: number | null;   // 0..100
  streamingReliability: number | null;   // 0..100
  enterpriseHealth: number | null;       // 0..100 (avg brand score)
  storeAvailability: number | null;      // 0..100
  criticalIncidents: number;
  openRecommendations: number;
  releaseReadiness: string;              // best/blocking readiness label
  governanceQueue: number;
}

// ── Platform Score ────────────────────────────────────────────────────────────
export type PlatformBand = 'EXCELLENT' | 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';
export interface PlatformComponent { key: string; label: string; score: number | null; weight: number; detail: string; }
export interface PlatformScore {
  score: number | null;                  // 0..100, null → INSUFFICIENT_DATA
  band: PlatformBand;
  components: PlatformComponent[];
  coverage: number;                      // present weight / total weight
  sessions: number;
}

export interface PlatformScoreInput {
  availability: number | null;           // 0..100
  streaming: number | null;              // 0..100 (streaming quality score)
  reliability: number | null;            // 0..100
  governanceOpen: number;
  criticalIncidents: number;
  highIncidents: number;
  coverage: number | null;               // 0..1
  confidence: number | null;             // 0..100
  sessions: number;
}

// ── SLA metrics ────────────────────────────────────────────────────────────────
export type SlaStatus = 'OK' | 'AT_RISK' | 'BREACHED' | 'INSUFFICIENT_DATA';
export interface SlaMetrics {
  availability: number | null;           // 0..100
  recoveryRate: number | null;           // 0..1
  incidentRate: number | null;           // incidents / 1k sessions
  errorBudgetRemaining: number | null;   // 0..1 (fraction of budget left)
  mttrMinutes: number | null;            // mean time to resolve (from governance timeline); null → INSUFFICIENT
  mtbfHours: number | null;              // mean time between incidents; null → INSUFFICIENT
  status: SlaStatus;
  notes: string[];
}

// ── Executive Summary (rule-based bullets) ──────────────────────────────────
export type SummaryTone = 'good' | 'watch' | 'bad' | 'info';
export interface SummaryLine { tone: SummaryTone; text: string; }
export interface ExecutiveSummary { window: string; lines: SummaryLine[]; headline: string; dataSufficient: boolean; }

// ── Command Timeline (merged operational events) ────────────────────────────
export type CommandStage = 'RELEASE' | 'STREAMING' | 'INCIDENT' | 'RECOMMENDATION' | 'APPROVAL' | 'OBSERVATION' | 'RESOLVED';
export interface CommandEvent { at: string; stage: CommandStage; label: string; detail: string; actor: string | null; }

// ── Store Digital Twin (read-only composite) ────────────────────────────────
export interface TwinTimeline { key: string; label: string; steps: Array<{ at: string; label: string; detail: string; severity: string }>; }
export interface StoreDigitalTwin { store: string; timelines: TwinTimeline[]; }

// ── Unified Search ────────────────────────────────────────────────────────────
export type SearchKind = 'store' | 'enterprise' | 'incident' | 'release' | 'recommendation' | 'approval' | 'decision';
export interface SearchResult { kind: SearchKind; id: string; label: string; detail: string; }

// ── Unified Filters (shared across dashboards) ──────────────────────────────
export interface UnifiedFilters {
  window: '1h' | '24h' | '7d' | '30d';
  enterprise: string | null;
  brand: string | null;
  store: string | null;
  release: string | null;
  browser: string | null;
  device: string | null;
  severity: string | null;
}

// ── Workspace / Widget system ────────────────────────────────────────────────
export type WidgetType = 'streaming' | 'incidents' | 'fleet' | 'enterprise' | 'recommendations' | 'timeline' | 'release' | 'executive' | 'platformScore' | 'sla' | 'reliability';
export type WidgetSize = 'S' | 'M' | 'L';
export interface WidgetConfig { id: string; type: WidgetType; size: WidgetSize; collapsed: boolean; favorite: boolean; }
export interface WorkspaceLayout { name: string; widgets: WidgetConfig[]; isDefault: boolean; }
export interface OperationsPreferences { defaultWindow: string; defaultFilters: Partial<UnifiedFilters>; }

// ── Persisted workspace rows (from 0463 RPCs) ───────────────────────────────
export interface SavedWorkspace { id: string; name: string; layout: WorkspaceLayout; isDefault: boolean; updatedAt: string; }
