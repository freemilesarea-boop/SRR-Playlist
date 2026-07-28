import type { Session } from '@supabase/supabase-js';
import type { UserRow } from '@/types/db';

export type Membership = 'anonymous' | 'free' | 'premium';

/** 결제/체험 권한 상태. 재생 게이트는 active/trial 만 허용. */
export type SubscriptionStatus = 'anonymous' | 'active' | 'trial' | 'expired' | 'free';

/** 무료 회원 미리듣기 허용 시간 (초) */
export const PREVIEW_LIMIT_SECONDS = 25;

/**
 * DEMO-PREMIUM-WHITELIST-1 — 브랜드 시연용 데모 계정(정확히 4개)만 Premium 제한 없이 사용.
 *
 * 결제/구독 정책·webhook·Stripe/토스 로직을 전혀 바꾸지 않고,
 * 아래 지정된 auth user UUID 4개에만 한정해 시연용 premium 을 부여한다.
 * - 이메일/닉네임 유사성으로 자동 적용하지 않음 — UUID 정확 일치(===)만.
 * - 일반 사용자는 이 집합에 없으므로 기존 Premium 정책 그대로 유지.
 * - membership_tier/subscription_type 등 DB 값은 변경하지 않음(코드 전용).
 */
export const DEMO_PREMIUM_ACCOUNT_IDS: ReadonlySet<string> = new Set<string>([
  'de700001-0000-0000-0000-000000000001', // demohq (데모본사)
  'de700002-0000-0000-0000-000000000001', // demoshop1 (데모매장1)
  'de700002-0000-0000-0000-000000000002', // demoshop2 (데모매장2)
  'de700002-0000-0000-0000-000000000003', // demoshop3 (데모매장3)
]);

/** 지정된 데모 계정인지 — auth user UUID 정확 일치만. profile 없으면 false. */
export function isDemoPremiumAccount(profile: UserRow | null): boolean {
  return !!profile?.id && DEMO_PREMIUM_ACCOUNT_IDS.has(profile.id);
}

/**
 * 영업인 코드 3일 무료 체험 활성 여부 (0195).
 * free_trial_ends_at 가 서버 기준 단일 진실 원천. 클라이언트는 만료 시각만 비교.
 */
export function isTrialActive(profile: UserRow | null): boolean {
  const ends = profile?.free_trial_ends_at;
  if (!ends) return false;
  return new Date(ends).getTime() > Date.now();
}

/** 체험 잔여 시간(ms). 비활성/없음이면 0. */
export function trialRemainingMs(profile: UserRow | null): number {
  const ends = profile?.free_trial_ends_at;
  if (!ends) return 0;
  return Math.max(0, new Date(ends).getTime() - Date.now());
}

/**
 * 구독/체험 상태 판정 (서버 컬럼 기반).
 * - 세션 없음 → anonymous
 * - 유료(membership_tier/subscription_type) → active
 * - 체험 진행중 → trial
 * - 체험을 썼지만 만료 → expired
 * - 그 외 → free
 */
export function resolveSubscriptionStatus(
  session: Session | null,
  profile: UserRow | null,
): SubscriptionStatus {
  if (!session) return 'anonymous';
  // DEMO-PREMIUM-WHITELIST-1 — 지정된 데모 계정 4개만 시연용 premium(active).
  // 로그인 세션이 있는 정확 UUID 일치 계정에만 적용 → 일반 사용자/유사 계정 영향 없음.
  if (isDemoPremiumAccount(profile)) return 'active';
  const tier = profile?.membership_tier ?? null;
  const sub = profile?.subscription_type ?? null;
  const premiumTiers = ['individual', 'business'];
  const premiumSubs = ['personal', 'individual', 'business'];
  const paid = (tier && premiumTiers.includes(tier)) || (sub && premiumSubs.includes(sub));
  if (paid) return 'active';
  if (isTrialActive(profile)) return 'trial';
  if (profile?.free_trial_started_at) return 'expired';
  return 'free';
}

/**
 * 멤버십 판정 (재생 게이트용).
 * - active / trial → premium (전곡 무제한 재생)
 * - 만료/무료 → free (25초 미리듣기 + 결제 유도)
 * - 비로그인 → anonymous
 *
 * membership_tier 는 결제 webhook(state=64/refund)이 set 하는 단일 진실 원천.
 * 체험은 free_trial_ends_at(서버 set)가 진실 원천.
 */
export function resolveMembership(
  session: Session | null,
  profile: UserRow | null,
): Membership {
  const status = resolveSubscriptionStatus(session, profile);
  if (status === 'anonymous') return 'anonymous';
  if (status === 'active' || status === 'trial') return 'premium';
  return 'free';
}
