// AI-MUSIC-11 — Test window / operator plan validator. A full plan needs start/end, operator, reviewer, rollback
// operator, and stop/rollback conditions; without a real schedule it is a DRAFT. Pure & deterministic.

import type { TestWindowPlan, TestWindowResult } from './types';

export const DEFAULT_STOP_CONDITIONS = [
  'Double Playback', 'Unexpected Pause', 'Queue Empty', 'Current Time Reset', 'Current Track Change',
  'Crossfade Error', 'Recovery Failure', 'Media Error', 'Runtime Observer Error', 'Candidate Snapshot Mismatch',
];

export function validateTestWindow(p: TestWindowPlan): TestWindowResult {
  const missing: string[] = [];
  if (p.testStartMs == null) missing.push('test_start');
  if (p.testEndMs == null) missing.push('test_end');
  if (!p.operator) missing.push('operator');
  if (!p.reviewer) missing.push('reviewer');
  if (!p.rollbackOperator) missing.push('rollback_operator');
  if (p.stopConditions.length === 0) missing.push('stop_conditions');
  if (p.rollbackConditions.length === 0) missing.push('rollback_conditions');
  if (p.maxSessions !== 1) missing.push('max_sessions=1');

  if (missing.length === 0) return { status: 'PLANNED', missing: [] };
  // If nothing at all is set, it's a pure draft; if partially set, INCOMPLETE.
  const anySet = p.testStartMs != null || p.operator != null || p.reviewer != null;
  return { status: anySet ? 'INCOMPLETE' : 'DRAFT', missing };
}
