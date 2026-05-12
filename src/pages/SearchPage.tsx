import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  Clock,
  Flame,
  Hash,
  Music,
  ListMusic,
  Sparkles,
  ChevronLeft,
  Play,
  AlertCircle,
} from 'lucide-react';
import {
  searchCatalog,
  saveRecentSearch,
  getRecentSearches,
  clearRecentSearches,
  fetchTopSearches,
  searchTrackToTrackRow,
  logSearchEvent,
  QUICK_KEYWORDS,
  type GroupedResults,
  type SearchResult,
} from '@/lib/searchApi';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { isPlayableUrl } from '@/lib/audio';
import { toast } from '@/store/toastStore';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';

export default function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [groups, setGroups] = useState<GroupedResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [popular, setPopular] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);

  // 초기 로드
  useEffect(() => {
    setRecent(getRecentSearches());
    fetchTopSearches(10).then(setPopular);
    inputRef.current?.focus();
  }, []);

  // debounce 250ms
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // 검색 실행
  useEffect(() => {
    if (!debounced) {
      setGroups(null);
      setIsFallback(false);
      return;
    }
    let alive = true;
    setLoading(true);
    searchCatalog(debounced, 30)
      .then((res) => {
        if (!alive) return;
        setGroups(res.groups);
        setIsFallback(res.isFallback);
        // 결과가 있을 때만 최근 검색 저장 + 로그
        if (res.total > 0) {
          saveRecentSearch(debounced);
          setRecent(getRecentSearches());
          void logSearchEvent(debounced, res.total, userId);
        }
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : '검색 실패');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, userId]);

  const total = useMemo(() => {
    if (!groups) return 0;
    return (
      groups.tracks.length +
      groups.playlists.length +
      groups.genres.length +
      groups.moods.length +
      groups.categories.length
    );
  }, [groups]);

  function onSubmitChip(q: string) {
    setQuery(q);
    setDebounced(q);
    inputRef.current?.focus();
  }

  function handlePlayTrack(t: SearchResult) {
    if (!groups) return;
    const playableTracks = groups.tracks
      .map(searchTrackToTrackRow)
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (playableTracks.length === 0) return;
    const idx = playableTracks.findIndex((x) => x.id === t.id);
    if (idx === -1) return;

    const hasPlayable = playableTracks.some((x) => isPlayableUrl(x.audio_url));
    if (!hasPlayable) {
      toast.info('샘플 음원이 아직 없습니다.');
      return;
    }
    const startIdx = isPlayableUrl(playableTracks[idx].audio_url)
      ? idx
      : playableTracks.findIndex((x) => isPlayableUrl(x.audio_url));
    setQueue(playableTracks, Math.max(0, startIdx), null);
  }

  function handleRemoveRecent(q: string) {
    const next = recent.filter((r) => r !== q);
    try {
      localStorage.setItem('srr-recent-searches', JSON.stringify(next));
    } catch {
      /* noop */
    }
    setRecent(next);
  }

  return (
    <div className="space-y-6 px-4 pb-8 pt-6 sm:px-6">
      {/* 상단 검색 input + 뒤로 */}
      <header className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-card ring-1 ring-line/10"
          aria-label="뒤로"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="곡, 플레이리스트, 장르를 검색해보세요"
            className="w-full rounded-full bg-bg-card px-11 py-3 text-sm text-ink ring-1 ring-line/10 transition placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/40"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-ink-mute hover:bg-ink/5"
              aria-label="지우기"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {/* 입력 전 — 최근/인기/빠른 칩 */}
      {!debounced && (
        <div className="space-y-6">
          {recent.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                  <Clock size={14} className="text-ink-mute" /> 최근 검색
                </h2>
                <button
                  onClick={() => {
                    clearRecentSearches();
                    setRecent([]);
                  }}
                  className="text-xs text-ink-dim hover:text-ink"
                >
                  모두 지우기
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((q) => (
                  <button
                    key={q}
                    onClick={() => onSubmitChip(q)}
                    className="group inline-flex items-center gap-1.5 rounded-full bg-bg-card px-3 py-1.5 text-xs ring-1 ring-line/10 hover:bg-bg-hover"
                  >
                    <span>{q}</span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveRecent(q);
                      }}
                      className="text-ink-dim hover:text-ink"
                    >
                      <X size={11} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2.5">
            <h2 className="flex items-center gap-1.5 px-1 text-sm font-bold tracking-tight">
              <Flame size={14} className="text-accent" /> 인기 검색
            </h2>
            <div className="flex flex-wrap gap-2">
              {popular.map((q, i) => (
                <button
                  key={q + i}
                  onClick={() => onSubmitChip(q)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/20 hover:bg-accent/15"
                >
                  <span className="text-[10px] opacity-70">{i + 1}</span>
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <h2 className="flex items-center gap-1.5 px-1 text-sm font-bold tracking-tight">
              <Sparkles size={14} className="text-ink-mute" /> 빠른 카테고리
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {QUICK_KEYWORDS.map((k) => (
                <button
                  key={k}
                  onClick={() => onSubmitChip(k)}
                  className="rounded-2xl bg-bg-card px-3 py-3 text-sm font-semibold ring-1 ring-line/10 transition hover:-translate-y-0.5 hover:shadow-card"
                >
                  {k}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 검색 중 / 결과 */}
      {debounced && (
        <div className="space-y-6">
          {loading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-bg-card"
                />
              ))}
            </div>
          )}

          {!loading && groups && (
            <>
              {isFallback && (
                <div className="flex items-start gap-2 rounded-xl bg-yellow-500/5 px-3 py-2.5 text-[11px] text-ink-mute ring-1 ring-yellow-400/20">
                  <AlertCircle size={12} className="mt-0.5 shrink-0 text-yellow-300" />
                  <span>
                    검색 RPC 가 적용 안 돼 있어 임시 모드로 동작 중이에요.{' '}
                    <code className="font-mono">supabase/migrations/0004_search.sql</code> 을 적용하세요.
                  </span>
                </div>
              )}

              {total === 0 && (
                <div className="rounded-2xl bg-bg-card p-8 text-center ring-1 ring-line/10">
                  <p className="text-sm font-semibold">검색 결과가 없어요</p>
                  <p className="mt-1 text-xs text-ink-mute">
                    다른 분위기나 장르로 찾아보세요.
                  </p>
                </div>
              )}

              {/* 장르/분위기/카테고리 칩 */}
              {(groups.genres.length > 0 ||
                groups.moods.length > 0 ||
                groups.categories.length > 0) && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider text-ink-mute">
                    <Hash size={11} /> 관련 키워드
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {[...groups.categories, ...groups.genres, ...groups.moods].map((r) => (
                      <button
                        key={r.result_type + r.title}
                        onClick={() => onSubmitChip(r.title)}
                        className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/20 hover:bg-accent/15"
                      >
                        <span className="text-[9px] uppercase opacity-60">
                          {r.result_type === 'category'
                            ? '카테고리'
                            : r.result_type === 'genre'
                              ? '장르'
                              : '무드'}
                        </span>
                        <span>{r.title}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 곡 */}
              {groups.tracks.length > 0 && (
                <ResultSection title="곡" icon={<Music size={14} />} count={groups.tracks.length}>
                  <ul className="divide-y divide-line/10">
                    {groups.tracks.map((t) => (
                      <li key={t.id ?? t.title}>
                        <TrackResultRow
                          item={t}
                          isCurrent={currentTrackId === t.id}
                          onPlay={() => handlePlayTrack(t)}
                        />
                      </li>
                    ))}
                  </ul>
                </ResultSection>
              )}

              {/* 플레이리스트 */}
              {groups.playlists.length > 0 && (
                <ResultSection
                  title="플레이리스트"
                  icon={<ListMusic size={14} />}
                  count={groups.playlists.length}
                >
                  <ul className="divide-y divide-line/10">
                    {groups.playlists.map((p) => (
                      <li key={p.id ?? p.title}>
                        <PlaylistResultRow
                          item={p}
                          onClick={() => p.id && navigate(`/playlist/${p.id}`)}
                        />
                      </li>
                    ))}
                  </ul>
                </ResultSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <header className="flex items-center justify-between border-b border-line/10 px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
          {icon} {title}
        </h3>
        <span className="text-[11px] text-ink-dim">{count}건</span>
      </header>
      {children}
    </section>
  );
}

function TrackResultRow({
  item,
  isCurrent,
  onPlay,
}: {
  item: SearchResult;
  isCurrent?: boolean;
  onPlay: () => void;
}) {
  const playable = isPlayableUrl(item.audio_url);
  return (
    <button
      onClick={onPlay}
      className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ink/5 ${
        isCurrent ? 'bg-accent/10' : ''
      } ${!playable ? 'opacity-60' : ''}`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
        <AutoCover
          title={item.title}
          category={item.genre}
          imageUrl={item.image_url}
          size="sm"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={14} fill="currentColor" className="text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`flex items-center gap-1 truncate text-sm font-semibold ${
            isCurrent ? 'text-accent' : ''
          }`}
        >
          {!playable && <AlertCircle size={10} className="shrink-0 text-yellow-300" />}
          {item.title}
        </p>
        <p className="truncate text-xs text-ink-mute">
          {item.subtitle ?? '—'}
          {item.genre && <span className="ml-1.5 text-ink-dim">· {item.genre}</span>}
        </p>
      </div>
      {item.play_count != null && Number(item.play_count) > 0 && (
        <span className="shrink-0 text-[11px] text-ink-dim tabular-nums">
          {Number(item.play_count).toLocaleString()}회
        </span>
      )}
      {item.id && (
        <span className="shrink-0 opacity-70 group-hover:opacity-100">
          <TrackLikeButton
            trackId={item.id}
            track={{
              id: item.id,
              title: item.title,
              artist: item.subtitle,
              genre: item.genre,
              mood: item.mood,
              cover_url: item.image_url,
              audio_url: item.audio_url ?? '',
              duration: null,
              created_at: new Date().toISOString(),
            }}
            size={14}
          />
        </span>
      )}
    </button>
  );
}

function PlaylistResultRow({
  item,
  onClick,
}: {
  item: SearchResult;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ink/5"
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
        <AutoCover
          title={item.title}
          category={item.category}
          imageUrl={item.image_url}
          size="sm"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <p className="truncate text-xs text-ink-mute">
          {item.subtitle ?? item.category ?? '—'}
        </p>
      </div>
    </button>
  );
}
