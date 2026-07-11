// WEB-OBS-2 — small pure numeric helpers shared across observability modules.
// No browser APIs, no side effects — trivially unit-testable and safe on client or server.

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Safe division: denominator 0 (or non-finite) → 0, never NaN/Infinity. */
export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Relative change from baseline → current, as a signed fraction (0.2 = +20%).
 * Returns null when a percentage is undefined (baseline 0 or non-finite input) — callers must then
 * fall back to the ABSOLUTE delta and never render a fabricated "∞%".
 */
export function percentChange(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  if (baseline === 0) return null;
  return (current - baseline) / Math.abs(baseline);
}

/** Absolute delta current − baseline (null if either is non-finite). */
export function absDelta(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  return current - baseline;
}

/** Round to n decimal places (default 3), preserving null. */
export function round(n: number | null | undefined, places = 3): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
