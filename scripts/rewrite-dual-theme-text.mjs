#!/usr/bin/env node
/**
 * scripts/rewrite-dual-theme-text.mjs
 *
 * 긴급 UI Contrast Hotfix — light theme 에서 흰색/밝은색 text 가 alpha-overlay
 * 상태카드 안에 흡수되어 보이지 않는 회귀 fix.
 *
 * 전략:
 *   - `text-<tone>-{50,100,200}` 같은 밝은 텍스트 클래스는 dark 테마에서만 유지
 *   - light 테마에서는 slate-900 (본문 기본) 로 대체
 *
 * 변환:
 *   `text-<tone>-<shade>` (bare) →  `text-slate-900 dark:text-<tone>-<shade>`
 *   `text-<tone>-<shade>/<alpha>` (bare) →  `text-slate-700 dark:text-<tone>-<shade>/<alpha>`
 *     (알파는 대개 옅은 설명 텍스트라 slate-700 매핑)
 *   이미 `dark:` prefix 가 붙어 있거나 앞에 `hover:` 등 다른 variant 가 붙어 있으면 skip.
 *
 * TONE: emerald | green | amber | yellow | sky | blue | purple | violet |
 *       rose | red | pink | fuchsia | indigo | teal | cyan | orange | lime
 * SHADE: 50 | 100 | 200
 *
 * 대상:
 *   src/pages/**, src/components/{artist,auth,enterprise,profile,settings}/**,
 *   src/components/*.tsx (top-level).
 *   Skip: src/components/admin/** (super admin 화면, dark-only 우선).
 *
 * palette.ts / adminTones.ts / theme.css 는 별도 관리 (skip).
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');

const SKIP_DIRS = new Set(['admin']);
const SKIP_FILES = new Set([
  'src/components/admin/ui/palette.ts',
  'src/lib/adminTones.ts',
]);
const EXTS = new Set(['.ts', '.tsx']);

const TONES = 'emerald|green|amber|yellow|sky|blue|purple|violet|rose|red|pink|fuchsia|indigo|teal|cyan|orange|lime';
const SHADES = '(?:50|100|200)';

// bare text-<tone>-<shade> without leading variant (no ":", "-", "_" before "text")
const RE_BARE = new RegExp(`(^|[\\s"'\`{])(text-(?:${TONES})-${SHADES})(?![\\w/])`, 'g');
// bare text-<tone>-<shade>/<alpha>
const RE_ALPHA = new RegExp(`(^|[\\s"'\`{])(text-(?:${TONES})-${SHADES})(/\\d+)(?![\\w/])`, 'g');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, out);
    } else if (EXTS.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

// Detect if the file is under src/pages, src/components/{artist,auth,enterprise,profile,settings},
// or src/components/*.tsx (top-level).
function inScope(rel) {
  if (SKIP_FILES.has(rel)) return false;
  if (rel.startsWith('src/pages/')) return true;
  if (/^src\/components\/(artist|auth|enterprise|profile|settings)\//.test(rel)) return true;
  if (/^src\/components\/[^/]+\.(tsx|ts)$/.test(rel)) return true;
  return false;
}

const files = walk(ROOT, []);
let totalFiles = 0;
let totalHits = 0;

for (const p of files) {
  const rel = p.replace(process.cwd() + '/', '');
  if (!inScope(rel)) continue;
  const src = readFileSync(p, 'utf8');
  let hits = 0;

  // pass 1: alpha version first (so we don't double-wrap /alpha suffix in the bare pass)
  let out = src.replace(RE_ALPHA, (_m, before, cls, alpha) => {
    if (!before || !cls) return _m;
    hits += 1;
    return `${before}text-slate-700 dark:${cls}${alpha}`;
  });

  // pass 2: bare version
  out = out.replace(RE_BARE, (_m, before, cls) => {
    if (!before || !cls) return _m;
    hits += 1;
    return `${before}text-slate-900 dark:${cls}`;
  });

  if (hits > 0) {
    writeFileSync(p, out);
    totalFiles += 1;
    totalHits += hits;
    console.log(`  ${rel}  ${hits} hit(s)`);
  }
}

console.log(`\nrewrite-dual-theme-text: ${totalHits} class(es) upgraded across ${totalFiles} file(s).`);
