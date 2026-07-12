// AI-MUSIC-11 — Preview testbed feature flags. EVERY flag defaults **OFF**, the kill switch defaults **ON**, and
// every id/ref/candidate default is **empty/unset**, gated behind the AI-MUSIC master flag. Nothing here ever
// applies a production migration, creates a real store/account, changes the queue/playback, or runs a canary —
// the flags only reveal the provisioning/validation dashboard in a Preview deployment. Secrets/credentials are
// never read into the repo; only non-secret ids/refs are surfaced (and the production ref is only used to REJECT
// it in the seeder/cleanup guards).

import { getAiMusicConfig } from '../aiMusic/config';

function envStr(v: unknown): string | null { return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; }
function envNum(v: unknown, dflt: number): number { const s = envStr(v); if (s == null) return dflt; const n = Number(s); return Number.isFinite(n) ? n : dflt; }
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s == null) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}

export const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';   // SRR Playlist production — used ONLY to reject it.

export interface AiPreviewTestbedConfig {
  masterEnabled: boolean;              // inherits AI-MUSIC master (default OFF)
  testbedEnabled: boolean;             // provisioning dashboard visibility
  killSwitch: boolean;                 // default ON — no runtime activation
  previewProjectRef: string | null;    // default unset
  previewDeploymentId: string | null;
  storeId: string | null;
  existingPlaylistId: string | null;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  candidateSnapshot: string | null;
  maxSessions: number;                 // pinned to 1
  maxApplications: number;
}

let cached: AiPreviewTestbedConfig | null = null;

export function getAiPreviewTestbedConfig(): AiPreviewTestbedConfig {
  if (cached) return cached;
  let env: Record<string, unknown> = {};
  try { env = import.meta.env as unknown as Record<string, unknown>; } catch { /* noop */ }
  cached = {
    masterEnabled: getAiMusicConfig().aiMusicEnabled,
    testbedEnabled: envBool(env.VITE_AI_PREVIEW_TESTBED_ENABLED, false),
    killSwitch: envBool(env.VITE_AI_PREVIEW_KILL_SWITCH, true),   // default ON
    previewProjectRef: envStr(env.VITE_AI_PREVIEW_PROJECT_REF),
    previewDeploymentId: envStr(env.VITE_AI_PREVIEW_DEPLOYMENT_ID),
    storeId: envStr(env.VITE_AI_PREVIEW_STORE_ID),
    existingPlaylistId: envStr(env.VITE_AI_PREVIEW_EXISTING_PLAYLIST_ID),
    candidatePlaylistId: envStr(env.VITE_AI_PREVIEW_CANDIDATE_PLAYLIST_ID),
    candidateVersion: envStr(env.VITE_AI_PREVIEW_CANDIDATE_VERSION) == null ? null : envNum(env.VITE_AI_PREVIEW_CANDIDATE_VERSION, 0),
    candidateSnapshot: envStr(env.VITE_AI_PREVIEW_CANDIDATE_SNAPSHOT),
    maxSessions: 1,   // hard-pinned
    maxApplications: Math.max(1, envNum(env.VITE_AI_PREVIEW_MAX_APPLICATIONS, 1)),
  };
  return cached;
}

export function __resetAiPreviewTestbedConfig(): void { cached = null; }
