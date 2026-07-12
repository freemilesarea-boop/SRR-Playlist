// AI-MUSIC-6 — Shadow Playlist Resolution & Runtime Certification types. Rule-based (NO LLM/ML). This layer
// computes what a store's playlist *would* resolve to under a pilot override, IN PARALLEL with the existing
// resolver, and compares the two — WITHOUT ever changing the real resolution, queue, playlist, or playback.
// The existing resolver result is always authoritative; the shadow result is analysis/log/dashboard only.
// Every failure in the shadow path fails OPEN to the existing result. No runtime integration is performed —
// this phase certifies readiness only (up to READY_FOR_MANUAL_CANARY_REVIEW).

// ── Resolver contract (shared by the existing-result capture and the shadow resolver) ──
export type SelectionSource =
  | 'PILOT_OVERRIDE' | 'STORE_PLAYLIST' | 'BRAND_ENTERPRISE' | 'SCHEDULE' | 'FALLBACK' | 'NONE';

// Existing-resolver *result* capture (what the real path already decided — read-only snapshot).
export interface ExistingResolution {
  storeId: string;
  selectedPlaylistId: string | null;
  selectionSource: SelectionSource;   // observed source of the real decision
  version: number | null;             // null when the base path has no version concept
  reason: string;
}

// Shadow resolver input: the existing decision + the store's pilot binding (if any).
export interface ShadowResolverInput {
  storeId: string;
  resolvedAt: number;                 // caller-supplied clock (deterministic)
  existing: ExistingResolution;       // authoritative existing result (never mutated)
  // pilot binding (from AI-MUSIC-5 override, if present) — all optional
  experimentId: string | null;
  pilotRunId: string | null;
  assignmentId: string | null;
  assignmentGroup: 'control' | 'treatment' | null;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  expectedCandidateVersion: number | null;   // approved pin
  overrideStatus: 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'ROLLED_BACK' | 'EXPIRED' | null;
  overrideStart: number | null;
  overrideEnd: number | null;
  expiry: number | null;
  conflictingActivePilot: boolean;    // store bound to another active pilot
  overrideFlagEnabled: boolean;       // ai_shadow override consideration flag
  shadowError: boolean;               // simulate/propagate a shadow-path error → fail open
}

export type ReasonCode =
  | 'CONTROL_PRESERVED' | 'NO_ASSIGNMENT' | 'OVERRIDE_FLAG_OFF' | 'VERSION_MISMATCH'
  | 'CANDIDATE_MISSING' | 'OVERRIDE_EXPIRED' | 'OVERRIDE_NOT_ACTIVE' | 'ASSIGNMENT_CONFLICT'
  | 'RESOLVER_ERROR' | 'OVERRIDE_APPLIED' | 'EXISTING_RESULT';

// Shadow resolver output: what the store WOULD resolve to (preview only — never applied).
export interface ShadowResolution {
  storeId: string;
  selectedPlaylistId: string | null;
  selectionSource: SelectionSource;
  version: number | null;
  decisionReason: string;
  reasonCode: ReasonCode;
  fallbackUsed: boolean;              // shadow fell open to the existing result
  versionValid: boolean;
  candidateAvailable: boolean;
  assignmentValid: boolean;
  overrideValid: boolean;
  confidence: number | null;
  status: 'READY' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
}

// ── Divergence classification ──────────────────────────────────────────────────
export type DivergenceType =
  | 'SAME_RESULT' | 'EXPECTED_TREATMENT_DIVERGENCE' | 'UNEXPECTED_CONTROL_DIVERGENCE'
  | 'VERSION_MISMATCH' | 'CANDIDATE_MISSING' | 'POLICY_CONFLICT' | 'SCHEDULE_CONFLICT'
  | 'ASSIGNMENT_CONFLICT' | 'EXPIRED_OVERRIDE' | 'RESOLVER_ERROR' | 'UNKNOWN';
export type DivergenceSeverity = 'NONE' | 'INFO' | 'WARNING' | 'CRITICAL';
export interface DivergenceResult {
  type: DivergenceType;
  severity: DivergenceSeverity;
  failOpenSuccess: boolean;           // shadow failure did NOT change the existing result
  certificationRisk: boolean;         // safe at runtime but a risk to note for certification
  actualPlaylistUnchanged: true;      // invariant — shadow never changes real playback
  reason: string;
}

// ── Shadow decision event (low-frequency, privacy-safe — hashes only, no titles/tracks/URLs) ──
export interface ShadowDecisionEvent {
  storeIdHash: string;
  sessionHash: string;
  existingPlaylistHash: string | null;
  shadowPlaylistHash: string | null;
  existingSource: SelectionSource;
  shadowSource: SelectionSource;
  divergenceType: DivergenceType;
  experimentId: string | null;
  pilotRunId: string | null;
  assignmentId: string | null;
  candidateVersion: number | null;
  reasonCode: ReasonCode;
  evaluatedAt: number;
}

// ── Control preservation certification ─────────────────────────────────────────
export type CertStatus = 'PASS' | 'FAIL' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface ControlPreservationInput {
  controlSessions: number;
  controlDivergences: number;         // any control store whose shadow differed from existing
  minSamples: number;
}
export interface ControlPreservationResult {
  status: CertStatus;
  controlSessions: number;
  divergences: number;
  reasons: string[];
}

// ── Treatment eligibility certification ────────────────────────────────────────
export type EligibilityStatus = 'READY' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface TreatmentEligibilityInput {
  approvalValid: boolean;
  assignmentValid: boolean;
  versionPinValid: boolean;
  candidateExists: boolean;
  overrideActive: boolean;
  expiryValid: boolean;
  noActiveConflict: boolean;
  rollbackTargetExists: boolean;
  existingFallbackAvailable: boolean;
  queueInputCompatible: boolean;
  trackRpcCompatible: boolean;
}
export interface TreatmentEligibilityResult { status: EligibilityStatus; blockers: string[]; warnings: string[]; }

// ── Fail-open certification ────────────────────────────────────────────────────
export interface FailOpenCase { name: string; existingPreserved: boolean; }
export interface FailOpenResult { status: CertStatus; total: number; preserved: number; failed: string[]; }

// ── Coverage ────────────────────────────────────────────────────────────────────
export type CoverageStatus = 'SUFFICIENT' | 'PARTIAL' | 'LOW' | 'NO_DATA' | 'INSUFFICIENT_DATA';
export interface CoverageInput {
  storeSessionsEvaluated: number;
  eligibleTreatmentSessions: number;
  controlSessions: number;
  shadowEvaluations: number;
  sameResult: number;
  expectedDivergence: number;
  unexpectedDivergence: number;
  failOpenCount: number;
  resolverErrorCount: number;
  versionMismatchCount: number;
  candidateMissingCount: number;
  assignmentConflictCount: number;
  minSessions: number;
}
export interface CoverageResult { status: CoverageStatus; signalCoverage: number | null; notes: string[] }

// ── Certification score (0..100, advisory — never certainty of playback success) ──
export type CertificationStatus = 'CERTIFIED' | 'READY_WITH_WARNINGS' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export interface CertificationInput {
  control: ControlPreservationResult;
  failOpen: FailOpenResult;
  eligibility: TreatmentEligibilityResult;
  coverage: CoverageResult;
  candidateAvailabilityRate: number | null;   // 0..1
  versionIntegrityRate: number | null;
  assignmentIntegrityRate: number | null;
  resolverErrorRate: number | null;           // 0..1 (lower better)
  queueCompatible: boolean;
  rollbackReady: boolean;
}
export interface CertificationResult {
  status: CertificationStatus;
  score: number | null;
  components: Record<string, number | null>;
  blockers: string[];
  limitations: string[];
  automated: false;
}

// ── Integration readiness (this phase can reach at most READY_FOR_MANUAL_CANARY_REVIEW) ──
export type ReadinessState =
  | 'NOT_READY' | 'SHADOW_ONLY' | 'READY_FOR_PREVIEW_RUNTIME_TEST'
  | 'READY_FOR_MANUAL_CANARY_REVIEW' | 'BLOCKED' | 'INSUFFICIENT_DATA';
export interface ReadinessResult {
  state: ReadinessState;
  reasons: string[];
  risks: string[];
  requiredNextEvidence: string[];
  automated: false;
  actualCanaryStarted: false;
}
