/**
 * StoreMonitoringPanel — Enterprise Phase 1-3 v2 (Central Monitoring NOC).
 *
 * 매장 운영 관제 UI (super admin only).
 * - 상태 우선순위 single representative (Playback Error > Device > Policy > Update > Offline > 24h > 1h > Normal)
 * - KPI 6: 전체/정상/경고/오류/오프라인/정책 미동기화
 * - 컬럼: 매장/지역/기업/상태/heartbeat/정책/version/device/오류/접속/액션
 * - 필터: 기업/지역/상태/버전(client)/검색
 * - 행 클릭 → AdminModal (정보/Heartbeat/오류/정책/Device)
 * - 15s 자동 새로고침
 * - DS primitives 적용
 *
 * 무변경: heartbeat 저장 / 정책 적용 / store player / DB 계산식
 * SQL: 0353/0354/0355 (Phase 1-3 v1) — 모든 view/RPC 그대로
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Activity, AlertTriangle, Wifi, WifiOff, Music,
  MapPin, RotateCcw, Link as LinkIcon, Battery, Volume2, Clock,
  Smartphone, ShieldAlert, Cpu, AlertCircle,
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
import {
  AdminSection, AdminCard, AdminStatCard, AdminSearch, AdminBadge,
  AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminModal,
  AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import { adminTypography } from '@/lib/adminTypography';

const PAGE_SIZE = 25;
const AUTO_REFRESH_MS = 15_000;

const STATUS_FILTERS: ReadonlyArray<{ value: StoreMonitoringStatusFilter; label: string }> = [
  { value: 'online',          label: '정상' },
  { value: 'idle_1h',         label: '1시간 미접속' },
  { value: 'idle_24h',        label: '24시간 미접속' },
  { value: 'offline',         label: '오프라인 (24h+)' },
  { value: 'policy_outdated', label: '정책 미동기화' },
  { value: 'playback_error',  label: '재생 오류' },
  { value: 'volume_error',    label: '음량 오류' },
  { value: 'device_missing',  label: '기기 미연결' },
  { value: 'update_required', label: '업데이트 필요' },
];

// === 대표 상태 계산 (single representative, 우선순위 순) ===
type RepresentativeStatus =
  | 'playback_error' | 'device_missing' | 'policy_outdated' | 'update_required'
  | 'offline_24h'    | 'idle_24h'       | 'idle_1h'         | 'normal'
  | 'unknown';

function representativeStatus(r: StoreMonitoringRow): RepresentativeStatus {
  if (r.has_playback_error) return 'playback_error';
  if (r.has_device_missing) return 'device_missing';
  if (r.has_policy_outdated) return 'policy_outdated';
  if (r.has_update_required) return 'update_required';
  if (r.is_offline_24h)      return 'offline_24h';
  if (r.is_idle_1h_to_24h)   return 'idle_24h';
  if (r.is_idle_5m_to_1h)    return 'idle_1h';
  if (r.is_online)           return 'normal';
  return 'unknown';
}

const STATUS_META: Record<RepresentativeStatus, { tone: AdminToneName; label: string; icon: React.ReactNode }> = {
  playback_error:  { tone: 'danger',  label: '재생 오류',    icon: <AlertTriangle size={10} /> },
  device_missing:  { tone: 'neutral', label: '기기 미연결',  icon: <Smartphone size={10} /> },
  policy_outdated: { tone: 'info',    label: '정책 미동기화', icon: <ShieldAlert size={10} /> },
  update_required: { tone: 'primary', label: '업데이트 필요', icon: <RotateCcw size={10} /> },
  offline_24h:     { tone: 'danger',  label: 'OFFLINE',     icon: <WifiOff size={10} /> },
  idle_24h:        { tone: 'warning', label: '24h 미접속',   icon: <Clock size={10} /> },
  idle_1h:         { tone: 'warning', label: '1h 미접속',    icon: <Clock size={10} /> },
  normal:          { tone: 'success', label: '정상',         icon: <Wifi size={10} /> },
  unknown:         { tone: 'neutral', label: 'UNKNOWN',      icon: <AlertCircle size={10} /> },
};

function StatusBadge({ row }: { row: StoreMonitoringRow }) {
  const s = representativeStatus(row);
  const m = STATUS_META[s];
  return <AdminBadge tone={m.tone} icon={m.icon}>{m.label}</AdminBadge>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const ms = Date.now() - d;
  const m = Math.floor(ms / 60000);
  if (m < 1)    return '방금';
  if (m < 60)   return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR');
}


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
  const [versionFilter, setVersionFilter] = useState(''); // client-side
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<StoreMonitoringRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<StoreMonitoringRow | null>(null);

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

  // Auto refresh — 15s (silent)
  useEffect(() => {
    const t = setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // 옵션 로드 (한 번)
  useEffect(() => {
    let alive = true;
    Promise.all([
      adminListFranchises().catch(() => [] as FranchiseListRow[]),
      listEnterpriseRegions({ limit: 200, offset: 0 }).catch(() => ({ data: [] as EnterpriseRegion[] })),
    ]).then(([f, r]) => {
      if (!alive) return;
      setFranchises(Array.isArray(f) ? f : []);
      setRegions('data' in r ? r.data : []);
    });
    return () => { alive = false; };
  }, []);

  const handleForceResync = async (r: StoreMonitoringRow) => {
    setBusyId(r.id);
    try {
      await adminForceStoreResync(r.store_id);
      toast.success('강제 재동기화 신호 전송');
      await load();
    } catch (e) { toast.error(`재동기화 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  };

  // client-side version 필터
  const filteredRows = useMemo(() => {
    if (!versionFilter.trim()) return rows;
    const v = versionFilter.trim().toLowerCase();
    return rows.filter((r) =>
      (r.app_version ?? '').toLowerCase().includes(v)
      || (r.last_player_version ?? '').toLowerCase().includes(v),
    );
  }, [rows, versionFilter]);

  // KPI 6: 전체/정상/경고/오류/오프라인/정책 미동기화
  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    const warn = (kpi.idle_1h ?? 0) + (kpi.idle_24h ?? 0);
    const err  = (kpi.playback_errors ?? 0) + (kpi.volume_errors ?? 0) + (kpi.device_missing ?? 0);
    return [
      { label: '전체',         value: kpi.total,           icon: <Activity size={14} />,     tone: 'neutral' as AdminToneName },
      { label: '정상',         value: kpi.online,          icon: <Wifi size={14} />,         tone: 'success' as AdminToneName },
      { label: '경고',         value: warn,                icon: <Clock size={14} />,        tone: warn > 0 ? 'warning' as AdminToneName : 'neutral' as AdminToneName },
      { label: '오류',         value: err,                 icon: <AlertTriangle size={14} />, tone: err > 0 ? 'danger' as AdminToneName : 'neutral' as AdminToneName },
      { label: '오프라인',     value: kpi.offline,         icon: <WifiOff size={14} />,      tone: kpi.offline > 0 ? 'danger' as AdminToneName : 'neutral' as AdminToneName },
      { label: '정책 미동기화', value: kpi.policy_outdated, icon: <ShieldAlert size={14} />,  tone: kpi.policy_outdated > 0 ? 'info' as AdminToneName : 'neutral' as AdminToneName },
    ];
  }, [kpi]);

  return (
    <AdminSection
      title={<><Activity size={14} /> 매장 상태</>}
      badge={<span className={adminTypography.hint}>15초마다 자동 새로고침</span>}
      description="매장별 heartbeat / 정책 / 기기 / 버전 / 오류 통합 관제. 행 클릭 시 상세 모달."
      action={
        <AdminButton tone="neutral" variant="subtle" size="sm"
          leftIcon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
          onClick={() => void load()} disabled={loading}>
          새로고침
        </AdminButton>
      }
    >
      {kpiCards ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {kpiCards.map((c) => (
            <AdminStatCard key={c.label} tone={c.tone} icon={c.icon} label={c.label}
              value={c.value.toLocaleString('ko-KR')} />
          ))}
        </div>
      ) : <AdminSkeleton variant="kpi" />}

      <AdminSearch
        value={search}
        onChange={(v) => { setSearch(v); setOffset(0); }}
        placeholder="매장명/프랜차이즈/지역 검색"
        filters={
          <>
            <select value={franchiseFilter}
              onChange={(e) => { setFranchiseFilter(e.target.value); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="기업 필터"
            >
              <option value="">전체 기업</option>
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <select value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="지역 필터"
            >
              <option value="">전체 지역</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.region_name}</option>
              ))}
            </select>
            <select value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StoreMonitoringStatusFilter | ''); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="상태 필터"
            >
              <option value="">전체 상태</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input type="text" value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              placeholder="버전 (예: 0.1)"
              className="w-28 rounded bg-bg-deep px-2 py-1.5 text-xs font-mono"
              aria-label="버전 필터"
            />
          </>
        }
        trailing={
          (search || statusFilter || franchiseFilter || regionFilter || versionFilter) ? (
            <AdminButton tone="neutral" variant="subtle" size="sm"
              onClick={() => {
                setSearch(''); setStatusFilter(''); setFranchiseFilter('');
                setRegionFilter(''); setVersionFilter(''); setOffset(0);
              }}>
              초기화
            </AdminButton>
          ) : null
        }
      />

      {error && (
        <AdminAlert tone="danger" title="모니터링 로드 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      )}

      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : filteredRows.length === 0 ? (
        <AdminEmpty
          icon={<Activity size={20} />}
          title="조건에 맞는 매장이 없습니다"
          description="필터를 조정하거나 새로고침을 시도하세요."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10">
            <table className="w-full min-w-[1200px] text-xs">
              <thead className="bg-bg-deep text-[10px] uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="px-3 py-2 text-left">매장</th>
                  <th className="px-3 py-2 text-left">지역</th>
                  <th className="px-3 py-2 text-left">기업</th>
                  <th className="px-3 py-2 text-center">상태</th>
                  <th className="px-3 py-2 text-left">heartbeat</th>
                  <th className="px-3 py-2 text-left">정책</th>
                  <th className="px-3 py-2 text-left">version</th>
                  <th className="px-3 py-2 text-left">device</th>
                  <th className="px-3 py-2 text-left">최근 오류</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/10">
                {filteredRows.map((r) => (
                  <tr key={r.id}
                    onClick={() => setDetailTarget(r)}
                    className="cursor-pointer hover:bg-bg-hover/40">
                    <td className="px-3 py-2">
                      <div className={adminTypography.bodyStrong}>{r.store_name}</div>
                      {r.store_email && <div className={adminTypography.hint}>{r.store_email}</div>}
                    </td>
                    <td className="px-3 py-2 text-ink-mute">
                      {r.enterprise_region_name ?? '—'}
                      {r.enterprise_region_code && <span className={`ml-1 font-mono ${adminTypography.hint}`}>{r.enterprise_region_code}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{r.franchise_name ?? '—'}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge row={r} /></td>
                    <td className="px-3 py-2 text-[10px] text-ink-mute">
                      <div>{timeAgo(r.last_seen_at)}</div>
                      <div className={adminTypography.hint}>{fmtDateTime(r.last_seen_at)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-ink-mute">v{r.active_version_number}</div>
                      {r.has_policy_outdated && (
                        <AdminBadge tone="info" size="sm">미동기화</AdminBadge>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <div className="text-ink">{r.app_version ?? '—'}</div>
                      {r.has_update_required && <AdminBadge tone="primary" size="sm">업데이트</AdminBadge>}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <div className="text-ink truncate max-w-[140px]">{r.device_model ?? '—'}</div>
                      <div className={`${adminTypography.hint} truncate max-w-[140px]`}>{r.device_os ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.playback_error
                        ? <span className="text-rose-300 text-[10px] truncate max-w-[180px] inline-block">{r.playback_error}</span>
                        : <span className={adminTypography.hint}>—</span>}
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        row={r} busy={busyId === r.id}
                        onAssign={() => setAssignTarget(r)}
                        onResync={() => void handleForceResync(r)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filteredRows.map((r) => (
              <div key={r.id}
                onClick={() => setDetailTarget(r)}
                className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10 cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink">{r.store_name}</div>
                    <div className={adminTypography.hint}>
                      {r.franchise_name ?? '—'}
                      {r.enterprise_region_name && ` · ${r.enterprise_region_name}`}
                    </div>
                  </div>
                  <StatusBadge row={r} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-mute">
                  <div>heartbeat: <b className="text-ink">{timeAgo(r.last_seen_at)}</b></div>
                  <div>version: <b className="text-ink font-mono">{r.app_version ?? '—'}</b></div>
                  <div>policy: <b className="text-ink">v{r.active_version_number}</b></div>
                  <div className="truncate">device: <b className="text-ink">{r.device_model ?? '—'}</b></div>
                </div>
                {r.playback_error && (
                  <div className="mt-1 text-[10px] text-rose-300 truncate">{r.playback_error}</div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-xs text-ink-mute">
              <span>{offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString('ko-KR')}</span>
              <div className="flex gap-2">
                <AdminButton tone="neutral" variant="subtle" size="sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>이전</AdminButton>
                <AdminButton tone="neutral" variant="subtle" size="sm" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}>다음</AdminButton>
              </div>
            </div>
          )}
        </>
      )}

      {/* Assign region modal */}
      {assignTarget && (
        <AssignRegionModal
          row={assignTarget}
          regions={regions}
          onClose={() => setAssignTarget(null)}
          onSaved={() => { setAssignTarget(null); void load(); }}
        />
      )}

      {/* Detail modal */}
      {detailTarget && (
        <StoreDetailModal
          row={detailTarget}
          onClose={() => setDetailTarget(null)}
          onResync={() => void handleForceResync(detailTarget)}
          onAssign={() => { setAssignTarget(detailTarget); setDetailTarget(null); }}
        />
      )}
    </AdminSection>
  );
}


// =============================================================================
// Row actions
// =============================================================================

function RowActions({
  row, busy, onAssign, onResync,
}: {
  row: StoreMonitoringRow; busy: boolean;
  onAssign: () => void; onResync: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <AdminTooltip label="지역 매핑">
        <AdminButton tone="info" variant="subtle" size="sm" onClick={onAssign} disabled={busy}>
          <LinkIcon size={11} />
        </AdminButton>
      </AdminTooltip>
      <AdminTooltip label="강제 재동기화">
        <AdminButton tone="primary" variant="subtle" size="sm" onClick={onResync} disabled={busy}>
          <RotateCcw size={11} />
        </AdminButton>
      </AdminTooltip>
    </div>
  );
  void row;
}


// =============================================================================
// Assign Region Modal
// =============================================================================

function AssignRegionModal({
  row, regions, onClose, onSaved,
}: {
  row: StoreMonitoringRow;
  regions: EnterpriseRegion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [regionId, setRegionId] = useState<string>(row.enterprise_region_id ?? '');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await adminAssignStoreToEnterpriseRegion(row.store_id, regionId || null);
      toast.success('지역이 매핑되었습니다');
      onSaved();
    } catch (e) { toast.error(`매핑 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  return (
    <AdminModal
      open onClose={onClose} size="sm"
      title={<><MapPin size={14} /> 지역 매핑</>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" onClick={onClose} disabled={saving}>취소</AdminButton>
          <AdminButton tone="primary" loading={saving} onClick={() => void onSave()} disabled={saving}>
            저장
          </AdminButton>
        </>
      }
    >
      <div className="space-y-2 text-xs">
        <p className={adminTypography.description}>
          매장 <b className="text-ink">{row.store_name}</b> 의 지역을 선택하세요.
        </p>
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)}
          className="input">
          <option value="">— 해제 —</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>
          ))}
        </select>
      </div>
    </AdminModal>
  );
}


// =============================================================================
// Detail Modal — 매장 정보 + Heartbeat + 오류 + 정책 + Device + 확장
// =============================================================================

function StoreDetailModal({
  row, onClose, onResync, onAssign,
}: {
  row: StoreMonitoringRow;
  onClose: () => void;
  onResync: () => void;
  onAssign: () => void;
}) {
  return (
    <AdminModal
      open onClose={onClose} size="lg"
      title={<><Activity size={14} /> {row.store_name}</>}
      headerExtra={<StatusBadge row={row} />}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>
          <AdminButton tone="info" variant="subtle" leftIcon={<LinkIcon size={11} />} onClick={onAssign}>
            지역 매핑
          </AdminButton>
          <AdminButton tone="primary" variant="solid" leftIcon={<RotateCcw size={11} />} onClick={onResync}>
            강제 재동기화
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <AdminCard title="매장 정보">
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <KV k="매장명" v={row.store_name} />
            <KV k="이메일" v={row.store_email ?? '—'} />
            <KV k="기업" v={row.franchise_name ?? '—'} />
            <KV k="지역" v={row.enterprise_region_name ? `${row.enterprise_region_name} (${row.enterprise_region_code ?? '—'})` : '—'} />
          </dl>
        </AdminCard>

        <AdminCard title={<><Wifi size={11} className="inline mr-1" /> Heartbeat & 접속</>}>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <KV k="최근 접속" v={fmtDateTime(row.last_seen_at)} />
            <KV k="경과" v={timeAgo(row.last_seen_at)} />
            <KV k="player_status" v={row.player_status} mono />
            <KV k="connection" v={row.connection_type ?? '—'} />
            <KV k="wifi_ssid" v={row.wifi_ssid ?? '—'} />
            <KV k="updated_at" v={fmtDateTime(row.updated_at)} />
          </dl>
        </AdminCard>

        <AdminCard title={<><AlertTriangle size={11} className="inline mr-1" /> 최근 오류</>}>
          {row.playback_error ? (
            <AdminAlert tone="danger" title="재생 오류" description={row.playback_error} />
          ) : (
            <p className={adminTypography.description}>오류 없음</p>
          )}
          {row.has_volume_error && (
            <div className="mt-2">
              <AdminAlert tone="warning" title="음량 오류"
                description={`현재 볼륨 ${row.volume ?? '—'} — 0 또는 95 이상`} />
            </div>
          )}
          {row.has_device_missing && (
            <div className="mt-2">
              <AdminAlert tone="warning" title="기기 미연결"
                description="device_identifier 가 비어있습니다." />
            </div>
          )}
        </AdminCard>

        <AdminCard title={<><ShieldAlert size={11} className="inline mr-1" /> 정책</>}>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <KV k="active_policy_id" v={row.active_policy_id ?? '—'} mono />
            <KV k="active_version" v={`v${row.active_version_number}`} />
            <KV k="last_synced_at" v={fmtDateTime(row.last_synced_at)} />
            <KV k="last_policy_sync_at" v={fmtDateTime(row.last_policy_sync_at)} />
          </dl>
          {row.has_policy_outdated && (
            <div className="mt-2">
              <AdminAlert tone="info" title="정책 미동기화"
                description="최근 24시간 내 정책 동기화 신호 없음. 강제 재동기화 검토." />
            </div>
          )}
        </AdminCard>

        <AdminCard title={<><Cpu size={11} className="inline mr-1" /> Device & Version</>}>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <KV k="App Version" v={row.app_version ?? '—'} mono />
            <KV k="last_player_version" v={row.last_player_version ?? '—'} mono />
            <KV k="device_model" v={row.device_model ?? '—'} />
            <KV k="device_os" v={row.device_os ?? '—'} />
            <KV k="device_identifier" v={row.device_identifier ?? '—'} mono />
            <KV k="battery" v={row.battery_level != null ? `${row.battery_level}%` : '—'} />
            <KV k="volume" v={row.volume != null ? `${row.volume}%` : '—'} />
          </dl>
          {row.has_update_required && (
            <div className="mt-2">
              <AdminAlert tone="info" title="업데이트 필요"
                description={`App version (${row.app_version ?? '—'}) 가 최소 권장 버전 미만입니다.`} />
            </div>
          )}
        </AdminCard>

        <AdminCard title={<><Music size={11} className="inline mr-1" /> 현재 재생</>}>
          {row.current_track_id ? (
            <div className="text-[11px]">
              <div className={adminTypography.bodyStrong}>{row.current_track_title ?? '(제목 없음)'}</div>
              <div className={adminTypography.hint}>{row.current_track_artist ?? '—'}</div>
              {row.current_track_started_at && (
                <div className={`mt-1 ${adminTypography.hint}`}>
                  시작: {fmtDateTime(row.current_track_started_at)}
                </div>
              )}
            </div>
          ) : (
            <p className={adminTypography.description}>현재 재생 중인 트랙 없음</p>
          )}
        </AdminCard>

        <AdminCard title="향후 확장 (NOC)">
          <ul className={`list-disc pl-5 ${adminTypography.description} space-y-0.5`}>
            <li>실시간 알림 / 긴급 정책 강제 배포</li>
            <li>Realtime Player 직접 연결</li>
            <li>AI 추천 / 지역별 통계 / 장애 timeline</li>
          </ul>
        </AdminCard>
      </div>
    </AdminModal>
  );
}


// =============================================================================
// Small helper
// =============================================================================

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] text-ink-dim">{k}</dt>
      <dd className={`text-[11px] text-ink ${mono ? 'font-mono' : ''} break-words`}>{v}</dd>
    </div>
  );
}

// unused-import 회피 (lucide-react Battery/Volume2 등 SVG icon import 만 활용)
const _icons = [Battery, Volume2]; void _icons;
