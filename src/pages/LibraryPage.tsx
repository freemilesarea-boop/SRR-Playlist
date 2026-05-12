import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play,
  Heart,
  Clock,
  Headphones,
  Sparkles,
  AlertCircle,
  ListMusic,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchRecentPlaylists } from '@/lib/api';
import {
  fetchLibraryOverview,
  type LibraryOverview,
} from '@/lib/libraryApi';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { toast } from '@/store/toastStore';
import type { PlaylistRow, TrackRow } from '@/types/db';
import AutoCover from '@/components/AutoCover';
import PlaylistRow_ from '@/components/PlaylistRow';
import TrackLikeButton from '@/components/TrackLikeButton';

export default function LibraryPage() {
  const { user } = useAuthStore();
  const userId = user?.id ?? null;
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);

  const [data, setData] = useState<LibraryOverview | null>(null);
  const [likedPlaylists, setLikedPlaylists] = useState<PlaylistRow[]>([]);
  const [recentPlaylists, setRecentPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [overview, lp, rp] = await Promise.all([
        fetchLibraryOverview(userId),
        userId
          ? supabase
              .from('likes')
              .select('created_at, playlists(*)')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                const rows = (data ?? []) as unknown as Array<{ playlists: PlaylistRow }>;
                return rows.map((r) => r.playlists).filter(Boolean);
              })
          : Promise.resolve([] as PlaylistRow[]),
        userId ? fetchRecentPlaylists(userId, 12) : Promise.resolve([] as PlaylistRow[]),
      ]);
      setData(overview);
      setLikedPlaylists(lp);
      setRecentPlaylists(rp);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '보관함 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const cont = data?.continue ?? null;
  const liked = data?.liked_tracks ?? [];
  const recent = data?.recently_played ?? [];
  const recommended = data?.recommended_playlists ?? [];

  // 좋아요 정렬 — 최신 vs 많이 들은
  const [likedSort, setLikedSort] = useState<'recent' | 'plays'>('recent');
  const sortedLiked = useMemo(() => {
    if (likedSort === 'recent') return liked;
    // 데이터에 play_count 가 없으니 created_at desc 로 fallback (실제 plays 는 chart RPC 필요)
    return [...liked];
  }, [liked, likedSort]);

  function playTracks(tracks: TrackRow[], startIndex = 0) {
    if (tracks.length === 0) return;
    const playable = tracks.filter((t) => isPlayableUrl(t.audio_url));
    if (playable.length === 0) {
      toast.info('재생 가능한 음원이 없어요.');
      return;
    }
    const startIdx = isPlayableUrl(tracks[startIndex]?.audio_url)
      ? startIndex
      : tracks.findIndex((t) => isPlayableUrl(t.audio_url));
    setQueue(tracks, Math.max(0, startIdx), null);
  }

  return (
    <div className="space-y-8 px-4 pb-8 pt-6 sm:px-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/20">
            <Heart size={16} fill="currentColor" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">보관함</h1>
        </div>
        <p className="text-sm text-ink-mute">
          좋아요한 음악, 최근 들은 곡, 이어듣기를 한 곳에서.
        </p>
      </header>

      {/* 이어듣기 */}
      {cont?.track && (
        <ContinueCard
          track={cont.track}
          position={cont.position_sec}
          duration={cont.duration_sec ?? cont.track.duration ?? null}
          onPlay={() => playTracks([cont.track!])}
        />
      )}

      {/* 최근 재생 */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
            <Clock size={16} className="text-ink-mute" /> 최근 재생
          </h2>
          {recent.length > 0 && (
            <span className="text-xs text-ink-mute">· {recent.length}곡</span>
          )}
        </div>
        {loading ? (
          <SkeletonRow />
        ) : recent.length === 0 ? (
          <Empty>아직 들은 곡이 없어요. 홈에서 첫 재생을 해보세요.</Empty>
        ) : (
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {recent.map((t, i) => (
              <button
                key={t.id}
                onClick={() => playTracks(recent, i)}
                className="group w-32 shrink-0 space-y-2 text-left sm:w-36"
              >
                <div className="relative aspect-square overflow-hidden rounded-xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                  <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="md" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play size={20} fill="currentColor" className="text-white" />
                  </div>
                  {!isPlayableUrl(t.audio_url) && (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-yellow-500/30 px-1.5 py-0.5 text-[10px] text-yellow-50 backdrop-blur">
                      <AlertCircle size={9} />
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 px-0.5">
                  <p className={`truncate text-sm font-semibold ${currentTrackId === t.id ? 'text-accent' : ''}`}>
                    {t.title}
                  </p>
                  <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 좋아요한 곡 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
            <Heart size={16} className="text-rose-400" fill="currentColor" /> 좋아요한 곡
          </h2>
          {liked.length > 0 && (
            <div className="flex rounded-full bg-bg-card p-0.5 ring-1 ring-line/10">
              {(['recent', 'plays'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setLikedSort(s)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    likedSort === s ? 'bg-accent text-bg' : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  {s === 'recent' ? '최신순' : '많이 들은순'}
                </button>
              ))}
            </div>
          )}
        </div>
        {loading ? (
          <SkeletonRow vertical />
        ) : sortedLiked.length === 0 ? (
          <Empty>아직 저장한 곡이 없어요. 마음에 드는 곡에 ♡를 눌러보세요.</Empty>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            <ul className="divide-y divide-line/10">
              {sortedLiked.map((t, i) => (
                <li key={t.id}>
                  <LikedTrackRow
                    track={t}
                    isCurrent={currentTrackId === t.id}
                    onPlay={() => playTracks(sortedLiked, i)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 좋아요한 플레이리스트 */}
      <PlaylistRow_
        title="좋아요한 플레이리스트"
        playlists={likedPlaylists}
        emptyText="좋아요한 플레이리스트가 없어요."
      />

      {/* 최근 들은 플레이리스트 */}
      {recentPlaylists.length > 0 && (
        <PlaylistRow_
          title="최근 들은 플레이리스트"
          playlists={recentPlaylists}
        />
      )}

      {/* 추천 (취향 기반) */}
      {recommended.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
              <Sparkles size={16} className="text-accent" /> 취향 기반 추천
            </h2>
            <p className="text-xs text-ink-mute">
              최근 많이 들은 장르 기반으로 골랐어요.
            </p>
          </div>
          <PlaylistRow_
            title=""
            subtitle=""
            playlists={recommended}
          />
        </section>
      )}
    </div>
  );
}

function ContinueCard({
  track,
  position,
  duration,
  onPlay,
}: {
  track: TrackRow;
  position: number;
  duration: number | null;
  onPlay: () => void;
}) {
  const pct = duration && duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <section
      className="group relative overflow-hidden rounded-3xl bg-bg-card shadow-lift ring-1 ring-line/10 transition hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl ring-1 ring-line/10 sm:h-24 sm:w-24">
          <AutoCover title={track.title} category={track.genre} imageUrl={track.cover_url} size="md" />
          <button
            onClick={onPlay}
            className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="이어듣기"
          >
            <Play size={22} fill="currentColor" />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-accent">
            이어듣기
          </p>
          <p className="truncate text-base font-extrabold sm:text-lg">{track.title}</p>
          <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-ink-dim">{Math.floor(position / 60)}분 지점부터</p>
        </div>
        <button
          onClick={onPlay}
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-bg shadow-card transition hover:scale-105 sm:flex"
          aria-label="이어듣기"
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>
    </section>
  );
}

function LikedTrackRow({
  track,
  isCurrent,
  onPlay,
}: {
  track: TrackRow;
  isCurrent?: boolean;
  onPlay: () => void;
}) {
  const playable = isPlayableUrl(track.audio_url);
  return (
    <button
      onClick={onPlay}
      className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ink/5 ${
        isCurrent ? 'bg-accent/10' : ''
      } ${!playable ? 'opacity-60' : ''}`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
        <AutoCover title={track.title} category={track.genre} imageUrl={track.cover_url} size="sm" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={14} fill="currentColor" className="text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`flex items-center gap-1 truncate text-sm font-semibold ${
            isCurrent ? 'text-accent' : ''
          }`}
        >
          {!playable && <AlertCircle size={10} className="shrink-0 text-yellow-300" />}
          {track.title}
        </p>
        <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
      </div>
      <span className="shrink-0">
        <TrackLikeButton trackId={track.id} size={14} />
      </span>
    </button>
  );
}

function SkeletonRow({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-card" />
      ))}
    </div>
  ) : (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:-mx-6 sm:px-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="w-32 shrink-0 space-y-2 sm:w-36">
          <div className="aspect-square animate-pulse rounded-xl bg-bg-card" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-bg-card" />
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg-card/60 p-8 text-center ring-1 ring-line/10">
      <ListMusic size={20} className="mx-auto text-ink-dim" />
      <p className="mt-2 text-sm text-ink-mute">{children}</p>
      <Link
        to="/charts"
        className="mt-3 inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/20 hover:bg-accent/15"
      >
        <Headphones size={12} /> 차트에서 둘러보기
      </Link>
    </div>
  );
}
