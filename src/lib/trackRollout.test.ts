// Phase AI-PLAYLIST-3 — Track Rollout 순수 로직 단위 테스트.
// 실제 KPI 승격 · Sample 부족→판단 보류 · Evidence · Rollback · 자동 배포 없음 · clamp/NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER, STAGE_PERCENT, stageRank, nextStage, prevStage,
  evaluatePromotion, suggestNextPercent, aggregateRolloutLearning, normalizeKpi,
  DEFAULT_CONFIG, DECISION_LABEL, DECISION_TONE, STAGE_LABEL,
  type TrackKpi, type RolloutHistoryLike,
} from './trackRollout';

function kpi(over: Partial<TrackKpi> = {}): TrackKpi {
  return { events: 50, skips: 2, skip_rate: 4, completion_rate: 75, avg_listen_seconds: 110, likes: 3, replays: 1, store_coverage: 3, playlist_coverage: 4, ...over };
}

describe('Stage 순서/전환', () => {
  it('7단계 순서', () => { expect(STAGE_ORDER.length).toBe(7); expect(stageRank('global')).toBeGreaterThan(stageRank('pilot')); });
  it('nextStage — global 다음 없음', () => {
    expect(nextStage('test_pool')).toBe('pilot');
    expect(nextStage('expanded')).toBe('global');
    expect(nextStage('global')).toBeNull();
    expect(nextStage('archived')).toBeNull();
  });
  it('prevStage — test_pool 이하 없음', () => {
    expect(prevStage('pilot')).toBe('test_pool');
    expect(prevStage('test_pool')).toBeNull();
  });
  it('STAGE_PERCENT — global 100', () => { expect(STAGE_PERCENT.global).toBe(100); expect(STAGE_PERCENT.test_pool).toBe(5); });
});

describe('evaluatePromotion — 승격/보류/Rollback/보류', () => {
  it('Sample 부족 → insufficient(판단 보류)', () => {
    const e = evaluatePromotion(kpi({ events: 10 }));
    expect(e.decision).toBe('insufficient');
    expect(e.sampleOk).toBe(false);
    expect(e.reason).toContain('Sample 부족');
  });
  it('기준 충족 → promote + Evidence pass', () => {
    const e = evaluatePromotion(kpi({ events: 50, completion_rate: 78, skip_rate: 3 }));
    expect(e.decision).toBe('promote');
    expect(e.evidence.every((x) => x.pass)).toBe(true);
  });
  it('완주 미달 → hold', () => {
    const e = evaluatePromotion(kpi({ events: 50, completion_rate: 60, skip_rate: 3 }));
    expect(e.decision).toBe('hold');
    expect(e.evidence.find((x) => x.kpi === 'completion_rate')!.pass).toBe(false);
  });
  it('Skip 급증 → rollback (우선)', () => {
    const e = evaluatePromotion(kpi({ events: 50, completion_rate: 78, skip_rate: 30 }));
    expect(e.decision).toBe('rollback');
    expect(e.reason).toContain('Skip율 급증');
  });
  it('완주 급감 → rollback', () => {
    const e = evaluatePromotion(kpi({ events: 50, completion_rate: 40, skip_rate: 5 }));
    expect(e.decision).toBe('rollback');
  });
  it('완주율 null → hold(승격 아님), NaN 없음', () => {
    const e = evaluatePromotion(kpi({ events: 50, completion_rate: null, skip_rate: 3 }));
    expect(['hold', 'rollback']).toContain(e.decision);
    expect(e.completion).toBeNull();
  });
  it('config 커스텀 반영', () => {
    const strict = { ...DEFAULT_CONFIG, completion_min: 90 };
    expect(evaluatePromotion(kpi({ events: 50, completion_rate: 80, skip_rate: 2 }), strict).decision).toBe('hold');
  });
});

describe('suggestNextPercent', () => {
  it('test_pool → pilot(10%)', () => { expect(suggestNextPercent('test_pool')).toBe(10); });
  it('global → null', () => { expect(suggestNextPercent('global')).toBeNull(); });
});

describe('normalizeKpi — 음수/NaN 제거', () => {
  it('음수/NaN → 0 또는 null', () => {
    const k = normalizeKpi({ events: -5, skip_rate: NaN, completion_rate: 150, likes: -1 });
    expect(k.events).toBe(0);
    expect(k.skip_rate).toBeNull();
    expect(k.completion_rate).toBe(100); // clamp
    expect(k.likes).toBe(0);
  });
  it('null 입력 → 0 채움', () => {
    expect(normalizeKpi(null).events).toBe(0);
  });
});

describe('aggregateRolloutLearning', () => {
  const hist: RolloutHistoryLike[] = [
    { decision: 'promote' }, { decision: 'promote' }, { decision: 'rollback' }, { decision: 'hold' }, { decision: 'manual' },
  ];
  it('promoteRate = promote/(promote+rollback), rollbackRate=rollback/total', () => {
    const a = aggregateRolloutLearning(hist);
    expect(a.promote).toBe(2);
    expect(a.rollback).toBe(1);
    expect(a.promoteRate).toBeCloseTo(66.7, 1); // 2/(2+1)
    expect(a.rollbackRate).toBeCloseTo(25, 1);  // 1/4 decided(promote+hold+rollback)
  });
  it('빈 입력 → rate null', () => {
    const a = aggregateRolloutLearning([]);
    expect(a.promoteRate).toBeNull();
    expect(a.rollbackRate).toBeNull();
  });
});

describe('라벨/톤', () => {
  it('decision/stage 라벨', () => {
    expect(DECISION_LABEL.promote).toBe('승격 추천');
    expect(DECISION_LABEL.insufficient).toBe('판단 보류');
    expect(DECISION_TONE.rollback).toBe('danger');
    expect(STAGE_LABEL.test_pool).toBe('Test Pool');
  });
});
