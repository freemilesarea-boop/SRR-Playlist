// AI-MUSIC-5 — Pilot orchestration feature flags. Every flag defaults **OFF** (opt-in) and is gated behind the
// AI-MUSIC master flag (VITE_AI_MUSIC_ENABLED). A flag OFF (kill switch) only hides the Pilot Operations UI /
// orchestration; it can NEVER start a pilot, assign a store, deploy a playlist, expand, stop, roll back, or
// touch the Player, Playback, Queue, original Playlist, ranking, or settlement. This layer is approval-gated
// and produces recommendations/drafts + a preview resolver ONLY (runtime integration is DEFERRED).

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiPilotConfig {
  masterEnabled: boolean;                     // inherits AI-MUSIC master (default OFF)
  orchestrationEnabled: boolean;              // Pilot Operations dashboard visibility
  activationEnabled: boolean;                 // Manual Activate action visibility
  overrideEnabled: boolean;                   // Treatment Override preview resolver visibility
  observationEnabled: boolean;                // Observation snapshots visibility
  guardrailEnabled: boolean;                  // Live guardrail monitor visibility
  pauseResumeEnabled: boolean;                // Pause/Resume/Stop actions visibility
  rollbackEnabled: boolean;                   // Rollback request/confirm actions visibility
}

let cached: AiPilotConfig | null = null;

export function getAiPilotConfig(): AiPilotConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    orchestrationEnabled: envBool(env.VITE_AI_PILOT_ORCHESTRATION_ENABLED, false),
    activationEnabled: envBool(env.VITE_AI_PILOT_ACTIVATION_ENABLED, false),
    overrideEnabled: envBool(env.VITE_AI_PILOT_OVERRIDE_ENABLED, false),
    observationEnabled: envBool(env.VITE_AI_PILOT_OBSERVATION_ENABLED, false),
    guardrailEnabled: envBool(env.VITE_AI_PILOT_GUARDRAIL_ENABLED, false),
    pauseResumeEnabled: envBool(env.VITE_AI_PILOT_PAUSE_RESUME_ENABLED, false),
    rollbackEnabled: envBool(env.VITE_AI_PILOT_ROLLBACK_ENABLED, false),
  };
  return cached;
}

export function __resetAiPilotConfig(): void { cached = null; }
