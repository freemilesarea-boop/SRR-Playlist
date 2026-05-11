import PlaylistCard from './PlaylistCard';
import type { PlaylistRow as PlaylistRowType } from '@/types/db';

interface Props {
  title: string;
  subtitle?: string;
  playlists: PlaylistRowType[];
  emptyText?: string;
}

export default function PlaylistRow({ title, subtitle, playlists, emptyText }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
          {subtitle && <p className="text-xs text-ink-mute">{subtitle}</p>}
        </div>
      </div>
      {playlists.length === 0 ? (
        <div className="rounded-2xl bg-bg-card p-6 text-center text-sm text-ink-mute">
          {emptyText ?? '아직 플레이리스트가 없어요.'}
        </div>
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 md:grid-cols-4">
          {playlists.map((p) => (
            <div key={p.id} className="w-40 shrink-0 sm:w-auto">
              <PlaylistCard playlist={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
