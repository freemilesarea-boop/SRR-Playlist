// WEB-OBS-8 — Release & Enterprise heatmaps. Release rows compare each release's quality score against
// a baseline (the highest-session release) and count incidents. Enterprise rows roll per-store quality
// up to the franchise/brand (franchise_stores → franchises). If no brand↔store mapping is present the
// enterprise heatmap is honestly NOT_AVAILABLE rather than a fabricated grid.

import { round } from '../observability/math';
import { computeStreamingQuality } from '../streamingQuality/quality';
import { computeQualityRegression, detectQualityIncidents } from '../streamingQuality/analysis';
import { computeReliabilityIndex } from './reliability';
import type { QualityAggregate } from '../streamingQuality/types';
import type { ReleaseHeatmap, ReleaseHeatRow, EnterpriseHeatmap, EnterpriseHeatRow } from './types';

export interface ReleaseAgg { release: string; stores: number; aggregate: QualityAggregate; }

/** Build the release heatmap. Baseline = release with the most sessions; others compared to it. */
export function buildReleaseHeatmap(releases: ReleaseAgg[]): ReleaseHeatmap {
  const results = releases.map((r) => ({ ...r, q: computeStreamingQuality(r.aggregate) }));
  const ranked = [...results].filter((r) => r.q.sessions > 0).sort((a, b) => b.q.sessions - a.q.sessions);
  const base = ranked[0] ?? null;

  const rows: ReleaseHeatRow[] = results
    .sort((a, b) => b.q.sessions - a.q.sessions)
    .map((r) => {
      const isBase = base != null && r.release === base.release;
      const reg = base && !isBase ? computeQualityRegression(base.q, r.q) : null;
      const scoreCmp = reg?.metrics.find((m) => m.key === 'score') ?? null;
      const incidents = detectQualityIncidents(base && !isBase ? base.q : null, r.q, r.release)
        .filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
      return {
        release: r.release,
        sessions: r.q.sessions,
        stores: r.stores,
        score: r.q.score,
        status: r.q.status,
        scoreDelta: isBase ? null : (scoreCmp?.absDelta ?? null),
        regression: isBase ? 'STABLE' : (reg?.overall ?? 'INSUFFICIENT_DATA'),
        incidents,
        confidence: r.q.confidence,
      };
    });
  return { rows, baseline: base?.release ?? null };
}

export interface BrandGroup { brand: string; stores: QualityAggregate[]; }

/** Merge a set of per-store aggregates into one brand-scope aggregate (additive counters; sessions summed). */
function mergeAggregates(scope: string, parts: QualityAggregate[]): QualityAggregate {
  const z: QualityAggregate = {
    scope, sessions: 0, startRequests: 0, startSuccess: 0, startFailed: 0, startAbandoned: 0,
    ttfa: { p50: null, p75: null, p95: null, samples: 0 },
    transitionGap: { p50: null, p75: null, p95: null, samples: 0 },
    crossfadeStarted: 0, crossfadeCompleted: 0, crossfadeFallback: 0, crossfadeAborted: 0, crossfadeApplicable: false,
    stallSessions: 0, mediaErrorSessions: 0, mediaErrorEvents: 0, mediaErrorByCode: {},
    preloadReady: 0, preloadFailed: 0, recoveryAttempted: 0, recoverySucceeded: 0, recoveryFailed: 0,
    stableSessions: 0, continuityInterruptions: 0, continuityTransitions: 0,
  };
  for (const p of parts) {
    z.sessions += p.sessions; z.startRequests += p.startRequests; z.startSuccess += p.startSuccess;
    z.startFailed += p.startFailed; z.startAbandoned += p.startAbandoned;
    z.crossfadeStarted += p.crossfadeStarted; z.crossfadeCompleted += p.crossfadeCompleted;
    z.crossfadeFallback += p.crossfadeFallback; z.crossfadeAborted += p.crossfadeAborted;
    z.crossfadeApplicable = z.crossfadeApplicable || p.crossfadeApplicable;
    z.stallSessions += p.stallSessions; z.mediaErrorSessions += p.mediaErrorSessions; z.mediaErrorEvents += p.mediaErrorEvents;
    for (const [k, v] of Object.entries(p.mediaErrorByCode)) z.mediaErrorByCode[k] = (z.mediaErrorByCode[k] ?? 0) + v;
    z.preloadReady += p.preloadReady; z.preloadFailed += p.preloadFailed;
    z.recoveryAttempted += p.recoveryAttempted; z.recoverySucceeded += p.recoverySucceeded; z.recoveryFailed += p.recoveryFailed;
    z.stableSessions += p.stableSessions; z.continuityInterruptions += p.continuityInterruptions; z.continuityTransitions += p.continuityTransitions;
  }
  // TTFA percentiles cannot be re-derived from per-store percentiles → left null (samples summed).
  z.ttfa.samples = parts.reduce((s, p) => s + p.ttfa.samples, 0);
  return z;
}

/** Build the enterprise (brand→store) heatmap, or NOT_AVAILABLE when there is no mapping. */
export function buildEnterpriseHeatmap(groups: BrandGroup[] | null, reason = '브랜드↔매장 매핑 없음 (franchise_stores 미연결)'): EnterpriseHeatmap {
  if (groups == null) return { available: false, reason };
  const rows: EnterpriseHeatRow[] = groups.map((g) => {
    const merged = mergeAggregates(g.brand, g.stores);
    const q = computeStreamingQuality(merged);
    const rel = computeReliabilityIndex(q);
    const availability = rel.subs.find((s) => s.key === 'availability')?.score ?? null;
    return {
      brand: g.brand,
      stores: g.stores.length,
      sessions: merged.sessions,
      score: q.score,
      status: q.status,
      mediaErrorRate: q.mediaError.sessionRate,
      recoverySuccessRate: q.recovery.successRate,
      availability: round(availability, 1),
    };
  }).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return { available: true, rows };
}
