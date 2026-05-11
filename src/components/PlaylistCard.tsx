import { Link } from 'react-router-dom';
import { Music } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';

export default function PlaylistCard({ playlist }: { playlist: PlaylistRow }) {
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
