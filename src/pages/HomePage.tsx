import { useEffect, useMemo, useState } from 'react';
import { fetchPlaylists, fetchRecentPlaylists, fetchPlaylistCounts } from '@/lib/api';
import { fetchPopularPlaylistsByFollows, type PopularPlaylist } from '@/lib/playlistFollowApi';
import { fetchFeaturedCurators, type FeaturedCurator } from '@/lib/curatorApi';
import { Link } from 'react-router-dom';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import FeaturedHero from '@/components/FeaturedHero';
import HomeChartSection from '@/components/HomeChartSection';
import HomeSearchBar from '@/components/HomeSearchBar';
import HomeLibrarySections from '@/components/HomeLibrarySections';
import HomeRecommendation from '@/components/HomeRecommendation';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';
import { fetchCuratorMadePlaylists, type CuratorMadePlaylist } from '@/lib/curatorStudioApi';
import { fetchNewPublicPlaylists, type NewPublicPlaylist } from '@/lib/userPlaylistApi';
import { gradientStyle } from '@/lib/cover';
import AutoCover from '@/components/AutoCover';
import { Wand2 } from 'lucide-react';

export default function HomePage() {
  const { profile, user } = useAuthStore();
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [recents, setRecents] = useState<PlaylistRow[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [popularByFollows, setPopularByFollows] = useState<PopularPlaylist[]>([]);
  const [featuredCurators, setFeaturedCurators] = useState<FeaturedCurator[]>([]);
  const [curatorMade, setCuratorMade] = useState<CuratorMadePlaylist[]>([]);
  const [newPublic, setNewPublic] = useState<NewPublicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 큐레이터 제작 출시 플리 (0098 미적용 시 빈 배열 → 섹션 숨김)
  useEffect(() => {
    let alive = true;
    void fetchCuratorMadePlaylists(10).then((rows) => {
      if (alive) setCuratorMade(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 신규 공개 플리 — released 카탈로그 + 공개 user_playlists 통합 (0101)
  useEffect(() => {
    let alive = true;
    void fetchNewPublicPlaylists(12).then((rows) => {
      if (alive) setNewPublic(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 팔로워 기준 인기 플리 (0012 미적용 시 빈 배열 → 섹션 숨김)
  useEffect(() => {
    let alive = true;
    void fetchPopularPlaylistsByFollows(10).then((rows) => {
      if (alive) setPopularByFollows(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 인기 큐레이터 (0013 미적용 시 빈 배열 → 섹션 숨김)
  useEffect(() => {
    let alive = true;
    void fetchFeaturedCurators(12).then((rows) => {
      if (alive) setFeaturedCurators(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

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
    <div className="space-y-10 px-4 pb-16 pt-6 sm:space-y-12 sm:px-6 sm:pt-10 lg:space-y-14 lg:px-8 lg:pt-12">
      {/* Greeting */}
      <header className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-accent">{slotLabel} · 지금 어울리는 음악</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {greetingPrefix}, {nick}님
          </h1>
          <p className="text-sm text-ink-mute">
            오늘은 어떤 분위기로 흘려볼까요?
          </p>
        </div>
        <HomeSearchBar />
      </header>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          데이터를 불러오지 못했어요: {error}
        </div>
      )}

      {/* 이어듣기 + 최근 들은 음악 (상단 노출 — Continue Listening) */}
      <HomeLibrarySections />

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

      {/* 시간대 기반 추천 */}
      <HomeRecommendation />

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

      {/* 많이 팔로우한 플레이리스트 — 0012 적용 후 데이터 있을 때만 노출 */}
      {popularByFollows.length > 0 && (
        <PlaylistRow_
          title="많이 팔로우한 플레이리스트"
          subtitle="구독자 수 기준 급상승"
          playlists={popularByFollows}
          counts={counts}
        />
      )}

      {/* 인기 큐레이터 — 0013 적용 후 데이터 있을 때만 */}
      {featuredCurators.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between px-0.5">
            <div>
              <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
                <Sparkles size={16} className="text-accent" /> 인기 큐레이터
              </h2>
              <p className="mt-0.5 text-xs text-ink-mute">플레이리스트를 만드는 사람들</p>
            </div>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {featuredCurators.map((c) => (
              <Link
                key={c.user_id}
                to={`/curator/${c.handle}`}
                className="group w-32 shrink-0 space-y-1.5 text-center sm:w-36"
              >
                <div className="mx-auto aspect-square w-24 overflow-hidden rounded-full bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5 sm:w-28">
                  {c.profile_image_url ? (
                    <img
                      src={c.profile_image_url}
                      alt={c.display_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-ink/70">
                      {c.display_name.slice(0, 1)}
                    </div>
                  )}
                </div>
                <p className="flex items-center justify-center gap-1 truncate px-0.5 text-xs font-bold">
                  {c.display_name}
                  {c.is_verified && <CheckCircle2 size={11} className="text-sky-400" />}
                </p>
                <p className="truncate px-0.5 text-[10px] text-ink-mute">
                  플리 {c.playlist_count} · {c.total_streams.toLocaleString()} 재생
                </p>
              </Link>
            ))}
          </div>
        </section>
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

      {/* 큐레이터 추천 — 큐레이터가 직접 제작·출시한 플리 (0098) */}
      {curatorMade.length > 0 && (
        <section className="space-y-3">
          <div className="px-0.5">
            <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
              <Wand2 size={16} className="text-accent" /> 큐레이터 추천
            </h2>
            <p className="mt-0.5 text-xs text-ink-mute">큐레이터가 직접 만든 플레이리스트</p>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {curatorMade.map((p) => (
              <Link
                key={p.id}
                to={`/playlist/${p.id}`}
                className="group w-36 shrink-0 space-y-2 sm:w-44"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition duration-smooth ease-emphasized group-hover:-translate-y-1 group-hover:shadow-lift">
                  <AutoCover title={p.title} category={p.category} imageUrl={p.thumbnail_url} size="lg" />
                  <div
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={gradientStyle(p.category || p.title)}
                  />
                </div>
                <div className="space-y-0.5 px-0.5">
                  <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">{p.title}</h3>
                  <p className="line-clamp-1 text-xs text-ink-mute">
                    {p.curator_name ? `by ${p.curator_name}` : p.category}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 신규 플레이리스트 — released 카탈로그 + 공개 user_playlists 통합 (source-aware 링크) */}
      {newPublic.length > 0 && (
        <section className="space-y-3">
          <div className="px-0.5">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">신규 플레이리스트</h2>
            <p className="mt-0.5 text-xs text-ink-mute">방금 공개된 플레이리스트</p>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
            {newPublic.map((p) => (
              <Link
                key={`${p.source}-${p.id}`}
                to={p.source === 'user' ? `/my/playlist/${p.id}` : `/playlist/${p.id}`}
                className="group w-36 shrink-0 space-y-2 sm:w-44"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition duration-smooth ease-emphasized group-hover:-translate-y-1 group-hover:shadow-lift">
                  <AutoCover title={p.title} category={p.category} imageUrl={p.thumbnail_url} size="lg" />
                  <div className="pointer-events-none absolute inset-0 opacity-30" style={gradientStyle(p.category || p.title)} />
                </div>
                <div className="space-y-0.5 px-0.5">
                  <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">{p.title}</h3>
                  <p className="line-clamp-1 text-xs text-ink-mute">
                    {p.source === 'user' ? '사용자 플레이리스트' : p.category ?? '플레이리스트'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 새로 추가된 (카탈로그 전용 — 기존 유지) */}
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
