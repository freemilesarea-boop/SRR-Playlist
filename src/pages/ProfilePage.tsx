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
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { requestWithdrawal } from '@/lib/subscriptionApi';
import { toast } from '@/store/toastStore';
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
  type ArtistProfile,
  type UploadEligibility,
} from '@/lib/artistApi';
import ArtistApplyModal from '@/components/artist/ArtistApplyModal';
import PushNotificationToggle from '@/components/PushNotificationToggle';
import {
  usePlaybackSettingsStore,
  CROSSFADE_OPTIONS,
  type CrossfadeSeconds,
} from '@/store/playbackSettingsStore';
import { getTimeSlotLabel, type ThemeMode } from '@/lib/timeTheme';

export default function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [isAgent, setIsAgent] = useState(false);
  const location = useLocation();

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
      toast.error(e instanceof Error ? e.message : '탈퇴 요청 실패');
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

      {/* X6.18 — 본인인증 섹션 (정산 보류 카드의 본인인증 CTA scroll target) */}
      <IdentityVerificationSection identityVerified={profile?.identity_verified === true} />

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

      {/* 아티스트 관리/등록 카드 — artist_profiles(approval_status) 가 source of truth.
          프로필이 있거나 account_type=artist 이면 노출. 미러(account_type/artist_approval_status)
          가 깨져도 카드가 사라지지 않도록 카드 내부에서 프로필을 직접 조회한다. */}
      {user?.id && (
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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
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
 * X6.18 — 본인인증 섹션.
 * 정산 보류 카드의 "본인인증 하러가기" CTA 의 scroll target.
 * MVP: 운영팀 문의 안내 (NICE/KCB/토스 정식 연동은 별도 작업).
 */
function IdentityVerificationSection({ identityVerified }: { identityVerified: boolean }) {
  return (
    <section id="identity-verification" className="space-y-2 scroll-mt-4">
      <div className="px-1">
        <h2 className="text-sm font-bold tracking-tight">본인인증</h2>
        <p className="text-[11px] text-ink-mute">
          정산 지급을 위한 본인 명의 확인
        </p>
      </div>
      <div
        className={`flex items-start gap-3 rounded-2xl p-4 ring-1 ${
          identityVerified
            ? 'bg-emerald-500/10 ring-emerald-500/20'
            : 'bg-amber-500/10 ring-amber-500/30'
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            identityVerified ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
          }`}
          aria-hidden
        >
          {identityVerified ? '✓' : '!'}
        </span>
        <div className="min-w-0 flex-1">
          {identityVerified ? (
            <>
              <p className="text-sm font-semibold text-emerald-100">본인인증 완료</p>
              <p className="mt-0.5 text-[11px] text-emerald-100/80">
                정산 지급 요건 중 본인인증 단계가 확인됐어요.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-amber-100">본인인증이 필요해요</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-100/80">
                정산 지급 전 본인 명의 확인이 필요합니다. 운영팀 검수를 통해 처리되며,
                아래 문의 채널로 연락 주시면 평균 1영업일 내 처리해 드립니다.
              </p>
              <p className="mt-1 text-[10px] text-ink-dim">
                ※ 본인인증 자동 연동(NICE/KCB/토스/카카오) 준비 중입니다.
              </p>
            </>
          )}
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
      tone: 'bg-yellow-500/15 text-yellow-200',
      icon: <AlertTriangle size={11} />,
      cta: '아티스트 등록 신청',
      note: '아티스트 정보가 저장되지 않았어요. 등록을 이어서 진행하거나 고객센터로 문의해주세요.',
    };
  } else if (artistProfile.approval_status === 'pending') {
    state = {
      label: '검토 중',
      tone: 'bg-yellow-500/15 text-yellow-200',
      icon: <Clock size={11} />,
      cta: '진행 상태 보기',
      note: '관리자 승인 검토 중이에요. 평균 1영업일 이내 처리됩니다.',
    };
  } else if (artistProfile.approval_status === 'rejected') {
    state = {
      label: '승인 거절됨',
      tone: 'bg-red-500/15 text-red-300',
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
          tone: 'bg-emerald-500/15 text-emerald-300',
          icon: <CheckCircle2 size={11} />,
          cta: '아티스트 관리',
          note: '내 음원 업로드, 정산 계좌, 스트리밍 현황을 관리해요.',
        }
      : {
          label: '승인 완료',
          tone: 'bg-emerald-500/15 text-emerald-300',
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
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-yellow-200/90">
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
