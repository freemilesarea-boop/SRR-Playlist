// AI-MUSIC-9 — Isolated Preview Queue Hook & Single-Store Runtime Proof types. Rule-based (NO LLM/ML).
// This layer is a PURE data/decision model for how an isolated Preview runtime hook *would* hand a candidate
// queue to the existing player at a safe boundary in a SINGLE internal test store. It NEVER touches the real
// player queue, the audio element, or playback. No runtime hook is wired this phase (Go/No-Go = NO-GO →
// DEFERRED): the Feasibility re-audit found no internal test store, the Preview canary migration is not applied
// (resolver uncallable), and crossfade/recovery/preload boundary state lives in Player.tsx component-local refs
// and is NOT observable from store state without modifying the forbidden Player.tsx. Every model output carries
// actualPlayerControl:false, directAudioMutation:false, automated:false, previewOnly:true. Certification cannot
// exceed NOT_RUN without real single-store runtime evidence, which does not exist this phase.

import type { QueueSource } from '../aiQueueAdapter';

// ── Common safety envelope stamped on EVERY hook decision (structural guarantee) ──
export interface RuntimeSafetyEnvelope {
  actualPlayerControl: false;   // the model never controls the player
  directAudioMutation: false;   // no play/pause/load/currentTime/volume/muted/sinkId
  automated: false;             // no automatic apply/expand/rollout
  previewOnly: true;            // preview scope only, never production
}
export const SAFETY_ENVELOPE: RuntimeSafetyEnvelope = {
  actualPlayerControl: false, directAudioMutation: false, automated: false, previewOnly: true,
};

// ── Isolated single test store contract (exactly one internal store, never a customer/enterprise store) ──
export interface IsolatedTestStore {
  storeId: string;
  storeNameHash: string;               // hashed — never the real store name
  purpose: string;
  previewDeploymentId: string;
  approvedCandidatePlaylistId: string;
  approvedCandidateVersion: number;
  approvedSnapshotHash: string;
  approvedExistingPlaylistId: string;
  approvedBy: string;
  approvedAtMs: number;
  expiresAtMs: number;
  maxSessions: 1;                      // hard-pinned to one
  maxQueueApplications: number;
  enabled: boolean;
  killSwitchRequired: true;
}
export type TestStoreValidity =
  | 'VALID' | 'NO_STORE_CONFIGURED' | 'WILDCARD_FORBIDDEN' | 'MULTI_STORE_FORBIDDEN'
  | 'NOT_INTERNAL_STORE' | 'DISABLED' | 'EXPIRED' | 'DEPLOYMENT_MISMATCH'
  | 'CANDIDATE_MISSING' | 'VERSION_MISSING' | 'SNAPSHOT_MISSING' | 'EXISTING_MISSING'
  | 'APPROVAL_MISSING' | 'KILL_SWITCH_NOT_REQUIRED';
export interface TestStoreValidation { validity: TestStoreValidity; reasons: string[]; }

// ── Runtime hook contract ──
export type BoundaryStateKnown =
  | 'TRACK_ENDED' | 'CROSSFADE_COMPLETED' | 'CROSSFADE_FALLBACK_COMPLETED'
  | 'PLAYER_IDLE' | 'SESSION_START_NOT_PLAYING' | 'MANUAL_QUEUE_REFRESH'
  | 'CROSSFADE_ACTIVE' | 'RECOVERY_ACTIVE' | 'PRELOAD_HOLDS_NEXT' | 'AUDIO_SWAP_ACTIVE'
  | 'BUFFERING' | 'ERROR_RECOVERY' | 'PLAYING_MID_TRACK' | 'POLICY_FETCH' | 'SCHEDULE_FETCH'
  | 'UNKNOWN_NOT_OBSERVABLE';

export interface RuntimePlaybackSnapshot {
  playing: boolean; paused: boolean; ended: boolean; buffering: boolean; recovering: boolean;
  crossfading: boolean; currentTime: number; volume: number; muted: boolean; sinkId: string | null;
  activeAudioIndex: number; queueLength: number; currentTrackId: string | null;
  // Some of the above are NOT observable at runtime without modifying Player.tsx; the model records which.
  observable: boolean;
}

export interface RuntimeHookInput {
  scenarioName: string;
  storeId: string;
  playerSessionId: string;
  resolvedPlaylistId: string | null;
  queueRevision: number;
  resolverSource: QueueSource;
  currentTrackId: string | null;
  currentIndex: number;
  playbackState: RuntimePlaybackSnapshot;
  boundaryState: BoundaryStateKnown;
  crossfadeState: boolean | null;      // null = not observable at runtime
  recoveryState: boolean | null;
  preloadState: boolean | null;
  previewDeploymentId: string;
  currentDeploymentId: string;
  isPreviewEnvironment: boolean;
  isControlStore: boolean;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  candidateSnapshotHash: string | null;
  existingQueueTrackIds: string[];
  candidateQueueTrackIds: string[];
  sessionCount: number;
  appliedCount: number;
  // gates
  store: IsolatedTestStore | null;
  featureFlags: RuntimeHookFlags;
  killSwitch: boolean;
  nowMs: number;
}
export interface RuntimeHookFlags {
  masterEnabled: boolean;
  hookEnabled: boolean;
  queueOnlyAdapterEnabled: boolean;
  boundaryReservationEnabled: boolean;
  runtimeEvidenceEnabled: boolean;
  runtimeGuardrailEnabled: boolean;
  runtimeRollbackEnabled: boolean;
}
export type HookDecision =
  | 'NO_ACTION' | 'WAITING_BOUNDARY' | 'CANDIDATE_READY' | 'APPLIED_AT_BOUNDARY' | 'CONTROL_PRESERVED'
  | 'FLAG_DISABLED' | 'KILL_SWITCHED' | 'STORE_NOT_ALLOWED' | 'DEPLOYMENT_MISMATCH' | 'SESSION_LIMIT'
  | 'VERSION_MISMATCH' | 'SNAPSHOT_MISMATCH' | 'STALE_COMMAND' | 'UNSAFE_BOUNDARY' | 'FAIL_OPEN' | 'ERROR';
export interface RuntimeHookResult extends RuntimeSafetyEnvelope {
  scenarioName: string;
  decision: HookDecision;
  reasons: string[];
  // The SIMULATED result queue — always the existing queue unless APPLIED_AT_BOUNDARY (in-model only).
  resultQueueTrackIds: string[];
  resultCurrentTrackId: string | null;
  resultIndex: number;
  boundaryUsed: BoundaryStateKnown | null;
  // Never wired to the real store.
  realPlayerUntouched: true;
}

// ── Queue-only mutation adapter (PURE reducer over a snapshot — never the real Zustand store) ──
export interface QueueOnlyMutationInput {
  existingQueueTrackIds: string[];
  candidateQueueTrackIds: string[];
  currentTrackId: string | null;
  currentIndex: number;
  playback: RuntimePlaybackSnapshot;
}
export type QueueOnlyMutationResult =
  | 'QUEUE_REPLACED_PRESERVING_PLAYBACK' | 'CURRENT_TRACK_HELD_AS_HEAD' | 'BLOCKED_EMPTY_CANDIDATE'
  | 'BLOCKED_INVALID_INDEX' | 'BLOCKED_NOT_OBSERVABLE' | 'NO_CHANGE';
export interface QueueOnlyMutation {
  result: QueueOnlyMutationResult;
  resultQueueTrackIds: string[];
  resultIndex: number;
  resultCurrentTrackId: string | null;
  // proof fields — these MUST equal the input (the adapter changes queue+index only).
  playingUnchanged: boolean;
  currentTimeUnchanged: boolean;
  activeAudioIndexUnchanged: boolean;
  currentTrackUnchanged: boolean;
  setQueueCalled: false;               // the model never calls the real setQueue
  setPlayingCalled: false;
  audioApiCalled: false;
  reasons: string[];
}

// ── Boundary reservation (Preview-session memory only; never a Production DB row) ──
export type ReservationState =
  | 'RESERVED' | 'VALIDATED' | 'WAITING_BOUNDARY' | 'APPLYING' | 'APPLIED'
  | 'SUPERSEDED' | 'EXPIRED' | 'REJECTED' | 'CANCELLED';
export interface BoundaryReservation {
  reservationId: string;
  commandId: string;
  sessionId: string;
  queueRevision: number;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  candidateSnapshotHash: string | null;
  existingQueueHash: string | null;
  currentTrackHash: string | null;
  requestedBoundary: BoundaryStateKnown;
  createdAtMs: number;
  expiresAtMs: number | null;
  maxApplyCount: number;
  appliedCount: number;
  state: ReservationState;
  rejectionReason: string | null;
  persistedToProductionDb: false;      // structural guarantee
}

// ── Runtime arbitration (existing resolvers vs a candidate reservation, in-model) ──
export type RuntimeArbitrationOutcome =
  | 'CANDIDATE_MAY_APPLY' | 'CANDIDATE_STALE' | 'CANDIDATE_CANCELLED' | 'CANDIDATE_DEFERRED'
  | 'EXISTING_WINS' | 'CONFLICT_REVIEW' | 'NO_CANDIDATE';
export interface RuntimeArbitrationInput {
  reservation: BoundaryReservation;
  recoveryActive: boolean;
  policyRevisionChanged: boolean;
  scheduleRevisionChanged: boolean;
  existingQueueRevisionChanged: boolean;
  killSwitch: boolean;
  sessionChanged: boolean;
  deploymentChanged: boolean;
  candidateVersionChanged: boolean;
  nowMs: number;
}
export interface RuntimeArbitrationResult { outcome: RuntimeArbitrationOutcome; reasons: string[]; }

// ── Current track / playback state preservation runtime checks (before vs after, in-model) ──
export interface PreservationRuntimeInput { before: RuntimePlaybackSnapshot; after: RuntimePlaybackSnapshot; }
export type CurrentTrackRuntimeResult =
  | 'PRESERVED' | 'REMAPPED_INDEX_ONLY' | 'HELD_AS_HEAD' | 'CHANGED_BLOCKED' | 'NOT_OBSERVABLE';
export interface CurrentTrackRuntimeCheck {
  result: CurrentTrackRuntimeResult;
  currentTrackIdEqual: boolean;
  currentTimeEqual: boolean;
  activeAudioIndexEqual: boolean;
  playingEqual: boolean;
  pausedEqual: boolean;
  transientStateEqual: boolean;        // crossfading/recovering/buffering unchanged
  reasons: string[];
}
export type PlaybackStateRuntimeResult = 'PRESERVED' | 'FORBIDDEN_CHANGE' | 'NOT_OBSERVABLE';
export interface PlaybackStateRuntimeCheck {
  result: PlaybackStateRuntimeResult;
  forbiddenChanges: string[];          // any of playing/paused/currentTime/volume/muted/sinkId/audioIndex/track
  allowedChanges: string[];            // queue metadata / next candidate / revision / resolver source
  reasons: string[];
}

// ── Fail-open runtime wrapper (models the gate chain + try/catch → existing on any failure) ──
export type FailOpenResult = 'PASSED' | 'FAILED_OPEN' | 'SHORT_CIRCUIT_CONTROL' | 'SHORT_CIRCUIT_DISABLED';
export interface FailOpenReport {
  result: FailOpenResult;
  existingQueuePreserved: boolean;
  existingPlaybackPreserved: boolean;
  errorSummary: string | null;         // summary only — never a raw stack
  threwToPlayer: false;                // never throws up to the resolver/player
  reasons: string[];
}

// ── Runtime guardrails (STOP_RECOMMENDED only — never an automatic stop) ──
export type GuardrailSignal =
  | 'CURRENT_TRACK_CHANGED' | 'CURRENT_TIME_RESET' | 'UNEXPECTED_PLAY' | 'UNEXPECTED_PAUSE'
  | 'DOUBLE_PLAYBACK' | 'QUEUE_EMPTY' | 'INVALID_CURRENT_INDEX' | 'CROSSFADE_STATE_CHANGED'
  | 'RECOVERY_STATE_CHANGED' | 'PRELOAD_CONFLICT' | 'AUDIO_OUTPUT_CHANGED'
  | 'CANDIDATE_FETCH_REPEAT_FAIL' | 'RESOLVER_RACE_REPEAT' | 'UNEXPECTED_QUEUE_REWRITE' | 'RUNTIME_ERROR';
export interface GuardrailInput {
  signals: GuardrailSignal[];
}
export type GuardrailVerdict = 'CLEAR' | 'STOP_RECOMMENDED';
export interface GuardrailResult {
  verdict: GuardrailVerdict;
  triggered: GuardrailSignal[];
  automaticStop: false;                // never auto-stop
  reasons: string[];
}

// ── Runtime evidence (low-frequency, redacted, hash-only) ──
export type EvidenceKind =
  | 'hook_evaluated' | 'reservation_created' | 'waiting_boundary' | 'candidate_applied'
  | 'candidate_rejected' | 'stale_command_blocked' | 'kill_switch_cancelled' | 'current_track_preserved'
  | 'playback_state_preserved' | 'fail_open_existing' | 'runtime_hook_error' | 'rollback_completed';
export interface RuntimeEvidence {
  kind: EvidenceKind;
  storeHash: string;
  sessionHash: string;
  deploymentHash: string;
  existingPlaylistHash: string | null;
  candidatePlaylistHash: string | null;
  queueHashBefore: string | null;
  queueHashAfter: string | null;
  currentTrackHash: string | null;
  boundary: BoundaryStateKnown | null;
  result: string;
  reasonCode: string;
  durationBucket: string;
  createdAtMs: number;
  // Redaction guarantee — these are NEVER present.
  containsAudioUrl: false;
  containsTrackTitle: false;
  containsArtist: false;
  containsRawQueue: false;
  containsRawError: false;
  containsToken: false;
  containsPii: false;
}

// ── Manual rollback at boundary ──
export interface RollbackInput {
  existingPlaylistId: string | null;
  canRebuildExistingQueue: boolean;
  sameSession: boolean;
  sameDeployment: boolean;
  currentTrackSnapshotPresent: boolean;
  currentTrackPreservable: boolean;
  safeBoundary: boolean;
  killSwitch: boolean;
  reason: string;
}
export type RollbackResult =
  | 'ROLLBACK_RESERVED' | 'ROLLED_BACK_AT_BOUNDARY' | 'ALREADY_EXISTING' | 'TARGET_MISSING'
  | 'UNSAFE_BOUNDARY' | 'STALE_SESSION' | 'FAILED';
export interface RollbackReport { result: RollbackResult; automatic: false; reasons: string[]; }

// ── Single-store runtime certification ──
export type SingleStoreCertStatus =
  | 'CERTIFIED_FOR_SINGLE_INTERNAL_STORE' | 'READY_WITH_WARNINGS' | 'REVIEW_REQUIRED'
  | 'BLOCKED' | 'NOT_RUN' | 'INSUFFICIENT_DATA';
export interface SingleStoreCertInput {
  runtimeEvidencePresent: boolean;     // real single-store runtime evidence exists?
  previewEnvironmentConfirmed: boolean;
  deploymentMatch: boolean;
  storeAllowlistMatch: boolean;
  singleSession: boolean;
  candidateVersionMatch: boolean;
  snapshotHashMatch: boolean;
  safeBoundaryConfirmed: boolean;
  currentTrackPreserved: boolean;
  playbackStatePreserved: boolean;
  existingQueueFailOpen: boolean;
  killSwitchProven: boolean;
  manualRollbackProven: boolean;
  controlStoreUnchanged: boolean;
  noDoublePlayback: boolean;
  noUnexpectedPause: boolean;
  noQueueEmpty: boolean;
  noRuntimeError: boolean;
}
export interface SingleStoreCertResult {
  status: SingleStoreCertStatus;
  evidence: string[];
  blockers: string[];
  limitations: string[];
  automated: false;
}

// ── Production canary change-request readiness (never runs a production canary) ──
export type ProductionCrReadinessStatus =
  | 'NOT_READY' | 'MORE_SINGLE_STORE_EVIDENCE_REQUIRED' | 'READY_FOR_MULTI_SESSION_INTERNAL_PREVIEW'
  | 'READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST' | 'BLOCKED' | 'NOT_RUN' | 'INSUFFICIENT_DATA';
export interface ProductionCrReadinessResult {
  status: ProductionCrReadinessStatus;
  reasons: string[];
  evidenceRequired: string[];
  actualProductionCanaryRun: false;    // never
  automated: false;
}

// ── Feasibility re-audit output (Task 1) ──
export type HookFeasibility =
  | 'SAFE_HOOK_AVAILABLE' | 'SAFE_ADAPTER_ONLY' | 'UNSAFE' | 'NOT_AVAILABLE' | 'DEFERRED';
export interface GoNoGoResult {
  decision: 'GO' | 'NO_GO';
  feasibility: HookFeasibility;
  satisfied: string[];
  failed: string[];
  runtimeHookImplemented: boolean;
  deferredReason: string | null;
}
