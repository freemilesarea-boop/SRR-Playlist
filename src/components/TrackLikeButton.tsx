import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLikedTracksStore } from '@/store/likedTracksStore';
import { likeTrack, unlikeTrack } from '@/lib/libraryApi';

interface Props {
  trackId: string;
  size?: number;
  className?: string;
  /** 부모 onClick 막기 (테이블 행 안에서 사용 시) */
  stopPropagation?: boolean;
}

export default function TrackLikeButton({
  trackId,
  size = 16,
  className = '',
  stopPropagation = true,
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { isLiked, set, init } = useLikedTracksStore();
  const liked = isLiked(trackId);
  const [bumping, setBumping] = useState(false);

  // 초기 1회 로드
  useEffect(() => {
    void init(userId);
  }, [userId, init]);

  async function toggle(e: React.MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    const next = !liked;
    set(trackId, next); // optimistic
    setBumping(true);
    setTimeout(() => setBumping(false), 280);
    try {
      if (next) await likeTrack(trackId, userId);
      else await unlikeTrack(trackId, userId);
    } catch {
      // 롤백
      set(trackId, !next);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={liked ? '좋아요 취소' : '좋아요'}
      title={liked ? '좋아요 취소' : '좋아요'}
      className={`group/heart inline-flex shrink-0 items-center justify-center rounded-full p-1.5 transition ${
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
