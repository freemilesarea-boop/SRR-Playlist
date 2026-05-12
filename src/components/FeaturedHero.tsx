import { Link } from 'react-router-dom';
import { Play, Sparkles } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';
import AutoCover from './AutoCover';
import { gradientStyle } from '@/lib/cover';

interface Props {
  playlist: PlaylistRow;
  badge?: string;
  playableCount?: number;
  totalCount?: number;
}

export default function FeaturedHero({ playlist, badge, playableCount, totalCount }: Props) {
  const noAudio = typeof totalCount === 'number' && (playableCount ?? 0) === 0;

  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="group relative block overflow-hidden rounded-3xl ring-1 ring-white/5"
    >
      {/* 백그라운드 그라데이션 (블러된 커버) */}
      <div
        className="absolute inset-0 scale-110 opacity-80 blur-2xl"
        style={gradientStyle(playlist.category || playlist.title)}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-black/60" />

      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:gap-6 sm:p-7">
        {/* 작은 커버 */}
        <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-[1.03] sm:w-44">
          <AutoCover
            title={playlist.title}
            category={playlist.category}
            imageUrl={playlist.thumbnail_url}
            size="xl"
          />
        </div>

        {/* 텍스트 */}
        <div className="flex flex-1 flex-col gap-2">
          {badge && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <Sparkles size={10} /> {badge}
            </span>
          )}
          <h2 className="text-2xl font-extrabold tracking-tight text-white drop-shadow sm:text-3xl">
            {playlist.title}
          </h2>
          {playlist.description && (
            <p className="line-clamp-2 max-w-xl text-sm text-white/80">
              {playlist.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-black shadow-lg transition group-hover:scale-105">
              <Play size={14} fill="currentColor" /> 바로 재생
            </span>
            {noAudio && (
              <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-[11px] text-yellow-200 ring-1 ring-yellow-300/30">
                음원 준비중
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
