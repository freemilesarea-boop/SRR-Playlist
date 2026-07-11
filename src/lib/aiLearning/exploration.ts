// AI-MUSIC-3 — Exploration vs Exploitation. Keeps an 80% best-track / 20% discovery split for the next
// recommendation. Pure allocation math — read-only, a recommendation only.

import { clamp, round } from '../observability/math';
import { EXPLOIT_RATIO_DEFAULT, EXPLORE_RATIO_MIN, EXPLORE_RATIO_MAX } from './thresholds';
import type { ExplorationPlan } from './types';

/** Split a pool of `poolSize` into exploit (best) vs explore (discovery) counts at the given exploit ratio. */
export function explorationPlan(poolSize: number, exploitRatio: number = EXPLOIT_RATIO_DEFAULT): ExplorationPlan {
  const exploreRatio = clamp(1 - exploitRatio, EXPLORE_RATIO_MIN, EXPLORE_RATIO_MAX);
  const n = Math.max(0, Math.floor(poolSize));
  const exploreCount = Math.round(n * exploreRatio);
  const exploitCount = n - exploreCount;
  return {
    poolSize: n, exploitRatio: round(1 - exploreRatio, 2) as number, exploitCount, exploreCount,
    note: `Exploit ${exploitCount} · Explore ${exploreCount} (${Math.round((1 - exploreRatio) * 100)}/${Math.round(exploreRatio * 100)})`,
  };
}
