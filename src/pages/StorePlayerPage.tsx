import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipForward, SkipBack, X, Wifi, WifiOff, Sun, MonitorSmartphone,
  Music, AlertTriangle, Sparkles, ListMusic,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useBusinessStore } from '@/store/businessStore';
import { useAuthStore } from '@/store/authStore';
import AutoCover from '@/components/AutoCover';
import InstallAppButton from '@/components/InstallAppButton';
import StoreTrackReactionButtons from '@/components/player/StoreTrackReactionButtons';
import { formatTime } from '@/lib/format';
// X6.89 — B2B 프랜차이즈 정책 자동 동기화 (60s 폴링).
// 프랜차이즈 연결 매장만 적용; 일반 매장은 hook 이 no-op.
import { useFranchisePolicySync } from '@/hooks/useFranchisePolicySync';
// Phase 1-3 fix — heartbeat 는 AppShell 에서 mount (모든 페이지 커버).
// /store/player 외 BusinessPage 등에서도 매장 모드 진입 시 heartbeat 발생.

/**
 * 매장 재생 모드(키오스크) — 전역 <Player> 의 오디오 엔진/큐를 그대로 사용하는 풀스크린 UI.
 * 오디오 재생 자체는 AppShell 의 <Player> 가 담당하므로, 이 페이지는 같은 usePlayerStore 를
 * 읽고 제어만 한다. (향후 Electron/Tauri 데스크탑 앱도 동일 store API/queue 재사용 가능)
 */
export default function StorePlayerPage() {
  const navigate = useNavigate();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playing = usePlayerStore((s) => s.playing);
  const repeat = usePlayerStore((s) => s.repeat);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const playlist = usePlayerStore((s) => s.playlist);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);

  const { online, failedCount, wakeLockSupported, wakeLockActive, todayPlayCount } =
    usePlaybackHealthStore();
  const autoplayRecommendations = usePlaybackSettingsStore((s) => s.autoplayRecommendations);
  // X6.88.1 — 직접 URL 진입(/store/player) 경로에서도 localStorage 정규화 보장.
  // useStartBusinessMode 를 거치지 않는 진입에 대비.
  const enableForBusinessMode = usePlaybackSettingsStore((s) => s.enableForBusinessMode);
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);

  // 매장 모드 진입 → businessMode ON (App 의 useWakeLock(businessMode && playing) 가 화면 꺼짐 방지)
  // + crossfade 강제 OFF (localStorage 정규화)
  useEffect(() => {
    setBusinessMode(true);
    enableForBusinessMode();
  }, [setBusinessMode, enableForBusinessMode]);

  // X6.84 — 매장주 본인 = store_id (별도 stores 테이블 없음, business 플랜 user.id 사용)
  const storeId = useAuthStore((s) => s.user?.id ?? null);

  // X6.89 — 본사 정책 자동 동기화. 프랜차이즈 연결된 매장만 정책 적용,
  // 미연결 매장은 has_franchise_policy=false 로 기존 큐 그대로 사용 (회귀 0).
  const franchiseSync = useFranchisePolicySync({ storeId, enabled: !!storeId });

  // Phase 1-3 fix — heartbeat 는 AppShell 에서 mount. 여기 중복 호출 제거.

  const current = queue[index];
  const upcoming =
    repeat === 'one'
      ? current
      : queue[index + 1] ?? (repeat === 'all' ? queue[0] : undefined);
  const hasQueue = queue.length > 0;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-gradient-to-b from-bg-deep to-black text-white">
      {/* 상단 바: 상태 + 나가기 */}
      <header className="flex items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
            <Sparkles size={12} className="text-accent" /> 매장 재생 모드
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
              online ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'
            }`}
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? '온라인' : '오프라인 — 재연결 대기'}
          </span>
          {franchiseSync.policy?.has_franchise_policy && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-1 text-indigo-200"
              title={`본사 정책: ${franchiseSync.policy.policy_name ?? ''} · 슬롯: ${franchiseSync.policy.matched_slot?.slot_name ?? '—'}`}
            >
              <Sparkles size={12} /> 본사 정책 자동 동기화
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/business')}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
        >
          <X size={14} /> 나가기
        </button>
      </header>

      {/* 본문 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-4">
        {hasQueue && current ? (
          <>
            <div className="relative aspect-square w-56 max-w-[60vw] overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10 sm:w-72">
              <AutoCover title={current.title} category={current.genre} imageUrl={current.cover_url} size="lg" />
            </div>

            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{current.title}</h1>
              <p className="text-base text-white/70">{current.artist ?? '—'}</p>
              {playlist && (
                <p className="inline-flex items-center gap-1 text-xs text-white/50">
                  <ListMusic size={12} /> {playlist.title}
                </p>
              )}
              {/* X6.84 — 매장주 행동 데이터 (👍/👎) 수집. 로그인 + current 트랙 있을 때만. */}
              {storeId && current?.id && (
                <div className="flex justify-center pt-2">
                  <StoreTrackReactionButtons
                    storeId={storeId}
                    trackId={current.id}
                    playlistId={playlist?.id ?? null}
                  />
                </div>
              )}
            </div>

            {/* 진행바 */}
            <div className="flex w-full max-w-xl items-center gap-3 text-xs tabular-nums text-white/60">
              <span>{formatTime(currentTime)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%' }}
                />
              </div>
              <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
            </div>

            {/* 큰 컨트롤 */}
            <div className="flex items-center gap-6">
              <button onClick={prev} aria-label="이전 곡" className="rounded-full bg-white/10 p-4 hover:bg-white/20">
                <SkipBack size={24} fill="currentColor" />
              </button>
              <button
                onClick={() => (playing ? pause() : play())}
                aria-label={playing ? '일시정지' : '재생'}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-black shadow-lift hover:bg-accent/90"
              >
                {playing ? <Pause size={36} fill="currentColor" /> : <Play size={36} fill="currentColor" className="ml-1" />}
              </button>
              <button onClick={next} aria-label="다음 곡" className="rounded-full bg-white/10 p-4 hover:bg-white/20">
                <SkipForward size={24} fill="currentColor" />
              </button>
            </div>

            {/* 자동재생 실패(브라우저 정책) 시 안내 — playing=false 인데 큐가 있으면 "재생 시작" 강조 */}
            {!playing && (
              <button
                onClick={() => play()}
                className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-black hover:bg-accent/90"
              >
                ▶ 재생 시작 / 다시 재생
              </button>
            )}

            {/* 다음 곡 */}
            {upcoming && upcoming.id !== current.id && (
              <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/60">
                <SkipForward size={12} /> 다음 곡: <span className="text-white/85">{upcoming.title}</span>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4 text-center">
            <Music size={40} className="mx-auto text-white/40" />
            <p className="text-lg font-bold">재생할 곡이 없어요</p>
            <p className="text-sm text-white/60">매장 운영 화면에서 플레이리스트를 선택해 재생을 시작하세요.</p>
            <button
              onClick={() => navigate('/business')}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-black hover:bg-accent/90"
            >
              플레이리스트 고르기
            </button>
          </div>
        )}
      </div>

      {/* 하단 상태/안내 */}
      <footer className="space-y-3 border-t border-white/10 bg-black/40 px-5 py-4 sm:px-8">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={<Music size={13} />} label="오늘 재생" value={`${todayPlayCount}곡`} />
          <Stat icon={<ListMusic size={13} />} label="대기열" value={`${queue.length}곡`} />
          <Stat
            icon={<Sparkles size={13} />}
            label="자동 이어재생"
            value={autoplayRecommendations ? 'ON' : 'OFF'}
            tone={autoplayRecommendations ? 'text-emerald-300' : 'text-white/50'}
          />
          <Stat
            icon={<Sun size={13} />}
            label="화면 꺼짐 방지"
            value={!wakeLockSupported ? '미지원' : wakeLockActive ? '켜짐' : '대기'}
            tone={wakeLockActive ? 'text-emerald-300' : 'text-white/50'}
          />
        </div>

        {failedCount > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-300">
            <AlertTriangle size={12} /> 재생 실패 {failedCount}건 — 문제 트랙은 자동으로 건너뛰었어요.
          </p>
        )}

        {!wakeLockSupported && (
          <p className="text-[11px] text-white/50">
            이 브라우저는 화면 꺼짐 방지를 지원하지 않아요. 기기의 <b>화면 자동 잠금</b>을 해제해두시면 더 안정적입니다.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-white/55">
            <MonitorSmartphone size={13} className="shrink-0" />
            브라우저를 켜둔 상태에서 안정적으로 재생됩니다. <b className="text-white/75">창을 완전히 닫으면 음악은 중단됩니다.</b>
          </p>
          <InstallAppButton variant="ghost" label="매장용 앱 설치" />
        </div>
      </footer>
    </div>
  );
}

function Stat({ icon, label, value, tone = 'text-white' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/45">{icon}{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}
