// WEB-OBS-8 — Shared operations-intelligence types. The engines consume WEB-OBS-7 aggregates/results
// (QualityAggregate / StreamingQualityResult) plus two new read-only shapes produced by the 0461 RPCs:
//   • SqEventRow — a bucketed, PII-free single quality event (for Replay + Root-Cause evidence).
//   • SqTimeBucket — a per-time-bucket mini-aggregate (for Predictive / Trend / Fleet-replay).
// Every classifier degrades to NOT_AVAILABLE / INSUFFICIENT_DATA rather than fabricating.

import type { Confidence } from '../observability/release';

// ── Raw-ish inputs (from 0461 RPCs, already bucketed + PII-free) ─────────────

/** One quality event, ordered within a session/store. No track title / URL / user id — hash + codes only. */
export interface SqEventRow {
  eventType: string;               // first_progress | crossfade_* | preload_* | media_error | recovery_*
  occurredAt: number;              // client ms epoch (occurred_at); 0 when unknown
  receivedAt: string;              // server timestamptz iso (authoritative ordering)
  sessionId: string;               // opaque player_session_id
  trackHash: string | null;        // non-reversible current_track_hash
  durationMs: number | null;
  outcome: string | null;          // success | failed | fallback | aborted | progress
  reason: string | null;
  mediaCode: number | null;        // 0..4
  networkState: number | null;     // 0..3
  readyState: number | null;       // 0..4
  browser?: string;
  release?: string;
}

/** A per-time-bucket mini-aggregate (server pre-aggregated). Rates are fractions or null (no data). */
export interface SqTimeBucket {
  bucketStart: string;             // iso start of the bucket
  sessions: number;
  ttfaP75: number | null;          // TTFA_APPROX p75 (ms)
  startSuccessRate: number | null;
  mediaErrorRate: number | null;   // media-error sessions / sessions
  stallRate: number | null;
  recoveryFailedRate: number | null; // recovery_failed / recovery_attempted
  score: number | null;            // optional pre-computed score (else engine derives)
}

// ── Streaming Reliability Index ──────────────────────────────────────────────
export type ReliabilityBand = 'EXCELLENT' | 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'CRITICAL' | 'INSUFFICIENT_DATA';
export interface ReliabilitySub { key: string; label: string; score: number | null; weight: number; detail: string; }
export interface ReliabilityIndex {
  scope: string;
  index: number | null;            // 0..100, null → INSUFFICIENT_DATA
  band: ReliabilityBand;
  subs: ReliabilitySub[];          // present sub-components (NO_DATA dropped)
  coverage: number;                // present weight / total weight
  confidence: Confidence;
}

// ── Signal coverage ──────────────────────────────────────────────────────────
export type CoverageLevel = 'GOOD' | 'FAIR' | 'LOW' | 'NONE';
export interface SignalCoverage { signal: string; label: string; observed: number; expected: number; ratio: number | null; level: CoverageLevel; }
export interface CoverageReport { scope: string; signals: SignalCoverage[]; overall: number | null; }

// ── Quality matrix (browser / device / os) ──────────────────────────────────
export type MatrixDimension = 'browser' | 'device' | 'os';
export interface MatrixCell {
  value: string;                   // e.g. 'chrome', 'ios', 'desktop'
  sessions: number;
  ttfaP75: number | null;
  mediaErrorRate: number | null;
  stallRate: number | null;
  recoverySuccessRate: number | null;
  crossfadeCompletionRate: number | null;
  score: number | null;
  status: string;                  // reuse QualityStatus label or INSUFFICIENT_DATA
  insufficient: boolean;
}
export interface QualityMatrix {
  dimension: MatrixDimension;
  cells: MatrixCell[];
  worstCell: string | null;
  concentration: { signal: string; value: string; share: number } | null; // one cell dominating a problem
}

// ── Heatmaps ──────────────────────────────────────────────────────────────────
export interface ReleaseHeatRow {
  release: string;
  sessions: number;
  stores: number;
  score: number | null;
  status: string;
  scoreDelta: number | null;       // vs baseline release
  regression: 'REGRESSED' | 'IMPROVED' | 'STABLE' | 'INSUFFICIENT_DATA';
  incidents: number;
  confidence: Confidence;
}
export interface ReleaseHeatmap { rows: ReleaseHeatRow[]; baseline: string | null; }

export interface EnterpriseHeatRow {
  brand: string;
  stores: number;
  sessions: number;
  score: number | null;
  status: string;
  mediaErrorRate: number | null;
  recoverySuccessRate: number | null;
  availability: number | null;
}
export type EnterpriseHeatmap =
  | { available: true; rows: EnterpriseHeatRow[] }
  | { available: false; reason: string };  // NOT_AVAILABLE when no brand↔store mapping

// ── Predictive warning ────────────────────────────────────────────────────────
export type WarningLikelihood = 'HIGH' | 'ELEVATED' | 'LOW' | 'NONE' | 'INSUFFICIENT_DATA';
export interface RisingSignal { signal: string; label: string; from: number | null; to: number | null; rising: boolean; }
export interface PredictiveWarning {
  scope: string;
  likelihood: WarningLikelihood;
  risingCount: number;
  signals: RisingSignal[];
  horizon: string;                 // human horizon description
  evidence: string[];
  recommendation: string;          // observe/prepare — NEVER an automated action
  requiresApproval: true;
  automated: false;
  remoteControl: false;
}

// ── Release risk ──────────────────────────────────────────────────────────────
export type ReleaseRiskBand = 'CRITICAL' | 'HIGH' | 'WATCH' | 'LOW' | 'INSUFFICIENT_DATA';
export interface ReleaseRisk {
  release: string;
  baseline: string | null;
  band: ReleaseRiskBand;
  scoreDelta: number | null;
  regressedCount: number;
  sessions: number;
  stores: number;
  canaryFraction: number | null;   // stores(release)/stores(fleet), when known
  evidence: string[];
  recommendation: string;
  requiresApproval: true;
  automated: false;
  remoteControl: false;
}

// ── Progressive incident ──────────────────────────────────────────────────────
export type ProgressivePattern = 'MAJOR' | 'RECURRING' | 'SINGLE' | 'NONE';
export interface IncidentTick { at: string; type: string; kind: 'spike' | 'recovery'; scope: string; }
export interface ProgressiveIncident {
  type: string;
  pattern: ProgressivePattern;
  spikes: number;
  recoveries: number;
  firstAt: string | null;
  lastAt: string | null;
  ticks: IncidentTick[];
  note: string;
}

// ── Quality trend ─────────────────────────────────────────────────────────────
export type TrendDirection = 'IMPROVING' | 'STABLE' | 'DEGRADING' | 'INSUFFICIENT_DATA';
export interface TrendPoint { at: string; score: number | null; sessions: number; }
export interface QualityTrend {
  granularity: string;
  points: TrendPoint[];
  direction: TrendDirection;
  firstScore: number | null;
  lastScore: number | null;
  delta: number | null;
}

// ── Replay (playback / store / fleet) ────────────────────────────────────────
export type ReplayKind = 'request' | 'playing' | 'progress' | 'crossfade' | 'preload' | 'stall'
  | 'recovery' | 'recovered' | 'error' | 'fleet-snapshot';
export interface ReplayStep {
  at: string;
  kind: ReplayKind;
  label: string;
  detail: string;
  sessionId?: string;
  severity: 'info' | 'warn' | 'error' | 'good';
}
export interface PlaybackReplay { scope: string; steps: ReplayStep[]; truncated: boolean; }

export interface FleetSnapshot { bucketStart: string; healthy: number; waiting: number; recovering: number; error: number; total: number; }
export interface FleetReplay { steps: ReplayStep[]; snapshots: FleetSnapshot[]; truncated: boolean; }

// ── Root-cause evidence chain ─────────────────────────────────────────────────
export type RootCauseVerdict =
  | 'MEDIA_DECODER' | 'NETWORK' | 'AUTOPLAY_BLOCKED' | 'STALL_BUFFERING' | 'RECOVERY_FAILURE'
  | 'CROSSFADE_FALLBACK' | 'UNKNOWN';
export interface EvidenceLink { at: string; signal: string; observed: string; }
export interface RootCauseEvidence {
  scope: string;
  verdict: RootCauseVerdict;
  confidence: number | null;       // 0..ROOTCAUSE_MAX_CONFIDENCE, null → INSUFFICIENT_DATA
  chain: EvidenceLink[];
  summary: string;
  caveat: string;                  // e.g. media error ≠ proven network failure
}
