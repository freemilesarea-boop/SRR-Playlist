import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLikedTracksStore } from '@/store/likedTracksStore';
import { toggleTrackLike } from '@/lib/libraryApi';
import { recordPlayEvent } from '@/lib/aiCuration';
import { getAnonymousId } from '@/lib/analytics';
import { logPlaybackEventV2 } from '@/lib/playbackEventsV2';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';

interface Props {
  /** 최소: trackId. 가능하면 track 전체 (snapshot 저장용) */
  trackId: string;
  track?: TrackRow | null;
  size?: number;
  className?: string;
  /** 부모 onClick 막기 (행 안에서 사용 시) */
  stopPropagation?: boolean;
}

export default function TrackLikeButton({
  trackId,
  track,
  size = 16,
  className = '',
  stopPropagation = true,
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { isLiked, set, init } = useLikedTracksStore();
  const liked = isLiked(trackId);
  const [bumping, setBumping] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void init(userId);
  }, [userId, init]);

  async function toggle(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (busy) return;
    setBusy(true);
    const next = !liked;
    set(trackId, next); // optimistic
    setBumping(true);
    setTimeout(() => setBumping(false), 280);

    try {
      const target: TrackRow | { id: string } = track ?? { id: trackId };
      const res = await toggleTrackLike(target, next, userId);
      // AI 큐레이션 behavior — like/unlike (정산 미영향)
      void recordPlayEvent({ trackId, eventType: next ? 'like' : 'unlike', anonId: getAnonymousId() });
      // X4.3.1 — playback_events_v2 like/unlike (parallel layer, behavior_score 영향 없음)
      // 0279: RLS 가 session_id 필수 → like 토글 단위 synthetic session (anonId + Date.now)
      void logPlaybackEventV2({
        trackId, eventType: next ? 'like' : 'unlike',
        sessionId: `like-${getAnonymousId()}-${Date.now()}`,
        anonymousId: getAnonymousId(),
      });
      if (res.warning) {
        // DB 실패했지만 localStorage 에 저장됨 — 한 번만 안내
        toast.info(
          '좋아요는 보관함에 저장됐어요. (DB 마이그레이션 0005 미적용 — 기기간 동기화는 안 됨)',
        );
      } else if (next) {
        // 너무 시끄럽지 않게 토스트는 첫 좋아요시에만 — 일단 생략
      }
    } catch {
      // 정말 의외의 에러 — 롤백
      set(trackId, !next);
      toast.error('좋아요 저장에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={liked ? '좋아요 취소' : '좋아요'}
      title={liked ? '좋아요 취소' : '좋아요'}
      className={`inline-flex shrink-0 items-center justify-center rounded-full p-1.5 transition ${
        liked ? 'text-rose-400' : 'text-ink-mute hover:text-ink'
      } ${className}`}
    >
      <Heart
        size={size}
        fill={liked ? 'currentColor' : 'none'}
        className={`transition-transform duration-smooth ease-emphasized ${
          bumping ? 'scale-125' : 'scale-100'
        }`}
      />
    </button>
  );
}
