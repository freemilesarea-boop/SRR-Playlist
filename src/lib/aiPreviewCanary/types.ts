// AI-MUSIC-7 — Preview Runtime Canary & Internal Test Store Certification types. Rule-based (NO LLM/ML).
// Connects an approved pilot candidate to the REAL runtime path, but ONLY in a Preview deployment, ONLY for an
// explicitly allowlisted internal test store, ONLY for an operator-approved ACTIVE canary session, and ONLY at
// a safe next boundary. It NEVER runs in production, never touches a general/franchise/enterprise store, never
// changes a control store, never controls the Player (no play/pause/load/currentTime/volume), never force-stops
// a playing track, and never changes an original playlist. Every failure fails OPEN to the existing result.
// This phase certifies for INTERNAL PREVIEW only (max production readiness = READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST);
// no production canary is executed. Actual runtime queue application is DEFERRED (see the audit).

// ── Environment enforcement ────────────────────────────────────────────────────
export type EnvEnforcement = 'ENFORCED' | 'PARTIAL' | 'UNSAFE' | 'NOT_AVAILABLE';
export interface EnvContext {
  mode: string | null;                 // import.meta.env.MODE
  appEnv: string | null;               // VITE_AI_PREVIEW_CANARY_ENV (must be 'preview')
  currentDeploymentId: string | null;  // VITE_AI_PREVIEW_CANARY_DEPLOYMENT_ID
  allowedDeploymentId: string | null;  // VITE_AI_PREVIEW_CANARY_ALLOWED_DEPLOYMENT_ID
  isProductionHost: boolean;           // heuristic: host looks like a production host
}
export interface EnvGateResult {
  status: EnvEnforcement;
  isPreview: boolean;
  deploymentMatches: boolean;
  reasons: string[];
}

// ── Internal test store allowlist ──────────────────────────────────────────────
export interface AllowlistEntry {
  storeId: string;
  environment: 'preview';              // production is never allowed
  purpose: string;
  approvedBy: string | null;
  approvedAt: number | null;
  expiresAt: number | null;
  enabled: boolean;
  maxSessions: number;
  allowedCandidatePlaylistId: string | null;
  allowedCandidateVersion: number | null;
  notes: string | null;
}
export type AllowlistStatus = 'ALLOWED' | 'NOT_ALLOWED' | 'EXPIRED' | 'DISABLED' | 'ENV_MISMATCH' | 'CANDIDATE_OUT_OF_SCOPE' | 'SESSION_CAP_REACHED';
export interface AllowlistCheckInput {
  entry: AllowlistEntry | null;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  activeSessions: number;
  nowMs: number;
}
export interface AllowlistCheckResult { status: AllowlistStatus; reasons: string[]; }

// ── Canary state machine ────────────────────────────────────────────────────────
export type CanaryState =
  | 'DRAFT' | 'REVIEW_REQUIRED' | 'APPROVED' | 'ARMED' | 'ACTIVE' | 'PAUSED'
  | 'STOP_REQUESTED' | 'STOPPED' | 'ROLLBACK_REQUESTED' | 'ROLLED_BACK'
  | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export interface CanaryTransition { ok: boolean; from: CanaryState; to: CanaryState; reason: string; }

// ── Approval gate ───────────────────────────────────────────────────────────────
export type ApprovalStatus =
  | 'APPROVED' | 'REJECTED' | 'NEEDS_INVESTIGATION' | 'ENVIRONMENT_BLOCKED' | 'STORE_NOT_ALLOWED'
  | 'VERSION_MISMATCH' | 'INSUFFICIENT_DATA' | 'EXPIRED';
export interface ApprovalInput {
  envGate: EnvGateResult;
  allowlist: AllowlistCheckResult;
  storeIsInternalTest: boolean;
  experimentApproved: boolean;
  pilotRunApproved: boolean;
  isTreatment: boolean;
  candidatePlaylistExists: boolean;
  candidateVersionMatches: boolean;
  candidateSnapshotExists: boolean;
  existingPlaylistSnapshotExists: boolean;
  existingQueueSnapshotAvailable: boolean;
  rollbackTargetExists: boolean;
  shadowCertificationStatus: string;   // must be >= READY_WITH_WARNINGS
  controlDivergences: number;          // must be 0
  failOpenVerified: boolean;
  criticalResolverError: boolean;
  criticalStreamingIncident: boolean;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  expiry: number | null;
  approver: string | null;
  reason: string | null;
  nowMs: number;
}
export interface Approval {
  status: ApprovalStatus;
  blockingReasons: string[];
  warnings: string[];
  requiresApproval: true;
  automated: false;
  executed: false;                     // approval never touches the runtime queue
}

// ── Candidate queue snapshot (validation) ──────────────────────────────────────
export interface CandidateTrackLite {
  trackId: string;
  hasAudio: boolean;
  mediaSupported: boolean;
  disabled: boolean;
  qcFailed: boolean;
  industrySuitable: boolean;
}
export interface CandidateQueueInput {
  playlistExists: boolean;
  candidateVersion: number | null;
  expectedVersion: number | null;
  tracks: CandidateTrackLite[];
  minTracks: number;
  existingQueueLength: number;
  existingItemTypeCompatible: boolean;
}
export type CandidateQueueStatus = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface CandidateQueueResult {
  status: CandidateQueueStatus;
  snapshotHash: string;                // stable hash over the candidate track-id set (+version)
  usableTrackCount: number;
  duplicateCount: number;
  blockedTrackCount: number;
  expectedQueueLength: number;
  changeRatio: number | null;          // vs existing queue length
  blockers: string[];
  warnings: string[];
}

// ── Existing queue snapshot (observation/audit; NOT a restore source) ──────────
export interface ExistingQueueSnapshotInput {
  storeId: string;
  sessionToken: string;
  playlistId: string | null;
  queueLength: number;
  currentTrackId: string | null;
  nextTrackId: string | null;
  queueSource: string;
  capturedAt: number;
}
export interface ExistingQueueSnapshot {
  storeIdHash: string; sessionHash: string; playlistHash: string | null;
  queueLength: number; currentTrackHash: string | null; nextTrackHash: string | null;
  queueSource: string; capturedAt: number; snapshotHash: string;
}

// ── Canary resolver ─────────────────────────────────────────────────────────────
export type CanaryResolveOutcome =
  | 'USE_EXISTING' | 'USE_CANARY_CANDIDATE' | 'CONTROL_PRESERVED' | 'ENVIRONMENT_BLOCKED'
  | 'FLAG_DISABLED' | 'KILL_SWITCHED' | 'STORE_NOT_ALLOWED' | 'SESSION_INACTIVE'
  | 'VERSION_MISMATCH' | 'SNAPSHOT_MISMATCH' | 'CANDIDATE_BLOCKED' | 'EXPIRED' | 'CONFLICT' | 'FAIL_OPEN';
export interface CanaryResolveInput {
  existingPlaylistId: string | null;
  envAllowed: boolean;                 // preview + deployment gate + master + canary flag + !killSwitch
  masterEnabled: boolean;
  canaryFlagEnabled: boolean;
  killSwitch: boolean;
  allowlistStatus: AllowlistStatus;
  sessionState: CanaryState;
  isTreatment: boolean;
  approvalValid: boolean;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  expectedCandidateVersion: number | null;
  candidateSnapshotHash: string | null;
  expectedSnapshotHash: string | null;
  candidateQueueStatus: CandidateQueueStatus;
  expiry: number | null;
  conflict: boolean;
  rollbackTargetExists: boolean;
  storeOnline: boolean;
  criticalIncident: boolean;
  shadowError: boolean;
  nowMs: number;
}
export interface CanaryResolveResult {
  outcome: CanaryResolveOutcome;
  selectedPlaylistId: string | null;   // existing id unless USE_CANARY_CANDIDATE
  usedCandidate: boolean;
  failOpen: boolean;
  reason: string;
  actualPlaybackUnchanged: true;        // this engine never mutates playback
}

// ── Treatment runtime evidence ─────────────────────────────────────────────────
export type RuntimeEvidenceStatus =
  | 'APPLIED_AT_SAFE_BOUNDARY' | 'CANDIDATE_REJECTED' | 'FAIL_OPEN_EXISTING' | 'BLOCKED_BY_GUARDRAIL'
  | 'VERSION_MISMATCH' | 'SNAPSHOT_MISMATCH' | 'RUNTIME_ERROR' | 'NOT_RUN';
export interface RuntimeEvidence {
  status: RuntimeEvidenceStatus;
  existingPlaylistHash: string | null; canaryPlaylistHash: string | null;
  candidateVersion: number | null; candidateSnapshotHash: string | null;
  queueLengthBefore: number | null; queueLengthAfter: number | null;
  boundaryType: string | null;
  currentTrackPreserved: boolean | null; playerStatePreserved: boolean | null;
  playbackStart: boolean | null; ttfaApproxMs: number | null; transitionGapMs: number | null;
  stall: boolean | null; mediaError: boolean | null; recovery: boolean | null;
  rollbackAvailable: boolean;
}

// ── Playback guardrails (recommendation only) ──────────────────────────────────
export type GuardrailStatus = 'PASS' | 'WARNING' | 'STOP_RECOMMENDED' | 'BLOCKED' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface GuardrailSignals {
  playbackStartSuccess: boolean | null;
  ttfaApproxMs: number | null;
  transitionGapMs: number | null;
  stall: boolean | null;
  mediaError: boolean | null;
  recoveryFailure: boolean | null;
  currentTrackPreserved: boolean | null;
  playerStatePreserved: boolean | null;
  queueCompatible: boolean | null;
  unexpectedReload: boolean | null;
  unexpectedPause: boolean | null;
  doublePlayback: boolean | null;
  queueEmpty: boolean | null;
  sampleSufficient: boolean;
}
export interface GuardrailResult { status: GuardrailStatus; triggers: string[]; recommendation: string; automated: false; requiresApproval: true; }

// ── Manual disable / rollback ──────────────────────────────────────────────────
export type DisableResult = 'DISABLED' | 'ROLLED_BACK_AT_BOUNDARY' | 'ALREADY_DISABLED' | 'TARGET_MISSING' | 'VERSION_MISMATCH' | 'FAILED';

// ── Observation windows ─────────────────────────────────────────────────────────
export type CanaryWindow = 'PRE_ACTIVATION' | 'FIRST_RESOLUTION' | 'FIRST_TRANSITION' | 'EARLY' | 'MID' | 'FINAL' | 'POST_DISABLE';

// ── Preview runtime certification ──────────────────────────────────────────────
export type PreviewCertStatus =
  | 'CERTIFIED_FOR_INTERNAL_PREVIEW' | 'READY_WITH_WARNINGS' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'INSUFFICIENT_DATA' | 'NOT_RUN';
export interface PreviewCertInput {
  envGate: EnvGateResult;
  allowlistIntegrity: boolean;
  approvalIntegrity: boolean;
  controlDivergences: number;
  candidateQueueValid: boolean;
  versionIntegrity: boolean;
  snapshotIntegrity: boolean;
  safeBoundaryApplied: boolean | null;   // null when runtime application deferred/not run
  failOpenSuccess: boolean;
  playerStatePreserved: boolean | null;
  guardrail: GuardrailResult;
  manualDisableVerified: boolean;
  rollbackReady: boolean;
  evidenceSessions: number;
  minEvidenceSessions: number;
}
export interface PreviewCertResult {
  status: PreviewCertStatus;
  score: number | null;
  components: Record<string, number | null>;
  blockers: string[];
  limitations: string[];
  automated: false;
}

// ── Production readiness recommendation (max CHANGE_REQUEST; no production canary) ──
export type ProductionReadinessState =
  | 'NOT_READY' | 'MORE_PREVIEW_EVIDENCE_REQUIRED' | 'READY_FOR_INTERNAL_MULTI_STORE_PREVIEW'
  | 'READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export interface ProductionReadinessResult {
  state: ProductionReadinessState;
  reasons: string[];
  requiredEvidence: string[];
  risks: string[];
  automated: false;
  actualProductionCanary: false;
}
