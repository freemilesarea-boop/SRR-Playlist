/**
 * PolicyAutomationPanel — Enterprise Priority 3 (Policy Automation Engine V1).
 *
 * 예약/반복/시즌/이벤트 정책 자동화 룰 관리 + 실행 로그 + dry_run + 즉시 실행.
 * 기존 정책 배포 시스템 (enterprise_policy_deployments / admin_create_policy_deployment)
 * 재사용. V1: 외부 API/cron parser/자동 트리거 없음 (event 는 manual run only).
 *
 * SQL: supabase/migrations/0378_policy_automation_engine_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, AlertCircle, Calendar, Clock, Repeat,
  CloudRain, Snowflake, Sun, Pause, Play, Power, Trash2, Eye, Zap,
  Activity, History, ListChecks, Edit3,
} from 'lucide-react';
import {
  AdminSection, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listPolicyAutomationRules, getPolicyAutomationKpi, createPolicyAutomationRule,
  updatePolicyAutomationRule, setPolicyAutomationStatus, softDeletePolicyAutomationRule,
  listPolicyAutomationRuns, evaluatePolicyAutomationRules, runPolicyAutomationRuleNow,
  type PolicyAutomationRule, type PolicyAutomationKpi,
  type AutomationRuleType, type AutomationRuleStatus, type AutomationScopeType,
  type AutomationEventType, type AutomationSeason, type AutomationRunStatus,
  type PolicyAutomationRun, type PolicyAutomationEvaluateResult, type PolicyAutomationRunNowResult,
} from '@/lib/api/policyAutomationApi';
import {
  listDeployablePolicies, type DeployablePolicy,
} from '@/lib/api/policyDeploymentApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';
import { listEnterpriseRegions, type EnterpriseRegion } from '@/lib/api/enterpriseRegionsApi';

const PAGE_SIZE = 50;

// =============================================================================
// Status → tone mapping (spec)
// =============================================================================

const RULE_STATUS_META: Record<AutomationRuleStatus, { ko: string; tone: AdminToneName }> = {
  active:   { ko: '활성',     tone: 'success' },
  paused:   { ko: '일시정지', tone: 'warning' },
  expired:  { ko: '만료',     tone: 'neutral' },
  disabled: { ko: '비활성',   tone: 'danger'  },
};

const RUN_STATUS_META: Record<AutomationRunStatus, { ko: string; tone: AdminToneName }> = {
  completed: { ko: '완료',     tone: 'success' },
  failed:    { ko: '실패',     tone: 'danger'  },
  running:   { ko: '진행 중',  tone: 'info'    },
  pending:   { ko: '대기',     tone: 'warning' },
  skipped:   { ko: '제외',     tone: 'neutral' },
};

const RULE_TYPE_META: Record<AutomationRuleType, { ko: string; icon: React.ReactNode; tone: AdminToneName }> = {
  scheduled: { ko: '예약',  icon: <Calendar size={11} />, tone: 'info'    },
  recurring: { ko: '반복',  icon: <Repeat   size={11} />, tone: 'primary' },
  season:    { ko: '시즌',  icon: <Sun      size={11} />, tone: 'warning' },
  event:     { ko: '이벤트', icon: <Zap      size={11} />, tone: 'success' },
};

const SCOPE_META: Record<AutomationScopeType, { ko: string }> = {
  enterprise: { ko: '전체' },
  region:     { ko: '지역' },
  store:      { ko: '매장' },
};

const SEASON_META: Record<AutomationSeason, { ko: string; icon: React.ReactNode }> = {
  spring:    { ko: '봄',      icon: <Sun      size={11} /> },
  summer:    { ko: '여름',    icon: <Sun      size={11} /> },
  autumn:    { ko: '가을',    icon: <Sun      size={11} /> },
  winter:    { ko: '겨울',    icon: <Snowflake size={11} /> },
  christmas: { ko: '크리스마스', icon: <Snowflake size={11} /> },
};

const EVENT_META: Record<AutomationEventType, { ko: string; icon: React.ReactNode }> = {
  rain:    { ko: '비',      icon: <CloudRain  size={11} /> },
  snow:    { ko: '눈',      icon: <Snowflake  size={11} /> },
  holiday: { ko: '공휴일',   icon: <Calendar   size={11} /> },
  opening: { ko: '오픈',    icon: <Sun        size={11} /> },
  closing: { ko: '마감',    icon: <Clock      size={11} /> },
  custom:  { ko: '사용자',   icon: <Zap        size={11} /> },
};

type CenterTab = 'rules' | 'runs';

export default function PolicyAutomationPanel() {
  const [activeTab, setActiveTab] = useState<CenterTab>('rules');

  const [kpi, setKpi] = useState<PolicyAutomationKpi | null>(null);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // rules
  const [rules, setRules] = useState<PolicyAutomationRule[]>([]);
  const [rulesTotal, setRulesTotal] = useState(0);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AutomationRuleType | ''>('');
  const [statusFilter, setStatusFilter] = useState<AutomationRuleStatus | ''>('');
  const [scopeFilter, setScopeFilter] = useState<AutomationScopeType | ''>('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [offset, setOffset] = useState(0);

  // runs
  const [runs, setRuns] = useState<PolicyAutomationRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runsStatusFilter, setRunsStatusFilter] = useState<AutomationRunStatus | ''>('');
  const [runsRuleFilter, setRunsRuleFilter] = useState('');
  const [runsOffset, setRunsOffset] = useState(0);

  // filter sources
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [regions, setRegions] = useState<EnterpriseRegion[]>([]);
  const [deployablePolicies, setDeployablePolicies] = useState<DeployablePolicy[]>([]);

  // modals
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PolicyAutomationRule | null>(null);
  const [previewRule, setPreviewRule] = useState<PolicyAutomationRule | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<PolicyAutomationRunNowResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'warning' | 'danger' | 'info'; title: string; body: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------

  const loadKpi = useCallback(async () => {
    setKpiError(null);
    try { setKpi(await getPolicyAutomationKpi()); }
    catch (e) { setKpiError((e as Error).message); }
  }, []);

  const loadRules = useCallback(async (silent = false) => {
    if (!silent) setRulesLoading(true);
    setRulesError(null);
    try {
      const r = await listPolicyAutomationRules({
        search: search.trim() || null,
        ruleType: typeFilter || null,
        status: statusFilter || null,
        scopeType: scopeFilter || null,
        enterpriseAccountId: enterpriseFilter || null,
        regionId: regionFilter || null,
        limit: PAGE_SIZE, offset,
      });
      setRules(r.data);
      setRulesTotal(r.pagination.total);
    } catch (e) { setRulesError((e as Error).message); }
    finally { if (!silent) setRulesLoading(false); }
  }, [search, typeFilter, statusFilter, scopeFilter, enterpriseFilter, regionFilter, offset]);

  const loadRuns = useCallback(async (silent = false) => {
    if (!silent) setRunsLoading(true);
    setRunsError(null);
    try {
      const r = await listPolicyAutomationRuns({
        ruleId: runsRuleFilter || null,
        status: runsStatusFilter || null,
        limit: PAGE_SIZE, offset: runsOffset,
      });
      setRuns(r.data);
      setRunsTotal(r.pagination.total);
    } catch (e) { setRunsError((e as Error).message); }
    finally { if (!silent) setRunsLoading(false); }
  }, [runsRuleFilter, runsStatusFilter, runsOffset]);

  useEffect(() => { void loadKpi(); }, [loadKpi]);
  useEffect(() => { void loadRules(); }, [loadRules]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  // filter sources (1회)
  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[PolicyAutomation] enterprises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data))
      .catch((e) => console.warn('[PolicyAutomation] regions load failed', e));
    void listDeployablePolicies({ limit: 200 }).then((r) => setDeployablePolicies(r.data))
      .catch((e) => console.warn('[PolicyAutomation] policies load failed', e));
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([loadKpi(), loadRules(true), loadRuns(true)]); }
    finally { setRefreshing(false); }
  }, [loadKpi, loadRules, loadRuns]);

  // toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------------------
  // Mutation handlers
  // ---------------------------------------------------------------------------

  const onStatusToggle = useCallback(async (rule: PolicyAutomationRule, next: AutomationRuleStatus) => {
    setActionBusy(`status:${rule.id}`);
    try {
      await setPolicyAutomationStatus(rule.id, next);
      setToast({ tone: 'success', title: '상태 변경됨', body: `${rule.name} → ${RULE_STATUS_META[next].ko}` });
      await Promise.all([loadKpi(), loadRules(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '상태 변경 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules]);

  const onDelete = useCallback(async (rule: PolicyAutomationRule) => {
    if (!window.confirm(`"${rule.name}" 룰을 삭제하시겠습니까? (soft delete)`)) return;
    setActionBusy(`del:${rule.id}`);
    try {
      await softDeletePolicyAutomationRule(rule.id);
      setToast({ tone: 'warning', title: '룰 삭제됨', body: rule.name });
      await Promise.all([loadKpi(), loadRules(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules]);

  const onRunNow = useCallback(async (rule: PolicyAutomationRule) => {
    if (!window.confirm(`"${rule.name}" 룰을 지금 실행하시겠습니까? 실제 정책 배포가 생성됩니다.`)) return;
    setActionBusy(`run:${rule.id}`);
    try {
      const r = await runPolicyAutomationRuleNow(rule.id, false);
      setToast({
        tone: r.status === 'completed' ? 'success' : r.status === 'skipped' ? 'warning' : 'info',
        title: '즉시 실행 완료',
        body: `${rule.name} — ${r.status} (대상 ${r.target_count ?? 0})${r.deployment_id ? ` · deployment ${r.deployment_id.slice(0, 8)}…` : ''}`,
      });
      await Promise.all([loadKpi(), loadRules(true), loadRuns(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '즉시 실행 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules, loadRuns]);

  const onPreview = useCallback(async (rule: PolicyAutomationRule) => {
    setPreviewRule(rule);
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewResult(null);
    try {
      const r = await runPolicyAutomationRuleNow(rule.id, true);
      setPreviewResult(r);
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally { setPreviewBusy(false); }
  }, []);

  const onEvaluateBatch = useCallback(async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('현재 시점에 due 한 모든 룰을 실제 실행하시겠습니까?')) return;
    setActionBusy('evaluate');
    try {
      const r: PolicyAutomationEvaluateResult = await evaluatePolicyAutomationRules(dryRun);
      setToast({
        tone: r.failed > 0 ? 'danger' : 'success',
        title: dryRun ? 'Dry-run 완료' : '일괄 실행 완료',
        body: `processed=${r.processed} executed=${r.executed} skipped=${r.skipped} failed=${r.failed}`,
      });
      if (!dryRun) await Promise.all([loadKpi(), loadRules(true), loadRuns(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '평가 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules, loadRuns]);

  // ---------------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------------

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    const nextRun = kpi.next_run_at
      ? new Date(kpi.next_run_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    return [
      { label: '전체 룰',     value: kpi.total_rules,    tone: 'neutral' as AdminToneName, icon: <ListChecks size={14} /> },
      { label: '활성 룰',     value: kpi.active_rules,   tone: 'success' as AdminToneName, icon: <Play size={14} /> },
      { label: '24시간 예정', value: kpi.upcoming_24h,   tone: 'info'    as AdminToneName, icon: <Clock size={14} /> },
      { label: '최근 7일 실행', value: kpi.recent_7d_runs, tone: 'primary' as AdminToneName, icon: <Activity size={14} /> },
      { label: '7일 실패',    value: kpi.failed_runs_7d, tone: 'danger'  as AdminToneName, icon: <AlertCircle size={14} /> },
      { label: '다음 실행',   value: nextRun,            tone: 'warning' as AdminToneName, icon: <Calendar size={14} /> },
    ];
  }, [kpi]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Repeat size={16} /> 정책 자동화 엔진</span>}
      description="예약 / 반복 / 시즌 / 이벤트 정책을 자동으로 배포합니다. V1: cron parser/외부 API 미사용, 이벤트는 수동 실행."
      badge={<AdminBadge tone="primary" variant="subtle">Priority 3 · V1</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>
            새로고침
          </AdminButton>
          <AdminButton tone="info" variant="subtle" size="sm"
            leftIcon={<Eye size={12} />}
            loading={actionBusy === 'evaluate'}
            onClick={() => void onEvaluateBatch(true)}>
            전체 Dry-run
          </AdminButton>
          <AdminButton tone="warning" variant="solid" size="sm"
            leftIcon={<Zap size={12} />}
            loading={actionBusy === 'evaluate'}
            onClick={() => void onEvaluateBatch(false)}>
            due 룰 일괄 실행
          </AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={12} />} onClick={() => setShowCreate(true)}>
            룰 생성
          </AdminButton>
        </div>
      }
    >
      {kpiError ? (
        <AdminAlert tone="danger" title="KPI 로드 실패" description={kpiError}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void loadKpi()}>재시도</AdminButton>} />
      ) : kpiCards ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((c) => (
            <AdminStatCard key={c.label} label={c.label} value={c.value} tone={c.tone} icon={c.icon} />
          ))}
        </div>
      ) : (
        <AdminSkeleton variant="kpi" />
      )}

      <div className="flex items-center gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        <TabBtn active={activeTab === 'rules'} onClick={() => setActiveTab('rules')}>
          <ListChecks size={12} /> 룰 목록
          <span className="text-[10px] text-ink-mute tabular-nums">{rulesTotal.toLocaleString()}</span>
        </TabBtn>
        <TabBtn active={activeTab === 'runs'} onClick={() => setActiveTab('runs')}>
          <History size={12} /> 실행 로그
          <span className="text-[10px] text-ink-mute tabular-nums">{runsTotal.toLocaleString()}</span>
        </TabBtn>
      </div>

      {activeTab === 'rules' ? (
        <RulesView
          rules={rules} total={rulesTotal} loading={rulesLoading} error={rulesError}
          search={search} setSearch={(v) => { setSearch(v); setOffset(0); }}
          typeFilter={typeFilter}     setTypeFilter={(v) => { setTypeFilter(v); setOffset(0); }}
          statusFilter={statusFilter} setStatusFilter={(v) => { setStatusFilter(v); setOffset(0); }}
          scopeFilter={scopeFilter}   setScopeFilter={(v) => { setScopeFilter(v); setOffset(0); }}
          enterpriseFilter={enterpriseFilter} setEnterpriseFilter={(v) => { setEnterpriseFilter(v); setOffset(0); }}
          regionFilter={regionFilter}         setRegionFilter={(v) => { setRegionFilter(v); setOffset(0); }}
          enterprises={enterprises} regions={regions}
          offset={offset} setOffset={setOffset}
          onReload={() => void loadRules()}
          onEdit={setEditing}
          onPreview={onPreview}
          onRunNow={onRunNow}
          onStatusToggle={onStatusToggle}
          onDelete={onDelete}
          actionBusy={actionBusy}
        />
      ) : (
        <RunsView
          runs={runs} total={runsTotal} loading={runsLoading} error={runsError}
          ruleFilter={runsRuleFilter} setRuleFilter={(v) => { setRunsRuleFilter(v); setRunsOffset(0); }}
          statusFilter={runsStatusFilter} setStatusFilter={(v) => { setRunsStatusFilter(v); setRunsOffset(0); }}
          rules={rules}
          offset={runsOffset} setOffset={setRunsOffset}
          onReload={() => void loadRuns()}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone={toast.tone} title={toast.title} description={toast.body} />
        </div>
      )}

      {(showCreate || editing) && (
        <RuleModal
          mode={editing ? 'edit' : 'create'}
          rule={editing}
          enterprises={enterprises}
          regions={regions}
          deployablePolicies={deployablePolicies}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={async (msg) => {
            setShowCreate(false); setEditing(null);
            setToast({ tone: 'success', title: '저장됨', body: msg });
            await Promise.all([loadKpi(), loadRules(true)]);
          }}
        />
      )}

      {previewRule && (
        <PreviewModal
          rule={previewRule}
          busy={previewBusy}
          error={previewError}
          result={previewResult}
          onClose={() => { setPreviewRule(null); setPreviewResult(null); setPreviewError(null); }}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// Sub: TabBtn / Helpers
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

function ruleTypeChip(rt: AutomationRuleType) {
  const m = RULE_TYPE_META[rt];
  return <AdminBadge tone={m.tone} icon={m.icon}>{m.ko}</AdminBadge>;
}

function ruleStatusChip(s: AutomationRuleStatus) {
  const m = RULE_STATUS_META[s];
  return <AdminBadge tone={m.tone}>{m.ko}</AdminBadge>;
}

function runStatusChip(s: AutomationRunStatus) {
  const m = RUN_STATUS_META[s];
  return <AdminBadge tone={m.tone}>{m.ko}</AdminBadge>;
}

function scopeLabel(r: PolicyAutomationRule): string {
  const sc = SCOPE_META[r.scope_type].ko;
  if (r.scope_type === 'region')  return `${sc} · ${r.region_name ?? '—'}`;
  if (r.scope_type === 'store')   return `${sc} · ${r.scope_store_ids?.length ?? 0}개 매장`;
  return sc;
}

// =============================================================================
// Rules tab
// =============================================================================

interface RulesViewProps {
  rules: PolicyAutomationRule[]; total: number; loading: boolean; error: string | null;
  search: string; setSearch: (v: string) => void;
  typeFilter: AutomationRuleType | ''; setTypeFilter: (v: AutomationRuleType | '') => void;
  statusFilter: AutomationRuleStatus | ''; setStatusFilter: (v: AutomationRuleStatus | '') => void;
  scopeFilter: AutomationScopeType | '';   setScopeFilter: (v: AutomationScopeType | '') => void;
  enterpriseFilter: string; setEnterpriseFilter: (v: string) => void;
  regionFilter: string; setRegionFilter: (v: string) => void;
  enterprises: EnterpriseAccount[]; regions: EnterpriseRegion[];
  offset: number; setOffset: (n: number) => void;
  onReload: () => void;
  onEdit: (r: PolicyAutomationRule) => void;
  onPreview: (r: PolicyAutomationRule) => void;
  onRunNow: (r: PolicyAutomationRule) => void;
  onStatusToggle: (r: PolicyAutomationRule, next: AutomationRuleStatus) => void;
  onDelete: (r: PolicyAutomationRule) => void;
  actionBusy: string | null;
}

function RulesView(props: RulesViewProps) {
  const { rules, total, loading, error, offset, setOffset } = props;
  return (
    <div className="space-y-3">
      <AdminSearch
        value={props.search} onChange={props.setSearch}
        placeholder="룰명 / 설명 / 정책명 / 본사 검색"
        filters={
          <>
            <select value={props.typeFilter}
              onChange={(e) => props.setTypeFilter(e.target.value as AutomationRuleType | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 유형</option>
              {(Object.keys(RULE_TYPE_META) as AutomationRuleType[]).map((t) => (
                <option key={t} value={t}>{RULE_TYPE_META[t].ko}</option>
              ))}
            </select>
            <select value={props.statusFilter}
              onChange={(e) => props.setStatusFilter(e.target.value as AutomationRuleStatus | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {(Object.keys(RULE_STATUS_META) as AutomationRuleStatus[]).map((s) => (
                <option key={s} value={s}>{RULE_STATUS_META[s].ko}</option>
              ))}
            </select>
            <select value={props.scopeFilter}
              onChange={(e) => props.setScopeFilter(e.target.value as AutomationScopeType | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 범위</option>
              {(Object.keys(SCOPE_META) as AutomationScopeType[]).map((s) => (
                <option key={s} value={s}>{SCOPE_META[s].ko}</option>
              ))}
            </select>
            <select value={props.enterpriseFilter}
              onChange={(e) => props.setEnterpriseFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {props.enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
            <select value={props.regionFilter}
              onChange={(e) => props.setRegionFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 지역</option>
              {props.regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}개</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={props.onReload}>재시도</AdminButton>} />
      )}

      {loading && rules.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && rules.length === 0 && !error ? (
        <AdminEmpty
          icon={<Repeat size={28} />}
          title="자동화 룰이 없습니다."
          description="필터를 조정하거나 룰을 생성하세요."
        />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">룰명</th>
                  <th className="px-3 py-2">유형</th>
                  <th className="px-3 py-2">정책</th>
                  <th className="px-3 py-2">범위</th>
                  <th className="px-3 py-2 text-right">다음 실행</th>
                  <th className="px-3 py-2 text-right">마지막 실행</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => <RuleRow key={r.id} rule={r} {...props} />)}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {rules.map((r) => <RuleCard key={r.id} rule={r} {...props} />)}
          </div>

          {total > PAGE_SIZE && (
            <Pagination offset={offset} total={total} pageSize={PAGE_SIZE} onChange={setOffset} />
          )}
        </>
      )}
    </div>
  );
}

interface RuleRowProps extends Omit<RulesViewProps, 'rules' | 'total' | 'loading' | 'error' | 'offset' | 'setOffset'> {
  rule: PolicyAutomationRule;
}

function RuleRow({ rule, onEdit, onPreview, onRunNow, onStatusToggle, onDelete, actionBusy }: RuleRowProps) {
  return (
    <tr className="border-b border-line/5 hover:bg-bg-hover/30">
      <td className="px-3 py-2">
        <div className="font-semibold text-ink">{rule.name}</div>
        {rule.description && <div className="truncate max-w-[200px] text-[10px] text-ink-mute">{rule.description}</div>}
      </td>
      <td className="px-3 py-2">
        {ruleTypeChip(rule.rule_type)}
        {rule.rule_type === 'recurring' && rule.recurrence_rule && (
          <div className="mt-0.5 text-[10px] text-ink-dim">{rule.recurrence_rule}</div>
        )}
        {rule.rule_type === 'season' && rule.season && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-ink-dim">
            {SEASON_META[rule.season].icon}{SEASON_META[rule.season].ko}
          </div>
        )}
        {rule.rule_type === 'event' && rule.event_type && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-ink-dim">
            {EVENT_META[rule.event_type].icon}{EVENT_META[rule.event_type].ko}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="text-ink">{rule.policy_name ?? '—'}</div>
        <div className="text-[10px] text-ink-mute">{rule.enterprise_name ?? '—'}</div>
      </td>
      <td className="px-3 py-2">
        <div className="text-[11px] text-ink">{scopeLabel(rule)}</div>
        <div className="text-[10px] text-ink-dim">우선순위 {rule.priority}</div>
      </td>
      <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDate(rule.next_run_at)}</td>
      <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDate(rule.last_run_at ?? rule.last_triggered_at)}</td>
      <td className="px-3 py-2">{ruleStatusChip(rule.status)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <AdminTooltip label="미리보기 (dry-run)">
            <AdminButton tone="info" variant="ghost" size="sm" leftIcon={<Eye size={11} />}
              onClick={() => onPreview(rule)}>—</AdminButton>
          </AdminTooltip>
          <AdminTooltip label="지금 실행">
            <AdminButton tone="warning" variant="ghost" size="sm" leftIcon={<Zap size={11} />}
              loading={actionBusy === `run:${rule.id}`}
              onClick={() => onRunNow(rule)}>—</AdminButton>
          </AdminTooltip>
          {rule.status === 'active' ? (
            <AdminTooltip label="일시정지">
              <AdminButton tone="neutral" variant="ghost" size="sm" leftIcon={<Pause size={11} />}
                loading={actionBusy === `status:${rule.id}`}
                onClick={() => onStatusToggle(rule, 'paused')}>—</AdminButton>
            </AdminTooltip>
          ) : rule.status === 'paused' ? (
            <AdminTooltip label="활성화">
              <AdminButton tone="success" variant="ghost" size="sm" leftIcon={<Play size={11} />}
                loading={actionBusy === `status:${rule.id}`}
                onClick={() => onStatusToggle(rule, 'active')}>—</AdminButton>
            </AdminTooltip>
          ) : rule.status !== 'disabled' && (
            <AdminTooltip label="비활성">
              <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Power size={11} />}
                loading={actionBusy === `status:${rule.id}`}
                onClick={() => onStatusToggle(rule, 'disabled')}>—</AdminButton>
            </AdminTooltip>
          )}
          <AdminTooltip label="수정">
            <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<Edit3 size={11} />}
              onClick={() => onEdit(rule)}>—</AdminButton>
          </AdminTooltip>
          <AdminTooltip label="삭제">
            <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
              loading={actionBusy === `del:${rule.id}`}
              onClick={() => onDelete(rule)}>—</AdminButton>
          </AdminTooltip>
        </div>
      </td>
    </tr>
  );
}

function RuleCard({ rule, onEdit, onPreview, onRunNow, onStatusToggle, onDelete, actionBusy }: RuleRowProps) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-ink">{rule.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {ruleTypeChip(rule.rule_type)}
            {ruleStatusChip(rule.status)}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-ink-mute">
        <div><span className="text-ink-dim">정책:</span> {rule.policy_name ?? '—'}</div>
        <div><span className="text-ink-dim">범위:</span> {scopeLabel(rule)}</div>
        <div><span className="text-ink-dim">다음:</span> {fmtDate(rule.next_run_at)}</div>
        <div><span className="text-ink-dim">마지막:</span> {fmtDate(rule.last_run_at ?? rule.last_triggered_at)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        <AdminButton tone="info" variant="ghost" size="sm" leftIcon={<Eye size={11} />} onClick={() => onPreview(rule)}>Preview</AdminButton>
        <AdminButton tone="warning" variant="subtle" size="sm" leftIcon={<Zap size={11} />}
          loading={actionBusy === `run:${rule.id}`} onClick={() => onRunNow(rule)}>지금</AdminButton>
        {rule.status === 'active' ? (
          <AdminButton tone="neutral" variant="ghost" size="sm" leftIcon={<Pause size={11} />}
            loading={actionBusy === `status:${rule.id}`} onClick={() => onStatusToggle(rule, 'paused')}>일시정지</AdminButton>
        ) : rule.status === 'paused' ? (
          <AdminButton tone="success" variant="ghost" size="sm" leftIcon={<Play size={11} />}
            loading={actionBusy === `status:${rule.id}`} onClick={() => onStatusToggle(rule, 'active')}>활성</AdminButton>
        ) : null}
        <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<Edit3 size={11} />} onClick={() => onEdit(rule)}>수정</AdminButton>
        <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
          loading={actionBusy === `del:${rule.id}`} onClick={() => onDelete(rule)}>삭제</AdminButton>
      </div>
    </div>
  );
}

// =============================================================================
// Runs tab
// =============================================================================

interface RunsViewProps {
  runs: PolicyAutomationRun[]; total: number; loading: boolean; error: string | null;
  ruleFilter: string; setRuleFilter: (v: string) => void;
  statusFilter: AutomationRunStatus | ''; setStatusFilter: (v: AutomationRunStatus | '') => void;
  rules: PolicyAutomationRule[];
  offset: number; setOffset: (n: number) => void;
  onReload: () => void;
}

function RunsView({
  runs, total, loading, error, ruleFilter, setRuleFilter,
  statusFilter, setStatusFilter, rules, offset, setOffset, onReload,
}: RunsViewProps) {
  return (
    <div className="space-y-3">
      <AdminSearch
        value=""
        onChange={() => undefined}
        placeholder=""
        filters={
          <>
            <select value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 룰</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AutomationRunStatus | '')}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {(Object.keys(RUN_STATUS_META) as AutomationRunStatus[]).map((s) => (
                <option key={s} value={s}>{RUN_STATUS_META[s].ko}</option>
              ))}
            </select>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}개</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReload}>재시도</AdminButton>} />
      )}

      {loading && runs.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && runs.length === 0 && !error ? (
        <AdminEmpty icon={<History size={28} />} title="실행 로그가 없습니다." />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">실행 시간</th>
                  <th className="px-3 py-2">룰명</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">대상</th>
                  <th className="px-3 py-2 text-right">성공</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2">배포</th>
                  <th className="px-3 py-2">오류</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                    <td className="px-3 py-2 text-[11px] tabular-nums text-ink-mute">{fmtDate(r.started_at)}</td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{r.rule_name ?? '—'}</div>
                      <div className="text-[10px] text-ink-mute">{r.rule_type ? RULE_TYPE_META[r.rule_type].ko : ''}{r.dry_run && ' · dry-run'}</div>
                    </td>
                    <td className="px-3 py-2">{runStatusChip(r.status)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.target_store_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{r.success_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-300">{r.failed_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {r.deployment_id ? (
                        <span>
                          <span className="font-mono text-[10px] text-ink-mute">{r.deployment_id.slice(0, 8)}…</span>
                          {r.deployment_name && <span className="text-[10px] text-ink-dim block truncate max-w-[180px]">{r.deployment_name}</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-ink-dim truncate max-w-[180px]" title={r.error_message ?? ''}>
                      {r.error_message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 md:hidden">
            {runs.map((r) => (
              <div key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-ink">{r.rule_name ?? '—'}</div>
                    <div className="text-[10px] text-ink-mute">{fmtDate(r.started_at)}{r.dry_run && ' · dry-run'}</div>
                  </div>
                  {runStatusChip(r.status)}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div><div className="font-bold tabular-nums">{r.target_store_count}</div><div className="text-[10px] text-ink-dim">대상</div></div>
                  <div><div className="font-bold tabular-nums text-emerald-300">{r.success_count}</div><div className="text-[10px] text-ink-dim">성공</div></div>
                  <div><div className="font-bold tabular-nums text-red-300">{r.failed_count}</div><div className="text-[10px] text-ink-dim">실패</div></div>
                </div>
                {r.error_message && (
                  <div className="mt-1 truncate text-[10px] text-ink-dim">{r.error_message}</div>
                )}
              </div>
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

// =============================================================================
// Pagination
// =============================================================================

function Pagination({ offset, total, pageSize, onChange }: {
  offset: number; total: number; pageSize: number; onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
      <AdminButton tone="neutral" variant="subtle" size="sm"
        disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>이전</AdminButton>
      <span className="text-ink-mute tabular-nums">{offset + 1} – {Math.min(offset + pageSize, total)} / {total.toLocaleString()}</span>
      <AdminButton tone="neutral" variant="subtle" size="sm"
        disabled={offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>다음</AdminButton>
    </div>
  );
}

// =============================================================================
// RuleModal — Create / Edit
// =============================================================================

interface RuleModalProps {
  mode: 'create' | 'edit';
  rule: PolicyAutomationRule | null;
  enterprises: EnterpriseAccount[];
  regions: EnterpriseRegion[];
  deployablePolicies: DeployablePolicy[];
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}

function RuleModal({ mode, rule, enterprises, regions, deployablePolicies, onClose, onSaved }: RuleModalProps) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [enterpriseId, setEnterpriseId] = useState(rule?.enterprise_account_id ?? '');
  const [policyId, setPolicyId] = useState(rule?.policy_id ?? '');
  const [ruleType, setRuleType] = useState<AutomationRuleType>(rule?.rule_type ?? 'scheduled');
  const [scopeType, setScopeType] = useState<AutomationScopeType>(rule?.scope_type ?? 'enterprise');
  const [regionId, setRegionId] = useState(rule?.region_id ?? '');
  const [storeIdsCsv, setStoreIdsCsv] = useState((rule?.scope_store_ids ?? []).join(', '));
  const [startsAt, setStartsAt] = useState(rule?.starts_at ? toLocalDt(rule.starts_at) : '');
  const [endsAt, setEndsAt] = useState(rule?.ends_at ? toLocalDt(rule.ends_at) : '');
  const [recurrenceRule, setRecurrenceRule] = useState(rule?.recurrence_rule ?? '');
  const [eventType, setEventType] = useState<AutomationEventType | ''>(rule?.event_type ?? '');
  const [season, setSeason] = useState<AutomationSeason | ''>(rule?.season ?? '');
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [status, setStatus] = useState<AutomationRuleStatus>(rule?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('이름은 필수입니다.'); return; }
    if (!enterpriseId) { setErr('본사 계정을 선택하세요.'); return; }
    if (!policyId) { setErr('정책을 선택하세요.'); return; }
    if (ruleType === 'scheduled' && !startsAt) { setErr('예약 룰은 시작일이 필수입니다.'); return; }
    if (ruleType === 'recurring' && !recurrenceRule.trim()) { setErr('반복 룰은 반복 규칙이 필수입니다.'); return; }
    if (ruleType === 'season' && !season) { setErr('시즌 룰은 시즌이 필수입니다.'); return; }
    if (ruleType === 'event' && !eventType) { setErr('이벤트 룰은 이벤트 유형이 필수입니다.'); return; }
    if (scopeType === 'region' && !regionId) { setErr('지역 범위는 지역 선택이 필수입니다.'); return; }
    const storeIds = scopeType === 'store'
      ? storeIdsCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    if (scopeType === 'store' && (!storeIds || storeIds.length === 0)) { setErr('매장 범위는 매장 ID가 1개 이상 필요합니다.'); return; }

    setBusy(true);
    try {
      if (isEdit && rule) {
        await updatePolicyAutomationRule({
          id: rule.id,
          name, description: description || null, priority, status,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt:   endsAt   ? new Date(endsAt).toISOString()   : null,
          recurrenceRule: recurrenceRule || null,
          eventType: (eventType || null) as AutomationEventType | null,
          season:    (season || null) as AutomationSeason | null,
          regionId: scopeType === 'region' ? regionId : null,
          clearRegion: scopeType !== 'region',
          scopeType,
          scopeStoreIds: storeIds,
          clearScopeStores: scopeType !== 'store',
          policyId,
        });
        await onSaved(`수정됨: ${name}`);
      } else {
        await createPolicyAutomationRule({
          enterpriseAccountId: enterpriseId, policyId, name, ruleType, scopeType,
          regionId: scopeType === 'region' ? regionId : null,
          scopeStoreIds: storeIds,
          description: description || null,
          status, priority,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt:   endsAt   ? new Date(endsAt).toISOString()   : null,
          recurrenceRule: recurrenceRule || null,
          eventType: (eventType || null) as AutomationEventType | null,
          season:    (season || null) as AutomationSeason | null,
        });
        await onSaved(`생성됨: ${name}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <AdminModal
      open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2">{isEdit ? <Edit3 size={14} /> : <Plus size={14} />} {isEdit ? '룰 수정' : '룰 생성'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>
            {isEdit ? '저장' : '생성'}
          </AdminButton>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="룰명 *">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
        </Field>
        <Field label="유형 *">
          <select value={ruleType} onChange={(e) => setRuleType(e.target.value as AutomationRuleType)}
            disabled={isEdit}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs disabled:opacity-50">
            {(Object.keys(RULE_TYPE_META) as AutomationRuleType[]).map((t) => (
              <option key={t} value={t}>{RULE_TYPE_META[t].ko}</option>
            ))}
          </select>
          {isEdit && <p className="mt-0.5 text-[10px] text-ink-dim">V1: 유형 변경 불가</p>}
        </Field>

        <Field label="본사 계정 *">
          <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs disabled:opacity-50">
            <option value="">선택…</option>
            {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
          </select>
        </Field>
        <Field label="정책 *">
          <select value={policyId} onChange={(e) => setPolicyId(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            <option value="">선택…</option>
            {deployablePolicies.map((p) => (
              <option key={p.policy_id} value={p.policy_id}>
                {p.policy_name} (v{p.latest_version_number}){p.franchise_name ? ` · ${p.franchise_name}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="범위 *">
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as AutomationScopeType)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            {(Object.keys(SCOPE_META) as AutomationScopeType[]).map((s) => (
              <option key={s} value={s}>{SCOPE_META[s].ko}</option>
            ))}
          </select>
        </Field>
        <Field label="우선순위 (1~999)">
          <input type="number" min={1} max={999} value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value || '100', 10))}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
        </Field>

        {scopeType === 'region' && (
          <Field label="지역 *" full>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">선택…</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">
              지역 매장은 store_policy_sync_status 의 enterprise_region_id 기준으로 자동 해석됩니다 (heartbeat 보고 매장만 포함).
            </p>
          </Field>
        )}

        {scopeType === 'store' && (
          <Field label="매장 ID 목록 (쉼표 구분) *" full>
            <textarea rows={2} value={storeIdsCsv} onChange={(e) => setStoreIdsCsv(e.target.value)}
              placeholder="uuid1, uuid2, uuid3"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
            <p className="mt-0.5 text-[10px] text-ink-dim">정책 소속 franchise 의 active 매장과 교집합만 실제 대상이 됩니다.</p>
          </Field>
        )}

        {ruleType === 'scheduled' && (
          <Field label="시작일 *" >
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </Field>
        )}
        {(ruleType === 'season' || ruleType === 'scheduled') && (
          <Field label="종료일">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </Field>
        )}

        {ruleType === 'recurring' && (
          <Field label="반복 규칙 *" full>
            <input type="text" value={recurrenceRule} onChange={(e) => setRecurrenceRule(e.target.value)}
              placeholder="daily:18:00 / weekly:FRI:18:00 / monthly:01:09:00"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
            <p className="mt-0.5 text-[10px] text-ink-dim">
              V1 지원: <code>daily:HH:mm</code>, <code>weekly:DOW:HH:mm</code> (DOW=SUN..SAT), <code>monthly:DD:HH:mm</code>. 타임존 Asia/Seoul.
            </p>
          </Field>
        )}

        {ruleType === 'season' && (
          <Field label="시즌 *">
            <select value={season} onChange={(e) => setSeason(e.target.value as AutomationSeason)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">선택…</option>
              {(Object.keys(SEASON_META) as AutomationSeason[]).map((s) => (
                <option key={s} value={s}>{SEASON_META[s].ko}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">starts_at/ends_at 미설정 시 기본 범위 사용.</p>
          </Field>
        )}

        {ruleType === 'event' && (
          <Field label="이벤트 유형 *">
            <select value={eventType} onChange={(e) => setEventType(e.target.value as AutomationEventType)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">선택…</option>
              {(Object.keys(EVENT_META) as AutomationEventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_META[t].ko}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">V1: 이벤트는 자동 트리거 없음 — 수동 "지금 실행" 만 가능.</p>
          </Field>
        )}

        <Field label="상태">
          <select value={status} onChange={(e) => setStatus(e.target.value as AutomationRuleStatus)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            {(Object.keys(RULE_STATUS_META) as AutomationRuleStatus[]).map((s) => (
              <option key={s} value={s}>{RULE_STATUS_META[s].ko}</option>
            ))}
          </select>
        </Field>

        <Field label="설명" full>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
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
  // ISO → 'YYYY-MM-DDTHH:MM' (datetime-local input value)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =============================================================================
// PreviewModal — dry_run result
// =============================================================================

function PreviewModal({ rule, busy, error, result, onClose }: {
  rule: PolicyAutomationRule; busy: boolean; error: string | null;
  result: PolicyAutomationRunNowResult | null; onClose: () => void;
}) {
  return (
    <AdminModal
      open onClose={onClose} size="lg"
      title={<span className="flex items-center gap-2"><Eye size={14} /> Dry-run 미리보기 — {rule.name}</span>}
      headerExtra={ruleTypeChip(rule.rule_type)}
      footer={<AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>닫기</AdminButton>}
    >
      {busy ? (
        <AdminSkeleton variant="block" rows={5} />
      ) : error ? (
        <AdminAlert tone="danger" title="Preview 실패" description={error} />
      ) : result ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <SummaryStat label="대상 매장 수" value={result.target_count ?? 0} />
            <SummaryStat label="배포 생성 예정" value={result.would_create_deployment ? '예' : '아니오'} />
            <SummaryStat label="dry_run" value="true" />
          </div>
          {(result.target_count ?? 0) === 0 ? (
            <AdminAlert
              tone="warning"
              title="대상 매장 없음"
              description="scope 해석 결과 대상이 없습니다. region 범위라면 해당 region 에 heartbeat 보고한 매장이 없습니다. store 범위라면 매장 ID 가 franchise active 매장과 교집합이 비었을 수 있습니다."
            />
          ) : (
            <AdminAlert
              tone="info"
              title="실행 시 배포 1건이 생성됩니다."
              description={`대상 ${result.target_count}개 매장. 실제 실행 시 admin_create_policy_deployment 호출 → enterprise_policy_deployments + targets 생성 + enterprise_policy_automation_runs 기록.`}
            />
          )}
          {result.sample_store_ids && result.sample_store_ids.length > 0 && (
            <div className="rounded-lg bg-bg-deep/40 p-3 ring-1 ring-line/10">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">샘플 매장 ID (최대 5)</div>
              <div className="space-y-1 font-mono text-[11px] text-ink">
                {result.sample_store_ids.map((id) => <div key={id}>{id}</div>)}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </AdminModal>
  );
}

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
