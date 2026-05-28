import { useEffect, useState } from 'react';
import { Play, Sparkles, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fetchPersonalizedTracks,
  fetchPersonalizedPlaylists,
  recommendCollabForUser,
  type RecommendedTrack,
  type PersonalizedPlaylist,
} from '@/lib/recommendationApi';
import { supabase } from '@/lib/supabase';
import type { TrackRow } from '@/types/db';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks, getTrackPlaybackState } from '@/lib/trackPlayability';
import AutoCover from '@/components/AutoCover';
import TrackStateBadge from '@/components/TrackStateBadge';
import { gradientStyle } from '@/lib/cover';
import { toast } from '@/store/toastStore';

/**
 * 청취 이력 기반 개인화 추천 섹션.
 * - 상단: 취향(장르/무드)에 맞는 추천 신곡 레일
 * - 하단: 자주 듣는 분위기의 플레이리스트 레일
 * 비로그인/콜드스타트는 RPC 내부에서 최신·인기로 폴백하므로 항상 무언가 노출 가능.
 */
export default function HomePersonalized({ trackLimit = 12, playlistLimit = 8 }: {
  trackLimit?: number;
  playlistLimit?: number;
}) {
  const [tracks, setTracks] = useState<RecommendedTrack[]>([]);
  const [playlists, setPlaylists] = useState<PersonalizedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  // 추천 출처 — 'collab' (청취 행동 기반) / 'baseline' (기존 RPC, 콜드스타트 fallback)
  const [source, setSource] = useState<'collab' | 'baseline'>('baseline');

  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // 항상 baseline 먼저 시도 (콜드스타트 + 비로그인 안전)
        const [baseline, pls] = await Promise.all([
          fetchPersonalizedTracks(trackLimit),
          fetchPersonalizedPlaylists(playlistLimit),
        ]);
        let finalTracks = baseline;
        let finalSource: 'collab' | 'baseline' = 'baseline';

        // 로그인 사용자만 user-based collab 추가 시도
        if (session?.user?.id) {
          const collab = await recommendCollabForUser(session.user.id, trackLimit);
          // 청취 이력이 충분해 의미있는 collab 결과가 나왔을 때만 사용 (>= 6)
          if (collab.length >= 6) {
            const { data } = await supabase
              .from('tracks')
              .select('*')
              .in('id', collab.map((c) => c.track_id))
              .eq('visibility_status', 'approved')
              .is('removed_at', null);
            if (data && data.length >= 6) {
              const byId = new Map((data as TrackRow[]).map((t) => [t.id, t]));
              // collab score desc 순서 보존
              const hydrated = collab
                .map((c) => byId.get(c.track_id))
                .filter((t): t is TrackRow => !!t)
                .map((t): RecommendedTrack => ({
                  ...t,
                  score: 0,
                  score_reasons: ['같이 들은 곡'],
                }));
              if (hydrated.length >= 6) {
                finalTracks = hydrated;
                finalSource = 'collab';
              }
            }
          }
        }

        if (!alive) return;
        setTracks(finalTracks);
        setPlaylists(pls);
        setSource(finalSource);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // session 변경 시(로그인/로그아웃) 재요청
  }, [trackLimit, playlistLimit, session?.user?.id]);

  function play(idx: number) {
    if (!useAuthStore.getState().session) {
      toast.info('로그인 후 이용해주세요.');
      useGateStore.getState().open('login');
      return;
    }
    if (tracks.length === 0) return;
    if (!isPlayableUrl(tracks[idx]?.audio_url)) return;
    const { playable } = filterPlayableTracks(tracks);
    if (playable.length === 0) {
      toast.info('아직 재생 가능한 곡이 없어요.');
      return;
    }
    const targetId = tracks[idx].id;
    const start = Math.max(0, playable.findIndex((t) => t.id === targetId));
    setQueue(playable, start < 0 ? 0 : start, null);
  }

  if (loading) return null;
  if (tracks.length === 0 && playlists.length === 0) return null;

  return (
    <div className="space-y-10 sm:space-y-12">
      {tracks.length > 0 && (
        <section className="space-y-3">
          <div className="px-0.5">
            <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
              <Heart size={16} className="text-accent" />
              {source === 'collab'
                ? '비슷한 취향 사용자가 들은 곡'
                : session
                  ? '최근 취향에 맞는 추천곡'
                  : '지금 인기 있는 신곡'}
            </h2>
            <p className="mt-0.5 text-xs text-ink-mute">
              {source === 'collab'
                ? '내가 들은 곡과 같은 청취 패턴 기반'
                : session
                  ? '자주 듣는 장르·분위기 기반'
                  : '최근 출시된 인기 음원'}
            </p>
          </div>

          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {tracks.map((t, i) => {
              const state = getTrackPlaybackState(t);
              const playable = state === 'ready';
              const reason = t.score_reasons?.[0];
              return (
                <button
                  key={t.id}
                  onClick={playable ? () => play(i) : undefined}
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
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.5)' }}>
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        </span>
                      </div>
                    )}
                    {!playable && (
                      <span className="absolute left-1.5 top-1.5">
                        <TrackStateBadge state={state} variant="pill" />
                      </span>
                    )}
                    {playable && reason && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-accent/85 px-1.5 py-0.5 text-[9px] font-bold text-black backdrop-blur">
                        {reason}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5 px-0.5">
                    <p className={`truncate text-xs font-semibold ${currentTrackId === t.id ? 'text-accent' : ''}`}>
                      {t.title}
                    </p>
                    <p className="truncate text-[10px] text-ink-mute">{t.artist ?? '—'}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {playlists.length > 0 && (
        <section className="space-y-3">
          <div className="px-0.5">
            <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
              <Sparkles size={16} className="text-accent" />
              {session ? '자주 듣는 분위기의 플레이리스트' : '인기 플레이리스트'}
            </h2>
            <p className="mt-0.5 text-xs text-ink-mute">
              {session ? '취향 태그가 겹치는 플레이리스트' : '많이 듣는 플레이리스트'}
            </p>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {playlists.map((p) => (
              <Link
                key={p.id}
                to={`/playlist/${p.id}`}
                className="group w-36 shrink-0 space-y-2 sm:w-44"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition duration-smooth ease-emphasized group-hover:-translate-y-1 group-hover:shadow-lift">
                  <AutoCover title={p.title} category={p.category} imageUrl={p.cover_url} size="lg" />
                  {!p.cover_url && (
                    <div className="pointer-events-none absolute inset-0 opacity-30" style={gradientStyle(p.category || p.title)} />
                  )}
                </div>
                <div className="space-y-0.5 px-0.5">
                  <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">{p.title}</h3>
                  <p className="line-clamp-1 text-xs text-ink-mute">
                    {p.category ?? '플레이리스트'} · {p.track_count}곡
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
