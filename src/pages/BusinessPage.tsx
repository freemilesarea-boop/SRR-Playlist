import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store,
  Sparkles,
  Play,
  Smartphone,
  ShieldAlert,
  Clock,
  Radio,
  AlertCircle,
} from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { fetchPlaylists, fetchPlaylistTracks, fetchPlaylistCounts, logRecentPlay } from '@/lib/api';
import { useBusinessStore } from '@/store/businessStore';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import PlaylistCard from '@/components/PlaylistCard';
import AutoCover from '@/components/AutoCover';
import BusinessQRSection from '@/components/BusinessQRSection';
import BusinessScheduler from '@/components/BusinessScheduler';
import { gradientStyle } from '@/lib/cover';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';
import { useInstallPrompt, wakeLockSupported, isStandalone } from '@/hooks/useInstallPrompt';
import { isPlayableTrack } from '@/lib/audio';
import { toast } from '@/store/toastStore';

const TIME_COPY: Record<string, string> = {
  morning: '오픈 직후, 손님을 부드럽게 맞이하는 시간이에요.',
  afternoon: '느긋한 오후, 매장 회전을 자연스럽게 만들어요.',
  evening: '저녁의 무드를 한 단계 끌어올리는 시간이에요.',
  night: '밤의 분위기를 깊이 있게 가져가요.',
};

export default function BusinessPage() {
  const navigate = useNavigate();
  const { businessMode, setBusinessMode, selectedCategory, setCategory } = useBusinessStore();
  const { profile, user } = useAuthStore();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const playing = usePlayerStore((s) => s.playing);
  const currentPlaylistId = usePlayerStore((s) => s.playlist?.id);

  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const { canInstall, installed, prompt } = useInstallPrompt();

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPlaylists(), fetchPlaylistCounts().catch(() => new Map())])
      .then(([all, cnt]) => {
        if (!alive) return;
        setPlaylists(all.filter((p) => p.is_business_only));
        setCounts(cnt);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const slot = currentTimeSlot();
  const slotLabel = timeSlotLabel(slot);
  const slotCopy = TIME_COPY[slot];

  function playableOrder(a: PlaylistRow, b: PlaylistRow) {
    const ca = counts.get(a.id)?.playable ?? 0;
    const cb = counts.get(b.id)?.playable ?? 0;
    if (ca === cb) return a.sort_order - b.sort_order;
    return cb - ca;
  }

  const filtered = useMemo(() => {
    const list = selectedCategory
      ? playlists.filter(
          (p) => p.business_category === selectedCategory || p.category === selectedCategory,
        )
      : playlists;
    return [...list].sort(playableOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, selectedCategory, counts]);

  const timeRecommended = useMemo(
    () => filtered.filter((p) => p.time_slot === slot),
    [filtered, slot],
  );

  const featured = useMemo(() => {
    const fromTime = timeRecommended.find((p) => (counts.get(p.id)?.playable ?? 0) > 0);
    if (fromTime) return fromTime;
    const fromAny = filtered.find((p) => (counts.get(p.id)?.playable ?? 0) > 0);
    if (fromAny) return fromAny;
    return timeRecommended[0] ?? filtered[0] ?? null;
  }, [timeRecommended, filtered, counts]);

  const featuredCount = featured ? counts.get(featured.id) : undefined;
  const featuredPlayable = (featuredCount?.playable ?? 0) > 0;

  const isBusinessPlan = profile?.subscription_type === 'business';
  const playingNow = businessMode && playing && currentPlaylistId === featured?.id;

  // 통계
  const totalBusinessPlaylists = playlists.length;
  const playableBusinessPlaylists = playlists.filter(
    (p) => (counts.get(p.id)?.playable ?? 0) > 0,
  ).length;
  const totalPlayableTracks = Array.from(counts.values()).reduce(
    (sum, c) => sum + c.playable,
    0,
  );

  async function startMatchedPlaylist(p: PlaylistRow) {
    setStarting(true);
    try {
      const tracks = await fetchPlaylistTracks(p.id);
      if (tracks.length === 0) {
        toast.info('이 플레이리스트에는 아직 곡이 없어요.');
        return;
      }
      const playable = tracks.filter(isPlayableTrack);
      if (playable.length === 0) {
        toast.error(
          '재생 가능한 음원이 없어요. 관리자 페이지에서 시연용 mp3 를 업로드해주세요.',
        );
        return;
      }
      setBusinessMode(true);
      setRepeat('all');
      setShuffle(true);
      setQueue(tracks, tracks.indexOf(playable[0]), p);
      if (user) void logRecentPlay(user.id, p.id).catch(() => {});
      toast.success('매장 모드로 재생을 시작했어요. 오랫동안 안정적으로 흘러갑니다.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재생 시작에 실패했어요.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-7 px-4 pb-8 pt-6 sm:px-6">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
            <Store size={18} />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">매장 운영</h1>
            {playingNow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-400/30">
                <Radio size={10} className="animate-pulse" /> ON AIR
              </span>
            )}
          </div>
        </div>
        <h2 className="text-base font-semibold leading-snug text-ink sm:text-lg">
          우리 매장 분위기를 자동으로 운영하세요
        </h2>
        <p className="text-sm leading-relaxed text-ink-mute">
          음악 고르는 시간을 줄이고, 매장 분위기는 일정하게 유지하세요.
          홈 화면에 추가하면 앱처럼 사용할 수 있어요.
        </p>
      </header>

      {/* 미니 통계 (대시보드 느낌) */}
      <section className="grid grid-cols-3 gap-2">
        <Stat label="사용 가능" value={playableBusinessPlaylists} suffix={`/ ${totalBusinessPlaylists} 플리`} />
        <Stat label="등록 트랙" value={totalPlayableTracks} suffix="곡" />
        <Stat
          label="현재 모드"
          value={businessMode ? 'ON' : 'OFF'}
          accent={businessMode}
        />
      </section>

      {/* CTA — 매장 모드 시작 카드 */}
      {featured && (
        <section className="relative overflow-hidden rounded-3xl ring-1 ring-line/15">
          {/* 배경 그라데이션 */}
          <div
            className="absolute inset-0 opacity-90"
            style={gradientStyle(featured.category || featured.title)}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-black/70" />

          <div className="relative space-y-4 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-xs font-medium text-white/90">
              <Clock size={12} /> 지금 {slotLabel}
              {playingNow && (
                <span className="ml-auto inline-flex items-center gap-1 text-emerald-200">
                  <Radio size={10} className="animate-pulse" /> 재생 중
                </span>
              )}
            </div>

            <div className="flex items-end gap-4">
              <div className="aspect-square w-20 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-line/20 sm:w-24">
                <AutoCover
                  title={featured.title}
                  category={featured.category}
                  imageUrl={featured.thumbnail_url}
                  size="md"
                />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="text-xl font-extrabold leading-tight text-white drop-shadow sm:text-2xl">
                  {featured.title}
                </h3>
                <p className="text-xs text-white/80">{slotCopy}</p>
              </div>
            </div>

            {!featuredPlayable && (
              <div className="flex items-start gap-2 rounded-xl bg-yellow-400/15 p-2.5 text-[11px] backdrop-blur ring-1 ring-yellow-200/30">
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-yellow-200" />
                <span className="text-white/90">
                  음원이 아직 없어요.
                  {profile?.role === 'admin'
                    ? ' 관리자 페이지에서 시연용 mp3를 업로드해주세요.'
                    : ' 운영자가 곧 음원을 업로드할 예정이에요.'}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => startMatchedPlaylist(featured)}
                disabled={starting || !featuredPlayable}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-4 text-base font-bold text-black shadow-2xl transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play size={20} fill="currentColor" />
                {starting ? '시작 중…' : '매장 모드 시작'}
              </button>
              <button
                onClick={() => setBusinessMode(!businessMode)}
                className={`rounded-2xl px-4 py-4 text-sm font-semibold backdrop-blur ring-1 transition ${
                  businessMode
                    ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-300/40'
                    : 'bg-ink/10 text-white/80 ring-white/20 hover:bg-ink/15'
                }`}
              >
                {businessMode ? '모드 ON' : '모드 OFF'}
              </button>
            </div>

            <ul className="space-y-1 text-[11px] text-white/70">
              <li>· 화면이 꺼지지 않아 매장 단말에서 그대로 두기 좋아요</li>
              <li>· 자동 셔플 + 무한 반복으로 끊김 없이 흘러가요</li>
              <li>· 시간대가 바뀌면 새 플레이리스트를 추천해드려요</li>
            </ul>
          </div>
        </section>
      )}

      {/* 안내 노티스들 */}
      <div className="space-y-2">
        {!isBusinessPlan && (
          <Notice
            tone="accent"
            icon={<Sparkles size={14} className="text-accent" />}
            title="사업자 플랜에서 모든 기능을 이용하세요"
            description="업종별 추천, 직원 공유(예정), 장시간 재생 최적화까지."
            actionLabel="구독 보기"
            onAction={() => navigate('/subscription')}
          />
        )}

        {!wakeLockSupported() && (
          <Notice
            tone="warn"
            icon={<ShieldAlert size={14} className="text-yellow-300" />}
            title="이 브라우저는 화면 꺼짐 방지를 지원하지 않아요"
            description="Chrome / Edge / Safari 16.4+ 에서 가장 안정적이에요. 또는 단말 자동잠금을 ‘없음’ 으로 설정해주세요."
          />
        )}

        {!installed && !isStandalone() && (
          <Notice
            tone="info"
            icon={<Smartphone size={14} className="text-ink-mute" />}
            title="홈 화면에 추가하면 앱처럼 사용할 수 있어요"
            description="브라우저 메뉴에서 ‘홈 화면에 추가’ 또는 아래 버튼"
            actionLabel={canInstall ? '설치하기' : undefined}
            onAction={canInstall ? () => void prompt() : undefined}
          />
        )}
      </div>

      {/* 자동 스케줄러 */}
      <BusinessScheduler />

      {/* 매장 QR */}
      <BusinessQRSection playlists={filtered} />

      {/* 업종 선택 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-mute">업종을 골라주세요</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:flex-wrap sm:overflow-visible sm:px-6">
          <CategoryChip label="전체" active={!selectedCategory} onClick={() => setCategory(null)} />
          {BUSINESS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.key}
              label={`${c.emoji} ${c.key}`}
              active={selectedCategory === c.key}
              onClick={() => setCategory(c.key)}
            />
          ))}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : (
        <>
          {timeRecommended.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight sm:text-xl">
                  ⏰ 지금 {slotLabel}에 어울리는
                </h2>
                <p className="text-xs text-ink-mute">시간대 자동 추천</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {timeRecommended.map((p) => {
                  const c = counts.get(p.id);
                  return (
                    <PlaylistCard
                      key={p.id}
                      playlist={p}
                      playableCount={c?.playable}
                      totalCount={c?.total}
                    />
                  );
                })}
              </div>
            </section>
          )}

          <PlaylistRow_
            title={selectedCategory ? `${selectedCategory} 추천` : '전체 사업자 플레이리스트'}
            playlists={filtered}
            counts={counts}
            emptyText="해당 업종의 플레이리스트가 아직 없어요."
          />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-bg-card/80 p-3 ring-1 ${
        accent ? 'ring-accent/30 bg-accent/10' : 'ring-line/10'
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink-dim">{label}</p>
      <p
        className={`mt-1 text-lg font-extrabold tracking-tight ${
          accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
        {suffix && <span className="ml-1 text-[10px] font-medium text-ink-mute">{suffix}</span>}
      </p>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? 'bg-accent text-black'
          : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

function Notice({
  tone,
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: 'info' | 'warn' | 'accent';
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const ring =
    tone === 'warn'
      ? 'ring-yellow-500/30 bg-yellow-500/5'
      : tone === 'accent'
        ? 'ring-accent/30 bg-accent/5'
        : 'ring-line/15 bg-bg-card';
  return (
    <div className={`flex items-start gap-2 rounded-2xl p-3 text-xs ring-1 ${ring}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 text-ink-mute">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="shrink-0 rounded-md bg-bg-hover px-2.5 py-1 text-[11px] hover:bg-ink/10"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
