// Phase ADMIN-MISSION-CONTROL-1 — Mission Control 통합 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  composeMissionHealth, generateInsights, feedLabel, modeKpis,
  MISSION_HEALTH_LABEL, MISSION_HEALTH_TONE, FEED_META, EXECUTIVE_MODES,
  type HealthComponentInput,
} from './missionControl';

function comp(over: Partial<HealthComponentInput>): HealthComponentInput {
  return { key: 'k', label: 'l', score: 100, available: true, ...over };
}

describe('composeMissionHealth — 없는 항목 제외, 0~100', () => {
  it('available 평균 (실데이터: streaming 75.4·fleet 100·store 66.7 → 80.7)', () => {
    const r = composeMissionHealth([
      comp({ key: 'streaming', score: 75.4 }),
      comp({ key: 'fleet', score: 100 }),
      comp({ key: 'store', score: 66.7 }),
      comp({ key: 'member', available: false, score: null }),
    ]);
    expect(r.score).toBe(80.7);
    expect(r.level).toBe('healthy');
    expect(r.used.length).toBe(3);
    expect(r.excluded.length).toBe(1);
  });
  it('전부 미가용 → unknown/null (추정 금지)', () => {
    const r = composeMissionHealth([comp({ available: false, score: null }), comp({ available: false, score: null })]);
    expect(r.score).toBeNull(); expect(r.level).toBe('unknown');
  });
  it('낮은 점수 → danger', () => {
    expect(composeMissionHealth([comp({ score: 20 }), comp({ score: 40 })]).level).toBe('danger');
  });
  it('레벨 라벨/톤', () => {
    expect(MISSION_HEALTH_LABEL.warning).toBe('주의');
    expect(MISSION_HEALTH_TONE.danger).toBe('danger');
    expect(MISSION_HEALTH_LABEL.unknown).toBe('데이터 없음');
  });
});

describe('generateInsights — 사실 서술만 (LLM/예측/원인 없음)', () => {
  it('실데이터 요약', () => {
    const ins = generateInsights({
      memberToday: 0, memberMomText: '+180.0%', memberMomTone: 'success',
      businessToday: 0, artistToday: 0,
      revenueToday: 4900, revenueGrowthText: '+45.4%', revenueGrowthTone: 'success',
      completionRate: 75.4, onlinePlayers: 0, totalPlayers: 5, todayIncidents: 0,
    });
    const byKey = Object.fromEntries(ins.map((i) => [i.key, i]));
    expect(byKey.member.text).toContain('오늘 신규 회원 0명');
    expect(byKey.member.text).toContain('전월 대비 +180.0%');
    expect(byKey.revenue.text).toContain('오늘 매출 ₩4,900');
    expect(byKey.streaming.text).toBe('재생 완료율 75.4%');
    expect(byKey.streaming.tone).toBe('warning');
    expect(byKey.players.text).toContain('온라인 Player 0/5');
    expect(byKey.players.tone).toBe('danger'); // 전부 오프라인
    expect(byKey.incident.tone).toBe('success'); // 0건
  });
  it('데이터 없는 지표는 문장 생성 안 함 (추정 금지)', () => {
    const ins = generateInsights({ memberToday: 5 });
    expect(ins.length).toBe(1);
    expect(ins[0].key).toBe('member');
  });
  it('Incident 있으면 danger', () => {
    const ins = generateInsights({ todayIncidents: 3 });
    expect(ins[0].tone).toBe('danger');
    expect(ins[0].text).toBe('오늘 Incident 3건');
  });
});

describe('feedLabel / FEED_META', () => {
  it('kind 라벨', () => {
    expect(feedLabel({ kind: 'payment_paid', label: 'x' })).toBe('결제 완료');
    expect(feedLabel({ kind: 'artist_approved', label: 'x' })).toBe('아티스트 승인');
  });
  it('모든 kind 메타 존재', () => {
    for (const k of ['member_signup', 'business_signup', 'artist_signup', 'artist_approved', 'qc_passed', 'track_released', 'subscription', 'payment_paid', 'settlement', 'store_created'] as const) {
      expect(FEED_META[k]).toBeTruthy();
    }
  });
});

describe('Executive Modes — 위젯 조합만', () => {
  it('모드별 KPI 키', () => {
    expect(modeKpis('finance')).toContain('mrr');
    expect(modeKpis('operations')).toContain('fleet_health');
    expect(modeKpis('ceo')).toContain('mission_health');
  });
  it('7개 모드 존재', () => {
    expect(Object.keys(EXECUTIVE_MODES).length).toBe(7);
  });
});
