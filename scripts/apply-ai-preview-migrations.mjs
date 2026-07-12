#!/usr/bin/env node
/**
 * scripts/apply-ai-preview-migrations.mjs — AI-MUSIC-12 Preview migration runner (DRY-RUN planner).
 *
 * SAFETY-FIRST. Mirrors src/lib/aiPreviewBackend/migrationRunner.ts (guardMigrationRunner). It:
 *   - HARD-REJECTS the production project ref (nsoesrvwkxqifjcxzvol, exit 2),
 *   - refuses a shared/non-isolated DB,
 *   - defaults to DRY-RUN (applies nothing; prints the ordered plan),
 *   - requires --isolation ISOLATED AND --confirm-preview to apply, AND
 *   - refuses to apply this phase because no isolated Preview backend is provisioned.
 *
 * Usage:
 *   node scripts/apply-ai-preview-migrations.mjs --project-ref <preview-ref> --isolation ISOLATED             # dry-run
 *   node scripts/apply-ai-preview-migrations.mjs --project-ref <preview-ref> --isolation ISOLATED --confirm-preview  # (refused: no isolated backend)
 */
const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
const ORDER = ['BASE', '0464', '0465', '0466', '0467', '0468', '0469', '0470'];

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
const targetProjectRef = arg('project-ref', null) || process.env.AI_PREVIEW_PROJECT_REF || null;
const isolation = arg('isolation', 'UNKNOWN');
const confirmPreview = arg('confirm-preview', false) === true;
const dryRun = !confirmPreview;

function guard() {
  if (targetProjectRef != null && targetProjectRef.trim() === PRODUCTION_PROJECT_REF)
    return { result: 'REJECTED_PRODUCTION_REF', reason: 'Production Project Ref 거부 — Migration 적용 절대 금지' };
  if (isolation === 'SHARED_PROJECT' || isolation === 'SHARED_DB' || isolation === 'PRODUCTION_SCOPE')
    return { result: 'REJECTED_SHARED_DB', reason: 'Shared/Production DB — 적용 거부' };
  if (isolation !== 'ISOLATED') return { result: 'REJECTED_NOT_ISOLATED', reason: `격리되지 않음 (${isolation}) — Validation/Dry-run 만` };
  if (dryRun) return { result: 'DRY_RUN', reason: 'Dry-run — 순서만 검증, 적용 없음' };
  if (!confirmPreview) return { result: 'REJECTED_NO_CONFIRM', reason: '--confirm-preview 없음' };
  return { result: 'ALLOWED_PREVIEW_APPLY', reason: '격리 Preview DB + confirm' };
}
const g = guard();

console.log('== AI-MUSIC-12 Preview Migration Runner (dry-run planner) ==');
console.log(`target project ref : ${targetProjectRef ?? '(unset)'}`);
console.log(`isolation          : ${isolation}`);
console.log(`mode               : ${dryRun ? 'DRY-RUN' : 'CONFIRM'}`);
console.log(`guard result       : ${g.result} — ${g.reason}`);
if (g.result === 'REJECTED_PRODUCTION_REF') { console.error('REFUSED: production project ref.'); process.exit(2); }

console.log(`\nordered plan (NOT applied):\n  ${ORDER.join(' → ')}`);
console.log('  (BASE = base schema incl. _is_super_admin(); 0470 depends on 0468/0469)');

if (g.result === 'ALLOWED_PREVIEW_APPLY') {
  console.error('\nREFUSED: no isolated Preview backend is provisioned this phase. Apply is DEFERRED.');
  process.exit(3);
}
console.log('\nDRY-RUN complete. Nothing was applied. Never applies to production.');
process.exit(0);
