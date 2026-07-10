// WEB-OBS-1 — Admin Runtime Telemetry query wrapper.
//
// Server-side aggregation lives in the `admin_query_runtime_telemetry` security-definer RPC (0454),
// which re-checks `_is_super_admin()` internally and only accepts an allow-list of filters with
// parameter binding (no dynamic SQL). This matches how every other admin panel in the app queries
// server data (supabase.rpc('admin_...')), so no duplicate edge endpoint is introduced — the RPC IS
// the gated, parameterized server query. Raw events are NOT bulk-returned; only aggregates + a
// bounded, paginated diagnostic page of already-sanitized rows.

import { supabase } from '@/lib/supabase';

export type TelemetryWindow = '1h' | '24h' | '7d' | '30d';

export interface TelemetryVitalStat {
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  poor: number;
}
export interface TelemetryRouteAgg { route: string; count: number; avg_duration: number | null; }
export interface TelemetryErrorAgg { kind: string; message: string; route: string; count: number; }
export interface TelemetryApiAgg { name: string; kind: string; count: number; worst: number | null; p95: number | null; avg: number | null; }
export interface TelemetryLongTaskAgg { route: string; count: number; worst: number | null; p95: number | null; }
export interface TelemetryInteractionAgg { count: number; p75: number | null; p95: number | null; worst: number | null; }

export interface TelemetryRow {
  event_id: string;
  event_type: string;
  session_id: string;
  sequence: number;
  occurred_at: number;
  received_at: string;
  release: string;
  environment: string;
  route: string;
  previous_route: string | null;
  duration_ms: number | null;
  severity: string;
  browser_family: string;
  browser_major: number | null;
  os_family: string;
  device_class: string;
  viewport_bucket: string;
  network_type: string | null;
  sample_rate: number;
  payload: Record<string, unknown>;
}

export interface TelemetryQueryResult {
  ok: boolean;
  window: TelemetryWindow;
  since: string;
  total: number;
  summary: {
    by_type: Record<string, number>;
    vitals: Record<string, TelemetryVitalStat>;
    routes: TelemetryRouteAgg[];
    errors: TelemetryErrorAgg[];
    releases: Record<string, number>;
    apis: TelemetryApiAgg[];
    long_tasks: TelemetryLongTaskAgg[];
    browsers: Record<string, number>;
    devices: Record<string, number>;
    interactions: TelemetryInteractionAgg;
  };
  page: { limit: number; offset: number; rows: TelemetryRow[] };
}

export interface TelemetryQueryParams {
  window?: TelemetryWindow;
  release?: string | null;
  route?: string | null;
  browser?: string | null;
  eventType?: string | null;
  limit?: number;
  offset?: number;
}

const EMPTY: Omit<TelemetryQueryResult, 'window'> = {
  ok: true,
  since: '',
  total: 0,
  summary: {
    by_type: {}, vitals: {}, routes: [], errors: [], releases: {},
    apis: [], long_tasks: [], browsers: {}, devices: {},
    interactions: { count: 0, p75: null, p95: null, worst: null },
  },
  page: { limit: 0, offset: 0, rows: [] },
};

/** Super-admin only (enforced inside the RPC). Returns aggregates + a bounded page of sanitized rows. */
export async function adminQueryRuntimeTelemetry(params: TelemetryQueryParams = {}): Promise<TelemetryQueryResult> {
  const window: TelemetryWindow = params.window ?? '24h';
  const { data, error } = await supabase.rpc('admin_query_runtime_telemetry', {
    p_window: window,
    p_release: params.release ?? null,
    p_route: params.route ?? null,
    p_browser: params.browser ?? null,
    p_event_type: params.eventType ?? null,
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
  });
  if (error) {
    console.error('[runtimeTelemetryApi] admin_query_runtime_telemetry failed', error);
    throw error;
  }
  const raw = (data ?? {}) as Partial<TelemetryQueryResult>;
  return { ...EMPTY, ...raw, window } as TelemetryQueryResult;
}
