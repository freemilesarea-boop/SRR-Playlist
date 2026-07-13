// Phase AI-RECOMMENDATION-3 — Decision Intelligence 순수 로직 단위 테스트.
// 실제 Outcome 기반 · History 없으면 자동 상승 금지 · 샘플 부족 신뢰도 낮음 · 점수 clamp.
import { describe, it, expect } from 'vitest';
import {
  successRate, rankingScore, rankRecommendations, recommendationConfidence, qualityScore,
  freshnessScore, findSimilarCases, buildTimeline, buildBoard, summarizeHistory, confidenceLabel,
  RANK_WEIGHTS, MIN_SAMPLES,
  type DecisionStat, type LiveRec, type CaseRecord, type TimelineEvent,
} from './decisionIntel';

const NOW = 1_700_000_000_000;

function stat(over: Partial<DecisionStat> = {}): DecisionStat {
  return {
    recommendationKey: 'revenue_drop', considered: 5, dismissed: 1, resolved: 2,
    executed: 6, improved: 4, unchanged: 1, worsened: 1, insufficient: 0, pending: 2,
    avgDelta: -3.2, successRate: 66.7, lastAt: new Date(NOW - 86400e3).toISOString(), ...over,
  };
}
function live(over: Partial<LiveRec> = {}): LiveRec {
  return {
    ruleKey: 'revenue_drop', category: 'revenue', title: '매출 감소',
    evidenceCount: 3, evidenceSatisfied: 3, baseConfidence: 90, baseScore: 80,
    rootCauseSupported: 3, rootCauseTotal: 6, ...over,
  };
}

describe('successRate — improved/decided, pending 제외', () => {
  it('4 improved / (4+1+1) = 66.7', () => {
    expect(successRate({ improved: 4, unchanged: 1, worsened: 1 })).toBeCloseTo(66.7, 1);
  });
  it('decided 0 → null', () => {
    expect(successRate({ improved: 0, unchanged: 0, worsened: 0 })).toBeNull();
  });
});

describe('freshnessScore', () => {
  it('오늘 → 1, 30일+ → 0', () => {
    expect(freshnessScore(NOW, NOW)).toBe(1);
    expect(freshnessScore(NOW - 31 * 86400e3, NOW)).toBe(0);
    expect(freshnessScore(null, NOW)).toBe(0);
  });
});

describe('rankingScore — Explainable breakdown, 0~100', () => {
  it('성분 합 = total, 가중치 상한 준수', () => {
    const r = rankingScore(live(), stat(), NOW);
    const b = r.breakdown;
    expect(b.evidence).toBeLessThanOrEqual(RANK_WEIGHTS.evidence);
    expect(b.history).toBeLessThanOrEqual(RANK_WEIGHTS.history);
    expect(b.outcome).toBeLessThanOrEqual(RANK_WEIGHTS.outcome);
    expect(b.coverage).toBeLessThanOrEqual(RANK_WEIGHTS.coverage);
    expect(b.freshness).toBeLessThanOrEqual(RANK_WEIGHTS.freshness);
    expect(b.total).toBe(Math.min(100, b.evidence + b.history + b.outcome + b.coverage + b.freshness));
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it('History/Outcome 없으면 해당 성분 0 (자동 상승 금지)', () => {
    const r = rankingScore(live(), undefined, NOW);
    expect(r.breakdown.history).toBe(0);
    expect(r.breakdown.outcome).toBe(0);
    expect(r.breakdown.freshness).toBe(0);
    expect(r.lowConfidence).toBe(true); // 샘플 없음
    // Evidence 만점이라도 History 있는 추천보다 낮게 나온다
    const withHistory = rankingScore(live(), stat(), NOW);
    expect(withHistory.score).toBeGreaterThan(r.score);
  });
  it('Evidence 만점 + full coverage 반영', () => {
    const r = rankingScore(live({ rootCauseSupported: 6, rootCauseTotal: 6 }), stat(), NOW);
    expect(r.breakdown.coverage).toBe(RANK_WEIGHTS.coverage);
    expect(r.breakdown.evidence).toBe(RANK_WEIGHTS.evidence);
  });
});

describe('rankRecommendations — 내림차순', () => {
  it('score 내림차순 정렬', () => {
    const recs = [live({ ruleKey: 'a', evidenceSatisfied: 1, rootCauseTotal: 0 }), live({ ruleKey: 'b' })];
    const stats = [stat({ recommendationKey: 'b' })];
    const ranked = rankRecommendations(recs, stats, NOW);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    expect(ranked[0].ruleKey).toBe('b'); // history+outcome 보유가 상위
  });
});

describe('Confidence / Quality', () => {
  it('Outcome 없으면 confidence 낮음', () => {
    const withO = recommendationConfidence(live(), stat(), NOW);
    const noO = recommendationConfidence(live(), undefined, NOW);
    expect(withO).toBeGreaterThan(noO);
    expect(noO).toBeGreaterThanOrEqual(0);
    expect(withO).toBeLessThanOrEqual(100);
  });
  it('quality 0~100', () => {
    const q = qualityScore(live(), stat(), NOW);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(100);
  });
  it('confidenceLabel 샘플 부족', () => {
    expect(confidenceLabel(90, true)).toContain('샘플 부족');
    expect(confidenceLabel(80, false)).toBe('신뢰도 높음');
  });
});

describe('findSimilarCases', () => {
  const recs: CaseRecord[] = [
    { ruleKey: 'revenue_drop', category: 'revenue', metricKey: 'm', outcomeStatus: 'improved', delta: -2, at: null },
    { ruleKey: 'revenue_drop', category: 'revenue', metricKey: 'm', outcomeStatus: 'improved', delta: -4, at: null },
    { ruleKey: 'revenue_drop', category: 'revenue', metricKey: 'm', outcomeStatus: 'worsened', delta: 1, at: null },
    { ruleKey: 'qc_backlog', category: 'artist', metricKey: 'q', outcomeStatus: 'unchanged', delta: 0, at: null },
  ];
  it('정확 일치(ruleKey) 우선', () => {
    const r = findSimilarCases({ ruleKey: 'revenue_drop', category: 'revenue', metricKeys: ['m'] }, recs);
    expect(r.matchCount).toBe(3);
    expect(r.topOutcome).toBe('improved');
    expect(r.improvedRate).toBeCloseTo(66.7, 1);
  });
  it('일치 없음 → category/metric fallback', () => {
    const r = findSimilarCases({ ruleKey: 'unknown', category: 'artist', metricKeys: [] }, recs);
    expect(r.matchCount).toBe(1);
  });
  it('사례 없음 → matchCount 0', () => {
    expect(findSimilarCases({ ruleKey: 'x', category: 'y', metricKeys: [] }, []).matchCount).toBe(0);
  });
});

describe('buildTimeline / buildBoard', () => {
  it('타임라인 시간 오름차순', () => {
    const ev: TimelineEvent[] = [
      { kind: 'outcome', label: 'o', at: new Date(NOW).toISOString() },
      { kind: 'recommendation', label: 'r', at: new Date(NOW - 1000).toISOString() },
    ];
    const t = buildTimeline(ev);
    expect(t[0].kind).toBe('recommendation');
  });
  it('board — mostExecuted / highestSuccess / mostIgnored', () => {
    const stats = [
      stat({ recommendationKey: 'a', executed: 10, improved: 9, unchanged: 1, worsened: 0, dismissed: 0 }),
      stat({ recommendationKey: 'b', executed: 4, improved: 1, unchanged: 1, worsened: 2, dismissed: 5 }),
    ];
    const board = buildBoard(stats);
    expect(board.mostExecuted[0].recommendationKey).toBe('a');
    expect(board.highestSuccess[0].recommendationKey).toBe('a');
    expect(board.mostIgnored[0].recommendationKey).toBe('b');
  });
  it('샘플 부족은 highestSuccess 제외', () => {
    const stats = [stat({ recommendationKey: 'c', executed: 1, improved: 1, unchanged: 0, worsened: 0 })];
    expect(buildBoard(stats).highestSuccess.length).toBe(0); // executed < MIN_SAMPLES
  });
});

describe('summarizeHistory / 상수', () => {
  it('요약 필드', () => {
    const h = summarizeHistory(stat());
    expect(h.considered).toBe(5);
    expect(h.successRate).toBeCloseTo(66.7, 1);
  });
  it('MIN_SAMPLES = 3, 가중치 합 100', () => {
    expect(MIN_SAMPLES).toBe(3);
    const sum = RANK_WEIGHTS.evidence + RANK_WEIGHTS.history + RANK_WEIGHTS.outcome + RANK_WEIGHTS.coverage + RANK_WEIGHTS.freshness;
    expect(sum).toBe(100);
  });
});
