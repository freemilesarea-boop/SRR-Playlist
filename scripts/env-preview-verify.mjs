#!/usr/bin/env node
/**
 * AI-ENV-2 — env-preview-verify (Build-Time Environment Certification)
 *
 * Preview Build 이전에 환경변수 안전성을 검증한다. 실패 시 Build 를 중단(exit 1).
 * 실제 Key 값은 절대 출력하지 않는다(마스킹/불리언만).
 *
 * 사용(Preview Build 전):
 *   VITE_APP_ENV=preview ... node scripts/env-preview-verify.mjs
 * 이 스크립트는 어떤 DB/외부 요청도 하지 않는다. 환경변수만 검사한다.
 */

const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';

function fail(msg) {
  console.error(`\n[env-preview-verify] FAIL: ${msg}`);
  process.exit(1);
}
function parseRef(url) {
  try {
    const host = new URL(url).host;
    if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) return 'local';
    return host.split('.')[0] || null;
  } catch { return null; }
}
function looksLikeServiceRole(key) {
  try {
    const p = key.split('.');
    if (p.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(p[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload?.role === 'service_role';
  } catch { return false; }
}

const appEnv = (process.env.VITE_APP_ENV ?? '').trim().toLowerCase();
const url = (process.env.VITE_SUPABASE_URL ?? '').trim();
const anon = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const expected = (process.env.VITE_EXPECTED_SUPABASE_PROJECT_REF ?? '').trim();

// 이 검증기는 Preview/Test Build 전용. production/local 은 skip(정상 통과).
if (appEnv !== 'preview' && appEnv !== 'test') {
  console.log(`[env-preview-verify] skip — VITE_APP_ENV=${appEnv || '(unset)'} (preview/test 전용 검증)`);
  process.exit(0);
}

if (!url) fail('VITE_SUPABASE_URL 미설정');
if (!anon) fail('VITE_SUPABASE_ANON_KEY 미설정');
if (!expected) fail('VITE_EXPECTED_SUPABASE_PROJECT_REF 미설정');

const ref = parseRef(url);
if (!ref) fail('VITE_SUPABASE_URL 에서 Project Ref 를 추출할 수 없음');
if (ref === PRODUCTION_PROJECT_REF) fail('Preview/Test 가 Production Project Ref 에 연결되어 있음');
if (expected === PRODUCTION_PROJECT_REF) fail('Expected Ref 가 Production Ref 로 설정되어 있음');
if (ref !== expected) fail(`URL Ref(${ref.slice(0, 6)}…) 와 Expected Ref(${expected.slice(0, 6)}…) 불일치`);
if (looksLikeServiceRole(anon)) fail('VITE_SUPABASE_ANON_KEY 가 service_role 키로 보임 — 클라이언트 노출 금지');

// VITE_ 네임스페이스에 service_role 유출 검사.
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('VITE_') && typeof v === 'string' && looksLikeServiceRole(v)) {
    fail(`${k} 에 service_role 키가 포함됨 — VITE_ 네임스페이스에 Service Role 금지`);
  }
}

console.log(`[env-preview-verify] OK — appEnv=preview · ref=${ref.slice(0, 6)}… · anonKeySet=true · production_ref=not_detected`);
process.exit(0);
