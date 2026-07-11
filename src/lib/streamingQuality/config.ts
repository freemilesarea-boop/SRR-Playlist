// WEB-OBS-7 — Streaming Quality feature flags & kill switches.
//
// EMIT flags (VITE_SQ_*) gate the client-side quality emit from Player.tsx. They default OFF (opt-in):
// until VITE_SQ_TELEMETRY_ENABLED is set, NO streaming-quality event is emitted — the migration is not
// applied to prod, so this avoids emitting to a nonexistent RPC and adds zero network traffic and zero
// behavior change. DASHBOARD flags default ON (admin-only, read-only, fail-open). A kill switch OFF
// only stops the quality EMIT — it can never disable playback, the queue, crossfade, or recovery.

function envStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function envBool(v: unknown, dflt: boolean): boolean {
  const s = envStr(v)?.toLowerCase();
  if (s === undefined) return dflt;
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
  return dflt;
}
function envNum(v: unknown, dflt: number, min: number, max: number): number {
  const s = envStr(v);
  if (s === undefined) return dflt;
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export interface StreamingQualityConfig {
  // ── EMIT (Player) — default OFF (opt-in) ──
  telemetryEnabled: boolean;
  ttfaEnabled: boolean;
  transitionEnabled: boolean;
  crossfadeEnabled: boolean;
  stallEnabled: boolean;
  preloadEnabled: boolean;
  recoveryEnabled: boolean;
  mediaErrorEnabled: boolean;
  /** Session-stable emit sample rate (0..1). 1 = emit all, <1 = sample outcome events. */
  sampleRate: number;
  maxBatch: number;
  flushMs: number;

  // ── DASHBOARD (admin) — default ON ──
  dashboardEnabled: boolean;
  incidentsEnabled: boolean;
  advisorEnabled: boolean;
  autoRefreshEnabled: boolean;
  autoRefreshMs: number;
  minSessions: number;
  minStores: number;
}

let cached: StreamingQualityConfig | null = null;

export function getStreamingQualityConfig(): StreamingQualityConfig {
  if (cached) return cached;
  const env = import.meta.env;
  cached = {
    telemetryEnabled: envBool(env.VITE_SQ_TELEMETRY_ENABLED, false), // OPT-IN
    ttfaEnabled: envBool(env.VITE_SQ_TTFA_ENABLED, true),
    transitionEnabled: envBool(env.VITE_SQ_TRANSITION_ENABLED, true),
    crossfadeEnabled: envBool(env.VITE_SQ_CROSSFADE_ENABLED, true),
    stallEnabled: envBool(env.VITE_SQ_STALL_ENABLED, true),
    preloadEnabled: envBool(env.VITE_SQ_PRELOAD_ENABLED, true),
    recoveryEnabled: envBool(env.VITE_SQ_RECOVERY_ENABLED, true),
    mediaErrorEnabled: envBool(env.VITE_SQ_MEDIA_ERROR_ENABLED, true),
    sampleRate: envNum(env.VITE_SQ_SAMPLE_RATE, 1, 0, 1),
    maxBatch: Math.round(envNum(env.VITE_SQ_MAX_BATCH, 20, 1, 40)),
    flushMs: Math.round(envNum(env.VITE_SQ_FLUSH_MS, 10_000, 2_000, 60_000)),
    dashboardEnabled: envBool(env.VITE_SQ_DASHBOARD_ENABLED, true),
    incidentsEnabled: envBool(env.VITE_SQ_INCIDENTS_ENABLED, true),
    advisorEnabled: envBool(env.VITE_SQ_ADVISOR_ENABLED, true),
    autoRefreshEnabled: envBool(env.VITE_SQ_AUTO_REFRESH_ENABLED, true),
    autoRefreshMs: Math.round(envNum(env.VITE_SQ_AUTO_REFRESH_MS, 60_000, 15_000, 600_000)),
    minSessions: Math.round(envNum(env.VITE_SQ_MIN_SESSIONS, 5, 1, 100_000)),
    minStores: Math.round(envNum(env.VITE_SQ_MIN_STORES, 3, 1, 100_000)),
  };
  return cached;
}

export function __resetStreamingQualityConfig(): void {
  cached = null;
}
