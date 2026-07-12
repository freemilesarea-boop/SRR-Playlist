// Phase ADMIN-BUSINESS-1 — Business Intelligence 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  formatKRW, pct, formatPct, onlineRate, computeHealth,
  businessIntegrityWarnings, businessSupportMatrix, sortedHealthComponents,
  HEALTH_LEVEL_LABEL, HEALTH_LEVEL_TONE,
} from './businessIntel';
import { EMPTY_BUSINESS_SUMMARY, type BusinessSummary, type BusinessHealth, type HealthComponent } from './adminApi';

function summary(over: Partial<BusinessSummary>): BusinessSummary { return { ...EMPTY_BUSINESS_SUMMARY, ...over }; }
function comp(over: Partial<HealthComponent>): HealthComponent {
  return { key: 'k', label: 'l', score: 100, available: true, detail: '', ...over };
}

// 실데이터 기반
const REAL = summary({
  total_business: 3, active_business: 1, inactive_business: 2, total_brands: 1, active_brands: 1,
  total_stores: 5, business_stores: 3, total_players: 5, online_players: 0, offline_players: 5,
  heartbeat_players: 5, playing_players: 5, monthly_fee_default: 4900,
});

describe('formatKRW', () => {
  it('원', () => { expect(formatKRW(4900)).toBe('₩4,900'); });
  it('NaN → ₩0', () => { expect(formatKRW(NaN)).toBe('₩0'); });
});

describe('pct / onlineRate — 0 분모/NaN 금지', () => {
  it('정상', () => { expect(pct(5, 5)).toBe(100); });
  it('온라인율 0/5 = 0%', () => { expect(onlineRate(REAL)).toBe(0); });
  it('분모 0 → null', () => { expect(onlineRate(summary({ total_players: 0, online_players: 0 }))).toBeNull(); });
});

describe('formatPct', () => {
  it('소수1', () => { expect(formatPct(66.7)).toBe('66.7%'); });
  it('null/Infinity → —', () => { expect(formatPct(null)).toBe('—'); expect(formatPct(Infinity)).toBe('—'); });
});

describe('computeHealth — available 신호만 평균 (0~100)', () => {
  it('실데이터: online 0 · heartbeat 100 · streaming 100 → 66.7 주의', () => {
    const h: BusinessHealth = {
      components: [
        comp({ key: 'player_online', score: 0 }),
        comp({ key: 'heartbeat', score: 100 }),
        comp({ key: 'streaming', score: 100 }),
      ],
      excluded: ['Playback Error', 'Buffer', 'Queue Delay', 'Recovery', 'Crossfade', 'Streaming Quality'],
      players: 5, generated_at: null,
    };
    const r = computeHealth(h);
    expect(r.score).toBe(66.7);
    expect(r.level).toBe('warning');
    expect(r.usedCount).toBe(3);
    expect(r.excludedCount).toBe(6);
  });
  it('전부 정상 100 → healthy', () => {
    const h: BusinessHealth = { components: [comp({ score: 100 }), comp({ score: 90 })], excluded: [], players: 2, generated_at: null };
    expect(computeHealth(h).level).toBe('healthy');
  });
  it('낮은 점수 → danger', () => {
    const h: BusinessHealth = { components: [comp({ score: 20 }), comp({ score: 40 })], excluded: [], players: 2, generated_at: null };
    expect(computeHealth(h).level).toBe('danger');
  });
  it('available 없음 → unknown/null (추정 금지)', () => {
    const h: BusinessHealth = { components: [comp({ available: false, score: null })], excluded: ['x'], players: 0, generated_at: null };
    const r = computeHealth(h);
    expect(r.score).toBeNull(); expect(r.level).toBe('unknown');
  });
  it('score=null 컴포넌트는 제외', () => {
    const h: BusinessHealth = { components: [comp({ score: 80 }), comp({ available: true, score: null })], excluded: [], players: 1, generated_at: null };
    const r = computeHealth(h);
    expect(r.score).toBe(80); expect(r.usedCount).toBe(1);
  });
});

describe('businessIntegrityWarnings', () => {
  it('실데이터 정상 → 경고 없음', () => { expect(businessIntegrityWarnings(REAL)).toEqual([]); });
  it('온라인+오프라인 ≠ 총 → 경고', () => {
    expect(businessIntegrityWarnings(summary({ total_players: 5, online_players: 1, offline_players: 1 })).length).toBeGreaterThan(0);
  });
  it('활성 사업자 > 총 → 경고', () => {
    expect(businessIntegrityWarnings(summary({ total_business: 3, active_business: 5, offline_players: 0 })).some((w) => w.includes('활성 사업자'))).toBe(true);
  });
});

describe('businessSupportMatrix', () => {
  const m = businessSupportMatrix({ player_recovery: false, heartbeat_history: false, store_health: false, streaming_quality: false, playback_error: false, queue_delay: false, crossfade: false, business_ai_score: false, region: true, country: false });
  it('지역별 지원', () => { expect(m.find((x) => x.key === 'region')!.supported).toBe(true); });
  it('나머지 미지원', () => {
    expect(m.find((x) => x.key === 'player_recovery')!.supported).toBe(false);
    expect(m.find((x) => x.key === 'streaming_quality')!.supported).toBe(false);
  });
  it('undefined → 전부 미지원', () => { expect(businessSupportMatrix(undefined).every((x) => !x.supported)).toBe(true); });
});

describe('sortedHealthComponents', () => {
  it('available 먼저, 점수 낮은 순', () => {
    const sorted = sortedHealthComponents([
      comp({ key: 'a', available: false, score: null }),
      comp({ key: 'b', available: true, score: 100 }),
      comp({ key: 'c', available: true, score: 0 }),
    ]);
    expect(sorted.map((s) => s.key)).toEqual(['c', 'b', 'a']);
  });
});

describe('레벨 라벨/톤', () => {
  it('매핑', () => {
    expect(HEALTH_LEVEL_LABEL.warning).toBe('주의');
    expect(HEALTH_LEVEL_TONE.danger).toBe('danger');
    expect(HEALTH_LEVEL_LABEL.unknown).toBe('데이터 없음');
  });
});
