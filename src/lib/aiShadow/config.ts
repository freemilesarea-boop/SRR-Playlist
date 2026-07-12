// AI-MUSIC-6 — Shadow resolution feature flags. All default **OFF** (opt-in) and gated behind the AI-MUSIC
// master flag (VITE_AI_MUSIC_ENABLED). A flag OFF (or the kill switch ON) disables ONLY shadow evaluation /
// the certification UI — it can NEVER change the real playlist resolution, queue, playback, Player, ranking,
// or settlement. The shadow layer is read-only/analysis only and is never used for actual music playback.

import { getAiMusicConfig } from '../aiMusic/config';
import { SHADOW_DEFAULT_SAMPLING_RATE } from './thresholds';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}
function envRate(v: unknown, dflt: number): number {
  const s = envStr(v);
  if (s === undefined) return dflt;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return dflt;
  return Math.min(1, n);
}

export interface AiShadowConfig {
  masterEnabled: boolean;            // inherits AI-MUSIC master (default OFF)
  resolutionEnabled: boolean;        // shadow evaluation
  eventIngestEnabled: boolean;       // decision-event ingestion
  certificationEnabled: boolean;     // certification snapshot recording
  dashboardEnabled: boolean;         // Runtime Certification dashboard visibility
  samplingRate: number;              // fraction of eligible sessions to evaluate
  killSwitch: boolean;               // ON → disable shadow evaluation only (existing resolution untouched)
}

let cached: AiShadowConfig | null = null;

export function getAiShadowConfig(): AiShadowConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    resolutionEnabled: envBool(env.VITE_AI_SHADOW_RESOLUTION_ENABLED, false),
    eventIngestEnabled: envBool(env.VITE_AI_SHADOW_EVENT_INGEST_ENABLED, false),
    certificationEnabled: envBool(env.VITE_AI_SHADOW_CERTIFICATION_ENABLED, false),
    dashboardEnabled: envBool(env.VITE_AI_SHADOW_DASHBOARD_ENABLED, false),
    samplingRate: envRate(env.VITE_AI_SHADOW_SAMPLING_RATE, SHADOW_DEFAULT_SAMPLING_RATE),
    killSwitch: envBool(env.VITE_AI_SHADOW_KILL_SWITCH, false),
  };
  return cached;
}

// True only when shadow evaluation may run at all. Kill switch or any gate OFF → false (existing path untouched).
export function shadowEvaluationAllowed(cfg: AiShadowConfig = getAiShadowConfig()): boolean {
  return cfg.masterEnabled && cfg.resolutionEnabled && !cfg.killSwitch;
}

export function __resetAiShadowConfig(): void { cached = null; }
