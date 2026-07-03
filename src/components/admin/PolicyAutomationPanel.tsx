/**
 * PolicyAutomationPanel — Enterprise Priority 3 (자동 음악 스케줄 / Automation Engine V1).
 *
 * 예약/반복/시즌/이벤트 자동 음악 배포 스케줄 관리 + 배포 실행 로그 + 미리보기 + 즉시 배포.
 * 기존 음악 배포 시스템 (enterprise_policy_deployments / admin_create_policy_deployment)
 * 재사용. V1: 외부 API/cron parser/자동 트리거 없음 (이벤트는 수동 배포만).
 *
 * NOTE: DB/API/RPC 의 'policy' 용어는 그대로 유지. 사용자 노출 문구만 친근화.
 *
 * SQL: supabase/migrations/0378_policy_automation_engine_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, AlertCircle, Calendar, Clock, Repeat,
  CloudRain, Snowflake, Sun, Pause, Play, Power, Trash2, Eye, Zap,
  Activity, History, ListChecks, Edit3,
  // Automation Center Phase additions
  ArrowRight, Bot, CheckCircle2, ExternalLink, RotateCcw, ShieldCheck, Siren, Sparkles, TrendingUp,
} from 'lucide-react';
import {
  AdminSection, AdminSearch, AdminBadge, AdminButton,
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
  expired:  { ko: '종료됨',   tone: 'neutral' },
  disabled: { ko: '비활성',   tone: 'danger'  },
};

const RUN_STATUS_META: Record<AutomationRunStatus, { ko: string; tone: AdminToneName }> = {
  completed: { ko: '완료',     tone: 'success' },
  failed:    { ko: '실패',     tone: 'danger'  },
  running:   { ko: '진행 중',  tone: 'info'    },
  pending:   { ko: '대기',     tone: 'warning' },
  skipped:   { ko: '제외',     tone: 'neutral' },
};

const RULE_TYPE_META: Record<AutomationRuleType, { ko: string; icon: React.ReactNode; tone: AdminToneName; hint: string }> = {
  scheduled: { ko: '예약 실행',   icon: <Calendar size={11} />, tone: 'info',    hint: '특정 날짜와 시간에 한 번 실행' },
  recurring: { ko: '반복 실행',   icon: <Repeat   size={11} />, tone: 'primary', hint: '매일/매주/매월 반복 실행' },
  season:    { ko: '시즌 자동화', icon: <Sun      size={11} />, tone: 'warning', hint: '봄/여름/가을/겨울/크리스마스 시즌' },
  event:     { ko: '이벤트 조건', icon: <Zap      size={11} />, tone: 'success', hint: '비/눈/공휴일/오픈/마감 같은 조건 (수동 실행)' },
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

export interface PolicyAutomationPanelProps {
  /**
   * 자동 스케줄 생성 모달에서 "적용할 플레이리스트" 가 0개일 때,
   * "프랜차이즈 관리에서 플레이리스트 등록" 버튼을 눌렀을 때의 콜백.
   * PolicyDeploymentPanel 와 동일 시그니처 — AdminPage 에서 동일 핸들러를 공유.
   */
  onRequestFranchisePolicyNav?: () => void;
}

export default function PolicyAutomationPanel({ onRequestFranchisePolicyNav }: PolicyAutomationPanelProps = {}) {
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
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);

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

  // 플레이리스트 dropdown 공급용 — loading/error 상태를 명시적으로 추적해
  // 진짜 0건과 RPC 실패를 구분 (이전에는 둘 다 빈 배열 → "없습니다" 로 잘못 표시)
  const loadDeployablePolicies = useCallback(async () => {
    setPoliciesLoading(true);
    setPoliciesError(null);
    try {
      const r = await listDeployablePolicies({ limit: 200 });
      setDeployablePolicies(r.data);
    } catch (e) {
      console.warn('[PolicyAutomation] policies load failed', e);
      setPoliciesError((e as Error).message);
      setDeployablePolicies([]);
    } finally {
      setPoliciesLoading(false);
    }
  }, []);

  // filter sources (1회 + 모달 열릴 때 재조회)
  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[PolicyAutomation] enterprises load failed', e));
    void listEnterpriseRegions({ limit: 200 }).then((r) => setRegions(r.data))
      .catch((e) => console.warn('[PolicyAutomation] regions load failed', e));
    void loadDeployablePolicies();
  }, [loadDeployablePolicies]);

  // 모달 열릴 때마다 플레이리스트 목록 재조회 — 다른 탭/시간대에 새 정책이 생겼을 수 있음
  useEffect(() => {
    if (showCreate || editing) void loadDeployablePolicies();
  }, [showCreate, editing, loadDeployablePolicies]);

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
      setToast({ tone: 'success', title: '스케줄 상태가 변경되었습니다.', body: `${rule.name} → ${RULE_STATUS_META[next].ko}` });
      await Promise.all([loadKpi(), loadRules(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '상태 변경 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules]);

  const onDelete = useCallback(async (rule: PolicyAutomationRule) => {
    if (!window.confirm(`"${rule.name}" 자동 스케줄을 삭제하시겠습니까? (복구 가능)`)) return;
    setActionBusy(`del:${rule.id}`);
    try {
      await softDeletePolicyAutomationRule(rule.id);
      setToast({ tone: 'warning', title: '자동 스케줄이 삭제되었습니다.', body: rule.name });
      await Promise.all([loadKpi(), loadRules(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules]);

  const onRunNow = useCallback(async (rule: PolicyAutomationRule) => {
    if (!window.confirm(`"${rule.name}" 을(를) 지금 매장에 배포하시겠습니까? 실제 음악 배포가 생성됩니다.`)) return;
    setActionBusy(`run:${rule.id}`);
    try {
      const r = await runPolicyAutomationRuleNow(rule.id, false);
      setToast({
        tone: r.status === 'completed' ? 'success' : r.status === 'skipped' ? 'warning' : 'info',
        title: '음악 배포가 요청되었습니다.',
        body: `${rule.name} — 대상 ${r.target_count ?? 0}개 매장${r.deployment_id ? ` · 배포 ID ${r.deployment_id.slice(0, 8)}…` : ''}`,
      });
      await Promise.all([loadKpi(), loadRules(true), loadRuns(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '음악 배포 실패', body: (e as Error).message });
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
    if (!dryRun && !window.confirm('현재 예정된 모든 음악 스케줄을 매장에 일괄 배포하시겠습니까?')) return;
    setActionBusy('evaluate');
    try {
      const r: PolicyAutomationEvaluateResult = await evaluatePolicyAutomationRules(dryRun);
      setToast({
        tone: r.failed > 0 ? 'danger' : 'success',
        title: dryRun ? '배포 미리보기가 완료되었습니다.' : '일괄 배포가 완료되었습니다.',
        body: `검토 ${r.processed} · 배포 ${r.executed} · 제외 ${r.skipped} · 실패 ${r.failed}`,
      });
      if (!dryRun) await Promise.all([loadKpi(), loadRules(true), loadRuns(true)]);
    } catch (e) {
      setToast({ tone: 'danger', title: '스케줄 평가 실패', body: (e as Error).message });
    } finally { setActionBusy(null); }
  }, [loadKpi, loadRules, loadRuns]);

  // ---------------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------------

  // KPI cards 는 Automation Center Phase 의 AutomationHeroKpi 로 대체됨.

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Repeat size={16} /> 자동 음악 스케줄</span>}
      description="예약 / 반복 / 시즌 / 이벤트 조건에 따라 매장 음악을 자동으로 배포합니다."
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
            전체 미리보기
          </AdminButton>
          <AdminButton tone="warning" variant="solid" size="sm"
            leftIcon={<Zap size={12} />}
            loading={actionBusy === 'evaluate'}
            onClick={() => void onEvaluateBatch(false)}>
            예정된 음악 일괄 배포
          </AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={12} />} onClick={() => setShowCreate(true)}>
            자동 스케줄 생성
          </AdminButton>
        </div>
      }
    >
      {kpiError ? (
        <AdminAlert tone="danger" title="KPI 로드 실패" description={kpiError}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void loadKpi()}>재시도</AdminButton>} />
      ) : kpi ? (
        <AutomationHeroKpi kpi={kpi} runs={runs} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 rounded-xl bg-bg-card ring-1 ring-line/15 animate-pulse" />
          ))}
        </div>
      )}

      {/* ============================================================ */}
      {/* Automation Center — Rule-based (LLM 미사용, 새 API/RPC/polling 0) */}
      {/* ============================================================ */}
      {kpi && (
        <AutomationCenterSection
          kpi={kpi}
          rules={rules}
          runs={runs}
          onCreateNew={() => setShowCreate(true)}
          onSwitchToRules={() => setActiveTab('rules')}
          onSwitchToRuns={() => setActiveTab('runs')}
        />
      )}

      <div className="flex items-center gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        <TabBtn active={activeTab === 'rules'} onClick={() => setActiveTab('rules')}>
          <ListChecks size={12} /> 자동 스케줄 목록
          <span className="text-[10px] text-ink-mute tabular-nums">{rulesTotal.toLocaleString()}</span>
        </TabBtn>
        <TabBtn active={activeTab === 'runs'} onClick={() => setActiveTab('runs')}>
          <History size={12} /> 배포 실행 로그
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
          policiesLoading={policiesLoading}
          policiesError={policiesError}
          onReloadPolicies={() => void loadDeployablePolicies()}
          onRequestFranchisePolicyNav={onRequestFranchisePolicyNav}
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
        placeholder="스케줄명 / 설명 / 플레이리스트 / 본사 검색"
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
          title="등록된 자동 스케줄이 없습니다."
          description="필터를 조정하거나 새 자동 스케줄을 생성하세요."
        />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">스케줄명</th>
                  <th className="px-3 py-2">유형</th>
                  <th className="px-3 py-2">적용할 플레이리스트</th>
                  <th className="px-3 py-2">범위</th>
                  <th className="px-3 py-2 text-right">다음 배포</th>
                  <th className="px-3 py-2 text-right">마지막 배포</th>
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
          <AdminTooltip label="배포 미리보기">
            <AdminButton tone="info" variant="ghost" size="sm" leftIcon={<Eye size={11} />}
              onClick={() => onPreview(rule)}>—</AdminButton>
          </AdminTooltip>
          <AdminTooltip label="지금 음악 배포">
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
        <div><span className="text-ink-dim">플레이리스트:</span> {rule.policy_name ?? '—'}</div>
        <div><span className="text-ink-dim">범위:</span> {scopeLabel(rule)}</div>
        <div><span className="text-ink-dim">다음 배포:</span> {fmtDate(rule.next_run_at)}</div>
        <div><span className="text-ink-dim">마지막 배포:</span> {fmtDate(rule.last_run_at ?? rule.last_triggered_at)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        <AdminButton tone="info" variant="ghost" size="sm" leftIcon={<Eye size={11} />} onClick={() => onPreview(rule)}>미리보기</AdminButton>
        <AdminButton tone="warning" variant="subtle" size="sm" leftIcon={<Zap size={11} />}
          loading={actionBusy === `run:${rule.id}`} onClick={() => onRunNow(rule)}>지금 배포</AdminButton>
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
              <option value="">전체 스케줄</option>
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
        <AdminEmpty icon={<History size={28} />} title="배포 실행 로그가 없습니다." />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">배포 시각</th>
                  <th className="px-3 py-2">스케줄명</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">대상 매장</th>
                  <th className="px-3 py-2 text-right">성공</th>
                  <th className="px-3 py-2 text-right">실패</th>
                  <th className="px-3 py-2">생성된 배포</th>
                  <th className="px-3 py-2">오류</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 hover:bg-bg-hover/30">
                    <td className="px-3 py-2 text-[11px] tabular-nums text-ink-mute">{fmtDate(r.started_at)}</td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{r.rule_name ?? '—'}</div>
                      <div className="text-[10px] text-ink-mute">{r.rule_type ? RULE_TYPE_META[r.rule_type].ko : ''}{r.dry_run && ' · 미리보기'}</div>
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
                    <div className="text-[10px] text-ink-mute">{fmtDate(r.started_at)}{r.dry_run && ' · 미리보기'}</div>
                  </div>
                  {runStatusChip(r.status)}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div><div className="font-bold tabular-nums">{r.target_store_count}</div><div className="text-[10px] text-ink-dim">대상 매장</div></div>
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
  policiesLoading: boolean;
  policiesError: string | null;
  onReloadPolicies: () => void;
  onRequestFranchisePolicyNav?: () => void;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}

function RuleModal({
  mode, rule, enterprises, regions, deployablePolicies,
  policiesLoading, policiesError, onReloadPolicies, onRequestFranchisePolicyNav,
  onClose, onSaved,
}: RuleModalProps) {
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
    if (!name.trim()) { setErr('스케줄명을 입력해 주세요.'); return; }
    if (!enterpriseId) { setErr('본사 계정을 선택해 주세요.'); return; }
    if (!policyId) {
      setErr('자동 스케줄에 사용할 플레이리스트를 먼저 선택해 주세요. 플레이리스트가 없다면 먼저 플레이리스트를 만들어야 합니다.');
      return;
    }
    if (ruleType === 'scheduled' && !startsAt) { setErr('예약 실행은 시작 일시가 필요합니다.'); return; }
    if (ruleType === 'recurring' && !recurrenceRule.trim()) { setErr('반복 실행은 반복 규칙이 필요합니다.'); return; }
    if (ruleType === 'season' && !season) { setErr('시즌 자동화는 시즌을 선택해 주세요.'); return; }
    if (ruleType === 'event' && !eventType) { setErr('이벤트 조건은 이벤트 유형을 선택해 주세요.'); return; }
    if (scopeType === 'region' && !regionId) { setErr('지역 범위는 지역을 선택해 주세요.'); return; }
    const storeIds = scopeType === 'store'
      ? storeIdsCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : null;
    if (scopeType === 'store' && (!storeIds || storeIds.length === 0)) { setErr('매장 범위는 매장 ID를 1개 이상 입력해 주세요.'); return; }

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
        await onSaved(`자동 음악 스케줄이 수정되었습니다: ${name}`);
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
        await onSaved(`자동 음악 스케줄이 생성되었습니다: ${name}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <AdminModal
      open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2">{isEdit ? <Edit3 size={14} /> : <Plus size={14} />} {isEdit ? '자동 스케줄 수정' : '자동 스케줄 생성'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>
            {isEdit ? '저장' : '스케줄 생성'}
          </AdminButton>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="스케줄명 *">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="예) 크리스마스 음악 자동 적용 · 금요일 저녁 POP · 비오는 날 재즈"
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
          <p className="mt-0.5 text-[10px] text-ink-dim">{RULE_TYPE_META[ruleType].hint}</p>
          {isEdit && <p className="mt-0.5 text-[10px] text-ink-dim">생성 후 유형은 변경할 수 없습니다.</p>}
        </Field>

        <Field label="본사 계정 *">
          <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs disabled:opacity-50">
            <option value="">본사 계정을 선택하세요</option>
            {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
          </select>
        </Field>
        <Field label="적용할 플레이리스트 *">
          {policiesLoading ? (
            <AdminSkeleton variant="block" rows={2} />
          ) : policiesError ? (
            <AdminAlert
              tone="danger"
              title="플레이리스트 목록을 불러올 수 없습니다."
              description={policiesError}
              action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={onReloadPolicies}>다시 시도</AdminButton>}
            />
          ) : deployablePolicies.length === 0 ? (
            <AdminAlert
              tone="warning"
              title="아직 배포 가능한 플레이리스트가 없습니다."
              description="자동 스케줄은 먼저 플레이리스트를 만든 뒤, 매장에 배포할 수 있는 상태로 설정해야 사용할 수 있습니다."
              action={
                onRequestFranchisePolicyNav ? (
                  <AdminButton
                    tone="primary" size="sm"
                    onClick={onRequestFranchisePolicyNav}>
                    플레이리스트 만들기
                  </AdminButton>
                ) : (
                  <AdminButton tone="info" variant="subtle" size="sm" onClick={onReloadPolicies}>
                    새로고침
                  </AdminButton>
                )
              }
            />
          ) : (
            <>
              <select value={policyId} onChange={(e) => setPolicyId(e.target.value)}
                className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
                <option value="">자동으로 배포할 플레이리스트를 선택하세요</option>
                {deployablePolicies.map((p) => (
                  <option key={p.policy_id} value={p.policy_id}>
                    {p.source_type ? `[${p.source_type}] ` : ''}{p.policy_name}
                    {p.source_playlist_title && p.source_playlist_title !== p.policy_name
                      ? ` ← ${p.source_playlist_title}` : ''}
                    {' '}(v{p.latest_version_number})
                    {typeof p.track_count_snapshot === 'number' && p.track_count_snapshot > 0
                      ? ` · ${p.track_count_snapshot}곡` : ''}
                    {p.franchise_name ? ` · ${p.franchise_name}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] text-ink-dim">
                매장에 자동으로 배포할 음악 구성을 선택하세요. ({deployablePolicies.length}개)
              </p>
            </>
          )}
        </Field>

        <Field label="범위 *">
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as AutomationScopeType)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
            {(Object.keys(SCOPE_META) as AutomationScopeType[]).map((s) => (
              <option key={s} value={s}>{SCOPE_META[s].ko}</option>
            ))}
          </select>
        </Field>
        <Field label="우선순위">
          <input type="number" min={1} max={999} value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value || '100', 10))}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          <p className="mt-0.5 text-[10px] text-ink-dim">
            숫자가 낮을수록 먼저 적용 · 예) 50 긴급 / 100 기본 / 200 낮음
          </p>
        </Field>

        {scopeType === 'region' && (
          <Field label="지역 *" full>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">지역을 선택하세요</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.region_name} ({r.region_code})</option>)}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">
              선택한 지역에 등록된 매장 중 최근 접속 이력이 있는 매장에만 자동 배포됩니다.
            </p>
          </Field>
        )}

        {scopeType === 'store' && (
          <Field label="매장 ID 목록 (쉼표 구분) *" full>
            <textarea rows={2} value={storeIdsCsv} onChange={(e) => setStoreIdsCsv(e.target.value)}
              placeholder="매장 ID를 쉼표로 구분해 입력하세요"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
            <p className="mt-0.5 text-[10px] text-ink-dim">본사의 활성 매장과 일치하는 매장에만 실제 배포됩니다.</p>
          </Field>
        )}

        {ruleType === 'scheduled' && (
          <Field label="시작 일시 *" >
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </Field>
        )}
        {(ruleType === 'season' || ruleType === 'scheduled') && (
          <Field label="종료 일시">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
          </Field>
        )}

        {ruleType === 'recurring' && (
          <Field label="반복 규칙 *" full>
            <input type="text" value={recurrenceRule} onChange={(e) => setRecurrenceRule(e.target.value)}
              placeholder="예: daily:18:00 / weekly:FRI:18:00 / monthly:01:09:00"
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono text-[11px]" />
            <div className="mt-1 space-y-0.5 text-[10px] text-ink-dim">
              <div>· 매일 오후 6시 → <code>daily:18:00</code></div>
              <div>· 매주 금요일 오후 6시 → <code>weekly:FRI:18:00</code></div>
              <div>· 매월 1일 오전 9시 → <code>monthly:01:09:00</code></div>
              <div className="mt-1 text-ink-dim/80">요일 코드: SUN / MON / TUE / WED / THU / FRI / SAT · 타임존 Asia/Seoul</div>
            </div>
          </Field>
        )}

        {ruleType === 'season' && (
          <Field label="시즌 *">
            <select value={season} onChange={(e) => setSeason(e.target.value as AutomationSeason)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">시즌을 선택하세요</option>
              {(Object.keys(SEASON_META) as AutomationSeason[]).map((s) => (
                <option key={s} value={s}>{SEASON_META[s].ko}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">시작/종료 일시를 비워두면 시즌별 기본 기간이 사용됩니다.</p>
          </Field>
        )}

        {ruleType === 'event' && (
          <Field label="이벤트 유형 *">
            <select value={eventType} onChange={(e) => setEventType(e.target.value as AutomationEventType)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">이벤트 유형을 선택하세요</option>
              {(Object.keys(EVENT_META) as AutomationEventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_META[t].ko}</option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] text-ink-dim">이벤트 조건은 자동 트리거 없이 "지금 음악 배포" 버튼으로만 실행됩니다.</p>
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
      title={<span className="flex items-center gap-2"><Eye size={14} /> 배포 미리보기 — {rule.name}</span>}
      headerExtra={ruleTypeChip(rule.rule_type)}
      footer={<AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>닫기</AdminButton>}
    >
      {busy ? (
        <AdminSkeleton variant="block" rows={5} />
      ) : error ? (
        <AdminAlert tone="danger" title="미리보기 실패" description={error} />
      ) : result ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <SummaryStat label="대상 매장 수" value={result.target_count ?? 0} />
            <SummaryStat label="음악 배포 생성 예정" value={result.would_create_deployment ? '예' : '아니오'} />
            <SummaryStat label="모드" value="미리보기" />
          </div>
          {(result.target_count ?? 0) === 0 ? (
            <AdminAlert
              tone="warning"
              title="배포할 매장이 없습니다."
              description="범위 설정을 확인해 주세요. 지역 범위라면 해당 지역에 최근 접속한 매장이 없을 수 있고, 매장 범위라면 입력한 매장 ID가 본사의 활성 매장과 일치하지 않을 수 있습니다."
            />
          ) : (
            <AdminAlert
              tone="info"
              title={`실행 시 ${result.target_count}개 매장에 음악 배포 1건이 생성됩니다.`}
              description="미리보기에서는 실제 배포가 만들어지지 않습니다. 실행하려면 목록에서 '지금 음악 배포' 버튼을 사용하세요."
            />
          )}
          {result.sample_store_ids && result.sample_store_ids.length > 0 && (
            <div className="rounded-lg bg-bg-deep/40 p-3 ring-1 ring-line/10">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">샘플 매장 ID (최대 5개)</div>
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

// =============================================================================
// Music Policy Automation Center (spec 1~11) — Rule-based, LLM 미사용
// -----------------------------------------------------------------------------
// 새 API/RPC/DB/Migration/polling 도입 0. 새 fetch 함수 도입 없음.
// 기존 kpi + rules + runs 만 조합.
// =============================================================================

// -----------------------------------------------------------------------------
// spec 1 — Automation Hero KPI (Enterprise Hero 스타일)
// -----------------------------------------------------------------------------
function AutomationHeroKpi({ kpi, runs }: { kpi: PolicyAutomationKpi; runs: PolicyAutomationRun[] }) {
  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending').length;
  const nextRun = kpi.next_run_at
    ? new Date(kpi.next_run_at).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '—';
  const failRate = kpi.recent_7d_runs > 0 ? (kpi.failed_runs_7d / kpi.recent_7d_runs) * 100 : 0;
  const health: { label: 'Healthy' | 'Warning' | 'Critical'; tone: 'success' | 'warning' | 'danger' } =
    failRate >= 20 ? { label: 'Critical', tone: 'danger' }
    : failRate >= 5 || kpi.paused_rules > 0 ? { label: 'Warning', tone: 'warning' }
    : { label: 'Healthy', tone: 'success' };

  const items: Array<{ label: string; desc: string; value: string; icon: JSX.Element; tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' }> = [
    { label: '자동 배포',         desc: '7d runs',        value: kpi.recent_7d_runs.toLocaleString(), icon: <Repeat size={22} />,       tone: 'primary' },
    { label: '예약 작업',         desc: '24h upcoming',   value: kpi.upcoming_24h.toLocaleString(),   icon: <Calendar size={22} />,     tone: kpi.upcoming_24h > 0 ? 'info' : 'success' },
    { label: '실행 중',           desc: 'active runs',    value: activeRuns.toLocaleString(),         icon: <Activity size={22} />,     tone: activeRuns > 0 ? 'info' : 'success' },
    { label: '실패',              desc: '7d failed',      value: kpi.failed_runs_7d.toLocaleString(), icon: <AlertCircle size={22} />,  tone: kpi.failed_runs_7d > 0 ? 'danger' : 'success' },
    { label: '다음 실행',         desc: 'next_run_at',    value: nextRun,                              icon: <Clock size={22} />,        tone: 'warning' },
    { label: 'Automation Health', desc: 'aggregate',      value: health.label,                         icon: <Bot size={22} />,          tone: health.tone },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => {
        const cls =
          item.tone === 'success'  ? { bg: 'bg-emerald-500/25', ring: 'ring-emerald-400/50', chip: 'bg-emerald-500/40 text-emerald-100' }
          : item.tone === 'warning' ? { bg: 'bg-amber-500/25',   ring: 'ring-amber-400/50',   chip: 'bg-amber-500/40 text-amber-100' }
          : item.tone === 'danger'  ? { bg: 'bg-rose-500/25',    ring: 'ring-rose-400/50',    chip: 'bg-rose-500/40 text-rose-100' }
          : item.tone === 'info'    ? { bg: 'bg-sky-500/25',     ring: 'ring-sky-400/50',     chip: 'bg-sky-500/40 text-sky-100' }
          :                            { bg: 'bg-violet-500/25', ring: 'ring-violet-400/50', chip: 'bg-violet-500/40 text-violet-100' };
        return (
          <div
            key={item.label}
            className={`rounded-xl p-2.5 ring-1 transition-all duration-150 hover:shadow-md ${cls.bg} ${cls.ring}`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cls.chip}`}>
                {item.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-ink leading-tight">{item.label}</p>
                <p className="truncate text-[9.5px] text-ink-mute leading-tight">{item.desc}</p>
              </div>
            </div>
            <p className="mt-1.5 tabular-nums text-2xl font-black text-ink truncate" title={item.value}>{item.value}</p>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 3 — Automation Health helper
// -----------------------------------------------------------------------------
function computeAutomationHealth(kpi: PolicyAutomationKpi): {
  label: 'Healthy' | 'Warning' | 'Critical'; tone: 'success' | 'warning' | 'danger';
  reason: string;
} {
  const failRate = kpi.recent_7d_runs > 0 ? (kpi.failed_runs_7d / kpi.recent_7d_runs) * 100 : 0;
  if (failRate >= 20) {
    return { label: 'Critical', tone: 'danger',  reason: `실패율 ${failRate.toFixed(1)}%` };
  }
  if (failRate >= 5 || kpi.paused_rules > 0 || kpi.disabled_rules > 0) {
    return { label: 'Warning',  tone: 'warning', reason: `실패율 ${failRate.toFixed(1)}% · 일시정지 ${kpi.paused_rules}` };
  }
  return { label: 'Healthy',  tone: 'success', reason: `자동 배포 안정 운영 중` };
}

// -----------------------------------------------------------------------------
// Section root
// -----------------------------------------------------------------------------
function AutomationCenterSection({
  kpi, rules, runs, onCreateNew, onSwitchToRules, onSwitchToRuns,
}: {
  kpi: PolicyAutomationKpi;
  rules: PolicyAutomationRule[];
  runs: PolicyAutomationRun[];
  onCreateNew: () => void;
  onSwitchToRules: () => void;
  onSwitchToRuns: () => void;
}) {
  const health = useMemo(() => computeAutomationHealth(kpi), [kpi]);

  const scheduled = useMemo(() => {
    return [...rules]
      .filter((r) => r.status === 'active' && r.next_run_at)
      .sort((a, b) => new Date(a.next_run_at ?? 0).getTime() - new Date(b.next_run_at ?? 0).getTime())
      .slice(0, 6);
  }, [rules]);

  const summary = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const start = new Date(y, m, d).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const todayRuns = runs.filter((r) => {
      const t = new Date(r.started_at).getTime();
      return t >= start && t < end;
    });
    return {
      total:    todayRuns.length,
      success:  todayRuns.filter((r) => r.status === 'completed').length,
      failed:   todayRuns.filter((r) => r.status === 'failed').length,
      upcoming: kpi.upcoming_24h,
    };
  }, [runs, kpi]);

  const empty = rules.length === 0 && kpi.total_rules === 0;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Bot size={14} className="text-violet-200" />
        <h2 className="text-[13px] font-black text-ink">Automation Center</h2>
        <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-100 ring-1 ring-violet-400/50">
          <Sparkles size={9} /> BETA
        </span>
        <span className="text-[10px] text-ink-mute">자동 스케줄 · 자동 배포 · 자동 검증 · 자동 복구 · Rule-based · LLM 미사용</span>
      </div>

      {/* spec 3 — Automation Health Center */}
      <AutomationHealthCenter health={health} kpi={kpi} summary={summary} />

      {empty ? (
        // spec 10 — Empty
        <AdminEmpty
          title="예약된 자동 작업이 없습니다."
          description="자동 스케줄을 생성하면 이 곳에서 lifecycle 을 확인할 수 있습니다."
          action={
            <AdminButton tone="primary" onClick={onCreateNew}>
              <Plus size={12} /> 자동 스케줄 생성
            </AdminButton>
          }
        />
      ) : (
        <>
          {/* spec 4 + 7 + 9 — Deck 3열 */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <AiAutomationInsightCard kpi={kpi} rules={rules} runs={runs} scheduled={scheduled} />
            </div>
            <div className="lg:col-span-1">
              <AutomationSummaryCard summary={summary} onOpenRuns={onSwitchToRuns} />
            </div>
            <div className="lg:col-span-1">
              <RecoveryRecommendationCard runs={runs} rules={rules} onOpenRuns={onSwitchToRuns} />
            </div>
          </div>

          {/* spec 2 + 5 — Scheduled Jobs + Queue */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ScheduledJobsCard scheduled={scheduled} onOpenRules={onSwitchToRules} />
            </div>
            <div className="lg:col-span-1">
              <AutomationQueueCard runs={runs} onOpenRuns={onSwitchToRuns} />
            </div>
          </div>

          {/* spec 6 + 8 — Timeline + Retry Queue */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AutomationTimelineCard runs={runs} />
            </div>
            <div className="lg:col-span-1">
              <RetryQueueCard runs={runs} onOpenRuns={onSwitchToRuns} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 3 — Automation Health Center
// -----------------------------------------------------------------------------
function AutomationHealthCenter({
  health, kpi, summary,
}: {
  health: { label: 'Healthy' | 'Warning' | 'Critical'; tone: 'success' | 'warning' | 'danger'; reason: string };
  kpi: PolicyAutomationKpi;
  summary: { total: number; success: number; failed: number; upcoming: number };
}) {
  const healthTone = health.tone === 'success' ? 'bg-emerald-500/25 ring-emerald-500/45 text-emerald-100'
                   : health.tone === 'warning' ? 'bg-amber-500/25   ring-amber-500/45   text-amber-100'
                   :                             'bg-rose-500/25    ring-rose-500/45    text-rose-100';
  const successRate = kpi.recent_7d_runs > 0 ? Math.round(((kpi.recent_7d_runs - kpi.failed_runs_7d) / kpi.recent_7d_runs) * 100) : 100;

  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><ShieldCheck size={13} /> Automation Health</span>}
      subtitle="실시간 자동 배포 상태 · Rule-based"
    >
      <div className="grid gap-2 md:grid-cols-5">
        <div className={`col-span-2 rounded-xl p-3 ring-1 md:col-span-1 ${healthTone}`}>
          <div className="flex items-center gap-2">
            <span>
              {health.tone === 'success' ? <CheckCircle2 size={20} />
                : health.tone === 'warning' ? <AlertCircle size={20} />
                : <Siren size={20} className="animate-pulse" />}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider">Health</p>
              <p className="text-[20px] font-black text-ink">{health.label}</p>
            </div>
          </div>
          <p className="mt-1 text-[10.5px] text-ink-mute">{health.reason}</p>
        </div>
        <HealthMiniAuto label="활성 스케줄" value={kpi.active_rules.toLocaleString()} tone="success" icon={<Play size={12} />} />
        <HealthMiniAuto label="일시정지" value={kpi.paused_rules.toLocaleString()} tone={kpi.paused_rules > 0 ? 'warning' : 'success'} icon={<Pause size={12} />} />
        <HealthMiniAuto label="7d 성공률" value={`${successRate}%`} tone={successRate >= 95 ? 'success' : successRate >= 80 ? 'warning' : 'danger'} icon={<TrendingUp size={12} />} />
        <HealthMiniAuto label="오늘 예정" value={summary.upcoming.toLocaleString()} tone="info" icon={<Clock size={12} />} />
      </div>
    </AdminCardAuto>
  );
}

function HealthMiniAuto({ label, value, tone, icon }: {
  label: string; value: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  icon: JSX.Element;
}) {
  const cls = tone === 'success' ? { bg: 'bg-emerald-500/25', ring: 'ring-emerald-500/45', text: 'text-emerald-100' }
            : tone === 'warning' ? { bg: 'bg-amber-500/25',   ring: 'ring-amber-500/45',   text: 'text-amber-100' }
            : tone === 'danger'  ? { bg: 'bg-rose-500/25',    ring: 'ring-rose-500/45',    text: 'text-rose-100' }
            :                      { bg: 'bg-sky-500/25',     ring: 'ring-sky-500/45',     text: 'text-sky-100' };
  return (
    <div className={`rounded-xl p-2.5 ring-1 ${cls.bg} ${cls.ring}`}>
      <p className={`flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider ${cls.text}`}>
        {icon}{label}
      </p>
      <p className="mt-0.5 tabular-nums text-[18px] font-black text-ink">{value}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 4 — AI Automation Insight (Rule-based)
// -----------------------------------------------------------------------------
function AiAutomationInsightCard({
  kpi, rules, runs, scheduled,
}: {
  kpi: PolicyAutomationKpi; rules: PolicyAutomationRule[];
  runs: PolicyAutomationRun[]; scheduled: PolicyAutomationRule[];
}) {
  const insights = useMemo(() => {
    const out: Array<{ key: string; emoji: string; text: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = [];
    // 가장 임박한 실행
    if (scheduled.length > 0 && scheduled[0].next_run_at) {
      const s = scheduled[0];
      const at = new Date(s.next_run_at!);
      const label = at.toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      out.push({
        key: 'next',
        emoji: '🤖',
        text: `${label} 에 "${s.name}" 이(가) 실행됩니다. 정책 교체 예정.`,
        tone: 'info',
      });
    }
    if (kpi.upcoming_24h > 0) {
      out.push({
        key: 'upcoming',
        emoji: '🤖',
        text: `예약 작업이 ${kpi.upcoming_24h}건 대기 중입니다.`,
        tone: 'info',
      });
    }
    const successRate = kpi.recent_7d_runs > 0 ? ((kpi.recent_7d_runs - kpi.failed_runs_7d) / kpi.recent_7d_runs) * 100 : 100;
    if (kpi.recent_7d_runs >= 3 && successRate === 100) {
      out.push({ key: 'perfect', emoji: '🏆', text: `최근 자동 배포 성공률 100% · ${kpi.recent_7d_runs}회 모두 성공.`, tone: 'success' });
    } else if (successRate < 80 && kpi.recent_7d_runs > 0) {
      out.push({ key: 'drop', emoji: '⚠️', text: `자동 배포 성공률 ${successRate.toFixed(1)}% — 실패 원인 점검을 권장합니다.`, tone: 'warning' });
    }
    // 오래 실행되지 않은 활성 rule
    const now = Date.now();
    const stale = rules.find((r) => r.status === 'active' && r.last_run_at
      && (now - new Date(r.last_run_at).getTime()) > 14 * 24 * 60 * 60 * 1000);
    if (stale) {
      out.push({ key: 'stale', emoji: '🕒', text: `"${stale.name}" 는 최근 14일간 실행되지 않았습니다. 조건 재확인.`, tone: 'warning' });
    }
    // 실패 rule 언급
    const failedRun = runs.find((r) => r.status === 'failed');
    if (failedRun && failedRun.rule_name) {
      out.push({
        key: 'fail_rule',
        emoji: '🚨',
        text: `"${failedRun.rule_name}" 실행 실패. ${failedRun.error_message ? '오류: ' + failedRun.error_message.slice(0, 40) + '…' : '재시도 검토.'}`,
        tone: 'danger',
      });
    }
    return out.slice(0, 5);
  }, [kpi, rules, runs, scheduled]);

  return (
    <AdminCardAuto title={<span className="flex items-center gap-2"><Bot size={13} /> AI Automation Insight
      <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-100 ring-1 ring-violet-400/50">
        <Sparkles size={9} /> BETA
      </span>
    </span>} subtitle="Rule-based · LLM 미사용">
      {insights.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg bg-emerald-500/25 py-4 text-center ring-1 ring-emerald-500/45">
          <Bot size={22} className="text-emerald-200" />
          <p className="text-[11px] font-bold text-emerald-100">이상 신호가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {insights.map((i) => {
            const cls = i.tone === 'success' ? { bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40', text: 'text-emerald-100' }
                      : i.tone === 'warning' ? { bg: 'bg-amber-500/20',   ring: 'ring-amber-500/40',   text: 'text-amber-100' }
                      : i.tone === 'danger'  ? { bg: 'bg-rose-500/20',    ring: 'ring-rose-500/40',    text: 'text-rose-100' }
                      :                        { bg: 'bg-sky-500/20',     ring: 'ring-sky-500/40',     text: 'text-sky-100' };
            return (
              <li key={i.key} className={`rounded-lg p-2 ring-1 ${cls.bg} ${cls.ring}`}>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-[13px] leading-tight" aria-hidden>{i.emoji}</span>
                  <p className={`text-[11px] leading-relaxed ${cls.text}`}>{i.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCardAuto>
  );
}

// Reusable card wrapper (기존 AdminCard 를 이 파일에서 import 하지 않았으므로 간이 wrapper)
function AdminCardAuto({ title, subtitle, action, children }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 transition hover:ring-line/20">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-ink">{title}</div>
          {subtitle && <div className="mt-0.5 text-[10px] text-ink-mute">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 9 — Automation Summary
// -----------------------------------------------------------------------------
function AutomationSummaryCard({
  summary, onOpenRuns,
}: {
  summary: { total: number; success: number; failed: number; upcoming: number };
  onOpenRuns: () => void;
}) {
  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><Activity size={13} /> 오늘 요약</span>}
      subtitle="자동 배포 · 오늘 00:00 ~ 24:00"
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onOpenRuns}>
          로그 <ArrowRight size={10} />
        </AdminButton>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <SummaryStatAuto label="자동 실행" value={summary.total} tone="info" />
        <SummaryStatAuto label="성공"       value={summary.success} tone="success" />
        <SummaryStatAuto label="실패"       value={summary.failed} tone={summary.failed > 0 ? 'danger' : 'success'} />
        <SummaryStatAuto label="예정"       value={summary.upcoming} tone={summary.upcoming > 0 ? 'warning' : 'success'} />
      </div>
    </AdminCardAuto>
  );
}

function SummaryStatAuto({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  const cls = tone === 'success' ? { bg: 'bg-emerald-500/25', ring: 'ring-emerald-500/45', text: 'text-emerald-100' }
            : tone === 'warning' ? { bg: 'bg-amber-500/25',   ring: 'ring-amber-500/45',   text: 'text-amber-100' }
            : tone === 'danger'  ? { bg: 'bg-rose-500/25',    ring: 'ring-rose-500/45',    text: 'text-rose-100' }
            :                      { bg: 'bg-sky-500/25',     ring: 'ring-sky-500/45',     text: 'text-sky-100' };
  return (
    <div className={`rounded-lg p-2 ring-1 ${cls.bg} ${cls.ring}`}>
      <p className={`text-[9.5px] font-bold uppercase tracking-wider ${cls.text}`}>{label}</p>
      <p className="tabular-nums text-[18px] font-black text-ink">{value.toLocaleString()}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 7 — Recovery Recommendation
// -----------------------------------------------------------------------------
function RecoveryRecommendationCard({
  runs, rules, onOpenRuns,
}: {
  runs: PolicyAutomationRun[]; rules: PolicyAutomationRule[]; onOpenRuns: () => void;
}) {
  const items = useMemo(() => {
    const failedRuns = runs.filter((r) => r.status === 'failed').slice(0, 3);
    const out: Array<{ key: string; text: string; tone: 'danger' | 'warning'; icon: JSX.Element }> = [];
    for (const r of failedRuns) {
      const err = (r.error_message ?? '').toLowerCase();
      if (err.includes('heartbeat') || err.includes('sync')) {
        out.push({ key: `hb:${r.id}`, text: `${r.rule_name ?? '알 수 없음'} — Heartbeat 이상. 재배포 권장.`, tone: 'danger', icon: <RotateCcw size={11} /> });
      } else if (err.includes('offline') || err.includes('disconnect')) {
        out.push({ key: `off:${r.id}`, text: `${r.rule_name ?? '알 수 없음'} — Offline. 정책 보류 권장.`, tone: 'warning', icon: <Pause size={11} /> });
      } else {
        out.push({ key: `fail:${r.id}`, text: `${r.rule_name ?? '알 수 없음'} — 실행 실패. 조건 재확인 권장.`, tone: 'warning', icon: <AlertCircle size={11} /> });
      }
    }
    // 오래 실행되지 않은 active rule
    const now = Date.now();
    const stale = rules.filter((r) => r.status === 'active' && r.last_run_at
      && (now - new Date(r.last_run_at).getTime()) > 14 * 24 * 60 * 60 * 1000).slice(0, 2);
    for (const r of stale) {
      out.push({ key: `stale:${r.id}`, text: `${r.name} — 14일간 미실행. 조건/타이밍 검토.`, tone: 'warning', icon: <Clock size={11} /> });
    }
    return out.slice(0, 4);
  }, [runs, rules]);

  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><RotateCcw size={13} /> Recovery Recommendation</span>}
      subtitle="자동 복구 추천 · Rule-based"
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onOpenRuns}>
          로그 <ArrowRight size={10} />
        </AdminButton>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg bg-emerald-500/25 py-4 text-center ring-1 ring-emerald-500/45">
          <CheckCircle2 size={22} className="text-emerald-200" />
          <p className="text-[11px] font-bold text-emerald-100">복구 필요 항목이 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => {
            const cls = i.tone === 'danger'
              ? { bg: 'bg-rose-500/20', ring: 'ring-rose-500/40', text: 'text-rose-100' }
              : { bg: 'bg-amber-500/20', ring: 'ring-amber-500/40', text: 'text-amber-100' };
            return (
              <li key={i.key} className={`rounded-lg p-2 ring-1 ${cls.bg} ${cls.ring}`}>
                <div className="flex items-start gap-1.5">
                  <span className={`mt-0.5 shrink-0 ${cls.text}`}>{i.icon}</span>
                  <p className={`text-[11px] leading-relaxed ${cls.text}`}>{i.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCardAuto>
  );
}

// -----------------------------------------------------------------------------
// spec 2 — Scheduled Jobs (예약 작업 목록)
// -----------------------------------------------------------------------------
function ScheduledJobsCard({
  scheduled, onOpenRules,
}: {
  scheduled: PolicyAutomationRule[]; onOpenRules: () => void;
}) {
  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><Calendar size={13} /> Scheduled Jobs</span>}
      subtitle={`가장 임박한 예약 작업 · 상위 ${scheduled.length}개`}
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onOpenRules}>
          전체 <ExternalLink size={10} />
        </AdminButton>
      }
    >
      {scheduled.length === 0 ? (
        <AdminEmpty title="예약 작업 없음" description="활성 스케줄에 next_run_at 값이 설정되면 표시됩니다." />
      ) : (
        <ul className="space-y-1.5">
          {scheduled.map((r) => {
            const type = RULE_TYPE_META[r.rule_type];
            const at = r.next_run_at
              ? new Date(r.next_run_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
              : '—';
            return (
              <li key={r.id} className="rounded-lg bg-bg-card p-2 ring-1 ring-line/15 transition hover:shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold text-ink">{r.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-mute">
                      <AdminBadge tone={type.tone} variant="subtle">{type.icon}{type.ko}</AdminBadge>
                      {r.policy_name && <span className="truncate">· {r.policy_name}</span>}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-mute">
                      대상 <span className="text-ink">{SCOPE_META[r.scope_type].ko}</span>
                      {' · '}최근 실행 {r.last_run_at
                        ? new Date(r.last_run_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
                        : '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[10.5px] tabular-nums text-ink">{at}</p>
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold text-emerald-100 ring-1 ring-emerald-500/45">
                      <Play size={9} /> 활성
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCardAuto>
  );
}

// -----------------------------------------------------------------------------
// spec 5 — Automation Queue (실행 예정 / 실행 중 / 재시도 / 완료)
// -----------------------------------------------------------------------------
function AutomationQueueCard({
  runs, onOpenRuns,
}: {
  runs: PolicyAutomationRun[]; onOpenRuns: () => void;
}) {
  const groups = useMemo(() => {
    const pending  = runs.filter((r) => r.status === 'pending').slice(0, 3);
    const running  = runs.filter((r) => r.status === 'running').slice(0, 3);
    const failed   = runs.filter((r) => r.status === 'failed').slice(0, 3);
    const completed = runs.filter((r) => r.status === 'completed').slice(0, 3);
    return { pending, running, failed, completed };
  }, [runs]);

  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><Zap size={13} /> Automation Queue</span>}
      subtitle="실행 예정 / 실행 중 / 재시도 / 완료"
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onOpenRuns}>
          로그 <ArrowRight size={10} />
        </AdminButton>
      }
    >
      <div className="space-y-2 text-[11px]">
        <QueueSectionAuto label="실행 예정" tone="warning" items={groups.pending}   emptyText="대기 없음" />
        <QueueSectionAuto label="실행 중"   tone="info"    items={groups.running}   emptyText="실행 중 없음" />
        <QueueSectionAuto label="재시도"    tone="danger"  items={groups.failed}    emptyText="재시도 없음" />
        <QueueSectionAuto label="완료"      tone="success" items={groups.completed} emptyText="완료 이력 없음" />
      </div>
    </AdminCardAuto>
  );
}

function QueueSectionAuto({ label, tone, items, emptyText }: {
  label: string; tone: 'success' | 'warning' | 'danger' | 'info';
  items: PolicyAutomationRun[]; emptyText: string;
}) {
  const cls = tone === 'success' ? { text: 'text-emerald-200', chip: 'bg-emerald-500/25 text-emerald-100 ring-emerald-500/45' }
            : tone === 'warning' ? { text: 'text-amber-200',   chip: 'bg-amber-500/25 text-amber-100 ring-amber-500/45' }
            : tone === 'danger'  ? { text: 'text-rose-200',    chip: 'bg-rose-500/25 text-rose-100 ring-rose-500/45' }
            :                      { text: 'text-sky-200',     chip: 'bg-sky-500/25 text-sky-100 ring-sky-500/45' };
  return (
    <div>
      <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${cls.text}`}>{label}</p>
      {items.length === 0 ? (
        <p className="text-[10px] text-ink-mute">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((r) => (
            <li key={r.id} className={`flex items-center justify-between rounded-md px-2 py-1 ring-1 ${cls.chip}`}>
              <span className="min-w-0 truncate font-semibold">{r.rule_name ?? '알 수 없음'}</span>
              <span className="shrink-0 tabular-nums text-[10px]">{r.target_store_count}매장</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// spec 6 — Automation Timeline
// -----------------------------------------------------------------------------
function AutomationTimelineCard({ runs }: { runs: PolicyAutomationRun[] }) {
  const events = useMemo(() => {
    const out: Array<{ key: string; at: string; label: string; rule: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = [];
    for (const r of runs.slice(0, 20)) {
      const name = r.rule_name ?? '알 수 없음';
      if (r.started_at) {
        out.push({
          key: `${r.id}:start`,
          at: r.started_at,
          label: r.status === 'pending' ? '자동 배포 예약' : '자동 배포 실행',
          rule: name,
          tone: r.status === 'pending' ? 'info' : 'info',
        });
      }
      if (r.completed_at) {
        const tone: 'success' | 'warning' | 'danger' =
          r.status === 'completed' ? 'success'
          : r.status === 'failed' ? 'danger'
          : 'warning';
        out.push({
          key: `${r.id}:done`,
          at: r.completed_at,
          label: r.status === 'completed' ? '자동 배포 완료 · 검증 완료'
               : r.status === 'failed' ? '자동 배포 실패'
               : r.status === 'skipped' ? '자동 배포 제외'
               : '자동 배포 종료',
          rule: name,
          tone,
        });
      }
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out.slice(0, 14);
  }, [runs]);

  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><History size={13} /> Automation Timeline</span>}
      subtitle="자동 배포 이벤트 · 시간 역순 · 최근 14건"
    >
      {events.length === 0 ? (
        <AdminEmpty title="이벤트 없음" description="자동 배포 실행 로그가 아직 없습니다." />
      ) : (
        <ul className="space-y-1">
          {events.map((e) => {
            const rail = e.tone === 'success' ? 'bg-emerald-500'
                       : e.tone === 'warning' ? 'bg-amber-500'
                       : e.tone === 'danger'  ? 'bg-rose-500'
                       :                        'bg-sky-500';
            const chip = e.tone === 'success' ? 'bg-emerald-500/40 text-emerald-100'
                       : e.tone === 'warning' ? 'bg-amber-500/40   text-amber-100'
                       : e.tone === 'danger'  ? 'bg-rose-500/40    text-rose-100'
                       :                        'bg-sky-500/40     text-sky-100';
            return (
              <li key={e.key} className="flex items-stretch gap-2">
                <span className="w-14 shrink-0 pt-1 text-right font-mono text-[10px] tabular-nums text-ink-mute">
                  {new Date(e.at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`w-0.5 shrink-0 rounded-full ${rail}`} aria-hidden />
                <div className="min-w-0 flex-1 rounded-md bg-bg-card p-1.5 text-[11px] ring-1 ring-line/10">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${chip}`} aria-hidden>
                      <Bot size={9} />
                    </span>
                    <span className="font-bold text-ink">{e.label}</span>
                    <span className="min-w-0 truncate text-ink-mute">· {e.rule}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCardAuto>
  );
}

// -----------------------------------------------------------------------------
// spec 8 — Retry Queue (Priority)
// -----------------------------------------------------------------------------
function RetryQueueCard({
  runs, onOpenRuns,
}: {
  runs: PolicyAutomationRun[]; onOpenRuns: () => void;
}) {
  const items = useMemo(() => {
    const failed = runs.filter((r) => r.status === 'failed');
    return failed
      .map((r) => {
        const err = (r.error_message ?? '').toLowerCase();
        const priority: 'P1' | 'P2' | 'P3' =
          err.includes('heartbeat') || err.includes('offline') || err.includes('sync') ? 'P1'
          : (r.failed_count ?? 0) > 0 ? 'P2'
          : 'P3';
        return { r, priority };
      })
      .sort((a, b) => (a.priority === 'P1' ? 0 : a.priority === 'P2' ? 1 : 2)
                    - (b.priority === 'P1' ? 0 : b.priority === 'P2' ? 1 : 2))
      .slice(0, 6);
  }, [runs]);

  return (
    <AdminCardAuto
      title={<span className="flex items-center gap-2"><RotateCcw size={13} /> Retry Queue</span>}
      subtitle="P1 → P2 → P3 순 · 최대 6개"
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={onOpenRuns}>
          로그 <ArrowRight size={10} />
        </AdminButton>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg bg-emerald-500/25 py-4 text-center ring-1 ring-emerald-500/45">
          <CheckCircle2 size={22} className="text-emerald-200" />
          <p className="text-[11px] font-bold text-emerald-100">재시도 대기 없음.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map(({ r, priority }) => {
            const cls = priority === 'P1' ? { bg: 'bg-rose-500/20', ring: 'ring-rose-500/40', text: 'text-rose-100', chip: 'bg-rose-500/40 text-rose-50' }
                      : priority === 'P2' ? { bg: 'bg-amber-500/20', ring: 'ring-amber-500/40', text: 'text-amber-100', chip: 'bg-amber-500/40 text-amber-50' }
                      :                     { bg: 'bg-sky-500/20',    ring: 'ring-sky-500/40',    text: 'text-sky-100',    chip: 'bg-sky-500/40 text-sky-50' };
            return (
              <li key={r.id} className={`rounded-lg p-2 ring-1 ${cls.bg} ${cls.ring}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ring-1 ${cls.chip} ring-white/20`}>
                      {priority}
                    </span>
                    <p className={`min-w-0 truncate text-[11.5px] font-bold ${cls.text}`}>{r.rule_name ?? '알 수 없음'}</p>
                  </div>
                  <p className="shrink-0 text-[10px] text-ink-mute">
                    {r.error_message ? r.error_message.slice(0, 24) + (r.error_message.length > 24 ? '…' : '') : '재시도 대기'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCardAuto>
  );
}
