import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useTrackVisit } from '@/hooks/useTrackVisit';
import { usePlayerStore } from '@/store/playerStore';
import { useBusinessStore } from '@/store/businessStore';
import { useThemeStore } from '@/store/themeStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import { lazyWithRetry, clearChunkReloadFlag } from '@/lib/lazyWithRetry';
import { OPERATOR_ROUTE_PATHS } from '@/lib/operatorRouteRegistry';
import { installUnloadGuard } from '@/lib/playbackGuard';
import ConfigMissingScreen from '@/components/ConfigMissingScreen';
import Toaster from '@/components/Toaster';
import GlobalGate from '@/components/player/GlobalGate';
import Onboarding from '@/components/Onboarding';
import AppShell from '@/components/AppShell';
import FloatingSupportButton from '@/components/FloatingSupportButton';
import { LogoMark } from '@/components/Logo';

// 홈/로그인은 즉시 로드, 나머지는 라우트 단위로 코드 스플리팅.
// lazyWithRetry — 새 deploy 직후 옛 manifest 의 chunk 404 시 1회 자동 reload.
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
const PlaylistPage = lazyWithRetry(() => import('@/pages/PlaylistPage'));
const BusinessPage = lazyWithRetry(() => import('@/pages/BusinessPage'));
const LibraryPage = lazyWithRetry(() => import('@/pages/LibraryPage'));
const SubscriptionPage = lazyWithRetry(() => import('@/pages/SubscriptionPage'));
const PricingPage = lazyWithRetry(() => import('@/pages/PricingPage'));
const AdminPage = lazyWithRetry(() => import('@/pages/AdminPage'));
const ProfilePage = lazyWithRetry(() => import('@/pages/ProfilePage'));
const ChartPage = lazyWithRetry(() => import('@/pages/ChartPage'));
const SearchPage = lazyWithRetry(() => import('@/pages/SearchPage'));
const TrackSharePage = lazyWithRetry(() => import('@/pages/TrackSharePage'));
const CuratorProfilePage = lazyWithRetry(() => import('@/pages/CuratorProfilePage'));
const PaymentSuccessPage = lazyWithRetry(() => import('@/pages/PaymentSuccessPage'));
const PaymentFailPage = lazyWithRetry(() => import('@/pages/PaymentFailPage'));
const ArtistLayout = lazyWithRetry(() => import('@/components/artist/ArtistLayout'));
const ArtistDashboardPage = lazyWithRetry(() => import('@/pages/ArtistDashboardPage'));
const ArtistContractPage = lazyWithRetry(() => import('@/pages/ArtistContractPage'));
const ArtistSettlementsPage = lazyWithRetry(() => import('@/pages/ArtistSettlementsPage'));
const TermsPage = lazyWithRetry(() => import('@/pages/legal/TermsPage'));
const ServicePage = lazyWithRetry(() => import('@/pages/ServicePage'));
const ServicePreviewPage = lazyWithRetry(() => import('@/pages/ServicePreviewPage'));
const SalesPartnersPage = lazyWithRetry(() => import('@/pages/SalesPartnersPage'));
const PrivacyPage = lazyWithRetry(() => import('@/pages/legal/PrivacyPage'));
const NoticePage = lazyWithRetry(() => import('@/pages/legal/NoticePage'));
const SupportPage = lazyWithRetry(() => import('@/pages/legal/SupportPage'));
const AuthCallbackPage = lazyWithRetry(() => import('@/pages/AuthCallbackPage'));
const AuthResetPasswordPage = lazyWithRetry(() => import('@/pages/AuthResetPasswordPage'));
const CuratorStudioPage = lazyWithRetry(() => import('@/pages/CuratorStudioPage'));
const MyPlaylistsPage = lazyWithRetry(() => import('@/pages/MyPlaylistsPage'));
const UserPlaylistDetailPage = lazyWithRetry(() => import('@/pages/UserPlaylistDetailPage'));
const StorePlayerPage = lazyWithRetry(() => import('@/pages/StorePlayerPage'));
const SalespersonDashboardPage = lazyWithRetry(() => import('@/pages/SalespersonDashboardPage'));
const FranchiseHqDashboardPage = lazyWithRetry(() => import('@/pages/FranchiseHqDashboardPage'));
const EnterpriseHqMePage = lazyWithRetry(() => import('@/pages/EnterpriseHqMePage'));
const EnterprisePayPage = lazyWithRetry(() => import('@/pages/EnterprisePayPage'));
const EnterprisePaySuccessPage = lazyWithRetry(() => import('@/pages/EnterprisePaySuccessPage'));
const EnterprisePayFailPage = lazyWithRetry(() => import('@/pages/EnterprisePayFailPage'));
const EnterpriseHqOpsPage = lazyWithRetry(() => import('@/pages/EnterpriseHqOpsPage'));
const EnterpriseOpsStoresPage = lazyWithRetry(() => import('@/pages/EnterpriseOpsStoresPage'));
const EnterpriseOpsStoreDetailPage = lazyWithRetry(() => import('@/pages/EnterpriseOpsStoreDetailPage'));
const EnterpriseHqIntelPage = lazyWithRetry(() => import('@/pages/EnterpriseHqIntelPage'));
const EnterpriseHqNotificationsPage = lazyWithRetry(() => import('@/pages/EnterpriseHqNotificationsPage'));
const ExplorePlaylistsPage = lazyWithRetry(() => import('@/pages/ExplorePlaylistsPage'));
const CuratorsListPage = lazyWithRetry(() => import('@/pages/CuratorsListPage'));
const BrandPage = lazyWithRetry(() => import('@/pages/BrandPage'));
const BrandPlayerPage = lazyWithRetry(() => import('@/pages/BrandPlayerPage'));
// ADMIN-UX-IMPLEMENT-1 — 운영자 전용 셸(소비자 AppShell 과 분리). 자체 게이트로 운영자만 진입.
const OperatorLayout = lazyWithRetry(() => import('@/components/operator/OperatorLayout'));
const OperatorHomePage = lazyWithRetry(() => import('@/pages/OperatorHomePage'));
// ADMIN-UX-IMPLEMENT-2 — Canonical /ops 하위 라우트(레지스트리 기반 제네릭 페이지, 기존 패널 재사용).
const OperatorRoutePage = lazyWithRetry(() => import('@/components/operator/OperatorRoutePage'));

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
  const session = useAuthStore((s) => s.session);
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  // 세션 복원 전에는 절대 /login 으로 보내지 않고 로더 표시 (로그인 루프 방지)
  if (!isAuthReady) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-ink-mute">
        <LogoMark size={44} className="animate-pulse text-accent" />
        <p>불러오는 중…</p>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  // 탈퇴/비활성/프로필 상태는 App 전역 게이트가 라우트 렌더 전에 처리함
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const profile = useAuthStore((s) => s.profile);
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);
  if (!isAuthReady || !isProfileReady) {
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
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);
  const profileError = useAuthStore((s) => s.profileError);
  const signOut = useAuthStore((s) => s.signOut);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const initTheme = useThemeStore((s) => s.init);
  const refreshTimeSlot = useThemeStore((s) => s.refreshTimeSlot);
  const playing = usePlayerStore((s) => s.playing);
  // 매장/브랜드 플레이어 모드 — wake lock 을 재생 여부와 분리해서 유지하기 위해 필요.
  const businessMode = useBusinessStore((s) => s.businessMode);

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

  // 네이티브 앱(Capacitor) OAuth 딥링크 콜백 → 코드 교환 후 라우팅. 웹에서는 no-op.
  const navigate = useNavigate();
  useEffect(() => {
    void (async () => {
      const { initNativeAuthDeepLink } = await import('@/lib/nativeAuth');
      await initNativeAuthDeepLink((path) => navigate(path, { replace: true }));
    })();
  }, [navigate]);

  // 재생 중 창 닫기/새로고침 시 "음악 중단" 경고 (명시적 정지/로그아웃 시 제외)
  useEffect(() => installUnloadGuard(), []);

  // 화면 꺼짐 방지 — 어떤 모드든 재생 중이면 wake lock (개인/매장 공통).
  // BRAND-PLAYER-UNATTENDED-RECOVERY-1: 매장/브랜드 플레이어는 재생이 잠깐 끊겨도
  // 화면을 살려둬야 한다. playing 에만 걸어두면 오류로 멈추는 순간 wake lock 이 풀려
  // 모니터/PC 가 잠들고, 그때부터는 자동 복구 자체가 불가능해진다.
  useWakeLock(playing || businessMode);
  useTrackVisit();

  if (!isSupabaseConfigured) {
    return <ConfigMissingScreen />;
  }

  // ── 전역 라우팅 분기 (auth/profile readiness 기반) ──────────────
  // 원칙: auth 복원 전 → 로더. 세션 있음+profile 로딩 → 로더. 절대 로딩 중 /login·signOut 안 함.
  const decision: 'loading' | 'withdrawn' | 'disabled' | 'profile_error' | 'profile_missing' | 'app' =
    !isAuthReady
      ? 'loading'
      : authUser
        ? !isProfileReady
          ? 'loading'
          : authProfile?.withdrawn_at
            ? 'withdrawn'
            : (authProfile as { disabled_at?: string | null } | null)?.disabled_at
              ? 'disabled'
              : !authProfile && profileError
                ? 'profile_error'
                : !authProfile
                  ? 'profile_missing'
                  : 'app'
        : 'app'; // 비로그인: public 허용, private 은 RequireAuth 가 /login 처리

  if (import.meta.env.DEV) {
     
    console.debug('[auth-route]', {
      path: window.location.pathname,
      isAuthReady, isProfileReady,
      hasSession: !!authUser, userId: authUser?.id?.slice(0, 8) ?? null,
      hasProfile: !!authProfile,
      withdrawn: !!authProfile?.withdrawn_at,
      signupCompleted: (authProfile as { signup_completed?: boolean } | null)?.signup_completed ?? null,
      profileError,
      decision,
    });
  }

  return (
    <>
      <Toaster />
      {decision === 'loading' ? (
        <AccountStatusLoader />
      ) : decision === 'withdrawn' ? (
        <WithdrawnAccountScreen onSignOut={() => void signOut()} />
      ) : decision === 'disabled' ? (
        <DisabledAccountScreen onSignOut={() => void signOut()} />
      ) : decision === 'profile_error' ? (
        <ProfileErrorScreen
          onRetry={() => authUser && void loadProfile(authUser.id)}
          onSignOut={signOut}
        />
      ) : decision === 'profile_missing' ? (
        <ProfileBootstrapScreen
          userId={authUser?.id ?? ''}
          onReload={loadProfile}
          onSignOut={signOut}
        />
      ) : (
        <>
          <GlobalGate />
          <Onboarding />
          {/* FAB 는 createPortal 로 body 마운트 — AppShell/라우트 의존성 0 */}
          <FloatingSupportButton />
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
                <Route path="/playlists" element={<ExplorePlaylistsPage />} />
                <Route path="/track/:id" element={<TrackSharePage />} />
                <Route path="/curator/:handle" element={<CuratorProfilePage />} />
                <Route path="/curators" element={<CuratorsListPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/notice" element={<NoticePage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/service" element={<ServicePage />} />
                <Route path="/service/preview" element={<ServicePreviewPage />} />
                <Route path="/sales-partners" element={<SalesPartnersPage />} />

                {/* ---- 보호 (로그인 필요) ---- */}
                <Route path="/payment/success" element={<RequireAuth><PaymentSuccessPage /></RequireAuth>} />
                <Route path="/payment/fail" element={<RequireAuth><PaymentFailPage /></RequireAuth>} />
                {/* 아티스트 라우트는 공통 ArtistLayout 하위로 — 최상단 결제 제한 배너 항상 표시 */}
                <Route element={<RequireAuth><ArtistLayout /></RequireAuth>}>
                  <Route path="/artist" element={<ArtistDashboardPage />} />
                  <Route path="/artist/contract" element={<ArtistContractPage />} />
                  <Route path="/artist/settlements" element={<ArtistSettlementsPage />} />
                </Route>
                <Route path="/business" element={<RequireAuth><BusinessPage /></RequireAuth>} />
                <Route path="/business/player" element={<RequireAuth><StorePlayerPage /></RequireAuth>} />
                <Route path="/brand" element={<RequireAuth><BrandPage /></RequireAuth>} />
                <Route path="/brand/player/:brandId" element={<RequireAuth><BrandPlayerPage /></RequireAuth>} />
                <Route path="/library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
                <Route path="/subscription" element={<RequireAuth><SubscriptionPage /></RequireAuth>} />
                <Route path="/pricing" element={<RequireAuth><PricingPage /></RequireAuth>} />
                <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
                <Route path="/curator/studio" element={<RequireAuth><CuratorStudioPage /></RequireAuth>} />
                <Route path="/my/playlists" element={<RequireAuth><MyPlaylistsPage /></RequireAuth>} />
                <Route path="/sales" element={<RequireAuth><SalespersonDashboardPage /></RequireAuth>} />
                <Route path="/enterprise/hq" element={<RequireAuth><FranchiseHqDashboardPage /></RequireAuth>} />
                <Route path="/enterprise/me" element={<RequireAuth><EnterpriseHqMePage /></RequireAuth>} />
                <Route path="/enterprise/pay" element={<RequireAuth><EnterprisePayPage /></RequireAuth>} />
                <Route path="/enterprise/pay/success" element={<RequireAuth><EnterprisePaySuccessPage /></RequireAuth>} />
                <Route path="/enterprise/pay/fail" element={<RequireAuth><EnterprisePayFailPage /></RequireAuth>} />
                <Route path="/enterprise/ops" element={<RequireAuth><EnterpriseHqOpsPage /></RequireAuth>} />
                <Route path="/enterprise/operations/stores" element={<RequireAuth><EnterpriseOpsStoresPage /></RequireAuth>} />
                <Route path="/enterprise/operations/stores/:storeId" element={<RequireAuth><EnterpriseOpsStoreDetailPage /></RequireAuth>} />
                <Route path="/enterprise/intel" element={<RequireAuth><EnterpriseHqIntelPage /></RequireAuth>} />
                <Route path="/enterprise/notifications" element={<RequireAuth><EnterpriseHqNotificationsPage /></RequireAuth>} />
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
              {/* 운영자 셸 — AppShell 밖에 별도 마운트 (소비자 Sidebar/Player/BottomNav 없음).
                  RequireAuth 로 세션 확인 후, OperatorLayout 내부에서 운영자 여부를 게이트. */}
              <Route element={<RequireAuth><OperatorLayout /></RequireAuth>}>
                <Route path="/ops" element={<OperatorHomePage />} />
                {/* Canonical /ops 하위 라우트 — 레지스트리에서 파생, 기존 Admin 패널 재사용 */}
                {OPERATOR_ROUTE_PATHS.map((p) => (
                  <Route key={p} path={p} element={<OperatorRoutePage />} />
                ))}
                {/* 알 수 없는 /ops/* — 소비자 홈이 아니라 콘솔 안에서 안전 처리 */}
                <Route path="/ops/*" element={<OperatorRoutePage />} />
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

// 프로필 조회가 에러(네트워크 등)로 실패한 경우 — 절대 자동 signOut 하지 않고 재시도 제공.
function ProfileErrorScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => Promise<void> }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <LogoMark size={40} className="text-accent" />
      <p className="text-lg font-bold">정보를 불러오지 못했어요</p>
      <p className="text-sm text-ink-mute">네트워크 상태를 확인하고 다시 시도해주세요.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={onRetry} className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-bg hover:opacity-90">
          다시 시도
        </button>
        <button onClick={() => void onSignOut()} className="rounded-xl bg-bg-card px-4 py-2 text-sm font-semibold text-ink-mute ring-1 ring-line/15 hover:text-ink">
          로그아웃
        </button>
      </div>
    </div>
  );
}

// auth 세션은 있으나 public.users 프로필이 아직 없음 (가입 트리거 지연/초기화).
// 자동 signOut 하지 않는다 — 트리거 지연을 대비해 잠깐 재조회하고, 그래도 없으면 수동 선택 제공.
function ProfileBootstrapScreen({
  userId,
  onReload,
  onSignOut,
}: {
  userId: string;
  onReload: (uid: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [exhausted, setExhausted] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      void onReload(userId).finally(() => {
        if (!alive) return;
        if (attempts >= 3) setExhausted(true);
      });
    };
    // 트리거 지연 대비 1.2초 간격 재조회 (자동 signOut 없음)
    const id = window.setInterval(() => {
      if (attempts >= 3) {
        window.clearInterval(id);
        return;
      }
      tick();
    }, 1200);
    tick();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [userId, onReload]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <LogoMark size={40} className={exhausted ? 'text-accent' : 'animate-pulse text-accent'} />
      <p className="text-lg font-bold">계정을 준비하고 있어요</p>
      <p className="text-sm text-ink-mute">
        {exhausted
          ? '가입 정보를 불러오지 못했어요. 다시 시도하거나 로그아웃 후 다시 로그인해주세요.'
          : '잠시만 기다려주세요…'}
      </p>
      {exhausted && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => userId && void onReload(userId)}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-bg hover:opacity-90"
          >
            다시 시도
          </button>
          <button
            onClick={() => void onSignOut()}
            className="rounded-xl bg-bg-card px-4 py-2 text-sm font-semibold text-ink-mute ring-1 ring-line/15 hover:text-ink"
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
