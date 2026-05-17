import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard,
  Settings,
  LogOut,
  ChevronRight,
  Shield,
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
import { useThemeStore } from '@/store/themeStore';
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
      </header>

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

      {/* 아티스트 관리 카드 — account_type='artist' 일 때만 노출 */}
      {profile?.account_type === 'artist' && (
        <ArtistManagementCard approvalStatus={profile?.artist_approval_status ?? 'pending'} />
      )}

      {/* 큐레이터 프로필 — 로그인 사용자만 (0013 미적용 환경에선 저장 시 에러 안내) */}
      {user?.id && (
        <section className="space-y-2">
          <CuratorProfileEditor userId={user.id} />
        </section>
      )}

      <div className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
        <Row to="/subscription" icon={<CreditCard size={18} />} label="구독 관리" />
        {profile?.role === 'admin' && (
          <Row to="/admin" icon={<Shield size={18} />} label="관리자 페이지" />
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

      <p className="text-center text-[11px] text-ink-dim">스르륵 플리 · v0.1.0 MVP</p>

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

function Row({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-bg-hover">
      <span className="text-ink-mute">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      <ChevronRight size={16} className="text-ink-dim" />
    </Link>
  );
}

function ArtistManagementCard({
  approvalStatus,
}: {
  approvalStatus: 'pending' | 'approved' | 'rejected' | null | undefined;
}) {
  const status: { label: string; tone: string; icon: React.ReactNode; cta: string } =
    approvalStatus === 'approved'
      ? {
          label: '승인 완료',
          tone: 'bg-emerald-500/15 text-emerald-300',
          icon: <CheckCircle2 size={11} />,
          cta: '아티스트 관리',
        }
      : approvalStatus === 'rejected'
        ? {
            label: '승인 거절됨',
            tone: 'bg-red-500/15 text-red-300',
            icon: <XCircle size={11} />,
            cta: '거절 사유 확인',
          }
        : {
            label: '승인 대기 중',
            tone: 'bg-yellow-500/15 text-yellow-200',
            icon: <Clock size={11} />,
            cta: '진행 상태 보기',
          };

  return (
    <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Mic2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold tracking-tight">아티스트 관리</h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.tone}`}>
              {status.icon}
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            내 음원 업로드, 정산 계좌, 스트리밍 현황을 관리해요.
          </p>
        </div>
      </div>
      <Link
        to="/artist"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg shadow-sm hover:opacity-90"
      >
        {status.cta}
        <ChevronRight size={14} />
      </Link>
    </section>
  );
}
