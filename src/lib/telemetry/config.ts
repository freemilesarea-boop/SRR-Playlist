// WEB-OBS-1 — Telemetry runtime configuration + Kill Switch.
//
// Every knob is an environment variable with a SAFE default, so a missing/mistyped var can never
// break boot and never turns telemetry "more aggressive" than intended. Nothing here is a secret:
// the endpoint is same-origin and the sample rates are non-sensitive. The kill switches let ops
// disable collection and/or transport independently WITHOUT a code change or redeploy of app logic
// (flip the Vercel env + redeploy static build). Collection can stay on (session dashboard still
// works) while transport is off (nothing leaves the browser).

import { BUILD_ID } from '@/lib/bootRecovery';
import type { TelemetryEnvironment, TelemetryEventType } from './schema';

function envStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Parse a boolean env with an explicit default. Only 'false'/'0'/'off' disable; anything else = default-or-true. */
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

/** Resolve the deployment environment label — reused from the app's existing VITE_APP_ENV convention. */
export function resolveEnvironment(): TelemetryEnvironment {
  const raw = envStr(import.meta.env.VITE_APP_ENV)?.toLowerCase();
  if (raw === 'production' || raw === 'prod') return 'production';
  if (raw === 'preview' || raw === 'staging') return 'preview';
  if (raw === 'development' || raw === 'dev') return 'development';
  // Fall back to Vite's build mode.
  try {
    if (import.meta.env.PROD) return 'production';
    if (import.meta.env.DEV) return 'development';
  } catch { /* noop */ }
  return 'unknown';
}

export interface TelemetryConfig {
  /** Master switch for the whole collection engine (WEB-OPT-11). OFF → nothing is collected. */
  collectionEnabled: boolean;
  /** Switch for the server transport only. OFF → collect locally, never send. */
  transportEnabled: boolean;
  /** Same-origin ingestion endpoint. Kept configurable but defaults to the app's own route. */
  endpoint: string;
  /** Release/build id (release attribution). Mirrors Sentry release (VITE_BUILD_ID). */
  release: string;
  environment: TelemetryEnvironment;
  /** Flush when this many events are buffered. */
  batchSize: number;
  /** Periodic flush interval (ms). */
  flushIntervalMs: number;
  /** Hard cap on the in-memory outbound buffer. Oldest non-error events drop past this. */
  maxBuffer: number;
  /** Base sample rate applied to sampleable streams (errors are always 1). */
  baseSampleRate: number;
}

/**
 * Per-event-type sample rate. Errors and boot/critical recovery signals are NEVER sampled
 * (rate 1). High-frequency streams inherit the base rate. Preview keeps a high base so QA sees
 * data; production defaults conservative. The base is overridable via VITE_TELEMETRY_SAMPLE_RATE.
 */
export function sampleRateFor(type: TelemetryEventType, base: number): number {
  switch (type) {
    // Never sampled — always fully captured.
    case 'error':
      return 1;
    // Low-frequency, high-signal — capture fully regardless of base.
    case 'route':
    case 'vital':
      return 1;
    // High-frequency — subject to the configured base sample rate.
    case 'api':
    case 'longtask':
    case 'interaction':
    case 'memory':
      return base;
    default:
      return base;
  }
}

let cached: TelemetryConfig | null = null;

export function getTelemetryConfig(): TelemetryConfig {
  if (cached) return cached;
  const env = resolveEnvironment();
  // Production defaults to a conservative base; preview/dev default high so QA sees telemetry.
  const defaultBase = env === 'production' ? 0.25 : 1;
  cached = {
    collectionEnabled: envBool(import.meta.env.VITE_TELEMETRY_ENABLED, true),
    transportEnabled: envBool(import.meta.env.VITE_TELEMETRY_TRANSPORT_ENABLED, true),
    endpoint: envStr(import.meta.env.VITE_TELEMETRY_ENDPOINT) ?? '/api/telemetry/runtime',
    release: BUILD_ID,
    environment: env,
    batchSize: Math.round(envNum(import.meta.env.VITE_TELEMETRY_BATCH_SIZE, 20, 1, 50)),
    flushIntervalMs: Math.round(envNum(import.meta.env.VITE_TELEMETRY_FLUSH_MS, 20_000, 5_000, 120_000)),
    maxBuffer: Math.round(envNum(import.meta.env.VITE_TELEMETRY_MAX_BUFFER, 200, 20, 1_000)),
    baseSampleRate: envNum(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE, defaultBase, 0.001, 1),
  };
  return cached;
}

/** Test-only reset of the memoized config. */
export function __resetTelemetryConfig(): void {
  cached = null;
}
