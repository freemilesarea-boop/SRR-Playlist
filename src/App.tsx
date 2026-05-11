import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import AppShell from '@/components/AppShell';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import PlaylistPage from '@/pages/PlaylistPage';
import BusinessPage from '@/pages/BusinessPage';
import LibraryPage from '@/pages/LibraryPage';
import SubscriptionPage from '@/pages/SubscriptionPage';
import AdminPage from '@/pages/AdminPage';
import ProfilePage from '@/pages/ProfilePage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">불러오는 중…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuthStore();
  if (loading) return null;
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const playing = usePlayerStore((s) => s.playing);

  useEffect(() => {
    void init();
  }, [init]);

  // 사업자 모드 && 재생 중일 때만 화면 꺼짐 방지
  useWakeLock(businessMode && playing);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/playlist/:id" element={<PlaylistPage />} />
        <Route path="/business" element={<BusinessPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/subscription" element={<SubscriptionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
