// WEB-OPS-10 — Platform Score (0..100). Converges availability + streaming + reliability + governance +
// incidents + coverage + confidence into one number. A component with NO signal is dropped and the
// weights renormalize — a missing input is never scored as 0. Below the session floor → INSUFFICIENT_DATA.

import { clamp, round } from '../observability/math';
import {
  PLATFORM_WEIGHTS, PLATFORM_BAND_EXCELLENT, PLATFORM_BAND_HEALTHY, PLATFORM_BAND_WATCH, PLATFORM_BAND_DEGRADED,
  PLATFORM_MIN_SESSIONS, GOVERNANCE_OPEN_TOLERANCE, GOVERNANCE_OPEN_PENALTY, INCIDENT_CRITICAL_PENALTY, INCIDENT_HIGH_PENALTY,
} from './thresholds';
import type { PlatformScore, PlatformBand, PlatformComponent, PlatformScoreInput } from './types';

function band(score: number): PlatformBand {
  if (score >= PLATFORM_BAND_EXCELLENT) return 'EXCELLENT';
  if (score >= PLATFORM_BAND_HEALTHY) return 'HEALTHY';
  if (score >= PLATFORM_BAND_WATCH) return 'WATCH';
  if (score >= PLATFORM_BAND_DEGRADED) return 'DEGRADED';
  return 'CRITICAL';
}

export function computePlatformScore(input: PlatformScoreInput): PlatformScore {
  const W = PLATFORM_WEIGHTS;
  const governanceScore = clamp(100 - Math.max(0, input.governanceOpen - GOVERNANCE_OPEN_TOLERANCE) * GOVERNANCE_OPEN_PENALTY, 0, 100);
  const incidentScore = clamp(100 - input.criticalIncidents * INCIDENT_CRITICAL_PENALTY - input.highIncidents * INCIDENT_HIGH_PENALTY, 0, 100);
  const coverageScore = input.coverage == null ? null : clamp(input.coverage * 100, 0, 100);

  const defs: Array<{ key: string; label: string; weight: number; score: number | null; detail: string }> = [
    { key: 'availability', label: 'Availability', weight: W.availability, score: input.availability, detail: input.availability == null ? 'NO DATA' : `${round(input.availability, 1)}` },
    { key: 'streaming', label: 'Streaming', weight: W.streaming, score: input.streaming, detail: input.streaming == null ? 'NO DATA' : `${round(input.streaming, 1)}` },
    { key: 'reliability', label: 'Reliability', weight: W.reliability, score: input.reliability, detail: input.reliability == null ? 'NO DATA' : `${round(input.reliability, 1)}` },
    { key: 'governance', label: 'Governance', weight: W.governance, score: governanceScore, detail: `${input.governanceOpen} open` },
    { key: 'incidents', label: 'Incidents', weight: W.incidents, score: incidentScore, detail: `${input.criticalIncidents} crit · ${input.highIncidents} high` },
    { key: 'coverage', label: 'Coverage', weight: W.coverage, score: coverageScore, detail: input.coverage == null ? 'NO DATA' : `${Math.round(input.coverage * 100)}%` },
    { key: 'confidence', label: 'Confidence', weight: W.confidence, score: input.confidence, detail: input.confidence == null ? 'NO DATA' : `${round(input.confidence, 1)}` },
  ];
  const components: PlatformComponent[] = defs.map((d) => ({ key: d.key, label: d.label, score: round(d.score, 1), weight: d.weight, detail: d.detail }));
  const present = defs.filter((d) => d.score != null);
  const totalWeight = defs.reduce((s, d) => s + d.weight, 0);
  const presentWeight = present.reduce((s, d) => s + d.weight, 0);
  const coverage = totalWeight > 0 ? presentWeight / totalWeight : 0;

  if (input.sessions < PLATFORM_MIN_SESSIONS || present.length === 0 || presentWeight === 0) {
    return { score: null, band: 'INSUFFICIENT_DATA', components, coverage: round(coverage, 3) ?? 0, sessions: input.sessions };
  }
  const weighted = present.reduce((s, d) => s + (d.score as number) * d.weight, 0) / presentWeight;
  const score = clamp(weighted, 0, 100);
  return { score: round(score, 1), band: band(score), components, coverage: round(coverage, 3) ?? 0, sessions: input.sessions };
}
