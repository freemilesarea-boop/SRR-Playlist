import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useTrackVisit } from '@/hooks/useTrackVisit';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import { lazyWithRetry, clearChunkReloadFlag } from '@/lib/lazyWithRetry';
import ConfigMissingScreen from '@/components/ConfigMissingScreen';
import Toaster from '@/components/Toaster';
import GlobalGate from '@/components/player/GlobalGate';
import Onboarding from '@/components/Onboarding';
import AppShell from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';

// 홈/로그인은 즉시 로드, 나머지는 라우트 단위로 코드 스플리팅.
// lazyWithRetry — 새 deploy 직후 옛 manifest 의 chunk 404 시 1회 자동 reload.
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
const PlaylistPage = lazyWithRetry(() => import('@/pages/PlaylistPage'));
const BusinessPage = lazyWithRetry(() => import('@/pages/BusinessPage'));
const LibraryPage = lazyWithRetry(() => import('@/pages/LibraryPage'));
const SubscriptionPage = lazyWithRetry(() => import('@/pages/SubscriptionPage'));
const AdminPage = lazyWithRetry(() => import('@/pages/AdminPage'));
const ProfilePage = lazyWithRetry(() => import('@/pages/ProfilePage'));
const ChartPage = lazyWithRetry(() => import('@/pages/ChartPage'));
const SearchPage = lazyWithRetry(() => import('@/pages/SearchPage'));
const TrackSharePage = lazyWithRetry(() => import('@/pages/TrackSharePage'));
const CuratorProfilePage = lazyWithRetry(() => import('@/pages/CuratorProfilePage'));
const PaymentSuccessPage = lazyWithRetry(() => import('@/pages/PaymentSuccessPage'));
const PaymentFailPage = lazyWithRetry(() => import('@/pages/PaymentFailPage'));
const ArtistDashboardPage = lazyWithRetry(() => import('@/pages/ArtistDashboardPage'));
const ArtistContractPage = lazyWithRetry(() => import('@/pages/ArtistContractPage'));
const ArtistSettlementsPage = lazyWithRetry(() => import('@/pages/ArtistSettlementsPage'));
const TermsPage = lazyWithRetry(() => import('@/pages/legal/TermsPage'));
const ServicePage = lazyWithRetry(() => import('@/pages/ServicePage'));
const ServicePreviewPage = lazyWithRetry(() => import('@/pages/ServicePreviewPage'));
const PrivacyPage = lazyWithRetry(() => import('@/pages/legal/PrivacyPage'));
const NoticePage = lazyWithRetry(() => import('@/pages/legal/NoticePage'));
const SupportPage = lazyWithRetry(() => import('@/pages/legal/SupportPage'));
const AuthCallbackPage = lazyWithRetry(() => import('@/pages/AuthCallbackPage'));
const AuthResetPasswordPage = lazyWithRetry(() => import('@/pages/AuthResetPasswordPage'));
const CuratorStudioPage = lazyWithRetry(() => import('@/pages/CuratorStudioPage'));
const MyPlaylistsPage = lazyWithRetry(() => import('@/pages/MyPlaylistsPage'));
const UserPlaylistDetailPage = lazyWithRetry(() => import('@/pages/UserPlaylistDetailPage'));

function RouteFallback() {
  // chunk 로드가 10초 이상 지속되면 (네트워크 hang / 캐시 꼬임) 새로고침 안내
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setStuck(true), 10_000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-ink-mute">
      <LogoMark size={40} className="animate-pulse text-accent" />
      <p>불러오는 중…</p>
      {stuck && (
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 hover:bg-accent-soft"
        >
          새로고침
        </button>
      )}
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, user, loading, signOut } = useAuthStore();
  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-ink-mute">
        <LogoMark size={44} className="animate-pulse text-accent" />
        <p>불러오는 중…</p>
      </div>
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
  // 0095 — 비활성화 계정 차단 (관리자가 disable 처리)
  if (user && profile && (profile as { disabled_at?: string | null }).disabled_at) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-bold">계정이 비활성화됐어요</p>
        <p className="text-sm text-ink-mute">
          운영자가 이 계정을 일시 비활성화했어요.<br />
          문의는 freemilesarea@gmail.com 으로 보내주세요.
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
  const authUser = useAuthStore((s) => s.user);
  const authProfile = useAuthStore((s) => s.profile);
  const authLoading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);
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
    // 페이지 정상 로드 도달 → chunk-reload flag clear (다음 chunk 실패 시 retry 가능)
    clearChunkReloadFlag();
  }, [init]);

  useWakeLock(businessMode && playing);
  useTrackVisit();

  if (!isSupabaseConfigured) {
    return <ConfigMissingScreen />;
  }

  // 로그인 사용자인데 프로필 로딩 전이면 — 탈퇴/비활성 판정 전이므로 잠깐 로더.
  // (홈/추천/플레이어가 "탈퇴회원_xxx님" 으로 잠깐 노출되는 것을 방지)
  const profilePending = !!authUser && !authProfile && authLoading;
  const isWithdrawn = !!(authUser && authProfile?.withdrawn_at);
  const isDisabled = !!(authUser && (authProfile as { disabled_at?: string | null } | null)?.disabled_at);

  return (
    <>
      <Toaster />
      {profilePending ? (
        <AccountStatusLoader />
      ) : isWithdrawn ? (
        <WithdrawnAccountScreen onSignOut={() => void signOut()} />
      ) : isDisabled ? (
        <DisabledAccountScreen onSignOut={() => void signOut()} />
      ) : (
        <>
          <GlobalGate />
          <Onboarding />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/auth/reset" element={<AuthResetPasswordPage />} />
              <Route element={<AppShell />}>
                {/* ---- 공개 (비회원 열람 가능, 재생 시 Player gate 가 로그인 유도) ---- */}
                <Route index element={<HomePage />} />
                <Route path="/charts" element={<ChartPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/playlist/:id" element={<PlaylistPage />} />
                <Route path="/track/:id" element={<TrackSharePage />} />
                <Route path="/curator/:handle" element={<CuratorProfilePage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/notice" element={<NoticePage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/service" element={<ServicePage />} />
                <Route path="/service/preview" element={<ServicePreviewPage />} />

                {/* ---- 보호 (로그인 필요) ---- */}
                <Route path="/payment/success" element={<RequireAuth><PaymentSuccessPage /></RequireAuth>} />
                <Route path="/payment/fail" element={<RequireAuth><PaymentFailPage /></RequireAuth>} />
                <Route path="/artist" element={<RequireAuth><ArtistDashboardPage /></RequireAuth>} />
                <Route path="/artist/contract" element={<RequireAuth><ArtistContractPage /></RequireAuth>} />
                <Route path="/artist/settlements" element={<RequireAuth><ArtistSettlementsPage /></RequireAuth>} />
                <Route path="/business" element={<RequireAuth><BusinessPage /></RequireAuth>} />
                <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
                <Route path="/subscription" element={<RequireAuth><SubscriptionPage /></RequireAuth>} />
                <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
                <Route path="/curator/studio" element={<RequireAuth><CuratorStudioPage /></RequireAuth>} />
                <Route path="/my/playlists" element={<RequireAuth><MyPlaylistsPage /></RequireAuth>} />
                <Route path="/my/playlist/:id" element={<UserPlaylistDetailPage />} />
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
      )}
    </>
  );
}

function AccountStatusLoader() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-ink-mute">
      <LogoMark size={44} className="animate-pulse text-accent" />
      <p>불러오는 중…</p>
    </div>
  );
}

function WithdrawnAccountScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <LogoMark size={40} className="text-accent" />
      <p className="text-lg font-bold">이 계정은 회원 탈퇴 처리되었습니다.</p>
      <p className="text-sm text-ink-mute">
        동일한 이메일로 다시 가입하실 수 있습니다.
      </p>
      <button
        onClick={onSignOut}
        className="mt-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-bg hover:opacity-90"
      >
        로그아웃 후 새로 가입하기
      </button>
    </div>
  );
}

function DisabledAccountScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-bold">계정이 비활성화됐어요</p>
      <p className="text-sm text-ink-mute">
        운영자가 이 계정을 일시 비활성화했어요.<br />
        문의는 freemilesarea@gmail.com 으로 보내주세요.
      </p>
      <button
        onClick={onSignOut}
        className="mt-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-bg hover:opacity-90"
      >
        로그아웃
      </button>
    </div>
  );
}
