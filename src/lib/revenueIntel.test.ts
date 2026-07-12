// Phase ADMIN-REVENUE-1 — Revenue Intelligence 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  formatKRW, formatKRWShort, formatPct, growth, ratio, perCapita,
  deriveRevenueKpis, churnRate, revenueIntegrityWarnings, supportMatrix,
} from './revenueIntel';
import { EMPTY_REVENUE_KPIS, type RevenueKpis, type RevenueBreakdown } from './adminApi';

function kpis(over: Partial<RevenueKpis>): RevenueKpis {
  return { ...EMPTY_REVENUE_KPIS, ...over };
}

// 실데이터 기반(검증된 값)
const REAL = kpis({
  total_revenue: 366600, month_revenue: 109800, last_month_revenue: 75500,
  revenue_growth_this: 109800, revenue_growth_prev: 75500,
  subs_this_month: 25, subs_last_month: 13,
  mrr: 349000, arr: 4188000,
  arpu: 366600, active_members: 132, arppu_numerator: 366600, paying_users: 71,
  paid_count: 74, failed_payments: 3, refund_count: 0,
  active_subscriptions: 70, ending_subscriptions: 10,
});

describe('formatKRW', () => {
  it('원 포맷', () => { expect(formatKRW(366600)).toBe('₩366,600'); expect(formatKRW(0)).toBe('₩0'); });
  it('NaN/null → ₩0', () => { expect(formatKRW(NaN)).toBe('₩0'); expect(formatKRW(null)).toBe('₩0'); });
});

describe('formatKRWShort', () => {
  it('만 단위', () => { expect(formatKRWShort(366600)).toBe('₩36.7만'); });
  it('억 단위', () => { expect(formatKRWShort(418800000)).toBe('₩4.2억'); });
  it('천 단위 이하', () => { expect(formatKRWShort(4900)).toBe('₩4,900'); });
});

describe('formatPct', () => {
  it('소수1', () => { expect(formatPct(45.4)).toBe('45.4%'); });
  it('NaN/Infinity/null → —', () => {
    expect(formatPct(NaN)).toBe('—'); expect(formatPct(Infinity)).toBe('—'); expect(formatPct(null)).toBe('—');
  });
});

describe('growth — MoM (Infinity/NaN 금지)', () => {
  it('증가 → +%', () => {
    const g = growth(109800, 75500);
    expect(g.rate).toBe(45.4); expect(g.status).toBe('normal'); expect(g.text).toBe('+45.4%'); expect(g.tone).toBe('success');
  });
  it('감소 → -% danger', () => {
    const g = growth(50, 100); expect(g.rate).toBe(-50); expect(g.tone).toBe('danger');
  });
  it('지난달 0 · 이번달 >0 → 신규 성장', () => {
    const g = growth(10, 0); expect(g.status).toBe('new_growth'); expect(g.rate).toBeNull(); expect(g.text).toBe('신규 성장');
  });
  it('지난달 0 · 이번달 0 → 0.0% flat', () => {
    const g = growth(0, 0); expect(g.status).toBe('flat'); expect(g.text).toBe('0.0%');
  });
});

describe('ratio / perCapita — 0 분모 안전', () => {
  it('ratio 정상', () => { expect(ratio(74, 77)).toBe(96.1); });
  it('ratio 분모 0 → null', () => { expect(ratio(5, 0)).toBeNull(); });
  it('perCapita 정상', () => { expect(perCapita(366600, 71)).toBe(5163); });
  it('perCapita 분모 0 → 0', () => { expect(perCapita(1000, 0)).toBe(0); });
});

describe('deriveRevenueKpis — 실데이터', () => {
  const d = deriveRevenueKpis(REAL);
  it('Revenue Growth 45.4%', () => { expect(d.revenueGrowth.text).toBe('+45.4%'); });
  it('Subscription Growth (25 vs 13) = +92.3%', () => { expect(d.subscriptionGrowth.rate).toBe(92.3); });
  it('ARPU = 366600/132 = 2777', () => { expect(d.arpu).toBe(2777); });
  it('ARPPU = 366600/71 = 5163', () => { expect(d.arppu).toBe(5163); });
  it('결제 성공률 = 74/(74+3) = 96.1%', () => { expect(d.paymentSuccessRate).toBe(96.1); });
  it('환불률 = 0/74 = 0%', () => { expect(d.refundRate).toBe(0); });
});

describe('churnRate', () => {
  const b = { churn: { churn_numerator: 1, churn_denominator: 71 } } as RevenueBreakdown;
  it('1/71 = 1.4%', () => { expect(churnRate(b)).toBe(1.4); });
  it('분모 0 → null', () => {
    const z = { churn: { churn_numerator: 0, churn_denominator: 0 } } as RevenueBreakdown;
    expect(churnRate(z)).toBeNull();
  });
});

describe('revenueIntegrityWarnings', () => {
  it('실데이터 정상 → 경고 없음', () => {
    expect(revenueIntegrityWarnings(REAL)).toEqual([]);
  });
  it('활성구독 > 활성회원 → 경고', () => {
    expect(revenueIntegrityWarnings(kpis({ active_subscriptions: 200, active_members: 132 })).length).toBe(1);
  });
  it('환불 > 결제 → 경고', () => {
    expect(revenueIntegrityWarnings(kpis({ refund_count: 80, paid_count: 74 })).length).toBe(1);
  });
  it('MRR > ARR → 경고', () => {
    expect(revenueIntegrityWarnings(kpis({ mrr: 100, arr: 50 })).length).toBe(1);
  });
  it('플랜별 매출 합 ≠ 총매출 → 경고', () => {
    const b = {
      by_plan: [{ key: 'a', count: 1, revenue: 100 }],
      by_period: { today: 0, this_week: 0, this_month: 0, this_year: 0, total: 200 },
    } as RevenueBreakdown;
    expect(revenueIntegrityWarnings(kpis({}), b).some((w) => w.includes('플랜별'))).toBe(true);
  });
  it('플랜별 매출 합 = 총매출 → 경고 없음', () => {
    const b = {
      by_plan: [{ key: 'a', count: 1, revenue: 366600 }],
      by_period: { today: 0, this_week: 0, this_month: 0, this_year: 0, total: 366600 },
    } as RevenueBreakdown;
    expect(revenueIntegrityWarnings(REAL, b)).toEqual([]);
  });
});

describe('supportMatrix — 지원/미지원', () => {
  const m = supportMatrix({ refund: true, promotion: true, ltv: false, cac: false, chargeback: false, retention: false, tax: false, region: false, brand: false });
  it('환불/프로모션 지원', () => {
    expect(m.find((x) => x.key === 'refund')!.supported).toBe(true);
    expect(m.find((x) => x.key === 'promotion')!.supported).toBe(true);
  });
  it('LTV/CAC/Retention 미지원', () => {
    expect(m.find((x) => x.key === 'ltv')!.supported).toBe(false);
    expect(m.find((x) => x.key === 'retention')!.supported).toBe(false);
  });
});
