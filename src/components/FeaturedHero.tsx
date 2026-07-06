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
  /** 대표 커버(내부 음원 자켓) */
  coverUrl?: string | null;
}

export default function FeaturedHero({ playlist, badge, playableCount, totalCount, coverUrl }: Props) {
  const noAudio = typeof totalCount === 'number' && (playableCount ?? 0) === 0;

  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="group relative block min-h-[260px] overflow-hidden rounded-3xl shadow-elevated ring-1 ring-line/10 transition duration-smooth ease-emphasized hover:-translate-y-1 sm:min-h-[320px] lg:min-h-[380px]"
    >
      {/* 1) 블러 그라데이션 베이스 — 더 진하게 */}
      <div
        className="absolute inset-0 scale-110 opacity-80 blur-2xl"
        style={gradientStyle(playlist.category || playlist.title)}
      />
      {/* 2) Radial highlight */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 25% 0%, rgba(255,255,255,0.22), transparent 55%)',
        }}
      />
      {/* 3) 텍스트 가독성 위해 더 깊은 비네트 */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-black/40 to-black/80" />
      {/* 4) 하단 fade for text readability */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />
      {/* 5) glass texture (아주 약하게) */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{
        background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 4px)',
      }} aria-hidden />

      <div className="relative flex h-full flex-col gap-5 p-6 sm:flex-row sm:items-end sm:gap-7 sm:p-8 lg:gap-9 lg:p-10">
        <div
          className="aspect-square w-36 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/20 transition-transform duration-smooth ease-emphasized group-hover:scale-[1.04] sm:w-48 lg:w-56"
          style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.3)' }}
        >
          <AutoCover
            title={playlist.title}
            category={playlist.category}
            imageUrl={coverUrl ?? playlist.thumbnail_url}
            size="xl"
          />
        </div>

        <div className="flex flex-1 flex-col gap-3 sm:gap-3.5">
          {badge && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent/35 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur ring-1 ring-accent/50">
              <Sparkles size={11} /> {badge}
            </span>
          )}
          <h2 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-white drop-shadow-lg sm:text-4xl lg:text-5xl">
            {playlist.title}
          </h2>
          {playlist.description && (
            <p className="line-clamp-2 max-w-2xl text-sm font-medium leading-relaxed text-white/85 sm:text-base">
              {playlist.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-white ring-1 ring-white/15 transition group-hover:scale-105 group-hover:bg-accent-soft sm:text-base"
              style={{ boxShadow: '0 12px 32px rgb(var(--color-accent) / 0.55)' }}
            >
              <Play size={16} fill="currentColor" /> 바로 재생
            </span>
            {noAudio && (
              <span className="rounded-full bg-yellow-400/20 px-3 py-1 text-[11px] text-slate-900 dark:text-yellow-100 ring-1 ring-yellow-300/30">
                음원 준비중
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
