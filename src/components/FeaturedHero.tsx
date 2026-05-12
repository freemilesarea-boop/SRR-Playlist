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
      className="group relative block overflow-hidden rounded-3xl shadow-elevated ring-1 ring-line/10 transition duration-smooth ease-emphasized hover:-translate-y-1"
    >
      {/* 1) 블러 그라데이션 베이스 */}
      <div
        className="absolute inset-0 scale-110 opacity-70 blur-2xl"
        style={gradientStyle(playlist.category || playlist.title)}
      />
      {/* 2) Radial highlight (light reflection 느낌) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 25% 0%, rgba(255,255,255,0.18), transparent 55%)',
        }}
      />
      {/* 3) 텍스트 가독성 위해 어두운 비네트 */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/15 via-black/25 to-black/65" />
      {/* 4) glass texture (아주 약하게) */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{
        background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 4px)',
      }} aria-hidden />

      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:gap-6 sm:p-7">
        <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-2xl shadow-elevated ring-1 ring-white/15 transition-transform duration-smooth ease-emphasized group-hover:scale-[1.04] sm:w-44">
          <AutoCover
            title={playlist.title}
            category={playlist.category}
            imageUrl={playlist.thumbnail_url}
            size="xl"
          />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          {badge && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur ring-1 ring-white/10">
              <Sparkles size={10} /> {badge}
            </span>
          )}
          <h2 className="text-2xl font-extrabold tracking-tight text-white drop-shadow sm:text-3xl">
            {playlist.title}
          </h2>
          {playlist.description && (
            <p className="line-clamp-2 max-w-xl text-sm font-medium text-white/85">
              {playlist.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow-lift transition group-hover:scale-105">
              <Play size={14} fill="currentColor" /> 바로 재생
            </span>
            {noAudio && (
              <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-[11px] text-yellow-100 ring-1 ring-yellow-300/30">
                음원 준비중
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
