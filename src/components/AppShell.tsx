import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TrialBanner from './TrialBanner';
import InstallPromptBanner from './InstallPromptBanner';
import Player from './player/Player';
import ThemeQuickToggle from './ThemeQuickToggle';
import Footer from './common/Footer';
// Priority 5/7 — 안내음/긴급방송 overlay 를 전역 마운트.
// 매장 BGM 이 어떤 화면에서 흐르고 있어도 예약 안내/긴급 방송 발화 보장.
// /admin · /artist · /auth/* 등은 내부 route guard 가 차단.
import GlobalStoreAudioOverlays from './store/GlobalStoreAudioOverlays';
// 27 — 복구 명령 수신기. **플레이어와 다른 failure domain 에 둔다.**
// 2026-09-15 숙대점: 플레이어 계층이 멈춘 뒤에도 이 계층은 26분 38초 동안
// 5초마다 서버와 200 OK 로 왕복하고 있었다. 그때 발행된 복구 명령이 배달되지
// 못한 이유는 수신기가 죽은 쪽에 있었기 때문이다.
import RecoveryControlPlane from './RecoveryControlPlane';
// FloatingSupportButton 은 App.tsx 루트에서 마운트 (createPortal → document.body)
// AppShell 내부 마운트 중단 — 어떤 컨테이너 의존성도 없도록 격리.
import {
  restorePlayerSessionToStore,
  installPlayerSessionPersistence,
  revalidateRestoredQueue,
} from '@/lib/playerSession';
import { useBrandStore } from '@/store/brandStore';
import { useAudioOutputAutoRestore } from '@/hooks/useAudioOutputAutoRestore';

export default function AppShell() {
  const loadBrand = useBrandStore((s) => s.load);
  /**
   * 29 — 플레이어 subtree 세대.
   *
   * 셸 워치독이 "플레이어 실행이 멎었다" 고 판정하면 이 값을 올린다. React 가
   * key 변경으로 Player 를 통째로 언마운트했다가 새로 만들어 — 오디오 엘리먼트·
   * 리스너·타이머·effect 가 전부 새로 난다. 죽은 참조가 남지 않는다.
   *
   * 페이지 재시작보다 **먼저** 쓴다. 문서가 유지되므로 Samsung Internet 의
   * 자동재생 정책을 다시 만나지 않는다 — 리로드는 제스처를 요구받을 수 있다.
   */
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const remountPlayer = useCallback(() => {
    setPlayerGeneration((g) => g + 1);
  }, []);
  // Audio Output Phase 2 — 앱 mount 시 저장된 sinkId 자동 복원 · devicechange 이벤트로 auto-reconnect.
  // 새 polling 도입 0. Player 재생 로직 무영향.
  useAudioOutputAutoRestore();
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

      <Player key={`player-${playerGeneration}`} />
      <BottomNav />
      <GlobalStoreAudioOverlays />
      {/* 오디오·큐·라우트에 의존하지 않는다. 렌더 결과도 없다(null). */}
      <RecoveryControlPlane onRemountPlayer={remountPlayer} />
    </div>
  );
}
