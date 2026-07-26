import { describe, it, expect } from 'vitest';
import type { TrackRow } from '@/types/db';
import {
  parseRuntimeMode,
  parseCandidateItems,
  runtimeScore,
  composeRuntimeQueue,
  staticRuntimeQueue,
  computeShadowComparison,
  DEFAULT_MAX_AI_TRACKS,
  type RuntimeCandidateItem,
} from './aiRuntimeResolver';

function track(id: string, audio: string | null = `https://cdn/${id}.mp3`): TrackRow {
  return {
    id, title: `T-${id}`, artist: null, genre: null, mood: null,
    audio_url: audio as string, cover_url: null, duration: 180, created_at: '2026-01-01T00:00:00Z',
  };
}
function cand(
  track_id: string, fit_score: number, guardrail_penalty = 0, fit_status = 'active',
): RuntimeCandidateItem {
  return { track_id, fit_score, fit_status, guardrail_penalty };
}

// =============================================================================
// A. Feature-flag / mode parsing (fail-closed OFF)
// =============================================================================
describe('parseRuntimeMode — fail-closed', () => {
  it('null / non-object → OFF', () => {
    expect(parseRuntimeMode(null).mode).toBe('off');
    expect(parseRuntimeMode(undefined).mode).toBe('off');
    expect(parseRuntimeMode('nope').mode).toBe('off');
    expect(parseRuntimeMode(42).mode).toBe('off');
  });
  it('unknown / live mode → OFF (no live in this phase)', () => {
    expect(parseRuntimeMode({ mode: 'live', enabled: true, approved: true }).mode).toBe('off');
    expect(parseRuntimeMode({ mode: 'garbage' }).mode).toBe('off');
  });
  it('preview / shadow pass through', () => {
    expect(parseRuntimeMode({ mode: 'preview' }).mode).toBe('preview');
    expect(parseRuntimeMode({ mode: 'shadow' }).mode).toBe('shadow');
  });
  it('coerces numeric params and clamps max >= 1', () => {
    const info = parseRuntimeMode({ mode: 'preview', max_ai_tracks: '30', minimum_fit_score: '55' });
    expect(info.maxAiTracks).toBe(30);
    expect(info.minimumFitScore).toBe(55);
    expect(parseRuntimeMode({ mode: 'preview', max_ai_tracks: 0 }).maxAiTracks).toBe(1);
    expect(parseRuntimeMode({ mode: 'preview' }).maxAiTracks).toBe(DEFAULT_MAX_AI_TRACKS);
  });
  it('enabled/approved booleans strict', () => {
    const i = parseRuntimeMode({ mode: 'preview', enabled: true, approved: true, store_id: 's1' });
    expect(i.enabled).toBe(true);
    expect(i.approved).toBe(true);
    expect(i.storeId).toBe('s1');
    expect(parseRuntimeMode({ mode: 'preview', enabled: 'true' }).enabled).toBe(false);
  });
});

// =============================================================================
// B. Candidate parsing
// =============================================================================
describe('parseCandidateItems', () => {
  it('accepts bare array and {queue:[]} envelope', () => {
    expect(parseCandidateItems([cand('a', 90)])).toHaveLength(1);
    expect(parseCandidateItems({ queue: [cand('a', 90), cand('b', 80)] })).toHaveLength(2);
  });
  it('drops items without a track_id and coerces numbers', () => {
    const items = parseCandidateItems([
      { track_id: 'a', fit_score: '75', guardrail_penalty: '5', fit_status: 'active' },
      { fit_score: 10 },
      { track_id: '' },
      null,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ track_id: 'a', fit_score: 75, guardrail_penalty: 5 });
  });
  it('malformed → empty array', () => {
    expect(parseCandidateItems(null)).toEqual([]);
    expect(parseCandidateItems('x')).toEqual([]);
  });
});

describe('runtimeScore', () => {
  it('= fit_score − penalty', () => {
    expect(runtimeScore({ fit_score: 90, guardrail_penalty: 0 })).toBe(90);
    expect(runtimeScore({ fit_score: 90, guardrail_penalty: 25 })).toBe(65);
  });
});

// =============================================================================
// C. composeRuntimeQueue — candidate selection rules (§6)
// =============================================================================
describe('composeRuntimeQueue', () => {
  const statics = [track('a'), track('b'), track('c'), track('d')];

  it('happy path: AI order, source ai_preview, no seed shuffle', () => {
    const r = composeRuntimeQueue(statics, [cand('c', 95), cand('a', 80), cand('b', 70)]);
    expect(r.source).toBe('ai_preview');
    expect(r.seedShuffle).toBe(false);
    expect(r.fallbackUsed).toBe(false);
    expect(r.tracks.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('deterministic: preserves candidate order exactly (no randomness)', () => {
    const order = [cand('d', 60), cand('a', 60), cand('c', 60), cand('b', 60)];
    const r1 = composeRuntimeQueue(statics, order);
    const r2 = composeRuntimeQueue(statics, order);
    expect(r1.tracks.map((t) => t.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(r2.tracks.map((t) => t.id)).toEqual(r1.tracks.map((t) => t.id));
  });

  it('excluded (blocked) candidate removed', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 90), cand('b', 80, 0, 'excluded'), cand('c', 70)]);
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('candidate not present in static playlist removed (no phantom track)', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 90), cand('ZZZ', 99), cand('b', 70)]);
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('static track without audio_url is never inserted', () => {
    const withBad = [track('a'), track('b', null), track('c', '')];
    const r = composeRuntimeQueue(withBad, [cand('a', 90), cand('b', 85), cand('c', 80)]);
    expect(r.tracks.map((t) => t.id)).toEqual(['a']);
  });

  it('duplicate candidate track_id deduped', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 90), cand('a', 88), cand('b', 70)]);
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('minimum fit applied against runtime score (fit − penalty)', () => {
    const r = composeRuntimeQueue(
      statics,
      [cand('a', 90, 0), cand('b', 80, 30), cand('c', 60, 0)], // scores 90, 50, 60
      { minimumFitScore: 60 },
    );
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'c']); // b (50) dropped
  });

  it('max track count respected', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 90), cand('b', 80), cand('c', 70), cand('d', 60)], {
      maxAiTracks: 2,
    });
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('empty static → static_fallback', () => {
    const r = composeRuntimeQueue([], [cand('a', 90)]);
    expect(r.source).toBe('static_fallback');
    expect(r.fallbackUsed).toBe(true);
    expect(r.fallbackReason).toBe('empty_static');
    expect(r.seedShuffle).toBe(true);
  });

  it('empty candidates → static_fallback (static preserved, seed shuffle on)', () => {
    const r = composeRuntimeQueue(statics, []);
    expect(r.source).toBe('static_fallback');
    expect(r.fallbackReason).toBe('empty_candidates');
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.seedShuffle).toBe(true);
  });

  it('all candidates filtered out → static_fallback insufficient', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 10, 0, 'excluded'), cand('ZZ', 99)]);
    expect(r.source).toBe('static_fallback');
    expect(r.fallbackReason).toBe('insufficient_candidates');
    expect(r.tracks).toHaveLength(4);
  });

  it('summary counts are accurate', () => {
    const r = composeRuntimeQueue(statics, [cand('a', 90), cand('b', 80)]);
    expect(r.summary).toEqual({ staticCount: 4, candidateCount: 2, usedCount: 2, droppedCount: 2 });
  });
});

// =============================================================================
// D. staticRuntimeQueue (OFF / SHADOW applied path)
// =============================================================================
describe('staticRuntimeQueue', () => {
  it('passes tracks through unchanged, seed shuffle on, source static', () => {
    const s = [track('a'), track('b')];
    const r = staticRuntimeQueue(s);
    expect(r.source).toBe('static');
    expect(r.seedShuffle).toBe(true);
    expect(r.fallbackUsed).toBe(false);
    expect(r.tracks).toBe(s);
  });
  it('null-safe', () => {
    expect(staticRuntimeQueue(undefined as unknown as TrackRow[]).tracks).toEqual([]);
  });
});

// =============================================================================
// E. Shadow comparison telemetry
// =============================================================================
describe('computeShadowComparison', () => {
  const statics = [track('a'), track('b'), track('c')];

  it('detects reordering vs static', () => {
    const cmp = computeShadowComparison(statics, [cand('c', 95), cand('a', 80), cand('b', 70)]);
    expect(cmp.staticCount).toBe(3);
    expect(cmp.candidateCount).toBe(3);
    expect(cmp.topTrackDiffers).toBe(true); // static top 'a' vs AI top 'c'
    expect(cmp.orderDiffCount).toBeGreaterThan(0);
    expect(cmp.blockedCount).toBe(0);
  });

  it('counts penalized candidates and blocked drop', () => {
    const cmp = computeShadowComparison(statics, [cand('a', 90, 20), cand('b', 80, 0, 'excluded')]);
    expect(cmp.penalizedCount).toBe(1);
    expect(cmp.blockedCount).toBeGreaterThanOrEqual(1); // b excluded → fewer AI tracks
  });

  it('identical order → topTrackDiffers false, zero order diff', () => {
    const cmp = computeShadowComparison(statics, [cand('a', 90), cand('b', 80), cand('c', 70)]);
    expect(cmp.topTrackDiffers).toBe(false);
    expect(cmp.orderDiffCount).toBe(0);
  });
});
