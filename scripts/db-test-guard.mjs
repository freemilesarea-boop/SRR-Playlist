#!/usr/bin/env node
/**
 * AI-ENV-1 — db-test-guard
 *
 * Test DB 대상 명령(push/reset/seed)이 실수로 Production 을 겨냥하지 못하게 하는 가드.
 * Production Project Ref 또는 Production 키워드를 감지하면 즉시 종료(exit 1).
 *
 * 사용: db:test:* npm 스크립트가 실제 supabase/psql 명령 앞에 이 가드를 실행한다.
 *   node scripts/db-test-guard.mjs
 * 필요 환경변수:
 *   TEST_SUPABASE_PROJECT_REF   격리 Test 프로젝트 Ref (필수, 'local' 허용)
 *   SUPABASE_DB_URL 또는 TEST_DATABASE_URL  대상 DB URL (선택 — Ref 교차검증)
 *
 * 이 스크립트는 어떤 Migration 도 실제로 적용하지 않는다. Target 안전성만 검증한다.
 */

const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
const PRODUCTION_KEYWORDS = ['prod', 'production', PRODUCTION_PROJECT_REF];

function fail(msg) {
  console.error(`\n[db-test-guard] BLOCKED: ${msg}`);
  console.error('[db-test-guard] Test DB 명령은 격리된 Test/Local 대상에서만 허용됩니다. Production 금지.\n');
  process.exit(1);
}

const testRef = (process.env.TEST_SUPABASE_PROJECT_REF ?? '').trim();
const dbUrl = (process.env.TEST_DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? '').trim();

if (!testRef) {
  fail('TEST_SUPABASE_PROJECT_REF 미설정 — 대상 Test 프로젝트를 명시해야 합니다.');
}
if (testRef === PRODUCTION_PROJECT_REF || PRODUCTION_KEYWORDS.some((k) => testRef.toLowerCase() === k)) {
  fail(`TEST_SUPABASE_PROJECT_REF 가 Production(${testRef}) 을 가리킵니다.`);
}
if (dbUrl && PRODUCTION_KEYWORDS.some((k) => dbUrl.toLowerCase().includes(k))) {
  fail(`대상 DB URL 이 Production 키워드를 포함합니다.`);
}

// 통과 — 실제 명령은 호출측(package.json)에서 && 로 이어서 실행한다.
console.log(`[db-test-guard] OK — target ref: ${testRef === 'local' ? 'local' : `${testRef.slice(0, 6)}…`}`);
process.exit(0);
