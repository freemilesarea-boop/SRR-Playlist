// Phase AI-RECOMMENDATION-1 — AI Recommendation Engine 순수 로직 단위 테스트.
// 실제 KPI 기반 · Evidence 필수 · Confidence=데이터충족률 · Priority Score · NaN/Infinity 금지.
import { describe, it, expect } from 'vitest';
import {
  generateRecommendations, computeConfidence, priorityScore, scoreToPriority, priorityRank,
  PRIORITY_ORDER, CATEGORY_LABEL,
  type Evidence, type RecommendationInputs,
} from './aiRecommendation';

const ev = (satisfied: boolean): Evidence => ({
  kpi: 'k', label: 'l', current: 1, baseline: 0, changeRate: null, period: 'p', source: 's', satisfied,
});

describe('Confidence — 데이터 충족률', () => {
  it('8개 중 7개 만족 → 87 (반올림)', () => {
    const list = [...Array(7).fill(0).map(() => ev(true)), ev(false)];
    expect(computeConfidence(list)).toBe(88); // 7/8=87.5 → 88
  });
  it('evidence 없음 → 0', () => { expect(computeConfidence([])).toBe(0); });
  it('전부 만족 → 100', () => { expect(computeConfidence([ev(true), ev(true)])).toBe(100); });
});

describe('priorityScore — 0~100, NaN/Infinity 금지', () => {
  it('요소 clamp + 범위', () => {
    expect(priorityScore({ impact: 1, changeRate: 1, scope: 1 })).toBe(100);
    expect(priorityScore({ impact: 0, changeRate: 1, scope: 1 })).toBe(0);
    const s = priorityScore({ impact: 0.8, changeRate: 0.5, scope: 0.5 });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
  it('음수/초과 입력도 clamp (Infinity 없음)', () => {
    const s = priorityScore({ impact: 5, changeRate: -3, scope: 99 });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeLessThanOrEqual(100);
  });
  it('scoreToPriority 매핑', () => {
    expect(scoreToPriority(85)).toBe('critical');
    expect(scoreToPriority(65)).toBe('high');
    expect(scoreToPriority(45)).toBe('medium');
    expect(scoreToPriority(25)).toBe('low');
    expect(scoreToPriority(5)).toBe('info');
  });
});

describe('generateRecommendations — 실제 KPI 만, Evidence 필수', () => {
  it('KPI 없음(전부 null) → 추천 없음', () => {
    expect(generateRecommendations({})).toEqual([]);
  });
  it('정상 지표 → 추천 없음(임계 미달)', () => {
    const x: RecommendationInputs = {
      revenueGrowthThis: 5, memberMomRate: 3, paymentFailures: 0, qcPending: 3,
      settlementPending: 0, offlineStores: 0, offlinePlayers: 0, streamHealth: 95,
      playbackErrors: 0, todayIncidents: 0, businessTotal: 3, businessMonthSignups: 2,
    };
    expect(generateRecommendations(x)).toEqual([]);
  });
  it('Revenue 감소 → revenue 추천 + Evidence 존재', () => {
    const recs = generateRecommendations({ revenueGrowthThis: -12, revenueThis: 88, revenueLast: 100 });
    const r = recs.find((x) => x.ruleKey === 'revenue_drop')!;
    expect(r).toBeTruthy();
    expect(r.category).toBe('revenue');
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.reason).toContain('-12');
    expect(r.confidence).toBeGreaterThan(0);
  });
  it('QC 적체 → action=qc_retry (Action Center 재사용)', () => {
    const recs = generateRecommendations({ qcPending: 128 });
    const r = recs.find((x) => x.ruleKey === 'qc_backlog')!;
    expect(r.suggestedAction.kind).toBe('action');
    expect(r.suggestedAction.ref).toBe('qc_retry');
    expect(r.message).toContain('QC');
  });
  it('Incident → 높은 우선순위, store_resync action', () => {
    const recs = generateRecommendations({ todayIncidents: 3 });
    const r = recs.find((x) => x.ruleKey === 'incident_up')!;
    expect(['critical', 'high']).toContain(r.priority);
    expect(r.suggestedAction.ref).toBe('store_resync');
  });
  it('모든 추천은 Evidence + Confidence(0~100) 보유', () => {
    const recs = generateRecommendations({
      revenueGrowthThis: -20, memberMomRate: -10, paymentFailures: 12, qcPending: 80,
      settlementPending: 5, offlineStores: 3, offlinePlayers: 4, totalPlayers: 10,
      streamHealth: 60, playbackErrors: 3, todayIncidents: 2, businessTotal: 5, businessMonthSignups: 0,
    });
    expect(recs.length).toBeGreaterThanOrEqual(10);
    for (const r of recs) {
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });
  it('score 내림차순 정렬', () => {
    const recs = generateRecommendations({
      revenueGrowthThis: -25, todayIncidents: 3, settlementPending: 2,
    });
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
  });
});

describe('경계/추정 금지', () => {
  it('baseline 0 → 변화율 계산 안 함(Infinity 금지), 추천 없음', () => {
    // revenueLast=0 이면 pct null → growth null → 추천 없음(추정 금지)
    expect(generateRecommendations({ revenueThis: 50, revenueLast: 0 })).toEqual([]);
  });
  it('NaN/Infinity 입력 → 무시', () => {
    expect(generateRecommendations({ qcPending: NaN, offlineStores: Infinity })).toEqual([]);
  });
  it('payment failure 임계 미달(4) → 추천 없음', () => {
    expect(generateRecommendations({ paymentFailures: 4 })).toEqual([]);
  });
});

describe('표시 헬퍼', () => {
  it('priority 순서/랭크', () => {
    expect(PRIORITY_ORDER.length).toBe(5);
    expect(priorityRank('critical')).toBe(0);
    expect(priorityRank('info')).toBe(4);
  });
  it('카테고리 라벨', () => {
    expect(CATEGORY_LABEL.revenue).toBe('매출');
    expect(CATEGORY_LABEL.operations).toBe('운영');
  });
});
