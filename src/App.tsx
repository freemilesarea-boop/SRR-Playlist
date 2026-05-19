import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useTrackVisit } from '@/hooks/useTrackVisit';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
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
const ChartPage = lazy(() => import('@/pages/ChartPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const TrackSharePage = lazy(() => import('@/pages/TrackSharePage'));
const CuratorProfilePage = lazy(() => import('@/pages/CuratorProfilePage'));
const PaymentSuccessPage = lazy(() => import('@/pages/PaymentSuccessPage'));
const PaymentFailPage = lazy(() => import('@/pages/PaymentFailPage'));
const ArtistDashboardPage = lazy(() => import('@/pages/ArtistDashboardPage'));
const ArtistContractPage = lazy(() => import('@/pages/ArtistContractPage'));
const ArtistSettlementsPage = lazy(() => import('@/pages/ArtistSettlementsPage'));
const TermsPage = lazy(() => import('@/pages/legal/TermsPage'));
const PrivacyPage = lazy(() => import('@/pages/legal/PrivacyPage'));
const NoticePage = lazy(() => import('@/pages/legal/NoticePage'));
const SupportPage = lazy(() => import('@/pages/legal/SupportPage'));
const AuthCallbackPage = lazy(() => import('@/pages/AuthCallbackPage'));

function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center text-ink-mute">
      불러오는 중…
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, user, loading, signOut } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-mute">불러오는 중…</div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  // 탈퇴 회원 차단 — profile 이 아직 안 로드됐으면 통과시켜 다음 렌더에서 검사
  if (user && profile && profile.withdrawn_at) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-bold">탈퇴된 계정이에요</p>
        <p className="text-sm text-ink-mute">
          이 계정은 회원 탈퇴 처리됐어요. 다시 이용하려면 새로 가입해주세요.
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-bg hover:opacity-90"
        >
          로그아웃
        </button>
      </div>
    );
  }
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
  const initTheme = useThemeStore((s) => s.init);
  const refreshTimeSlot = useThemeStore((s) => s.refreshTimeSlot);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const playing = usePlayerStore((s) => s.playing);

  const initPlayback = usePlaybackSettingsStore((s) => s.init);

  useEffect(() => {
    initTheme();
    initPlayback();
  }, [initTheme, initPlayback]);

  // 1분마다 KST 시간대 체크 (자정/06시/12시/18시/21시 경계 통과 시 자동 전환)
  useEffect(() => {
    const id = window.setInterval(refreshTimeSlot, 60_000);
    return () => window.clearInterval(id);
  }, [refreshTimeSlot]);

  useEffect(() => {
    void init();
  }, [init]);

  useWakeLock(businessMode && playing);
  useTrackVisit();

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
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="/charts" element={<ChartPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/track/:id" element={<TrackSharePage />} />
            <Route path="/curator/:handle" element={<CuratorProfilePage />} />
            <Route path="/payment/success" element={<PaymentSuccessPage />} />
            <Route path="/payment/fail" element={<PaymentFailPage />} />
            <Route path="/artist" element={<ArtistDashboardPage />} />
            <Route path="/artist/contract" element={<ArtistContractPage />} />
            <Route path="/artist/settlements" element={<ArtistSettlementsPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/notice" element={<NoticePage />} />
            <Route path="/support" element={<SupportPage />} />
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
