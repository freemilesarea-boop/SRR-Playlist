// Phase AI-PLAYLIST-2 — Playlist Experiment 순수 로직 단위 테스트.
// 실제 KPI 비교 · Sample 부족→비교불가 · Evidence 없는 Winner 금지 · 양쪽 0 지표 제외 · NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  compareKpis, decideWinner, buildWinnerEvidence, alignRows, aggregateExperimentLearning,
  MIN_SAMPLE, WINNER_LABEL, STATUS_LABEL, METRIC_WINNER_LABEL,
  type CompareKpi, type ExperimentLike,
} from './playlistExperiment';

function kpi(over: Partial<CompareKpi> = {}): CompareKpi {
  return {
    playlistId: 'a', title: 'A', events: 100, skips: 2, skip_rate: 2, completion_rate: 70,
    avg_listen_seconds: 100, likes: 0, replays: 0, unique_tracks: 60, ...over,
  };
}

describe('compareKpis — 지표별 방향/승자', () => {
  it('완주율(higher)·Skip율(lower) 방향 반영', () => {
    const a = kpi({ completion_rate: 75, skip_rate: 1 });
    const b = kpi({ playlistId: 'b', completion_rate: 60, skip_rate: 5 });
    const m = compareKpis(a, b);
    expect(m.find((x) => x.key === 'completion_rate')!.winner).toBe('a');
    expect(m.find((x) => x.key === 'skip_rate')!.winner).toBe('a'); // 낮을수록 승
  });
  it('양쪽 0 이벤트성 지표(likes/replays) → na(데이터 없음)', () => {
    const m = compareKpis(kpi({ likes: 0, replays: 0 }), kpi({ playlistId: 'b', likes: 0, replays: 0 }));
    expect(m.find((x) => x.key === 'likes')!.winner).toBe('na');
    expect(m.find((x) => x.key === 'replays')!.winner).toBe('na');
  });
  it('null 완주율 한쪽 → 반대쪽 승, NaN 없음', () => {
    const m = compareKpis(kpi({ completion_rate: null }), kpi({ playlistId: 'b', completion_rate: 70 }));
    const c = m.find((x) => x.key === 'completion_rate')!;
    expect(c.winner).toBe('b');
    expect(Number.isFinite(c.diff ?? 0)).toBe(true);
  });
  it('동일값 → tie', () => {
    const m = compareKpis(kpi({ completion_rate: 70 }), kpi({ playlistId: 'b', completion_rate: 70 }));
    expect(m.find((x) => x.key === 'completion_rate')!.winner).toBe('tie');
  });
});

describe('decideWinner — Sample/승자', () => {
  const a = kpi({ completion_rate: 80, skip_rate: 1, avg_listen_seconds: 120, unique_tracks: 70 });
  const b = kpi({ playlistId: 'b', completion_rate: 60, skip_rate: 5, avg_listen_seconds: 90, unique_tracks: 40 });
  it('Sample 부족 → insufficient(비교 불가)', () => {
    const r = decideWinner(compareKpis(a, b), 10, 100);
    expect(r.winner).toBe('insufficient');
    expect(r.sampleOk).toBe(false);
    expect(r.reason).toContain('Sample 부족');
  });
  it('충분 + A 우세 → a', () => {
    const r = decideWinner(compareKpis(a, b), 100, 100);
    expect(r.winner).toBe('a');
    expect(r.aWins).toBeGreaterThan(r.bWins);
  });
  it('비교 지표 차이 없음 → tie', () => {
    const same = kpi({ completion_rate: 70, skip_rate: 2, avg_listen_seconds: 100, unique_tracks: 60 });
    const r = decideWinner(compareKpis(same, { ...same, playlistId: 'b' }), 100, 100);
    expect(r.winner).toBe('tie');
  });
});

describe('buildWinnerEvidence — 근거 공개', () => {
  it('결정 지표만 Evidence 로', () => {
    const a = kpi({ completion_rate: 80, skip_rate: 1 });
    const b = kpi({ playlistId: 'b', completion_rate: 60, skip_rate: 5 });
    const ev = buildWinnerEvidence(compareKpis(a, b));
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.winner === 'a' || e.winner === 'b')).toBe(true);
    expect(ev[0]).toHaveProperty('aValue');
    expect(ev[0]).toHaveProperty('bValue');
  });
});

describe('alignRows', () => {
  it('id 로 A/B 매핑, 없으면 null', () => {
    const rows = [kpi({ playlistId: 'x' }), kpi({ playlistId: 'y' })];
    const { a, b } = alignRows(rows, 'y', 'x');
    expect(a?.playlistId).toBe('y');
    expect(b?.playlistId).toBe('x');
    expect(alignRows([], 'a', 'b')).toEqual({ a: null, b: null });
  });
});

describe('aggregateExperimentLearning', () => {
  const exps: ExperimentLike[] = [
    { winner: 'a', playlistATitle: 'P1', playlistBTitle: 'P2', status: 'completed' },
    { winner: 'a', playlistATitle: 'P1', playlistBTitle: 'P3', status: 'completed' },
    { winner: 'b', playlistATitle: 'P4', playlistBTitle: 'P1', status: 'completed' },
    { winner: 'a', playlistATitle: 'P1', playlistBTitle: 'P2', status: 'running' }, // 미완료 제외
  ];
  it('완료 실험만, 승리/등장 집계', () => {
    const agg = aggregateExperimentLearning(exps);
    const p1 = agg.find((x) => x.playlistTitle === 'P1')!;
    expect(p1.wins).toBe(3);       // a,a,b(P1 as B) → 3승
    expect(p1.appearances).toBe(3);
  });
  it('빈 입력 → 빈 배열', () => { expect(aggregateExperimentLearning([])).toEqual([]); });
});

describe('상수/라벨', () => {
  it('MIN_SAMPLE=30, 라벨', () => {
    expect(MIN_SAMPLE).toBe(30);
    expect(WINNER_LABEL.insufficient).toBe('비교 불가');
    expect(STATUS_LABEL.running).toBe('진행중');
    expect(METRIC_WINNER_LABEL.na).toBe('데이터 없음');
  });
});
