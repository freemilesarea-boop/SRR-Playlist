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
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import {
  usePlaybackSettingsStore,
  CROSSFADE_OPTIONS,
  type CrossfadeSeconds,
} from '@/store/playbackSettingsStore';
import { getTimeSlotLabel, type ThemeMode } from '@/lib/timeTheme';

export default function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();
  const { mode, resolvedMode, timeSlot, setMode } = useThemeStore();
  const crossfadeSeconds = usePlaybackSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfadeSeconds = usePlaybackSettingsStore((s) => s.setCrossfadeSeconds);
  const autoplayRecommendations = usePlaybackSettingsStore((s) => s.autoplayRecommendations);
  const setAutoplayRecommendations = usePlaybackSettingsStore((s) => s.setAutoplayRecommendations);

  const planLabel =
    profile?.subscription_type === 'business'
      ? '사업자 플랜'
      : profile?.subscription_type === 'personal'
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

      <p className="text-center text-[11px] text-ink-dim">스르륵 플리 · v0.1.0 MVP</p>
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
