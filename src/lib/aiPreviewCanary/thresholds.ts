// AI-MUSIC-7 — Preview canary thresholds & the state-transition allowlist (single source of truth). Constants
// only; NO LLM/ML. Every gate is a MANUAL, approval-gated, preview-only action. Below the sample floors →
// INSUFFICIENT_DATA / NOT_RUN, never a fabricated PASS. A single control divergence caps certification at
// BLOCKED. "Production Ready" is never asserted — max is READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST.

import type { CanaryState } from './types';

// State-transition allowlist. Approval, Arm, and Activate are deliberately separate hops.
export const ALLOWED_TRANSITIONS: Record<CanaryState, CanaryState[]> = {
  DRAFT: ['REVIEW_REQUIRED', 'CANCELLED'],
  REVIEW_REQUIRED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['ARMED', 'CANCELLED', 'EXPIRED'],
  ARMED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['PAUSED', 'STOP_REQUESTED', 'COMPLETED', 'FAILED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'STOP_REQUESTED', 'FAILED', 'EXPIRED'],
  STOP_REQUESTED: ['STOPPED', 'FAILED'],
  STOPPED: ['ROLLBACK_REQUESTED', 'COMPLETED'],
  ROLLBACK_REQUESTED: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: [],   // terminal
  COMPLETED: [],     // terminal
  FAILED: [],        // terminal
  EXPIRED: [],       // terminal
  CANCELLED: [],     // terminal
};
export const TERMINAL_STATES: CanaryState[] = ['ROLLED_BACK', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];
// States in which a canary candidate may be (or become) live and must be resolvable.
export const CANARY_LIVE_STATES: CanaryState[] = ['ACTIVE'];

// Shadow certification must be at least this good before a runtime canary may be approved.
export const MIN_SHADOW_CERT = ['READY_WITH_WARNINGS', 'CERTIFIED', 'CERTIFIED_FOR_INTERNAL_PREVIEW'];

// Candidate queue validation.
export const CANDIDATE_MIN_TRACKS = 5;
export const CANDIDATE_MAX_CHANGE_RATIO_WARN = 0.9;   // near-total replacement → warn

// Evidence / certification sample floors (Sessions).
export const CANARY_MIN_EVIDENCE_SESSIONS = 3;        // internal preview floor (small by design; never "production ready")
export const CANARY_CONFIDENCE_MAX = 70;              // capped low — internal preview only

// Playback guardrail thresholds (recommendation only — never auto-acts).
export const GUARDRAIL = {
  ttfaWarnMs: 3000, ttfaStopMs: 8000,
  transitionGapWarnMs: 1500, transitionGapStopMs: 4000,
} as const;

// Certification score weights (sum = 100). Advisory; control preservation dominant.
export const CERT_WEIGHTS = {
  environmentEnforcement: 20,   // must be ENFORCED
  controlPreservation: 20,      // any divergence → BLOCKED
  approvalIntegrity: 10,
  candidateQueueValidity: 10,
  versionIntegrity: 8,
  snapshotIntegrity: 8,
  failOpenSuccess: 10,
  playbackGuardrails: 6,
  manualDisable: 4,
  rollbackReadiness: 4,
} as const;
export const CERT_INTERNAL_MIN = 85;
export const CERT_READY_WITH_WARNINGS_MIN = 65;

// Event/query safety caps.
export const CANARY_EVENT_BATCH_MAX = 50;
export const CANARY_QUERY_ROW_MAX = 500;
export const CANARY_QUERY_MAX_DAYS = 90;
// Feature-flag defaults are OFF and the kill switch defaults ON (see config.ts). Minimum session cap:
export const CANARY_DEFAULT_MAX_SESSIONS = 1;
