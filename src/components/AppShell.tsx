import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TrialBanner from './TrialBanner';
import InstallPromptBanner from './InstallPromptBanner';
import Player from './player/Player';
import ThemeQuickToggle from './ThemeQuickToggle';
import Footer from './common/Footer';
// FloatingSupportButton 은 App.tsx 루트에서 마운트 (createPortal → document.body)
// AppShell 내부 마운트 중단 — 어떤 컨테이너 의존성도 없도록 격리.
import {
  restorePlayerSessionToStore,
  installPlayerSessionPersistence,
  revalidateRestoredQueue,
} from '@/lib/playerSession';
import { useBrandStore } from '@/store/brandStore';
// Phase 1-3 fix — heartbeat 를 AppShell 레벨에서 mount.
// 이전: StorePlayerPage 한정 → /store/player 안 가면 heartbeat 0. BusinessPage 운영 시 미수신.
// 이후: businessMode 진입 시점부터 모든 페이지에서 heartbeat (zustand 전역 상태 기반).
import { useStoreHeartbeat } from '@/hooks/useStoreHeartbeat';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';

export default function AppShell() {
  const loadBrand = useBrandStore((s) => s.load);
  // heartbeat: business mode + storeId 양쪽 true 일 때만
  const storeId = useAuthStore((s) => s.user?.id ?? null);
  const businessMode = useBusinessStore((s) => s.businessMode);
  // DEBUG — heartbeat 게이트 가시화 (사용자 console 에서 직접 확인)
  // 운영 환경에서도 출력 (heartbeat 0 문제 추적 중)
  console.log('AppShell heartbeat', {
    businessMode,
    storeId,
    enabled: businessMode && !!storeId,
  });
  useStoreHeartbeat({ storeId, enabled: businessMode && !!storeId });
  useEffect(() => {
    // 새로고침/탭종료 후 큐+위치 복원 (자동재생은 X — 사용자 ▶ 누르면 시작)
    const restored = restorePlayerSessionToStore();
    // 복원된 큐에서 그 사이 삭제/미노출된 트랙 제거 (stale queue 방어)
    if (restored) void revalidateRestoredQueue();
    const cleanup = installPlayerSessionPersistence();
    // 브랜드 로고 URL 1회 캐시 — 업로드된 로고가 있으면 모든 BrandLogo 가 즉시 그 이미지 사용
    void loadBrand();
    return cleanup;
  }, [loadBrand]);

  return (
    <div className="flex min-h-screen flex-col bg-bg pt-safe">
      <Sidebar />

      {/* 모바일 전용 상단 우측 테마 토글 — lg+ 에서는 TopBar 안에 통합돼 숨김 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-end px-4 pt-safe pl-safe pr-safe sm:px-6 lg:hidden">
        <div className="pointer-events-auto pt-2.5">
          <ThemeQuickToggle />
        </div>
      </div>

      {/* main + footer 영역을 사이드바 우측 영역에 두고, 그 안에서 max-w 컨텐츠를 mx-auto 로 중앙 정렬 */}
      <div className="flex-1 lg:pl-60">
        <TopBar />
        <main className="mx-auto w-full max-w-[1500px]">
          <div className="px-4 pt-3 sm:px-6">
            <TrialBanner />
            <InstallPromptBanner />
          </div>
          <Outlet />
        </main>
        {/* Player + BottomNav 가 화면 하단을 fixed 로 가리므로 footer 는 충분한 padding-bottom 으로 마지막 줄 보호 */}
        <div className="pb-44">
          <Footer />
        </div>
      </div>

      <Player />
      <BottomNav />
    </div>
  );
}
