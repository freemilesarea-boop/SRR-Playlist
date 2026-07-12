// AI-MUSIC-9 — Isolated preview hook feature flags. EVERY flag defaults **OFF**, the kill switch defaults **ON**,
// the isolated store/deployment ids are **unset**, max sessions is pinned to **1**, and max queue applications is
// the minimum. Gated behind the AI-MUSIC master flag. There is NO runtime hook wired this phase (DEFERRED):
// regardless of any flag, nothing in this module writes to the real player queue, audio, or playback. A flag ON
// only reveals the Runtime Proof lab / certification UI in a Preview deployment — it can never touch the real
// queue, Player, ranking, settlement, streaming, or governance.

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envNum(v: unknown, dflt: number): number { const s = envStr(v); if (s === undefined) return dflt; const n = Number(s); return Number.isFinite(n) ? n : dflt; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export interface AiRuntimeHookConfig {
  masterEnabled: boolean;              // inherits AI-MUSIC master (default OFF)
  hookEnabled: boolean;                // isolated preview hook visibility (NEVER a live runtime hook this phase)
  queueOnlyAdapterEnabled: boolean;
  boundaryReservationEnabled: boolean;
  runtimeEvidenceEnabled: boolean;
  runtimeGuardrailEnabled: boolean;
  runtimeRollbackEnabled: boolean;
  killSwitch: boolean;                 // default ON — no candidate may apply
  isolatedStoreId: string | null;      // default UNSET — no store is allowlisted
  isolatedDeploymentId: string | null; // default UNSET
  maxSessions: number;                 // pinned to 1
  maxQueueApplications: number;        // minimum by default
}

let cached: AiRuntimeHookConfig | null = null;

export function getAiRuntimeHookConfig(): AiRuntimeHookConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    hookEnabled: envBool(env.VITE_AI_ISOLATED_PREVIEW_HOOK_ENABLED, false),
    queueOnlyAdapterEnabled: envBool(env.VITE_AI_QUEUE_ONLY_ADAPTER_ENABLED, false),
    boundaryReservationEnabled: envBool(env.VITE_AI_BOUNDARY_RESERVATION_ENABLED, false),
    runtimeEvidenceEnabled: envBool(env.VITE_AI_RUNTIME_EVIDENCE_ENABLED, false),
    runtimeGuardrailEnabled: envBool(env.VITE_AI_RUNTIME_GUARDRAIL_ENABLED, false),
    runtimeRollbackEnabled: envBool(env.VITE_AI_RUNTIME_ROLLBACK_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_ISOLATED_PREVIEW_HOOK_KILL_SWITCH, true),   // default ON
    isolatedStoreId: envStr(env.VITE_AI_ISOLATED_PREVIEW_STORE_ID) ?? null,      // default UNSET
    isolatedDeploymentId: envStr(env.VITE_AI_ISOLATED_PREVIEW_DEPLOYMENT_ID) ?? null,
    maxSessions: 1,   // hard-pinned regardless of env
    maxQueueApplications: Math.max(1, envNum(env.VITE_AI_ISOLATED_PREVIEW_MAX_QUEUE_APPLICATIONS, 1)),
  };
  return cached;
}

export function __resetAiRuntimeHookConfig(): void { cached = null; }
