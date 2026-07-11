// AI-MUSIC-2 — Playlist Builder feature flags. All default **OFF** (opt-in) and gated behind the AI-MUSIC
// master flag (VITE_AI_MUSIC_ENABLED). A flag OFF only hides the Playlist-Builder UI/analysis; it can never
// affect playback, the queue, real playlist generation, settlement, ranking, streaming, or any existing
// data. The builder is read-only and produces proposals/simulations only — never auto-deploys a playlist.

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiPlaylistConfig {
  masterEnabled: boolean;           // inherits AI-MUSIC master (default OFF)
  builderEnabled: boolean;
  compareEnabled: boolean;
  simulationEnabled: boolean;
}

let cached: AiPlaylistConfig | null = null;

export function getAiPlaylistConfig(): AiPlaylistConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    builderEnabled: envBool(env.VITE_AI_PLAYLIST_BUILDER_ENABLED, false),
    compareEnabled: envBool(env.VITE_AI_PLAYLIST_COMPARE_ENABLED, false),
    simulationEnabled: envBool(env.VITE_AI_PLAYLIST_SIMULATION_ENABLED, false),
  };
  return cached;
}

export function __resetAiPlaylistConfig(): void { cached = null; }
