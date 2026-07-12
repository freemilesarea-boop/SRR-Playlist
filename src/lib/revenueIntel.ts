/**
 * revenueIntel — Revenue Intelligence 순수 로직 (KRW/성장률/ARPU/ARPPU/Churn/정합성).
 *
 * DB(0474 RPC)는 raw 값만 반환하고, 여기서 파생 비율·성장률·정합성 검증을
 * 계산한다(단위 테스트 대상). 비율 NaN/Infinity 금지, 성장률은 0472 growth 와
 * 동일하게 "지난달 0" 상태를 mom_status 로 표현한다.
 */
import type { RevenueKpis, RevenueBreakdown } from './adminApi';

/** ₩ 포맷 (정수 원). */
export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '₩0';
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

/** 축약 ₩ 포맷 (1.2만 / 3.4천만). 차트 축/큰 숫자용. */
export function formatKRWShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '₩0';
  const v = Math.round(n);
  if (Math.abs(v) >= 100_000_000) return `₩${(v / 100_000_000).toFixed(1)}억`;
  if (Math.abs(v) >= 10_000) return `₩${(v / 10_000).toFixed(1)}만`;
  return `₩${v.toLocaleString('ko-KR')}`;
}

/** 퍼센트 (소수 1자리, NaN/Infinity 금지). */
export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export type MomStatus = 'normal' | 'new_growth' | 'flat';

export interface GrowthResult {
  rate: number | null;     // 지난달>0 일 때만 숫자
  status: MomStatus;
  text: string;            // 표시용 (+45.4% / 신규 성장 / 0.0%)
  tone: 'success' | 'danger' | 'neutral';
}

/** MoM 성장률 — 지난달 0 이면 Infinity/NaN 없이 상태로 표현. */
export function growth(thisVal: number, prevVal: number): GrowthResult {
  if (prevVal > 0) {
    const rate = Math.round(((thisVal - prevVal) / prevVal) * 1000) / 10;
    const sign = rate > 0 ? '+' : '';
    return {
      rate, status: 'normal', text: `${sign}${rate.toFixed(1)}%`,
      tone: rate > 0 ? 'success' : rate < 0 ? 'danger' : 'neutral',
    };
  }
  if (thisVal > 0) return { rate: null, status: 'new_growth', text: '신규 성장', tone: 'success' };
  return { rate: null, status: 'flat', text: '0.0%', tone: 'neutral' };
}

/** 안전 나눗셈 비율(%) 0~상한 없이 유한수만. 분모 0 → null. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  const r = (numerator / denominator) * 100;
  return Number.isFinite(r) ? Math.round(r * 10) / 10 : null;
}

/** 안전 나눗셈(원 단위, 반올림). 분모 0 → 0. */
export function perCapita(total: number, count: number): number {
  if (!count || count <= 0) return 0;
  const v = total / count;
  return Number.isFinite(v) ? Math.round(v) : 0;
}

export interface DerivedRevenueKpis {
  revenueGrowth: GrowthResult;
  subscriptionGrowth: GrowthResult;
  arpu: number;              // 총매출 / 활성 회원
  arppu: number;             // 총매출 / 결제 회원
  paymentSuccessRate: number | null;   // paid / (paid+failed)
  refundRate: number | null;           // 환불 / paid
  churnPreviewRate: number | null;     // 종료예정 / 활성구독 (참고)
}

export function deriveRevenueKpis(k: RevenueKpis): DerivedRevenueKpis {
  return {
    revenueGrowth: growth(k.revenue_growth_this, k.revenue_growth_prev),
    subscriptionGrowth: growth(k.subs_this_month, k.subs_last_month),
    arpu: perCapita(k.arpu, k.active_members),
    arppu: perCapita(k.arppu_numerator, k.paying_users),
    paymentSuccessRate: ratio(k.paid_count, k.paid_count + k.failed_payments),
    refundRate: ratio(k.refund_count, k.paid_count),
    churnPreviewRate: ratio(k.ending_subscriptions, k.active_subscriptions),
  };
}

/** Churn rate = 취소 / (활성+취소). 분모 0 → null. */
export function churnRate(b: RevenueBreakdown): number | null {
  return ratio(b.churn.churn_numerator, b.churn.churn_denominator);
}

/**
 * 데이터 정합성 검증 (비차단). 반환된 경고 문자열 목록.
 *  - 활성구독 ≤ 총(활성)회원
 *  - 환불 ≤ 결제(paid)
 *  - MRR ≤ ARR
 *  - 플랜별 매출 합 = 총매출(by_period.total)
 */
export function revenueIntegrityWarnings(k: RevenueKpis, b?: RevenueBreakdown): string[] {
  const w: string[] = [];
  if (k.active_subscriptions > k.active_members) {
    w.push(`활성 구독 ${k.active_subscriptions} > 활성 회원 ${k.active_members}`);
  }
  if (k.refund_count > k.paid_count) {
    w.push(`환불 ${k.refund_count} > 결제 ${k.paid_count}`);
  }
  if (k.mrr > k.arr) {
    w.push(`MRR ${k.mrr} > ARR ${k.arr}`);
  }
  if (b) {
    const planSum = b.by_plan.reduce((s, r) => s + r.revenue, 0);
    if (planSum !== b.by_period.total) {
      w.push(`플랜별 매출 합 ${planSum} ≠ 총매출 ${b.by_period.total}`);
    }
  }
  return w;
}

/** 지원 여부 매트릭스 → 라벨/지원 리스트. */
export const SUPPORT_LABELS: Record<string, string> = {
  refund: '환불(Refund)', promotion: '프로모션/쿠폰', ltv: 'LTV', cac: 'CAC',
  chargeback: '차지백(Chargeback)', retention: '리텐션(Retention)', tax: '세금(Tax)',
  region: '지역별 매출', brand: '브랜드별 매출',
};

export function supportMatrix(support: Record<string, boolean>): Array<{ key: string; label: string; supported: boolean }> {
  return Object.keys(SUPPORT_LABELS).map((key) => ({
    key, label: SUPPORT_LABELS[key], supported: support[key] === true,
  }));
}
