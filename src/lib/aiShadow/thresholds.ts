// AI-MUSIC-6 — Shadow resolution & certification thresholds (single source of truth). All constants; NO LLM/ML.
// Below the sample floors the engines return INSUFFICIENT_DATA / NO_DATA — never a fabricated PASS/score.
// A single Control divergence caps certification at BLOCKED. 100 never means real playback success.

// Sample floors (Sessions, not playbacks, not stores).
export const SHADOW_MIN_SESSIONS = 100;              // coverage sufficiency floor
export const CONTROL_MIN_SAMPLES = 30;               // control-preservation judgement floor
export const COVERAGE_PARTIAL_SESSIONS = 40;         // below this → LOW

// Certification score weights (sum = 100). Advisory only.
export const CERT_WEIGHTS = {
  controlPreservation: 30,     // dominant — control must never diverge
  failOpenSuccess: 20,
  candidateAvailability: 10,
  versionIntegrity: 10,
  assignmentIntegrity: 10,
  resolverErrorRate: 10,       // inverted (lower error = higher score)
  coverage: 5,
  queueCompatibility: 3,
  rollbackReadiness: 2,
} as const;

// Score bands → status (only when not BLOCKED by a control divergence).
export const CERT_CERTIFIED_MIN = 90;
export const CERT_READY_WITH_WARNINGS_MIN = 75;
export const CERT_REVIEW_MIN = 50;

// Error-rate ceiling above which resolver integrity is a hard concern.
export const RESOLVER_ERROR_RATE_BLOCK = 0.05;

// Readiness gates.
export const READINESS_PREVIEW_MIN_SCORE = 75;
export const READINESS_CANARY_MIN_SCORE = 90;

// Confidence cap for a single shadow resolution (breadth of checks passed, never certainty).
export const SHADOW_CONFIDENCE_MAX = 85;

// Divergence severity policy.
//  - Treatment candidate selection difference → EXPECTED (INFO)
//  - Control difference → CRITICAL
//  - existing-fallback vs shadow-fallback difference → WARNING
export const DIVERGENCE_SEVERITY: Record<string, 'NONE' | 'INFO' | 'WARNING' | 'CRITICAL'> = {
  SAME_RESULT: 'NONE',
  EXPECTED_TREATMENT_DIVERGENCE: 'INFO',
  UNEXPECTED_CONTROL_DIVERGENCE: 'CRITICAL',
  VERSION_MISMATCH: 'WARNING',
  CANDIDATE_MISSING: 'WARNING',
  POLICY_CONFLICT: 'WARNING',
  SCHEDULE_CONFLICT: 'WARNING',
  ASSIGNMENT_CONFLICT: 'WARNING',
  EXPIRED_OVERRIDE: 'INFO',
  RESOLVER_ERROR: 'WARNING',
  UNKNOWN: 'WARNING',
};

// Event/query safety caps (used by the ingest RPC + client transport).
export const SHADOW_EVENT_BATCH_MAX = 50;            // events per ingest call
export const SHADOW_QUERY_ROW_MAX = 500;             // rows per admin read
export const SHADOW_QUERY_MAX_DAYS = 90;             // time-range cap
export const SHADOW_DEFAULT_SAMPLING_RATE = 0.1;     // fraction of eligible sessions evaluated (default flag value)
