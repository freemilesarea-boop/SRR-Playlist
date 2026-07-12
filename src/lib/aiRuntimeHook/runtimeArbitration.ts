// AI-MUSIC-9 — Runtime arbitration. In the real runtime a reservation must yield to existing resolvers and
// safety conditions: recovery in progress, an existing policy/schedule revision change after the reservation,
// a kill switch, a session/deployment/version change, or an existing-queue revision change. A pilot candidate
// never permanently replaces the existing resolver — it may apply once at a safe boundary, otherwise it is
// staled, cancelled, or deferred. Pure & deterministic; evaluates in a fixed precedence so the outcome is
// reproducible.

import type { RuntimeArbitrationInput, RuntimeArbitrationResult, RuntimeArbitrationOutcome } from './types';

export function resolveRuntimeArbitration(i: RuntimeArbitrationInput): RuntimeArbitrationResult {
  const r = i.reservation;
  const out = (outcome: RuntimeArbitrationOutcome, reason: string): RuntimeArbitrationResult => ({ outcome, reasons: [reason] });

  if (r.state === 'CANCELLED' || r.state === 'REJECTED' || r.state === 'EXPIRED' || r.state === 'SUPERSEDED') {
    return out('NO_CANDIDATE', `예약 상태 ${r.state}`);
  }
  // Hard cancels (highest precedence).
  if (i.killSwitch) return out('CANDIDATE_CANCELLED', 'Kill Switch — Candidate 취소');
  if (i.sessionChanged) return out('CANDIDATE_CANCELLED', 'Session 변경 — Candidate 취소');
  if (i.deploymentChanged) return out('CANDIDATE_CANCELLED', 'Deployment 변경 — Candidate 취소');
  if (i.candidateVersionChanged) return out('CANDIDATE_CANCELLED', 'Candidate Version 변경 — Candidate 취소');

  // Recovery must not be overridden — defer.
  if (i.recoveryActive) return out('CANDIDATE_DEFERRED', 'Recovery 진행 — Candidate 연기');

  // Existing resolver changed after the reservation → the candidate is stale.
  if (i.policyRevisionChanged) return out('CANDIDATE_STALE', 'Franchise Policy Revision 변경 — Candidate Stale');
  if (i.scheduleRevisionChanged) return out('CANDIDATE_STALE', 'Business Schedule Revision 변경 — Candidate Stale');
  if (i.existingQueueRevisionChanged) return out('CANDIDATE_STALE', 'Existing Queue Revision 변경 — Candidate 재검증 필요 (Stale)');

  if (r.appliedCount >= r.maxApplyCount) return out('EXISTING_WINS', 'Application Cap 도달 — 기존 Resolver 유지');

  return out('CANDIDATE_MAY_APPLY', '충돌 없음 — 안전 경계에서 1회 적용 가능');
}
