// AI-MUSIC-4 — Controlled-experiment feature flags. All default **OFF** (opt-in) and gated behind the
// AI-MUSIC master flag (VITE_AI_MUSIC_ENABLED). A flag OFF (kill switch) only hides the Experiment UI /
// analysis; it can NEVER touch the Player, Playback, Queue, real Playlist, ranking, settlement, or any
// existing data. The experiment layer is read-only and produces drafts/recommendations only.

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiExperimentsConfig {
  masterEnabled: boolean;             // inherits AI-MUSIC master (default OFF)
  experimentsEnabled: boolean;
  pilotRecommendationEnabled: boolean;
  analysisEnabled: boolean;
  rolloutRecommendationEnabled: boolean;
  auditEnabled: boolean;
}

let cached: AiExperimentsConfig | null = null;

export function getAiExperimentsConfig(): AiExperimentsConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    experimentsEnabled: envBool(env.VITE_AI_EXPERIMENTS_ENABLED, false),
    pilotRecommendationEnabled: envBool(env.VITE_AI_PILOT_RECOMMENDATION_ENABLED, false),
    analysisEnabled: envBool(env.VITE_AI_EXPERIMENT_ANALYSIS_ENABLED, false),
    rolloutRecommendationEnabled: envBool(env.VITE_AI_ROLLOUT_RECOMMENDATION_ENABLED, false),
    auditEnabled: envBool(env.VITE_AI_EXPERIMENT_AUDIT_ENABLED, false),
  };
  return cached;
}

export function __resetAiExperimentsConfig(): void { cached = null; }
