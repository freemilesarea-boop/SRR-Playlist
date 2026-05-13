import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';
import { useAuthStore } from '@/store/authStore';
import {
  isPlaylistFollowed,
  togglePlaylistFollow,
  isPlaylistFollowedLocal,
} from '@/lib/playlistFollowApi';
import { toast } from '@/store/toastStore';

interface Props {
  playlist: PlaylistRow;
  size?: number;
  /**
   * 'pill' = "팔로우 / 팔로잉" 라벨 + 아이콘 (Hero 등 본문)
   * 'icon' = 아이콘만 (카드 코너)
   * 'compact' = 작은 텍스트 버튼 (목록 행)
   */
  variant?: 'pill' | 'icon' | 'compact';
  /** follower 수 라벨 옆 표시 */
  followerCount?: number;
  className?: string;
  /** 부모 카드 클릭(재생/이동) 으로 전파되지 않게 */
  stopPropagation?: boolean;
  /** 변경 후 follower count 등 갱신용 콜백 (optional) */
  onChanged?: (followed: boolean) => void;
}

export default function PlaylistFollowButton({
  playlist,
  size = 16,
  variant = 'pill',
  followerCount,
  className = '',
  stopPropagation = true,
  onChanged,
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [followed, setFollowed] = useState<boolean>(() =>
    isPlaylistFollowedLocal(playlist.id),
  );
  const [busy, setBusy] = useState(false);

  // 마운트 시 DB 동기화 (로그인 사용자)
  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await isPlaylistFollowed(playlist.id, userId);
      if (alive) setFollowed(v);
    })();
    return () => {
      alive = false;
    };
  }, [playlist.id, userId]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (stopPropagation) {
        e.stopPropagation();
        e.preventDefault();
      }
      if (busy) return;
      setBusy(true);
      const next = !followed;
      setFollowed(next); // optimistic
      try {
        const res = await togglePlaylistFollow(playlist, next, userId);
        if (!res.ok) {
          setFollowed(!next);
          toast.error('팔로우 처리에 실패했어요.');
          return;
        }
        toast.success(next ? '플레이리스트를 팔로우했어요' : '팔로우를 해제했어요');
        if (res.warning && import.meta.env.DEV) {
          console.debug('[follow] warning:', res.warning);
        }
        onChanged?.(next);
      } catch {
        setFollowed(!next);
        toast.error('팔로우 처리 중 오류가 발생했어요.');
      } finally {
        setBusy(false);
      }
    },
    [busy, followed, playlist, userId, stopPropagation, onChanged],
  );

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        aria-label={followed ? '팔로우 해제' : '팔로우'}
        title={followed ? '팔로잉 (클릭 시 해제)' : '팔로우'}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
          followed
            ? 'bg-accent text-bg ring-1 ring-accent/40'
            : 'bg-ink/5 text-ink-mute ring-1 ring-line/15 hover:bg-ink/10 hover:text-ink'
        } ${className}`}
      >
        {followed ? <Check size={size} /> : <Bell size={size} />}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
          followed
            ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
            : 'bg-ink/5 text-ink-mute ring-1 ring-line/15 hover:bg-ink/10'
        } ${className}`}
      >
        {followed ? <Check size={11} /> : <Bell size={11} />}
        {followed ? '팔로잉' : '팔로우'}
        {typeof followerCount === 'number' && followerCount > 0 && (
          <span className="ml-1 text-ink-dim">· {followerCount.toLocaleString()}</span>
        )}
      </button>
    );
  }

  // pill (default)
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
        followed
          ? 'bg-accent text-bg shadow-sm hover:bg-accent/90'
          : 'bg-white/10 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20'
      } ${className}`}
    >
      {followed ? <Check size={size} /> : <Bell size={size} />}
      {followed ? '팔로잉' : '팔로우'}
      {typeof followerCount === 'number' && followerCount > 0 && (
        <span className={`ml-0.5 font-medium ${followed ? 'text-bg/70' : 'text-white/70'}`}>
          · {followerCount.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/** "팔로워 N명" 표시용 — 클릭 액션 없는 정적 라벨 */
export function PlaylistFollowerCountBadge({
  count,
  className = '',
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-ink-mute ring-1 ring-line/10 ${className}`}
    >
      <BellOff size={9} />
      팔로워 {count.toLocaleString()}
    </span>
  );
}
