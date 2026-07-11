// WEB-OBS-7 — Streaming Quality API. Wraps the security-definer RPCs (super-admin only) and composes
// the pure engines client-side (like observabilityApi/fleetApi). Read-only; nothing executed.

import { supabase } from '@/lib/supabase';
import {
  computeStreamingQuality, computeQualityRegression, detectQualityIncidents, computeQualityAdvice,
  type QualityAggregate, type StreamingQualityResult, type QualityRegression, type QualityIncident, type QualityAdvice,
} from '@/lib/streamingQuality';

export type SqWindow = '1h' | '24h' | '7d' | '30d';

/** Raw per-scope row from _sqe_aggregate / _sqe_agg_scope (WEB-OBS-8 adds optional `stores`). */
export interface SqeRow {
  scope: string; sessions: number; stores?: number;
  startSuccess: number; startFailed: number; startAbandoned: number; startRequests: number;
  ttfaP50: number | null; ttfaP75: number | null; ttfaP95: number | null; ttfaSamples: number;
  crossfadeCompleted: number; crossfadeFallback: number; crossfadeAborted: number; crossfadeApplicable: boolean;
  stallSessions: number; mediaErrorSessions: number; mediaErrorEvents: number; mediaErrorByCode: Record<string, number>;
  preloadReady: number; preloadFailed: number; recoveryAttempted: number; recoverySucceeded: number; recoveryFailed: number;
}

export function rowToAggregate(r: SqeRow): QualityAggregate {
  return {
    scope: r.scope ?? 'FLEET', sessions: r.sessions ?? 0,
    startRequests: r.startRequests ?? 0, startSuccess: r.startSuccess ?? 0, startFailed: r.startFailed ?? 0, startAbandoned: r.startAbandoned ?? 0,
    ttfa: { p50: r.ttfaP50 ?? null, p75: r.ttfaP75 ?? null, p95: r.ttfaP95 ?? null, samples: r.ttfaSamples ?? 0 },
    // Transition gap is NOT_AVAILABLE this phase (no gap event emitted) → 0 samples.
    transitionGap: { p50: null, p75: null, p95: null, samples: 0 },
    crossfadeStarted: (r.crossfadeCompleted ?? 0) + (r.crossfadeFallback ?? 0) + (r.crossfadeAborted ?? 0),
    crossfadeCompleted: r.crossfadeCompleted ?? 0, crossfadeFallback: r.crossfadeFallback ?? 0, crossfadeAborted: r.crossfadeAborted ?? 0,
    crossfadeApplicable: r.crossfadeApplicable === true,
    stallSessions: r.stallSessions ?? 0,
    mediaErrorSessions: r.mediaErrorSessions ?? 0, mediaErrorEvents: r.mediaErrorEvents ?? 0, mediaErrorByCode: r.mediaErrorByCode ?? {},
    preloadReady: r.preloadReady ?? 0, preloadFailed: r.preloadFailed ?? 0,
    recoveryAttempted: r.recoveryAttempted ?? 0, recoverySucceeded: r.recoverySucceeded ?? 0, recoveryFailed: r.recoveryFailed ?? 0,
    // Session continuity is NOT_AVAILABLE this phase (no continuity event emitted) → INSUFFICIENT_DATA.
    stableSessions: 0, continuityInterruptions: 0, continuityTransitions: 0,
  };
}

export interface StreamingQualityBundle {
  window: SqWindow;
  overall: StreamingQualityResult;
  byRelease: StreamingQualityResult[];
  startFunnel: { requests: number; success: number; failed: number; abandoned: number } | null;
  releaseRegression: QualityRegression | null;
  incidents: QualityIncident[];
  advice: QualityAdvice;
}

export async function getStreamingQualityOverview(
  window: SqWindow = '24h', environment: string | null = null, release: string | null = null,
): Promise<StreamingQualityBundle | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_overview', { p_window: window, p_environment: environment, p_release: release });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; overall?: SqeRow; by_release?: SqeRow[]; pev2_start_funnel?: { requests: number; success: number; failed: number; abandoned: number } };
  if (!res.ok || !res.overall) return null;

  const overall = computeStreamingQuality(rowToAggregate(res.overall));
  const byRelease = (res.by_release ?? []).map((r) => computeStreamingQuality(rowToAggregate(r)));

  // Release regression: compare the two releases with the most sessions.
  let releaseRegression: QualityRegression | null = null;
  const ranked = [...byRelease].filter((r) => r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  if (ranked.length >= 2) releaseRegression = computeQualityRegression(ranked[1], ranked[0]); // baseline = 2nd, current = top

  // Incidents: absolute spikes on the overall + each release vs the overall as baseline.
  const incidents: QualityIncident[] = [
    ...detectQualityIncidents(null, overall),
    ...byRelease.flatMap((rel) => detectQualityIncidents(overall, rel, rel.scope)),
  ];
  const advice = computeQualityAdvice(overall, releaseRegression);

  return { window, overall, byRelease, startFunnel: res.pev2_start_funnel ?? null, releaseRegression, incidents, advice };
}

export interface StreamingQualityStore { result: StreamingQualityResult; }
export async function getStreamingQualityStores(window: SqWindow = '24h', environment: string | null = null): Promise<StreamingQualityResult[]> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_stores', { p_window: window, p_environment: environment, p_limit: 200 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; stores?: SqeRow[] };
  if (!res.ok) return [];
  return (res.stores ?? []).map((r) => computeStreamingQuality(rowToAggregate(r)));
}

export interface StreamingQualityErrors {
  byCode: Record<string, number>; byBrowser: Record<string, number>; byRelease: Record<string, number>; total: number;
}
export async function getStreamingQualityErrors(window: SqWindow = '24h', environment: string | null = null): Promise<StreamingQualityErrors | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_errors', { p_window: window, p_environment: environment, p_limit: 200 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; by_code?: Record<string, number>; by_browser?: Record<string, number>; by_release?: Record<string, number>; total?: number };
  if (!res.ok) return null;
  return { byCode: res.by_code ?? {}, byBrowser: res.by_browser ?? {}, byRelease: res.by_release ?? {}, total: res.total ?? 0 };
}
