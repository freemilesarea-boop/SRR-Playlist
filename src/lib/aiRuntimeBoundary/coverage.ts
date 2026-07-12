// AI-MUSIC-10 — Boundary coverage. Measures how much of the runtime boundary state space was actually observed.
// Without a real browser runtime (no session observed) the status is NO_DATA — never a fabricated SUFFICIENT.
// Pure & deterministic.

import type { BoundaryCoverageInput, BoundaryCoverageResult, CoverageStatus } from './types';

// Distinct boundary states the bridge can, in principle, observe (crossfade 6 + recovery 5 + preload 6 + swap 5).
const TOTAL_OBSERVABLE_STATES = 22;

export function computeBoundaryCoverage(i: BoundaryCoverageInput): BoundaryCoverageResult {
  if (!i.browserRuntimeRan || i.snapshots <= 0) {
    return { status: 'NO_DATA', stateCoveragePct: null, reasons: ['Browser Runtime 미실행 — 관측 데이터 없음 (NO_DATA)'] };
  }
  const transitions = i.crossfadeTransitions + i.recoveryTransitions + i.preloadTransitions + i.swapTransitions;
  const stateCoveragePct = Math.round((Math.min(i.distinctStatesSeen, TOTAL_OBSERVABLE_STATES) / TOTAL_OBSERVABLE_STATES) * 100);

  let status: CoverageStatus;
  if (i.sessionsObserved <= 0 || transitions <= 0) status = 'INSUFFICIENT_DATA';
  else if (stateCoveragePct >= 70 && i.sessionsObserved >= 1 && transitions >= 8) status = 'SUFFICIENT';
  else if (stateCoveragePct >= 40) status = 'PARTIAL';
  else status = 'LOW';

  const reasons = [`${i.snapshots} snapshots · ${transitions} transitions · ${i.distinctStatesSeen}/${TOTAL_OBSERVABLE_STATES} states · ${i.staleEvents} stale · ${i.observerErrors} errors`];
  return { status, stateCoveragePct, reasons };
}
