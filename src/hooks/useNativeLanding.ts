import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { isNativeApp } from '@/lib/native';
import { nativeLandingPath } from '@/lib/nativeLanding';
import { loadPlayerSession } from '@/lib/playerSession';
import { getRecentBrands, getBrandToken } from '@/lib/brandSession';

/**
 * 앱 실행당 한 번, 루트('/')에 있으면 역할에 맞는 화면으로 갈아탄다.
 *
 * 모듈 레벨 플래그로 "앱 실행당 한 번" 을 보장한다. 네이티브에서 앱을 다시 켜면
 * WebView 가 새로 로드되므로 플래그도 함께 초기화된다 — 즉 태블릿을 껐다 켤 때마다
 * 다시 매장 화면으로 들어간다. 반면 앱을 쓰는 도중 사용자가 직접 홈으로 이동한 경우는
 * 다시 튕겨내지 않는다.
 */
let landed = false;

/** 테스트/스토리북에서 상태를 되돌리기 위한 훅 (프로덕션 경로에서는 쓰지 않는다). */
export function resetNativeLandingForTest(): void {
  landed = false;
}

/** 이 기기에 토큰까지 살아있는 브랜드 id. 없으면 null. */
function boundBrandId(): string | null {
  try {
    for (const b of getRecentBrands()) {
      if (getBrandToken(b.id)) return b.id;
    }
  } catch {
    /* localStorage 차단 환경 — 브랜드 진입 없이 진행 */
  }
  return null;
}

export function useNativeLanding(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useAuthStore((s) => s.profile);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);
  const signedIn = useAuthStore((s) => !!s.user);

  useEffect(() => {
    if (landed) return;
    if (!isNativeApp()) return;
    // 프로필이 오기 전에 판단하면 매장 계정을 개인으로 오인한다.
    if (!isProfileReady) return;

    const target = nativeLandingPath({
      currentPath: location.pathname,
      signedIn,
      accountType: profile?.account_type ?? null,
      membershipTier: profile?.membership_tier ?? null,
      subscriptionType: profile?.subscription_type ?? null,
      boundBrandId: boundBrandId(),
      hasPlayerSession: !!loadPlayerSession(),
    });

    // 판단이 끝났으면(이동하든 안 하든) 이번 실행에서는 더 보지 않는다.
    landed = true;
    if (target) navigate(target, { replace: true });
  }, [navigate, location.pathname, profile, isProfileReady, signedIn]);
}
