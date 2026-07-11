// AI-MUSIC-3 — Adaptive learning feature flags. All default **OFF** (opt-in) and gated behind the AI-MUSIC
// master flag (VITE_AI_MUSIC_ENABLED). A flag OFF only hides the learning UI/analysis; it can never affect
// playback, the queue, real playlist generation, ranking, settlement, streaming, or any existing data. The
// learning loop is read-only and produces recommendations only — never an automatic change.

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiLearningConfig {
  masterEnabled: boolean;          // inherits AI-MUSIC master (default OFF)
  learningEngineEnabled: boolean;
  reputationEnabled: boolean;
  adaptiveEnabled: boolean;
  playlistHistoryEnabled: boolean;
}

let cached: AiLearningConfig | null = null;

export function getAiLearningConfig(): AiLearningConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    learningEngineEnabled: envBool(env.VITE_AI_LEARNING_ENGINE_ENABLED, false),
    reputationEnabled: envBool(env.VITE_AI_REPUTATION_ENABLED, false),
    adaptiveEnabled: envBool(env.VITE_AI_ADAPTIVE_ENABLED, false),
    playlistHistoryEnabled: envBool(env.VITE_AI_PLAYLIST_HISTORY_ENABLED, false),
  };
  return cached;
}

export function __resetAiLearningConfig(): void { cached = null; }
