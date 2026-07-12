// AI-MUSIC-7 — Preview canary feature flags. Every flag defaults **OFF** and the kill switch defaults **ON**,
// gated behind the AI-MUSIC master flag. Runtime canary may run ONLY when ALL THREE hold: (1) Preview
// environment, (2) allowed deployment id matches the current deployment id, (3) an explicit store allowlist.
// A flag OFF (or kill switch ON, or any of the three conditions absent) disables ONLY the canary — it can NEVER
// change the real playlist resolution, queue, playback, Player, ranking, or settlement. In production these are
// all OFF/absent and, structurally, the canary migration is not applied so the RPCs do not exist there.

import { getAiMusicConfig } from '../aiMusic/config';
import { CANARY_DEFAULT_MAX_SESSIONS } from './thresholds';

function envStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}
function envInt(v: unknown, dflt: number): number {
  const s = envStr(v); if (s === undefined) return dflt;
  const n = Number(s); return Number.isInteger(n) && n >= 0 ? n : dflt;
}

export interface AiPreviewCanaryConfig {
  masterEnabled: boolean;              // inherits AI-MUSIC master (default OFF)
  canaryEnabled: boolean;              // master canary toggle
  resolutionEnabled: boolean;          // canary resolver eligibility
  queueEnabled: boolean;               // candidate queue preview
  eventsEnabled: boolean;              // canary event ingestion
  guardrailsEnabled: boolean;          // playback guardrail monitor
  dashboardEnabled: boolean;           // dashboard visibility
  killSwitch: boolean;                 // default ON — disables the canary entirely
  allowedDeploymentId: string | null;  // must match the current deployment id
  currentDeploymentId: string | null;
  appEnv: string | null;               // must be 'preview'
  maxSessions: number;                 // minimum by default
}

let cached: AiPreviewCanaryConfig | null = null;

export function getAiPreviewCanaryConfig(): AiPreviewCanaryConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    canaryEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_ENABLED, false),
    resolutionEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_RESOLUTION_ENABLED, false),
    queueEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_QUEUE_ENABLED, false),
    eventsEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_EVENTS_ENABLED, false),
    guardrailsEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_GUARDRAILS_ENABLED, false),
    dashboardEnabled: envBool(env.VITE_AI_PREVIEW_CANARY_DASHBOARD_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_PREVIEW_CANARY_KILL_SWITCH, true),   // default ON
    allowedDeploymentId: envStr(env.VITE_AI_PREVIEW_CANARY_ALLOWED_DEPLOYMENT_ID) ?? null,
    currentDeploymentId: envStr(env.VITE_AI_PREVIEW_CANARY_DEPLOYMENT_ID) ?? null,
    appEnv: envStr(env.VITE_AI_PREVIEW_CANARY_ENV) ?? null,
    maxSessions: envInt(env.VITE_AI_PREVIEW_CANARY_MAX_SESSIONS, CANARY_DEFAULT_MAX_SESSIONS),
  };
  return cached;
}

export function __resetAiPreviewCanaryConfig(): void { cached = null; }
