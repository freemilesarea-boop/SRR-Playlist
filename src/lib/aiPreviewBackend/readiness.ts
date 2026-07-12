// AI-MUSIC-12 — Provisioning readiness certification. `ISOLATED_BACKEND_READY` is reachable ONLY when an actual
// isolated backend has been created + connected + verified. Without a created backend, the maximum is
// READY_TO_PROVISION / MANUAL_ACTION_REQUIRED. This phase (no backend created, cost-bearing branch, no env-
// mutation tool) reaches at most MANUAL_ACTION_REQUIRED. No runtime hook is implemented. Pure & deterministic.

import type { ProvisioningReadinessInput, ProvisioningReadinessResult, ProvisioningReadinessStatus } from './types';

export function computeProvisioningReadiness(i: ProvisioningReadinessInput): ProvisioningReadinessResult {
  const satisfied: string[] = [];
  const missing: string[] = [];
  const check = (ok: boolean, label: string) => { (ok ? satisfied : missing).push(label); return ok; };

  const planReady =
    check(i.backendTypeSelected, 'Backend Type 선택') &&
    check(i.schemaStrategyReady, 'Schema Baseline 전략') &&
    check(i.migrationGraphValid, 'Migration Graph 유효') &&
    check(i.migrationRunnerReady, 'Migration Runner (dry-run)') &&
    check(i.envPlanReady, 'Vercel Preview Env Rebinding Plan') &&
    check(i.rollbackReady, 'Rollback Plan') &&
    check(i.cleanupReady, 'Cleanup Plan') &&
    check(i.securityReady, 'Security');

  check(i.costPlanKnown, 'Cost/Plan 확인');
  const created = check(i.backendCreated, 'Isolated Backend 생성');
  const isolated = check(i.dbIsolated, 'DB 격리') && check(i.authIsolated, 'Auth 격리') && check(i.storageIsolated, 'Storage 격리');
  check(i.productionInvariant, 'Production Invariance');
  const connected = check(i.connectionVerified, 'Connection Verified');

  const manualActions = [
    '격리 Preview Backend provisioning (별도 Test Project srr-playlist-preview 또는 Supabase Branch) — 비용/승인 확인 후 수동',
    'Vercel Preview scope 에만 Preview Backend 환경변수 바인딩 (Production scope 변경 금지) + Redeploy',
    '새 Preview Deployment 연결 검증 (Project Ref ≠ Production, Base Schema, Flags OFF, Kill Switch ON)',
    'Preview Migration 0464~0470 적용 (격리 DB) — dry-run 후 --confirm-preview',
  ];
  const base = { satisfied, missing, manualActions, nextPhase: 'AI-MUSIC-13: Preview Testbed Seeding & Single-store Runtime Proof', runtimeHookImplemented: false as const };

  let status: ProvisioningReadinessStatus;
  if (created && isolated && connected && i.productionInvariant) status = 'ISOLATED_BACKEND_READY';
  else if (created && isolated && i.envPlanReady) status = 'READY_TO_APPLY_PREVIEW_SCHEMA';
  else if (created && i.envPlanReady) status = 'READY_TO_BIND';
  else if (planReady) status = 'READY_TO_PROVISION';   // plan complete, but a manual cost-bearing provision is next
  else if (missing.length > 8) status = 'BLOCKED';
  else status = 'MANUAL_ACTION_REQUIRED';

  // Never report ISOLATED_BACKEND_READY without an actually created + verified backend.
  if (status === 'ISOLATED_BACKEND_READY' && !(created && connected)) status = 'MANUAL_ACTION_REQUIRED';
  // A plan that is ready but needs a manual cost-bearing provision surfaces as MANUAL_ACTION_REQUIRED unless created.
  if (status === 'READY_TO_PROVISION' && !created) status = 'MANUAL_ACTION_REQUIRED';

  return { ...base, status };
}
