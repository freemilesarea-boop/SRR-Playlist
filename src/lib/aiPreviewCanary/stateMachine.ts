// AI-MUSIC-7 — Canary state machine. Strict allowlist; anything not listed is REJECTED. Approval, Arm, and
// Activate are separate hops (DRAFT→REVIEW_REQUIRED→APPROVED→ARMED→ACTIVE) — approval alone can never activate.
// Terminal states cannot re-activate. Pure — the caller records actor + timestamp on the audit trail.

import { ALLOWED_TRANSITIONS, TERMINAL_STATES } from './thresholds';
import type { CanaryState, CanaryTransition } from './types';

export function canTransition(from: CanaryState, to: CanaryState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
export function transition(from: CanaryState, to: CanaryState): CanaryTransition {
  if (from === to) return { ok: false, from, to, reason: '동일 상태 전이 불가' };
  if (TERMINAL_STATES.includes(from)) return { ok: false, from, to, reason: `terminal 상태(${from})에서 전이 불가` };
  if (canTransition(from, to)) return { ok: true, from, to, reason: '허용 전이' };
  return { ok: false, from, to, reason: `금지 전이: ${from} → ${to}` };
}
export function allowedNext(from: CanaryState): CanaryState[] { return [...(ALLOWED_TRANSITIONS[from] ?? [])]; }
export function isTerminal(state: CanaryState): boolean { return TERMINAL_STATES.includes(state); }
