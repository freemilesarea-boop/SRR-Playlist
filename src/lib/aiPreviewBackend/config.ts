// AI-MUSIC-12 — Preview backend provisioning feature flags. EVERY flag defaults **OFF**, the kill switch defaults
// **ON**, and every id/ref default is **empty/unset**, gated behind the AI-MUSIC master flag. Nothing here ever
// creates a Supabase resource, mutates a Vercel environment variable, applies a migration, or changes the queue/
// playback — the flags only reveal the audit/planning dashboard in a Preview deployment. Only non-secret ids/
// refs are surfaced (the production ref is used only to REJECT it).

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | null { return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s == null) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';   // SRR Playlist production — used ONLY to reject it.
export const ORG_ID = 'dsugddwldpqycyrmuxhg';

export interface AiPreviewBackendConfig {
  masterEnabled: boolean;
  backendDashboardEnabled: boolean;
  killSwitch: boolean;                 // default ON
  previewProjectRef: string | null;    // default unset
  previewDeploymentId: string | null;
  costApproved: boolean;               // explicit approval for a cost-bearing resource (default false)
}

let cached: AiPreviewBackendConfig | null = null;

export function getAiPreviewBackendConfig(): AiPreviewBackendConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    backendDashboardEnabled: envBool(env.VITE_AI_PREVIEW_BACKEND_DASHBOARD_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_PREVIEW_KILL_SWITCH, true),   // default ON (shared with testbed)
    previewProjectRef: envStr(env.VITE_AI_PREVIEW_PROJECT_REF),
    previewDeploymentId: envStr(env.VITE_AI_PREVIEW_DEPLOYMENT_ID),
    costApproved: envBool(env.VITE_AI_PREVIEW_COST_APPROVED, false),   // default false — no auto cost-bearing create
  };
  return cached;
}

export function __resetAiPreviewBackendConfig(): void { cached = null; }
