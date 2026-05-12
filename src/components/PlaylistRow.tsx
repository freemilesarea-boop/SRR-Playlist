import { ChevronRight } from 'lucide-react';
import PlaylistCard from './PlaylistCard';
import type { PlaylistRow as PlaylistRowType } from '@/types/db';

interface Props {
  title: string;
  subtitle?: string;
  playlists: PlaylistRowType[];
  emptyText?: string;
  counts?: Map<string, { total: number; playable: number }>;
  /** 가로 스크롤 (모바일) — false 면 그리드 */
  scroll?: boolean;
  variant?: 'sm' | 'md';
}

export default function PlaylistRow({
  title,
  subtitle,
  playlists,
  emptyText,
  counts,
  scroll = true,
  variant = 'sm',
}: Props) {
  if (playlists.length === 0) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-mute">{subtitle}</p>}
        </div>
        <div className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-white/5">
          {emptyText ?? '아직 플레이리스트가 없어요.'}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between px-0.5">
        <div>
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-mute">{subtitle}</p>}
        </div>
        {playlists.length > 4 && (
          <span className="hidden items-center gap-0.5 text-xs text-ink-dim sm:inline-flex">
            모두 보기 <ChevronRight size={12} />
          </span>
        )}
      </div>

      {scroll ? (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:px-6">
          {playlists.map((p) => {
            const c = counts?.get(p.id);
            return (
              <div
                key={p.id}
                className="w-36 shrink-0 snap-start sm:w-44"
              >
                <PlaylistCard
                  playlist={p}
                  playableCount={c?.playable}
                  totalCount={c?.total}
                  variant={variant}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {playlists.map((p) => {
            const c = counts?.get(p.id);
            return (
              <PlaylistCard
                key={p.id}
                playlist={p}
                playableCount={c?.playable}
                totalCount={c?.total}
                variant={variant}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
