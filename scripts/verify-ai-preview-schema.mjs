#!/usr/bin/env node
/**
 * scripts/verify-ai-preview-schema.mjs — AI-MUSIC-12 Preview schema/connection verifier (read-only planner).
 *
 * Read-only. HARD-REJECTS the production project ref, and (this phase) reports NOT_DEPLOYED because no isolated
 * Preview backend exists yet. It NEVER writes and NEVER prints raw secrets. When an isolated backend exists, a
 * future run would check: frontend/server project ref ≠ production, base tables + _is_super_admin() present,
 * testbed flags OFF, kill switch ON.
 *
 * Usage:
 *   node scripts/verify-ai-preview-schema.mjs --project-ref <preview-ref>
 */
const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
const targetProjectRef = arg('project-ref', null) || process.env.AI_PREVIEW_PROJECT_REF || null;

console.log('== AI-MUSIC-12 Preview Schema/Connection Verifier (read-only) ==');
console.log(`target project ref : ${targetProjectRef ?? '(unset)'}`);
if (targetProjectRef != null && targetProjectRef.trim() === PRODUCTION_PROJECT_REF) {
  console.error('REFUSED: production project ref. This verifier never targets production.');
  process.exit(2);
}
const CHECKS = [
  'frontend Supabase project ref ≠ production',
  'server Supabase project ref ≠ production',
  'base tables present (stores/auth/playlist/...)',
  '_is_super_admin() present',
  'AI migrations 0464-0470 applied (preview)',
  'testbed flags OFF · kill switch ON',
];
console.log('\nplanned checks (would run against an isolated Preview backend):');
for (const c of CHECKS) console.log(`  - ${c}`);
console.log('\nstatus: NOT_DEPLOYED — no isolated Preview backend is provisioned this phase. Verification is DEFERRED.');
process.exit(0);
