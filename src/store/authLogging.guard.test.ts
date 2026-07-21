import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * AUTH-STABILIZATION-1 — PII-logging regression guard.
 * Ensures the confirmed signup email/payload console.log (and the unconditional
 * Supabase env log) are not reintroduced. Source-level check (no runtime).
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

describe('auth PII logging guard', () => {
  const authStore = read('./authStore.ts');
  const supabase = read('../lib/supabase.ts');

  it('authStore does not log signup email/payload to console', () => {
    expect(authStore).not.toMatch(/console\.log\([^)]*\[auth\][^)]*signUp/i);
    // no unconditional console.log of an object containing `email`
    expect(authStore).not.toMatch(/console\.log\([^)]*\bemail\b/);
  });

  it('authStore signUp error log (if any) is DEV-gated and not the raw error object', () => {
    // there must be no ungated console.error dumping the raw signUp error
    expect(authStore).not.toMatch(/^\s*console\.error\('\[auth\] signUp error:', error\)/m);
  });

  it('supabase env summary log is DEV-gated (not printed in production)', () => {
    const idx = supabase.indexOf("console.log('[SupabaseEnv]'");
    expect(idx).toBeGreaterThan(-1);
    // the preceding non-empty code should be a DEV guard
    const before = supabase.slice(0, idx);
    expect(before).toMatch(/if \(import\.meta\.env\.DEV\)\s*\{?\s*$/);
  });
});
