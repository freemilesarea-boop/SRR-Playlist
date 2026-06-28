/**
 * PolicyDeploymentPanel — Enterprise Priority 2-5/6/7 (Policy Deployment Center V2).
 *
 * 정책 배포 관제 센터.
 *   - 시스템 전체 적용률 (총 매장 / 완료 / 대기 / 실패 / 적용률 % / 최근 배포)
 *   - 배포 로그 (per-deployment) + 실패 매장 (cross-deployment) — 탭 분리
 *   - 단건 / 일괄 재시도 + 감사 로그 (admin_operation_logs)
 *
 * 데이터 소스:
 *   - admin_policy_deployment_overview()           (0377 — NEW)
 *   - admin_list_policy_deployments(...)           (0359 — 기존)
 *   - admin_policy_deployment_failed_stores(...)   (0377 — NEW)
 *   - admin_get_policy_deployment_detail(...)      (0359 — 기존)
 *   - admin_request_policy_retry(...)              (0377 — NEW 단건)
 *   - admin_retry_policy_deployment_targets(...)   (0359 — 일괄)
 *   - admin_recompute_policy_deployment(...)       (0359 — 재계산)
 *   - admin_mark_policy_target_failed(...)         (0359 — 수동 실패 처리)
 *   - admin_create_policy_deployment(...)          (0359 — 신규 배포)
 *   - admin_list_deployable_policies(...)          (0360 — 배포 가능 정책 dropdown)
 *
 * 절대 무수정:
 *   apply_franchise_policy / get_store_active_music_policy / store_heartbeat /
 *   store_now_playing / settlement / payment / artist / queue / crossfade / AI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, AlertCircle, Building2, MapPin, ListChecks, Plus, X,
  CheckCircle2, Clock, RotateCcw, Calculator, ChevronDown, Star,
  Inbox, Store as StoreIcon, ArrowRight, ShieldCheck, Activity, Wifi, WifiOff,
  TrendingUp, History, Search,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listPolicyDeployments, getPolicyDeploymentKpi, getPolicyDeploymentDetail,
  createPolicyDeployment, recomputePolicyDeployment, retryPolicyDeploymentTargets,
  markPolicyTargetFailed, listDeployablePolicies,
  getPolicyDeploymentOverview, listFailedDeploymentStores, requestPolicyRetry,
  type PolicyDeployment, type PolicyDeploymentKpi, type PolicyDeploymentStatus,
  type PolicyDeploymentDetail, type PolicyDeploymentTargetStatus,
  type DeployablePolicy,
  type PolicyDeploymentOverview,
  type FailedDeploymentStore, type PolicyFailureCategory,
} from '@/lib/api/policyDeploymentApi';
import { adminListFranchises, type FranchiseListRow } from '@/lib/api/franchiseApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 50;

// =============================================================================
// Status → DS tone mapping (Priority 2-5/6/7 spec)
// =============================================================================

const DEPLOYMENT_STATUS_META: Record<PolicyDeploymentStatus, { ko: string; tone: AdminToneName }> = {
  completed:      { ko: '완료',     tone: 'success' },
  pending:        { ko: '대기',     tone: 'warning' },
  failed:         { ko: '실패',     tone: 'danger'  },
  partial_failed: { ko: '부분 실패', tone: 'info'    },
  running:        { ko: '진행 중',  tone: 'primary' },
  cancelled:      { ko: '취소',     tone: 'neutral' },
};

const TARGET_STATUS_META: Record<PolicyDeploymentTargetStatus, { ko: string; tone: AdminToneName }> = {
  success:  { ko: '성공',    tone: 'success' },
  pending:  { ko: '대기',    tone: 'warning' },
  failed:   { ko: '실패',    tone: 'danger'  },
  applying: { ko: '적용 중', tone: 'primary' },
  stale:    { ko: '구버전',  tone: 'warning' },
  skipped:  { ko: '제외',    tone: 'neutral' },
};

const FAILURE_CATEGORY_META: Record<PolicyFailureCategory, { ko: string; tone: AdminToneName; hint: string }> = {
  policy_version_mismatch: { ko: '정책 버전 불일치', tone: 'danger',  hint: '적용 버전이 기대 버전보다 낮음' },
  heartbeat_missing:       { ko: 'Heartbeat 없음', tone: 'danger',  hint: 'sync_status 미등록 매장' },
  device_offline:          { ko: '기기 오프라인',  tone: 'warning', hint: '10분 이상 last_seen 없음' },
  playback_error:          { ko: '재생 오류',     tone: 'danger',  hint: 'playback_error 존재' },
  app_version_old:         { ko: '앱 버전 누락',   tone: 'info',    hint: 'app_version 미보고' },
  unknown:                 { ko: '기타',         tone: 'neutral', hint: '분류 미적용' },
};

const STATUS_OPTIONS: ReadonlyArray<{ value: PolicyDeploymentStatus; label: string }> = [
  { value: 'running', label: '진행 중' },
  { value: 'completed', label: '완료' },
  { value: 'partial_failed', label: '부분 실패' },
  { value: 'failed', label: '실패' },
  { value: 'cancelled', label: '취소' },
  { value: 'pending', label: '대기' },
];

const FAILURE_CATEGORY_OPTIONS: ReadonlyArray<{ value: PolicyFailureCategory; label: string }> = [
  { value: 'policy_version_mismatch', label: '정책 버전 불일치' },
  { value: 'heartbeat_missing',       label: 'Heartbeat 없음' },
  { value: 'device_offline',          label: '기기 오프라인' },
  { value: 'playback_error',          label: '재생 오류' },
  { value: 'app_version_old',         label: '앱 버전 누락' },
  { value: 'unknown',                 label: '기타' },
];

type CenterTab = 'logs' | 'failed';

export interface PolicyDeploymentPanelProps {
  onRequestFranchisePolicyNav?: () => void;
}

export default function PolicyDeploymentPanel({ onRequestFranchisePolicyNav }: PolicyDeploymentPanelProps = {}) {
  const [activeTab, setActiveTab] = useState<CenterTab>('logs');

  // shared state ---------------------------------------------------------------
  const [overview, setOverview] = useState<PolicyDeploymentOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<PolicyDeploymentKpi | null>(null);
  const [franchises, setFranchises] = useState<FranchiseListRow[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [hasDeployablePolicy, setHasDeployablePolicy] = useState<boolean | null>(null);

  // logs tab state
  const [rows, setRows] = useState<PolicyDeployment[]>([]);
  const [total, setTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PolicyDeploymentStatus | ''>('');
  const [franchiseFilter, setFranchiseFilter] = useState('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [offset, setOffset] = useState(0);

  // failed tab state
  const [failedRows, setFailedRows] = useState<FailedDeploymentStore[]>([]);
  const [failedTotal, setFailedTotal] = useState(0);
  const [failedLoading, setFailedLoading] = useState(true);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [failedSearch, setFailedSearch] = useState('');
  const [failureCategoryFilter, setFailureCategoryFilter] = useState<PolicyFailureCategory | ''>('');
  const [failedFranchiseFilter, setFailedFranchiseFilter] = useState('');
  const [failedRegionFilter, setFailedRegionFilter] = useState('');
  const [failedFrom, setFailedFrom] = useState('');
  const [failedTo, setFailedTo] = useState('');
  const [failedOffset, setFailedOffset] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryToast, setRetryToast] = useState<string | null>(null);

  // detail modal state
  const [detail, setDetail] = useState<PolicyDeploymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // create modal
  const [showCreate, setShowCreate] = useState(false);

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const [o, k] = await Promise.all([getPolicyDeploymentOverview(), getPolicyDeploymentKpi()]);
      setOverview(o);
      setKpi(k);
    } catch (e) {
      setOverviewError((e as Error).message);
    }
  }, []);

  const loadLogs = useCallback(async (silent = false) => {
    if (!silent) setLogsLoading(true);
    setLogsError(null);
    try {
      const list = await listPolicyDeployments({
        search: search.trim() || null,
        status: statusFilter || null,
        enterpriseAccountId: enterpriseFilter || null,
        franchiseId: franchiseFilter || null,
        from: fromFilter ? new Date(fromFilter).toISOString() : null,
        to:   toFilter   ? new Date(toFilter).toISOString()   : null,
        limit: PAGE_SIZE, offset,
      });
      setRows(list.data);
      setTotal(list.pagination.total);
    } catch (e) {
      setLogsError((e as Error).message);
    } finally {
      if (!silent) setLogsLoading(false);
    }
  }, [search, statusFilter, enterpriseFilter, franchiseFilter, fromFilter, toFilter, offset]);

  const loadFailed = useCallback(async (silent = false) => {
    if (!silent) setFailedLoading(true);
    setFailedError(null);
    try {
      const list = await listFailedDeploymentStores({
        search: failedSearch.trim() || null,
        franchiseId: failedFranchiseFilter || null,
        enterpriseRegionId: failedRegionFilter || null,
        failureCategory: failureCategoryFilter || null,
        from: failedFrom ? new Date(failedFrom).toISOString() : null,
        to:   failedTo   ? new Date(failedTo).toISOString()   : null,
        limit: PAGE_SIZE, offset: failedOffset,
      });
      setFailedRows(list.data);
      setFailedTotal(list.pagination.total);
    } catch (e) {
      setFailedError((e as Error).message);
    } finally {
      if (!silent) setFailedLoading(false);
    }
  }, [failedSearch, failedFranchiseFilter, failedRegionFilter, failureCategoryFilter, failedFrom, failedTo, failedOffset]);

  // initial + filter-change loads
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);
  useEffect(() => { void loadFailed(); }, [loadFailed]);

  // filter sources (1회)
  useEffect(() => {
    void adminListFranchises().then(setFranchises)
      .catch((e) => console.warn('[PolicyDeployment] franchises load failed', e));
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[PolicyDeployment] enterprises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data))
      .catch((e) => console.warn('[PolicyDeployment] regions load failed', e));
  }, []);

  // batch refresh (header button)
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadOverview(), loadLogs(true), loadFailed(true)]);
    } finally {
      setRefreshing(false);
    }
  }, [loadOverview, loadLogs, loadFailed]);

  // deployable policy gate (Create 버튼 활성/비활성)
  const checkDeployablePolicies = useCallback(async () => {
    try {
      const r = await listDeployablePolicies({ limit: 1 });
      setHasDeployablePolicy(r.data.length > 0);
    } catch (e) {
      console.warn('[PolicyDeployment] deployable policies check failed', e);
      setHasDeployablePolicy(null);
    }
  }, []);
  useEffect(() => { void checkDeployablePolicies(); }, [checkDeployablePolicies]);

  // ---------------------------------------------------------------------------
  // Detail / Mutation handlers
  // ---------------------------------------------------------------------------

  const openDetail = useCallback(async (deploymentId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getPolicyDeploymentDetail(deploymentId);
      setDetail(d);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const onRecompute = useCallback(async (deploymentId: string) => {
    setActionBusy(true);
    try {
      await recomputePolicyDeployment(deploymentId);
      await Promise.all([
        loadOverview(), loadLogs(true), loadFailed(true),
        detail ? openDetail(deploymentId) : Promise.resolve(),
      ]);
    } catch (e) {
      window.alert(`재계산 실패: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [loadOverview, loadLogs, loadFailed, detail, openDetail]);

  const onRetryBulkFailed = useCallback(async (deploymentId: string) => {
    if (!window.confirm('해당 배포의 모든 실패 대상을 재시도하시겠습니까? (retry_count 증가 + status pending 으로 리셋)')) return;
    setActionBusy(true);
    try {
      await retryPolicyDeploymentTargets(deploymentId, true);
      await Promise.all([loadOverview(), loadLogs(true), loadFailed(true), openDetail(deploymentId)]);
      setRetryToast(`일괄 재시도 요청 완료 (deployment: ${deploymentId.slice(0, 8)}…)`);
    } catch (e) {
      window.alert(`재시도 실패: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [loadOverview, loadLogs, loadFailed, openDetail]);

  const onRetrySingle = useCallback(async (deploymentId: string, storeId: string, storeName: string) => {
    setRetryingId(`${deploymentId}:${storeId}`);
    try {
      await requestPolicyRetry(deploymentId, storeId);
      setRetryToast(`[${storeName}] 재시도 요청됨`);
      await Promise.all([loadOverview(), loadFailed(true)]);
    } catch (e) {
      window.alert(`단건 재시도 실패: ${(e as Error).message}`);
    } finally {
      setRetryingId(null);
    }
  }, [loadOverview, loadFailed]);

  const onMarkFailed = useCallback(async (deploymentId: string, storeId: string, storeName: string) => {
    const reason = window.prompt(`[${storeName}] 실패 사유를 입력하세요`);
    if (!reason || !reason.trim()) return;
    setActionBusy(true);
    try {
      await markPolicyTargetFailed(deploymentId, storeId, reason.trim());
      await Promise.all([loadOverview(), loadLogs(true), loadFailed(true), openDetail(deploymentId)]);
    } catch (e) {
      window.alert(`실패 처리 오류: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }, [loadOverview, loadLogs, loadFailed, openDetail]);

  // toast auto-dismiss
  useEffect(() => {
    if (!retryToast) return;
    const id = window.setTimeout(() => setRetryToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [retryToast]);

  // ---------------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------------

  const kpiCards = useMemo(() => {
    if (!overview) return null;
    const total = overview.total_target_stores;
    const succ  = overview.success_stores;
    const pend  = overview.pending_stores;
    const fail  = overview.failed_stores;
    const rate  = overview.success_rate ?? 0;
    const lastTime = overview.last_deployment_at
      ? new Date(overview.last_deployment_at).toLocaleString('ko-KR', {
          month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';
    return [
      { label: '총 대상 매장', value: total.toLocaleString(), tone: 'neutral' as AdminToneName, icon: <StoreIcon size={14} /> },
      { label: '적용 완료',  value: succ.toLocaleString(),  tone: 'success' as AdminToneName, icon: <CheckCircle2 size={14} /> },
      { label: '대기',       value: pend.toLocaleString(),  tone: 'warning' as AdminToneName, icon: <Clock size={14} /> },
      { label: '실패',       value: fail.toLocaleString(),  tone: 'danger'  as AdminToneName, icon: <AlertCircle size={14} /> },
      { label: '적용률',     value: `${rate.toFixed(1)}%`,  tone: 'primary' as AdminToneName, icon: <TrendingUp size={14} /> },
      { label: '최근 배포',  value: lastTime,               tone: 'info'    as AdminToneName, icon: <History size={14} /> },
    ];
  }, [overview]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><ShieldCheck size={16} /> 정책 배포 관제 센터</span>}
      description="시스템 전체 정책 적용률, 배포 로그, 실패 매장 현황을 한 화면에서 관리합니다."
      badge={<AdminBadge tone="primary" variant="subtle">Priority 2-5/6/7</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton
            tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            새로고침
          </AdminButton>
          <AdminButton
            tone="primary" size="sm"
            leftIcon={<Plus size={12} />}
            onClick={() => setShowCreate(true)}
            disabled={hasDeployablePolicy === false}
            title={hasDeployablePolicy === false ? '먼저 프랜차이즈 관리에서 음악 정책을 생성하세요' : undefined}
          >
            신규 배포
          </AdminButton>
          {hasDeployablePolicy === false && onRequestFranchisePolicyNav && (
            <AdminButton
              tone="info" variant="subtle" size="sm"
              rightIcon={<ArrowRight size={12} />}
              onClick={onRequestFranchisePolicyNav}
            >
              정책 만들기
            </AdminButton>
          )}
        </div>
      }
    >
      {/* Overview KPI */}
      {overviewError ? (
        <AdminAlert
          tone="danger" title="개요 로드 실패" description={overviewError}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void loadOverview()}>재시도</AdminButton>}
        />
      ) : kpiCards ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((c) => (
            <AdminStatCard key={c.label} label={c.label} value={c.value} tone={c.tone} icon={c.icon} />
          ))}
        </div>
      ) : (
        <AdminSkeleton variant="kpi" />
      )}

      {/* Adoption rate bar */}
      {overview && overview.total_target_stores > 0 && (
        <AdminCard
          title={<span className="flex items-center gap-2"><TrendingUp size={14} /> 적용률</span>}
          subtitle={
            overview.last_deployment_name
              ? `최근 배포: ${overview.last_deployment_name}`
              : '아직 진행된 배포가 없습니다.'
          }
        >
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-ink">
                <span className="text-2xl font-extrabold tabular-nums">{overview.success_stores.toLocaleString()}</span>
                <span className="text-ink-mute"> / {overview.total_target_stores.toLocaleString()} 매장</span>
              </span>
              <span className="text-lg font-bold tabular-nums text-emerald-300">
                {overview.success_rate.toFixed(2)}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-bg-deep">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, overview.success_rate)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-mute">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={11} className="text-emerald-300" />
                완료 {overview.success_stores.toLocaleString()}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={11} className="text-amber-300" />
                대기 {overview.pending_stores.toLocaleString()}
              </span>
              <span className="inline-flex items-center gap-1">
                <AlertCircle size={11} className="text-red-300" />
                실패 {overview.failed_stores.toLocaleString()}
              </span>
              {overview.skipped_stores > 0 && (
                <span className="inline-flex items-center gap-1">
                  <X size={11} className="text-ink-dim" />
                  제외 {overview.skipped_stores.toLocaleString()}
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1">
                <Activity size={11} />
                전체 배포 {overview.total_deployments.toLocaleString()} · 최근 24h {overview.recent_24h_deployments.toLocaleString()}
              </span>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Tab nav */}
      <div className="flex items-center gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        <TabBtn active={activeTab === 'logs'}   onClick={() => setActiveTab('logs')}>
          <History size={12} /> 정책 적용 로그
          <span className="text-[10px] text-ink-mute tabular-nums">{total.toLocaleString()}</span>
        </TabBtn>
        <TabBtn active={activeTab === 'failed'} onClick={() => setActiveTab('failed')}>
          <AlertCircle size={12} /> 실패 매장
          <span className="text-[10px] text-ink-mute tabular-nums">{failedTotal.toLocaleString()}</span>
        </TabBtn>
      </div>

      {/* Tab content */}
      {activeTab === 'logs' ? (
        <LogsView
          rows={rows} total={total} loading={logsLoading} error={logsError}
          search={search} setSearch={(v) => { setSearch(v); setOffset(0); }}
          statusFilter={statusFilter} setStatusFilter={(v) => { setStatusFilter(v); setOffset(0); }}
          franchiseFilter={franchiseFilter} setFranchiseFilter={(v) => { setFranchiseFilter(v); setOffset(0); }}
          enterpriseFilter={enterpriseFilter} setEnterpriseFilter={(v) => { setEnterpriseFilter(v); setOffset(0); }}
          fromFilter={fromFilter} setFromFilter={(v) => { setFromFilter(v); setOffset(0); }}
          toFilter={toFilter}   setToFilter={(v) => { setToFilter(v); setOffset(0); }}
          franchises={franchises} enterprises={enterprises}
          offset={offset} setOffset={setOffset}
          onOpenDetail={openDetail}
          onReload={() => void loadLogs()}
          kpiHint={kpi}
        />
      ) : (
        <FailedView
          rows={failedRows} total={failedTotal} loading={failedLoading} error={failedError}
          search={failedSearch} setSearch={(v) => { setFailedSearch(v); setFailedOffset(0); }}
          categoryFilter={failureCategoryFilter} setCategoryFilter={(v) => { setFailureCategoryFilter(v); setFailedOffset(0); }}
          franchiseFilter={failedFranchiseFilter} setFranchiseFilter={(v) => { setFailedFranchiseFilter(v); setFailedOffset(0); }}
          regionFilter={failedRegionFilter} setRegionFilter={(v) => { setFailedRegionFilter(v); setFailedOffset(0); }}
          fromFilter={failedFrom} setFromFilter={(v) => { setFailedFrom(v); setFailedOffset(0); }}
          toFilter={failedTo}   setToFilter={(v) => { setFailedTo(v); setFailedOffset(0); }}
          franchises={franchises} regions={regions}
          offset={failedOffset} setOffset={setFailedOffset}
          onReload={() => void loadFailed()}
          onRetry={onRetrySingle}
          onOpenDeployment={openDetail}
          retryingId={retryingId}
        />
      )}

      {/* Retry toast */}
      {retryToast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone="success" title="재시도 요청됨" description={retryToast} />
        </div>
      )}

      {/* Detail modal */}
      <DetailModal
        detail={detail}
        loading={detailLoading}
        error={detailError}
        busy={actionBusy}
        onClose={() => setDetail(null)}
        onRecompute={onRecompute}
        onRetryBulkFailed={onRetryBulkFailed}
        onMarkFailed={onMarkFailed}
        onRetrySingle={onRetrySingle}
        retryingId={retryingId}
      />

      {/* Create modal */}
      {showCreate && (
        <CreateDeploymentModal
          franchises={franchises}
          enterprises={enterprises}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await refreshAll();
            await checkDeployablePolicies();
          }}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// Sub-components — Tab button
// =============================================================================

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-violet-600 text-white shadow-sm shadow-black/20'
          : 'text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// =============================================================================
// Logs tab
// =============================================================================

interface LogsViewProps {
  rows: PolicyDeployment[]; total: number; loading: boolean; error: string | null;
  search: string; setSearch: (v: string) => void;
  statusFilter: PolicyDeploymentStatus | ''; setStatusFilter: (v: PolicyDeploymentStatus | '') => void;
  franchiseFilter: string; setFranchiseFilter: (v: string) => void;
  enterpriseFilter: string; setEnterpriseFilter: (v: string) => void;
  fromFilter: string; setFromFilter: (v: string) => void;
  toFilter: string;   setToFilter: (v: string) => void;
  franchises: FranchiseListRow[]; enterprises: EnterpriseAccount[];
  offset: number; setOffset: (n: number) => void;
  onOpenDetail: (id: string) => void;
  onReload: () => void;
  kpiHint: PolicyDeploymentKpi | null;
}

function LogsView({
  rows, total, loading, error,
  search, setSearch, statusFilter, setStatusFilter, franchiseFilter, setFranchiseFilter,
  enterpriseFilter, setEnterpriseFilter, fromFilter, setFromFilter, toFilter, setToFilter,
  franchises, enterprises, offset, setOffset, onOpenDetail, onReload, kpiHint,
}: LogsViewProps) {
  return (
    <div className="space-y-3">
      <AdminSearch
        value={search}
        onChange={setSearch}
        placeholder="배포명 / 정책명 / 본사 검색"
        filters={
          <>
            <select value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as PolicyDeploymentStatus | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={franchiseFilter}
              onChange={(e) => setFranchiseFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={enterpriseFilter}
              onChange={(e) => setEnterpriseFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 엔터프라이즈</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
            <input type="datetime-local" value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
            <input type="datetime-local" value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </>
        }
        trailing={
          <span className="text-[11px] text-ink-mute tabular-nums">
            {total.toLocaleString()}개{kpiHint?.avg_success_rate != null ? ` · 평균 적용률 ${kpiHint.avg_success_rate.toFixed(1)}%` : ''}
          </span>
        }
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReload}>재시도</AdminButton>} />
      )}

      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && rows.length === 0 && !error ? (
        <AdminEmpty
          icon={<ListChecks size={28} />}
          title="배포 기록이 없습니다."
          description="필터를 조정하거나 신규 배포를 생성하세요."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">배포명 / 정책</th>
                  <th className="px-3 py-2">대상 범위</th>
                  <th className="px-3 py-2 text-right">대상</th>
                  <th className="px-3 py-2 text-right">성공</th>
                  <th className="px-3 py-2 text-right">대기</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2 w-[160px]">적용률</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">시작</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => <LogRow key={r.deployment_id} r={r} onOpen={onOpenDetail} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => <LogCard key={r.deployment_id} r={r} onOpen={onOpenDetail} />)}
          </div>

          {total > PAGE_SIZE && (
            <Pagination offset={offset} total={total} pageSize={PAGE_SIZE} onChange={setOffset} />
          )}
        </>
      )}
    </div>
  );
}

function LogRow({ r, onOpen }: { r: PolicyDeployment; onOpen: (id: string) => void }) {
  const meta = DEPLOYMENT_STATUS_META[r.status] ?? { ko: r.status, tone: 'neutral' as AdminToneName };
  return (
    <tr className="cursor-pointer border-b border-line/5 hover:bg-bg-hover/30" onClick={() => onOpen(r.deployment_id)}>
      <td className="px-3 py-2">
        <div className="font-semibold text-ink">{r.deployment_name}</div>
        <div className="text-[10px] text-ink-mute">
          {r.policy_name ?? '—'}{r.policy_version_number != null ? ` v${r.policy_version_number}` : ''}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-mute">
          {r.franchise_name && <span className="inline-flex items-center gap-1"><Building2 size={9} />{r.franchise_name}</span>}
          {r.enterprise_name && <span className="inline-flex items-center gap-1"><StoreIcon size={9} />{r.enterprise_name}</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{r.target_store_count.toLocaleString()}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{r.success_count.toLocaleString()}</td>
      <td className="px-3 py-2 text-right tabular-nums text-amber-300">{r.pending_count.toLocaleString()}</td>
      <td className="px-3 py-2 text-right tabular-nums text-red-300">{r.failed_count.toLocaleString()}</td>
      <td className="px-3 py-2">
        <SuccessRateBar rate={r.success_rate} />
      </td>
      <td className="px-3 py-2"><AdminBadge tone={meta.tone}>{meta.ko}</AdminBadge></td>
      <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
        {r.started_at ? new Date(r.started_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
      </td>
      <td className="px-3 py-2">
        <AdminButton tone="primary" variant="ghost" size="sm" rightIcon={<ArrowRight size={11} />}
          onClick={(e) => { e.stopPropagation(); onOpen(r.deployment_id); }}>
          상세
        </AdminButton>
      </td>
    </tr>
  );
}

function LogCard({ r, onOpen }: { r: PolicyDeployment; onOpen: (id: string) => void }) {
  const meta = DEPLOYMENT_STATUS_META[r.status] ?? { ko: r.status, tone: 'neutral' as AdminToneName };
  return (
    <button type="button" onClick={() => onOpen(r.deployment_id)}
      className="block w-full rounded-xl bg-bg-card p-3 text-left ring-1 ring-line/10 transition hover:ring-line/25">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-ink">{r.deployment_name}</div>
          <div className="truncate text-[10px] text-ink-mute">
            {r.policy_name ?? '—'}{r.policy_version_number != null ? ` v${r.policy_version_number}` : ''}
          </div>
        </div>
        <AdminBadge tone={meta.tone}>{meta.ko}</AdminBadge>
      </div>
      <div className="mt-2"><SuccessRateBar rate={r.success_rate} /></div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
        <div><div className="font-bold tabular-nums">{r.target_store_count}</div><div className="text-[10px] text-ink-dim">대상</div></div>
        <div><div className="font-bold tabular-nums text-emerald-300">{r.success_count}</div><div className="text-[10px] text-ink-dim">성공</div></div>
        <div><div className="font-bold tabular-nums text-amber-300">{r.pending_count}</div><div className="text-[10px] text-ink-dim">대기</div></div>
        <div><div className="font-bold tabular-nums text-red-300">{r.failed_count}</div><div className="text-[10px] text-ink-dim">실패</div></div>
      </div>
    </button>
  );
}

function SuccessRateBar({ rate }: { rate: number }) {
  const safe = Math.max(0, Math.min(100, rate ?? 0));
  return (
    <div className="space-y-0.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-deep">
        <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${safe}%` }} />
      </div>
      <div className="text-[10px] tabular-nums text-ink-mute">{safe.toFixed(1)}%</div>
    </div>
  );
}

// =============================================================================
// Failed Stores tab
// =============================================================================

interface FailedViewProps {
  rows: FailedDeploymentStore[]; total: number; loading: boolean; error: string | null;
  search: string; setSearch: (v: string) => void;
  categoryFilter: PolicyFailureCategory | ''; setCategoryFilter: (v: PolicyFailureCategory | '') => void;
  franchiseFilter: string; setFranchiseFilter: (v: string) => void;
  regionFilter: string; setRegionFilter: (v: string) => void;
  fromFilter: string; setFromFilter: (v: string) => void;
  toFilter: string;   setToFilter: (v: string) => void;
  franchises: FranchiseListRow[]; regions: EnterpriseRegion[];
  offset: number; setOffset: (n: number) => void;
  onReload: () => void;
  onRetry: (deploymentId: string, storeId: string, storeName: string) => void;
  onOpenDeployment: (deploymentId: string) => void;
  retryingId: string | null;
}

function FailedView({
  rows, total, loading, error,
  search, setSearch, categoryFilter, setCategoryFilter,
  franchiseFilter, setFranchiseFilter, regionFilter, setRegionFilter,
  fromFilter, setFromFilter, toFilter, setToFilter,
  franchises, regions, offset, setOffset, onReload, onRetry, onOpenDeployment, retryingId,
}: FailedViewProps) {
  return (
    <div className="space-y-3">
      <AdminSearch
        value={search}
        onChange={setSearch}
        placeholder="매장명 / 본사 / 지역 / 정책명 / 사유"
        filters={
          <>
            <select value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as PolicyFailureCategory | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 실패 사유</option>
              {FAILURE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={franchiseFilter}
              onChange={(e) => setFranchiseFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 지역</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
            <input type="datetime-local" value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
            <input type="datetime-local" value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}개</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReload}>재시도</AdminButton>} />
      )}

      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && rows.length === 0 && !error ? (
        <AdminEmpty
          icon={<CheckCircle2 size={28} />}
          title="실패 매장이 없습니다."
          description="모든 배포 대상 매장이 정상 상태이거나 필터에 해당하는 결과가 없습니다."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">매장 / 본사·지역</th>
                  <th className="px-3 py-2">정책 / 배포</th>
                  <th className="px-3 py-2">실패 사유</th>
                  <th className="px-3 py-2 text-right">현재 / 기대 버전</th>
                  <th className="px-3 py-2 text-right">마지막 시도</th>
                  <th className="px-3 py-2 text-right">재시도 회수</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <FailedRow
                    key={f.target_id}
                    row={f}
                    busy={retryingId === `${f.deployment_id}:${f.store_id}`}
                    onRetry={() => onRetry(f.deployment_id, f.store_id, f.store_name)}
                    onOpenDeployment={() => onOpenDeployment(f.deployment_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((f) => (
              <FailedCard
                key={f.target_id}
                row={f}
                busy={retryingId === `${f.deployment_id}:${f.store_id}`}
                onRetry={() => onRetry(f.deployment_id, f.store_id, f.store_name)}
                onOpenDeployment={() => onOpenDeployment(f.deployment_id)}
              />
            ))}
          </div>

          {total > PAGE_SIZE && (
            <Pagination offset={offset} total={total} pageSize={PAGE_SIZE} onChange={setOffset} />
          )}
        </>
      )}
    </div>
  );
}

function FailedRow({ row, busy, onRetry, onOpenDeployment }: {
  row: FailedDeploymentStore; busy: boolean; onRetry: () => void; onOpenDeployment: () => void;
}) {
  const cat = FAILURE_CATEGORY_META[row.failure_category];
  return (
    <tr className="border-b border-line/5 hover:bg-bg-hover/30">
      <td className="px-3 py-2">
        <div className="font-semibold text-ink">{row.store_name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-mute">
          {row.enterprise_name && <span className="inline-flex items-center gap-1"><Building2 size={9} />{row.enterprise_name}</span>}
          {row.region_name && <span className="inline-flex items-center gap-1"><MapPin size={9} />{row.region_name}</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <button type="button" onClick={onOpenDeployment}
          className="text-left hover:underline">
          <div className="text-ink">{row.expected_policy_name ?? '—'}</div>
          <div className="text-[10px] text-ink-mute truncate max-w-[180px]">{row.deployment_name}</div>
        </button>
      </td>
      <td className="px-3 py-2">
        <AdminTooltip label={cat.hint}>
          <AdminBadge tone={cat.tone}>{cat.ko}</AdminBadge>
        </AdminTooltip>
        {row.failure_reason && (
          <div className="mt-0.5 truncate max-w-[200px] text-[10px] text-ink-dim" title={row.failure_reason}>
            {row.failure_reason}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className="text-ink">v{row.current_active_version_number ?? row.applied_version_number ?? '—'}</span>
        <span className="text-ink-dim"> / v{row.expected_version_number ?? '—'}</span>
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-ink-mute tabular-nums">
        {row.last_attempt_at ? new Date(row.last_attempt_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.retry_count}</td>
      <td className="px-3 py-2">
        <AdminButton tone="primary" variant="subtle" size="sm"
          leftIcon={<RotateCcw size={11} className={busy ? 'animate-spin' : ''} />}
          loading={busy}
          onClick={onRetry}>
          재시도
        </AdminButton>
      </td>
    </tr>
  );
}

function FailedCard({ row, busy, onRetry, onOpenDeployment }: {
  row: FailedDeploymentStore; busy: boolean; onRetry: () => void; onOpenDeployment: () => void;
}) {
  const cat = FAILURE_CATEGORY_META[row.failure_category];
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-ink">{row.store_name}</div>
          <div className="truncate text-[10px] text-ink-mute">
            {row.enterprise_name}{row.region_name && ` · ${row.region_name}`}
          </div>
        </div>
        <AdminBadge tone={cat.tone}>{cat.ko}</AdminBadge>
      </div>
      <button type="button" onClick={onOpenDeployment}
        className="mt-2 block w-full text-left text-[11px] text-ink-mute hover:underline">
        <div className="text-ink">{row.expected_policy_name ?? '—'}</div>
        <div className="truncate text-[10px]">{row.deployment_name}</div>
      </button>
      {row.failure_reason && (
        <div className="mt-1 truncate text-[10px] text-ink-dim">{row.failure_reason}</div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-ink-mute">
        <span>v{row.current_active_version_number ?? '—'} → v{row.expected_version_number ?? '—'} · 재시도 {row.retry_count}회</span>
        <AdminButton tone="primary" variant="subtle" size="sm"
          leftIcon={<RotateCcw size={11} className={busy ? 'animate-spin' : ''} />}
          loading={busy}
          onClick={onRetry}>
          재시도
        </AdminButton>
      </div>
    </div>
  );
}

// =============================================================================
// Pagination
// =============================================================================

function Pagination({ offset, total, pageSize, onChange }: {
  offset: number; total: number; pageSize: number; onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
      <AdminButton tone="neutral" variant="subtle" size="sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - pageSize))}>
        이전
      </AdminButton>
      <span className="text-ink-mute tabular-nums">
        {offset + 1} – {Math.min(offset + pageSize, total)} / {total.toLocaleString()}
      </span>
      <AdminButton tone="neutral" variant="subtle" size="sm"
        disabled={offset + pageSize >= total}
        onClick={() => onChange(offset + pageSize)}>
        다음
      </AdminButton>
    </div>
  );
}

// =============================================================================
// Detail Modal
// =============================================================================

interface DetailModalProps {
  detail: PolicyDeploymentDetail | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onRecompute: (id: string) => void;
  onRetryBulkFailed: (id: string) => void;
  onMarkFailed: (deploymentId: string, storeId: string, storeName: string) => void;
  onRetrySingle: (deploymentId: string, storeId: string, storeName: string) => void;
  retryingId: string | null;
}

function DetailModal({
  detail, loading, error, busy, onClose,
  onRecompute, onRetryBulkFailed, onMarkFailed, onRetrySingle, retryingId,
}: DetailModalProps) {
  const open = !!detail || loading || !!error;
  if (!open) return null;

  const d = detail?.deployment;
  const targets = detail?.targets ?? [];
  const dist = detail?.distribution;
  const meta = d ? DEPLOYMENT_STATUS_META[d.status] : null;

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        d ? (
          <span className="flex items-center gap-2"><ListChecks size={14} /> {d.deployment_name}</span>
        ) : (
          <span className="flex items-center gap-2"><ListChecks size={14} /> 배포 상세</span>
        )
      }
      headerExtra={meta ? <AdminBadge tone={meta.tone}>{meta.ko}</AdminBadge> : null}
      footer={
        d ? (
          <>
            <AdminButton tone="neutral" variant="subtle" size="sm"
              leftIcon={<Calculator size={11} />}
              loading={busy}
              onClick={() => onRecompute(d.deployment_id)}>
              상태 재계산
            </AdminButton>
            <AdminButton tone="warning" variant="solid" size="sm"
              leftIcon={<RotateCcw size={11} />}
              loading={busy}
              disabled={d.failed_count === 0}
              onClick={() => onRetryBulkFailed(d.deployment_id)}>
              실패 전체 재시도 ({d.failed_count})
            </AdminButton>
            <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
          </>
        ) : (
          <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
        )
      }
    >
      {loading ? (
        <AdminSkeleton variant="block" rows={6} />
      ) : error ? (
        <AdminAlert tone="danger" title="상세 로드 실패" description={error} />
      ) : d && dist ? (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid gap-2 md:grid-cols-3">
            <SummaryCard label="정책" value={`${d.policy_name ?? '—'}${d.policy_version_number != null ? ` v${d.policy_version_number}` : ''}`} />
            <SummaryCard label="대상 매장" value={d.target_store_count.toLocaleString()} />
            <SummaryCard label="적용률" value={`${d.success_rate.toFixed(2)}%`} />
            <SummaryCard label="시작" value={d.started_at ? new Date(d.started_at).toLocaleString('ko-KR') : '—'} />
            <SummaryCard label="완료" value={d.completed_at ? new Date(d.completed_at).toLocaleString('ko-KR') : '—'} />
            <SummaryCard label="본사 · 엔터프라이즈" value={[d.franchise_name, d.enterprise_name].filter(Boolean).join(' · ') || '—'} />
          </div>

          {/* Distribution */}
          <div className="grid grid-cols-5 gap-2">
            <DistCard label="성공" value={dist.success} tone="success" />
            <DistCard label="대기" value={dist.pending} tone="warning" />
            <DistCard label="실패" value={dist.failed}  tone="danger"  />
            <DistCard label="구버전" value={dist.stale} tone="warning" />
            <DistCard label="제외" value={dist.skipped} tone="neutral" />
          </div>

          {/* Targets table */}
          <div className="rounded-xl bg-bg-deep/40 ring-1 ring-line/10">
            <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">
              매장 적용 현황 ({targets.length})
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-bg-deep">
                  <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                    <th className="px-3 py-2">매장 / 지역</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2 text-right">기대 / 현재 v</th>
                    <th className="px-3 py-2 text-right">heartbeat</th>
                    <th className="px-3 py-2 text-right">재시도</th>
                    <th className="px-3 py-2">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => {
                    const tmeta = TARGET_STATUS_META[t.status] ?? { ko: t.status, tone: 'neutral' as AdminToneName };
                    const isStale = !!t.last_seen_at && (Date.now() - new Date(t.last_seen_at).getTime()) > 10 * 60 * 1000;
                    return (
                      <tr key={t.target_id} className="border-b border-line/5 hover:bg-bg-hover/20">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-ink">{t.store_name}</div>
                          <div className="text-[10px] text-ink-mute">{t.region_name ?? '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <AdminBadge tone={tmeta.tone}>{tmeta.ko}</AdminBadge>
                          {t.failure_reason && (
                            <div className="mt-0.5 truncate max-w-[160px] text-[10px] text-ink-dim" title={t.failure_reason}>
                              {t.failure_reason}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          v{t.expected_version_number ?? '—'} <span className="text-ink-dim">/ v{t.current_active_version_number ?? '—'}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] tabular-nums">
                          {t.last_seen_at ? (
                            <span className={isStale ? 'text-red-300' : 'text-ink-mute'}>
                              {isStale ? <WifiOff size={9} className="inline mr-0.5" /> : <Wifi size={9} className="inline mr-0.5" />}
                              {new Date(t.last_seen_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ) : <span className="text-ink-dim">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.retry_count}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(t.status === 'failed' || t.status === 'stale') && (
                              <AdminButton tone="primary" variant="subtle" size="sm"
                                leftIcon={<RotateCcw size={10} className={retryingId === `${d.deployment_id}:${t.store_id}` ? 'animate-spin' : ''} />}
                                loading={retryingId === `${d.deployment_id}:${t.store_id}`}
                                onClick={() => onRetrySingle(d.deployment_id, t.store_id, t.store_name)}>
                                재시도
                              </AdminButton>
                            )}
                            {t.status !== 'failed' && t.status !== 'success' && (
                              <AdminButton tone="danger" variant="ghost" size="sm"
                                onClick={() => onMarkFailed(d.deployment_id, t.store_id, t.store_name)}>
                                실패 처리
                              </AdminButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </AdminModal>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

function DistCard({ label, value, tone }: { label: string; value: number; tone: AdminToneName }) {
  return (
    <AdminStatCard label={label} value={value.toLocaleString()} tone={tone} />
  );
}

// =============================================================================
// Create Modal — 기존 데이터 흐름 그대로 (정책 dropdown + auto-name + enterprise FK)
// =============================================================================

function buildAutoDeploymentName(policy: DeployablePolicy): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `${policy.policy_name} v${policy.latest_version_number} 배포 - ${stamp}`;
}

function CreateDeploymentModal({
  franchises, enterprises, onClose, onCreated,
}: {
  franchises: FranchiseListRow[];
  enterprises: EnterpriseAccount[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [policies, setPolicies] = useState<DeployablePolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selected, setSelected] = useState<DeployablePolicy | null>(null);
  const [deploymentName, setDeploymentName] = useState('');
  const [enterpriseAccountId, setEnterpriseAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const userEditedNameRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPoliciesLoading(true);
    setPoliciesError(null);
    listDeployablePolicies({ search: debouncedSearch || null, limit: 50 })
      .then((r) => { setPolicies(r.data); })
      .catch((e) => { setPoliciesError((e as Error).message); setPolicies([]); })
      .finally(() => setPoliciesLoading(false));
  }, [debouncedSearch]);

  useEffect(() => {
    function onClick(ev: MouseEvent) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(ev.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function onSelect(p: DeployablePolicy) {
    setSelected(p);
    setDropdownOpen(false);
    setSearch('');
    if (!userEditedNameRef.current) setDeploymentName(buildAutoDeploymentName(p));
  }

  const onNameChange = (v: string) => {
    userEditedNameRef.current = true;
    setDeploymentName(v);
  };

  const onSubmit = async () => {
    setErr(null);
    if (!selected) { setErr('배포할 정책을 선택하세요.'); return; }
    setBusy(true);
    try {
      const r = await createPolicyDeployment({
        policyId: selected.policy_id,
        deploymentName: deploymentName.trim() || null,
        enterpriseAccountId: enterpriseAccountId || null,
      });
      window.alert(`배포 생성 완료 — ${r.target_store_count}개 매장 대상 (v${r.policy_version_number})`);
      await onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      open
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-2"><Plus size={14} /> 정책 배포 생성</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} disabled={!selected || busy}
            leftIcon={<Plus size={11} />} onClick={() => void onSubmit()}>
            배포 생성
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[11px] text-ink-dim">
          정책을 선택하면 해당 franchise 의 active 매장이 자동으로 snapshot 됩니다.
          정책 적용 자체는 별도로 apply_franchise_policy 호출이 필요합니다.
        </p>

        <div className="text-xs" ref={dropdownRef}>
          <div className="mb-1 text-ink-dim">배포할 정책 *</div>
          <div className="relative">
            <button type="button" onClick={() => setDropdownOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md bg-bg-deep px-3 py-2 text-left hover:bg-bg-hover">
              {selected ? (
                <span className="truncate">
                  <span className="font-semibold text-ink">{selected.policy_name}</span>
                  {selected.franchise_name && <span className="text-ink-dim"> · {selected.franchise_name}</span>}
                </span>
              ) : (
                <span className="text-ink-mute">배포할 정책을 선택하세요</span>
              )}
              <ChevronDown size={12} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-bg-card shadow-2xl ring-1 ring-line/20">
                <div className="border-b border-line/10 p-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
                    <input type="text" autoFocus value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="정책명 / 설명 / 프랜차이즈 검색"
                      className="w-full rounded-md bg-bg-deep pl-7 pr-2 py-1.5 text-xs" />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {policiesLoading ? (
                    <div className="px-3 py-6 text-center text-[11px] text-ink-mute">
                      <RefreshCw size={14} className="mx-auto mb-1 animate-spin opacity-60" /> 불러오는 중…
                    </div>
                  ) : policiesError ? (
                    <div className="px-3 py-4 text-[11px] text-red-300">
                      <AlertCircle size={12} className="inline mr-1" />{policiesError}
                    </div>
                  ) : policies.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[11px] text-ink-mute">
                      <Inbox size={16} className="mx-auto mb-1 opacity-50" />
                      {debouncedSearch ? '검색 결과가 없습니다.' : '배포 가능한 정책이 없습니다.'}
                    </div>
                  ) : (
                    <ul>
                      {policies.map((p) => (
                        <li key={p.policy_id}>
                          <button type="button" onClick={() => onSelect(p)}
                            className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-bg-hover ${
                              selected?.policy_id === p.policy_id ? 'bg-violet-500/10' : ''
                            }`}>
                            <div className="flex w-full items-center gap-2">
                              <span className="flex-1 truncate font-semibold text-ink">{p.policy_name}</span>
                              {p.is_default && <Star size={10} className="text-amber-300" />}
                              <span className="shrink-0 text-[10px] text-ink-dim">
                                {new Date(p.updated_at).toLocaleDateString('ko-KR')}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-mute">
                              {p.franchise_name && (
                                <span className="inline-flex items-center gap-0.5"><Building2 size={8} />{p.franchise_name}</span>
                              )}
                              <span className="text-violet-300">v{p.latest_version_number}</span>
                              <span>대상 {p.target_store_count}개</span>
                              {p.active_store_count > 0 && (
                                <span className="text-emerald-300">온라인 {p.active_store_count}</span>
                              )}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div className="rounded-lg bg-bg-deep p-3 text-xs ring-1 ring-violet-400/30">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-dim">선택된 정책</div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-ink">{selected.policy_name}</span>
                  {selected.is_default && <Star size={10} className="text-amber-300" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                  <span className="text-violet-300">v{selected.latest_version_number}</span>
                  <span>대상 {selected.target_store_count}개</span>
                  {selected.active_store_count > 0 && (
                    <span className="text-emerald-300">온라인 {selected.active_store_count}</span>
                  )}
                </div>
                {selected.franchise_name && (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-mute">
                    <Building2 size={10} /> {selected.franchise_name}
                  </div>
                )}
              </div>
              <button type="button"
                onClick={() => { setSelected(null); userEditedNameRef.current = false; setDeploymentName(''); }}
                className="rounded-full bg-bg-card p-1 text-ink-dim hover:bg-bg-hover hover:text-red-300"
                aria-label="선택 해제">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        <label className="block text-xs">
          <span className="text-ink-dim">배포명</span>
          <input type="text" value={deploymentName} onChange={(e) => onNameChange(e.target.value)}
            placeholder="정책 선택 시 자동 생성됩니다"
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          <p className="mt-1 text-[10px] text-ink-dim">
            {userEditedNameRef.current
              ? '사용자가 수정 — 정책을 바꿔도 덮어쓰지 않습니다.'
              : '정책을 선택하면 "정책명 v버전 배포 - 시각" 으로 자동 생성됩니다.'}
          </p>
        </label>

        <label className="block text-xs">
          <span className="text-ink-dim">엔터프라이즈 계정 (선택)</span>
          <select value={enterpriseAccountId} onChange={(e) => setEnterpriseAccountId(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="">(연결 안 함)</option>
            {enterprises.map((e) => (
              <option key={e.id} value={e.id}>{e.enterprise_name} — {e.manager_name}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-ink-dim">
            엔터프라이즈 담당자가 자기 배포만 조회할 수 있도록 묶입니다.
            {franchises.length > 0 && ` (등록된 프랜차이즈: ${franchises.length}개)`}
          </p>
        </label>

        {err && <AdminAlert tone="danger" title="배포 생성 실패" description={err} />}
      </div>
    </AdminModal>
  );
}
