#!/usr/bin/env node
/**
 * scripts/cleanup-ai-preview-testbed.mjs — AI-MUSIC-11 Preview testbed cleanup (DRY-RUN by default).
 *
 * SAFETY-FIRST. Mirrors the tested guard in src/lib/aiPreviewTestbed/cleanup.ts (guardCleanup). It:
 *   - HARD-REJECTS the production project ref (nsoesrvwkxqifjcxzvol),
 *   - only ever targets rows carrying the AI_PREVIEW_TESTBED tag (never customer/untagged rows),
 *   - defaults to DRY-RUN (lists targets; deletes nothing),
 *   - requires --confirm to delete, AND
 *   - refuses to delete unless an isolated Preview DB is configured (this phase: none).
 *
 * Usage:
 *   node scripts/cleanup-ai-preview-testbed.mjs --project-ref <preview-ref>            # dry-run
 *   node scripts/cleanup-ai-preview-testbed.mjs --project-ref <preview-ref> --confirm  # (refused unless isolated preview DB)
 */

const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
const CLEANUP_TAG = 'AI_PREVIEW_TESTBED';
const CLEANUP_TARGETS = [
  'test_canary_session', 'test_canary_run', 'test_allowlist', 'test_evidence', 'test_audit',
  'test_candidate_playlist', 'test_existing_playlist', 'test_store', 'test_auth_account', 'test_storage_object',
];

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const targetProjectRef = arg('project-ref', null) || process.env.AI_PREVIEW_PROJECT_REF || null;
const tag = arg('tag', CLEANUP_TAG);
const confirm = arg('confirm', false) === true;
const dryRun = !confirm;

function guardCleanup({ targetProjectRef, productionProjectRef, tag, dryRun, confirm }) {
  if (targetProjectRef != null && targetProjectRef.trim() === productionProjectRef.trim())
    return { result: 'REJECTED_PRODUCTION_REF', reason: 'Production Project Ref 거부 — 삭제 절대 금지' };
  if (tag !== CLEANUP_TAG) return { result: 'REJECTED_UNTAGGED', reason: `Test Tag(${CLEANUP_TAG}) 대상만 삭제 가능` };
  if (dryRun) return { result: 'DRY_RUN_ONLY', reason: 'Dry-run — 삭제 대상만 나열' };
  if (!confirm) return { result: 'REJECTED_NO_CONFIRM', reason: 'confirm 없음 — 실제 삭제 거부' };
  return { result: 'SCOPED_DELETE', reason: `태그(${CLEANUP_TAG}) 대상만 의존성 순서로 삭제` };
}

const g = guardCleanup({ targetProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, tag, dryRun, confirm });

console.log('== AI-MUSIC-11 Preview Testbed Cleanup (dry-run default) ==');
console.log(`target project ref : ${targetProjectRef ?? '(unset)'}`);
console.log(`tag                : ${tag}`);
console.log(`mode               : ${dryRun ? 'DRY-RUN' : 'CONFIRM'}`);
console.log(`guard result       : ${g.result} — ${g.reason}`);

if (g.result === 'REJECTED_PRODUCTION_REF') {
  console.error('REFUSED: production project ref. Never delete from production.');
  process.exit(2);
}
if (g.result === 'REJECTED_UNTAGGED') { console.error(`REFUSED: only ${CLEANUP_TAG}-tagged rows may be deleted.`); process.exit(2); }

console.log(`\ndelete targets (tag=${CLEANUP_TAG}, dependency order):`);
for (const t of CLEANUP_TARGETS) console.log(`  - ${t}`);

if (g.result === 'SCOPED_DELETE') {
  console.error('\nREFUSED: no isolated Preview DB is provisioned. Cleanup is DEFERRED until one exists.');
  process.exit(3);
}
console.log('\nDRY-RUN complete. Nothing was deleted.');
process.exit(0);
