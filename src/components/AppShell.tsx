import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import Player from './player/Player';
import ThemeQuickToggle from './ThemeQuickToggle';
import Footer from './common/Footer';
import {
  restorePlayerSessionToStore,
  installPlayerSessionPersistence,
} from '@/lib/playerSession';

export default function AppShell() {
  useEffect(() => {
    // 새로고침/탭종료 후 큐+위치 복원 (자동재생은 X — 사용자 ▶ 누르면 시작)
    restorePlayerSessionToStore();
    const cleanup = installPlayerSessionPersistence();
    return cleanup;
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-bg pt-safe">
      <Sidebar />

      {/* 상단 우측 테마 토글 — lg+ 에선 사이드바 폭만큼 우측으로 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-end px-4 pt-safe sm:px-6 lg:pl-60">
        <div className="pointer-events-auto pt-2.5">
          <ThemeQuickToggle />
        </div>
      </div>

      {/* main + footer 영역을 사이드바 우측 영역에 두고, 그 안에서 max-w 컨텐츠를 mx-auto 로 중앙 정렬 */}
      <div className="flex-1 lg:pl-60">
        <main className="mx-auto w-full max-w-[1500px]">
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
