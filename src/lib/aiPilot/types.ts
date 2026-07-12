// AI-MUSIC-5 — Approval-Gated Pilot Execution & Safe Rollout Orchestration types. Rule-based (NO LLM/ML)
// manual, approval-gated pilot orchestration over AI-MUSIC-4 plans. This layer NEVER auto-starts a pilot,
// auto-assigns a store, auto-deploys a playlist, auto-expands, auto-stops, or auto-rolls-back. Every
// execution is limited to the operator-approved stores / window / candidate playlist version. It NEVER
// modifies an original playlist, controls the Player, or interrupts playback — a Treatment Override is an
// isolated, fail-open, expiring layer; Control stores get no override. Runtime Player/Queue integration is
// DEFERRED (see the delivery audit) — this phase builds the orchestration + override table + preview resolver.

// ── Pilot execution state machine ──────────────────────────────────────────────
export type PilotState =
  | 'DRAFT' | 'REVIEW_REQUIRED' | 'APPROVED' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED'
  | 'STOP_REQUESTED' | 'STOPPED' | 'COMPLETED' | 'ROLLBACK_REQUESTED' | 'ROLLED_BACK'
  | 'CANCELLED' | 'FAILED' | 'EXPIRED';

export interface TransitionResult { ok: boolean; from: PilotState; to: PilotState; reason: string; }

// ── Approval gate ───────────────────────────────────────────────────────────────
export type ApprovalStatus = 'APPROVED' | 'REJECTED' | 'NEEDS_INVESTIGATION' | 'EXPIRED' | 'INSUFFICIENT_DATA';
export interface ApprovalInput {
  planExists: boolean;
  planStatus: string | null;                 // must be 'APPROVED_FOR_MANUAL_SETUP'
  candidatePlaylistId: string | null;
  candidateVersion: number | null;           // must be pinned (non-null)
  groupsConfirmed: boolean;
  eligibilityRevalidated: boolean;
  duplicateExperiment: boolean;
  streamingGuardrailAvailable: boolean;      // false → NEEDS_INVESTIGATION warning (NOT_AVAILABLE)
  criticalIncident: boolean;
  storeOffline: boolean;
  scheduledStart: number | null;             // epoch ms
  scheduledEnd: number | null;
  rollbackSnapshotExists: boolean;
  approver: string | null;
  reason: string | null;
  expiry: number | null;                     // epoch ms
  nowMs: number;                             // caller-supplied clock (engine is deterministic)
}
export interface Approval {
  status: ApprovalStatus;
  blockingReasons: string[];
  warnings: string[];
  requiresApproval: true;
  automated: false;
  executed: false;                           // approval never triggers activation
}

// ── Immutable assignment snapshot ──────────────────────────────────────────────
export interface AssignmentSnapshotInput {
  experimentId: string;
  storeId: string;
  group: 'control' | 'treatment';
  candidatePlaylistId: string | null;        // treatment only
  candidateVersion: number | null;
  previousPlaylistId: string | null;
  previousPlaylistVersion: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  expiry: number | null;
  rollbackTarget: string | null;
  snapshotVersion: number;
}
export interface AssignmentSnapshot extends AssignmentSnapshotInput {
  assignmentHash: string;                    // stable hash over the immutable fields
}
export const IMMUTABLE_ASSIGNMENT_FIELDS = ['storeId', 'group', 'candidatePlaylistId', 'candidateVersion', 'previousPlaylistId', 'assignmentHash'] as const;
export interface ImmutabilityCheck { ok: boolean; changed: string[]; }

// ── Treatment override + resolution ────────────────────────────────────────────
export type OverrideState = 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'ROLLED_BACK' | 'EXPIRED';
export interface PilotOverride {
  experimentId: string;
  assignmentId: string;
  storeId: string;
  group: 'control' | 'treatment';
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  state: OverrideState;
  start: number | null;
  end: number | null;
  expiry: number | null;
}
export type ResolutionSource = 'PILOT_OVERRIDE' | 'STORE_PLAYLIST' | 'BRAND_ENTERPRISE' | 'FALLBACK' | 'NONE';
export interface StoreResolutionInput {
  storeId: string;
  override: PilotOverride | null;            // the store's current override, if any
  expectedCandidateVersion: number | null;   // for version-pin verification
  storePlaylistId: string | null;
  brandPlaylistId: string | null;
  fallbackPlaylistId: string | null;
  nowMs: number;
}
export interface StoreResolution {
  storeId: string;
  source: ResolutionSource;
  playlistId: string | null;
  version: number | null;
  reason: string;
  conflict: boolean;                         // store in another active pilot / duplicate
  controlPreserved: boolean;                 // true when a control store gets NO override
  failOpen: boolean;                         // true when override lookup was skipped/failed → existing path used
}

// ── Guardrail monitor (recommendation only) ────────────────────────────────────
export type GuardrailMonitorStatus = 'PASS' | 'WARNING' | 'STOP_RECOMMENDED' | 'BLOCKED' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface GuardrailSignals {
  criticalIncident: boolean | null;
  streamingQualityDrop: number | null;       // control - treatment (positive = worse)
  stallIncrease: number | null;
  mediaErrorIncrease: number | null;
  recoveryFailIncrease: number | null;
  skipIncrease: number | null;
  dislikeIncrease: number | null;
  contamination: boolean | null;
  candidateVersionChanged: boolean | null;
  controlPlaylistChanged: boolean | null;
  sampleSufficient: boolean;
}
export interface GuardrailMonitorResult {
  status: GuardrailMonitorStatus;
  triggers: string[];
  recommendation: string;
  automated: false;
  requiresApproval: true;
  executed: false;
}

// ── Observation window ──────────────────────────────────────────────────────────
export type ObservationWindow = 'BASELINE' | 'EARLY' | 'MID' | 'LATE' | 'FINAL';
export interface ObservationSnapshot {
  window: ObservationWindow;
  status: 'READY' | 'NO_DATA' | 'INSUFFICIENT_DATA';
  stores: number; sessions: number; playbacks: number;
  completionRate: number | null; skipRate: number | null; likeRate: number | null; dislikeRate: number | null;
  streamingQualityScore: number | null;      // NOT_AVAILABLE → null
  criticalIncidents: number | null;
  contamination: 'CLEAN' | 'SUSPECTED' | 'CONTAMINATED' | 'UNKNOWN';
  notes: string[];
}

// ── Pilot progress ──────────────────────────────────────────────────────────────
export interface PilotProgress {
  status: 'READY' | 'NO_DATA' | 'INSUFFICIENT_DATA';
  elapsedMs: number | null; remainingMs: number | null;
  storesActive: number; storesExcluded: number; storesOffline: number;
  sessionsCollected: number; playbacksCollected: number;
  primaryMetricProgress: number | null;      // 0..1 toward minimum
  guardrailStatus: GuardrailMonitorStatus;
  confidence: number | null;
  sampleSufficient: boolean;
  contamination: string;
  nextObservationMs: number | null;
}

// ── Completion ──────────────────────────────────────────────────────────────────
export type CompletionStatus = 'COMPLETED' | 'EXTEND_RECOMMENDED' | 'STOP_RECOMMENDED' | 'CONTAMINATED' | 'INSUFFICIENT_DATA';
export interface CompletionInput {
  elapsedMs: number; minDurationMs: number;
  sessions: number; minSessions: number;
  playbacks: number; minPlaybacks: number;
  finalSnapshotExists: boolean;
  criticalGuardrailFailure: boolean;
  contamination: 'CLEAN' | 'SUSPECTED' | 'CONTAMINATED' | 'UNKNOWN';
  operatorApproved: boolean;                 // completion never auto-fires
}
export interface CompletionResult { status: CompletionStatus; reasons: string[]; requiresApproval: true; automated: false; }

// ── Expansion approval workflow ────────────────────────────────────────────────
export type ExpansionStage =
  | 'EXPAND_SMALL_RECOMMENDED' | 'EXPAND_SMALL_APPROVED' | 'EXPAND_SMALL_ACTIVE'
  | 'EXPAND_MEDIUM_RECOMMENDED' | 'EXPAND_MEDIUM_APPROVED'
  | 'READY_FOR_MANUAL_ROLLOUT' | 'MANUAL_ROLLOUT_APPROVED' | 'NONE';
export interface ExpansionResult {
  stage: ExpansionStage;
  newExperimentVersionRequired: true;        // expansion is always a NEW experiment version, never in-place
  fullProductionRollout: false;              // never in this phase
  reasons: string[];
  requiresApproval: true;
  automated: false;
}

// ── Stop kinds ──────────────────────────────────────────────────────────────────
export type StopKind = 'NORMAL_STOP' | 'GUARDRAIL_STOP' | 'OPERATOR_STOP' | 'CONTAMINATION_STOP' | 'INCIDENT_STOP' | 'EXPIRY_STOP';
