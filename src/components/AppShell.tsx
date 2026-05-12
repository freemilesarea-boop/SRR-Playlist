import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';
import Player from './player/Player';
import ThemeQuickToggle from './ThemeQuickToggle';

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg pt-safe">
      {/* 상단 우측 테마 토글 (앱 폭에 정렬) */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 mx-auto flex max-w-5xl justify-end px-4 pt-safe sm:px-6">
        <div className="pointer-events-auto pt-2.5">
          <ThemeQuickToggle />
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 pb-44 sm:pb-44">
        <Outlet />
      </main>
      <Player />
      <BottomNav />
    </div>
  );
}
