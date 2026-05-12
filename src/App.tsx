import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import ConfigMissingScreen from '@/components/ConfigMissingScreen';
import Toaster from '@/components/Toaster';
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
  const { profile, user, loading } = useAuthStore();
  // 로딩 중 또는 프로필이 아직 안 채워졌으면 대기 (auth 후 profile 비동기)
  if (loading || (user && !profile)) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-ink-mute">
        권한 확인 중…
      </div>
    );
  }
  if (profile?.role !== 'admin') {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-ink-mute">관리자 권한이 필요해요.</p>
        <p className="text-xs text-ink-dim">
          관리자 계정 설정 방법은 README.md 의 ‘관리자 계정 설정’ 섹션을 확인하세요.
        </p>
        <Navigate to="/" replace />
      </div>
    );
  }
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

  if (!isSupabaseConfigured) {
    return <ConfigMissingScreen />;
  }

  return (
    <>
      <Toaster />
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
    </>
  );
}
