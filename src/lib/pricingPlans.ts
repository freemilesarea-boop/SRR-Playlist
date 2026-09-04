/**
 * pricingPlans.ts — 요금제 화면(좌측 네비 "요금제")의 순수 헬퍼.
 *
 * 요금제는 딱 3가지다.
 *   1. store            — 매장 가입 (기존 business 플랜 월 정기결제)
 *   2. enterprise_hq    — 엔터프라이즈 본사 (사업자 인증 → 본사 계정 생성 → 본사 코드 발급)
 *   3. enterprise_store — 엔터프라이즈 가맹 (본사 코드로만 가입 → 매장 연결 → 정기결제)
 *
 * 화면 분기 판정은 전부 여기서 하고 컴포넌트는 결과만 그린다(단위 테스트 대상).
 * 서버 RPC: get_my_pricing_context()
 */

export type PricingCategory = 'store' | 'enterprise_hq' | 'enterprise_store';

export const PRICING_CATEGORY_LABEL: Record<PricingCategory, string> = {
  store: '매장 가입',
  enterprise_hq: '엔터프라이즈 본사',
  enterprise_store: '엔터프라이즈 가맹',
};

export interface PricingSubscription {
  plan_type: string;
  status: string;
  price: number | null;
  current_period_end: string | null;
  cancel_requested_at: string | null;
}

export interface PricingHq {
  enterprise_account_id: string;
  enterprise_name: string;
  status: 'active' | 'invited' | 'suspended' | 'inactive';
  join_code: string | null;
  billing_mode: 'per_store' | 'hq_consolidated';
  billing_enabled: boolean;
  store_monthly_price: number | null;
  hq_monthly_price: number | null;
}

export interface PricingStoreLink {
  store_name: string;
  enterprise_name: string;
}

export interface PricingBusinessVerification {
  verification_status: 'pending' | 'verified' | 'rejected' | 'manual_review' | string;
  business_verified: boolean;
  business_number: string | null;
  business_name: string | null;
}

export interface PricingEnterprisePayment {
  should_pay: boolean;
  already_active?: boolean;
  payer_type?: 'hq' | 'store';
  amount?: number;
  enterprise_name?: string;
}

export interface PricingContext {
  signed_in: boolean;
  account_type?: 'individual' | 'business' | 'artist' | string;
  membership_tier?: 'free' | 'individual' | 'business' | string;
  store_monthly_price?: number;
  subscription?: PricingSubscription | null;
  hq?: PricingHq | null;
  store?: PricingStoreLink | null;
  business_verification?: PricingBusinessVerification | null;
  enterprise_payment?: PricingEnterprisePayment | null;
}

/* ────────────────────────────── 1. 매장 가입 ────────────────────────────── */

export type StoreCardState =
  | 'active'      // 이미 매장 요금제 이용 중
  | 'upgrade'     // 일반 요금제 이용 중 → 매장으로 전환
  | 'available';  // 결제 가능

export function storeCardState(ctx: PricingContext | null): StoreCardState {
  const sub = ctx?.subscription ?? null;
  if (sub && sub.plan_type === 'business') return 'active';
  if (ctx?.membership_tier === 'business') return 'active';
  if (sub || ctx?.membership_tier === 'individual') return 'upgrade';
  return 'available';
}

/** 매장 월 요금 — 서버가 내려준 값만 신뢰. 미도착 시 표시용 기본값. */
export function storeMonthlyPrice(ctx: PricingContext | null): number {
  const p = ctx?.store_monthly_price;
  return typeof p === 'number' && p > 0 ? p : 6900;
}

/**
 * 이미 엔터프라이즈(본사/가맹)에 속한 회원에게는 단독 매장 결제를 권하지 않는다.
 * 요금이 이중으로 나가는 상황을 만들지 않기 위함 — 안내만 하고 결제 버튼은 감춘다.
 */
export function storeCheckoutBlockedReason(ctx: PricingContext | null): string | null {
  if (!ctx?.signed_in) return null;
  if (ctx.store) return `${ctx.store.enterprise_name} 가맹점으로 등록돼 있어요. 엔터프라이즈 가맹 요금이 적용됩니다.`;
  if (ctx.hq) return '엔터프라이즈 본사 계정이에요. 본사/가맹 요금제가 적용됩니다.';
  return null;
}

/* ────────────────────────── 2. 엔터프라이즈 본사 ────────────────────────── */

export type HqCardState =
  | 'none'        // 신청 전 → 사업자 인증 + 신청 폼
  | 'pending'     // 신청 완료, 관리자 승인 대기 (코드는 이미 발급됨)
  | 'active'      // 승인 완료
  | 'blocked';    // suspended / inactive

export function hqCardState(ctx: PricingContext | null): HqCardState {
  const hq = ctx?.hq;
  if (!hq) return 'none';
  if (hq.status === 'active') return 'active';
  if (hq.status === 'invited') return 'pending';
  return 'blocked';
}

/** 본사 일괄청구를 골랐는데 아직 관리자가 월요금을 확정하지 않은 상태인가. */
export function hqAwaitingPriceSetup(ctx: PricingContext | null): boolean {
  const hq = ctx?.hq;
  if (!hq) return false;
  return hq.billing_mode === 'hq_consolidated' && !hq.billing_enabled;
}

/** 본사 본인이 지금 결제해야 하는가 (/enterprise/pay). */
export function hqCanPayNow(ctx: PricingContext | null): boolean {
  const ep = ctx?.enterprise_payment;
  return !!ep?.should_pay && ep.payer_type === 'hq';
}

/** 본사 신청 폼을 열 수 있는 계정인가. 아티스트 계정은 별도 흐름이라 제외. */
export function canApplyHq(ctx: PricingContext | null): boolean {
  if (!ctx?.signed_in) return false;
  if (ctx.account_type === 'artist') return false;
  return !ctx.hq && !ctx.store;
}

export interface HqApplyForm {
  enterpriseName: string;
  businessNumber: string;
  businessName: string;
  representativeName: string;
  businessOpenDate: string;   // YYYY-MM-DD
  businessAddress: string;
  managerName: string;
  managerPhone: string;
  billingMode: 'per_store' | 'hq_consolidated';
}

/** 신청 폼 검증 — 서버가 다시 검증하지만, 왕복 전에 사용자에게 알려준다. */
export function validateHqApplyForm(f: HqApplyForm): string[] {
  const errors: string[] = [];
  if (!f.enterpriseName.trim()) errors.push('본사(브랜드)명을 입력해주세요.');
  if (!isBusinessNumberChecksumValid(f.businessNumber)) errors.push('사업자등록번호를 정확히 입력해주세요.');
  if (!f.representativeName.trim()) errors.push('대표자명을 입력해주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.businessOpenDate)) errors.push('개업일자를 선택해주세요.');
  if (!f.managerName.trim()) errors.push('담당자명을 입력해주세요.');
  if (f.managerPhone.replace(/\D/g, '').length < 9) errors.push('담당자 연락처를 정확히 입력해주세요.');
  if (f.billingMode !== 'per_store' && f.billingMode !== 'hq_consolidated') errors.push('청구 방식을 선택해주세요.');
  return errors;
}

/**
 * 사업자등록번호 체크섬(KS X 1003).
 * 서버(_kr_business_number_valid) / 엣지함수와 동일 알고리즘 — 세 곳이 같아야 한다.
 */
export function isBusinessNumberChecksumValid(input: string): boolean {
  const d = (input ?? '').replace(/\D/g, '');
  if (d.length !== 10) return false;
  if (/^0+$/.test(d)) return false;   // 000-00-00000 은 체크섬을 통과해버린다
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

/** 사업자 인증이 신청 가능한 상태까지 갔는가 (서버 RPC 가 요구하는 조건과 동일). */
export function isBusinessVerificationUsable(v: PricingBusinessVerification | null | undefined): boolean {
  if (!v) return false;
  return v.verification_status === 'verified' || v.verification_status === 'manual_review';
}

/* ────────────────────────── 3. 엔터프라이즈 가맹 ────────────────────────── */

export type FranchiseCardState =
  | 'none'        // 본사 코드 입력 전
  | 'joined'      // 매장 연결 완료
  | 'blocked';    // 아티스트 계정 등 가입 불가

export function franchiseCardState(ctx: PricingContext | null): FranchiseCardState {
  if (ctx?.account_type === 'artist') return 'blocked';
  if (ctx?.store) return 'joined';
  return 'none';
}

/** 가맹점 본인이 지금 결제해야 하는가 (/enterprise/pay). */
export function franchiseCanPayNow(ctx: PricingContext | null): boolean {
  const ep = ctx?.enterprise_payment;
  return !!ep?.should_pay && ep.payer_type === 'store';
}

export function franchiseAlreadyPaying(ctx: PricingContext | null): boolean {
  const ep = ctx?.enterprise_payment;
  return !!ep?.already_active;
}

/**
 * 가맹 연결은 됐는데 결제 대상이 아닌 경우의 안내 문구.
 * (본사 일괄청구 = 매장은 결제하지 않음 / 요금 미설정 = 관리자 확정 대기)
 */
export function franchisePaymentNotice(ctx: PricingContext | null): string | null {
  if (!ctx?.store) return null;
  if (franchiseAlreadyPaying(ctx)) return '정기결제가 등록돼 있어요. 매월 자동으로 청구됩니다.';
  if (franchiseCanPayNow(ctx)) return null;
  return '본사에서 요금을 일괄 부담하거나, 아직 요금이 확정되지 않은 상태예요. 별도 결제는 필요하지 않습니다.';
}

/** 본사 코드 정규화 — 대소문자·공백 무시가 서버 기준. */
export function normalizeJoinCode(input: string): string {
  return (input ?? '').trim().toUpperCase();
}
