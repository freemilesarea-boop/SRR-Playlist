// AI-MUSIC-10 — Runtime boundary observer feature flags. EVERY flag defaults **OFF**, the kill switch defaults
// **ON**, gated behind the AI-MUSIC master flag. With the observer disabled (or the master flag off, or the kill
// switch on), NOTHING publishes: zero snapshots, zero extra network/timer/polling, minimal memory, and the
// player behaves EXACTLY as before. This is an observer-only layer — no flag ever changes the queue, playback,
// audio, crossfade/recovery/preload, ranking, settlement, or governance.

import { getAiMusicConfig } from '../aiMusic/config';

function envBool(v: unknown, dflt: boolean): boolean {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : undefined;
  if (s === undefined || s === '') return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiRuntimeBoundaryConfig {
  masterEnabled: boolean;              // inherits AI-MUSIC master (default OFF)
  observerEnabled: boolean;            // master switch for the whole bridge
  crossfadeObserverEnabled: boolean;
  recoveryObserverEnabled: boolean;
  preloadObserverEnabled: boolean;
  audioSwapObserverEnabled: boolean;
  evidenceEnabled: boolean;
  dashboardEnabled: boolean;
  killSwitch: boolean;                 // default ON — no publication
}

let cached: AiRuntimeBoundaryConfig | null = null;

export function getAiRuntimeBoundaryConfig(): AiRuntimeBoundaryConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  const master = getAiMusicConfig().aiMusicEnabled;
  cached = {
    masterEnabled: master,
    observerEnabled: envBool(env.VITE_AI_RUNTIME_BOUNDARY_OBSERVER_ENABLED, false),
    crossfadeObserverEnabled: envBool(env.VITE_AI_CROSSFADE_OBSERVER_ENABLED, false),
    recoveryObserverEnabled: envBool(env.VITE_AI_RECOVERY_OBSERVER_ENABLED, false),
    preloadObserverEnabled: envBool(env.VITE_AI_PRELOAD_OBSERVER_ENABLED, false),
    audioSwapObserverEnabled: envBool(env.VITE_AI_AUDIO_SWAP_OBSERVER_ENABLED, false),
    evidenceEnabled: envBool(env.VITE_AI_BOUNDARY_EVIDENCE_ENABLED, false),
    dashboardEnabled: envBool(env.VITE_AI_BOUNDARY_DASHBOARD_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_RUNTIME_BOUNDARY_KILL_SWITCH, true),   // default ON
  };
  return cached;
}

// The single gate every publication path must pass. Master OFF / observer OFF / kill switch ON → no publication.
export function isObserverActive(cfg: AiRuntimeBoundaryConfig = getAiRuntimeBoundaryConfig()): boolean {
  return cfg.masterEnabled && cfg.observerEnabled && !cfg.killSwitch;
}

export function __resetAiRuntimeBoundaryConfig(): void { cached = null; }
