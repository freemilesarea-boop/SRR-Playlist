/**
 * StoreNowPlayingPanel — Enterprise Phase 1-4.
 *
 * 전국 매장 현재 재생곡 실시간 모니터링 UI (super admin).
 *
 * 핵심:
 *   - Supabase Realtime subscribe — store_policy_sync_status 변경 시 즉시 refetch
 *   - 15s fallback polling (Realtime 실패 대비)
 *   - 진행바: 클라이언트 1s tick 으로 elapsed 자동 증가 (heartbeat 안 기다림)
 *   - 곡 변경 시 elapsed 자동 0 reset (started_at 갱신 감지)
 *   - Album art (tracks.cover_url) + placeholder
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Search, AlertCircle, Music, Wifi, WifiOff, Pause, Play, Square,
  Building2, MapPin, Activity, Volume2,
} from 'lucide-react';
import {
  listNowPlaying, nowPlayingKpi, subscribeNowPlaying,
  type NowPlaying, type NowPlayingKpi, type NowPlayingStatusFilter, type NowPlayingPlayerStatus,
} from '@/lib/api/nowPlayingApi';
import { adminListFranchises, type FranchiseListRow } from '@/lib/api/franchiseApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 100;
const FALLBACK_POLL_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 1_000;  // Realtime burst 시 1s 내 refetch 1회
const PROGRESS_TICK_MS = 1_000;

const STATUS_OPTIONS: ReadonlyArray<{ value: NowPlayingStatusFilter; label: string }> = [
  { value: 'online', label: '온라인' },
  { value: 'playing', label: '재생 중' },
  { value: 'offline', label: '오프라인' },
];

export default function StoreNowPlayingPanel() {
  const [rows, setRows] = useState<NowPlaying[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<NowPlayingKpi | null>(null);
  const [franchises, setFranchises] = useState<FranchiseListRow[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NowPlayingStatusFilter | ''>('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());  // 1s tick for progress bar

  const refetchTimerRef = useRef<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        listNowPlaying({
          search: search.trim() || null,
          status: statusFilter || null,
          franchiseId: franchiseFilter || null,
          enterpriseRegionId: regionFilter || null,
          limit: PAGE_SIZE, offset,
        }),
        nowPlayingKpi(),
      ]);
      setRows(list.data);
      setTotal(list.pagination.total);
      setKpi(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, franchiseFilter, regionFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // Realtime subscribe + debounce refetch
  useEffect(() => {
    const debouncedRefetch = () => {
      if (refetchTimerRef.current !== null) window.clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = window.setTimeout(() => { void load(true); }, REFETCH_DEBOUNCE_MS);
    };
    const sub = subscribeNowPlaying(() => debouncedRefetch());
    return () => {
      if (refetchTimerRef.current !== null) window.clearTimeout(refetchTimerRef.current);
      sub.unsubscribe();
    };
  }, [load]);

  // 15s fallback polling (Realtime 보장 X 시)
  useEffect(() => {
    const id = window.setInterval(() => void load(true), FALLBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // 1s tick — 진행바 클라이언트 자동 증가
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Load filters data
  useEffect(() => {
    void adminListFranchises().then(setFranchises).catch((e) => console.warn('[NowPlaying] franchises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data)).catch((e) => console.warn('[NowPlaying] regions load failed', e));
  }, []);

  const onSearchChange = (v: string) => { setSearch(v); setOffset(0); };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '재생 중', value: kpi.playing, tone: 'text-emerald-300', icon: <Play size={12} /> },
      { label: '일시정지', value: kpi.paused, tone: 'text-amber-300', icon: <Pause size={12} /> },
      { label: '정지', value: kpi.stopped, tone: 'text-ink-mute', icon: <Square size={12} /> },
      { label: '오프라인', value: kpi.offline, tone: 'text-rose-300', icon: <WifiOff size={12} /> },
      { label: '최근 변경 (5분)', value: kpi.recent_track_changes_5m, tone: 'text-sky-300', icon: <Activity size={12} /> },
    ];
  }, [kpi]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Music size={14} /> 실시간 재생곡
            <span className="text-[10px] font-normal text-ink-dim">(Enterprise Phase 1-4)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] text-emerald-300 flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Realtime
            </span>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          매장 트랙 변경 시 즉시 반영됩니다. 진행바는 클라이언트에서 1초마다 자동 증가합니다.
        </p>
      </div>

      {/* KPI */}
      {kpiCards && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">{c.icon}{c.label}</div>
              <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input type="text" placeholder="매장/본사/지역/곡명/아티스트"
            value={search} onChange={(e) => onSearchChange(e.target.value)}
            className="rounded bg-bg-deep pl-7 pr-2 py-1 w-64 max-w-full" />
        </div>
        <select value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as NowPlayingStatusFilter | ''); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={franchiseFilter}
          onChange={(e) => { setFranchiseFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 본사</option>
          {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={regionFilter}
          onChange={(e) => { setRegionFilter(e.target.value); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 지역</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
        </select>
        <span className="ml-auto text-ink-dim">{total}개</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <SkeletonRows />
      ) : !loading && rows.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-3 py-2">매장 / 본사·지역</th>
                  <th className="px-3 py-2">앨범</th>
                  <th className="px-3 py-2">곡 / 아티스트</th>
                  <th className="px-3 py-2 w-[200px]">진행</th>
                  <th className="px-3 py-2 text-right">남은</th>
                  <th className="px-3 py-2 text-right">볼륨</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <NowPlayingRow key={r.store_id} row={r} now={nowTick} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <NowPlayingCard key={r.store_id} row={r} now={nowTick} />
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">이전</button>
              <span className="text-ink-mute">
                {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">다음</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Row / Card
// =============================================================================

function computeElapsed(row: NowPlaying, now: number): { elapsed: number; remaining: number; pct: number } {
  // 서버 started_at 기준 클라이언트 자동 증가
  if (!row.started_at || !row.duration) {
    return { elapsed: 0, remaining: 0, pct: 0 };
  }
  const startMs = new Date(row.started_at).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const elapsed = Math.min(elapsedSec, row.duration);
  const remaining = Math.max(0, row.duration - elapsed);
  const pct = row.duration > 0 ? Math.min(100, (elapsed / row.duration) * 100) : 0;
  return { elapsed, remaining, pct };
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function NowPlayingRow({ row, now }: { row: NowPlaying; now: number }) {
  const { elapsed, remaining, pct } = computeElapsed(row, now);
  return (
    <tr className="border-b border-line/5 hover:bg-bg-hover/30">
      <td className="px-3 py-2">
        <div className="font-semibold">{row.store_name}</div>
        <div className="text-[10px] text-ink-mute flex items-center gap-2">
          {row.franchise_name && <span className="flex items-center gap-1"><Building2 size={9} />{row.franchise_name}</span>}
          {row.region_name && <span className="flex items-center gap-1"><MapPin size={9} />{row.region_name}</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <AlbumArt url={row.album_art_url} size={32} />
      </td>
      <td className="px-3 py-2">
        {row.track_title ? (
          <>
            <div className="font-semibold truncate max-w-[200px]">{row.track_title}</div>
            <div className="text-[10px] text-ink-mute truncate max-w-[200px]">{row.artist_name ?? '—'}</div>
          </>
        ) : (
          <span className="text-ink-dim">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {row.duration ? (
          <div className="space-y-0.5">
            <div className="h-1 w-full bg-bg-deep rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 transition-[width] duration-500"
                style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[10px] text-ink-dim tabular-nums">
              {formatTime(elapsed)} / {formatTime(row.duration)}
            </div>
          </div>
        ) : (
          <span className="text-[10px] text-ink-dim">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-mute">
        {row.duration ? `-${formatTime(remaining)}` : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.volume != null ? (
          <span className="text-ink-mute"><Volume2 size={10} className="inline" /> {row.volume}%</span>
        ) : '—'}
      </td>
      <td className="px-3 py-2"><PlayerBadge status={row.player_status} online={row.is_online} /></td>
      <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
        {row.last_heartbeat_at ? formatRelative(new Date(row.last_heartbeat_at).getTime(), now) : '—'}
      </td>
    </tr>
  );
}

function NowPlayingCard({ row, now }: { row: NowPlaying; now: number }) {
  const { elapsed, remaining, pct } = computeElapsed(row, now);
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <AlbumArt url={row.album_art_url} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-sm">{row.store_name}</div>
              <div className="text-[10px] text-ink-mute">
                {row.franchise_name} {row.region_name && `· ${row.region_name}`}
              </div>
            </div>
            <PlayerBadge status={row.player_status} online={row.is_online} />
          </div>
          {row.track_title && (
            <div className="mt-1.5">
              <div className="text-[12px] font-semibold truncate">{row.track_title}</div>
              <div className="text-[10px] text-ink-mute truncate">{row.artist_name ?? '—'}</div>
            </div>
          )}
        </div>
      </div>
      {row.duration && (
        <div className="mt-2 space-y-0.5">
          <div className="h-1 w-full bg-bg-deep rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-ink-dim tabular-nums">
            <span>{formatTime(elapsed)}</span>
            <span>-{formatTime(remaining)}</span>
          </div>
        </div>
      )}
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-dim">
        {row.volume != null && <span><Volume2 size={9} className="inline" /> {row.volume}%</span>}
        {row.last_heartbeat_at && <span>heartbeat {formatRelative(new Date(row.last_heartbeat_at).getTime(), now)}</span>}
      </div>
    </div>
  );
}

// =============================================================================
// Sub
// =============================================================================

function AlbumArt({ url, size }: { url: string | null; size: number }) {
  if (!url) {
    return (
      <div className="rounded bg-bg-deep ring-1 ring-line/10 flex items-center justify-center"
        style={{ width: size, height: size }}>
        <Music size={Math.floor(size * 0.5)} className="text-ink-dim" />
      </div>
    );
  }
  return (
    <img src={url} alt="" loading="lazy"
      className="rounded ring-1 ring-line/10 object-cover bg-bg-deep"
      style={{ width: size, height: size }} />
  );
}

function PlayerBadge({ status, online }: { status: NowPlayingPlayerStatus; online: boolean }) {
  if (!online) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300"><WifiOff size={10} /> 오프라인</span>;
  const map: Record<NowPlayingPlayerStatus, { ko: string; cls: string; icon: React.ReactNode }> = {
    playing: { ko: '재생 중', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', icon: <Play size={10} /> },
    paused:  { ko: '일시정지', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', icon: <Pause size={10} /> },
    stopped: { ko: '정지', cls: 'bg-ink/15 text-ink-mute ring-line/20', icon: <Square size={10} /> },
    offline: { ko: '오프라인', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30', icon: <WifiOff size={10} /> },
    unknown: { ko: '대기', cls: 'bg-ink/15 text-ink-mute ring-line/20', icon: <Wifi size={10} /> },
  };
  const v = map[status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${v.cls}`}>{v.icon}{v.ko}</span>;
}

function EmptyState() {
  return (
    <div className="rounded-xl bg-bg-card px-6 py-12 text-center">
      <Music size={32} className="mx-auto text-ink-dim" />
      <p className="mt-3 text-sm font-bold">표시할 매장이 없습니다.</p>
      <p className="mt-1 text-[11px] text-ink-mute">필터를 변경하거나 business 사용자가 매장 모드에 진입하면 표시됩니다.</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <div className="hidden md:block rounded-xl bg-bg-card">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse border-b border-line/5 bg-bg-deep/30" />)}
      </div>
      <div className="space-y-2 md:hidden">
        {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-bg-card" />)}
      </div>
    </div>
  );
}

function formatRelative(thenMs: number, nowMs: number): string {
  const sec = Math.floor((nowMs - thenMs) / 1000);
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
