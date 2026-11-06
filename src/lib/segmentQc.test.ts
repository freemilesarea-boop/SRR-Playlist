import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { formatClock, segmentSignals, type SegmentQcRow } from './segmentQc';

const row = (features: Record<string, number>, airs: number[] = [0.0001, 0.003, 0.0002]): SegmentQcRow => ({
  track_id: 't',
  status: 'ok',
  features,
  windows: airs.map((a, i) => ({ at: 10 + i * 60, air_ratio: a, hf_ratio: 0.01 })),
});

describe('segmentSignals', () => {
  it('고역 과다 — 가장 고역이 많은 구간을 들을 지점으로', () => {
    const s = segmentSignals(row({ mean_air_ratio: 0.002, late_minus_early_air_ratio: 0 }));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ level: 'high', label: '고역 과다', listenAt: 70 });
    expect(s[0].detail).toContain('1:10 부근');
  });

  it('고역 많음 + 후반 고역 증가', () => {
    const s = segmentSignals(row({ mean_air_ratio: 0.0009, late_minus_early_air_ratio: 0.0008 }));
    expect(s.map((x) => x.label)).toEqual(['고역 많음', '후반 고역 증가']);
  });

  it('정상·오류·없음은 표시하지 않는다', () => {
    expect(segmentSignals(row({ mean_air_ratio: 0.0001, late_minus_early_air_ratio: 0 }))).toEqual([]);
    expect(segmentSignals({ track_id: 't', status: 'error', features: null, windows: null })).toEqual([]);
    expect(segmentSignals(undefined)).toEqual([]);
  });

  it('formatClock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(125.4)).toBe('2:05');
  });
});
