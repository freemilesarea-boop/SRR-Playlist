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

      {/* 상단 우측 테마 토글 (앱 폭에 정렬, lg+ 에선 사이드바 폭만큼 우측으로) */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-end px-4 pt-safe sm:px-6 lg:pl-60">
        <div className="pointer-events-auto pt-2.5">
          <ThemeQuickToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 lg:ml-60 lg:mr-0">
        <Outlet />
      </main>
      {/* 풀폭 Footer — main 밖에 두어 max-w-5xl 제약 받지 않음.
          Player + BottomNav 가 화면 하단을 fixed 로 가리므로 footer 는 충분한
          padding-bottom 으로 마지막 줄이 가려지지 않게. lg+ 에선 사이드바 영역 만큼 left padding. */}
      <div className="pb-44 lg:pl-60">
        <Footer />
      </div>
      <Player />
      <BottomNav />
    </div>
  );
}
