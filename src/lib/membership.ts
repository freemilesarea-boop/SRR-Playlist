import type { Session } from '@supabase/supabase-js';
import type { UserRow } from '@/types/db';

export type Membership = 'anonymous' | 'free' | 'premium';

/** 무료 회원 미리듣기 허용 시간 (초) */
export const PREVIEW_LIMIT_SECONDS = 25;

/**
 * 멤버십 판정.
 * - 세션 없음 → anonymous
 * - membership_tier ∈ (individual, business) 또는 subscription_type ∈ (personal, individual, business) → premium
 * - 그 외 로그인 사용자 → free
 *
 * membership_tier 는 결제 webhook(state=64/refund)이 set 하는 단일 진실 원천.
 */
export function resolveMembership(
  session: Session | null,
  profile: UserRow | null,
): Membership {
  if (!session) return 'anonymous';
  const tier = profile?.membership_tier ?? null;
  const sub = profile?.subscription_type ?? null;
  const premiumTiers = ['individual', 'business'];
  const premiumSubs = ['personal', 'individual', 'business'];
  if ((tier && premiumTiers.includes(tier)) || (sub && premiumSubs.includes(sub))) {
    return 'premium';
  }
  return 'free';
}
