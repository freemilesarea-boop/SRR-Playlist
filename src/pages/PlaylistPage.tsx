import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Heart, Play, Shuffle, Music, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchPlaylist, fetchPlaylistTracks, toggleLike, fetchLikedIds, logRecentPlay } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { formatTime } from '@/lib/format';
import { isPlayableTrack, countPlayable } from '@/lib/audio';
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

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    Promise.all([fetchPlaylist(id), fetchPlaylistTracks(id)])
      .then(([p, t]) => {
        if (!alive) return;
        setPlaylist(p);
        setTracks(t);
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
      toast.info('이 플레이리스트에는 아직 곡이 없어요.');
      return;
    }
    if (!hasAnyPlayable) {
      toast.info('아직 재생할 수 있는 음원이 없어요. 관리자 페이지에서 업로드해주세요.');
      return;
    }
    // 재생 가능한 첫 트랙으로 진입 보정
    let resolvedStart = startIndex;
    if (!isPlayableTrack(tracks[resolvedStart])) {
      const nextPlayable = tracks.findIndex(isPlayableTrack);
      if (nextPlayable >= 0) resolvedStart = nextPlayable;
    }
    setShuffle(shuffle);
    setQueue(tracks, resolvedStart, playlist);
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
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-accent-soft/40 via-bg-soft to-black sm:aspect-[2/1]">
        {playlist.thumbnail_url ? (
          <img
            src={playlist.thumbnail_url}
            alt={playlist.title}
            className="h-full w-full object-cover opacity-70"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-mute">
            <Music size={64} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
        <Link
          to="/"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-5">
          <p className="text-xs text-ink-mute">{playlist.category}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{playlist.title}</h1>
          {playlist.description && (
            <p className="text-sm text-ink-mute line-clamp-2">{playlist.description}</p>
          )}
          {totalCount > 0 && (
            <p className="flex items-center gap-1 text-xs text-ink-mute">
              {hasAnyPlayable ? (
                <>
                  <CheckCircle2 size={12} className="text-emerald-400" />
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
      </div>

      {/* Track list */}
      <ul className="divide-y divide-white/5 px-4 sm:px-6">
        {tracks.length === 0 && (
          <li className="py-10 text-center text-sm text-ink-mute">
            트랙이 없어요. 관리자 페이지에서 트랙을 추가해주세요.
          </li>
        )}
        {tracks.map((t, idx) => {
          const isCurrent = currentTrackId === t.id && currentPlaylistId === playlist.id;
          const playable = isPlayableTrack(t);
          return (
            <li
              key={t.id}
              onClick={() => handlePlay(idx, false)}
              className={`flex cursor-pointer items-center gap-3 py-3 transition hover:bg-white/5 ${
                isCurrent ? 'text-accent' : ''
              } ${!playable ? 'opacity-60' : ''}`}
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
                <p className="flex items-center gap-1 truncate text-sm font-medium">
                  {!playable && <AlertCircle size={10} className="shrink-0 text-yellow-300" />}
                  {t.title}
                </p>
                <p className="truncate text-xs text-ink-mute">
                  {!playable ? '샘플 음원 없음' : (t.artist ?? '—')}
                </p>
              </div>
              <div className="text-xs text-ink-dim">{t.duration ? formatTime(t.duration) : ''}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
