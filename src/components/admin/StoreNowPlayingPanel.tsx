/**
 * StoreNowPlayingPanel — Enterprise Priority 2-4 (Store Now Playing V2).
 *
 * 전국 매장 실시간 현재 재생곡 (super admin).
 *
 * 핵심:
 *   - Supabase Realtime (store_policy_sync_status) → 즉시 refetch
 *   - 15s fallback polling + 1s progress tick
 *   - document visibilitychange — hidden 시 polling/tick pause, focus 시 즉시 refetch
 *   - 7 상태 (playing/paused/stopped/buffering/error/offline/unknown) — representativeStatus()
 *   - DS v2 primitives: AdminSection / AdminStatCard / AdminSearch / AdminBadge / AdminButton
 *                       / AdminModal / AdminEmpty / AdminSkeleton / AdminAlert
 *
 * 절대 무수정 영역: Player 재생 / Queue / Crossfade / 추천 / 정산 / 결제 / Artist / AI / 기존 heartbeat.
 *
 * SQL: 0356 (view + RPC) + 0376 (KPI v2 — error_count / recent_track_changes_1m / recent_updates_1m)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Music, Wifi, WifiOff, Pause, Play, Square, AlertCircle,
  Activity, Volume2, Building2, MapPin, Loader2, Speaker, Mail, Hash,
} from 'lucide-react';
import {
  AdminSection, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminEmpty, AdminSkeleton, AdminAlert,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listNowPlaying, nowPlayingKpi, subscribeNowPlaying,
  type NowPlaying, type NowPlayingKpi, type NowPlayingStatusFilter,
} from '@/lib/api/nowPlayingApi';
import { adminListFranchises, type FranchiseListRow } from '@/lib/api/franchiseApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 100;
const FALLBACK_POLL_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 1_000;
const PROGRESS_TICK_MS = 1_000;

const STATUS_OPTIONS: ReadonlyArray<{ value: NowPlayingStatusFilter; label: string }> = [
  { value: 'online', label: '온라인' },
  { value: 'playing', label: '재생 중' },
  { value: 'offline', label: '오프라인' },
];

// =============================================================================
// Status (representative — 7 tone)
// =============================================================================

type RepStatus = 'error' | 'offline' | 'buffering' | 'playing' | 'paused' | 'stopped' | 'unknown';

interface StatusMeta {
  ko: string;
  tone: AdminToneName;
  icon: React.ReactNode;
}

const STATUS_META: Record<RepStatus, StatusMeta> = {
  error:     { ko: '오류',     tone: 'danger',  icon: <AlertCircle size={10} /> },
  offline:   { ko: '오프라인', tone: 'danger',  icon: <WifiOff size={10} /> },
  buffering: { ko: '버퍼링',   tone: 'info',    icon: <Loader2 size={10} className="animate-spin" /> },
  playing:   { ko: '재생 중',  tone: 'success', icon: <Play size={10} /> },
  paused:    { ko: '일시정지', tone: 'warning', icon: <Pause size={10} /> },
  stopped:   { ko: '정지',     tone: 'neutral', icon: <Square size={10} /> },
  unknown:   { ko: '대기',     tone: 'neutral', icon: <Wifi size={10} /> },
};

function representativeStatus(r: NowPlaying): RepStatus {
  if (r.playback_error && r.playback_error.trim().length > 0) return 'error';
  if (!r.is_online) return 'offline';
  // 트랙 시작 후 1초 이내 + duration 알려진 상태 — 사실상 버퍼링
  if (r.player_status === 'playing' && (r.elapsed_seconds ?? 0) <= 1 && (r.duration ?? 0) > 0) return 'buffering';
  if (r.player_status === 'playing') return 'playing';
  if (r.player_status === 'paused')  return 'paused';
  if (r.player_status === 'stopped') return 'stopped';
  if (r.player_status === 'offline') return 'offline';
  return 'unknown';
}

function StatusBadge({ row }: { row: NowPlaying }) {
  const meta = STATUS_META[representativeStatus(row)];
  return <AdminBadge tone={meta.tone} icon={meta.icon}>{meta.ko}</AdminBadge>;
}

// =============================================================================
// time helpers
// =============================================================================

function fmtTime(sec: number | null | undefined): string {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function timeAgo(thenMs: number | null | undefined, nowMs: number): string {
  if (!thenMs) return '—';
  const sec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function computeProgress(row: NowPlaying, now: number): { elapsed: number; remaining: number; pct: number } {
  if (!row.started_at || !row.duration) return { elapsed: 0, remaining: 0, pct: 0 };
  const startMs = new Date(row.started_at).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const elapsed = Math.min(elapsedSec, row.duration);
  const remaining = Math.max(0, row.duration - elapsed);
  const pct = row.duration > 0 ? Math.min(100, (elapsed / row.duration) * 100) : 0;
  return { elapsed, remaining, pct };
}

// =============================================================================
// Main panel
// =============================================================================

export default function StoreNowPlayingPanel() {
  const [rows, setRows] = useState<NowPlaying[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<NowPlayingKpi | null>(null);
  const [franchises, setFranchises] = useState<FranchiseListRow[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NowPlayingStatusFilter | ''>('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const [nowTick, setNowTick] = useState(() => Date.now());
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const [selected, setSelected] = useState<NowPlaying | null>(null);

  const refetchTimerRef = useRef<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
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
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [search, statusFilter, franchiseFilter, regionFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  // visibility — hidden 시 모든 background work 중단, focus 시 즉시 refetch
  useEffect(() => {
    const onVis = () => {
      const v = typeof document === 'undefined' ? true : !document.hidden;
      setVisible(v);
      if (v) void load(true);
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [load]);

  // Realtime subscribe (visible 일 때만) + debounce refetch
  useEffect(() => {
    if (!visible) return;
    const debouncedRefetch = () => {
      if (refetchTimerRef.current !== null) window.clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = window.setTimeout(() => { void load(true); }, REFETCH_DEBOUNCE_MS);
    };
    const sub = subscribeNowPlaying(() => debouncedRefetch());
    return () => {
      if (refetchTimerRef.current !== null) window.clearTimeout(refetchTimerRef.current);
      sub.unsubscribe();
    };
  }, [load, visible]);

  // 15s fallback polling (visible 일 때만)
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => void load(true), FALLBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [load, visible]);

  // 1s progress tick (visible 일 때만)
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setNowTick(Date.now()), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [visible]);

  // Filter sources (1회 load — 변경 빈도 매우 낮음)
  useEffect(() => {
    void adminListFranchises()
      .then(setFranchises)
      .catch((e) => console.warn('[NowPlaying] franchises load failed', e));
    void listEnterpriseRegions({ limit: 200 })
      .then((r) => setRegions(r.data))
      .catch((e) => console.warn('[NowPlaying] regions load failed', e));
  }, []);

  const onSearchChange = (v: string) => { setSearch(v); setOffset(0); };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    const total_count = kpi.total ?? 0;
    return [
      { label: '전체 매장',       value: total_count,                      tone: 'neutral' as AdminToneName, icon: <Speaker size={14} /> },
      { label: '재생 중',         value: kpi.playing,                       tone: 'success' as AdminToneName, icon: <Play size={14} /> },
      { label: '일시정지',        value: kpi.paused,                        tone: 'warning' as AdminToneName, icon: <Pause size={14} /> },
      { label: '오프라인',        value: kpi.offline,                       tone: 'danger'  as AdminToneName, icon: <WifiOff size={14} /> },
      { label: '오류',            value: kpi.error_count ?? 0,              tone: 'danger'  as AdminToneName, icon: <AlertCircle size={14} /> },
      { label: '최근 1분 업데이트', value: kpi.recent_updates_1m ?? 0,        tone: 'info'    as AdminToneName, icon: <Activity size={14} /> },
    ];
  }, [kpi]);

  const realtimeChip = (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${visible ? 'text-emerald-300' : 'text-ink-mute'}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${visible ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
      {visible ? 'Realtime' : '일시정지 (탭 비활성)'}
    </span>
  );

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Music size={16} /> 실시간 재생곡</span>}
      description="매장 트랙 변경 시 즉시 반영됩니다. 진행바는 1초마다 자동 증가하며, 탭이 비활성화되면 폴링이 중지됩니다."
      badge={<AdminBadge tone="primary" variant="subtle">Priority 2-4</AdminBadge>}
      action={
        <div className="flex items-center gap-2">
          {realtimeChip}
          <AdminButton
            tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void load(true)}
            disabled={loading || refreshing}
          >
            새로고침
          </AdminButton>
        </div>
      }
    >
      {/* KPI */}
      {kpiCards ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((c) => (
            <AdminStatCard key={c.label} label={c.label} value={c.value} tone={c.tone} icon={c.icon} />
          ))}
        </div>
      ) : (
        <AdminSkeleton variant="kpi" />
      )}

      {/* Filters */}
      <AdminSearch
        value={search}
        onChange={onSearchChange}
        placeholder="매장/본사/지역/곡명/아티스트"
        filters={
          <>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as NowPlayingStatusFilter | ''); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs"
            >
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={franchiseFilter}
              onChange={(e) => { setFranchiseFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs"
            >
              <option value="">전체 본사</option>
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select
              value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs"
            >
              <option value="">전체 지역</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total}개</span>}
      />

      {error && (
        <AdminAlert
          tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>}
        />
      )}

      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && rows.length === 0 && !error ? (
        <AdminEmpty
          icon={<Music size={28} />}
          title="표시할 매장이 없습니다."
          description="필터를 조정하거나, business 사용자가 매장 모드에 진입하면 표시됩니다."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">매장 / 본사·지역</th>
                  <th className="px-3 py-2">앨범</th>
                  <th className="px-3 py-2">곡 / 아티스트</th>
                  <th className="px-3 py-2 w-[220px]">진행</th>
                  <th className="px-3 py-2 text-right">남은</th>
                  <th className="px-3 py-2 text-right">볼륨</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <NowPlayingRow key={r.store_id} row={r} now={nowTick} onClick={() => setSelected(r)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <NowPlayingCard key={r.store_id} row={r} now={nowTick} onClick={() => setSelected(r)} />
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
              <AdminButton
                tone="neutral" variant="subtle" size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                이전
              </AdminButton>
              <span className="text-ink-mute tabular-nums">
                {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <AdminButton
                tone="neutral" variant="subtle" size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                다음
              </AdminButton>
            </div>
          )}
        </>
      )}

      <DetailModal row={selected} now={nowTick} onClose={() => setSelected(null)} />
    </AdminSection>
  );
}

// =============================================================================
// Row / Card / ProgressBar
// =============================================================================

function ProgressBar({ pct, durationKnown }: { pct: number; durationKnown: boolean }) {
  if (!durationKnown) return <div className="h-1 w-full rounded-full bg-bg-deep" />;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-bg-deep">
      <div
        className="h-full bg-emerald-400 transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface RowProps { row: NowPlaying; now: number; onClick: () => void }

function NowPlayingRow({ row, now, onClick }: RowProps) {
  const { elapsed, remaining, pct } = computeProgress(row, now);
  return (
    <tr
      className="cursor-pointer border-b border-line/5 hover:bg-bg-hover/30"
      onClick={onClick}
    >
      <td className="px-3 py-2">
        <div className="font-semibold text-ink">{row.store_name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-mute">
          {row.franchise_name && <span className="inline-flex items-center gap-1"><Building2 size={9} />{row.franchise_name}</span>}
          {row.region_name && <span className="inline-flex items-center gap-1"><MapPin size={9} />{row.region_name}</span>}
        </div>
      </td>
      <td className="px-3 py-2"><AlbumArt url={row.album_art_url} size={32} /></td>
      <td className="px-3 py-2">
        {row.track_title ? (
          <>
            <div className="max-w-[220px] truncate font-semibold text-ink">{row.track_title}</div>
            <div className="max-w-[220px] truncate text-[10px] text-ink-mute">{row.artist_name ?? '—'}</div>
          </>
        ) : (
          <span className="text-ink-dim">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {row.duration ? (
          <div className="space-y-0.5">
            <ProgressBar pct={pct} durationKnown />
            <div className="text-[10px] text-ink-dim tabular-nums">
              {fmtTime(elapsed)} / {fmtTime(row.duration)}
            </div>
          </div>
        ) : (
          <span className="text-[10px] text-ink-dim">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-mute">
        {row.duration ? `-${fmtTime(remaining)}` : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.volume != null ? (
          <span className="inline-flex items-center gap-1 text-ink-mute"><Volume2 size={10} /> {row.volume}%</span>
        ) : '—'}
      </td>
      <td className="px-3 py-2"><StatusBadge row={row} /></td>
      <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">
        {row.last_heartbeat_at ? timeAgo(new Date(row.last_heartbeat_at).getTime(), now) : '—'}
      </td>
    </tr>
  );
}

function NowPlayingCard({ row, now, onClick }: RowProps) {
  const { elapsed, remaining, pct } = computeProgress(row, now);
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-xl bg-bg-card p-3 text-left ring-1 ring-line/10 transition hover:ring-line/25"
    >
      <div className="flex items-start gap-3">
        <AlbumArt url={row.album_art_url} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink">{row.store_name}</div>
              <div className="truncate text-[10px] text-ink-mute">
                {row.franchise_name}{row.region_name && ` · ${row.region_name}`}
              </div>
            </div>
            <StatusBadge row={row} />
          </div>
          {row.track_title && (
            <div className="mt-1.5">
              <div className="truncate text-[12px] font-semibold text-ink">{row.track_title}</div>
              <div className="truncate text-[10px] text-ink-mute">{row.artist_name ?? '—'}</div>
            </div>
          )}
        </div>
      </div>
      {row.duration ? (
        <div className="mt-2 space-y-0.5">
          <ProgressBar pct={pct} durationKnown />
          <div className="flex justify-between text-[10px] text-ink-dim tabular-nums">
            <span>{fmtTime(elapsed)}</span>
            <span>-{fmtTime(remaining)}</span>
          </div>
        </div>
      ) : null}
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-dim">
        {row.volume != null && <span className="inline-flex items-center gap-1"><Volume2 size={9} /> {row.volume}%</span>}
        {row.last_heartbeat_at && <span>heartbeat {timeAgo(new Date(row.last_heartbeat_at).getTime(), now)}</span>}
      </div>
    </button>
  );
}

function AlbumArt({ url, size }: { url: string | null; size: number }) {
  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded bg-bg-deep ring-1 ring-line/10"
        style={{ width: size, height: size }}
      >
        <Music size={Math.floor(size * 0.5)} className="text-ink-dim" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="rounded bg-bg-deep object-cover ring-1 ring-line/10"
      style={{ width: size, height: size }}
    />
  );
}

// =============================================================================
// Detail modal
// =============================================================================

function DetailModal({ row, now, onClose }: { row: NowPlaying | null; now: number; onClose: () => void }) {
  if (!row) return null;
  const { elapsed, remaining, pct } = computeProgress(row, now);
  const heartbeatMs = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : null;
  const lastSeenMs  = row.last_seen_at      ? new Date(row.last_seen_at).getTime()      : null;
  const startedMs   = row.started_at        ? new Date(row.started_at).getTime()        : null;

  return (
    <AdminModal
      open={!!row}
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-2"><Music size={14} /> {row.store_name}</span>}
      headerExtra={<StatusBadge row={row} />}
      footer={<AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>닫기</AdminButton>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {/* 매장 정보 */}
        <DetailCard title="매장 정보">
          <KV k="매장" v={row.store_name} />
          <KV k="이메일" v={row.store_email ?? '—'} icon={<Mail size={10} />} />
          <KV k="본사" v={row.franchise_name ?? '—'} icon={<Building2 size={10} />} />
          <KV k="지역" v={row.region_name ? `${row.region_name} (${row.region_code ?? '—'})` : '—'} icon={<MapPin size={10} />} />
          <KV k="본사 그룹" v={row.enterprise_name ?? '—'} />
          <KV k="Store ID" v={<code className="text-[10px]">{row.store_id}</code>} icon={<Hash size={10} />} />
        </DetailCard>

        {/* 현재 곡 + 진행 */}
        <DetailCard title="현재 곡">
          <div className="flex items-start gap-3">
            <AlbumArt url={row.album_art_url} size={64} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-ink">{row.track_title ?? '—'}</div>
              <div className="truncate text-[11px] text-ink-mute">{row.artist_name ?? '—'}</div>
              {row.track_id && (
                <div className="mt-1 text-[10px] text-ink-dim"><code>track_id: {row.track_id}</code></div>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <ProgressBar pct={pct} durationKnown={!!row.duration} />
            <div className="flex justify-between text-[10px] text-ink-dim tabular-nums">
              <span>{fmtTime(elapsed)}</span>
              <span>{row.duration ? `-${fmtTime(remaining)}` : '—'}</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-ink-mute">
            <KV k="duration" v={row.duration ? `${fmtTime(row.duration)} (${row.duration}s)` : '—'} compact />
            <KV k="started_at" v={startedMs ? `${new Date(startedMs).toLocaleString('ko-KR')} (${timeAgo(startedMs, now)})` : '—'} compact />
          </div>
        </DetailCard>

        {/* 볼륨 & 기기 */}
        <DetailCard title="볼륨 & 기기">
          <KV k="볼륨" v={row.volume != null ? `${row.volume}%` : '—'} icon={<Volume2 size={10} />} />
          <KV k="앱 버전" v={row.app_version ?? '—'} />
          <KV k="player_status" v={<code className="text-[10px]">{row.player_status}</code>} />
          <KV k="is_online" v={row.is_online ? '예' : '아니오'} />
        </DetailCard>

        {/* Heartbeat */}
        <DetailCard title="Heartbeat">
          <KV
            k="마지막 heartbeat"
            v={heartbeatMs ? `${new Date(heartbeatMs).toLocaleString('ko-KR')} (${timeAgo(heartbeatMs, now)})` : '—'}
            icon={<Activity size={10} />}
          />
          <KV
            k="마지막 last_seen"
            v={lastSeenMs ? `${new Date(lastSeenMs).toLocaleString('ko-KR')} (${timeAgo(lastSeenMs, now)})` : '—'}
          />
        </DetailCard>

        {/* 오류 */}
        {row.playback_error && row.playback_error.trim().length > 0 ? (
          <div className="md:col-span-2">
            <AdminAlert
              tone="danger"
              title="재생 오류"
              description={row.playback_error}
            />
          </div>
        ) : null}
      </div>
    </AdminModal>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({ k, v, icon, compact = false }: { k: string; v: React.ReactNode; icon?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-[100px_1fr] items-baseline gap-2 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
      <span className="inline-flex items-center gap-1 text-ink-mute">{icon}{k}</span>
      <span className="min-w-0 break-words text-ink">{v}</span>
    </div>
  );
}
