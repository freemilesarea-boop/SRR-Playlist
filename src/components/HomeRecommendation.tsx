import { useEffect, useMemo, useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import {
  recommendTracksByContext,
  type RecommendedTrack,
} from '@/lib/recommendationApi';
import { getKstTimeSlot, getTimeSlotLabel } from '@/lib/timeTheme';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks, getTrackPlaybackState } from '@/lib/trackPlayability';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import TrackStateBadge from '@/components/TrackStateBadge';
import { toast } from '@/store/toastStore';

interface Props {
  /** business 컨텍스트로 추천하고 싶을 때 (사업자 페이지에서 사용) */
  businessType?: string | null;
  /** 섹션 제목 커스터마이즈 */
  title?: string;
  subtitle?: string;
  limit?: number;
}

export default function HomeRecommendation({
  businessType = null,
  title,
  subtitle,
  limit = 8,
}: Props) {
  const slot = getKstTimeSlot();
  const slotLabel = getTimeSlotLabel(slot);

  const [tracks, setTracks] = useState<RecommendedTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    recommendTracksByContext({
      time_slot: slot,
      business_type: businessType,
      limit,
    })
      .then((rows) => {
        if (alive) setTracks(rows);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slot, businessType, limit]);

  const heading = useMemo(() => {
    if (title) return title;
    if (businessType) return `🏪 지금 매장에 어울리는 추천`;
    return `${slotLabel}에 어울리는 추천`;
  }, [title, businessType, slotLabel]);

  const sub = useMemo(() => {
    if (subtitle) return subtitle;
    if (businessType) return `업종: ${businessType} · KST ${slotLabel}`;
    return `KST ${slotLabel} 기준`;
  }, [subtitle, businessType, slotLabel]);

  function play(idx: number) {
    // 우선순위: login gate > empty queue. 비회원은 empty 검사 자체를 돌리지 않음.
    if (!useAuthStore.getState().session) {
      toast.info('로그인 후 이용해주세요.');
      useGateStore.getState().open('login');
      return;
    }
    if (tracks.length === 0) return;
    // 클릭된 트랙이 재생 불가면 변경 없음 (카드 onClick 에서도 막혀 있지만 이중 방어)
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
  if (tracks.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="px-0.5">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
          <Sparkles size={16} className="text-accent" />
          {heading}
        </h2>
        <p className="mt-0.5 text-xs text-ink-mute">{sub}</p>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
        {tracks.map((t, i) => {
          const state = getTrackPlaybackState(t);
          const playable = state === 'ready';
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
                {/* 재생버튼 hover overlay 는 playable 일 때만 */}
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
                {playable && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                    +{t.score}
                  </span>
                )}
              </div>
              <div className="space-y-0.5 px-0.5">
                <p
                  className={`truncate text-xs font-semibold ${
                    currentTrackId === t.id ? 'text-accent' : ''
                  }`}
                >
                  {t.title}
                </p>
                <p className="truncate text-[10px] text-ink-mute">{t.artist ?? '—'}</p>
              </div>
              {/* 좋아요는 hover 시만 */}
              <div className="hidden">
                <TrackLikeButton trackId={t.id} track={t} size={12} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
