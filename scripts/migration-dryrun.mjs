#!/usr/bin/env node
/**
 * AI-ENV-2 — migration-dryrun
 *
 * 빈 Local/Test DB 에 supabase/migrations 전체 스택을 파일명 순서대로 적용해
 * Full-Stack Apply 를 검증한다. **Production 대상 금지** — db-test-guard 로 Ref 를
 * 확인한 뒤에만 실행한다. 이 스크립트는 psql 로 실제 SQL 을 적용하므로 반드시
 * 격리된 Test/Local DB URL 로만 실행한다.
 *
 * 사용:
 *   TEST_SUPABASE_PROJECT_REF=<test-ref-or-local> \
 *   DATABASE_URL="postgres://...:5432/postgres" \
 *   node scripts/migration-dryrun.mjs
 *
 * 안전장치:
 *   · DATABASE_URL 에 Production 키워드/Ref 포함 시 거부.
 *   · TEST_SUPABASE_PROJECT_REF 미설정 또는 Production Ref 면 거부.
 *   · --list 옵션은 적용 없이 순서/중복/누락만 검사(무해).
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const listOnly = process.argv.includes('--list');

function fail(msg) { console.error(`\n[migration-dryrun] BLOCKED/FAIL: ${msg}\n`); process.exit(1); }

// ── 순서/중복/누락 검사(적용 없이) ──────────────────────────────────────────
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const prefixes = files.map((f) => f.match(/^(\d+)/)?.[1] ?? f.split('_')[0]);
const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i && /^\d+$/.test(p));
console.log(`[migration-dryrun] ${files.length} migration files. first=${files[0]} last=${files[files.length - 1]}`);
if (dupes.length) console.log(`[migration-dryrun] note — duplicate numeric prefixes (allowlisted in lint): ${[...new Set(dupes)].join(', ')}`);

if (listOnly) { console.log('[migration-dryrun] --list only — no DB applied.'); process.exit(0); }

// ── Target 안전성 가드 ──────────────────────────────────────────────────────
const testRef = (process.env.TEST_SUPABASE_PROJECT_REF ?? '').trim();
const dbUrl = (process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? '').trim();
if (!testRef) fail('TEST_SUPABASE_PROJECT_REF 미설정.');
if (testRef === PRODUCTION_PROJECT_REF) fail('TEST_SUPABASE_PROJECT_REF 가 Production 을 가리킴.');
if (!dbUrl) fail('DATABASE_URL(격리 Test/Local) 미설정.');
if (['prod', 'production', PRODUCTION_PROJECT_REF].some((k) => dbUrl.toLowerCase().includes(k))) {
  fail('DATABASE_URL 이 Production 키워드/Ref 를 포함.');
}

// ── 순차 적용 ───────────────────────────────────────────────────────────────
let applied = 0;
for (const f of files) {
  try {
    execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', join(MIG_DIR, f)], { stdio: ['ignore', 'ignore', 'pipe'] });
    applied += 1;
  } catch (e) {
    const stderr = (e.stderr?.toString() ?? '').split('\n').slice(0, 8).join('\n');
    fail(`migration ${f} 적용 실패 (applied=${applied}/${files.length})\n${stderr}`);
  }
}
console.log(`[migration-dryrun] OK — applied ${applied}/${files.length} migrations to isolated target (${testRef === 'local' ? 'local' : `${testRef.slice(0, 6)}…`}).`);
process.exit(0);
