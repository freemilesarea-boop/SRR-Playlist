/**
 * EnterpriseAnnouncementsPanel — Priority 5 (Announcement Audio Scheduler V1).
 *
 * 광고/안내 음원 업로드 + 매장 예약 재생 관리.
 * SQL: supabase/migrations/0381_announcement_audio_scheduler_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, Music, Upload, Trash2, Edit3, Pause, Play, Power,
  Calendar, ListChecks, History, Volume2,
} from 'lucide-react';
import RecurrenceRuleBuilder from '@/components/admin/RecurrenceRuleBuilder';
import {
  AdminSection, AdminCard, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listAnnouncementAssets, createAnnouncementAsset, updateAnnouncementAsset, softDeleteAnnouncementAsset,
  listAnnouncementSchedules, createAnnouncementSchedule, updateAnnouncementSchedule,
  setAnnouncementScheduleStatus, deleteAnnouncementSchedule,
  uploadAnnouncementFile, ANNOUNCEMENT_MAX_BYTES, ANNOUNCEMENT_ALLOWED_MIME,
  type AnnouncementAsset, type AnnouncementSchedule, type AnnouncementAssetStatus,
  type AnnouncementScheduleStatus, type AnnouncementScopeType, type AnnouncementPlayMode,
} from '@/lib/api/announcementApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 50;

const ASSET_STATUS_META: Record<AnnouncementAssetStatus, { ko: string; tone: AdminToneName }> = {
  active:   { ko: '활성',   tone: 'success' },
  archived: { ko: '보관',   tone: 'neutral' },
  disabled: { ko: '비활성', tone: 'danger'  },
};

const SCHEDULE_STATUS_META: Record<AnnouncementScheduleStatus, { ko: string; tone: AdminToneName }> = {
  active:   { ko: '활성',     tone: 'success' },
  paused:   { ko: '일시정지', tone: 'warning' },
  expired:  { ko: '종료됨',   tone: 'neutral' },
  disabled: { ko: '비활성',   tone: 'danger'  },
};

const SCOPE_LABEL: Record<AnnouncementScopeType, string> = {
  enterprise: '본사 전체',
  region:     '지역',
  store:      '특정 매장',
};

type Tab = 'assets' | 'schedules';

export default function EnterpriseAnnouncementsPanel() {
  const [tab, setTab] = useState<Tab>('assets');
  const [refreshing, setRefreshing] = useState(false);

  // assets
  const [assets, setAssets] = useState<AnnouncementAsset[]>([]);
  const [assetsTotal, setAssetsTotal] = useState(0);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetStatus, setAssetStatus] = useState<AnnouncementAssetStatus | ''>('');

  // schedules
  const [schedules, setSchedules] = useState<AnnouncementSchedule[]>([]);
  const [schedulesTotal, setSchedulesTotal] = useState(0);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [schedSearch, setSchedSearch] = useState('');
  const [schedStatus, setSchedStatus] = useState<AnnouncementScheduleStatus | ''>('');

  // filter sources
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);

  // modals
  const [showUpload, setShowUpload] = useState(false);
  const [editAsset, setEditAsset] = useState<AnnouncementAsset | null>(null);
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [editSchedule, setEditSchedule] = useState<AnnouncementSchedule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; title: string; body: string } | null>(null);

  const loadAssets = useCallback(async (silent = false) => {
    if (!silent) setAssetsLoading(true);
    setAssetsError(null);
    try {
      const r = await listAnnouncementAssets({
        search: assetSearch.trim() || null,
        status: assetStatus || null,
        limit: PAGE_SIZE,
      });
      setAssets(r.data);
      setAssetsTotal(r.pagination.total);
    } catch (e) { setAssetsError((e as Error).message); }
    finally { if (!silent) setAssetsLoading(false); }
  }, [assetSearch, assetStatus]);

  const loadSchedules = useCallback(async (silent = false) => {
    if (!silent) setSchedulesLoading(true);
    setSchedulesError(null);
    try {
      const r = await listAnnouncementSchedules({
        search: schedSearch.trim() || null,
        status: schedStatus || null,
        limit: PAGE_SIZE,
      });
      setSchedules(r.data);
      setSchedulesTotal(r.pagination.total);
    } catch (e) { setSchedulesError((e as Error).message); }
    finally { if (!silent) setSchedulesLoading(false); }
  }, [schedSearch, schedStatus]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[announcements] enterprises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data))
      .catch((e) => console.warn('[announcements] regions load failed', e));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([loadAssets(true), loadSchedules(true)]); }
    finally { setRefreshing(false); }
  }, [loadAssets, loadSchedules]);

  const onDeleteAsset = useCallback(async (a: AnnouncementAsset) => {
    if (!window.confirm(`"${a.title}" 음원을 삭제하시겠습니까? (스케줄에서 사용 중이면 해당 스케줄도 영향)`)) return;
    setBusyId(a.id);
    try {
      await softDeleteAnnouncementAsset(a.id);
      setToast({ tone: 'warning', title: '음원이 삭제되었습니다.', body: a.title });
      await Promise.all([loadAssets(true), loadSchedules(true)]);
    } catch (e) { setToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message }); }
    finally { setBusyId(null); }
  }, [loadAssets, loadSchedules]);

  const onToggleScheduleStatus = useCallback(async (s: AnnouncementSchedule, next: AnnouncementScheduleStatus) => {
    setBusyId(s.id);
    try {
      await setAnnouncementScheduleStatus(s.id, next);
      setToast({ tone: 'success', title: '스케줄 상태 변경됨', body: `${s.name} → ${SCHEDULE_STATUS_META[next].ko}` });
      await loadSchedules(true);
    } catch (e) { setToast({ tone: 'danger', title: '상태 변경 실패', body: (e as Error).message }); }
    finally { setBusyId(null); }
  }, [loadSchedules]);

  const onDeleteSchedule = useCallback(async (s: AnnouncementSchedule) => {
    if (!window.confirm(`"${s.name}" 스케줄을 삭제하시겠습니까?`)) return;
    setBusyId(s.id);
    try {
      await deleteAnnouncementSchedule(s.id);
      setToast({ tone: 'warning', title: '스케줄이 삭제되었습니다.', body: s.name });
      await loadSchedules(true);
    } catch (e) { setToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message }); }
    finally { setBusyId(null); }
  }, [loadSchedules]);

  // KPI cards
  const kpi = useMemo(() => {
    const activeAssets = assets.filter((a) => a.status === 'active').length;
    const activeScheds = schedules.filter((s) => s.status === 'active').length;
    const plays7d = schedules.reduce((sum, s) => sum + (s.plays_7d ?? 0), 0);
    const nextRun = schedules
      .filter((s) => s.status === 'active' && s.next_run_at)
      .sort((a, b) => +new Date(a.next_run_at!) - +new Date(b.next_run_at!))[0]?.next_run_at;
    return {
      totalAssets: assetsTotal,
      activeAssets,
      totalScheds: schedulesTotal,
      activeScheds,
      plays7d,
      nextRun: nextRun ? new Date(nextRun).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—',
    };
  }, [assets, schedules, assetsTotal, schedulesTotal]);

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Volume2 size={16} /> 안내/광고 음원</span>}
      description="광고음원·안내멘트를 업로드하고 본사·지역·매장 단위로 예약 재생합니다. BGM 사이에 자동 삽입되며 곡 중간 강제 중단은 없습니다."
      badge={<AdminBadge tone="primary" variant="subtle">Priority 5 · V1</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>새로고침</AdminButton>
          <AdminButton tone="info" size="sm" leftIcon={<Upload size={12} />} onClick={() => setShowUpload(true)}>음원 업로드</AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={12} />}
            disabled={assets.length === 0}
            title={assets.length === 0 ? '음원을 먼저 업로드해 주세요' : undefined}
            onClick={() => setShowCreateSchedule(true)}>예약 재생 만들기</AdminButton>
        </div>
      }
    >
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="등록 음원" value={kpi.totalAssets} tone="neutral" icon={<Music size={14} />} />
        <AdminStatCard label="활성 음원" value={kpi.activeAssets} tone="success" icon={<Music size={14} />} />
        <AdminStatCard label="전체 스케줄" value={kpi.totalScheds} tone="neutral" icon={<ListChecks size={14} />} />
        <AdminStatCard label="활성 스케줄" value={kpi.activeScheds} tone="success" icon={<Play size={14} />} />
        <AdminStatCard label="최근 7일 재생" value={kpi.plays7d} tone="info" icon={<History size={14} />} />
        <AdminStatCard label="다음 재생" value={kpi.nextRun} tone="warning" icon={<Calendar size={14} />} />
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        <TabBtn active={tab === 'assets'} onClick={() => setTab('assets')}>
          <Music size={12} /> 음원 목록 <span className="text-[10px] text-ink-mute tabular-nums">{assetsTotal}</span>
        </TabBtn>
        <TabBtn active={tab === 'schedules'} onClick={() => setTab('schedules')}>
          <ListChecks size={12} /> 예약 재생 <span className="text-[10px] text-ink-mute tabular-nums">{schedulesTotal}</span>
        </TabBtn>
      </div>

      {tab === 'assets' ? (
        <AssetsView
          assets={assets} loading={assetsLoading} error={assetsError}
          search={assetSearch} setSearch={setAssetSearch}
          status={assetStatus} setStatus={setAssetStatus}
          busyId={busyId}
          onEdit={setEditAsset}
          onDelete={onDeleteAsset}
          onReload={() => void loadAssets()}
        />
      ) : (
        <SchedulesView
          schedules={schedules} loading={schedulesLoading} error={schedulesError}
          search={schedSearch} setSearch={setSchedSearch}
          status={schedStatus} setStatus={setSchedStatus}
          busyId={busyId}
          onEdit={setEditSchedule}
          onToggleStatus={onToggleScheduleStatus}
          onDelete={onDeleteSchedule}
          onReload={() => void loadSchedules()}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone={toast.tone} title={toast.title} description={toast.body} />
        </div>
      )}

      {(showUpload || editAsset) && (
        <AssetUploadModal
          mode={editAsset ? 'edit' : 'create'}
          asset={editAsset}
          enterprises={enterprises}
          onClose={() => { setShowUpload(false); setEditAsset(null); }}
          onSaved={async (msg) => {
            setShowUpload(false); setEditAsset(null);
            setToast({ tone: 'success', title: '저장됨', body: msg });
            await loadAssets(true);
          }}
        />
      )}

      {(showCreateSchedule || editSchedule) && (
        <ScheduleModal
          mode={editSchedule ? 'edit' : 'create'}
          schedule={editSchedule}
          assets={assets.filter((a) => a.status === 'active')}
          enterprises={enterprises}
          regions={regions}
          onClose={() => { setShowCreateSchedule(false); setEditSchedule(null); }}
          onSaved={async (msg) => {
            setShowCreateSchedule(false); setEditSchedule(null);
            setToast({ tone: 'success', title: '저장됨', body: msg });
            await loadSchedules(true);
          }}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// Sub
// =============================================================================

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active ? 'bg-violet-600 text-white shadow-sm shadow-black/20' : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}>
      {children}
    </button>
  );
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// =============================================================================
// Assets view
// =============================================================================

function AssetsView(props: {
  assets: AnnouncementAsset[]; loading: boolean; error: string | null;
  search: string; setSearch: (v: string) => void;
  status: AnnouncementAssetStatus | ''; setStatus: (v: AnnouncementAssetStatus | '') => void;
  busyId: string | null;
  onEdit: (a: AnnouncementAsset) => void;
  onDelete: (a: AnnouncementAsset) => void;
  onReload: () => void;
}) {
  const { assets, loading, error, busyId, onEdit, onDelete, onReload } = props;
  return (
    <div className="space-y-3">
      <AdminSearch
        value={props.search} onChange={props.setSearch}
        placeholder="제목 / 설명 / 파일명 검색"
        filters={
          <select value={props.status}
            onChange={(e) => props.setStatus(e.target.value as AnnouncementAssetStatus | '')}
            className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            <option value="">전체 상태</option>
            {(Object.keys(ASSET_STATUS_META) as AnnouncementAssetStatus[]).map((s) => (
              <option key={s} value={s}>{ASSET_STATUS_META[s].ko}</option>
            ))}
          </select>
        }
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReload}>재시도</AdminButton>} />
      )}

      {loading && assets.length === 0 ? (
        <AdminSkeleton variant="table" rows={5} />
      ) : !loading && assets.length === 0 && !error ? (
        <AdminEmpty icon={<Music size={28} />} title="등록된 음원이 없습니다." description="우측 상단 '음원 업로드' 버튼으로 시작하세요." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2">제목</th>
                <th className="px-3 py-2">파일</th>
                <th className="px-3 py-2 text-right">길이</th>
                <th className="px-3 py-2 text-right">용량</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2 text-right">스케줄</th>
                <th className="px-3 py-2 text-right">등록일</th>
                <th className="px-3 py-2">미리듣기 / 액션</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{a.title}</div>
                    {a.description && <div className="truncate max-w-[200px] text-[10px] text-ink-mute">{a.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-ink-mute truncate max-w-[200px]">{a.file_name ?? a.file_path.split('/').pop()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{fmtDuration(a.duration_seconds)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{fmtBytes(a.file_size_bytes)}</td>
                  <td className="px-3 py-2"><AdminBadge tone={ASSET_STATUS_META[a.status].tone}>{ASSET_STATUS_META[a.status].ko}</AdminBadge></td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.schedule_count}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-ink-mute">{fmtDate(a.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <audio src={a.file_url} controls preload="none" className="h-7 max-w-[160px]" />
                      <AdminTooltip label="수정">
                        <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<Edit3 size={11} />}
                          onClick={() => onEdit(a)}>—</AdminButton>
                      </AdminTooltip>
                      <AdminTooltip label="삭제">
                        <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                          loading={busyId === a.id}
                          onClick={() => onDelete(a)}>—</AdminButton>
                      </AdminTooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Schedules view
// =============================================================================

function SchedulesView(props: {
  schedules: AnnouncementSchedule[]; loading: boolean; error: string | null;
  search: string; setSearch: (v: string) => void;
  status: AnnouncementScheduleStatus | ''; setStatus: (v: AnnouncementScheduleStatus | '') => void;
  busyId: string | null;
  onEdit: (s: AnnouncementSchedule) => void;
  onToggleStatus: (s: AnnouncementSchedule, next: AnnouncementScheduleStatus) => void;
  onDelete: (s: AnnouncementSchedule) => void;
  onReload: () => void;
}) {
  const { schedules, loading, error, busyId, onEdit, onToggleStatus, onDelete, onReload } = props;
  return (
    <div className="space-y-3">
      <AdminSearch
        value={props.search} onChange={props.setSearch}
        placeholder="이름 / 설명 / 음원 검색"
        filters={
          <select value={props.status}
            onChange={(e) => props.setStatus(e.target.value as AnnouncementScheduleStatus | '')}
            className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            <option value="">전체 상태</option>
            {(Object.keys(SCHEDULE_STATUS_META) as AnnouncementScheduleStatus[]).map((s) => (
              <option key={s} value={s}>{SCHEDULE_STATUS_META[s].ko}</option>
            ))}
          </select>
        }
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReload}>재시도</AdminButton>} />
      )}

      {loading && schedules.length === 0 ? (
        <AdminSkeleton variant="table" rows={5} />
      ) : !loading && schedules.length === 0 && !error ? (
        <AdminEmpty icon={<ListChecks size={28} />} title="등록된 예약 재생이 없습니다." description="음원을 먼저 업로드한 뒤 '예약 재생 만들기' 로 시작하세요." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">음원</th>
                <th className="px-3 py-2">대상</th>
                <th className="px-3 py-2">반복 규칙</th>
                <th className="px-3 py-2 text-right">최근 재생</th>
                <th className="px-3 py-2 text-right">일별 한도</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{s.name}</div>
                    {s.description && <div className="truncate max-w-[200px] text-[10px] text-ink-mute">{s.description}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-ink">{s.asset_title ?? '—'}</div>
                    <div className="text-[10px] text-ink-mute">{fmtDuration(s.asset_duration)}</div>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <div>{SCOPE_LABEL[s.scope_type]}</div>
                    {s.scope_type === 'region' && s.region_name && (
                      <div className="text-[10px] text-ink-mute">{s.region_name} ({s.region_code})</div>
                    )}
                    {s.scope_type === 'store' && (
                      <div className="text-[10px] text-ink-mute">{s.scope_store_ids?.length ?? 0}개 매장</div>
                    )}
                    {s.enterprise_name && (
                      <div className="text-[10px] text-ink-dim">{s.enterprise_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-mute">{s.recurrence_rule ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-[10px] text-ink-mute">{fmtDate(s.last_played_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="text-ink-mute">{s.plays_7d ?? 0} / {s.max_plays_per_day * 7}</span>
                  </td>
                  <td className="px-3 py-2"><AdminBadge tone={SCHEDULE_STATUS_META[s.status].tone}>{SCHEDULE_STATUS_META[s.status].ko}</AdminBadge></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {s.status === 'active' ? (
                        <AdminTooltip label="일시정지">
                          <AdminButton tone="neutral" variant="ghost" size="sm" leftIcon={<Pause size={11} />}
                            loading={busyId === s.id}
                            onClick={() => onToggleStatus(s, 'paused')}>—</AdminButton>
                        </AdminTooltip>
                      ) : s.status === 'paused' ? (
                        <AdminTooltip label="활성화">
                          <AdminButton tone="success" variant="ghost" size="sm" leftIcon={<Play size={11} />}
                            loading={busyId === s.id}
                            onClick={() => onToggleStatus(s, 'active')}>—</AdminButton>
                        </AdminTooltip>
                      ) : s.status !== 'disabled' && (
                        <AdminTooltip label="비활성">
                          <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Power size={11} />}
                            loading={busyId === s.id}
                            onClick={() => onToggleStatus(s, 'disabled')}>—</AdminButton>
                        </AdminTooltip>
                      )}
                      <AdminTooltip label="수정">
                        <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<Edit3 size={11} />}
                          onClick={() => onEdit(s)}>—</AdminButton>
                      </AdminTooltip>
                      <AdminTooltip label="삭제">
                        <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                          loading={busyId === s.id}
                          onClick={() => onDelete(s)}>—</AdminButton>
                      </AdminTooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// AssetUploadModal
// =============================================================================

function AssetUploadModal({
  mode, asset, enterprises, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  asset: AnnouncementAsset | null;
  enterprises: EnterpriseAccount[];
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(asset?.title ?? '');
  const [description, setDescription] = useState(asset?.description ?? '');
  const [enterpriseId, setEnterpriseId] = useState(asset?.enterprise_account_id ?? '');
  const [status, setStatus] = useState<AnnouncementAssetStatus>(asset?.status ?? 'active');
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // WEB-OPT-8 — 미리듣기 blob URL 은 file 당 1회만 생성하고 언마운트/파일변경 시 revoke.
  //   이전에는 JSX 에서 URL.createObjectURL(file) 을 인라인 호출해 렌더(=제목 입력 등 키 입력)
  //   마다 새 blob URL 이 생성되고 하나도 해제되지 않아 모달을 여는 동안 누적됐다.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onFile = (f: File | null) => {
    setErr(null);
    setFile(f);
    setDuration(null);
    if (!f) return;
    // detect duration
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.src = url;
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      URL.revokeObjectURL(url);
    });
    audio.addEventListener('error', () => URL.revokeObjectURL(url));
  };

  const onSubmit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('제목을 입력해 주세요.'); return; }
    if (isEdit && asset) {
      setBusy(true);
      try {
        await updateAnnouncementAsset(asset.id, { title, description: description || null, status });
        await onSaved(`음원 수정됨: ${title}`);
      } catch (e) { setErr((e as Error).message); }
      finally { setBusy(false); }
      return;
    }
    if (!file) { setErr('업로드할 파일을 선택해 주세요.'); return; }
    setBusy(true);
    try {
      const upload = await uploadAnnouncementFile(file, enterpriseId || null);
      await createAnnouncementAsset({
        title,
        fileUrl: upload.publicUrl,
        filePath: upload.path,
        fileName: file.name,
        mimeType: upload.mimeType,
        fileSizeBytes: upload.sizeBytes,
        durationSeconds: duration,
        description: description || null,
        enterpriseAccountId: enterpriseId || null,
        status,
      });
      await onSaved(`음원 등록됨: ${title}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="lg"
      title={<span className="flex items-center gap-2">{isEdit ? <Edit3 size={14} /> : <Upload size={14} />} {isEdit ? '음원 수정' : '음원 업로드'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>
            {isEdit ? '저장' : '업로드'}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        {!isEdit && (
          <label className="block">
            <span className="text-ink-dim">오디오 파일 * (mp3 / wav / m4a / aac, 최대 20MB)</span>
            <input type="file" accept={ANNOUNCEMENT_ALLOWED_MIME.join(',')}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-violet-500/25 file:px-2 file:py-1 file:text-violet-200" />
            {file && (
              <p className="mt-1 text-[10px] text-ink-mute">
                {file.name} · {fmtBytes(file.size)} {duration && `· ${fmtDuration(duration)}`}
              </p>
            )}
            <p className="mt-1 text-[10px] text-ink-dim">최대 {ANNOUNCEMENT_MAX_BYTES / 1024 / 1024}MB.</p>
          </label>
        )}

        <label className="block">
          <span className="text-ink-dim">제목 *</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 쿠우쿠우 광고음원 / 점심 안내멘트"
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>

        <label className="block">
          <span className="text-ink-dim">설명 (선택)</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-ink-dim">소속 본사 (선택)</span>
            <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
              disabled={isEdit}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5 disabled:opacity-50">
              <option value="">전체 공용</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-dim">상태</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as AnnouncementAssetStatus)}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
              {(Object.keys(ASSET_STATUS_META) as AnnouncementAssetStatus[]).map((s) => (
                <option key={s} value={s}>{ASSET_STATUS_META[s].ko}</option>
              ))}
            </select>
          </label>
        </div>

        {!isEdit && file && (
          <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">미리듣기</div>
            {previewUrl && <audio src={previewUrl} controls className="w-full" />}
          </div>
        )}

        {isEdit && asset && (
          <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">현재 음원</div>
            <audio src={asset.file_url} controls className="w-full" />
            <div className="mt-1 text-[10px] text-ink-dim">파일 자체 교체는 V1 미지원 — 새 음원으로 별도 업로드해 주세요.</div>
          </div>
        )}

        {err && <AdminAlert tone="danger" title="저장 실패" description={err} />}
      </div>
    </AdminModal>
  );
}

// =============================================================================
// ScheduleModal
// =============================================================================

function ScheduleModal({
  mode, schedule, assets, enterprises, regions, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  schedule: AnnouncementSchedule | null;
  assets: AnnouncementAsset[];
  enterprises: EnterpriseAccount[];
  regions: EnterpriseRegion[];
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const isEdit = mode === 'edit';
  const [assetId, setAssetId] = useState(schedule?.asset_id ?? (assets[0]?.id ?? ''));
  const [name, setName] = useState(schedule?.name ?? '');
  const [description, setDescription] = useState(schedule?.description ?? '');
  const [enterpriseId, setEnterpriseId] = useState(schedule?.enterprise_account_id ?? '');
  const [scopeType, setScopeType] = useState<AnnouncementScopeType>(schedule?.scope_type ?? 'enterprise');
  const [regionId, setRegionId] = useState(schedule?.region_id ?? '');
  const [storeIdsCsv, setStoreIdsCsv] = useState((schedule?.scope_store_ids ?? []).join(', '));
  const [startsAt, setStartsAt] = useState(schedule?.starts_at ? toLocalDt(schedule.starts_at) : '');
  const [endsAt, setEndsAt] = useState(schedule?.ends_at ? toLocalDt(schedule.ends_at) : '');
  const [recurrence, setRecurrence] = useState(schedule?.recurrence_rule ?? '');
  const [playMode, setPlayMode] = useState<AnnouncementPlayMode>(schedule?.play_mode ?? 'after_current_track');
  const [maxPlays, setMaxPlays] = useState(schedule?.max_plays_per_day ?? 10);
  const [status, setStatus] = useState<AnnouncementScheduleStatus>(schedule?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!assetId) { setErr('음원을 선택해 주세요.'); return; }
    if (!name.trim()) { setErr('이름을 입력해 주세요.'); return; }
    if (scopeType === 'region' && !regionId) { setErr('지역 범위는 지역을 선택해 주세요.'); return; }
    const storeIds = scopeType === 'store' ? storeIdsCsv.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (scopeType === 'store' && (!storeIds || storeIds.length === 0)) { setErr('매장 범위는 매장 ID를 1개 이상 입력해 주세요.'); return; }

    setBusy(true);
    try {
      if (isEdit && schedule) {
        await updateAnnouncementSchedule({
          id: schedule.id, name, description: description || null, status,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt:   endsAt   ? new Date(endsAt).toISOString()   : null,
          recurrenceRule: recurrence || null, playMode, maxPlaysPerDay: maxPlays,
          regionId: scopeType === 'region' ? regionId : null,
          scopeType, scopeStoreIds: storeIds,
          clearRegion: scopeType !== 'region', clearScopeStores: scopeType !== 'store',
        });
        await onSaved(`예약 재생 수정됨: ${name}`);
      } else {
        await createAnnouncementSchedule({
          assetId, name, scopeType,
          enterpriseAccountId: enterpriseId || null,
          regionId: scopeType === 'region' ? regionId : null,
          scopeStoreIds: storeIds, description: description || null, status,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt:   endsAt   ? new Date(endsAt).toISOString()   : null,
          recurrenceRule: recurrence || null, playMode, maxPlaysPerDay: maxPlays,
        });
        await onSaved(`예약 재생 생성됨: ${name}`);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2">{isEdit ? <Edit3 size={14} /> : <Plus size={14} />} {isEdit ? '예약 재생 수정' : '예약 재생 만들기'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>
            {isEdit ? '저장' : '생성'}
          </AdminButton>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 text-xs">
        <Field label="음원 *" full>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="">음원을 선택하세요</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.title} ({fmtDuration(a.duration_seconds)})</option>
            ))}
          </select>
        </Field>

        <Field label="이름 *">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="예) 점심시간 안내방송"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="상태">
          <select value={status} onChange={(e) => setStatus(e.target.value as AnnouncementScheduleStatus)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            {(Object.keys(SCHEDULE_STATUS_META) as AnnouncementScheduleStatus[]).map((s) => (
              <option key={s} value={s}>{SCHEDULE_STATUS_META[s].ko}</option>
            ))}
          </select>
        </Field>

        <Field label="소속 본사 (선택)">
          <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 disabled:opacity-50">
            <option value="">전체 공용</option>
            {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
          </select>
        </Field>
        <Field label="범위 *">
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as AnnouncementScopeType)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            {(Object.keys(SCOPE_LABEL) as AnnouncementScopeType[]).map((s) => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </Field>

        {scopeType === 'region' && (
          <Field label="지역 *" full>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="">지역을 선택하세요</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
          </Field>
        )}
        {scopeType === 'store' && (
          <Field label="매장 ID 목록 (쉼표 구분) *" full>
            <textarea rows={2} value={storeIdsCsv} onChange={(e) => setStoreIdsCsv(e.target.value)}
              placeholder="매장 ID 를 쉼표로 구분"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
          </Field>
        )}

        <Field label="시작 일시">
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="종료 일시">
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="반복 일정 *" full>
          <RecurrenceRuleBuilder
            value={recurrence || null}
            onChange={(v) => setRecurrence(v ?? '')}
            defaultOnceDt={startsAt || ''}
          />
        </Field>

        <Field label="재생 모드">
          <select value={playMode} onChange={(e) => setPlayMode(e.target.value as AnnouncementPlayMode)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="after_current_track">현재 곡 끝난 뒤</option>
            <option value="between_tracks">곡 사이 (V1: 동일)</option>
          </select>
        </Field>
        <Field label="일별 최대 재생 횟수 (1~100)">
          <input type="number" min={1} max={100} value={maxPlays}
            onChange={(e) => setMaxPlays(parseInt(e.target.value || '10', 10))}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="설명" full>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
      </div>

      {err && <div className="mt-3"><AdminAlert tone="danger" title="저장 실패" description={err} /></div>}
    </AdminModal>
  );
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-xs ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-ink-dim">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

function toLocalDt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// `AdminCard` is imported but not used in the body — keep import deliberately for future detail modal.
void AdminCard;
