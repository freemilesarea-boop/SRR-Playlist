import { useEffect, useMemo, useState } from 'react';
import { fetchPlaylists, fetchRecentPlaylists, fetchPlaylistCounts } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import FeaturedHero from '@/components/FeaturedHero';
import HomeChartSection from '@/components/HomeChartSection';
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

  const slot = currentTimeSlot();
  const slotLabel = timeSlotLabel(slot);
  const greetingPrefix = useMemo(() => {
    switch (slot) {
      case 'morning':
        return '좋은 아침이에요';
      case 'afternoon':
        return '여유로운 오후예요';
      case 'evening':
        return '저녁이 시작됐어요';
      case 'night':
        return '깊은 밤이에요';
    }
  }, [slot]);

  const personal = useMemo(() => playlists.filter((p) => !p.is_business_only), [playlists]);
  const business = useMemo(() => playlists.filter((p) => p.is_business_only), [playlists]);

  // 재생 가능한 트랙이 있는 플리 우선 정렬
  function sortByPlayable(list: PlaylistRow[]): PlaylistRow[] {
    return [...list].sort((a, b) => {
      const ca = counts.get(a.id)?.playable ?? 0;
      const cb = counts.get(b.id)?.playable ?? 0;
      if (ca !== cb) return cb - ca;
      return a.sort_order - b.sort_order;
    });
  }

  // ‘오늘의 추천’ — 시간대 매칭 + 재생가능한 것 중 1개
  const featured = useMemo(() => {
    const slotMatch = personal.filter((p) => p.time_slot === slot);
    const sortedSlot = sortByPlayable(slotMatch);
    return sortedSlot[0] ?? sortByPlayable(personal)[0] ?? playlists[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal, slot, counts]);

  const slotPlaylists = useMemo(
    () => sortByPlayable(playlists.filter((p) => p.time_slot === slot)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlists, slot, counts],
  );

  const popular = useMemo(
    () => sortByPlayable(personal).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [personal, counts],
  );

  const businessPicks = useMemo(
    () => sortByPlayable(business).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [business, counts],
  );

  const newest = useMemo(
    () =>
      [...playlists]
        .sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
        )
        .slice(0, 8),
    [playlists],
  );

  const nick = profile?.nickname || '게스트';

  return (
    <div className="space-y-8 px-4 pb-12 pt-6 sm:space-y-10 sm:px-6 sm:pt-8">
      {/* Greeting */}
      <header className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-accent">{slotLabel} · 지금 어울리는 음악</p>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {greetingPrefix}, {nick}님
        </h1>
        <p className="text-sm text-ink-mute">
          오늘은 어떤 분위기로 흘려볼까요?
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          데이터를 불러오지 못했어요: {error}
        </div>
      )}

      {/* Featured */}
      {featured && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">오늘의 추천</h2>
            <span className="text-xs text-ink-mute">·  {slotLabel} 무드</span>
          </div>
          <FeaturedHero
            playlist={featured}
            badge="Editor's Pick"
            playableCount={counts.get(featured.id)?.playable}
            totalCount={counts.get(featured.id)?.total}
          />
        </section>
      )}

      {/* Today's chart */}
      <HomeChartSection />

      {/* Recent */}
      {recents.length > 0 && (
        <PlaylistRow_
          title="최근 들은 플레이리스트"
          subtitle="다시 듣고 싶을 때"
          playlists={recents.slice(0, 8)}
          counts={counts}
        />
      )}

      {/* Time-of-day */}
      {slotPlaylists.length > 0 && (
        <PlaylistRow_
          title={`${slotLabel}에 어울리는 음악`}
          subtitle="시간대 자동 추천"
          playlists={slotPlaylists}
          counts={counts}
        />
      )}

      {/* Popular */}
      {popular.length > 0 && (
        <PlaylistRow_
          title="인기 플레이리스트"
          subtitle="많이 듣고 있어요"
          playlists={popular}
          counts={counts}
        />
      )}

      {/* Business / store */}
      {businessPicks.length > 0 && (
        <PlaylistRow_
          title="🏪 카페 · 매장 추천"
          subtitle="자영업자가 그대로 틀어두기 좋은"
          playlists={businessPicks}
          counts={counts}
        />
      )}

      {/* Newest */}
      {newest.length > 0 && (
        <PlaylistRow_
          title="새로 추가된"
          subtitle="이번 주 업데이트"
          playlists={newest}
          counts={counts}
        />
      )}

      {loading && <SkeletonSection />}

      {!loading && playlists.length === 0 && (
        <div className="rounded-2xl bg-bg-card/60 p-8 text-center text-sm text-ink-mute ring-1 ring-line/10">
          아직 등록된 플레이리스트가 없어요. <br />
          관리자 페이지에서 플레이리스트와 트랙을 추가해보세요.
        </div>
      )}
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="space-y-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-5 w-40 animate-pulse rounded bg-bg-card" />
          <div className="-mx-4 flex gap-3 overflow-hidden px-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="w-36 shrink-0 space-y-2 sm:w-44">
                <div className="aspect-square animate-pulse rounded-2xl bg-bg-card" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-bg-card" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
