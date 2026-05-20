import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Play, ChevronLeft, AlertCircle, Music } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { applyDemoMode } from '@/lib/demoMode';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks, getTrackPlaybackState } from '@/lib/trackPlayability';
import TrackStateBadge from '@/components/TrackStateBadge';
import { usePlayerStore } from '@/store/playerStore';
import { gradientStyle } from '@/lib/cover';
import { trackShareUrl } from '@/lib/shareApi';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import ShareButton from '@/components/ShareButton';
import AddToPlaylistButton from '@/components/AddToPlaylistButton';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';

export default function TrackSharePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setQueue = usePlayerStore((s) => s.setQueue);

  const [track, setTrack] = useState<TrackRow | null>(null);
  const [related, setRelated] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('tracks')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!alive) return;
      if (error || !data) {
        setTrack(null);
        setLoading(false);
        return;
      }
      const t = applyDemoMode([data as TrackRow])[0];
      setTrack(t);
      // 같은 장르 추천
      if (t.genre) {
        const { data: rel } = await supabase
          .from('tracks')
          .select('*')
          .eq('genre', t.genre)
          .neq('id', t.id)
          .limit(6);
        if (alive) setRelated(applyDemoMode((rel ?? []) as TrackRow[]));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  function play(tracks: TrackRow[], idx = 0) {
    const { playable, dropped } = filterPlayableTracks(tracks);
    if (playable.length === 0) {
      toast.info('샘플 음원이 아직 없습니다.');
      return;
    }
    const origStart = tracks[idx];
    const start = origStart ? Math.max(0, playable.findIndex((t) => t.id === origStart.id)) : 0;
    if (dropped.length > 0) {
      toast.info(`재생 불가 ${dropped.length}곡은 제외하고 재생할게요`);
    }
    setQueue(playable, start < 0 ? 0 : start, null);
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-ink-mute">불러오는 중…</div>;
  }
  if (!track) {
    return (
      <div className="space-y-3 px-4 py-12 text-center sm:px-6">
        <Music size={28} className="mx-auto text-ink-dim" />
        <p className="text-sm text-ink-mute">곡을 찾을 수 없어요.</p>
        <Link to="/" className="inline-flex rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover">
          홈으로
        </Link>
      </div>
    );
  }

  const playable = isPlayableUrl(track.audio_url);

  return (
    <div className="pb-8">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 scale-110 opacity-70 blur-3xl"
          style={gradientStyle(track.genre || track.title)}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-bg/60 to-bg" />

        <div className="relative flex flex-col items-center gap-5 px-5 pt-12 pb-8 sm:flex-row sm:items-end sm:px-7 sm:pt-16">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur"
            aria-label="뒤로"
          >
            <ChevronLeft size={18} className="text-white" />
          </button>

          <div className="aspect-square w-40 shrink-0 overflow-hidden rounded-2xl shadow-elevated ring-1 ring-white/15 sm:w-52">
            <AutoCover title={track.title} category={track.genre} imageUrl={track.cover_url} size="xl" />
          </div>

          <div className="space-y-2 text-center sm:text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
              지금 들어보세요
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">
              {track.title}
            </h1>
            <p className="text-sm text-white/80">{track.artist ?? '—'}</p>
            {track.genre && (
              <span className="inline-block rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur">
                {track.genre}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-bg/90 px-4 py-3 backdrop-blur sm:px-6">
        <button
          onClick={() => play([track], 0)}
          disabled={!playable}
          className="btn-primary px-5 py-2.5"
        >
          <Play size={16} fill="currentColor" /> 재생
        </button>
        <TrackLikeButton trackId={track.id} track={track} size={18} stopPropagation={false} />
        <AddToPlaylistButton trackId={track.id} variant="icon" />
        <div className="ml-auto">
          <ShareButton
            title={`듣다 — ${track.title}`}
            text={track.artist ?? '지금 듣고 있는 곡'}
            url={trackShareUrl(track.id)}
            targetType="track"
            targetId={track.id}
            variant="pill"
          />
        </div>
      </div>

      {!playable && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-yellow-500/10 p-3 text-xs ring-1 ring-yellow-500/30 sm:mx-6">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-yellow-300" />
          <span className="text-ink-mute">샘플 음원이 아직 없어요. 운영자가 업로드 후 재생됩니다.</span>
        </div>
      )}

      {/* 같은 장르 추천 */}
      {related.length > 0 && (
        <section className="space-y-3 px-4 pt-6 sm:px-6">
          <h2 className="text-lg font-bold tracking-tight">같은 장르 추천</h2>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {related.map((t) => {
              const state = getTrackPlaybackState(t);
              const playable = state === 'ready';
              return (
                <button
                  key={t.id}
                  onClick={
                    playable
                      ? () => play([t, ...related.filter((x) => x.id !== t.id)], 0)
                      : undefined
                  }
                  aria-disabled={!playable}
                  title={!playable ? '재생할 수 없는 트랙입니다' : undefined}
                  className={`group w-32 shrink-0 space-y-1.5 text-left sm:w-36 ${
                    playable ? '' : 'cursor-not-allowed opacity-[0.55]'
                  }`}
                >
                  <div className="relative aspect-square overflow-hidden rounded-xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                    <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="md" />
                    {playable && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 8px 22px rgb(var(--color-accent) / 0.5)' }}>
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
                  <p className="truncate px-0.5 text-xs font-semibold">{t.title}</p>
                  <p className="truncate px-0.5 text-[10px] text-ink-mute">{t.artist ?? '—'}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
