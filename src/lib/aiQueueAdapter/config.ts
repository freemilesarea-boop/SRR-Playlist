// AI-MUSIC-8 — Queue adapter feature flags. Every flag defaults **OFF** and the kill switch defaults **ON**,
// gated behind the AI-MUSIC master flag. There is NO runtime hook this phase — the adapter/harness never writes
// to the real player queue regardless of flags. A flag OFF (or kill switch ON, or master OFF) simply hides the
// harness lab / certification UI; it can never change the real queue, playback, Player, ranking, or settlement.

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiQueueAdapterConfig {
  masterEnabled: boolean;          // inherits AI-MUSIC master (default OFF)
  adapterEnabled: boolean;         // adapter engine visibility (NEVER a runtime hook this phase)
  harnessEnabled: boolean;         // deterministic harness lab visibility
  certificationEnabled: boolean;   // certification snapshot recording
  killSwitch: boolean;             // default ON — candidate commands invalid
}

let cached: AiQueueAdapterConfig | null = null;

export function getAiQueueAdapterConfig(): AiQueueAdapterConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    adapterEnabled: envBool(env.VITE_AI_QUEUE_ADAPTER_ENABLED, false),
    harnessEnabled: envBool(env.VITE_AI_QUEUE_ADAPTER_HARNESS_ENABLED, false),
    certificationEnabled: envBool(env.VITE_AI_QUEUE_ADAPTER_CERTIFICATION_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_QUEUE_ADAPTER_KILL_SWITCH, true),   // default ON
  };
  return cached;
}

export function __resetAiQueueAdapterConfig(): void { cached = null; }
