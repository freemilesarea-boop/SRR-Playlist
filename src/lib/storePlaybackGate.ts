/**
 * storePlaybackGate.ts — 매장/브랜드 플레이어의 구독 게이트 판정.
 *
 * 배경: 무료 등급 계정으로 브랜드 플레이어를 돌리면 곡당 25초만 재생되고 멈춘다
 *   (PREVIEW_LIMIT_SECONDS → pause() + 업셀 모달). 무인 매장에서 이 증상은
 *   "음악이 중간에 끊긴다" 와 구분이 안 되고, 점주도 운영자도 원인을 알 수 없다.
 *   실제로 결제가 중단된 회원이 존재한다.
 *
 * 정책: 매장 모드에서는 **미리듣기를 주지 않는다.** 재생을 시작하지 않고
 *   "구독이 만료되어 매장 재생이 중단되었습니다" 를 전체화면으로 명시한다.
 *   끊기는 음악보다 멈춘 이유를 아는 편이 매장 운영에 낫다.
 *
 * 데모 계정(DEMO_PREMIUM_ACCOUNT_IDS)은 membership 이 'premium' 으로 해석되므로
 * 이 게이트에 걸리지 않는다 — 시연용 무제한 청취는 의도된 동작이다.
 */
import type { Membership } from '@/lib/membership';

export type StoreGateDecision =
  | 'allow'                 // 재생 가능
  | 'login_required'        // 비로그인
  | 'subscription_required' // 매장 모드인데 무료 등급 → 전체화면 차단
  | 'preview';              // 일반 사용자 무료 등급 → 기존 25초 미리듣기

export interface StoreGateInput {
  membership: Membership;
  /** 매장/브랜드 플레이어 모드인가. */
  businessMode: boolean;
}

/**
 * 재생 게이트 판정.
 *
 * 매장 모드에서만 무료 등급을 전체화면 차단으로 올린다. 일반 사용자 경험은 그대로
 * (25초 미리듣기 + 업셀) — 결제 유도 흐름을 바꾸지 않는다.
 */
export function resolveStoreGate(i: StoreGateInput): StoreGateDecision {
  if (i.membership === 'anonymous') return 'login_required';
  if (i.membership === 'premium') return 'allow';
  return i.businessMode ? 'subscription_required' : 'preview';
}

/** 전체화면 차단 화면을 띄워야 하는가. */
export function isStorePlaybackBlocked(i: StoreGateInput): boolean {
  return resolveStoreGate(i) === 'subscription_required';
}
