#!/usr/bin/env node
/**
 * scripts/lint-migrations.mjs
 *
 * Two rules:
 *   1) unsafe-array-concat — text[] || 'literal' 감지 (기존 rule)
 *   2) duplicate-prefix    — `<NNNN>_` prefix 중복 감지 (신규 rule)
 *      → 병합된 prod migration 순서 혼동 방지. legacy allowlist 예외.
 *
 * ─────────────────────────────────────────────────────────────────
 * Rule 1: unsafe-array-concat (회귀 방지)
 * ─────────────────────────────────────────────────────────────────
 *   Bug pattern:
 *     v_reason_codes := v_reason_codes || 'ai_store_top3_match';
 *   → PostgreSQL casts RHS to text[], fails: malformed array literal.
 *   Safe:
 *     v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');
 *     v_reason_codes := v_reason_codes || ARRAY['ai_store_top3_match'];
 *   Per-file opt-out (사용 자제):
 *     -- lint-disable-file: unsafe-array-concat
 *
 * ─────────────────────────────────────────────────────────────────
 * Rule 2: duplicate-prefix
 * ─────────────────────────────────────────────────────────────────
 *   같은 4자리 prefix 를 두 개 이상의 migration 파일이 사용하면 실패:
 *     0395_foo.sql + 0395_bar.sql  → ✗ FAIL
 *   Suffix (알파벳/숫자) 는 정상:
 *     0395a_foo.sql + 0395b_bar.sql  → ✓ OK
 *   Legacy allowlist (이미 prod 반영, 절대 rename 금지):
 *     0068, 0214, 0388
 *   신규 prefix 는 반드시 최신 + 1 을 사용해 duplicate 를 예방.
 *
 * Usage:
 *   node scripts/lint-migrations.mjs
 *   npm run lint:migrations
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

// Array-typed variable name heuristics — these usually indicate text[]/array
const ARRAY_VAR_SUFFIX = /(_codes|_tags|_flags|_signals|_slugs|_keys|_paths|_emails|_ids|_array|_arr)$/i;

// Strip SQL comments (-- to EOL, /* ... */ blocks).
function stripComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    // line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' '; // preserve column position
        i++;
      }
      continue;
    }
    // block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) { out += '  '; i += 2; }
      continue;
    }
    // string literal (skip — we want literals visible for matching, but not for comment-stripping)
    if (sql[i] === "'") {
      out += sql[i];
      i++;
      while (i < sql.length && sql[i] !== "'") {
        out += sql[i];
        i++;
      }
      if (i < sql.length) { out += sql[i]; i++; }
      continue;
    }
    // dollar quoted string ($$...$$ or $tag$...$tag$)
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^\$(\w*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        out += tag;
        i += tag.length;
        const endIdx = sql.indexOf(tag, i);
        if (endIdx === -1) { out += sql.slice(i); i = sql.length; continue; }
        out += sql.slice(i, endIdx + tag.length);
        i = endIdx + tag.length;
        continue;
      }
    }
    out += sql[i];
    i++;
  }
  return out;
}

function checkOptOut(rawSql) {
  // Check first 30 lines for opt-out marker
  const head = rawSql.split('\n', 30).join('\n');
  return /lint-disable-file:\s*unsafe-array-concat/.test(head);
}

function lineNumberAt(sql, index) {
  return sql.slice(0, index).split('\n').length;
}

function lintFile(filepath) {
  const rawSql = readFileSync(filepath, 'utf8');
  const optedOut = checkOptOut(rawSql);
  const sql = stripComments(rawSql);
  const violations = [];

  // Pattern 1: <var> := <var> || 'literal'
  const re1 = /\b(\w+)\s*:=\s*(\w+)\s*\|\|\s*'([^']*)'/g;
  let m;
  while ((m = re1.exec(sql)) !== null) {
    const [full, lhs, rhs, literal] = m;
    if (lhs.toLowerCase() !== rhs.toLowerCase()) continue;
    if (!ARRAY_VAR_SUFFIX.test(lhs)) continue;
    violations.push({
      line: lineNumberAt(rawSql, m.index),
      pattern: 'unsafe-array-concat (literal)',
      match: full,
      suggestion: `array_append(${lhs}, '${literal}')`,
    });
  }

  // Pattern 2: <var> := <var> || ('prefix' || expr) — dynamic literal
  const re2 = /\b(\w+)\s*:=\s*(\w+)\s*\|\|\s*\(\s*'[^']*'\s*\|\|/g;
  while ((m = re2.exec(sql)) !== null) {
    const [full, lhs, rhs] = m;
    if (lhs.toLowerCase() !== rhs.toLowerCase()) continue;
    if (!ARRAY_VAR_SUFFIX.test(lhs)) continue;
    violations.push({
      line: lineNumberAt(rawSql, m.index),
      pattern: 'unsafe-array-concat (dynamic)',
      match: full + '...',
      suggestion: `array_append(${lhs}, <expr>)`,
    });
  }

  return { violations, optedOut };
}

// ─────────────────────────────────────────────────────────────────
// Rule 2: duplicate-prefix
// ─────────────────────────────────────────────────────────────────
// 이미 prod 에 반영된 3쌍은 rename 금지 → allowlist.
// 새 collision 이 감지되면 exit 1 + PR 실패.
const LEGACY_PREFIX_ALLOWLIST = new Set(['0068', '0214', '0388']);

/**
 * 파일명에서 앞부분 4자리 숫자 prefix 를 추출.
 *   '0395_foo.sql'  → '0395'
 *   '0395a_foo.sql' → null  (suffix 있음 — 알파벳/숫자, 4자리 이후)
 *   'phase_x1.sql'  → null  (timestamp/phase 형식은 검사 대상 외)
 *
 * duplicate 은 "정확히 4자리 숫자만" 인 경우만 잡음. suffix (0068b, 0155b, 0193a 등)
 * 는 collision 이 아님.
 */
function extractPrefix(filename) {
  const m = filename.match(/^(\d{4})_/);
  return m ? m[1] : null;
}

function findDuplicatePrefixes(files) {
  const map = new Map(); // prefix → filenames[]
  for (const f of files) {
    const p = extractPrefix(f);
    if (!p) continue;
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(f);
  }
  const duplicates = [];
  for (const [prefix, filenames] of map.entries()) {
    if (filenames.length < 2) continue;
    duplicates.push({ prefix, filenames, allowed: LEGACY_PREFIX_ALLOWLIST.has(prefix) });
  }
  duplicates.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return duplicates;
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  // ── Rule 1: unsafe-array-concat ────────────────────────────────
  let totalViolations = 0;
  let totalOptedOut = 0;
  const findings = [];

  for (const f of files) {
    const fp = join(MIGRATIONS_DIR, f);
    const { violations, optedOut } = lintFile(fp);
    if (optedOut) {
      totalOptedOut++;
      if (violations.length > 0) {
        findings.push({ file: f, optedOut: true, violations });
      }
      continue;
    }
    if (violations.length > 0) {
      findings.push({ file: f, optedOut: false, violations });
      totalViolations += violations.length;
    }
  }

  // ── Rule 2: duplicate-prefix ───────────────────────────────────
  const duplicates = findDuplicatePrefixes(files);
  const newDuplicates = duplicates.filter((d) => !d.allowed);
  const allowedDuplicates = duplicates.filter((d) => d.allowed);

  // ── Report ─────────────────────────────────────────────────────
  console.log(`scanned ${files.length} migration files`);
  if (totalOptedOut > 0) {
    console.log(`opted-out (lint-disable-file): ${totalOptedOut} file(s)`);
  }
  if (allowedDuplicates.length > 0) {
    console.log(`legacy duplicate prefixes (allowlisted, rename 금지): ${allowedDuplicates.map((d) => d.prefix).join(', ')}`);
  }

  const failed = totalViolations > 0 || newDuplicates.length > 0;

  if (!failed) {
    console.log(`✓ migration lint passed — 0 violations, 0 new duplicate prefix`);
    process.exit(0);
  }

  // Rule 1 실패 리포트
  if (totalViolations > 0) {
    console.error(`\n✗ unsafe-array-concat: ${totalViolations} violation(s) in ${findings.filter((f) => !f.optedOut).length} file(s)`);
    for (const { file, optedOut, violations } of findings) {
      const tag = optedOut ? ' [opted-out]' : '';
      console.error(`  ${file}${tag}:`);
      for (const v of violations) {
        console.error(`    line ${v.line} [${v.pattern}]`);
        console.error(`      bad : ${v.match}`);
        console.error(`      fix : ${v.suggestion}`);
      }
    }
    console.error(`\n  Rule: text[] variables must use array_append(arr, val) or arr || ARRAY[val].`);
    console.error(`  Historical opt-out: add header comment "-- lint-disable-file: unsafe-array-concat"`);
  }

  // Rule 2 실패 리포트
  if (newDuplicates.length > 0) {
    console.error(`\n✗ Duplicate migration prefix detected:`);
    for (const d of newDuplicates) {
      console.error(`\n  ${d.prefix}`);
      for (const f of d.filenames) {
        console.error(`    - ${f}`);
      }
    }
    console.error(`\n  Rule: 같은 4자리 prefix 를 2개 이상 파일이 사용할 수 없습니다.`);
    console.error(`        새 migration 은 최신 prefix + 1 을 사용하세요.`);
    console.error(`        같은 도메인을 여러 파일로 나눠야 할 때는 suffix (0395a, 0395b) 를 사용하세요.`);
    console.error(`        legacy allowlist: ${Array.from(LEGACY_PREFIX_ALLOWLIST).sort().join(', ')} (이미 prod 반영, rename 금지)`);
  }

  console.error(`\nSee docs/migrations.md`);
  process.exit(1);
}

main();
