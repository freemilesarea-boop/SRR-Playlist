// AI-MUSIC-11 — Cleanup scope guard (pure logic used by scripts/cleanup-ai-preview-testbed.ts). It only ever
// targets rows carrying the AI_PREVIEW_TESTBED tag, rejects the production project ref, defaults to dry-run, and
// requires explicit confirmation before a scoped delete. It never deletes untagged/customer rows. Pure.

import type { CleanupScopeInput, CleanupScope, CleanupScopeResult, CleanupTag } from './types';
import { isProductionProjectRef } from './environment';

export const CLEANUP_TAG: CleanupTag = 'AI_PREVIEW_TESTBED';

// Dependency-ordered delete targets (children before parents).
export const CLEANUP_TARGETS = [
  'test_canary_session', 'test_canary_run', 'test_allowlist', 'test_evidence', 'test_audit',
  'test_candidate_playlist', 'test_existing_playlist', 'test_store', 'test_auth_account', 'test_storage_object',
];

export function guardCleanup(i: CleanupScopeInput): CleanupScope {
  const mk = (result: CleanupScopeResult, reason: string, targets: string[] = []): CleanupScope => ({ result, targets, reasons: [reason] });

  if (isProductionProjectRef(i.targetProjectRef, i.productionProjectRef)) {
    return mk('REJECTED_PRODUCTION_REF', 'Production Project Ref 거부 — 삭제 절대 금지');
  }
  if (i.tag !== CLEANUP_TAG) return mk('REJECTED_UNTAGGED', `Test Tag(${CLEANUP_TAG}) 대상만 삭제 가능 — 미태그 거부`);
  if (i.dryRun) return mk('DRY_RUN_ONLY', 'Dry-run — 삭제 대상만 나열 (실제 삭제 없음)', CLEANUP_TARGETS);
  if (!i.confirm) return mk('REJECTED_NO_CONFIRM', 'confirm 없음 — 실제 삭제 거부');
  return mk('SCOPED_DELETE', `태그(${CLEANUP_TAG}) 대상만 의존성 순서로 삭제`, CLEANUP_TARGETS);
}
