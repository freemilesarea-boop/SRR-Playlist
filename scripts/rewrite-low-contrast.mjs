#!/usr/bin/env node
/**
 * scripts/rewrite-low-contrast.mjs
 *
 * 긴급 HF2 — 저대비 조합 일괄 수정.
 *
 * 규칙 (모두 파일 단위, 안전):
 *   1) bg-<TONE>-{400,500}/10   → bg-<TONE>-{400,500}/20
 *   2) bg-<TONE>-{400,500}/15   → bg-<TONE>-{400,500}/25
 *   3) 이미 /20 이상은 건들지 않음.
 *
 * TONE = amber | yellow | emerald | green | red | rose | orange | pink |
 *        fuchsia | violet | purple | indigo | blue | sky | cyan | teal | lime
 *
 * palette.ts / adminTones.ts 는 별도 관리 (skip).
 * 실행 후 리포트 (파일당 변경 라인 수) 출력.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');
const SKIP_FILES = new Set([
  'src/components/admin/ui/palette.ts',
  'src/lib/adminTones.ts',
]);
const EXTS = new Set(['.ts', '.tsx']);

const TONE_RE = /(\bbg-(?:amber|yellow|emerald|green|red|rose|orange|pink|fuchsia|violet|purple|indigo|blue|sky|cyan|teal|lime)-(?:400|500))\/(10|15)\b/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
let totalFiles = 0;
let totalHits = 0;

for (const p of files) {
  const rel = p.replace(process.cwd() + '/', '');
  if (SKIP_FILES.has(rel)) continue;
  const src = readFileSync(p, 'utf8');
  let hits = 0;
  const out = src.replace(TONE_RE, (_m, prefix, alpha) => {
    hits += 1;
    if (alpha === '10') return `${prefix}/20`;
    if (alpha === '15') return `${prefix}/25`;
    return _m;
  });
  if (hits > 0) {
    writeFileSync(p, out);
    totalFiles += 1;
    totalHits += hits;
    console.log(`  ${rel}  ${hits} hit(s)`);
  }
}

console.log(`\nrewrite-low-contrast: ${totalHits} class(es) upgraded across ${totalFiles} file(s).`);
