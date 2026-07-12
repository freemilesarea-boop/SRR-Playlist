// AI-MUSIC-12 — Preview migration runner guard (pure; used by scripts/apply-ai-preview-migrations.mjs). It
// HARD-REJECTS the production project ref, refuses a shared/non-isolated DB, defaults to dry-run, and requires an
// explicit --confirm-preview to apply. It NEVER applies to production. Pure & deterministic.

import type { MigrationRunnerInput, MigrationRunnerGuard, MigrationRunnerResult } from './types';

export function guardMigrationRunner(i: MigrationRunnerInput): MigrationRunnerGuard {
  const mk = (result: MigrationRunnerResult, wouldApply: boolean, reason: string): MigrationRunnerGuard => ({ result, wouldApply, reasons: [reason] });

  if (i.targetProjectRef != null && i.targetProjectRef.trim() === i.productionProjectRef.trim()) {
    return mk('REJECTED_PRODUCTION_REF', false, 'Production Project Ref 거부 — Migration 적용 절대 금지');
  }
  if (i.isolationStatus === 'SHARED_PROJECT' || i.isolationStatus === 'SHARED_DB' || i.isolationStatus === 'PRODUCTION_SCOPE') {
    return mk('REJECTED_SHARED_DB', false, 'Shared/Production DB — Migration 적용 거부');
  }
  if (i.isolationStatus !== 'ISOLATED') {
    return mk('REJECTED_NOT_ISOLATED', false, `격리되지 않은 Backend (${i.isolationStatus}) — Apply 금지 (Validation/Dry-run 만)`);
  }
  if (i.dryRun) return mk('DRY_RUN', false, 'Dry-run — 계획/순서만 검증, 적용 없음');
  if (!i.confirmPreview) return mk('REJECTED_NO_CONFIRM', false, '--confirm-preview 없음 — 실제 적용 거부');
  return mk('ALLOWED_PREVIEW_APPLY', true, '격리 Preview DB + confirm — 순서대로 적용 허용 (checksum/already-applied 확인)');
}
