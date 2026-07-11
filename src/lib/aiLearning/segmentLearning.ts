// AI-MUSIC-3 — Seasonal / Time / Industry learning. Rule-based per-segment learning summary from provided
// segment aggregates (plays / completion / top genres). Read-only. Segments below the sample floor are
// NO_DATA strength; no aggregates → INSUFFICIENT_DATA (honest — no fabricated seasonal/time verdict).

import { SEGMENT_MIN_PLAYS, SEGMENT_STRONG_PLAYS } from './thresholds';
import type { Season, DayPart, SegmentAggregate, SegmentLearning } from './types';

export const SEASONS: Season[] = ['SPRING', 'SUMMER', 'FALL', 'WINTER'];
export const DAY_PARTS: DayPart[] = ['MORNING', 'LUNCH', 'EVENING', 'LATE_NIGHT'];

/** Calendar month (1-12) → Season (deterministic; caller passes the month). */
export function seasonForMonth(month: number): Season {
  const m = ((Math.floor(month) - 1) % 12 + 12) % 12 + 1;
  if (m >= 3 && m <= 5) return 'SPRING';
  if (m >= 6 && m <= 8) return 'SUMMER';
  if (m >= 9 && m <= 11) return 'FALL';
  return 'WINTER';
}

/** Hour (0-23) → DayPart. */
export function dayPartForHour(hour: number): DayPart {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 6 && h < 11) return 'MORNING';
  if (h >= 11 && h < 15) return 'LUNCH';
  if (h >= 15 && h < 22) return 'EVENING';
  return 'LATE_NIGHT';
}

function strengthOf(plays: number): 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_DATA' {
  if (plays < SEGMENT_MIN_PLAYS) return 'NO_DATA';
  if (plays >= SEGMENT_STRONG_PLAYS) return 'STRONG';
  if (plays >= SEGMENT_STRONG_PLAYS / 2) return 'MODERATE';
  return 'WEAK';
}

/** Generic segment-learning builder over an ordered key list + its aggregates. */
export function buildSegmentLearning<K extends string>(keys: readonly K[], aggregates: Partial<Record<K, SegmentAggregate>>): SegmentLearning<K> {
  const segments = keys.map((key) => {
    const a = aggregates[key];
    return {
      key, plays: a?.plays ?? 0, completionRate: a?.completionRate ?? null,
      topGenres: a?.topGenres ?? [], strength: strengthOf(a?.plays ?? 0),
    };
  });
  const withData = segments.filter((s) => s.strength !== 'NO_DATA');
  if (withData.length === 0) {
    return { status: 'INSUFFICIENT_DATA', segments, bestSegment: null, note: '세그먼트 표본 부족' };
  }
  const best = [...withData].sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))[0];
  return { status: 'READY', segments, bestSegment: best.key, note: `최적 세그먼트: ${best.key}` };
}

export function seasonalLearning(aggregates: Partial<Record<Season, SegmentAggregate>>): SegmentLearning<Season> {
  return buildSegmentLearning(SEASONS, aggregates);
}
export function timeLearning(aggregates: Partial<Record<DayPart, SegmentAggregate>>): SegmentLearning<DayPart> {
  return buildSegmentLearning(DAY_PARTS, aggregates);
}
export function industryLearning<K extends string>(industries: readonly K[], aggregates: Partial<Record<K, SegmentAggregate>>): SegmentLearning<K> {
  return buildSegmentLearning(industries, aggregates);
}
