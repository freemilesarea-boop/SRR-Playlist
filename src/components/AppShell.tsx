import { Outlet } from 'react-router-dom';
import BottomNav from './BottomNav';
import Player from './player/Player';

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-bg pt-safe">
      <main className="flex-1 pb-44 sm:pb-40">
        <Outlet />
      </main>
      <Player />
      <BottomNav />
    </div>
  );
}
