import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, CheckCircle2, Users } from 'lucide-react';
import { fetchFeaturedCurators, type FeaturedCurator } from '@/lib/curatorApi';
import EmptyState from '@/components/common/EmptyState';

export default function CuratorsListPage() {
  const [curators, setCurators] = useState<FeaturedCurator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchFeaturedCurators(100)
      .then((rows) => { if (alive) setCurators(rows); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-5 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink"
      >
        <ChevronLeft size={14} /> 홈으로
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">큐레이터</h1>
        <p className="text-sm text-ink-mute">플레이리스트를 만드는 사람들 · 활동 중인 큐레이터만 노출</p>
      </header>

      {loading && (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-2 text-center">
              <div className="mx-auto aspect-square w-24 animate-pulse rounded-full bg-bg-card sm:w-28" />
              <div className="mx-auto h-3 w-20 animate-pulse rounded bg-bg-card" />
            </div>
          ))}
        </div>
      )}

      {!loading && curators.length === 0 && (
        <EmptyState
          icon={<Users size={20} />}
          title="활동 중인 큐레이터가 없어요"
          subtitle="곧 새 큐레이터들이 합류할 예정이에요"
        />
      )}

      {!loading && curators.length > 0 && (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {curators.map((c) => (
            <Link
              key={c.user_id}
              to={`/curator/${c.handle}`}
              className="group space-y-2 text-center"
            >
              <div className="mx-auto aspect-square w-24 overflow-hidden rounded-full bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5 sm:w-28">
                {c.profile_image_url ? (
                  <img
                    src={c.profile_image_url}
                    alt={c.display_name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-ink/70">
                    {c.display_name.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="space-y-0.5 px-1">
                <p className="flex items-center justify-center gap-1 truncate text-xs font-bold">
                  {c.display_name}
                  {c.is_verified && <CheckCircle2 size={11} className="shrink-0 text-sky-400" />}
                </p>
                <p className="truncate text-[10px] text-ink-mute">
                  플리 {c.playlist_count} · {c.total_streams.toLocaleString()} 재생
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
