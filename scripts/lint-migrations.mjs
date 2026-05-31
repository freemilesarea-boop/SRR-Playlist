#!/usr/bin/env node
/**
 * scripts/lint-migrations.mjs
 *
 * Detects unsafe text[] || 'literal' concat patterns in Supabase migrations.
 *
 * Bug pattern (회귀 방지 대상):
 *   v_reason_codes := v_reason_codes || 'ai_store_top3_match';
 *
 * → PostgreSQL casts right-hand 'literal' to text[], fails on missing curly braces:
 *   ERROR: malformed array literal: "ai_store_top3_match"
 *
 * Safe alternatives:
 *   v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');
 *   v_reason_codes := v_reason_codes || ARRAY['ai_store_top3_match'];
 *
 * Per-file opt-out (for historical migrations already superseded):
 *   -- lint-disable-file: unsafe-array-concat
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

function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
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

  console.log(`scanned ${files.length} migration files`);
  if (totalOptedOut > 0) {
    console.log(`opted-out (lint-disable-file): ${totalOptedOut} file(s)`);
  }

  if (totalViolations === 0) {
    console.log(`✓ migration lint passed — 0 violations`);
    process.exit(0);
  }

  console.error(`✗ migration lint FAILED — ${totalViolations} violation(s) in ${findings.filter((f) => !f.optedOut).length} file(s)`);
  for (const { file, optedOut, violations } of findings) {
    const tag = optedOut ? ' [opted-out]' : '';
    console.error(`\n  ${file}${tag}:`);
    for (const v of violations) {
      console.error(`    line ${v.line} [${v.pattern}]`);
      console.error(`      bad : ${v.match}`);
      console.error(`      fix : ${v.suggestion}`);
    }
  }
  console.error(`\nRule: text[] variables must use array_append(arr, val) or arr || ARRAY[val].`);
  console.error(`See docs/MIGRATION_RULES.md`);
  console.error(`\nHistorical opt-out: add header comment to migration file:`);
  console.error(`  -- lint-disable-file: unsafe-array-concat`);
  process.exit(1);
}

main();
