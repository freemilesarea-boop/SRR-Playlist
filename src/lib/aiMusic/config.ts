// AI-MUSIC-1 — AI Music feature flags. Per the phase spec, the master flag defaults **OFF** (opt-in) —
// the AI Music OS is a Preview foundation. A flag OFF only hides the AI-Music UI/analysis; it can never
// affect playback, the queue, playlist generation, settlement, ranking, or any existing data. The AI is
// read-only and produces recommendations/simulations only — never auto-deploys a playlist or a policy.

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiMusicConfig {
  aiMusicEnabled: boolean;            // master — default OFF
  recommendationsEnabled: boolean;
  simulationEnabled: boolean;
  discoveryEnabled: boolean;
  learningEnabled: boolean;
}

let cached: AiMusicConfig | null = null;

export function getAiMusicConfig(): AiMusicConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    aiMusicEnabled: envBool(env.VITE_AI_MUSIC_ENABLED, false),
    recommendationsEnabled: envBool(env.VITE_AI_RECOMMENDATIONS_ENABLED, false),
    simulationEnabled: envBool(env.VITE_AI_SIMULATION_ENABLED, false),
    discoveryEnabled: envBool(env.VITE_AI_DISCOVERY_ENABLED, false),
    learningEnabled: envBool(env.VITE_AI_LEARNING_ENABLED, false),
  };
  return cached;
}

export function __resetAiMusicConfig(): void { cached = null; }
