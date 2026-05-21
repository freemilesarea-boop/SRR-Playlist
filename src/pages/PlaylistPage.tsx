import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Heart, Play, Shuffle, AlertCircle, CheckCircle2, Music } from 'lucide-react';
import { fetchPlaylistCurator } from '@/lib/curatorApi';
import { fetchPlaylist, fetchPlaylistTracks, fetchAutoPlaylistTracks, toggleLike, fetchLikedIds, logRecentPlay } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/format';
import { isPlayableTrack, countPlayable } from '@/lib/audio';
import { filterPlayableTracks, getTrackPlaybackState } from '@/lib/trackPlayability';
import TrackStateBadge from '@/components/TrackStateBadge';
import { gradientStyle } from '@/lib/cover';
import { playlistShareUrl } from '@/lib/shareApi';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import PlaylistFollowButton from '@/components/PlaylistFollowButton';
import { fetchPlaylistFollowCounts } from '@/lib/playlistFollowApi';
import ShareButton from '@/components/ShareButton';
import { toast } from '@/store/toastStore';

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuthStore();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const currentPlaylistId = usePlayerStore((s) => s.playlist?.id);
  const playing = usePlayerStore((s) => s.playing);

  const [playlist, setPlaylist] = useState<PlaylistRow | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [curator, setCurator] = useState<Awaited<ReturnType<typeof fetchPlaylistCurator>>>(null);

  // 큐레이터 조회 (0013 미적용 / 작성자 없음 시 null)
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void fetchPlaylistCurator(id).then((c) => {
      if (alive) setCurator(c);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // 팔로워 수 조회 (RPC, 0012 미적용 시 빈 맵 → 0 으로 표시)
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void fetchPlaylistFollowCounts([id]).then((m) => {
      if (alive) setFollowerCount(m.get(id) ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    // 플리 먼저 조회 → is_auto 면 실시간 매칭, 아니면 저장된 playlist_tracks
    fetchPlaylist(id)
      .then(async (p) => {
        if (!alive) return;
        setPlaylist(p);
        const t = p?.is_auto
          ? await fetchAutoPlaylistTracks(id)
          : await fetchPlaylistTracks(id);
        if (alive) setTracks(t);
      })
      .finally(() => alive && setLoading(false));
    if (user) {
      fetchLikedIds(user.id).then((ids) => alive && setLiked(ids.includes(id)));
    }
    return () => {
      alive = false;
    };
  }, [id, user]);

  const playableCount = useMemo(() => countPlayable(tracks), [tracks]);
  const hasAnyPlayable = playableCount > 0;
  const totalCount = tracks.length;

  function handlePlay(startIndex = 0, shuffle = false) {
    if (!playlist) return;
    if (tracks.length === 0) {
      if (useAuthStore.getState().session) toast.info('이 플레이리스트에는 아직 곡이 없어요.');
      return;
    }
    // 재생 가능 트랙만 큐에 — 무한 next() 캐스케이드 차단
    const { playable, dropped } = filterPlayableTracks(tracks);
    if (playable.length === 0) {
      if (useAuthStore.getState().session) toast.info('아직 재생 가능한 곡이 없어요.');
      return;
    }
    // 원본 시작 트랙이 살아남았는지 확인 → 새 인덱스로 매핑
    const originalStart = tracks[startIndex];
    let resolvedStart = 0;
    if (originalStart) {
      const found = playable.findIndex((t) => t.id === originalStart.id);
      resolvedStart = found >= 0 ? found : 0;
    }
    if (dropped.length > 0) {
      toast.info(`재생 불가 ${dropped.length}곡은 제외하고 재생할게요`);
    }
    setShuffle(shuffle);
    setQueue(playable, resolvedStart, playlist, { type: 'catalog', id: playlist.id });
    if (user) void logRecentPlay(user.id, playlist.id).catch(() => {});
  }

  async function handleLike() {
    if (!user || !id) return;
    const prev = liked;
    setLiked(!prev);
    try {
      await toggleLike(user.id, id, prev);
    } catch {
      setLiked(prev);
    }
  }

  if (loading) {
    return <div className="p-6 text-ink-mute">불러오는 중…</div>;
  }
  if (!playlist) {
    return <div className="p-6 text-ink-mute">플레이리스트를 찾을 수 없어요.</div>;
  }

  const isAdmin = profile?.role === 'admin';

  return (
    <div className="pb-8">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 scale-110 opacity-90 blur-3xl"
          style={gradientStyle(playlist.category || playlist.title)}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-bg/60 to-bg" />

        <div className="relative flex flex-col gap-5 p-5 pt-12 sm:flex-row sm:items-end sm:gap-6 sm:p-7 sm:pt-16">
          <Link
            to="/"
            className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur"
          >
            <ArrowLeft size={18} />
          </Link>

          <div className="aspect-square w-40 shrink-0 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-line/15 sm:w-52">
            <AutoCover
              title={playlist.title}
              category={playlist.category}
              imageUrl={playlist.thumbnail_url}
              size="xl"
            />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
              {playlist.category}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">
              {playlist.title}
            </h1>
            {playlist.description && (
              <p className="max-w-xl text-sm leading-relaxed text-white/80">
                {playlist.description}
              </p>
            )}
            {totalCount > 0 && (
              <p className="flex items-center gap-1 text-xs text-white/70">
                {hasAnyPlayable ? (
                  <>
                    <CheckCircle2 size={12} className="text-emerald-300" />
                    {playableCount}/{totalCount}곡 재생 가능
                  </>
                ) : (
                  <>
                    <AlertCircle size={12} className="text-yellow-300" />
                    음원 준비 중 (0/{totalCount}곡)
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* No-audio banner */}
      {totalCount > 0 && !hasAnyPlayable && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-yellow-500/10 p-3 text-xs ring-1 ring-yellow-500/30 sm:mx-6">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-yellow-300" />
          <div className="flex-1 leading-relaxed text-ink-mute">
            <p className="text-yellow-200">아직 재생할 수 있는 음원이 없어요</p>
            <p className="mt-0.5">
              {isAdmin
                ? '관리자 페이지 → 트랙 업로드 후 이 플레이리스트에 연결하면 바로 재생할 수 있어요.'
                : '운영자가 음원을 업로드하면 재생됩니다. 잠시만 기다려주세요.'}
            </p>
          </div>
          {isAdmin && (
            <Link
              to="/admin"
              className="shrink-0 rounded-md bg-bg-card px-2.5 py-1 text-[11px] hover:bg-bg-hover"
            >
              관리자 →
            </Link>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg/90 px-4 py-3 backdrop-blur sm:px-6">
        <button
          onClick={() => handlePlay(0, false)}
          disabled={!hasAnyPlayable}
          className="btn-primary px-5 py-2.5"
          title={!hasAnyPlayable ? '재생 가능한 음원이 없어요' : '재생'}
        >
          <Play size={16} fill="currentColor" /> 재생
        </button>
        <button
          onClick={() => handlePlay(0, true)}
          disabled={!hasAnyPlayable}
          className="btn-ghost px-3 py-2.5"
          aria-label="셔플 재생"
          title={!hasAnyPlayable ? '재생 가능한 음원이 없어요' : '셔플 재생'}
        >
          <Shuffle size={16} />
        </button>
        <button
          onClick={handleLike}
          className={`btn-ghost px-3 py-2.5 ${liked ? 'text-accent' : ''}`}
          aria-label="좋아요"
        >
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <ShareButton
          title={`듣다 — ${playlist.title}`}
          text={playlist.description ?? `${playlist.category} 플레이리스트`}
          url={playlistShareUrl(playlist.id)}
          targetType="playlist"
          targetId={playlist.id}
          variant="pill"
        />
        <PlaylistFollowButton
          playlist={playlist}
          variant="pill"
          followerCount={followerCount}
          stopPropagation={false}
          onChanged={(now) => setFollowerCount((c) => Math.max(0, c + (now ? 1 : -1)))}
        />
      </div>

      {/* Curator card (0013 적용 + 플리에 created_by 가 있을 때만 노출) */}
      {curator && (
        <Link
          to={`/curator/${curator.handle}`}
          className="mx-4 mb-4 mt-2 flex items-center gap-3 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 transition hover:-translate-y-0.5 sm:mx-6"
        >
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-line/15">
            {curator.profile_image_url ? (
              <img src={curator.profile_image_url} alt={curator.display_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-ink/5 text-sm font-bold">
                {curator.display_name.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">큐레이터</p>
            <p className="flex items-center gap-1 truncate text-sm font-bold">
              {curator.display_name}
              {curator.is_verified && <CheckCircle2 size={12} className="text-sky-400" />}
            </p>
            {curator.bio && <p className="truncate text-xs text-ink-mute">{curator.bio}</p>}
          </div>
          <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
            프로필 보기
          </span>
        </Link>
      )}

      {/* Track list */}
      <ul className="divide-y divide-line/10 px-4 sm:px-6">
        {tracks.length === 0 && (
          <li className="py-10 text-center text-sm text-ink-mute">
            트랙이 없어요. 관리자 페이지에서 트랙을 추가해주세요.
          </li>
        )}
        {tracks.map((t, idx) => {
          const isCurrent = currentTrackId === t.id && currentPlaylistId === playlist.id;
          const state = getTrackPlaybackState(t);
          const playable = state === 'ready';
          return (
            <li
              key={t.id}
              onClick={playable ? () => handlePlay(idx, false) : undefined}
              aria-disabled={!playable}
              title={!playable ? '재생할 수 없는 트랙입니다' : undefined}
              className={`flex items-center gap-3 py-3 transition ${
                playable ? 'cursor-pointer hover:bg-ink/5' : 'cursor-not-allowed opacity-[0.55]'
              } ${isCurrent ? 'text-accent' : ''}`}
            >
              <div className="w-6 text-right text-xs text-ink-dim">
                {isCurrent && playing ? <span className="text-accent">♪</span> : idx + 1}
              </div>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-card">
                {t.cover_url ? (
                  <img src={t.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-dim">
                    <Music size={14} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">{t.title}</span>
                  {!playable && <TrackStateBadge state={state} variant="pill" className="shrink-0" />}
                </p>
                <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
              </div>
              <span className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100">
                <TrackLikeButton trackId={t.id} track={t} size={14} />
              </span>
              <div className="text-xs text-ink-dim">{t.duration ? formatTime(t.duration) : ''}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
