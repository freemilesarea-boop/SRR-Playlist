#!/usr/bin/env node
/**
 * scripts/seed-ai-preview-testbed.mjs — AI-MUSIC-11 Preview testbed seeder (DRY-RUN planner).
 *
 * SAFETY-FIRST. This script NEVER touches production. It mirrors the tested guard in
 * src/lib/aiPreviewTestbed/seeder.ts (guardSeeder) as the CLI entrypoint. It:
 *   - HARD-REJECTS the production project ref (nsoesrvwkxqifjcxzvol) unconditionally,
 *   - requires --project-ref <preview-ref> and --environment preview,
 *   - defaults to DRY-RUN (writes nothing; prints the plan),
 *   - requires --confirm-preview to actually write, AND
 *   - refuses to write unless a genuinely isolated Preview DB is configured.
 *
 * This phase has NO isolated Preview DB (Preview shares the production Supabase), so an actual seed is
 * DEFERRED — running with --confirm-preview will still refuse. All test data uses the INTERNAL_AI_CANARY_STORE_
 * / test- prefixes, carries the AI_PREVIEW_TESTBED tag + an expiry, and is cleaned up by cleanup-ai-preview-testbed.mjs.
 *
 * Usage:
 *   node scripts/seed-ai-preview-testbed.mjs --project-ref <preview-ref> --environment preview            # dry-run
 *   node scripts/seed-ai-preview-testbed.mjs --project-ref <preview-ref> --environment preview --confirm-preview  # (refused unless isolated preview DB)
 */

const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
const TEST_TAG = 'AI_PREVIEW_TESTBED';

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const targetProjectRef = arg('project-ref', null) || process.env.AI_PREVIEW_PROJECT_REF || null;
const environment = arg('environment', null) || process.env.AI_PREVIEW_ENV || null;
const confirmPreview = arg('confirm-preview', false) === true;
const dryRun = !confirmPreview;

function guardSeeder({ targetProjectRef, productionProjectRef, environment, confirmPreview, dryRun }) {
  if (targetProjectRef != null && targetProjectRef.trim() === productionProjectRef.trim())
    return { result: 'REJECTED_PRODUCTION_REF', wouldWrite: false, reason: 'Production Project Ref 거부 — Test Data 생성 절대 금지' };
  if (targetProjectRef == null || environment !== 'preview')
    return { result: 'REJECTED_NOT_PREVIEW', wouldWrite: false, reason: 'Preview 환경/Project Ref 미확인 — 실행 거부' };
  if (dryRun) return { result: 'ALLOWED_DRY_RUN', wouldWrite: false, reason: 'Dry-run — 아무것도 쓰지 않음 (계획만 출력)' };
  if (!confirmPreview) return { result: 'REJECTED_NO_CONFIRM', wouldWrite: false, reason: '--confirm-preview 없음 — 실제 write 거부' };
  return { result: 'ALLOWED_PREVIEW', wouldWrite: true, reason: 'Preview 확인 + confirm' };
}

const g = guardSeeder({ targetProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, environment, confirmPreview, dryRun });

console.log('== AI-MUSIC-11 Preview Testbed Seeder (dry-run planner) ==');
console.log(`target project ref : ${targetProjectRef ?? '(unset)'}`);
console.log(`environment        : ${environment ?? '(unset)'}`);
console.log(`mode               : ${dryRun ? 'DRY-RUN' : 'CONFIRM'}`);
console.log(`guard result       : ${g.result} — ${g.reason}`);

if (g.result === 'REJECTED_PRODUCTION_REF') {
  console.error('REFUSED: production project ref. Never seed test data into production.');
  process.exit(2);
}

const PLAN = [
  `test store   : INTERNAL_AI_CANARY_STORE_01 (environment=preview, test_only, tag=${TEST_TAG}, expiry required)`,
  'test account : ai+canary@<test-domain> (store_player, test_only, production_access=false, expiry required)',
  'existing pl  : pl-existing (>=5 test- tracks, snapshot pinned) — rollback target',
  'candidate pl : pl-candidate (>=5 tracks, shares 2-3 with existing, version + snapshot pinned, immutable)',
  'allowlist    : single store, deployment-bound, max_sessions=1, enabled=false, kill switch ON, expiry required',
];
console.log('\nplanned fixtures (NOT written):');
for (const p of PLAN) console.log(`  - ${p}`);

// Even with --confirm-preview, refuse until an isolated Preview DB is provisioned (this phase: none).
if (g.wouldWrite) {
  console.error('\nREFUSED: no isolated Preview DB is provisioned (Preview shares the production Supabase).');
  console.error('Provision a separate Supabase Test Project or a Supabase branch first (see docs/AI-MUSIC-11-PREVIEW-TESTBED.md).');
  process.exit(3);
}
console.log('\nDRY-RUN complete. Nothing was written. Actual seeding is DEFERRED until an isolated Preview DB exists.');
process.exit(0);
