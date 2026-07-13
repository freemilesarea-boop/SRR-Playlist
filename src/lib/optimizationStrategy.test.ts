// Phase AI-MUSIC-5 — Autonomous Optimization Strategy 순수 로직 단위 테스트.
// Generation · Ranking · ROI · Cost · Risk · Multi-Strategy · Conflict · Dependency · Plan · Memory 라벨 ·
// Sample gate · 0~100 clamp · NaN 금지 · Evidence.
import { describe, it, expect } from 'vitest';
import {
  generateStrategies, rankStrategies, roiScore, computeStrategyRisk, COST_MODEL,
  multiStrategySimulation, detectConflicts, dependencyGraph, optimizationPlan,
  STRATEGY_LABEL, STRATEGY_STATUS_LABEL, roiTone, costTone, strategyAllowed,
  type GenerateInput, type Strategy, type ExpectedGain, type StrategyType,
} from './optimizationStrategy';
import type { ContextSummary, GenreMoodRow } from './contextIntel';
import type { ItemKpi } from './predictiveIntel';

const summary = (over: Partial<ContextSummary> = {}): ContextSummary => ({
  events: 300, track_count: 15, playlist_count: 2, genre_count: 6, mood_count: 5,
  unknown_genre_events: 0, completion_rate: 72, skip_rate: 10, avg_listen_seconds: 100,
  likes: 2, replays: 3, last_event_at: '2026-07-10T00:00:00Z', days_since_last: 20, ...over,
});
const tracks: ItemKpi[] = [
  { key: 't1', label: 'Best', events: 50, completion_rate: 92, skip_rate: 2 },
  { key: 't2', label: 'Worst', events: 40, completion_rate: 38, skip_rate: 35 },
];
const genres: GenreMoodRow[] = [
  { key: 'Lo-fi', is_unknown: false, events: 80, completion_rate: 88, skip_rate: 3 },
  { key: 'Rock', is_unknown: false, events: 40, completion_rate: 45, skip_rate: 30 },
];
const moods: GenreMoodRow[] = [
  { key: '차분한', is_unknown: false, events: 70, completion_rate: 85, skip_rate: 4 },
  { key: '신나는', is_unknown: false, events: 40, completion_rate: 50, skip_rate: 22 },
];
const playlists: ItemKpi[] = [{ key: 'p1', label: 'Weak', events: 60, completion_rate: 58, skip_rate: 15 }];

const genInput = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  summary: summary(), tracks, playlists, genres, moods, confidence: 70, driftScore: 20,
  metadataCoverage: 90, historicalFailureRate: 20, daysSinceLast: 20, ...over,
});

describe('generateStrategies — 전략 생성·Sample gate·Evidence', () => {
  it('충분 표본 → 전략 생성 + 모든 전략 Evidence', () => {
    const st = generateStrategies(genInput());
    expect(st.length).toBeGreaterThan(0);
    expect(st.every((s) => s.evidence.length > 0)).toBe(true);
    expect(st.every((s) => s.roi >= 0 && s.roi <= 100)).toBe(true);
  });
  it('표본 부족 → 전략 없음', () => {
    expect(generateStrategies(genInput({ summary: summary({ events: 10 }) })).length).toBe(0);
  });
  it('고성과 Track → track_promotion, 저성과 → demotion/replacement', () => {
    const types = generateStrategies(genInput()).map((s) => s.type);
    expect(types).toContain('track_promotion');
    expect(types).toContain('track_demotion');
  });
  it('Track 수 부족 → test_pool_expand', () => {
    expect(generateStrategies(genInput({ summary: summary({ track_count: 8 }) })).map((s) => s.type)).toContain('test_pool_expand');
  });
});

describe('ROI / Cost / Risk', () => {
  it('roiScore 0~100', () => {
    const gain: ExpectedGain = { completion: 5, skip: -3, listening: 10, health: 4 };
    const r = roiScore(gain, 80, 30, 20);
    expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(100); expect(r).toBeGreaterThan(40);
  });
  it('높은 Cost/Risk → ROI 하락', () => {
    const gain: ExpectedGain = { completion: 5, skip: -3, listening: 0, health: 4 };
    expect(roiScore(gain, 80, 90, 90)).toBeLessThan(roiScore(gain, 80, 20, 20));
  });
  it('Cost Model 존재·작업량 순', () => {
    expect(COST_MODEL.genre_ratio.level).toBe('low');
    expect(COST_MODEL.playlist_refresh.level).toBe('high');
    expect(COST_MODEL.playlist_refresh.score).toBeGreaterThan(COST_MODEL.genre_ratio.score);
  });
  it('computeStrategyRisk 0~100·구성', () => {
    const r = computeStrategyRisk({ confidence: 40, sample: 30, driftScore: 60 });
    expect(r.score).toBeGreaterThan(0); expect(r.score).toBeLessThanOrEqual(100);
    expect(r.components.length).toBe(5);
  });
  it('낮은 confidence/표본 → 높은 Risk', () => {
    const low = computeStrategyRisk({ confidence: 20, sample: 20 }).score;
    const high = computeStrategyRisk({ confidence: 90, sample: 300 }).score;
    expect(low).toBeGreaterThan(high);
  });
});

describe('rankStrategies / multiStrategySimulation', () => {
  it('ROI 내림차순', () => {
    const st = generateStrategies(genInput());
    const ranked = rankStrategies(st);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].roi).toBeGreaterThanOrEqual(ranked[i].roi);
  });
  it('Multi 시뮬 수확체감·충돌 표기', () => {
    const st = generateStrategies(genInput());
    const m = multiStrategySimulation(st);
    expect(Number.isFinite(m.combined.completion)).toBe(true);
    expect(m.strategies.length).toBe(st.length);
  });
});

describe('detectConflicts', () => {
  const mk = (type: StrategyType, target: string | null): Strategy => ({
    id: `${type}:${target}`, type, target, label: STRATEGY_LABEL[type],
    expected: { completion: 1, skip: -1, listening: 0, health: 1 }, confidence: 70, sample: 200,
    cost: COST_MODEL[type], risk: computeStrategyRisk({ confidence: 70, sample: 200 }), roi: 50, evidence: [{ label: 'x', value: 1 }],
  });
  it('상반 전략(promotion↔demotion) 충돌', () => {
    const c = detectConflicts([mk('track_promotion', 'A'), mk('track_demotion', 'B')]);
    expect(c.length).toBeGreaterThan(0);
  });
  it('test pool expand↔reduce 충돌', () => {
    expect(detectConflicts([mk('test_pool_expand', null), mk('test_pool_reduce', null)]).length).toBeGreaterThan(0);
  });
  it('동일 대상 상이 전략 충돌', () => {
    expect(detectConflicts([mk('track_promotion', 'Same'), mk('playlist_refresh', 'Same')]).length).toBeGreaterThan(0);
  });
  it('무충돌', () => {
    expect(detectConflicts([mk('genre_ratio', null), mk('mood_ratio', null)]).length).toBe(0);
  });
});

describe('dependencyGraph / optimizationPlan', () => {
  const mk = (type: StrategyType, roi: number): Strategy => ({
    id: type, type, target: null, label: STRATEGY_LABEL[type],
    expected: { completion: 1, skip: -1, listening: 0, health: 1 }, confidence: 70, sample: 200,
    cost: COST_MODEL[type], risk: computeStrategyRisk({ confidence: 70, sample: 200 }), roi, evidence: [{ label: 'x', value: 1 }],
  });
  it('의존성 present 판정', () => {
    const g = dependencyGraph([mk('track_promotion', 80), mk('playlist_refresh', 90)]);
    expect(g.some((d) => d.from === 'track_promotion' && d.to === 'playlist_refresh' && d.present)).toBe(true);
  });
  it('Plan: 선행(promotion) 이 후행(playlist_refresh) 보다 먼저', () => {
    const plan = optimizationPlan([mk('playlist_refresh', 95), mk('track_promotion', 60)]);
    const proIdx = plan.findIndex((p) => p.strategy.type === 'track_promotion');
    const refIdx = plan.findIndex((p) => p.strategy.type === 'playlist_refresh');
    expect(proIdx).toBeLessThan(refIdx);
  });
  it('의존성 없으면 ROI 우선', () => {
    const plan = optimizationPlan([mk('genre_ratio', 40), mk('mood_ratio', 90)]);
    expect(plan[0].strategy.type).toBe('mood_ratio');
  });
});

describe('헬퍼 / 게이트', () => {
  it('strategyAllowed 표본 gate', () => {
    expect(strategyAllowed(10)).toBe(false); expect(strategyAllowed(20)).toBe(true);
  });
  it('톤/라벨', () => {
    expect(roiTone(70)).toBe('success'); expect(roiTone(10)).toBe('danger');
    expect(costTone('low')).toBe('success');
    expect(STRATEGY_STATUS_LABEL.approved).toBe('승인');
    expect(STRATEGY_LABEL.rediscovery).toBe('Rediscovery Campaign');
  });
});
