#!/usr/bin/env node
/**
 * lint-rpc-registry.mjs — PLATFORM-HOTFIX-1 CI guard.
 *
 * 목적: 클라이언트/운영 코드에서 호출하는 supabase.rpc('<name>') 이름이
 *   (1) Repository SQL 에 CREATE FUNCTION 으로 정의되어 있거나
 *   (2) 승인된 remote-only 허용목록(rpc-remote-only-allowlist.json)에 있어야 한다.
 * 둘 다 아니면 = 신규 undefined RPC → 실패(exit 1). 런타임 PGRST202 회귀 방지.
 *
 * 또한 허용목록에 있으나 이제 로컬 정의가 생긴 항목은 "정리 가능"으로 알린다(경고, 실패 아님).
 *
 * READ-ONLY. DB 연결 없음. `--json` 으로 기계판독 요약 출력.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|dist/.test(p)) walk(p, exts, acc);
    } else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

// 1) rpc('name') 호출 추출
const codeFiles = [
  ...walk(join(root, 'src'), ['.ts', '.tsx']),
  ...walk(join(root, 'api'), ['.ts']),
  ...walk(join(root, 'supabase/functions'), ['.ts']),
];
const calls = new Map();
for (const f of codeFiles) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\.rpc\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g)) {
    if (!calls.has(m[1])) calls.set(m[1], new Set());
    calls.get(m[1]).add(f.replace(root + '/', ''));
  }
}

// 2) CREATE FUNCTION 정의 추출 (모든 *.sql)
const sqlFiles = walk(join(root, 'supabase'), ['.sql']);
const defs = new Set();
for (const f of sqlFiles) {
  const s = readFileSync(f, 'utf8').toLowerCase();
  for (const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    defs.add(m[1]);
  }
}

// 3) 허용목록
const allowPath = join(root, 'scripts/rpc-remote-only-allowlist.json');
const allow = new Set((JSON.parse(readFileSync(allowPath, 'utf8')).allow) ?? []);

// 4) 분류
const undefined_ = [...calls.keys()].filter((n) => !defs.has(n.toLowerCase())).sort();
const newUndefined = undefined_.filter((n) => !allow.has(n));
const staleAllow = [...allow].filter((n) => defs.has(n.toLowerCase())).sort();

const summary = {
  rpc_call_names: calls.size,
  local_definitions: defs.size,
  undefined_total: undefined_.length,
  allowlisted: [...allow].length,
  new_undefined: newUndefined,
  stale_allowlist_entries: staleAllow,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`RPC registry: ${calls.size} call-names, ${defs.size} local defs, ${undefined_.length} undefined (${allow.size} allowlisted).`);
  if (staleAllow.length) {
    console.log(`! ${staleAllow.length} allowlist entr(y/ies) now defined locally — can be removed: ${staleAllow.join(', ')}`);
  }
}

if (newUndefined.length) {
  console.error(`\n✗ ${newUndefined.length} NEW undefined RPC call(s) — no local definition and not in the approved remote-only allowlist:`);
  for (const n of newUndefined) {
    console.error(`  - ${n}  (called in: ${[...(calls.get(n) ?? [])].join(', ')})`);
  }
  console.error('\nEither add the CREATE FUNCTION migration, fix the call, or (only after a reconciliation decision) add it to scripts/rpc-remote-only-allowlist.json.');
  process.exit(1);
}

if (!asJson) console.log('✓ rpc registry lint passed — no new undefined RPC calls.');
