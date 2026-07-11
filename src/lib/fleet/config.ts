// WEB-OBS-6 — Store Fleet Monitoring feature flags & kill switches.
//
// Two independent domains, mirroring the telemetry/observability split:
//   • EMIT flags (VITE_FLEET_*) gate the client-side player-health telemetry emit. They default OFF
//     (opt-in): until an operator sets VITE_FLEET_TELEMETRY_ENABLED=true, NO store emits any fleet
//     telemetry — no new network traffic, no behavior change. This is the safest default for code that
//     would otherwise run on every store player 24/7.
//   • DASHBOARD flags gate the admin-only, read-only Fleet dashboard. They default ON (harmless).
//
// Every flag has a SAFE, non-secret default. A missing/mistyped env var can never break boot, the
// player, the queue, the scheduler, or the existing runtime telemetry. Kill switch OFF → emit stops
// (fail-open), the dashboard shows a disabled notice, and nothing else is affected.

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
function envInt(v: unknown, dflt: number, min: number, max: number): number {
  const s = envStr(v);
  if (s === undefined) return dflt;
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export interface FleetConfig {
  // ── EMIT (client) — default OFF (opt-in) ──
  /** Master switch for the store player-health telemetry emit. OFF → no store emits anything. */
  telemetryEnabled: boolean;
  /** Periodic heartbeat emit. OFF → discrete events only (still requires telemetryEnabled). */
  heartbeatEnabled: boolean;
  /** Heartbeat cadence (ms), bounded ≥30s so we never hammer the network from a kiosk. */
  heartbeatIntervalMs: number;
  /** Max events buffered before a flush is forced. */
  maxBatch: number;

  // ── DASHBOARD (admin) — default ON ──
  dashboardEnabled: boolean;
  incidentsEnabled: boolean;
  silenceDetectionEnabled: boolean;
  repetitionDetectionEnabled: boolean;
  advisorEnabled: boolean;
  recoveryEnabled: boolean;
  autoRefreshEnabled: boolean;
  autoRefreshMs: number;
  /** Minimum telemetry-stores before a fleet verdict is shown (else INSUFFICIENT_DATA). */
  minStores: number;
}

let cached: FleetConfig | null = null;

export function getFleetConfig(): FleetConfig {
  if (cached) return cached;
  const env = import.meta.env;
  cached = {
    telemetryEnabled: envBool(env.VITE_FLEET_TELEMETRY_ENABLED, false),       // OPT-IN
    heartbeatEnabled: envBool(env.VITE_FLEET_HEARTBEAT_ENABLED, true),
    heartbeatIntervalMs: envInt(env.VITE_FLEET_HEARTBEAT_MS, 60_000, 30_000, 600_000),
    maxBatch: envInt(env.VITE_FLEET_MAX_BATCH, 20, 1, 40),
    dashboardEnabled: envBool(env.VITE_FLEET_DASHBOARD_ENABLED, true),
    incidentsEnabled: envBool(env.VITE_FLEET_INCIDENTS_ENABLED, true),
    silenceDetectionEnabled: envBool(env.VITE_FLEET_SILENCE_DETECTION_ENABLED, true),
    repetitionDetectionEnabled: envBool(env.VITE_FLEET_REPETITION_DETECTION_ENABLED, true),
    advisorEnabled: envBool(env.VITE_FLEET_ADVISOR_ENABLED, true),
    recoveryEnabled: envBool(env.VITE_FLEET_RECOVERY_ENABLED, true),
    autoRefreshEnabled: envBool(env.VITE_FLEET_AUTO_REFRESH_ENABLED, true),
    autoRefreshMs: envInt(env.VITE_FLEET_AUTO_REFRESH_MS, 60_000, 15_000, 600_000),
    minStores: envInt(env.VITE_FLEET_MIN_STORES, 3, 1, 10_000),
  };
  return cached;
}

/** Test-only reset of the memoized config. */
export function __resetFleetConfig(): void {
  cached = null;
}
