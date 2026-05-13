import { useEffect, useMemo, useState } from 'react';
import { Play, Sparkles, AlertCircle } from 'lucide-react';
import {
  recommendTracksByContext,
  type RecommendedTrack,
} from '@/lib/recommendationApi';
import { getKstTimeSlot, getTimeSlotLabel } from '@/lib/timeTheme';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
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
    if (tracks.length === 0) return;
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
        {tracks.map((t, i) => (
          <button
            key={t.id}
            onClick={() => play(i)}
            className="group w-32 shrink-0 space-y-1.5 text-left sm:w-36"
          >
            <div className="relative aspect-square overflow-hidden rounded-xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
              <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="md" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <Play size={18} fill="currentColor" className="text-white" />
              </div>
              {!isPlayableUrl(t.audio_url) && (
                <AlertCircle size={11} className="absolute left-1.5 top-1.5 text-yellow-300" />
              )}
              <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                +{t.score}
              </span>
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
        ))}
      </div>
    </section>
  );
}
