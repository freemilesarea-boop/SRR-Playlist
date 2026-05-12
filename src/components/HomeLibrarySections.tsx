import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, AlertCircle, ChevronRight } from 'lucide-react';
import {
  fetchContinueListening,
  fetchRecentlyPlayedTracks,
  type ContinueListening,
} from '@/lib/libraryApi';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import type { TrackRow } from '@/types/db';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';

export default function HomeLibrarySections() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const [cont, setCont] = useState<ContinueListening | null>(null);
  const [recent, setRecent] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchContinueListening(userId),
      fetchRecentlyPlayedTracks(userId, 10),
    ])
      .then(([c, r]) => {
        if (!alive) return;
        setCont(c);
        setRecent(r);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  function play(tracks: TrackRow[], idx: number) {
    const playable = tracks.filter((t) => isPlayableUrl(t.audio_url));
    if (playable.length === 0) {
      toast.info('재생 가능한 음원이 없어요.');
      return;
    }
    const start = isPlayableUrl(tracks[idx]?.audio_url)
      ? idx
      : tracks.findIndex((t) => isPlayableUrl(t.audio_url));
    setQueue(tracks, Math.max(0, start), null);
  }

  if (loading) return null;
  if (!cont?.track && recent.length === 0) return null;

  return (
    <>
      {/* 이어듣기 */}
      {cont?.track && (
        <section className="space-y-2">
          <h2 className="px-0.5 text-xs font-bold uppercase tracking-wider text-accent">
            이어듣기
          </h2>
          <button
            onClick={() => play([cont.track!], 0)}
            className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-bg-card p-3 shadow-card ring-1 ring-line/10 transition hover:-translate-y-0.5"
          >
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-line/10">
              <AutoCover
                title={cont.track.title}
                category={cont.track.genre}
                imageUrl={cont.track.cover_url}
                size="sm"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Play size={16} fill="currentColor" />
              </div>
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-bold">{cont.track.title}</p>
              <p className="truncate text-xs text-ink-mute">{cont.track.artist ?? '—'}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${
                      cont.duration_sec && cont.duration_sec > 0
                        ? Math.min(100, (cont.position_sec / cont.duration_sec) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-bg">
              이어듣기
            </span>
          </button>
        </section>
      )}

      {/* 최근 들은 음악 */}
      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between px-0.5">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">최근 들은 음악</h2>
            <Link to="/library" className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:underline">
              전체 보기
              <ChevronRight size={12} />
            </Link>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {recent.map((t, i) => (
              <button
                key={t.id}
                onClick={() => play(recent, i)}
                className="group w-28 shrink-0 space-y-1.5 text-left sm:w-32"
              >
                <div className="relative aspect-square overflow-hidden rounded-xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                  <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="sm" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play size={16} fill="currentColor" className="text-white" />
                  </div>
                  {!isPlayableUrl(t.audio_url) && (
                    <AlertCircle size={11} className="absolute left-1.5 top-1.5 text-yellow-300" />
                  )}
                </div>
                <p
                  className={`truncate px-0.5 text-xs font-semibold ${
                    currentTrackId === t.id ? 'text-accent' : ''
                  }`}
                >
                  {t.title}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
