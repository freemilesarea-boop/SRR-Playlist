import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Sparkles, TrendingUp } from 'lucide-react';
import {
  fetchTrackChart,
  fetchTrackChartByGenre,
  fetchGenres,
  chartTrackToTrackRow,
  type ChartTrack,
  type ChartPeriod,
  type GenreSummary,
} from '@/lib/chartsApi';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { toast } from '@/store/toastStore';
import ChartRow from '@/components/charts/ChartRow';
import ChartPodium from '@/components/charts/ChartPodium';
import SharedEmptyState from '@/components/common/EmptyState';
import Skeleton from '@/components/common/Skeleton';

type Tab = 'daily' | 'weekly' | 'monthly' | 'top100' | 'genre';

const TABS: Array<{ key: Tab; label: string; subtitle: string; icon: React.ReactNode }> = [
  { key: 'daily', label: '일간', subtitle: '오늘 인기곡', icon: <TrendingUp size={12} /> },
  { key: 'weekly', label: '주간', subtitle: '7일', icon: <TrendingUp size={12} /> },
  { key: 'monthly', label: '월간', subtitle: '30일', icon: <TrendingUp size={12} /> },
  { key: 'top100', label: 'TOP100', subtitle: '전체', icon: <Sparkles size={12} /> },
  { key: 'genre', label: '장르별', subtitle: 'by Genre', icon: <BarChart3 size={12} /> },
];

const TAB_TO_PERIOD: Record<Exclude<Tab, 'genre'>, ChartPeriod> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  top100: 'all',
};

const TAB_LIMIT: Record<Exclude<Tab, 'genre'>, number> = {
  daily: 50,
  weekly: 50,
  monthly: 50,
  top100: 100,
};

export default function ChartPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [tracks, setTracks] = useState<ChartTrack[]>([]);
  const [isFallback, setIsFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [genres, setGenres] = useState<GenreSummary[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  // 장르 차트에 반영할 기간 — 마지막으로 선택한 일/주/월/Top100 탭 기준 (기본 weekly)
  const [genrePeriod, setGenrePeriod] = useState<ChartPeriod>('weekly');

  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);

  // 일/주/월/Top100 차트
  useEffect(() => {
    if (tab === 'genre') return;
    setGenrePeriod(TAB_TO_PERIOD[tab]); // 장르 탭이 이어받을 기간 기억
    let alive = true;
    setLoading(true);
    fetchTrackChart(TAB_TO_PERIOD[tab], TAB_LIMIT[tab])
      .then((res) => {
        if (!alive) return;
        setTracks(res.tracks);
        setIsFallback(res.isFallback);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tab]);

  // 장르 목록 (genre 탭 진입 시)
  useEffect(() => {
    if (tab !== 'genre') return;
    fetchGenres().then((list) => {
      setGenres(list);
      if (!selectedGenre && list.length > 0) {
        setSelectedGenre(list[0].genre);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 장르 선택 → 해당 장르 차트
  useEffect(() => {
    if (tab !== 'genre' || !selectedGenre) return;
    let alive = true;
    setLoading(true);
    fetchTrackChartByGenre(selectedGenre, genrePeriod, 50)
      .then((res) => {
        if (!alive) return;
        setTracks(res.tracks);
        setIsFallback(res.isFallback);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, selectedGenre, genrePeriod]);

  const totalPlays = useMemo(
    () => tracks.reduce((s, t) => s + Number(t.play_count || 0), 0),
    [tracks],
  );

  function handlePlay(idx: number) {
    if (!useAuthStore.getState().session) {
      toast.info('로그인 후 이용해주세요.');
      useGateStore.getState().open('login');
      return;
    }
    if (tracks.length === 0) return;
    // 클릭된 행이 재생 불가면 아무 변경 없이 무시 (UI 1차 차단 + ChartRow disabled 와 이중 방어)
    if (!isPlayableUrl(tracks[idx]?.audio_url)) {
      return;
    }
    const trackRows = tracks.map(chartTrackToTrackRow);
    const { playable } = filterPlayableTracks(trackRows);
    if (playable.length === 0) {
      toast.info('아직 재생 가능한 곡이 없어요.');
      return;
    }
    // 클릭된 트랙을 playable 인덱스로 매핑
    const targetId = tracks[idx].track_id;
    const startIndex = Math.max(0, playable.findIndex((t) => t.id === targetId));
    setQueue(playable, startIndex < 0 ? 0 : startIndex, null);
  }

  const currentTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-6 px-4 pb-8 pt-6 sm:px-6">
      {/* Hero */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-black shadow-lg">
            <BarChart3 size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-accent">차트</p>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">듣다 차트</h1>
          </div>
        </div>
        <p className="text-sm text-ink-mute">
          {currentTab.label} · {currentTab.subtitle} 기준 인기곡
          {totalPlays > 0 && (
            <>
              <span className="mx-1.5 text-ink-dim">·</span>
              누적 재생 <span className="font-bold text-ink">{totalPlays.toLocaleString()}회</span>
            </>
          )}
        </p>
      </header>

      {/* 탭 */}
      <nav className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <div className="flex gap-1.5 pb-1 no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setSelectedGenre(null);
              }}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
                tab === t.key
                  ? 'bg-accent text-black'
                  : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* 장르 칩 (genre 탭일 때만) */}
      {tab === 'genre' && (
        <section className="space-y-2">
          {genres.length === 0 ? (
            <Skeleton.Row count={6} />
          ) : (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:flex-wrap sm:overflow-visible sm:px-6">
              {genres.map((g) => (
                <button
                  key={g.genre}
                  onClick={() => setSelectedGenre(g.genre)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    selectedGenre === g.genre
                      ? 'bg-accent text-black'
                      : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
                  }`}
                >
                  <span>{g.genre}</span>
                  <span className="opacity-70">·</span>
                  <span className="text-[10px] opacity-80">
                    {g.track_count}곡
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Top 1~3 포디움 (트랙 4개 이상일 때만) */}
      {!loading && tracks.length >= 4 && (
        <section className="space-y-3">
          {isFallback && <FallbackBanner standalone />}
          <ChartPodium
            tracks={tracks}
            currentTrackId={currentTrackId}
            onPlay={handlePlay}
          />
        </section>
      )}

      {/* 차트 리스트 (4위부터, 또는 트랙이 4개 미만이면 1위부터) */}
      <section className="rounded-2xl bg-bg-card p-2 ring-1 ring-line/10 sm:p-3">
        {/* 데스크탑 헤더 */}
        <header className="hidden items-center gap-4 border-b border-line/10 px-4 pb-2 pt-1 text-[10px] uppercase tracking-wider text-ink-dim sm:gap-5 md:flex">
          <span className="w-8 text-center sm:w-10">#</span>
          <span className="w-14">커버</span>
          <span className="flex-1">곡</span>
          <span className="w-20 text-right">재생</span>
        </header>

        {loading ? (
          <SkeletonList />
        ) : tracks.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* 트랙 4개 미만이면 fallback 배너를 여기서 표시 */}
            {tracks.length < 4 && isFallback && <FallbackBanner />}
            <ul className="space-y-1 pt-1">
              {(tracks.length >= 4 ? tracks.slice(3) : tracks).map((t, i) => {
                const actualIndex = tracks.length >= 4 ? i + 3 : i;
                return (
                  <li key={t.track_id}>
                    <ChartRow
                      track={t}
                      index={actualIndex}
                      isCurrent={currentTrackId === t.track_id}
                      onPlay={() => handlePlay(actualIndex)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// 표준 Skeleton / EmptyState 사용 — 로컬 wrapper 제거.
function SkeletonList() {
  return <Skeleton.Row count={10} />;
}

function EmptyState() {
  return (
    <SharedEmptyState
      icon={<BarChart3 size={20} />}
      title="아직 충분한 재생 기록이 없어 차트를 준비 중입니다"
      subtitle="곡을 30초 이상 들으면 차트에 반영됩니다"
    />
  );
}

function FallbackBanner({ standalone = false }: { standalone?: boolean }) {
  const base =
    'flex items-start gap-2 text-[11px] text-ink-mute';
  const inner = (
    <>
      <Sparkles size={12} className="mt-0.5 shrink-0 text-yellow-300" />
      <span>
        아직 충분한 재생 기록이 없어서 <span className="text-yellow-200">추천 트랙</span>을 먼저
        보여드려요. 곡을 30초 이상 들으면 차트에 반영됩니다.
      </span>
    </>
  );
  if (standalone) {
    return (
      <div className={`${base} rounded-xl bg-yellow-500/5 px-3 py-2.5 ring-1 ring-yellow-400/20`}>
        {inner}
      </div>
    );
  }
  return (
    <div className={`${base} border-b border-line/10 bg-yellow-500/5 px-4 py-2.5`}>
      {inner}
    </div>
  );
}
