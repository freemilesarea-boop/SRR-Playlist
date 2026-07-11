// AI-MUSIC-2 — Energy Curve. Builds the target Low → Medium → High → Medium → Low energy shape for a
// playlist of N tracks and scores how well an actual energy sequence follows it. Pure math — no data
// dependency, no side effects. Used to shape/score a *proposed* playlist only.

import { clamp, round } from '../observability/math';
import { ENERGY_STAGE_LEVELS, ENERGY_CURVE_SHAPE } from './thresholds';

/** Target energy value (0..1) at a normalized position p in [0,1] via linear interp over the stage shape. */
function targetAt(p: number): number {
  const stages = ENERGY_CURVE_SHAPE.map((s) => ENERGY_STAGE_LEVELS[s]);
  if (stages.length === 1) return stages[0];
  const clampedP = clamp(p, 0, 1);
  const seg = clampedP * (stages.length - 1);
  const i = Math.min(Math.floor(seg), stages.length - 2);
  const frac = seg - i;
  return stages[i] + (stages[i + 1] - stages[i]) * frac;
}

/** Target energy curve of length n following Low→Medium→High→Medium→Low. */
export function targetEnergyCurve(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [ENERGY_STAGE_LEVELS.MEDIUM];
  return Array.from({ length: n }, (_, i) => round(targetAt(i / (n - 1)), 3) as number);
}

/**
 * Fit of an actual energy sequence to the ideal curve → 0..1 (1 = perfect).
 * Unknown energies (null) are skipped; returns null when nothing is comparable.
 */
export function scoreEnergyCurve(actual: Array<number | null>): number | null {
  const target = targetEnergyCurve(actual.length);
  let sumErr = 0, count = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    if (a == null) continue;
    sumErr += Math.abs(clamp(a, 0, 1) - target[i]);
    count++;
  }
  if (count === 0) return null;
  return round(clamp(1 - sumErr / count, 0, 1), 3);
}

/** The target energy level for a single position index within a playlist of length n. */
export function targetEnergyAt(index: number, n: number): number {
  if (n <= 1) return ENERGY_STAGE_LEVELS.MEDIUM;
  return round(targetAt(index / (n - 1)), 3) as number;
}
