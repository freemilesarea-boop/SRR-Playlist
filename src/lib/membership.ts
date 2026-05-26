import type { Session } from '@supabase/supabase-js';
import type { UserRow } from '@/types/db';

export type Membership = 'anonymous' | 'free' | 'premium';

/** 결제/체험 권한 상태. 재생 게이트는 active/trial 만 허용. */
export type SubscriptionStatus = 'anonymous' | 'active' | 'trial' | 'expired' | 'free';

/** 무료 회원 미리듣기 허용 시간 (초) */
export const PREVIEW_LIMIT_SECONDS = 25;

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
