// Phase ADMIN-MEMBER-FUNNEL-1 — 회원 퍼널 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  safeRate, funnelTone, computeFunnel, finalConversion, topDropSteps,
  monotonicWarnings, computeHistoryDeltas, formatDelta, funnelSupportSummary,
} from './memberFunnel';
import type { FunnelStep, FunnelHistoryStep, MemberFunnel } from './adminApi';

function step(key: string, count: number | null, supported = true, note?: string): FunnelStep {
  return { key, label: key, count, supported, note };
}

// 실데이터 메인 체인(검증된 값, 단조): 157→146→141→119→68→3→1
const REAL: FunnelStep[] = [
  step('signup', 157), step('email', 146), step('login', 141), step('profile', 119),
  step('paid', 68), step('business', 3), step('store', 1),
];
// engagement(subset 아님/미지원): first_play 49, player/streaming 미지원
const ENGAGEMENT: FunnelStep[] = [
  step('first_play', 49), step('player', null, false), step('streaming', null, false),
];
// 비단조 합성 케이스 (유료 68 > 첫재생 49)
const NON_MONO: FunnelStep[] = [step('profile', 119), step('first_play', 49), step('paid', 68)];

describe('safeRate — 0~100 clamp, NaN/Infinity 금지', () => {
  it('일반', () => { expect(safeRate(146, 157)).toBe(93); expect(safeRate(68, 119)).toBe(57.1); });
  it('분모 0 → null (Infinity 금지)', () => { expect(safeRate(5, 0)).toBeNull(); });
  it('분자>분모 → 100 clamp', () => { expect(safeRate(200, 100)).toBe(100); });
  it('0/0 → null (NaN 금지)', () => { expect(safeRate(0, 0)).toBeNull(); });
  it('음수 분모 → null', () => { expect(safeRate(5, -1)).toBeNull(); });
});

describe('funnelTone — 색상 임계', () => {
  it('90%+ success', () => { expect(funnelTone(93)).toBe('success'); expect(funnelTone(90)).toBe('success'); });
  it('70~90 warning', () => { expect(funnelTone(84.4)).toBe('warning'); expect(funnelTone(70)).toBe('warning'); });
  it('70 미만 danger', () => { expect(funnelTone(57.1)).toBe('danger'); expect(funnelTone(4.4)).toBe('danger'); });
  it('null neutral', () => { expect(funnelTone(null)).toBe('neutral'); });
});

describe('computeFunnel — 전환/이탈/단조성', () => {
  const c = computeFunnel(REAL);
  it('첫 step 은 전환율 null(기준)', () => {
    expect(c[0].convFromPrev).toBeNull();
    expect(c[0].tone).toBe('neutral');
  });
  it('전환율/이탈률 계산', () => {
    expect(c[1].convFromPrev).toBe(93);       // 146/157
    expect(c[1].dropFromPrev).toBe(7);
    expect(c[1].dropCount).toBe(11);           // 157-146
  });
  it('색상: 유료 결제(57.1%) danger', () => {
    const paid = c.find((s) => s.key === 'paid')!;
    expect(paid.convFromPrev).toBe(57.1);      // 68/119
    expect(paid.tone).toBe('danger');
  });
  it('메인 체인은 단조 → 비단조 플래그 없음', () => {
    expect(c.every((s) => !s.nonMonotonic)).toBe(true);
  });
  it('store 는 business(3) 대비 33.3%', () => {
    const store = c.find((s) => s.key === 'store')!;
    expect(store.convFromPrev).toBe(33.3);
  });
  it('미지원 step(engagement) 은 전환 계산 제외', () => {
    const e = computeFunnel(ENGAGEMENT);
    const player = e.find((s) => s.key === 'player')!;
    expect(player.convFromPrev).toBeNull();
    expect(player.tone).toBe('neutral');
    expect(player.nonMonotonic).toBe(false);
  });
  it('비단조 감지: 유료(68) > 첫재생(49)', () => {
    const nm = computeFunnel(NON_MONO);
    expect(nm.find((s) => s.key === 'paid')!.nonMonotonic).toBe(true);
  });
});

describe('finalConversion — 첫/마지막 supported', () => {
  it('157 → store 1 = 0.6%', () => { expect(finalConversion(REAL)).toBe(0.6); });
  it('supported 2개 미만 → null', () => {
    expect(finalConversion([step('a', 10), step('b', null, false)])).toBeNull();
  });
});

describe('topDropSteps — 이탈 TOP-N (이탈률 순)', () => {
  const top = topDropSteps(REAL, 5);
  it('이탈률 높은 순 정렬', () => {
    // business: 3/68 → 이탈률 95.6% 가 최상위
    expect(top[0].key).toBe('business');
    expect(top[0].dropRate).toBeGreaterThan(90);
  });
  it('N 제한', () => { expect(top.length).toBeLessThanOrEqual(5); });
  it('이탈 인원 0 인 step 제외 & dropCount 양수', () => {
    for (const d of top) expect(d.dropCount).toBeGreaterThan(0);
  });
});

describe('monotonicWarnings', () => {
  it('비단조 구간 경고 (합성: 유료>첫재생)', () => {
    const w = monotonicWarnings(NON_MONO);
    expect(w.length).toBe(1);
  });
  it('메인 실체인은 단조 → 경고 없음', () => {
    expect(monotonicWarnings(REAL)).toEqual([]);
  });
});

describe('computeHistoryDeltas — 이번달 vs 지난달', () => {
  const hist: FunnelHistoryStep[] = [
    { key: 'signup', label: '회원가입', this: 56, prev: 20 },
    { key: 'email', label: '이메일 인증', this: 55, prev: 20 },
    { key: 'paid', label: '유료 결제', this: 20, prev: 10 },
  ];
  const d = computeHistoryDeltas(hist);
  it('가입 대비 전환율', () => {
    expect(d[1].thisConv).toBe(98.2);   // 55/56
    expect(d[1].prevConv).toBe(100);    // 20/20
    expect(d[1].deltaPct).toBe(-1.8);
  });
  it('유료 전환 증감', () => {
    expect(d[2].thisConv).toBe(35.7);   // 20/56
    expect(d[2].prevConv).toBe(50);     // 10/20
    expect(d[2].deltaPct).toBe(-14.3);
  });
  it('빈 입력 → 빈 배열', () => { expect(computeHistoryDeltas([])).toEqual([]); });
  it('지난달 0 코호트 → prevConv null, delta null (NaN 금지)', () => {
    const z: FunnelHistoryStep[] = [
      { key: 'signup', label: 'a', this: 10, prev: 0 },
      { key: 'paid', label: 'b', this: 4, prev: 0 },
    ];
    const r = computeHistoryDeltas(z);
    expect(r[1].prevConv).toBeNull();
    expect(r[1].deltaPct).toBeNull();
    expect(r[1].thisConv).toBe(40);
  });
});

describe('formatDelta', () => {
  it('부호/단위', () => {
    expect(formatDelta(12)).toBe('+12.0pp');
    expect(formatDelta(-3)).toBe('-3.0pp');
    expect(formatDelta(0)).toBe('0.0pp');
  });
  it('null → —', () => { expect(formatDelta(null)).toBe('—'); });
});

describe('funnelSupportSummary', () => {
  it('미지원 목록 (메인+참여 결합)', () => {
    const f: MemberFunnel = {
      range: 'all', cohort_total: 157, steps: [...REAL, ...ENGAGEMENT], engagement: ENGAGEMENT, generated_at: null,
    };
    const s = funnelSupportSummary(f);
    expect(s.total).toBe(10);       // 7 메인 + 3 참여
    expect(s.supported).toBe(8);    // player/streaming 만 미지원
    expect(s.unsupported).toContain('player');
    expect(s.unsupported).toContain('streaming');
  });
});
