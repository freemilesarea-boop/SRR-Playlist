// AI-MUSIC-12 — Environment rebinding state machine. Enforces that you cannot jump to VERIFIED without going
// through creation → schema → env-bind → redeploy → connection checks. Forbidden shortcuts are rejected. Pure.

import type { RebindingState } from './types';

const LEGAL: Record<RebindingState, RebindingState[]> = {
  AUDIT_ONLY: ['PLAN_READY', 'BLOCKED'],
  PLAN_READY: ['PROVISIONING_REQUIRED', 'BLOCKED'],
  PROVISIONING_REQUIRED: ['BACKEND_CREATED', 'BLOCKED'],
  BACKEND_CREATED: ['SCHEMA_PENDING', 'BLOCKED', 'ROLLBACK_REQUIRED'],
  SCHEMA_PENDING: ['SCHEMA_READY', 'BLOCKED', 'ROLLBACK_REQUIRED'],
  SCHEMA_READY: ['ENV_PENDING', 'BLOCKED', 'ROLLBACK_REQUIRED'],
  ENV_PENDING: ['ENV_BOUND', 'BLOCKED', 'ROLLBACK_REQUIRED'],
  ENV_BOUND: ['REDEPLOY_REQUIRED', 'ROLLBACK_REQUIRED', 'BLOCKED'],   // NOT → VERIFIED directly
  REDEPLOY_REQUIRED: ['CONNECTED', 'ROLLBACK_REQUIRED', 'BLOCKED'],
  CONNECTED: ['VERIFIED', 'ROLLBACK_REQUIRED', 'BLOCKED'],
  VERIFIED: ['ROLLBACK_REQUIRED'],
  BLOCKED: ['ROLLBACK_REQUIRED', 'AUDIT_ONLY'],                       // BLOCKED never → VERIFIED
  ROLLBACK_REQUIRED: ['ROLLED_BACK'],
  ROLLED_BACK: ['AUDIT_ONLY'],
};

export function canRebindingTransition(from: RebindingState, to: RebindingState): boolean {
  return LEGAL[from]?.includes(to) ?? false;
}

export function nextRebindingStates(from: RebindingState): RebindingState[] {
  return LEGAL[from] ?? [];
}
