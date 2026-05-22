import { useState } from 'react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
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
import { fetchFollowedPlaylists } from '@/lib/playlistFollowApi';
import { useAuthStore } from '@/store/authStore';
import { useLikedTracksStore } from '@/store/likedTracksStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks, getTrackPlaybackState } from '@/lib/trackPlayability';
import TrackStateBadge from '@/components/TrackStateBadge';
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
  const [followedPlaylists, setFollowedPlaylists] = useState<PlaylistRow[]>([]);
  const [recentPlaylists, setRecentPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [overview, lp, fp, rp] = await Promise.all([
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
        fetchFollowedPlaylists(userId),
        userId ? fetchRecentPlaylists(userId, 12) : Promise.resolve([] as PlaylistRow[]),
      ]);
      setData(overview);
      setLikedPlaylists(lp);
      setFollowedPlaylists(fp);
      setRecentPlaylists(rp);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '보관함 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  // 좋아요 store 의 ids 가 바뀌면 (= 다른 화면에서 토글 후 진입) 또는
  // 재로그인/탭 복귀 시에도 최신 데이터를 가져오도록 useFreshFetch 사용.
  const likedIds = useLikedTracksStore((s) => s.ids);
  useFreshFetch(load, [userId, likedIds]);

  const cont = data?.continue ?? null;
  const liked = data?.liked_tracks ?? [];
  const recent = data?.recently_played ?? [];
  const recommended = data?.recommended_playlists ?? [];

  function playTracks(tracks: TrackRow[], startIndex = 0) {
    if (tracks.length === 0) return;
    const { playable, dropped } = filterPlayableTracks(tracks);
    if (playable.length === 0) {
      toast.info('아직 재생 가능한 곡이 없어요.');
      return;
    }
    const origStart = tracks[startIndex];
    const startIdx = origStart ? Math.max(0, playable.findIndex((t) => t.id === origStart.id)) : 0;
    if (dropped.length > 0) {
      toast.info(`재생 불가 ${dropped.length}곡은 제외하고 재생할게요`);
    }
    setQueue(playable, startIdx < 0 ? 0 : startIdx, null);
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
            {recent.map((t, i) => {
              const state = getTrackPlaybackState(t);
              const playable = state === 'ready';
              return (
                <button
                  key={t.id}
                  onClick={playable ? () => playTracks(recent, i) : undefined}
                  aria-disabled={!playable}
                  title={!playable ? '재생할 수 없는 트랙입니다' : undefined}
                  className={`group w-32 shrink-0 space-y-2 text-left sm:w-36 ${
                    playable ? '' : 'cursor-not-allowed opacity-[0.55]'
                  }`}
                >
                  <div className="relative aspect-square overflow-hidden rounded-xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                    <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="md" />
                    {playable && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.5)' }}>
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        </span>
                      </div>
                    )}
                    {!playable && (
                      <span className="absolute left-1.5 top-1.5">
                        <TrackStateBadge state={state} variant="pill" />
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
              );
            })}
          </div>
        )}
      </section>

      {/* 좋아요한 곡 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
            <Heart size={16} className="text-rose-400" fill="currentColor" /> 좋아요한 곡
          </h2>
        </div>
        {loading ? (
          <SkeletonRow vertical />
        ) : liked.length === 0 ? (
          <Empty>아직 저장한 곡이 없어요. 마음에 드는 곡에 ♡를 눌러보세요.</Empty>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            <ul className="divide-y divide-line/10">
              {liked.map((t, i) => (
                <li key={t.id}>
                  <LikedTrackRow
                    track={t}
                    isCurrent={currentTrackId === t.id}
                    onPlay={() => playTracks(liked, i)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 팔로우한 플레이리스트 (업데이트 구독) */}
      <PlaylistRow_
        title="팔로우한 플레이리스트"
        subtitle="새 곡이 추가되면 가장 먼저"
        playlists={followedPlaylists}
        emptyText="아직 팔로우한 플레이리스트가 없어요."
      />

      {/* 좋아요한 플레이리스트 (임시 저장) */}
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
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="이어듣기"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.5)' }}>
              <Play size={18} fill="currentColor" className="ml-0.5" />
            </span>
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
  const state = getTrackPlaybackState(track);
  const playable = state === 'ready';
  return (
    <button
      onClick={playable ? onPlay : undefined}
      aria-disabled={!playable}
      title={!playable ? '재생할 수 없는 트랙입니다' : undefined}
      className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
        playable ? 'hover:bg-ink/5' : 'cursor-not-allowed opacity-[0.55]'
      } ${isCurrent ? 'bg-accent/10' : ''}`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
        <AutoCover title={track.title} category={track.genre} imageUrl={track.cover_url} size="sm" />
        {playable && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-white shadow-card ring-1 ring-white/15">
              <Play size={11} fill="currentColor" className="ml-0.5" />
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`flex items-center gap-1.5 truncate text-sm font-semibold ${
            isCurrent ? 'text-accent' : ''
          }`}
        >
          <span className="truncate">{track.title}</span>
          {!playable && <TrackStateBadge state={state} variant="pill" className="shrink-0" />}
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
