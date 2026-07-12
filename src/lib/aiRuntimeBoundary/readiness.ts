// AI-MUSIC-10 — Runtime hook readiness re-evaluation. This ONLY re-evaluates the boundary-observability No-Go
// condition from AI-MUSIC-9 — it does NOT implement any runtime hook. Without an internal test store + applied
// Preview migration, the maximum reachable status is BOUNDARY_OBSERVABILITY_READY (never a single-store CR).
// Pure & deterministic.

import type { HookReadinessInput, HookReadinessResult, HookReadinessStatus } from './types';

export function computeHookReadiness(i: HookReadinessInput): HookReadinessResult {
  const satisfied: string[] = [];
  const blockers: string[] = [];
  const check = (ok: boolean, label: string) => { (ok ? satisfied : blockers).push(label); return ok; };

  const observability =
    check(i.crossfadeObservable, 'Crossfade 관측') &&
    check(i.recoveryObservable, 'Recovery 관측') &&
    check(i.preloadObservable, 'Preload 관측') &&
    check(i.audioSwapObservable, 'Audio Swap 관측') &&
    check(i.stableBoundaryEngine, 'Stable Boundary Engine') &&
    check(i.revisionStaleProtection, 'Revision / Stale Protection') &&
    check(i.sessionAttribution, 'Session Attribution') &&
    check(i.zeroControlGuaranteed, 'Zero-control Guarantee') &&
    check(i.observerFailOpen, 'Observer Fail-open') &&
    check(i.sequenceValidation, 'Sequence Validation') &&
    check(i.sufficientTestCoverage, '충분한 Test Coverage');

  const base = { runtimeHookImplemented: false as const, satisfied, blockers };
  const nextRequiredEvidence = [
    '실제 Browser Runtime 관측 (Preview Manual QA)로 Boundary Coverage 확보',
    '내부 Test Store 구성',
    'Preview Migration 적용 (Canary Resolver RPC)',
  ];

  let status: HookReadinessStatus;
  if (!observability) status = i.sufficientTestCoverage ? 'NOT_READY' : 'INSUFFICIENT_DATA';
  else if (i.internalTestStoreConfigured && i.previewMigrationApplied) status = 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST';
  else status = 'BOUNDARY_OBSERVABILITY_READY';   // capped — no store/migration this phase

  return { ...base, status, nextRequiredEvidence };
}
