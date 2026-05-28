import { Link } from 'react-router-dom';
import { Sparkles, Play } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';
import AutoCover from './AutoCover';
import { timeSlotLabel } from '@/lib/format';

interface Props {
  playlist: PlaylistRow;
  /** 재생 가능한 트랙 수 (0이면 “음원 준비중”) */
  playableCount?: number;
  totalCount?: number;
  /** 카드 크기: sm(가로 스크롤), md(그리드 기본), lg(피처드) */
  variant?: 'sm' | 'md' | 'lg';
  /** 대표 커버(내부 음원 자켓). 없으면 thumbnail_url → AutoCover 그라데이션 fallback */
  coverUrl?: string | null;
}

export default function PlaylistCard({
  playlist,
  playableCount,
  totalCount,
  variant = 'md',
  coverUrl,
}: Props) {
  const showCount = typeof totalCount === 'number';
  const noAudio = showCount && (playableCount ?? 0) === 0;
  const coverSize = variant === 'lg' ? 'xl' : variant === 'sm' ? 'md' : 'lg';

  return (
    <Link to={`/playlist/${playlist.id}`} className="group block">
      <div className="space-y-2.5">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition duration-smooth ease-emphasized group-hover:-translate-y-0.5 group-hover:shadow-lift">
          <AutoCover
            title={playlist.title}
            category={playlist.category}
            imageUrl={coverUrl ?? playlist.thumbnail_url}
            size={coverSize}
            useAbstract
          />

          {/* 내부 light highlight */}
          <div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-smooth group-hover:opacity-100"
            style={{
              background:
                'radial-gradient(110% 70% at 30% 0%, rgba(255,255,255,0.15), transparent 55%)',
            }}
          />

          {/* hover 시 재생 아이콘 */}
          <div className="pointer-events-none absolute bottom-2 right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15 opacity-0 transition-all duration-smooth ease-emphasized group-hover:translate-y-0 group-hover:opacity-100" style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.45)' }}>
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </div>

          {/* 재생가능 배지 */}
          {showCount && (
            <div
              className={`absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-md ${
                noAudio
                  ? 'bg-yellow-500/30 text-yellow-50 ring-1 ring-yellow-300/40'
                  : 'bg-black/40 text-white'
              }`}
            >
              {noAudio ? (
                <>
                  <Sparkles size={10} />
                  <span>음원 준비중</span>
                </>
              ) : (
                <span>
                  {playableCount}/{totalCount}곡
                </span>
              )}
            </div>
          )}

          {/* 시간대 태그 */}
          {playlist.time_slot && (
            <div className="absolute right-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white backdrop-blur-md">
              {timeSlotLabel(playlist.time_slot)}
            </div>
          )}
        </div>
        <div className="space-y-1 px-0.5">
          <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">
            {playlist.title}
          </h3>
          {playlist.description && variant !== 'sm' && (
            <p className="line-clamp-2 text-xs leading-relaxed text-ink-mute">
              {playlist.description}
            </p>
          )}
          {variant === 'sm' && (
            <p className="line-clamp-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-dim">
              {playlist.category}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
