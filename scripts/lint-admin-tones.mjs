#!/usr/bin/env node
/**
 * scripts/lint-admin-tones.mjs
 *
 * Detects hardcoded low-contrast color classes in admin/ + enterprise/ components.
 * Helps enforce the adminTones / adminTonesLight utility (src/lib/adminTones.ts)
 * introduced after WCAG contrast audit (PRs #190, #191).
 *
 * Forbidden patterns (admin dark theme 위 가독성 약함):
 *   text-{emerald,rose,red,amber,sky}-{400,500,600,700,800,900}
 *   bg-{emerald,rose,red,amber,sky}-{400,500}/{10,15}
 *   ring-{emerald,rose,red,amber,sky}-{300,400,500}/{20,30}
 *   bg-red-{500,600}  (rose 로 통일)
 *
 * Whitelist (검사 제외):
 *   - 같은 className 안에 dark: variant 존재 → dual-mode 정상
 *   - 같은 라인에 light-surface marker (bg-*-{50,100}, bg-white) 동반 → light 위 정상
 *   - utility 정의 파일 자체 (src/lib/adminTones.ts)
 *   - 주석 라인 (// 또는 *)
 *
 * Usage:
 *   node scripts/lint-admin-tones.mjs            # warning only (exit 0)
 *   node scripts/lint-admin-tones.mjs --strict   # 위반 시 exit 1
 *   npm run lint:tones
 *
 * Suggested fix:
 *   import { adminTones, adminTonesLight } from '@/lib/adminTones';
 *   <span className={adminTones.success.badge}>지급완료</span>
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src/components/admin', 'src/components/enterprise'];
const SKIP_FILES = new Set([
  'src/lib/adminTones.ts',
]);
// Design System 정의 파일들 — 솔리드 톤 (bg-red-600 등) 명시적 사용 허용
const SKIP_DIRS = [
  'src/components/admin/ui',
];

// Forbidden regex patterns (with descriptive labels)
const FORBIDDEN = [
  {
    label: 'text-*-{400,500,600,700,800,900} (저채도 텍스트)',
    re: /\btext-(emerald|rose|red|amber|sky)-(400|500|600|700|800|900)\b/g,
    hint: 'adminTones.<tone>.text / textMute (dark) 또는 adminTonesLight.<tone>.text (light) 사용',
  },
  {
    label: 'bg-*-{400,500}/{10,15} (약한 alpha)',
    re: /\bbg-(emerald|rose|red|amber|sky)-(400|500)\/(10|15)\b/g,
    hint: '/20 ~ /25 로 강화 또는 adminTones.<tone>.badge 사용',
  },
  {
    label: 'ring-*-{300,400,500}/{20,30} (약한 ring)',
    re: /\bring-(emerald|rose|red|amber|sky)-(300|400|500)\/(20|30)\b/g,
    hint: '/40 ~ /50 로 강화 또는 adminTones 사용',
  },
  {
    label: 'bg-red-{500,600} (red → rose 로 통일)',
    re: /\bbg-red-(500|600)\b/g,
    hint: 'bg-rose-600 hover:bg-rose-700 또는 adminTones.danger.buttonSolid 사용',
  },
  {
    label: 'opacity-{40,50,60} (disabled 외 남용)',
    re: /\bopacity-(40|50|60)\b/g,
    hint: 'disabled 만 opacity-50 허용. 다른 자리는 색상/contrast 로 표현',
    soft: true,                          // 정보용 (false-positive 가능 — disabled: 동반시 OK)
  },
];

// Whitelist heuristics
function isWhitelistedLine(line) {
  // light surface marker 동반 시 dark:* 가 없어도 light 위 정상
  if (/\bbg-(white|(emerald|rose|red|amber|sky|indigo|violet|purple|gray|slate)-(50|100|200))\b/.test(line)) return true;
  // dark: variant 동반 시 dual-mode (light + dark 분리되어 있음)
  if (/\bdark:/.test(line)) return true;
  // disabled:opacity-* 는 의도된 사용
  if (/\bdisabled:opacity-/.test(line)) return true;
  // 주석 라인
  if (/^\s*(\/\/|\*)/.test(line)) return true;

  // === opacity-{40,50,60} 의도된 muted 패턴 (4차 batch에서 추가) ===
  // 1) ternary 조건부 dimming — `${cond ? 'A' : 'opacity-XX...'}` 또는 ` ? 'opacity-XX' : 'B'`
  //    (row/section muted state — withdrawn/removed/deleted/inactive/disabled)
  if (/\?[^?]*opacity-(40|50|60)\b/.test(line)) return true;
  // 2) readonly input dim — `<input readOnly className="...opacity-XX" />`
  if (/\breadOnly\b[^>]*opacity-(40|50|60)/.test(line)) return true;
  // 3) cursor-not-allowed 동반 dim — disabled-like 표현
  if (/\bcursor-not-allowed\b[^"]*opacity-(40|50|60)/.test(line)) return true;
  // 4) 아이콘 전용 dim — `<Icon size={N} className="...opacity-XX" />`
  //    visual hierarchy (loading spinner / empty state icon / decorative icon)
  if (/\bsize=\{[^}]*\}[^>]*\bclassName=("|`|\{`)[^"`]*opacity-(40|50|60)/.test(line)) return true;

  return false;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

const strict = process.argv.includes('--strict');
const violations = [];
const softViolations = [];

for (const root of ROOTS) {
  let files;
  try { files = walk(root); } catch { continue; }
  for (const f of files) {
    const rel = relative(process.cwd(), f);
    if (SKIP_FILES.has(rel)) continue;
    if (SKIP_DIRS.some((d) => rel.startsWith(d + '/'))) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isWhitelistedLine(line)) return;
      for (const pat of FORBIDDEN) {
        pat.re.lastIndex = 0;
        const m = pat.re.exec(line);
        if (m) {
          const target = pat.soft ? softViolations : violations;
          target.push({ file: rel, lineNo: i + 1, match: m[0], pattern: pat.label, hint: pat.hint, line: line.trim() });
        }
      }
    });
  }
}

const totalHard = violations.length;
const totalSoft = softViolations.length;

if (totalHard === 0 && totalSoft === 0) {
  console.log('✓ admin tones lint clean — no hardcoded low-contrast classes detected.');
  process.exit(0);
}

if (totalHard > 0) {
  console.error(`\n✗ ${totalHard} admin tone violation(s) (hardcoded low-contrast classes):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.lineNo}  →  ${v.match}`);
    console.error(`    ${v.pattern}`);
    console.error(`    hint: ${v.hint}`);
    console.error(`    line: ${v.line.length > 120 ? v.line.slice(0, 117) + '...' : v.line}`);
    console.error('');
  }
}

if (totalSoft > 0) {
  console.warn(`\n⚠ ${totalSoft} soft warning(s) (informational — review case-by-case):\n`);
  for (const v of softViolations.slice(0, 20)) {
    console.warn(`  ${v.file}:${v.lineNo}  →  ${v.match}  (${v.pattern})`);
  }
  if (totalSoft > 20) console.warn(`  ... and ${totalSoft - 20} more`);
}

console.log(`\nTotal: hard=${totalHard}, soft=${totalSoft}`);

if (strict && totalHard > 0) {
  console.error('\nstrict mode — exiting with code 1');
  process.exit(1);
}
process.exit(0);
