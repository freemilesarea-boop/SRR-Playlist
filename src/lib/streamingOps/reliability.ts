// WEB-OBS-8 — Streaming Reliability Index (0..100) + sub-components. Rule-based reframing of the
// WEB-OBS-7 quality signals into an operator-facing reliability score. A sub-component with NO signal
// (NOT_AVAILABLE / NO_DATA — e.g. crossfade & continuity in business/store mode) is DROPPED and the
// weights renormalize — a missing signal is never scored as 0. Nothing here is fabricated.

import { clamp, round } from '../observability/math';
import type { StreamingQualityResult } from '../streamingQuality/types';
import { RELIABILITY_WEIGHTS, RELIABILITY_BAND_EXCELLENT, RELIABILITY_BAND_HEALTHY, RELIABILITY_BAND_WATCH, RELIABILITY_BAND_DEGRADED } from './thresholds';
import type { ReliabilityIndex, ReliabilityBand, ReliabilitySub } from './types';

function pct(rate: number | null): number | null { return rate == null ? null : clamp(rate * 100, 0, 100); }
/** Lower-is-better rate → reliability sub-score (0 rate = 100). */
function inv(rate: number | null): number | null { return rate == null ? null : clamp((1 - rate) * 100, 0, 100); }

function bandFor(index: number): ReliabilityBand {
  if (index >= RELIABILITY_BAND_EXCELLENT) return 'EXCELLENT';
  if (index >= RELIABILITY_BAND_HEALTHY) return 'HEALTHY';
  if (index >= RELIABILITY_BAND_WATCH) return 'WATCH';
  if (index >= RELIABILITY_BAND_DEGRADED) return 'DEGRADED';
  return 'CRITICAL';
}

/**
 * Compute the Streaming Reliability Index from a WEB-OBS-7 quality result. INSUFFICIENT_DATA when the
 * underlying result already lacks confidence — we never invent a reliability number from thin data.
 */
export function computeReliabilityIndex(r: StreamingQualityResult): ReliabilityIndex {
  const W = RELIABILITY_WEIGHTS;
  // availability: sessions that actually reached audio (start success), penalized by media failure.
  const availability = r.start.successRate == null ? null
    : clamp((r.start.successRate * 100) - ((r.mediaError.sessionRate ?? 0) * 50), 0, 100);

  const defs: Array<{ key: string; label: string; weight: number; score: number | null; detail: string }> = [
    { key: 'availability', label: 'Availability', weight: W.availability, score: availability, detail: r.start.status },
    { key: 'start', label: 'Start', weight: W.start, score: pct(r.start.successRate), detail: `${r.start.requests} requests` },
    { key: 'transition', label: 'Transition', weight: W.transition, score: r.crossfade.status === 'NOT_AVAILABLE' || r.crossfade.status === 'NOT_APPLICABLE' ? null : pct(r.crossfade.completionRate), detail: r.crossfade.status },
    { key: 'recovery', label: 'Recovery', weight: W.recovery, score: r.recovery.status === 'NOT_ATTEMPTED' ? null : pct(r.recovery.successRate), detail: r.recovery.status },
    { key: 'media', label: 'Media', weight: W.media, score: inv(r.mediaError.sessionRate), detail: `${r.mediaError.events} errors` },
    { key: 'continuity', label: 'Continuity', weight: W.continuity, score: r.continuity.status === 'INSUFFICIENT_DATA' ? null : pct(r.continuity.stableRate), detail: r.continuity.status },
    { key: 'buffering', label: 'Buffering', weight: W.buffering, score: inv(r.stall.sessionRate), detail: `${r.stall.stallSessions} stalls` },
  ];

  const present = defs.filter((d) => d.score != null);
  const subs: ReliabilitySub[] = defs.map((d) => ({ key: d.key, label: d.label, score: round(d.score, 1), weight: d.weight, detail: d.detail }));
  const totalWeight = defs.reduce((s, d) => s + d.weight, 0);
  const presentWeight = present.reduce((s, d) => s + d.weight, 0);
  const coverage = totalWeight > 0 ? presentWeight / totalWeight : 0;

  if (r.confidence === 'INSUFFICIENT' || present.length === 0 || presentWeight === 0) {
    return { scope: r.scope, index: null, band: 'INSUFFICIENT_DATA', subs, coverage: round(coverage, 3) ?? 0, confidence: r.confidence };
  }
  const weighted = present.reduce((s, d) => s + (d.score as number) * d.weight, 0);
  const index = clamp(weighted / presentWeight, 0, 100);
  return { scope: r.scope, index: round(index, 1), band: bandFor(index), subs, coverage: round(coverage, 3) ?? 0, confidence: r.confidence };
}
