// WEB-OBS-2 — Admin Observability query wrapper.
//
// Composes the three security-definer RPCs (0455) with the pure observability logic
// (src/lib/observability/*). The server returns only low-cost aggregates + sample counts; ALL
// verdicts (health score/status, regression classification, confidence, fingerprint grouping,
// incident rules, risk scores) are computed client-side from those numbers against the shared
// TypeScript thresholds — a single source of truth, unit-tested. Raw payloads are never bulk-returned.
//
// Failure isolation: each call throws on RPC error; the dashboard catches and renders inline
// error+retry. Nothing here touches app boot or the global ErrorBoundary.

import { supabase } from '@/lib/supabase';
import {
  computeHealth, type HealthInput, type HealthResult,
  compareReleases, type ReleaseMetrics, type MetricSample, type ReleaseComparison,
  groupErrors, type ErrorOccurrence, type ErrorGroup,
  routeRiskScore, apiRiskScore, type RiskResult,
  buildIncidents, type IncidentCandidate,
  safeRatio,
} from '@/lib/observability';

export type ObsWindow = '1h' | '24h' | '7d' | '30d';

export interface ObsFilters {
  window?: ObsWindow;
  release?: string | null;
  environment?: string | null;
  browser?: string | null;
}

// ── Server response shapes (mirror 0455 RPC jsonb) ──────────────────────────
interface OverviewTotals {
  total_events: number; sessions: number; error_count: number; critical_error_count: number;
  chunk_error_sessions: number; hydration_error_sessions: number; api_count: number; slow_api_count: number;
  route_count: number; slow_route_count: number; long_task_count: number; memory_risk_sessions: number;
}
export interface VitalStat { count: number; p50: number | null; p75: number | null; p95: number | null; poor: number; }
export interface SlowRouteRow { route: string; count: number; sessions: number; p50: number | null; p75: number | null; p95: number | null; worst: number | null; }
export interface SlowApiRow { name: string; kind: string; count: number; sessions: number; p50: number | null; p75: number | null; p95: number | null; worst: number | null; }
export interface LongTaskRow { route: string; count: number; sessions: number; worst: number | null; p95: number | null; }

interface OverviewResponse {
  ok: boolean; window: ObsWindow; since: string;
  totals: OverviewTotals; vitals: Record<string, VitalStat>;
  slow_routes: SlowRouteRow[]; slow_apis: SlowApiRow[]; long_tasks: LongTaskRow[];
  releases: Record<string, number>;
}

interface ReleaseRow {
  release: string; events: number; sessions: number; error_count: number; critical_count: number;
  chunk_sessions: number; hydration_sessions: number; api_count: number; slow_api_count: number;
  route_count: number; slow_route_count: number; long_task_count: number; memory_risk_sessions: number;
  lcp_p75: number | null; lcp_n: number; inp_p75: number | null; inp_n: number;
  cls_p75: number | null; cls_n: number; ttfb_p75: number | null; ttfb_n: number;
}
interface ReleaseCompareResponse { ok: boolean; window: ObsWindow; release_a: string | null; release_b: string | null; releases: Record<string, ReleaseRow>; }

interface ErrorOccurrenceRow {
  kind: string; message: string; route: string; release: string; browser: string; severity: string;
  count: number; sessions: number; first_seen: string | null; last_seen: string | null;
}
interface ByBrowserRow { browser: string; error_events: number; error_sessions: number; total_events: number; total_sessions: number; }
interface ErrorsResponse { ok: boolean; window: ObsWindow; since: string; occurrences: ErrorOccurrenceRow[]; by_browser: ByBrowserRow[]; }

// ── Composed client shapes ──────────────────────────────────────────────────
export interface OverviewResult {
  window: ObsWindow;
  totals: OverviewTotals;
  health: HealthResult;
  vitals: Record<string, VitalStat>;
  slowRoutes: Array<SlowRouteRow & { risk: RiskResult }>;
  slowApis: Array<SlowApiRow & { risk: RiskResult }>;
  longTasks: LongTaskRow[];
  releases: Record<string, number>;
}

export interface ReleaseCompareResult {
  window: ObsWindow;
  releaseA: string | null;
  releaseB: string | null;
  comparison: ReleaseComparison | null;
  raw: Record<string, ReleaseRow>;
}

export interface ErrorsResult {
  window: ObsWindow;
  groups: ErrorGroup[];
  byBrowser: ByBrowserRow[];
  browserAnomalies: Array<{ browser: string; errorRate: number; baselineRate: number; sessions: number }>;
}

function rpcErr(where: string, error: unknown): never {
  console.error(`[observabilityApi] ${where} failed`, error);
  throw error instanceof Error ? error : new Error(String(error));
}

// ── Overview ────────────────────────────────────────────────────────────────
export async function getObservabilityOverview(f: ObsFilters = {}): Promise<OverviewResult> {
  const window = f.window ?? '24h';
  const { data, error } = await supabase.rpc('admin_observability_overview', {
    p_window: window, p_release: f.release ?? null, p_environment: f.environment ?? null, p_browser: f.browser ?? null,
  });
  if (error) rpcErr('admin_observability_overview', error);
  const res = (data ?? {}) as Partial<OverviewResponse>;
  const totals = (res.totals ?? {}) as OverviewTotals;
  const vitals = res.vitals ?? {};

  const healthInput: HealthInput = {
    totalEvents: totals.total_events ?? 0,
    sessions: totals.sessions ?? 0,
    errorCount: totals.error_count ?? 0,
    criticalErrorCount: totals.critical_error_count ?? 0,
    chunkErrorSessions: totals.chunk_error_sessions ?? 0,
    hydrationErrorSessions: totals.hydration_error_sessions ?? 0,
    apiCount: totals.api_count ?? 0,
    slowApiCount: totals.slow_api_count ?? 0,
    routeCount: totals.route_count ?? 0,
    slowRouteCount: totals.slow_route_count ?? 0,
    longTaskCount: totals.long_task_count ?? 0,
    lcpP75: vitals.LCP?.p75 ?? null,
    inpP75: vitals.INP?.p75 ?? null,
    clsP75: vitals.CLS?.p75 ?? null,
    bootRecoveryAttempts: null, // no boot-recovery telemetry channel this phase → component skipped
    bootRecoveryFailures: null,
  };

  const routeErrorRate = safeRatio(totals.error_count ?? 0, totals.route_count || 1);
  const slowRoutes = (res.slow_routes ?? []).map((r) => ({
    ...r,
    risk: routeRiskScore({ p95: r.p95, errorRate: routeErrorRate, sessions: r.sessions, longTasks: 0, sampleCount: r.count }),
  }));
  const slowApis = (res.slow_apis ?? []).map((a) => ({
    ...a,
    risk: apiRiskScore({ p95: a.p95, failureRate: 0, timeoutRate: 0, networkErrorRate: 0, sessions: a.sessions, sampleCount: a.count }),
  }));

  return {
    window, totals, health: computeHealth(healthInput), vitals,
    slowRoutes, slowApis, longTasks: res.long_tasks ?? [], releases: res.releases ?? {},
  };
}

// ── Release comparison ────────────────────────────────────────────────────────
function toReleaseMetrics(row: ReleaseRow): ReleaseMetrics {
  const sessions = row.sessions || 0;
  const events = row.events || 0;
  const rate = (n: number, d: number, count: number): MetricSample => ({ value: d > 0 ? n / d : null, count });
  return {
    release: row.release, sessions, events,
    metrics: {
      errorRate: rate(row.error_count, events, events),
      criticalErrorRate: rate(row.critical_count, events, events),
      chunkFailureRate: rate(row.chunk_sessions, sessions, sessions),
      hydrationErrorRate: rate(row.hydration_sessions, sessions, sessions),
      slowApiRate: rate(row.slow_api_count, row.api_count, row.api_count),
      slowRouteRate: rate(row.slow_route_count, row.route_count, row.route_count),
      longTaskRate: { value: sessions > 0 ? row.long_task_count / sessions : null, count: sessions },
      memoryRiskRate: rate(row.memory_risk_sessions, sessions, sessions),
      lcpP75: { value: row.lcp_p75, count: row.lcp_n },
      inpP75: { value: row.inp_p75, count: row.inp_n },
      clsP75: { value: row.cls_p75, count: row.cls_n },
      ttfbP75: { value: row.ttfb_p75, count: row.ttfb_n },
      bootRecoverySuccessRate: { value: null, count: 0 },
    },
  };
}

export async function getReleaseComparison(
  f: Omit<ObsFilters, 'release' | 'browser'> & { releaseA?: string | null; releaseB?: string | null } = {},
): Promise<ReleaseCompareResult> {
  const window = f.window ?? '7d';
  const { data, error } = await supabase.rpc('admin_observability_release_compare', {
    p_window: window, p_release_a: f.releaseA ?? null, p_release_b: f.releaseB ?? null, p_environment: f.environment ?? null,
  });
  if (error) rpcErr('admin_observability_release_compare', error);
  const res = (data ?? {}) as Partial<ReleaseCompareResponse>;
  const raw = res.releases ?? {};
  const a = res.release_a ? raw[res.release_a] : undefined;
  const b = res.release_b ? raw[res.release_b] : undefined;
  const comparison = a && b ? compareReleases(toReleaseMetrics(a), toReleaseMetrics(b)) : null;
  return { window, releaseA: res.release_a ?? null, releaseB: res.release_b ?? null, comparison, raw };
}

// ── Errors ────────────────────────────────────────────────────────────────────
/** Browser-specific error concentration: a browser whose error rate materially exceeds the fleet
 *  average, gated for sample size (fleet-wide baseline vs the group). */
function browserAnomalies(rows: ByBrowserRow[]): ErrorsResult['browserAnomalies'] {
  const fleetErrors = rows.reduce((s, r) => s + r.error_events, 0);
  const fleetEvents = rows.reduce((s, r) => s + r.total_events, 0);
  const baseline = fleetEvents > 0 ? fleetErrors / fleetEvents : 0;
  return rows
    .filter((r) => r.total_events >= 30 && r.total_sessions >= 3)
    .map((r) => ({ browser: r.browser, errorRate: safeRatio(r.error_events, r.total_events), baselineRate: baseline, sessions: r.error_sessions }))
    .filter((r) => r.errorRate >= Math.max(0.02, r.baselineRate * 2))
    .sort((a, b) => b.errorRate - a.errorRate);
}

export async function getObservabilityErrors(f: ObsFilters = {}): Promise<ErrorsResult> {
  const window = f.window ?? '24h';
  const { data, error } = await supabase.rpc('admin_observability_errors', {
    p_window: window, p_release: f.release ?? null, p_environment: f.environment ?? null, p_browser: f.browser ?? null, p_limit: 200,
  });
  if (error) rpcErr('admin_observability_errors', error);
  const res = (data ?? {}) as Partial<ErrorsResponse>;
  const occurrences: ErrorOccurrence[] = (res.occurrences ?? []).map((o) => ({
    kind: o.kind, message: o.message, route: o.route, release: o.release, browser: o.browser,
    severity: o.severity, count: o.count, sessions: o.sessions, firstSeen: o.first_seen, lastSeen: o.last_seen,
  }));
  return {
    window,
    groups: groupErrors(occurrences),
    byBrowser: res.by_browser ?? [],
    browserAnomalies: browserAnomalies(res.by_browser ?? []),
  };
}

// ── Incidents (composed from the three sources) ─────────────────────────────
export function deriveIncidents(
  overview: OverviewResult,
  errors: ErrorsResult,
  release: ReleaseCompareResult | null,
): IncidentCandidate[] {
  const t = overview.totals;
  const sessions = t.sessions || 0;
  return buildIncidents({
    errorGroups: errors.groups,
    criticalErrorRate: safeRatio(t.critical_error_count, t.total_events),
    chunkFailureRate: safeRatio(t.chunk_error_sessions, sessions),
    chunkFailureSessions: t.chunk_error_sessions,
    hydrationErrorSessions: t.hydration_error_sessions,
    totalSessions: sessions,
    releaseRegressions: release?.comparison?.rows.filter((r) => r.classification === 'REGRESSED') ?? [],
    currentRelease: release?.releaseB ?? null,
    previousRelease: release?.releaseA ?? null,
    browserAnomalies: errors.browserAnomalies,
    memoryRiskSessions: t.memory_risk_sessions,
    bootRecoveryAttempts: null,
    bootRecoveryFailures: null,
  });
}
