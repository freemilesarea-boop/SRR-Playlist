// AI-MUSIC-10 — Runtime Boundary Observability Bridge types. Rule-based (NO LLM/ML). This layer is a READ-ONLY
// observability model: it publishes a snapshot of the player's runtime boundary state (crossfade/recovery/
// preload/audio-swap/player stability) so an external, session-scoped store + admin harness can read it. It is
// an OBSERVER, not a controller: it never changes the queue, playback, audio element, crossfade/recovery/preload
// logic, or any existing condition/timeout/rAF. Observer errors are dropped, never thrown to the player. Every
// snapshot is session-attributed, monotonically revisioned, and stale/duplicate-protected. `stable_for_queue_
// change=SAFE` means "no observed conflict state" — NOT a guarantee that a queue change would succeed. No
// runtime queue hook, no candidate application, no canary is performed this phase.

// ── Discrete, read-only state enums (converted from Player.tsx internal branches; never drive the player) ──
export type CrossfadeState = 'IDLE' | 'PREPARING' | 'ACTIVE' | 'COMPLETING' | 'FALLBACK' | 'STUCK' | 'UNKNOWN';
export type RecoveryState = 'IDLE' | 'DETECTED' | 'ATTEMPTING' | 'RECOVERED' | 'FAILED' | 'UNKNOWN';
export type PreloadState = 'IDLE' | 'REQUESTED' | 'LOADING' | 'READY' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
export type AudioSwapState = 'IDLE' | 'PREPARING' | 'SWAPPING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
export type RecoveryReason =
  | 'WAITING_TIMEOUT' | 'STALL' | 'MEDIA_ERROR' | 'NETWORK' | 'PLAY_REJECTED' | 'INVALID_STATE' | 'UNKNOWN';
export type BoundaryCandidate =
  | 'SESSION_START' | 'PLAYER_IDLE' | 'TRACK_ENDED' | 'CROSSFADE_COMPLETED' | 'CROSSFADE_FALLBACK_COMPLETED'
  | 'RECOVERY_COMPLETED' | 'MANUAL_REFRESH' | 'NONE' | 'UNKNOWN';

// Signal availability from the Player.tsx audit — a signal we cannot expose safely stays NOT_AVAILABLE.
export type SignalAvailability = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE' | 'UNSAFE_TO_EXPORT';
export type DataStatus = 'OK' | 'PARTIAL' | 'NO_SESSION' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';

// ── Per-signal revisions (monotonic; namespaced by session) ──
export interface BoundaryRevisions {
  sessionRevision: number;
  boundaryRevision: number;
  crossfadeRevision: number;
  recoveryRevision: number;
  preloadRevision: number;
  audioSwapRevision: number;
  queueObservationRevision: number;
}

// ── The read-only boundary snapshot (the Contract) ──
export interface RuntimeBoundarySnapshot {
  playerSessionId: string | null;
  observedAtMs: number;
  revision: number;                      // == boundaryRevision at publish time
  revisions: BoundaryRevisions;
  currentTrackIdHash: string | null;     // hashed — never a raw track id/title
  currentIndex: number;
  queueLength: number;
  playing: boolean;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  waiting: boolean;
  stalled: boolean;
  crossfadeState: CrossfadeState;
  recoveryState: RecoveryState;
  recoveryReason: RecoveryReason | null;
  preloadState: PreloadState;
  audioSwapState: AudioSwapState;
  activeAudioIndex: number;
  inactiveAudioReady: boolean;
  nextTrackHash: string | null;
  boundaryCandidate: BoundaryCandidate;
  stableForQueueChange: boolean;         // convenience mirror of StableBoundaryResult === 'SAFE'
  reasonCodes: string[];
  dataStatus: DataStatus;
}

// ── Observer publication events (what a bridge would call) ──
export type ObserverSignalKind = 'crossfade' | 'recovery' | 'preload' | 'audioSwap' | 'playerState' | 'session';
export interface CrossfadeSignal { kind: 'crossfade'; state: CrossfadeState; activeAudioIndex?: number; }
export interface RecoverySignal { kind: 'recovery'; state: RecoveryState; reason?: RecoveryReason; }
export interface PreloadSignal { kind: 'preload'; state: PreloadState; nextTrackHash?: string | null; inactiveAudioIndex?: number; }
export interface AudioSwapSignal { kind: 'audioSwap'; state: AudioSwapState; beforeActiveIndex?: number; afterActiveIndex?: number; reason?: string; }
export interface PlayerStateSignal {
  kind: 'playerState';
  playing: boolean; paused: boolean; ended: boolean; buffering: boolean; waiting: boolean; stalled: boolean;
  currentTrackIdHash: string | null; currentIndex: number; queueLength: number;
  activeAudioIndex: number; inactiveAudioReady: boolean; nextTrackHash: string | null;
}
export interface SessionSignal { kind: 'session'; playerSessionId: string | null; }
export type ObserverSignal = CrossfadeSignal | RecoverySignal | PreloadSignal | AudioSwapSignal | PlayerStateSignal | SessionSignal;

// ── Stale / revision protection ──
export type FreshnessStatus = 'CURRENT' | 'DUPLICATE' | 'STALE' | 'WRONG_SESSION' | 'OUT_OF_ORDER' | 'INVALID';
export interface FreshnessInput {
  incomingSessionId: string | null;
  currentSessionId: string | null;
  incomingRevision: number;
  lastRevision: number;
  incomingAtMs: number;
  lastAtMs: number;
  isDuplicatePayload: boolean;
}
export interface FreshnessResult { status: FreshnessStatus; reasons: string[]; }

// ── Stable boundary engine ──
export type StableBoundaryResult =
  | 'SAFE' | 'BLOCKED_CROSSFADE' | 'BLOCKED_RECOVERY' | 'BLOCKED_PRELOAD' | 'BLOCKED_AUDIO_SWAP'
  | 'BLOCKED_BUFFERING' | 'BLOCKED_WAITING' | 'BLOCKED_STALLED' | 'INVALID_CURRENT_TRACK' | 'INVALID_INDEX'
  | 'EMPTY_QUEUE' | 'NO_SESSION' | 'INSUFFICIENT_DATA' | 'NOT_AVAILABLE';
export interface StableBoundary {
  result: StableBoundaryResult;
  blockers: string[];
  currentTrackPresent: boolean;
  indexValid: boolean;
  sessionValid: boolean;
}

// ── Sequence validator ──
export type SequenceStatus = 'VALID' | 'INVALID_TRANSITION' | 'STALE_TRANSITION' | 'SESSION_CHANGED' | 'INSUFFICIENT_DATA';
export interface SequenceResult { status: SequenceStatus; reasons: string[]; }

// ── Coverage ──
export type CoverageStatus = 'SUFFICIENT' | 'PARTIAL' | 'LOW' | 'NO_DATA' | 'INSUFFICIENT_DATA';
export interface BoundaryCoverageInput {
  sessionsObserved: number;
  snapshots: number;
  crossfadeTransitions: number;
  recoveryTransitions: number;
  preloadTransitions: number;
  swapTransitions: number;
  safeBoundaries: number;
  blockedBoundaries: number;
  staleEvents: number;
  observerErrors: number;
  distinctStatesSeen: number;
  browserRuntimeRan: boolean;
}
export interface BoundaryCoverageResult { status: CoverageStatus; stateCoveragePct: number | null; reasons: string[]; }

// ── Runtime hook readiness re-evaluation (only the boundary-observability No-Go condition from AI-MUSIC-9) ──
export type HookReadinessStatus =
  | 'NOT_READY' | 'BOUNDARY_OBSERVABILITY_READY' | 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST'
  | 'BLOCKED' | 'INSUFFICIENT_DATA' | 'NOT_RUN';
export interface HookReadinessInput {
  crossfadeObservable: boolean;
  recoveryObservable: boolean;
  preloadObservable: boolean;
  audioSwapObservable: boolean;
  stableBoundaryEngine: boolean;
  revisionStaleProtection: boolean;
  sessionAttribution: boolean;
  zeroControlGuaranteed: boolean;
  observerFailOpen: boolean;
  sequenceValidation: boolean;
  sufficientTestCoverage: boolean;
  internalTestStoreConfigured: boolean;   // still false this phase
  previewMigrationApplied: boolean;        // still false this phase
}
export interface HookReadinessResult {
  status: HookReadinessStatus;
  satisfied: string[];
  blockers: string[];
  nextRequiredEvidence: string[];
  runtimeHookImplemented: false;
}

// ── Signal audit result (Task 1 output, recorded for the dashboard) ──
export interface SignalAuditEntry { signal: string; availability: SignalAvailability; note: string; }
