import { describe, it, expect } from 'vitest';
import {
  COMPLETE_THRESHOLD,
  NEXT_THRESHOLD,
  progressRatio,
  classifyDeparture,
  deriveFeedback,
  type PlaybackSnapshot,
} from './playbackFeedbackCollector';

function snap(over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    trackId: 't1',
    queueGeneration: 1,
    index: 0,
    playing: true,
    currentTime: 0,
    duration: 200,
    ...over,
  };
}

describe('progressRatio', () => {
  it('computes clamped ratio; null when duration unknown', () => {
    expect(progressRatio(100, 200)).toBe(0.5);
    expect(progressRatio(300, 200)).toBe(1); // clamp
    expect(progressRatio(-5, 200)).toBe(0);
    expect(progressRatio(50, 0)).toBeNull();
    expect(progressRatio(50, NaN)).toBeNull();
  });
});

describe('classifyDeparture — graded signal', () => {
  it('maps ratio to complete/next/skip', () => {
    expect(classifyDeparture(0.95)).toBe('complete');
    expect(classifyDeparture(COMPLETE_THRESHOLD)).toBe('complete');
    expect(classifyDeparture(0.7)).toBe('next');
    expect(classifyDeparture(NEXT_THRESHOLD)).toBe('next');
    expect(classifyDeparture(0.1)).toBe('skip');
    expect(classifyDeparture(null)).toBe('skip'); // unknown ratio → treated as early skip
  });
});

describe('deriveFeedback — first observation', () => {
  it('emits play for a playing track', () => {
    const out = deriveFeedback(null, snap({ trackId: 't1', playing: true, currentTime: 0 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event: 'play', trackId: 't1' });
  });
  it('emits nothing if not playing or no track', () => {
    expect(deriveFeedback(null, snap({ playing: false }))).toEqual([]);
    expect(deriveFeedback(null, snap({ trackId: null }))).toEqual([]);
  });
});

describe('deriveFeedback — same track pause/resume', () => {
  it('true→false → pause', () => {
    const prev = snap({ playing: true, currentTime: 30 });
    const curr = snap({ playing: false, currentTime: 30 });
    const out = deriveFeedback(prev, curr);
    expect(out).toEqual([
      expect.objectContaining({ event: 'pause', trackId: 't1' }),
    ]);
  });
  it('false→true → resume', () => {
    const prev = snap({ playing: false, currentTime: 30 });
    const curr = snap({ playing: true, currentTime: 30 });
    const out = deriveFeedback(prev, curr);
    expect(out).toEqual([
      expect.objectContaining({ event: 'resume', trackId: 't1' }),
    ]);
  });
  it('no playing change → nothing', () => {
    const prev = snap({ playing: true, currentTime: 10 });
    const curr = snap({ playing: true, currentTime: 40 });
    expect(deriveFeedback(prev, curr)).toEqual([]);
  });
});

describe('deriveFeedback — track change (same generation)', () => {
  it('finished track → complete + play for next', () => {
    const prev = snap({ trackId: 't1', index: 0, currentTime: 195, duration: 200 });
    const curr = snap({ trackId: 't2', index: 1, currentTime: 0, duration: 180 });
    const out = deriveFeedback(prev, curr);
    expect(out).toEqual([
      expect.objectContaining({ event: 'complete', trackId: 't1', completionRatio: 0.975 }),
      expect.objectContaining({ event: 'play', trackId: 't2' }),
    ]);
  });

  it('early skip → skip + play', () => {
    const prev = snap({ trackId: 't1', index: 0, currentTime: 10, duration: 200 });
    const curr = snap({ trackId: 't2', index: 1, currentTime: 0, duration: 180 });
    const out = deriveFeedback(prev, curr);
    expect(out[0]).toMatchObject({ event: 'skip', trackId: 't1' });
    expect(out[1]).toMatchObject({ event: 'play', trackId: 't2' });
  });

  it('mid skip past halfway → next + play', () => {
    const prev = snap({ trackId: 't1', index: 0, currentTime: 140, duration: 200 }); // 0.7
    const curr = snap({ trackId: 't2', index: 1, currentTime: 0, duration: 180 });
    const out = deriveFeedback(prev, curr);
    expect(out[0]).toMatchObject({ event: 'next', trackId: 't1' });
  });

  it('going backward (index decreases) → previous for new track', () => {
    const prev = snap({ trackId: 't2', index: 1, currentTime: 20, duration: 200 });
    const curr = snap({ trackId: 't1', index: 0, currentTime: 0, duration: 200 });
    const out = deriveFeedback(prev, curr);
    expect(out[0]).toMatchObject({ event: 'skip', trackId: 't2' }); // departing t2 was early
    expect(out[1]).toMatchObject({ event: 'previous', trackId: 't1' });
  });

  it('carries played/duration seconds for the departing track', () => {
    const prev = snap({ trackId: 't1', index: 0, currentTime: 140, duration: 200 });
    const curr = snap({ trackId: 't2', index: 1 });
    const out = deriveFeedback(prev, curr);
    expect(out[0]).toMatchObject({ playedSeconds: 140, durationSeconds: 200 });
  });
});

describe('deriveFeedback — queue generation change', () => {
  it('new playlist load → only play for new track, no skip on departing', () => {
    const prev = snap({ trackId: 't1', queueGeneration: 1, index: 5, currentTime: 5, duration: 200 });
    const curr = snap({ trackId: 't9', queueGeneration: 2, index: 0, currentTime: 0, duration: 200 });
    const out = deriveFeedback(prev, curr);
    expect(out).toEqual([
      expect.objectContaining({ event: 'play', trackId: 't9' }),
    ]);
  });

  it('new generation but paused → nothing', () => {
    const prev = snap({ trackId: 't1', queueGeneration: 1 });
    const curr = snap({ trackId: 't9', queueGeneration: 2, playing: false });
    expect(deriveFeedback(prev, curr)).toEqual([]);
  });
});
