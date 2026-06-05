import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ListMusic } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  fetchPlaylists,
  fetchRecentPlaylists,
  fetchPlaylistCounts,
  fetchPlaylistCovers,
} from '@/lib/api';
import { fetchPopularPlaylistsByFollows } from '@/lib/playlistFollowApi';
import { fetchCuratorMadePlaylists } from '@/lib/curatorStudioApi';
import { fetchNewPublicPlaylists, type NewPublicPlaylist } from '@/lib/userPlaylistApi';
import PlaylistCard from '@/components/PlaylistCard';
import AutoCover from '@/components/AutoCover';
import EmptyState from '@/components/common/EmptyState';
import type { PlaylistRow } from '@/types/db';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';

type View =
  | 'recent' | 'time' | 'popular' | 'followers'
  | 'business' | 'auto' | 'newest' | 'curator-made' | 'new';

const VIEW_TITLES: Record<View, { title: string; subtitle: string }> = {
  recent:      { title: '최근 들은 플레이리스트', subtitle: '다시 듣고 싶을 때' },
  time:        { title: '시간대 추천',           subtitle: '지금 어울리는 음악' },
  popular:     { title: '인기 플레이리스트',       subtitle: '많이 듣고 있어요' },
  followers:   { title: '많이 팔로우한 플레이리스트', subtitle: '구독자 수 기준 급상승' },
  business:    { title: '카페 · 매장 추천',       subtitle: '자영업자가 그대로 틀어두기 좋은' },
  auto:        { title: '업종별 추천',           subtitle: '업종·시간대·분위기 기반 자동 생성' },
  newest:      { title: '새로 추가된 플레이리스트', subtitle: '이번 주 업데이트' },
  'curator-made': { title: '큐레이터 추천 플레이리스트', subtitle: '큐레이터가 직접 만든 플리' },
  new:         { title: '신규 플레이리스트',       subtitle: '방금 공개된 플레이리스트' },
};

export default function ExplorePlaylistsPage() {
  const [params] = useSearchParams();
  const view = (params.get('view') as View) || 'newest';
  const slotParam = params.get('slot') as 'morning' | 'afternoon' | 'evening' | null;
  const { user } = useAuthStore();

  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [newPublic, setNewPublic] = useState<NewPublicPlaylist[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [covers, setCovers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const slot = slotParam || currentTimeSlot();
  const meta = useMemo(() => {
    if (view === 'time') {
      return { title: `${timeSlotLabel(slot)}에 어울리는 음악`, subtitle: '시간대 자동 추천' };
    }
    return VIEW_TITLES[view] ?? VIEW_TITLES.newest;
  }, [view, slot]);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    async function load() {
      if (view === 'recent') {
        const [recent, cnt, cov] = await Promise.all([
          user ? fetchRecentPlaylists(user.id, 60).catch(() => []) : Promise.resolve([]),
          fetchPlaylistCounts().catch(() => new Map<string, { total: number; playable: number }>()),
          fetchPlaylistCovers().catch(() => new Map<string, string>()),
        ]);
        if (!alive) return;
        setPlaylists(recent);
        setCounts(cnt);
        setCovers(cov);
      } else if (view === 'followers') {
        const [pop, cnt, cov] = await Promise.all([
          fetchPopularPlaylistsByFollows(60).catch(() => []),
          fetchPlaylistCounts().catch(() => new Map<string, { total: number; playable: number }>()),
          fetchPlaylistCovers().catch(() => new Map<string, string>()),
        ]);
        if (!alive) return;
        setPlaylists(pop as unknown as PlaylistRow[]);
        setCounts(cnt);
        setCovers(cov);
      } else if (view === 'curator-made') {
        const rows = await fetchCuratorMadePlaylists(60).catch(() => []);
        if (!alive) return;
        // CuratorMadePlaylist → PlaylistRow 형태로 매핑 (카드 호환)
        setPlaylists(rows.map((r) => ({
          id: r.id, title: r.title, category: r.category,
          business_category: null, description: null,
          thumbnail_url: r.thumbnail_url, is_business_only: false,
          time_slot: null, sort_order: 0, created_at: r.released_at ?? '',
        })) as PlaylistRow[]);
        setCounts(new Map());
        setCovers(new Map());
      } else if (view === 'new') {
        const rows = await fetchNewPublicPlaylists(60).catch(() => []);
        if (!alive) return;
        setNewPublic(rows);
      } else {
        const [all, cnt, cov] = await Promise.all([
          fetchPlaylists().catch(() => []),
          fetchPlaylistCounts().catch(() => new Map<string, { total: number; playable: number }>()),
          fetchPlaylistCovers().catch(() => new Map<string, string>()),
        ]);
        if (!alive) return;
        setPlaylists(all);
        setCounts(cnt);
        setCovers(cov);
      }
      if (alive) setLoading(false);
    }

    void load();
    return () => { alive = false; };
  }, [view, user, slot]);

  // 뷰별 필터 + 정렬 — 0곡 플리 제외 (요구사항 6).
  const filtered = useMemo(() => {
    const hasPlayable = (id: string) => (counts.get(id)?.playable ?? 0) > 0;
    let list = playlists;
    switch (view) {
      case 'time':
        list = list.filter((p) => p.time_slot === slot && !p.is_business_only);
        break;
      case 'popular':
        list = list.filter((p) => !p.is_business_only);
        break;
      case 'business':
        list = list.filter((p) => p.is_business_only);
        break;
      case 'auto':
        list = list.filter((p) => p.is_auto_generated);
        break;
      case 'newest':
        list = [...list].sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
        );
        break;
      case 'recent':
      case 'followers':
      case 'curator-made':
        // 이미 서버 정렬됨
        break;
    }
    // playable 기준 0인 플리 제외 — counts 가 비어있으면(curator-made) 그대로 노출
    if (counts.size > 0) {
      list = list.filter((p) => hasPlayable(p.id));
    }
    // popular 는 playable desc
    if (view === 'popular') {
      list = [...list].sort(
        (a, b) => (counts.get(b.id)?.playable ?? 0) - (counts.get(a.id)?.playable ?? 0),
      );
    }
    return list;
  }, [playlists, view, slot, counts]);

  return (
    <div className="space-y-5 px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink"
      >
        <ChevronLeft size={14} /> 홈으로
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{meta.title}</h1>
        <p className="text-sm text-ink-mute">{meta.subtitle}</p>
      </header>

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square animate-pulse rounded-2xl bg-bg-card" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-bg-card" />
            </div>
          ))}
        </div>
      )}

      {!loading && view === 'new' && newPublic.length === 0 && (
        <EmptyState
          icon={<ListMusic size={20} />}
          title="신규 플레이리스트가 없어요"
          subtitle="조금 뒤에 다시 확인해보세요"
        />
      )}

      {!loading && view !== 'new' && filtered.length === 0 && (
        <EmptyState
          icon={<ListMusic size={20} />}
          title="아직 표시할 플레이리스트가 없어요"
          subtitle="조금 뒤에 다시 확인해보세요"
        />
      )}

      {!loading && view === 'new' && newPublic.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {newPublic.map((p) => (
            <Link
              key={`${p.source}-${p.id}`}
              to={p.source === 'user' ? `/my/playlist/${p.id}` : `/playlist/${p.id}`}
              className="group block space-y-2"
            >
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                <AutoCover
                  title={p.title}
                  category={p.category}
                  imageUrl={p.cover_url ?? p.thumbnail_url}
                  size="lg"
                />
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
      )}

      {!loading && view !== 'new' && filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((p) => {
            const c = counts.get(p.id);
            return (
              <PlaylistCard
                key={p.id}
                playlist={p}
                playableCount={c?.playable}
                totalCount={c?.total}
                variant="md"
                coverUrl={covers.get(p.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
