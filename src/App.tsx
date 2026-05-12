import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import ConfigMissingScreen from '@/components/ConfigMissingScreen';
import Toaster from '@/components/Toaster';
import Onboarding from '@/components/Onboarding';
import AppShell from '@/components/AppShell';

// 홈/로그인은 즉시 로드, 나머지는 라우트 단위로 코드 스플리팅
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
const PlaylistPage = lazy(() => import('@/pages/PlaylistPage'));
const BusinessPage = lazy(() => import('@/pages/BusinessPage'));
const LibraryPage = lazy(() => import('@/pages/LibraryPage'));
const SubscriptionPage = lazy(() => import('@/pages/SubscriptionPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center text-ink-mute">
      불러오는 중…
    </div>
  );
}

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

  useWakeLock(businessMode && playing);

  if (!isSupabaseConfigured) {
    return <ConfigMissingScreen />;
  }

  return (
    <>
      <Toaster />
      <Onboarding />
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </>
  );
}
