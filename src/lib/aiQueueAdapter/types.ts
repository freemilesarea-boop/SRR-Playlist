// AI-MUSIC-8 — Safe Queue Boundary Adapter & Deterministic Runtime Harness types. Rule-based (NO LLM/ML).
// This layer is a PURE data/decision model + test harness that NEVER touches the real player queue, the audio
// element, or playback. It models how a future Preview canary *would* safely hand a candidate queue to the
// existing player at a safe boundary — computing arbitration, boundary safety, current-track preservation, and
// playback-state preservation IN SIMULATION ONLY. No runtime hook is implemented this phase (deferred). Every
// simulation preserves the existing queue on failure; control stores keep the existing queue; the kill switch
// (default ON) invalidates candidate commands. Certification reaches at most READY_FOR_ISOLATED_PREVIEW_HOOK.

// ── Queue command contract (a queue-change REQUEST — NOT a playback command) ──
export type QueueSource =
  | 'BUSINESS_SCHEDULE' | 'FRANCHISE_POLICY' | 'STORE_DEFAULT' | 'PILOT_PREVIEW'
  | 'MANUAL_REFRESH' | 'RECOVERY' | 'UNKNOWN';

export interface QueueCommand {
  commandId: string;
  storeId: string;
  playerSessionId: string;
  source: QueueSource;
  priority: number;                    // derived from the audited real resolution precedence (see thresholds)
  playlistId: string | null;
  playlistVersion: number | null;
  queueSnapshotHash: string | null;
  requestedAt: number;
  expiresAt: number | null;
  boundaryPolicy: 'NEXT_SAFE_BOUNDARY' | 'IMMEDIATE_UNSAFE_FORBIDDEN';   // immediate is never allowed
  preserveCurrentTrack: boolean;
  preservePlaybackState: boolean;
  reason: string;
  experimentId: string | null;
  canaryRunId: string | null;
  assignmentId: string | null;
  requestRevision: number;             // monotonically increasing per (store, session, source)
}
export type QueueCommandStatus =
  | 'ACCEPTED' | 'DEDUPED' | 'STALE' | 'CONFLICT' | 'EXPIRED' | 'BLOCKED' | 'DEFERRED' | 'NOT_AVAILABLE' | 'INVALID';
export interface QueueCommandResult { status: QueueCommandStatus; reasons: string[]; }

// ── Pending queue (never written to the real store; APPLIED only inside the harness) ──
export type PendingStatus =
  | 'PENDING' | 'VALIDATED' | 'WAITING_BOUNDARY' | 'APPLIED' | 'SUPERSEDED' | 'EXPIRED' | 'REJECTED' | 'CANCELLED';
export interface PendingQueue {
  command: QueueCommand;
  pendingQueueHash: string | null;
  requestedBoundary: string;
  createdAt: number;
  expiry: number | null;
  status: PendingStatus;
  rejectionReason: string | null;
  supersededBy: string | null;
  appliedAt: number | null;
  appliedBoundary: string | null;
}

// ── Safe boundary model ──
export type BoundaryKind =
  | 'TRACK_ENDED' | 'CROSSFADE_COMPLETED' | 'CROSSFADE_FALLBACK_COMPLETED'
  | 'MANUAL_QUEUE_REFRESH' | 'PLAYER_IDLE' | 'SESSION_START' | 'UNKNOWN';
export type BoundarySafety =
  | 'SAFE' | 'UNSAFE_CROSSFADE' | 'UNSAFE_RECOVERY' | 'UNSAFE_PRELOAD'
  | 'UNSAFE_AUDIO_SWAP' | 'UNSAFE_PLAYER_STATE' | 'UNKNOWN' | 'NOT_AVAILABLE';
export interface BoundarySignals {
  kind: BoundaryKind;
  currentTrackEnded: boolean | null;
  crossfadeComplete: boolean | null;
  recovering: boolean | null;
  preloading: boolean | null;
  audioSwapComplete: boolean | null;
  currentIndexStable: boolean | null;
  playerStateStable: boolean | null;
  // Some player internals live in local component refs and are NOT observable from outside → mark NOT_AVAILABLE.
  observable: boolean;
}
export interface BoundaryResult { safety: BoundarySafety; applyPossible: boolean; reasons: string[]; }

// ── Arbitration (which command wins when several arrive) ──
export type ArbitrationOutcome =
  | 'WINNER_SELECTED' | 'SAME_COMMAND' | 'STALE_REJECTED' | 'LOWER_PRIORITY_REJECTED'
  | 'CONFLICT' | 'NO_VALID_COMMAND' | 'INSUFFICIENT_DATA';
export interface ArbitrationInput {
  commands: QueueCommand[];
  isProductionEnvironment: boolean;    // pilot preview never wins in production
  killSwitch: boolean;                 // kill switch → pilot commands invalid
  isControlStore: boolean;             // control store → no pilot command may exist
  currentSessionId: string;
  currentStoreId: string;
  nowMs: number;
  latestRevisionBySource: Record<string, number>;   // for stale detection
}
export interface ArbitrationResult {
  outcome: ArbitrationOutcome;
  winner: QueueCommand | null;
  rejected: Array<{ commandId: string; reason: string }>;
  trace: string[];
}

// ── Idempotency / stale protection ──
export type FreshnessStatus =
  | 'CURRENT' | 'DUPLICATE' | 'STALE' | 'WRONG_SESSION' | 'WRONG_STORE' | 'VERSION_MISMATCH' | 'EXPIRED' | 'UNKNOWN';
export interface FreshnessInput {
  command: QueueCommand;
  latestRevisionForSource: number | null;
  latestAppliedCommandId: string | null;
  latestAppliedQueueHash: string | null;
  currentSessionId: string;
  currentStoreId: string;
  expectedPlaylistVersion: number | null;
  nowMs: number;
}
export interface FreshnessResult { status: FreshnessStatus; reasons: string[]; }

// ── Current track preservation (simulation only) ──
export type CurrentTrackResult =
  | 'PRESERVED_IN_NEW_QUEUE' | 'PRESERVED_UNTIL_BOUNDARY' | 'BLOCKED_CROSSFADE'
  | 'BLOCKED_RECOVERY' | 'BLOCKED_PRELOAD' | 'CURRENT_TRACK_MISSING' | 'NOT_AVAILABLE';
export interface CurrentTrackInput {
  currentTrackId: string | null;
  currentIndex: number;
  existingQueueTrackIds: string[];
  candidateQueueTrackIds: string[];
  boundary: BoundaryResult;
}
export interface CurrentTrackPreservation {
  result: CurrentTrackResult;
  remappedIndex: number | null;        // index of the current track in the candidate queue, if present
  reasons: string[];
}

// ── Playback state preservation (simulation only) ──
export type PlaybackStateResult =
  | 'PRESERVED' | 'WOULD_CHANGE_PLAYING' | 'WOULD_PAUSE' | 'WOULD_RESTART'
  | 'WOULD_RESET_CURRENT_TIME' | 'WOULD_CHANGE_AUDIO_OUTPUT' | 'UNKNOWN';
export interface PlaybackStateSnapshot {
  playing: boolean; paused: boolean; ended: boolean; buffering: boolean; recovering: boolean;
  crossfading: boolean; currentTime: number; volume: number; muted: boolean; sinkId: string | null;
  activeAudioIndex: number;
}
export interface PlaybackStatePreservation { result: PlaybackStateResult; diff: string[]; }

// ── Deterministic harness ──
export interface HarnessInput {
  scenarioName: string;
  existingQueueTrackIds: string[];
  candidateQueueTrackIds: string[];
  currentTrackId: string | null;
  currentIndex: number;
  playbackState: PlaybackStateSnapshot;
  boundary: BoundarySignals;
  pendingCommands: QueueCommand[];
  isProductionEnvironment: boolean;
  isControlStore: boolean;
  killSwitch: boolean;
  masterEnabled: boolean;
  adapterEnabled: boolean;
  currentSessionId: string;
  currentStoreId: string;
  expectedCandidateVersion: number | null;
  candidateVersion: number | null;
  expectedSnapshotHash: string | null;
  candidateSnapshotHash: string | null;
  nowMs: number;
}
export type ApplyDecision = 'APPLIED_IN_HARNESS' | 'DEFERRED_TO_BOUNDARY' | 'REJECTED' | 'EXISTING_PRESERVED';
export interface HarnessInvariants {
  currentTrackUnchanged: boolean;
  playbackStateUnchanged: boolean;
  audioStateUnchanged: boolean;
  existingQueuePreservedOnFailure: boolean;
  controlStorePreserved: boolean;
  killSwitchPreserved: boolean;
  staleNeverOverwrites: boolean;
  versionMismatchPreserved: boolean;
}
export interface HarnessResult {
  scenarioName: string;
  selectedCommand: QueueCommand | null;
  resultQueueTrackIds: string[];       // the SIMULATED result queue (never applied to the real store)
  resultCurrentTrackId: string | null;
  resultIndex: number;
  applyDecision: ApplyDecision;
  rejectionReason: string | null;
  arbitration: ArbitrationResult;
  boundary: BoundaryResult;
  currentTrack: CurrentTrackPreservation;
  playbackState: PlaybackStatePreservation;
  invariants: HarnessInvariants;
  trace: string[];
  // Hard invariant: the harness never mutates the real player. Always true.
  realPlayerUntouched: true;
}

// ── Resolver race simulation ──
export type RaceClassification =
  | 'DETERMINISTIC' | 'LAST_WRITE_RISK' | 'STALE_RESPONSE_BLOCKED'
  | 'CONFLICT_REQUIRES_REVIEW' | 'UNSAFE' | 'INSUFFICIENT_DATA';
export interface RaceResult { classification: RaceClassification; winner: QueueSource | null; reasons: string[]; }

// ── Adapter certification ──
export type AdapterCertStatus =
  | 'CERTIFIED_FOR_PURE_HARNESS' | 'READY_FOR_ISOLATED_PREVIEW_HOOK' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export interface AdapterCertInput {
  queuePlaybackSeparationDesigned: boolean;
  boundarySafetyProven: boolean;
  currentTrackPreservationPass: boolean;
  playbackStatePreservationPass: boolean;
  staleProtectionPass: boolean;
  idempotencyPass: boolean;
  resolverRaceSafe: boolean;
  controlPreservationPass: boolean;
  failOpenPass: boolean;
  killSwitchPass: boolean;
  scenariosRun: number;
  minScenarios: number;
}
export interface AdapterCertResult {
  status: AdapterCertStatus;
  score: number | null;
  components: Record<string, number | null>;
  blockers: string[];
  limitations: string[];
  automated: false;
}

// ── Preview hook readiness (max READY_FOR_ISOLATED_PREVIEW_HOOK; no runtime hook this phase) ──
export type PreviewHookReadiness =
  | 'NOT_READY' | 'PURE_HARNESS_ONLY' | 'READY_FOR_ISOLATED_PREVIEW_HOOK' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export interface PreviewHookReadinessResult {
  state: PreviewHookReadiness;
  evidence: string[];
  risks: string[];
  nextRequiredAction: string[];
  automated: false;
  runtimeHookImplemented: false;
}
