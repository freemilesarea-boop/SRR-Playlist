// WEB-OBS-8 — Intelligent Operations API. Wraps the 0461 security-definer RPCs (super-admin only) and
// composes the pure streamingOps engines client-side. Read-only; nothing is executed. Reuses the
// WEB-OBS-7 aggregate mapper (rowToAggregate) so the SqeRow shape stays single-sourced.

import { supabase } from '@/lib/supabase';
import { rowToAggregate, type SqeRow, type SqWindow } from './streamingQualityApi';
import { computeStreamingQuality } from '@/lib/streamingQuality';
import type { StreamingQualityResult } from '@/lib/streamingQuality';
import {
  computeReliabilityIndex, computeSignalCoverage, buildQualityMatrix, buildReleaseHeatmap,
  buildEnterpriseHeatmap, buildQualityTrend, computePredictiveWarning, computeReleaseRisk,
  detectProgressiveIncident, buildPlaybackReplay, buildFleetReplay, buildRootCauseEvidence,
  type MatrixDimension, type QualityMatrix, type ReliabilityIndex, type CoverageReport,
  type ReleaseHeatmap, type EnterpriseHeatmap, type QualityTrend, type PredictiveWarning,
  type ReleaseRisk, type ProgressiveIncident, type IncidentTick, type PlaybackReplay, type FleetReplay,
  type RootCauseEvidence, type SqEventRow, type SqTimeBucket, type FleetSnapshot,
} from '@/lib/streamingOps';

export type { SqWindow } from './streamingQualityApi';

/** A time-bucket SqeRow (scope = iso bucket start) → SqTimeBucket (rates + engine score). */
function rowToBucket(r: SqeRow): SqTimeBucket {
  const agg = rowToAggregate(r);
  const q = computeStreamingQuality(agg);
  return {
    bucketStart: r.scope,
    sessions: agg.sessions,
    ttfaP75: q.ttfa.p75,
    startSuccessRate: q.start.successRate,
    mediaErrorRate: q.mediaError.sessionRate,
    stallRate: q.stall.sessionRate,
    recoveryFailedRate: agg.recoveryAttempted > 0 ? agg.recoveryFailed / agg.recoveryAttempted : null,
    score: q.score,
  };
}

// ── Overview: reliability index + coverage + release heatmap + release risk ──
export interface OpsOverview {
  window: SqWindow;
  overall: StreamingQualityResult;
  reliability: ReliabilityIndex;
  coverage: CoverageReport;
  releaseHeatmap: ReleaseHeatmap;
  releaseRisk: ReleaseRisk | null;
  fleetStores: number;
}
export async function getOpsOverview(window: SqWindow = '24h', environment: string | null = null, release: string | null = null): Promise<OpsOverview | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_overview', { p_window: window, p_environment: environment, p_release: release });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; overall?: SqeRow; by_release?: SqeRow[] };
  if (!res.ok || !res.overall) return null;
  const agg = rowToAggregate(res.overall);
  const overall = computeStreamingQuality(agg);
  const reliability = computeReliabilityIndex(overall);
  const coverage = computeSignalCoverage(agg);
  const fleetStores = res.overall.stores ?? 0;

  const perRelease = (res.by_release ?? []).map((r) => ({ scope: r.scope, stores: r.stores ?? 0, agg: rowToAggregate(r), q: computeStreamingQuality(rowToAggregate(r)) }));
  const releaseHeatmap = buildReleaseHeatmap(perRelease.map((r) => ({ release: r.scope, stores: r.stores, aggregate: r.agg })));

  // Release risk: baseline = most sessions, canary = the next most-sessions release.
  const ranked = [...perRelease].filter((r) => r.q.sessions > 0).sort((a, b) => b.q.sessions - a.q.sessions);
  const releaseRisk = ranked.length >= 2 ? computeReleaseRisk(ranked[1].q, ranked[0].q, ranked[1].stores, fleetStores) : null;

  return { window, overall, reliability, coverage, releaseHeatmap, releaseRisk, fleetStores };
}

// ── Matrix (browser / device / os) ──
export async function getQualityMatrix(dimension: MatrixDimension, window: SqWindow = '24h', environment: string | null = null, release: string | null = null): Promise<QualityMatrix | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_matrix', { p_dimension: dimension, p_window: window, p_environment: environment, p_release: release });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; cells?: SqeRow[] };
  if (!res.ok) return null;
  return buildQualityMatrix(dimension, (res.cells ?? []).map((r) => ({ value: r.scope, aggregate: rowToAggregate(r) })));
}

// ── Time-series → trend + predictive warning ──
export interface OpsTimeseries { granularity: string; trend: QualityTrend; predictive: PredictiveWarning; buckets: SqTimeBucket[]; }
export async function getOpsTimeseries(window: SqWindow = '24h', bucketMinutes = 60, environment: string | null = null, release: string | null = null, store: string | null = null): Promise<OpsTimeseries | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_timeseries', { p_window: window, p_bucket_minutes: bucketMinutes, p_environment: environment, p_release: release, p_store: store });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; buckets?: SqeRow[]; bucket_minutes?: number };
  if (!res.ok) return null;
  const buckets = (res.buckets ?? []).map(rowToBucket);
  const gran = (res.bucket_minutes ?? bucketMinutes) >= 1440 ? 'day' : `${res.bucket_minutes ?? bucketMinutes}min`;
  return { granularity: gran, trend: buildQualityTrend(gran, buckets), predictive: computePredictiveWarning('FLEET', buckets), buckets };
}

// ── Progressive incidents from a supplied incident-tick history (built in the dashboard) ──
export function progressiveFrom(type: string, ticks: IncidentTick[]): ProgressiveIncident { return detectProgressiveIncident(type, ticks); }

// ── Enterprise heatmap (brand → store) ──
export async function getEnterpriseHeatmap(window: SqWindow = '24h', environment: string | null = null): Promise<EnterpriseHeatmap> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_enterprise', { p_window: window, p_environment: environment });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; brands?: Array<{ brand: string; stores: number; aggregate: SqeRow }> };
  if (!res.ok || !res.brands || res.brands.length === 0) {
    return { available: false, reason: '브랜드↔매장 매핑에 해당하는 재생 품질 데이터가 없습니다 (franchise_stores 연결 매장의 이벤트 없음).' };
  }
  return buildEnterpriseHeatmap(res.brands.map((b) => ({ brand: b.brand, stores: [rowToAggregate(b.aggregate)] })));
}

// ── Store replay + root-cause ──
export interface StoreReplayBundle { replay: PlaybackReplay; rootCause: RootCauseEvidence; }
export async function getStoreReplay(store: string, session: string | null = null, window: SqWindow = '24h'): Promise<StoreReplayBundle | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_replay', { p_store: store, p_session: session, p_window: window, p_limit: 300 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; rows?: SqEventRow[] };
  if (!res.ok) return null;
  const rows = res.rows ?? [];
  return { replay: buildPlaybackReplay(store, rows), rootCause: buildRootCauseEvidence(store, rows) };
}

// ── Fleet replay ──
export async function getFleetReplay(window: SqWindow = '24h', bucketMinutes = 5, environment: string | null = null): Promise<FleetReplay | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_fleet_replay', { p_window: window, p_bucket_minutes: bucketMinutes, p_environment: environment });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; snapshots?: FleetSnapshot[] };
  if (!res.ok) return null;
  return buildFleetReplay(res.snapshots ?? []);
}

// re-export the release-risk engine for callers that already hold two results
export { computeReleaseRisk };
