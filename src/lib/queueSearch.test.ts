import { describe, it, expect } from 'vitest';
import { searchQueue, buildQueueSections } from './queueSearch';
import type { TrackRow } from '@/types/db';

const t = (id: string, title: string, artist: string | null = null, album?: string): TrackRow =>
  ({ id, title, artist, album_name: album ?? null } as unknown as TrackRow);

const queue: TrackRow[] = [
  t('a', 'Sunrise', 'Kim', '아침'),
  t('b', '노을', '이서준'),
  t('c', 'Track 3', 'BTS'),
  t('d', 'sunSET', 'kim'),
];

describe('searchQueue', () => {
  it('empty term returns all with original indexes', () => {
    const r = searchQueue(queue, '');
    expect(r.map((x) => x.originalIndex)).toEqual([0, 1, 2, 3]);
  });
  it('title match, case-insensitive, preserves original index', () => {
    const r = searchQueue(queue, 'sun');
    expect(r.map((x) => x.originalIndex)).toEqual([0, 3]); // Sunrise, sunSET
  });
  it('artist match', () => {
    const r = searchQueue(queue, 'kim');
    expect(r.map((x) => x.originalIndex)).toEqual([0, 3]);
  });
  it('korean match', () => {
    expect(searchQueue(queue, '노을').map((x) => x.originalIndex)).toEqual([1]);
    expect(searchQueue(queue, '이서준').map((x) => x.originalIndex)).toEqual([1]);
  });
  it('number match', () => {
    expect(searchQueue(queue, '3').map((x) => x.originalIndex)).toEqual([2]);
  });
  it('album match', () => {
    expect(searchQueue(queue, '아침').map((x) => x.originalIndex)).toEqual([0]);
  });
  it('trims whitespace', () => {
    expect(searchQueue(queue, '  sun  ').map((x) => x.originalIndex)).toEqual([0, 3]);
  });
  it('no result', () => {
    expect(searchQueue(queue, 'zzzz')).toEqual([]);
  });
});

describe('buildQueueSections', () => {
  it('linear: current + upcoming after index (original indexes)', () => {
    const s = buildQueueSections(queue, 1, false, []);
    expect(s.current?.originalIndex).toBe(1);
    expect(s.upcoming.map((x) => x.originalIndex)).toEqual([2, 3]);
  });
  it('index 0 → upcoming is rest', () => {
    const s = buildQueueSections(queue, 0, false, []);
    expect(s.upcoming.map((x) => x.originalIndex)).toEqual([1, 2, 3]);
  });
  it('last index → no upcoming', () => {
    const s = buildQueueSections(queue, 3, false, []);
    expect(s.current?.originalIndex).toBe(3);
    expect(s.upcoming).toEqual([]);
  });
  it('shuffle: upcoming follows shuffleOrder after current position', () => {
    // shuffleOrder = play order; current index=2 sits at position 0 → next are 0,3,1
    const s = buildQueueSections(queue, 2, true, [2, 0, 3, 1]);
    expect(s.current?.originalIndex).toBe(2);
    expect(s.upcoming.map((x) => x.originalIndex)).toEqual([0, 3, 1]);
  });
  it('shuffle order missing current → linear fallback', () => {
    const s = buildQueueSections(queue, 1, true, [9, 9, 9, 9]); // invalid (length matches but indexOf(1) === -1)
    expect(s.upcoming.map((x) => x.originalIndex)).toEqual([2, 3]);
  });
  it('empty queue', () => {
    expect(buildQueueSections([], 0, false, [])).toEqual({ current: null, upcoming: [] });
  });
});
