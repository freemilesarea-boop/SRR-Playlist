import { Link } from 'react-router-dom';
import { Music, Sparkles } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';

interface Props {
  playlist: PlaylistRow;
  /** 재생 가능한 트랙 수 (0이면 배지로 “음원 없음” 표시) */
  playableCount?: number;
  /** 트랙 총합 */
  totalCount?: number;
}

export default function PlaylistCard({ playlist, playableCount, totalCount }: Props) {
  const showCount = typeof totalCount === 'number';
  const noAudio = showCount && (playableCount ?? 0) === 0;

  return (
    <Link to={`/playlist/${playlist.id}`} className="group block">
      <div className="card overflow-hidden p-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-accent-soft/60 via-bg-hover to-black">
          {playlist.thumbnail_url ? (
            <img
              src={playlist.thumbnail_url}
              alt={playlist.title}
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-mute">
              <Music size={32} />
            </div>
          )}

          {showCount && (
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium backdrop-blur">
              {noAudio ? (
                <>
                  <Sparkles size={10} className="text-yellow-300" />
                  <span className="text-yellow-200">음원 준비중</span>
                </>
              ) : (
                <span className="text-ink">
                  {playableCount}/{totalCount} 재생가능
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <h3 className="line-clamp-1 text-sm font-semibold">{playlist.title}</h3>
          {playlist.description && (
            <p className="line-clamp-2 text-xs text-ink-mute">{playlist.description}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
