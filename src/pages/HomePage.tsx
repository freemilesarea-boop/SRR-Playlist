import { useEffect, useMemo, useState } from 'react';
import { PERSONAL_CATEGORIES } from '@/lib/constants';
import { fetchPlaylists, fetchRecentPlaylists, fetchPlaylistCounts } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';

export default function HomePage() {
  const { profile, user } = useAuthStore();
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [recents, setRecents] = useState<PlaylistRow[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchPlaylists().catch((e) => {
        if (alive) setError(String(e));
        return [];
      }),
      user ? fetchRecentPlaylists(user.id).catch(() => []) : Promise.resolve([]),
      fetchPlaylistCounts().catch(() => new Map()),
    ]).then(([all, recent, cnt]) => {
      if (!alive) return;
      setPlaylists(all);
      setRecents(recent);
      setCounts(cnt);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  const personal = useMemo(() => playlists.filter((p) => !p.is_business_only), [playlists]);
  const slot = currentTimeSlot();
  const greeting = `${timeSlotLabel(slot)}의 분위기`;
  const nick = profile?.nickname || '게스트';

  const byCategory = (cat: string) => personal.filter((p) => p.category === cat);

  return (
    <div className="space-y-8 px-4 pb-12 pt-6 sm:px-6">
      <header className="space-y-1">
        <p className="text-xs text-accent">{greeting}</p>
        <h1 className="text-2xl font-bold sm:text-3xl">안녕하세요, {nick} 님</h1>
        <p className="text-sm text-ink-mute">지금 이 순간에 어울리는 음악을 골라봤어요.</p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          데이터를 불러오지 못했어요: {error}
        </div>
      )}

      {recents.length > 0 && (
        <PlaylistRow_
          title="최근 들은 플레이리스트"
          playlists={recents.slice(0, 6)}
          counts={counts}
        />
      )}

      {loading ? (
        <SkeletonRows />
      ) : (
        PERSONAL_CATEGORIES.map((cat) => {
          const items = byCategory(cat.key);
          if (items.length === 0) return null;
          return (
            <PlaylistRow_
              key={cat.key}
              title={`${cat.emoji} ${cat.key}`}
              playlists={items}
              counts={counts}
            />
          );
        })
      )}

      {!loading && personal.length === 0 && (
        <div className="rounded-2xl bg-bg-card p-6 text-center text-sm text-ink-mute">
          아직 등록된 플레이리스트가 없어요. <br />
          관리자 페이지에서 플레이리스트를 추가해보세요.
        </div>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-5 w-40 rounded bg-bg-card" />
          <div className="-mx-4 flex gap-3 overflow-hidden px-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="w-40 shrink-0 space-y-2">
                <div className="aspect-square rounded-xl bg-bg-card" />
                <div className="h-3 w-3/4 rounded bg-bg-card" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
