#!/usr/bin/env node
/**
 * scripts/rewrite-global-contrast.mjs
 *
 * 전역 UI Contrast Policy Sweep.
 *
 * 이전 rewrite-dual-theme-text.mjs 의 확장판:
 *   - Admin 컴포넌트도 포함 (dark-only 였으나 라이트 사용자도 봄 → 이중 테마 필요)
 *   - text-<tone>-{50,100,200} 뿐 아니라 text-gray-{300,400}, text-slate-{300,400}
 *     같은 "밝은 배경 위에서 안 보이는 흐린 색" 도 이중 테마화
 *   - palette.ts, adminTones.ts, dist/ 는 skip
 *
 * 변환 규칙:
 *   `text-<tone>-<light-shade>` (bare)
 *     → `text-slate-900 dark:text-<tone>-<light-shade>`
 *   `text-<tone>-<light-shade>/<alpha>` (bare)
 *     → `text-slate-700 dark:text-<tone>-<light-shade>/<alpha>`
 *   `text-gray-{300,400}` / `text-slate-{300,400}` / `text-zinc-{300,400}` / `text-neutral-{300,400}`
 *     → `text-slate-500 dark:text-gray-<shade>` (etc)
 *   이미 `dark:` prefix, 또는 hover:/focus:/active: 등 다른 variant 뒤에 있는 경우 skip
 *   (예: `hover:text-emerald-100` 는 그대로 두어 hover 시 명료도 유지)
 *
 * TONE (light-shade 50/100/200 대상):
 *   emerald green amber yellow sky blue purple violet rose red pink
 *   fuchsia indigo teal cyan orange lime
 *
 * MUTED (300/400 대상 — light bg 위에서 낮은 대비):
 *   gray slate zinc neutral stone
 *
 * 대상 파일: src/**\/*.{ts,tsx}
 * Skip:
 *   src/components/admin/ui/palette.ts
 *   src/lib/adminTones.ts
 *   src/theme.css (이미 HF1 에서 처리)
 *   node_modules, dist
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');

const SKIP_FILES = new Set([
  'src/components/admin/ui/palette.ts',
  'src/lib/adminTones.ts',
]);
const EXTS = new Set(['.ts', '.tsx']);

const TONES = 'emerald|green|amber|yellow|sky|blue|purple|violet|rose|red|pink|fuchsia|indigo|teal|cyan|orange|lime';
const SHADES = '(?:50|100|200)';
const MUTED = 'gray|slate|zinc|neutral|stone';
const MUTED_SHADES = '(?:300|400)';

// Character class: a variant prefix or word char immediately before "text-" means skip.
// We only transform "bare" occurrences preceded by whitespace, quotes, backtick, or `{`.
const RE_TONE_ALPHA = new RegExp(
  `(^|[\\s"'\`{])(text-(?:${TONES})-${SHADES})(/\\d+)(?![\\w/])`,
  'g',
);
const RE_TONE_BARE = new RegExp(
  `(^|[\\s"'\`{])(text-(?:${TONES})-${SHADES})(?![\\w/])`,
  'g',
);
const RE_MUTED = new RegExp(
  `(^|[\\s"'\`{])(text-(?:${MUTED})-${MUTED_SHADES})(?![\\w/])`,
  'g',
);

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
let totalToneAlpha = 0;
let totalToneBare = 0;
let totalMuted = 0;

for (const p of files) {
  const rel = p.replace(process.cwd() + '/', '');
  if (SKIP_FILES.has(rel)) continue;
  const src = readFileSync(p, 'utf8');
  let hits = 0;
  let toneAlpha = 0;
  let toneBare = 0;
  let muted = 0;

  // pass 1: alpha version first (so we don't re-match the bare part later)
  let out = src.replace(RE_TONE_ALPHA, (_m, before, cls, alpha) => {
    if (!before || !cls) return _m;
    toneAlpha += 1;
    return `${before}text-slate-700 dark:${cls}${alpha}`;
  });

  // pass 2: bare tone version
  out = out.replace(RE_TONE_BARE, (_m, before, cls) => {
    if (!before || !cls) return _m;
    toneBare += 1;
    return `${before}text-slate-900 dark:${cls}`;
  });

  // pass 3: muted (gray/slate/zinc/neutral/stone -300/-400)
  out = out.replace(RE_MUTED, (_m, before, cls) => {
    if (!before || !cls) return _m;
    muted += 1;
    return `${before}text-slate-500 dark:${cls}`;
  });

  hits = toneAlpha + toneBare + muted;
  if (hits > 0) {
    writeFileSync(p, out);
    totalFiles += 1;
    totalHits += hits;
    totalToneAlpha += toneAlpha;
    totalToneBare += toneBare;
    totalMuted += muted;
    console.log(`  ${rel}  ${hits} hit(s)   [tone:${toneBare + toneAlpha} muted:${muted}]`);
  }
}

console.log(`\nrewrite-global-contrast: ${totalHits} classes upgraded across ${totalFiles} files.`);
console.log(`  bare tone:  ${totalToneBare}`);
console.log(`  alpha tone: ${totalToneAlpha}`);
console.log(`  muted:      ${totalMuted}`);
