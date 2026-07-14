// Phase AI-MUSIC-13 — Fleet Intelligence & Cross-Enterprise Benchmarking 순수 로직 단위 테스트.
// Fleet Health(재정규화/insufficient) · Benchmark(median/quartile/표본1 금지) · 익명 Ranking ·
// Best Practice(3pp+/sample 게이트) · Opportunity(5종/min events) · Growth(0 비교 금지) ·
// Recommendation(review_candidate only) · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  calculateFleetHealth, benchmarkStats, compareToBenchmark, anonymizeRanking,
  discoverBestPractices, detectOpportunities, classifyGrowth, buildFleetRecommendations,
  fleetInputHash, FLEET_SCOPES, FLEET_SUPPORT,
  type StoreKpiRow, type GlobalBaseline,
} from './fleetIntel';

describe('Fleet Health', () => {
  it('전 성분 → healthy · 성분 누락 시 재정규화(null→0 금지)', () => {
    const full = calculateFleetHealth({ playbackHealth: 90, streamingQuality: 95, queueStability: 80, rotationQuality: 85, playlistDiversity: 75, satisfaction: 88, aiTrust: 70, governanceHealth: 90 });
    expect(full.grade).toBe('healthy');
    const partial = calculateFleetHealth({ playbackHealth: 90, satisfaction: 88 });
    expect(partial.score).not.toBeNull(); expect(partial.missing).toContain('queue_stability');
    expect(partial.score!).toBeGreaterThan(80); // 누락 성분이 0 으로 계산되지 않음
  });
  it('전 성분 누락 → insufficient_data', () => {
    expect(calculateFleetHealth({}).grade).toBe('insufficient_data');
    expect(calculateFleetHealth({}).score).toBeNull();
  });
  it('낮은 성분 → at_risk/critical', () => {
    expect(calculateFleetHealth({ playbackHealth: 40, streamingQuality: 50 }).grade).toBe('at_risk');
    expect(calculateFleetHealth({ playbackHealth: 10, streamingQuality: 20 }).grade).toBe('critical');
  });
});

describe('Benchmark 통계', () => {
  it('median/p25/p75 결정적 계산', () => {
    const s = benchmarkStats([10, 20, 30, 40, 50])!;
    expect(s.median).toBe(30); expect(s.p25).toBe(20); expect(s.p75).toBe(40); expect(s.n).toBe(5);
  });
  it('표본 1개 → null(Benchmark 생성 금지) · null 값 제외', () => {
    expect(benchmarkStats([10])).toBeNull();
    expect(benchmarkStats([null, undefined, NaN])).toBeNull();
    expect(benchmarkStats([10, null, 30])!.n).toBe(2);
  });
  it('compareToBenchmark — max/min 방향', () => {
    const s = benchmarkStats([10, 20, 30, 40, 50])!;
    expect(compareToBenchmark(45, s, 'max')).toBe('top_quartile');
    expect(compareToBenchmark(35, s, 'max')).toBe('above_median');
    expect(compareToBenchmark(5, s, 'max')).toBe('bottom_quartile');
    expect(compareToBenchmark(15, s, 'min')).toBe('top_quartile'); // min 방향은 낮을수록 상위
    expect(compareToBenchmark(null, s)).toBe('insufficient_data');
  });
});

describe('익명 Ranking', () => {
  it('원본 key 미노출 + 결정적 순위/코드', () => {
    const r = anonymizeRanking([{ key: 'franchise-b', value: 50 }, { key: 'franchise-a', value: 80 }]);
    expect(r[0]).toEqual({ anonCode: 'ENT-01', rank: 1, value: 80 });
    expect(JSON.stringify(r)).not.toContain('franchise');
  });
  it('동점 시 key 로 결정적 tie break', () => {
    const a = anonymizeRanking([{ key: 'b', value: 50 }, { key: 'a', value: 50 }]);
    const b = anonymizeRanking([{ key: 'a', value: 50 }, { key: 'b', value: 50 }]);
    expect(a).toEqual(b);
  });
});

describe('Best Practice Discovery', () => {
  const rows = [
    { storeType: 'cafe', events: 500, completionRate: 82, skipRate: 5 },
    { storeType: 'hospital', events: 300, completionRate: 70, skipRate: 8 },
    { storeType: 'gym', events: 200, completionRate: 68, skipRate: 9 },
    { storeType: 'hotel', events: 50, completionRate: 90, skipRate: 3 },
  ];
  it('median +3pp 이상만 후보 · sample<100 → insufficient_data', () => {
    const found = discoverBestPractices(rows);
    const cafe = found.find((f) => f.scopeKey === 'cafe')!;
    expect(cafe.status).toBe('candidate'); expect(cafe.deltaPct).toBeGreaterThan(0);
    const hotel = found.find((f) => f.scopeKey === 'hotel')!;
    expect(hotel.status).toBe('insufficient_data'); // 90pp 우위여도 sample 부족
    expect(found.every((f) => f.limitations.some((l) => l.includes('인과 아님')))).toBe(true);
  });
  it('표본 부족(1행) → 후보 없음', () => {
    expect(discoverBestPractices([rows[0]])).toEqual([]);
  });
});

describe('Opportunity Detection', () => {
  const baseline: GlobalBaseline = { skipRate: 8, completionRate: 75, errorRate: 1, replayRate: 2 };
  const store = (over: Partial<StoreKpiRow>): StoreKpiRow => ({ anonCode: 'STORE-001', storeType: 'cafe', events: 200, skipRate: 8, completionRate: 75, errorRate: 0.5, replayRate: 1, trackCount: 40, ...over });
  it('Skip 1.2x 초과 → high_skip · 2x → critical', () => {
    expect(detectOpportunities([store({ skipRate: 10 })], baseline).find((o) => o.type === 'high_skip')).toBeTruthy();
    expect(detectOpportunities([store({ skipRate: 16 })], baseline).find((o) => o.type === 'high_skip')!.severity).toBe('critical');
  });
  it('Completion -10pp → low_completion · Error 급증 → quality_degradation · Track<10 → low_diversity', () => {
    const opps = detectOpportunities([store({ completionRate: 60, errorRate: 5, trackCount: 6 })], baseline);
    expect(opps.map((o) => o.type)).toEqual(expect.arrayContaining(['low_completion', 'quality_degradation', 'low_diversity']));
  });
  it('min events 미만 store 는 판정하지 않음(표본 부족)', () => {
    expect(detectOpportunities([store({ events: 20, skipRate: 30 })], baseline)).toEqual([]);
  });
  it('baseline null 인 KPI 는 비교 생략(null→0 금지)', () => {
    const opps = detectOpportunities([store({ skipRate: 30 })], { skipRate: null, completionRate: null, errorRate: null, replayRate: null });
    expect(opps.filter((o) => o.type === 'high_skip')).toEqual([]);
  });
  it('정상 store → 기회 없음 · 결정적 정렬', () => {
    expect(detectOpportunities([store({})], baseline)).toEqual([]);
    const two = [store({ anonCode: 'STORE-002', skipRate: 12 }), store({ anonCode: 'STORE-001', skipRate: 12 })];
    expect(detectOpportunities(two, baseline).map((o) => o.anonCode)).toEqual(['STORE-001', 'STORE-002']);
  });
});

describe('Growth / Recommendation / Hash', () => {
  it('classifyGrowth — 이전값 없거나 0 → insufficient(0 비교 금지)', () => {
    expect(classifyGrowth(null, 100).result).toBe('insufficient_data');
    expect(classifyGrowth(0, 100).result).toBe('insufficient_data');
    expect(classifyGrowth(100, 120)).toEqual({ result: 'growing', deltaPct: 20 });
    expect(classifyGrowth(100, 85)).toEqual({ result: 'declining', deltaPct: -15 });
    expect(classifyGrowth(100, 103).result).toBe('stable');
  });
  it('Recommendation — candidate practice + high/critical opportunity 만 · review_candidate(실행 아님)', () => {
    const recs = buildFleetRecommendations(
      discoverBestPractices([
        { storeType: 'cafe', events: 500, completionRate: 82, skipRate: 5 },
        { storeType: 'gym', events: 300, completionRate: 68, skipRate: 9 },
        { storeType: 'hotel', events: 50, completionRate: 95, skipRate: 2 },
      ]),
      detectOpportunities(
        [{ anonCode: 'STORE-001', storeType: 'cafe', events: 200, skipRate: 20, completionRate: 75, errorRate: 0.5, replayRate: 1, trackCount: 40 }],
        { skipRate: 8, completionRate: 75, errorRate: 1, replayRate: 2 },
      ),
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.status === 'review_candidate')).toBe(true);
    expect(recs.every((r) => r.limitations.length > 0)).toBe(true);
    expect(recs.some((r) => r.scopeKey === 'hotel')).toBe(false); // insufficient practice 제외
  });
  it('fleetInputHash 결정적', () => {
    expect(fleetInputHash(['a', 1])).toBe(fleetInputHash(['a', 1]));
    expect(fleetInputHash(['a', 1])).not.toBe(fleetInputHash(['a', 2]));
  });
});

describe('Scope / Support Matrix', () => {
  it('Brand = insufficient_data · Industry/Global = supported', () => {
    expect(FLEET_SCOPES.find((s) => s.scope === 'brand')!.support).toBe('insufficient_data');
    expect(FLEET_SCOPES.find((s) => s.scope === 'industry')!.support).toBe('supported');
    expect(FLEET_SCOPES.find((s) => s.scope === 'global')!.support).toBe('supported');
  });
  it('Production Apply = unsupported · Recommendation = evidence_only · Trust = read_only', () => {
    expect(FLEET_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(FLEET_SUPPORT.find((s) => s.key === 'recommendation')!.status).toBe('evidence_only');
    expect(FLEET_SUPPORT.find((s) => s.key === 'trust')!.status).toBe('read_only');
  });
});
