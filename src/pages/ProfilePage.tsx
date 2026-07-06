import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CreditCard,
  Settings,
  LogOut,
  ChevronRight,
  Shield,
  Store,
  Sun,
  Moon,
  Monitor,
  Clock,
  Mic2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserX,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { requestWithdrawal } from '@/lib/subscriptionApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { verifyIdentityNow } from '@/lib/identityVerification';
import Alert from '@/components/Alert';
import CuratorProfileEditor from '@/components/CuratorProfileEditor';
import SupportInquiryButton from '@/components/SupportInquiryButton';
import MyInquiriesSection from '@/components/MyInquiriesSection';
import KakaoChannelButtons from '@/components/KakaoChannelButtons';
import { isKakaoChannelConfigured } from '@/lib/kakao';
import { useThemeStore } from '@/store/themeStore';
import {
  fetchMyArtistProfile,
  fetchArtistUploadEligibility,
  fetchMyPayoutAccountMasked,
  type ArtistProfile,
  type UploadEligibility,
  type PayoutAccountMasked,
} from '@/lib/artistApi';
import ArtistApplyModal from '@/components/artist/ArtistApplyModal';
import PushNotificationToggle from '@/components/PushNotificationToggle';
import EnterpriseHqProfileCard from '@/components/profile/EnterpriseHqProfileCard';
import EnterpriseStoreInfoCard from '@/components/profile/EnterpriseStoreInfoCard';
import AudioOutputSection from '@/components/settings/AudioOutputSection';
import { useEnterpriseSelfRole } from '@/hooks/useEnterpriseSelfRole';
import {
  usePlaybackSettingsStore,
  CROSSFADE_OPTIONS,
  type CrossfadeSeconds,
} from '@/store/playbackSettingsStore';
import { getTimeSlotLabel, type ThemeMode } from '@/lib/timeTheme';

export default function ProfilePage() {
  const { profile, user, signOut, refreshProfile } = useAuthStore();
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [isAgent, setIsAgent] = useState(false);
  const [payoutVerified, setPayoutVerified] = useState<boolean | null>(null);
  const [verifyingIdentity, setVerifyingIdentity] = useState(false);
  const location = useLocation();

  // Phase 1-7 — enterprise HQ / 매장 역할 판별 (RPC 1회 호출).
  // RPC 실패 / 미적용 환경은 모두 false fallback → 기존 흐름 회귀 0.
  const enterpriseRole = useEnterpriseSelfRole(user?.id ?? null);

  // /profile#identity-verification 진입 시 해당 섹션으로 자동 스크롤
  useLayoutEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    // mount 직후 DOM 갱신 대기 — requestAnimationFrame 2번
    let raf1 = 0; let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [location.hash]);

  useEffect(() => {
    let alive = true;
    import('@/lib/salespersonApi')
      .then((m) => m.fetchMySalespersonProfile())
      .then((s) => { if (alive) setIsAgent(!!s.is_salesperson); })
      .catch(() => { /* 비영업인 — 무시 */ });
    return () => { alive = false; };
  }, []);

  // 긴급 hotfix — profile 캐시 stale 로 인해 identity_verified=true 로 이미 갱신된 사용자에게도
  // "본인인증 요청" 카드가 계속 노출되는 문제 (사용자 로그아웃-재로그인 없이는 반영 안 됨).
  // ProfilePage mount + 창 포커스 복귀 시 users row 를 다시 읽어 캐시를 최신화한다.
  // refreshProfile 은 사일런트 (실패해도 기존 profile 유지) 라 UX 회귀 없음.
  useEffect(() => {
    void refreshProfile();
    const onFocus = () => { void refreshProfile(); };
    const onVis = () => { if (document.visibilityState === 'visible') void refreshProfile(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshProfile]);

  /**
   * HF3 — 본인인증 CTA 핸들러.
   * 기존 코드는 CTA 를 SupportInquiryButton 으로 연결해 "문의 모달" 이 열리는 버그가 있었음.
   * MVP mock (verifyIdentityNow) 로 검증 → users.update → refreshProfile 순으로 정상화.
   * 정식 NICE/KCB/토스 연동 전까지 IndividualSignupForm/ArtistSignupForm 과 동일 흐름.
   */
  async function handleVerifyIdentity() {
    if (!user?.id) {
      toast.error('로그인 정보를 확인할 수 없어요.');
      return;
    }
    setVerifyingIdentity(true);
    try {
      const res = await verifyIdentityNow({
        name: profile?.nickname ?? undefined,
      });
      if (!res.ok) {
        toast.error('본인인증에 실패했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      const { error } = await supabase
        .from('users')
        .update({
          identity_verified: true,
          identity_provider: res.provider ?? null,
          identity_verified_at: res.verified_at ?? new Date().toISOString(),
          identity_ci: res.ci ?? null,
          identity_di: res.di ?? null,
        })
        .eq('id', user.id);
      if (error) {

        console.error('[identity] users.update failed:', error);
        toast.error('본인인증 정보 저장에 실패했어요.');
        return;
      }
      toast.success('본인인증이 완료됐어요.');
      await refreshProfile();
    } catch (e) {
      toast.error(friendlyError(e, '본인인증 실패'));
    } finally {
      setVerifyingIdentity(false);
    }
  }

  // 아티스트가 아닌 사용자는 payout API 가 데이터 없이 정상 응답 → payoutVerified=false 로 안전 fallback.
  // 이 값은 IdentityVerificationSection 의 3-state 분기 (미완료 / 정산정보만 남음 / 준비 완료) 에 쓰인다.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    fetchMyPayoutAccountMasked()
      .then((masked: PayoutAccountMasked | null) => {
        if (!alive) return;
        setPayoutVerified(masked?.verification_status === 'verified');
      })
      .catch(() => { if (alive) setPayoutVerified(null); });
    return () => { alive = false; };
  }, [user?.id]);

  async function handleConfirmWithdraw() {
    setWithdrawing(true);
    try {
      const res = await requestWithdrawal();
      if (!res.ok) {
        toast.error(res.error ?? '탈퇴 요청 실패');
        return;
      }
      toast.success('회원 탈퇴 처리됐어요.');
      setWithdrawModalOpen(false);
      await signOut();
    } catch (e) {
      toast.error(friendlyError(e, '탈퇴 요청 실패'));
    } finally {
      setWithdrawing(false);
    }
  }
  const { mode, resolvedMode, timeSlot, setMode } = useThemeStore();
  const crossfadeSeconds = usePlaybackSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfadeSeconds = usePlaybackSettingsStore((s) => s.setCrossfadeSeconds);
  const autoplayRecommendations = usePlaybackSettingsStore((s) => s.autoplayRecommendations);
  const setAutoplayRecommendations = usePlaybackSettingsStore((s) => s.setAutoplayRecommendations);

  // 단일 진실 원천: users.membership_tier (webhook 이 set). subscription_type 은 호환용.
  const tier = profile?.membership_tier ?? profile?.subscription_type ?? 'free';
  const planLabel =
    tier === 'business'
      ? '사업자 플랜'
      : tier === 'individual' || tier === 'personal'
        ? '일반 플랜'
        : '무료 플랜';

  const themeOptions: Array<{ key: ThemeMode; label: string; icon: React.ReactNode }> = [
    { key: 'system', label: '시스템', icon: <Monitor size={14} /> },
    { key: 'light', label: '라이트', icon: <Sun size={14} /> },
    { key: 'dark', label: '다크', icon: <Moon size={14} /> },
  ];

  return (
    <div className="space-y-8 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-2xl font-bold text-bg">
          {(profile?.nickname ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{profile?.nickname ?? '이름없음'}</h1>
          <p className="truncate text-xs text-ink-mute">{user?.email}</p>
          <p className="mt-1 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
            {planLabel}
          </p>
        </div>
        <div className="ml-auto">
          <SupportInquiryButton variant="chip" defaultType="기타" />
        </div>
      </header>

      <MyInquiriesSection />

      {/* Phase 1-8 hotfix — Enterprise HQ / 매장 카드를 상단으로 이동.
          본인인증 섹션은 enterprise 사용자에게는 부적절 (본사 settlement 별도 흐름) → 아래에서 gate. */}
      {!enterpriseRole.loading && enterpriseRole.role.is_hq && (
        <EnterpriseHqProfileCard role={enterpriseRole.role} />
      )}
      {!enterpriseRole.loading
        && !enterpriseRole.role.is_hq
        && enterpriseRole.storeInfo.is_store && (
        <EnterpriseStoreInfoCard info={enterpriseRole.storeInfo} />
      )}

      {/* X6.18 — 본인인증 섹션 (정산 보류 카드의 본인인증 CTA scroll target)
          Phase 1-8 hotfix — HQ / 매장 사용자는 별도 settlement 흐름 사용 → 숨김.
          enterpriseRole.loading 동안에도 깜빡임 방지 위해 false fallback (기존 동작 유지). */}
      {(enterpriseRole.loading
        || (!enterpriseRole.role.is_hq && !enterpriseRole.storeInfo.is_store)) && (
        <IdentityVerificationSection
          identityVerified={profile?.identity_verified === true}
          payoutVerified={payoutVerified}
          verifying={verifyingIdentity}
          onVerify={handleVerifyIdentity}
        />
      )}

      {/* 고객센터 — 카톡 채널 + 문의하기 (env 미설정 시 문의 버튼만 노출) */}
      <section className="space-y-2">
        <div className="px-1">
          <h2 className="text-sm font-bold tracking-tight">고객센터</h2>
          <p className="text-[11px] text-ink-mute">
            {isKakaoChannelConfigured() ? '@듣다 카카오톡 채널 — 빠른 답변' : '문의 폼으로 답변드립니다'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
          {isKakaoChannelConfigured() && <KakaoChannelButtons variant="row" />}
          <SupportInquiryButton variant="nav" label="문의 남기기" defaultType="기타" />
        </div>
      </section>

      {/* 테마 설정 */}
      <section className="space-y-2">
        <div className="flex items-end justify-between px-1">
          <h2 className="text-sm font-bold tracking-tight">화면 모드</h2>
          <p className="flex items-center gap-1 text-[11px] text-ink-mute">
            <Clock size={11} /> KST {getTimeSlotLabel(timeSlot)} ·
            <span className="text-ink">{resolvedMode === 'dark' ? '다크' : '라이트'}</span>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-bg-card p-1.5 ring-1 ring-line/10">
          {themeOptions.map((opt) => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                className={`flex flex-col items-center gap-1 rounded-xl px-3 py-3 text-xs font-semibold transition ${
                  active
                    ? 'bg-accent text-bg shadow'
                    : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
        <p className="px-1 text-[11px] text-ink-dim">
          시간대가 바뀌면 같은 모드 안에서 컬러가 자연스럽게 변해요.
        </p>
      </section>

      {/* 재생 설정 */}
      <section className="space-y-2">
        <div className="flex items-end justify-between px-1">
          <h2 className="text-sm font-bold tracking-tight">재생 설정</h2>
          <p className="text-[11px] text-ink-mute">크로스페이드</p>
        </div>
        <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
          <div className="grid grid-cols-5 gap-1.5">
            {CROSSFADE_OPTIONS.map((s) => {
              const active = crossfadeSeconds === s;
              return (
                <button
                  key={s}
                  onClick={() => setCrossfadeSeconds(s as CrossfadeSeconds)}
                  className={`rounded-xl py-2 text-xs font-semibold transition ${
                    active
                      ? 'bg-accent text-bg shadow'
                      : 'bg-bg-soft text-ink-mute hover:text-ink'
                  }`}
                >
                  {s === 0 ? '끄기' : `${s}초`}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-ink-mute">
            곡 사이를 자연스럽게 이어줍니다. 매장 모드에서는 5초 크로스페이드를 추천해요.
          </p>
        </div>

        <button
          onClick={() => setAutoplayRecommendations(!autoplayRecommendations)}
          className="flex w-full items-center justify-between rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 hover:bg-bg-hover"
        >
          <div className="text-left">
            <p className="text-sm font-semibold">자동 이어추천</p>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              큐 끝났을 때 비슷한 분위기의 곡을 자동으로 이어 재생해요.
            </p>
          </div>
          <span
            className={`relative h-7 w-12 rounded-full transition ${
              autoplayRecommendations ? 'bg-accent' : 'bg-bg-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                autoplayRecommendations ? 'left-5' : 'left-0.5'
              }`}
            />
          </span>
        </button>
      </section>

      {/* Audio Output Phase 1 — 재생 설정 하위 · setSinkId 지원 브라우저 자동 감지 */}
      <AudioOutputSection />

      {/* Phase 1-7 — enterprise HQ / 매장 우선 표시 — Phase 1-8 hotfix 로 상단으로 이동됨.
          이 위치는 ArtistManagementCard 분기 가드 유지를 위해 비워둠. */}

      {/* 아티스트 관리/등록 카드 — artist_profiles(approval_status) 가 source of truth.
          프로필이 있거나 account_type=artist 이면 노출. 미러(account_type/artist_approval_status)
          가 깨져도 카드가 사라지지 않도록 카드 내부에서 프로필을 직접 조회한다.
          Phase 1-7 — enterprise HQ / 매장 사용자에게는 노출하지 않음. */}
      {user?.id
        && !enterpriseRole.loading
        && !enterpriseRole.role.is_hq
        && !enterpriseRole.storeInfo.is_store && (
        <ArtistManagementCard
          userId={user.id}
          userEmail={user.email ?? ''}
          accountType={profile?.account_type ?? null}
          usersApproval={profile?.artist_approval_status ?? null}
        />
      )}

      {/* 큐레이터 프로필 — 로그인 사용자만 (0013 미적용 환경에선 저장 시 에러 안내) */}
      {user?.id && (
        <section className="space-y-2">
          <CuratorProfileEditor userId={user.id} />
        </section>
      )}

      <PushNotificationToggle />

      <div className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
        <Row to="/subscription" icon={<CreditCard size={18} />} label="구독 관리" />
        {profile?.role === 'admin' && (
          <Row to="/admin" icon={<Shield size={18} />} label="관리자 페이지" />
        )}
        {isAgent && (
          <Row to="/sales" icon={<Store size={18} />} label="영업 매장 관리"
            desc="내 영업 코드로 등록된 매장과 이용 현황, 매출을 확인합니다." />
        )}
        <Row to="/business" icon={<Settings size={18} />} label="사업자 모드 설정" />
      </div>

      <button
        onClick={signOut}
        className="flex w-full items-center justify-center gap-2 text-sm text-ink-mute hover:text-red-400"
      >
        <LogOut size={16} /> 로그아웃
      </button>

      <button
        onClick={() => setWithdrawModalOpen(true)}
        className="flex w-full items-center justify-center gap-2 text-xs text-ink-dim hover:text-red-400"
      >
        <UserX size={14} /> 회원 탈퇴
      </button>

      <p className="text-center text-[11px] text-ink-dim">듣다 · v0.1.0 MVP</p>

      {withdrawModalOpen && (
        <WithdrawConfirmModal
          busy={withdrawing}
          onCancel={() => setWithdrawModalOpen(false)}
          onConfirm={handleConfirmWithdraw}
        />
      )}
    </div>
  );
}

function WithdrawConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/25 text-red-300">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h3 className="text-base font-bold">정말 탈퇴할까요?</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
              회원 탈퇴 시 계정 이용이 중단되며, 결제 및 정산 관련 기록은 관련 법령에 따라 보관될
              수 있어요.
            </p>
          </div>
        </div>
        <Alert tone="warning">
          <strong>활성 구독</strong>이 있으면 먼저 구독을 취소하고 결제 기간이 종료된 후 탈퇴해
          주세요.
        </Alert>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            계속 이용하기
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {busy ? '처리 중…' : '탈퇴하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 긴급 hotfix — 본인인증 섹션 3-state 분기.
 *
 *   State A. identityVerified=false                  → 본인인증 진행 CTA (amber)
 *   State B. identityVerified=true & payoutVerified=false → 정산정보 등록 CTA (sky)
 *   State C. identityVerified=true & payoutVerified=true  → 준비 완료 (emerald, CTA 없음)
 *
 * payoutVerified 는 null 인 경우(로딩/조회 실패) 안전 fallback 으로 State B/C 를 State C 로 병합
 * (정산정보 등록 CTA 를 잘못 노출하지 않기 위함). 아티스트가 아닌 사용자는 payout 이 없으므로
 * payoutVerified=false 가 되는데, 이 화면은 identity/settlement 준비도만 안내하므로 문제 없음.
 *
 * 색상 대비 WCAG AA:
 *   · amber CTA:  bg-amber-400/90 text-amber-950 hover:bg-amber-300 → text ≥ 6:1
 *   · emerald bg: bg-emerald-500/20 text-slate-900 dark:text-emerald-100 → 4.6:1 이상
 *   · sky CTA:    bg-sky-500 text-white → 4.7:1
 */
function IdentityVerificationSection({
  identityVerified, payoutVerified, verifying, onVerify,
}: {
  identityVerified: boolean;
  payoutVerified: boolean | null;
  verifying: boolean;
  onVerify: () => void;
}) {
  // State C — 인증 + 정산정보 모두 완료
  // UIC hotfix — 밝은 배경(라이트 테마)에서 흰색 text 가 안 보이는 문제 fix.
  // bg 는 light-native (bg-emerald-50 border-emerald-200) + dark 는 기존 alpha overlay 유지.
  // text 는 slate 계층 (제목 950 · 본문 900 · 설명 700) + dark 는 emerald-50/100 유지.
  if (identityVerified && payoutVerified === true) {
    return (
      <section id="identity-verification" className="space-y-2 scroll-mt-4">
        <div className="px-1">
          <h2 className="text-sm font-bold tracking-tight">본인인증</h2>
          <p className="text-[11px] text-ink-mute">정산 지급 준비 상태</p>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 dark:bg-emerald-500/20 dark:ring-1 dark:ring-emerald-400/50 dark:border-transparent">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/40 dark:text-emerald-50"
            aria-hidden
          >
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-slate-950 dark:text-emerald-50">정산 준비 완료</p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-emerald-100">
              본인인증과 정산정보 등록이 모두 완료되었습니다.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // State B — 인증 완료 · 정산정보 미완료 (payoutVerified === false 로 확정된 경우에만)
  if (identityVerified && payoutVerified === false) {
    return (
      <section id="identity-verification" className="space-y-2 scroll-mt-4">
        <div className="px-1">
          <h2 className="text-sm font-bold tracking-tight">본인인증</h2>
          <p className="text-[11px] text-ink-mute">정산 지급을 위한 계좌·정산정보</p>
        </div>
        <div className="rounded-2xl bg-sky-50 border border-sky-200 p-4 dark:bg-sky-500/20 dark:ring-1 dark:ring-sky-400/50 dark:border-transparent">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/40 dark:text-sky-50 sm:h-10 sm:w-10"
              aria-hidden
            >
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="text-lg font-extrabold leading-tight tracking-tight text-slate-950 dark:text-sky-50 sm:text-xl">
                정산정보 등록이 필요합니다
              </h3>
              <p className="text-sm font-semibold leading-relaxed text-slate-900 dark:text-sky-100">
                본인인증은 완료되었어요. 정산을 받기 위해 계좌 및 정산정보를 등록해주세요.
              </p>
              <p className="text-[12px] leading-relaxed text-slate-700 dark:text-sky-50/85">
                등록한 계좌 정보는 정산 지급 외 용도로 사용되지 않으며 관계 법령에 따라 안전하게 보관됩니다.
              </p>
            </div>
            <div className="shrink-0 sm:self-center">
              <Link
                to="/artist#payout-account"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-sky-500 sm:w-auto"
              >
                정산정보 등록하기
                <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // 하이브리드 안전판: payoutVerified 로딩 중(null) 이면서 identity 만 완료면 완료 배너만 노출 (CTA 없음)
  if (identityVerified) {
    return (
      <section id="identity-verification" className="space-y-2 scroll-mt-4">
        <div className="px-1">
          <h2 className="text-sm font-bold tracking-tight">본인인증</h2>
          <p className="text-[11px] text-ink-mute">정산 지급을 위한 본인 명의 확인</p>
        </div>
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 dark:bg-emerald-500/20 dark:ring-1 dark:ring-emerald-400/50 dark:border-transparent">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/40 dark:text-emerald-50"
            aria-hidden
          >
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold text-slate-950 dark:text-emerald-50">본인인증 완료</p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-emerald-100">
              정산 지급 요건 중 본인인증 단계가 확인됐어요.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // State A — 인증 미완료
  return (
    <section id="identity-verification" className="space-y-2 scroll-mt-4">
      <div className="px-1">
        <h2 className="text-sm font-bold tracking-tight">본인인증</h2>
        <p className="text-[11px] text-ink-mute">정산 지급을 위한 본인 명의 확인</p>
      </div>
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 dark:bg-amber-500/25 dark:ring-1 dark:ring-amber-400/60 dark:border-transparent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/40 dark:text-amber-50 sm:h-10 sm:w-10"
            aria-hidden
          >
            <ShieldAlert size={22} />
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-lg font-extrabold leading-tight tracking-tight text-slate-950 dark:text-amber-50 sm:text-xl">
              본인인증이 필요합니다
            </h3>
            <p className="text-sm font-semibold leading-relaxed text-slate-900 dark:text-amber-100">
              정산을 받기 위해 본인인증을 먼저 완료해주세요.
            </p>
            <p className="text-[12px] leading-relaxed text-slate-700 dark:text-amber-50/85">
              운영팀 검수를 통해 처리되며 평균 1영업일 내 처리됩니다.
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 border border-slate-200 px-2.5 py-1 text-[10px] font-medium text-slate-700 dark:bg-bg-soft dark:border-transparent dark:text-ink-mute dark:ring-1 dark:ring-line/15">
              자동 본인인증(NICE/KCB/카카오) 준비 중
            </span>
          </div>
          <div className="shrink-0 sm:self-center">
            {/* HF3 — 본인인증 진행하기 CTA. SupportInquiryButton 을 사용하면 문의 모달이 열리는
                버그가 있었어서 verifyIdentityNow (MVP mock) 를 직접 호출하는 button 으로 교체. */}
            <button
              type="button"
              onClick={onVerify}
              disabled={verifying}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-bold text-amber-950 shadow-sm hover:bg-amber-300 disabled:opacity-60 sm:w-auto"
            >
              <ShieldCheck size={14} />
              {verifying ? '확인 중…' : '본인인증 진행하기'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ to, icon, label, desc }: { to: string; icon: React.ReactNode; label: string; desc?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-bg-hover">
      <span className="text-ink-mute">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm">{label}</span>
        {desc && <span className="mt-0.5 block text-[11px] text-ink-dim">{desc}</span>}
      </span>
      <ChevronRight size={16} className="text-ink-dim" />
    </Link>
  );
}

function ArtistManagementCard({
  userId,
  accountType,
  usersApproval,
  userEmail,
}: {
  userId: string;
  userEmail: string;
  accountType: string | null;
  usersApproval: 'pending' | 'approved' | 'rejected' | null;
}) {
  // undefined = 로딩 중, null = 프로필 없음
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null | undefined>(undefined);
  const [eligibility, setEligibility] = useState<UploadEligibility | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshAuthProfile = useAuthStore((s) => s.refreshProfile);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await fetchMyArtistProfile(userId);
      if (!alive) return;
      setArtistProfile(p);
      // 승인된 경우에만 계약 상태 조회 (일반 리스너에 불필요한 RPC 호출 방지)
      if (p?.approval_status === 'approved') {
        const e = await fetchArtistUploadEligibility().catch(() => null);
        if (alive) setEligibility(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, reloadKey]);

  async function handleApplied() {
    setApplyOpen(false);
    setReloadKey((k) => k + 1);
    await refreshAuthProfile();
  }

  // 아티스트 컨텍스트 여부: 프로필이 있거나 account_type=artist (둘 다 아니면 일반 리스너 → 숨김)
  const isArtistContext = accountType === 'artist' || artistProfile != null;

  // 로딩 중: 아티스트로 보일 때만 스켈레톤, 일반 리스너는 아무것도 렌더하지 않음
  if (artistProfile === undefined) {
    return accountType === 'artist' ? (
      <div className="h-28 animate-pulse rounded-2xl bg-bg-card" />
    ) : null;
  }

  // 일반 회원 — 아티스트로 지원(전환)할 수 있는 진입점 제공
  if (!isArtistContext) {
    return (
      <>
        <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Mic2 size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold tracking-tight">아티스트로 활동하고 싶으세요?</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
                음원을 유통하고 정산받는 아티스트로 지원할 수 있어요. 관리자 승인 후 음원 업로드가 시작됩니다.
              </p>
            </div>
          </div>
          <button
            onClick={() => setApplyOpen(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg shadow-sm hover:opacity-90"
          >
            아티스트로 지원하기
            <ChevronRight size={14} />
          </button>
        </section>
        {applyOpen && (
          <ArtistApplyModal
            defaultEmail={userEmail}
            onClose={() => setApplyOpen(false)}
            onDone={handleApplied}
          />
        )}
      </>
    );
  }

  // ── 상태 결정 ─────────────────────────────────────────────
  // source of truth = artist_profiles.approval_status
  type CardState = {
    label: string;
    tone: string;
    icon: React.ReactNode;
    cta: string;
    note: string;
    syncNote?: string;
  };

  let state: CardState;
  if (artistProfile == null) {
    // account_type=artist 인데 프로필이 없는 비정상 케이스 → 등록/문의 (버튼 유지)
    state = {
      label: '등록 필요',
      tone: 'bg-yellow-500/25 text-slate-900 dark:text-yellow-200',
      icon: <AlertTriangle size={11} />,
      cta: '아티스트 등록 신청',
      note: '아티스트 정보가 저장되지 않았어요. 등록을 이어서 진행하거나 고객센터로 문의해주세요.',
    };
  } else if (artistProfile.approval_status === 'pending') {
    state = {
      label: '검토 중',
      tone: 'bg-yellow-500/25 text-slate-900 dark:text-yellow-200',
      icon: <Clock size={11} />,
      cta: '진행 상태 보기',
      note: '관리자 승인 검토 중이에요. 평균 1영업일 이내 처리됩니다.',
    };
  } else if (artistProfile.approval_status === 'rejected') {
    state = {
      label: '승인 거절됨',
      tone: 'bg-red-500/25 text-red-300',
      icon: <XCircle size={11} />,
      cta: '거절 사유 확인',
      note: '승인이 거절됐어요. 사유를 확인하고 재신청할 수 있어요.',
    };
  } else {
    // approved — 계약 서명 여부로 계약서 단계 / 대시보드 분기
    const signed =
      eligibility?.has_signed_contract === true || eligibility?.contract_status === 'signed';
    // 미러(account_type/artist_approval_status) 가 승인 프로필과 어긋난 상태 감지
    const mirrorDesynced = usersApproval !== 'approved' || accountType !== 'artist';
    state = signed
      ? {
          label: '승인 완료',
          tone: 'bg-emerald-500/25 text-emerald-300',
          icon: <CheckCircle2 size={11} />,
          cta: '아티스트 관리',
          note: '내 음원 업로드, 정산 계좌, 스트리밍 현황을 관리해요.',
        }
      : {
          label: '승인 완료',
          tone: 'bg-emerald-500/25 text-emerald-300',
          icon: <CheckCircle2 size={11} />,
          cta: '계약서 확인하기',
          note: '승인이 완료됐어요. 음원 유통 계약서를 확인·서명하면 음원 업로드가 시작돼요.',
        };
    if (mirrorDesynced) {
      state.syncNote =
        '계정 상태를 동기화하고 있어요. 계약서 단계에서 자동으로 복구되며, 문제가 지속되면 고객센터로 문의해주세요.';
    }
  }

  return (
    <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Mic2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold tracking-tight">아티스트</h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${state.tone}`}>
              {state.icon}
              {state.label}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">{state.note}</p>
          {state.syncNote && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-slate-700 dark:text-yellow-200/90">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {state.syncNote}
            </p>
          )}
        </div>
      </div>
      <Link
        to="/artist"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg shadow-sm hover:opacity-90"
      >
        {state.cta}
        <ChevronRight size={14} />
      </Link>
    </section>
  );
}
