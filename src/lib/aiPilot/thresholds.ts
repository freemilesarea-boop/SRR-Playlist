// AI-MUSIC-5 — Pilot orchestration thresholds & the state-transition allowlist (single source of truth).
//
// Rule-based ONLY — NO LLM/ML. Every number/allowlist drives a *manual, approval-gated* action, never an
// automatic pilot start / assignment / deploy / expansion / stop / rollback. Below the sample floors the
// engines return INSUFFICIENT_DATA / NO_DATA / NOT_AVAILABLE. Store / Session / Playback counts stay distinct.

import type { PilotState, StopKind } from './types';

// ── State-transition allowlist (everything not listed is REJECTED) ──────────────
export const ALLOWED_TRANSITIONS: Record<PilotState, PilotState[]> = {
  DRAFT: ['REVIEW_REQUIRED', 'APPROVED', 'CANCELLED'],
  REVIEW_REQUIRED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'CANCELLED', 'EXPIRED'],
  SCHEDULED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['PAUSED', 'STOP_REQUESTED', 'COMPLETED', 'FAILED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'STOP_REQUESTED', 'FAILED', 'EXPIRED'],
  STOP_REQUESTED: ['STOPPED', 'FAILED'],
  STOPPED: ['ROLLBACK_REQUESTED', 'COMPLETED'],
  ROLLBACK_REQUESTED: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: [],        // terminal
  COMPLETED: [],          // terminal
  CANCELLED: [],          // terminal
  FAILED: [],             // terminal
  EXPIRED: [],            // terminal
};
export const TERMINAL_STATES: PilotState[] = ['ROLLED_BACK', 'COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED'];
// States in which a treatment override is (or may become) live and must be resolvable.
export const OVERRIDE_LIVE_STATES: PilotState[] = ['ACTIVE'];

// ── Approval gate ───────────────────────────────────────────────────────────────
export const REQUIRED_PLAN_STATUS = 'APPROVED_FOR_MANUAL_SETUP';

// ── Activation / completion sample gates ────────────────────────────────────────
export const PILOT_MIN_DURATION_DAYS = 7;
export const PILOT_MAX_DURATION_DAYS = 28;
export const PILOT_MIN_SESSIONS = 200;       // per pilot (Sessions, not playbacks, not stores)
export const PILOT_MIN_PLAYBACKS = 1000;

// ── Observation windows (fraction of total duration) ────────────────────────────
export const OBSERVATION_WINDOWS: Array<{ window: 'BASELINE' | 'EARLY' | 'MID' | 'LATE' | 'FINAL'; upTo: number }> = [
  { window: 'BASELINE', upTo: 0.0 },
  { window: 'EARLY', upTo: 0.25 },
  { window: 'MID', upTo: 0.6 },
  { window: 'LATE', upTo: 0.9 },
  { window: 'FINAL', upTo: 1.0 },
];
export const OBSERVATION_INTERVAL_MS = 6 * 60 * 60 * 1000;   // suggested 6h between snapshots (read-only rollup)

// ── Guardrail monitor thresholds (recommendation only — never auto-acts) ────────
export const GUARDRAIL_MON = {
  streamingDropWarn: 3, streamingDropStop: 8,
  stallIncreaseWarn: 0.02, stallIncreaseStop: 0.05,
  mediaErrorIncreaseWarn: 0.01, mediaErrorIncreaseStop: 0.03,
  recoveryFailIncreaseStop: 0.03,
  skipIncreaseStop: 0.1,
  dislikeIncreaseStop: 0.05,
} as const;

// ── Stop kinds that originate from a guardrail/contamination/incident recommendation ──
export const RECOMMENDED_STOP_KINDS: StopKind[] = ['GUARDRAIL_STOP', 'CONTAMINATION_STOP', 'INCIDENT_STOP'];

// ── Confidence (evidence breadth, capped — never certainty) ─────────────────────
export const PROGRESS_CONFIDENCE_FULL_SESSIONS = 2000;
export const PILOT_CONFIDENCE_MAX = 88;
