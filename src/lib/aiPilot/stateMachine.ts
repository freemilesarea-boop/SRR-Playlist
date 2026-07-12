// AI-MUSIC-5 — Pilot Execution State Machine. A strict allowlist governs transitions; anything not listed is
// REJECTED. Terminal states cannot be re-activated (DRAFT/REVIEW_REQUIRED/COMPLETED/CANCELLED/EXPIRED → ACTIVE
// are all forbidden). Pure — the caller records actor + timestamp on the audit trail; this engine only
// decides validity.

import { ALLOWED_TRANSITIONS, TERMINAL_STATES } from './thresholds';
import type { PilotState, TransitionResult } from './types';

export function canTransition(from: PilotState, to: PilotState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function transition(from: PilotState, to: PilotState): TransitionResult {
  if (from === to) return { ok: false, from, to, reason: '동일 상태 전이 불가' };
  if (TERMINAL_STATES.includes(from)) return { ok: false, from, to, reason: `terminal 상태(${from})에서 전이 불가` };
  if (canTransition(from, to)) return { ok: true, from, to, reason: '허용 전이' };
  return { ok: false, from, to, reason: `금지 전이: ${from} → ${to}` };
}

export function allowedNext(from: PilotState): PilotState[] {
  return [...(ALLOWED_TRANSITIONS[from] ?? [])];
}

export function isTerminal(state: PilotState): boolean {
  return TERMINAL_STATES.includes(state);
}
