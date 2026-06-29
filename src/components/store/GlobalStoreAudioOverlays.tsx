/**
 * GlobalStoreAudioOverlays — AnnouncementOverlay + EmergencyBroadcastOverlay
 * 의 전역 마운트 어댑터.
 *
 * 배경:
 *   기존에는 StorePlayerPage (/business/player) 에서만 두 overlay 가 mount 됐고,
 *   /business, /enterprise/me, / 등 BGM 이 재생 중인 다른 화면에서는 예약
 *   안내음 / 긴급 방송이 발화하지 않았음.
 *   AppShell 의 <Player /> 는 전역이지만 overlay 가 페이지 한정이라
 *   "예약은 등록됐는데 실제 매장에서 음원이 안 나옴" 증상으로 보고됨.
 *
 * 정책:
 *   - 로그인된 사용자 + 매장 후보 (business plan 또는 매장 모드 활성) 에게만 mount
 *   - /admin, /artist, /auth/* 등 관리/작가 화면에서는 자동 발화 금지
 *   - storeId 가 null 이면 overlay 내부에서 자동 no-op (기존 동작 그대로)
 *   - 추가: 진입/언마운트 console.info 항상 출력 (debug flag 무관) — 운영 진단 즉시 가능
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import AnnouncementOverlay from './AnnouncementOverlay';
import EmergencyBroadcastOverlay from './EmergencyBroadcastOverlay';

// 자동 발화 금지 라우트 — admin/artist/auth/onboarding.
// 매장 음악이 흐르는 화면 (/business, /enterprise/*, /, /library, /playlists, /search 등) 은 허용.
const BLOCKED_PATH_PREFIXES = [
  '/admin',
  '/artist',
  '/curator',
  '/sales',
  '/sales-partners',
  '/auth',
  '/login',
  '/payment',
];

function isBlockedPath(pathname: string): boolean {
  return BLOCKED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function GlobalStoreAudioOverlays() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const location = useLocation();

  // 매장 후보 판정 — business 가입자(account_type/subscription_type) 또는 매장 모드 진입자.
  // 본사(enterprise) 계정은 store_id 매핑이 다른 RPC 체계라 overlay 내부에서 forbidden 응답 → no-op.
  // 관리자(role=admin) 는 별도 화면에서 BGM 들을 수 있으나, 자동 발화는 admin route guard 로 차단.
  const isStoreCandidate = !!userId && (
    profile?.account_type === 'business' ||
    profile?.subscription_type === 'business' ||
    profile?.membership_tier === 'business' ||
    businessMode
  );

  const blockedByRoute = isBlockedPath(location.pathname);
  const shouldMount = !!userId && isStoreCandidate && !blockedByRoute;

  // 진입 / 언마운트 로그 — 운영에서 "예약이 왜 안 도는지" 즉시 판단
  useEffect(() => {
    // console.warn — vite.config 가 production 빌드에서 console.info 를 purge 하므로 warn 사용
    console.warn('[announcement-overlay] mount-decision', {
      path: location.pathname,
      user_id: userId ? `${userId.slice(0, 8)}…` : null,
      profile_role: profile?.role ?? null,
      profile_account_type: (profile as { account_type?: string } | null)?.account_type ?? null,
      business_mode: businessMode,
      is_store_candidate: isStoreCandidate,
      blocked_by_route: blockedByRoute,
      should_mount: shouldMount,
    });
  }, [location.pathname, userId, profile?.role, profile, businessMode, isStoreCandidate, blockedByRoute, shouldMount]);

  if (!shouldMount) return null;

  // storeId = auth.uid() — 매장은 자기 자신 user.id 가 store_id (X6.84 규약 유지).
  // 본사/관리자 등은 위 isStoreCandidate 에서 false 처리되어 여기 도달 X.
  return (
    <>
      <AnnouncementOverlay storeId={userId} />
      <EmergencyBroadcastOverlay storeId={userId} />
    </>
  );
}
