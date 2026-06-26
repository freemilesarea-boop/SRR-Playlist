/**
 * StoreMonitoringPanel — Enterprise Phase 1-3.
 *
 * 매장 운영 관제 UI (super admin only).
 * - KPI 8개 카드 (전체/정상/경고/오프라인/정책미동기화/재생오류/음량오류/업데이트 필요)
 * - 검색 + 본사/지역/상태 필터 + 페이지네이션
 * - 15s 자동 새로고침
 * - Desktop table + Mobile cards
 * - 상태 badge (계산식 기반, 우선순위 적용)
 * - 액션: 지역 매핑, 강제 재동기화
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, AlertCircle, Activity, Wifi, WifiOff,
  Battery, Volume2, Music, Building2, MapPin, RotateCcw, Link as LinkIcon, X,
} from 'lucide-react';
import {
  adminStoreMonitoringKpi,
  adminListStoreMonitoring,
  adminAssignStoreToEnterpriseRegion,
  adminForceStoreResync,
  type StoreMonitoringRow,
  type StoreMonitoringKpi,
  type StoreMonitoringStatusFilter,
} from '@/lib/api/storeMonitoringApi';
import { adminListFranchises, type FranchiseListRow } from '@/lib/api/franchiseApi';
import {
  listEnterpriseRegions, type EnterpriseRegion,
} from '@/lib/api/enterpriseRegionsApi';
import { toast } from '@/store/toastStore';

const PAGE_SIZE = 25;
const AUTO_REFRESH_MS = 15_000;

const STATUS_FILTERS: ReadonlyArray<{ value: StoreMonitoringStatusFilter; label: string }> = [
  { value: 'online', label: '정상' },
  { value: 'idle_1h', label: '1시간 미접속' },
  { value: 'idle_24h', label: '24시간 미접속' },
  { value: 'offline', label: '오프라인 (24h+)' },
  { value: 'policy_outdated', label: '정책 미동기화' },
  { value: 'playback_error', label: '재생 오류' },
  { value: 'volume_error', label: '음량 오류' },
  { value: 'device_missing', label: '기기 미연결' },
  { value: 'update_required', label: '업데이트 필요' },
];

export default function StoreMonitoringPanel() {
  const [rows, setRows] = useState<StoreMonitoringRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<StoreMonitoringKpi | null>(null);
  const [franchises, setFranchises] = useState<FranchiseListRow[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StoreMonitoringStatusFilter | ''>('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<StoreMonitoringRow | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [list, k] = await Promise.all([
        adminListStoreMonitoring({
          search: search.trim() || null,
          status: statusFilter || null,
          franchiseId: franchiseFilter || null,
          enterpriseRegionId: regionFilter || null,
          limit: PAGE_SIZE, offset,
        }),
        adminStoreMonitoringKpi(),
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

  // Auto refresh — 15s
  useEffect(() => {
    const id = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Load filters data (franchises + regions)
  useEffect(() => {
    void adminListFranchises().then(setFranchises).catch((e) => console.warn('[StoreMonitoring] franchises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data)).catch((e) => console.warn('[StoreMonitoring] regions load failed', e));
  }, []);

  const handleForceResync = async (storeId: string) => {
    setBusyId(storeId);
    try {
      await adminForceStoreResync(storeId);
      toast.success('다음 폴링에서 강제 재동기화됩니다');
      await load();
    } catch (e) { toast.error(`재동기화 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const handleAssignRegion = async (storeId: string, regionId: string | null) => {
    setBusyId(storeId);
    try {
      await adminAssignStoreToEnterpriseRegion(storeId, regionId);
      toast.success(regionId ? '지역에 매핑되었습니다' : '지역 매핑이 해제되었습니다');
      setAssignTarget(null);
      await load();
    } catch (e) { toast.error(`매핑 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return [
      { label: '전체 매장', value: kpi.total, tone: 'text-ink', icon: <Activity size={12} /> },
      { label: '정상', value: kpi.online, tone: 'text-emerald-300', icon: <Wifi size={12} /> },
      { label: '경고 (1h)', value: kpi.idle_1h + kpi.idle_24h, tone: 'text-amber-300', icon: <Wifi size={12} /> },
      { label: '오프라인 (24h+)', value: kpi.offline, tone: 'text-rose-300', icon: <WifiOff size={12} /> },
      { label: '정책 미동기화', value: kpi.policy_outdated, tone: 'text-sky-300', icon: <RotateCcw size={12} /> },
      { label: '재생 오류', value: kpi.playback_errors, tone: 'text-purple-300', icon: <AlertCircle size={12} /> },
      { label: '음량 오류', value: kpi.volume_errors, tone: 'text-amber-300', icon: <Volume2 size={12} /> },
      { label: '업데이트 필요', value: kpi.update_required, tone: 'text-fuchsia-300', icon: <RefreshCw size={12} /> },
    ];
  }, [kpi]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Activity size={14} /> 매장 상태 모니터링
            <span className="text-[10px] font-normal text-ink-dim">(Enterprise Phase 1-3)</span>
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] text-ink-dim">15초마다 자동 새로고침</span>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          매장 플레이어가 60초마다 heartbeat 를 전송합니다. 5분 이내 정상, 5분~1시간 경고, 24시간+ 오프라인.
        </p>
      </div>

      {/* KPI */}
      {kpiCards && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">
                {c.icon}{c.label}
              </div>
              <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input type="text" placeholder="매장명/본사/지역 검색"
            value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="rounded bg-bg-deep pl-7 pr-2 py-1 w-56" />
        </div>
        <select value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StoreMonitoringStatusFilter | ''); setOffset(0); }}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 상태</option>
          {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
        <span className="ml-auto text-ink-dim">{total}개 (페이지 {Math.floor(offset / PAGE_SIZE) + 1})</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {/* Table / Cards */}
      {loading && rows.length === 0 ? (
        <SkeletonRows />
      ) : !loading && rows.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-3 py-2">매장</th>
                  <th className="px-3 py-2">본사 / 지역</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">접속</th>
                  <th className="px-3 py-2 text-right">배터리</th>
                  <th className="px-3 py-2 text-right">음량</th>
                  <th className="px-3 py-2">버전</th>
                  <th className="px-3 py-2">현재곡</th>
                  <th className="px-3 py-2 text-right">정책 동기화</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.store_name}</div>
                      <div className="text-[10px] text-ink-dim">{r.store_email ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-mute">
                      {r.franchise_name && <div className="flex items-center gap-1"><Building2 size={10} />{r.franchise_name}</div>}
                      {r.enterprise_region_name && <div className="flex items-center gap-1"><MapPin size={10} />{r.enterprise_region_name}</div>}
                      {!r.franchise_name && !r.enterprise_region_name && '—'}
                    </td>
                    <td className="px-3 py-2"><StatusBadge row={r} /></td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">
                      {r.last_seen_at ? formatRelative(r.last_seen_at) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.battery_level != null ? (
                        <span className={r.battery_level < 20 ? 'text-rose-300' : 'text-ink-mute'}>
                          <Battery size={10} className="inline" /> {r.battery_level}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.volume != null ? (
                        <span className={r.has_volume_error ? 'text-amber-300 font-bold' : 'text-ink-mute'}>
                          {r.volume}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-ink-mute">
                      {r.app_version ?? '—'}
                      {r.has_update_required && <span className="ml-1 text-fuchsia-300">⚠</span>}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-ink-mute truncate max-w-[140px]">
                      {r.current_track_title
                        ? <>{r.current_track_title}<div className="text-ink-dim">{r.current_track_artist}</div></>
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
                      {r.last_policy_sync_at
                        ? formatRelative(r.last_policy_sync_at)
                        : <span className="text-sky-300">미적용</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowActions
                        row={r} busy={busyId === r.store_id}
                        onAssignRegion={() => setAssignTarget(r)}
                        onForceResync={() => void handleForceResync(r.store_id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm">{r.store_name}</div>
                    <div className="text-[10px] text-ink-mute">
                      {r.franchise_name} {r.enterprise_region_name && `· ${r.enterprise_region_name}`}
                    </div>
                  </div>
                  <StatusBadge row={r} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                  <div className="text-ink-mute">접속: {r.last_seen_at ? formatRelative(r.last_seen_at) : '—'}</div>
                  <div className="text-ink-mute">정책: {r.last_policy_sync_at ? formatRelative(r.last_policy_sync_at) : '미적용'}</div>
                  {r.battery_level != null && <div>배터리 {r.battery_level}%</div>}
                  {r.volume != null && <div>음량 {r.volume}%</div>}
                  {r.app_version && <div className="col-span-2">버전 {r.app_version}</div>}
                  {r.current_track_title && (
                    <div className="col-span-2 truncate"><Music size={10} className="inline" /> {r.current_track_title}</div>
                  )}
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => setAssignTarget(r)}
                    className="flex-1 rounded bg-bg-deep px-2 py-1 text-[11px] font-bold">지역</button>
                  <button onClick={() => void handleForceResync(r.store_id)} disabled={busyId === r.store_id}
                    className="flex-1 rounded bg-sky-500/20 px-2 py-1 text-[11px] font-bold text-sky-300 disabled:opacity-50">재동기화</button>
                </div>
              </div>
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

      {assignTarget && (
        <AssignRegionModal target={assignTarget} regions={regions}
          busy={busyId === assignTarget.store_id}
          onCancel={() => setAssignTarget(null)}
          onAssign={(rid) => void handleAssignRegion(assignTarget.store_id, rid)} />
      )}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function StatusBadge({ row }: { row: StoreMonitoringRow }) {
  // 우선순위: playback_error > offline > idle_24h > policy_outdated > idle_1h > device_missing > online
  const v = (() => {
    if (row.has_playback_error) return { ko: '재생 오류', cls: 'bg-purple-500/15 text-purple-300 ring-purple-500/30' };
    if (row.is_offline_24h) return { ko: '오프라인', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' };
    if (row.is_idle_1h_to_24h) return { ko: '24h 미접속', cls: 'bg-orange-500/15 text-orange-300 ring-orange-500/30' };
    if (row.has_policy_outdated) return { ko: '정책 미동기화', cls: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' };
    if (row.is_idle_5m_to_1h) return { ko: '1h 미접속', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' };
    if (row.has_device_missing) return { ko: '기기 미연결', cls: 'bg-ink/15 text-ink-mute ring-line/20' };
    if (row.is_online) return { ko: '정상', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' };
    return { ko: '대기', cls: 'bg-ink/15 text-ink-mute ring-line/20' };
  })();
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${v.cls}`}>{v.ko}</span>;
}

function RowActions({
  row, busy, onAssignRegion, onForceResync,
}: {
  row: StoreMonitoringRow; busy: boolean;
  onAssignRegion: () => void; onForceResync: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button onClick={onAssignRegion} disabled={busy} title={row.enterprise_region_name ? `지역: ${row.enterprise_region_name}` : '지역 매핑'}
        className="rounded bg-sky-500/20 p-1 hover:bg-sky-500/30 disabled:opacity-50">
        <LinkIcon size={11} className="text-sky-300" />
      </button>
      <button onClick={onForceResync} disabled={busy} title="강제 재동기화"
        className="rounded bg-emerald-500/20 p-1 hover:bg-emerald-500/30 disabled:opacity-50">
        <RotateCcw size={11} className="text-emerald-300" />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl bg-bg-card px-6 py-12 text-center">
      <Activity size={32} className="mx-auto text-ink-dim" />
      <p className="mt-3 text-sm font-bold">표시할 매장이 없습니다.</p>
      <p className="mt-1 text-[11px] text-ink-mute">필터를 변경하거나 business 사용자가 매장 모드에 진입하면 표시됩니다.</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <div className="hidden md:block rounded-xl bg-bg-card">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse border-b border-line/5 bg-bg-deep/30" />
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-bg-card" />)}
      </div>
    </div>
  );
}

function AssignRegionModal({
  target, regions, busy, onCancel, onAssign,
}: {
  target: StoreMonitoringRow; regions: EnterpriseRegion[];
  busy: boolean; onCancel: () => void; onAssign: (regionId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string>(target.enterprise_region_id ?? '');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">지역 매핑</h3>
          <button onClick={onCancel} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>
        <p className="text-[11px] text-ink-mute mb-3">매장: <b>{target.store_name}</b></p>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
          className="input mb-3">
          <option value="">(매핑 없음)</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
        </select>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 rounded bg-bg-deep px-3 py-2 text-xs font-bold disabled:opacity-50">취소</button>
          <button onClick={() => onAssign(selected || null)} disabled={busy}
            className="flex-1 rounded bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? '저장 중…' : '적용'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}
