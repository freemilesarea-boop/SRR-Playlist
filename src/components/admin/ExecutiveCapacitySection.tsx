/**
 * ExecutiveCapacitySection — Enterprise Executive Capacity Intelligence,
 * Priority Portfolio Optimization & Financial Exposure Center (Phase AI-OPS-16).
 *
 * Priorities → Capacity → Effort → Aging/Delay Exposure → Financial Exposure/ROI →
 * Portfolio → Feasibility/Conflict → Load/Dependency → 사람 선택 → External → Audit.
 * 시간/인력 자료 없으면 unknown · Effort null→0 합산 금지 · Exposure ≠ 실제 회계 손실 ·
 * ROI Reference ≠ 실제 수익률 · Portfolio ≠ 실행 계획 · Hard Risk 조용한 제외 금지.
 *
 * 탭 40개(스펙 42절 전체).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Briefcase, Calendar, Clock, GitBranch, Grid3x3, History,
  Layers, Lightbulb, Link2, ListChecks, Lock, RefreshCw, Scale, ScrollText, Shield, Target,
  TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecCapacitySummary, createExecCapacitySnapshot, fetchExecCapacitySnapshots,
  createPriorityEffort, fetchPriorityEfforts, createAgingSnapshot, fetchAgingSnapshots,
  createFinancialExposure, fetchFinancialExposures, createConfidenceDriftSnapshot,
  fetchConfidenceDriftSnapshots, createPriorityPortfolio, reviewPriorityPortfolio,
  fetchPriorityPortfolios, recordExecCapacityExternalAction, fetchExecCapacityAudit,
  fetchExecPriorities,
  type ExecCapacitySummary, type ExecCapacitySnapshotRow, type EffortEstimateRow,
  type AgingSnapshotRow, type FinancialExposureRow, type ConfidenceDriftSnapshotRow,
  type PriorityPortfolioRow, type ExecCapacityEventRow, type ExecPriorityRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  classifyExecutiveCapacity, calculateDecisionLoad, calculateCapacityUtilization,
  calculatePriorityEffort, calculatePriorityAging, classifyAgingStatus, calculateDelayExposure,
  calculateFinancialExposure, calculateDelayCost, calculateOpportunityROI, evaluateNonFinancialValue,
  calculateConfidenceDrift, classifyConfidenceDrift, detectOrganizationalDependency,
  detectSinglePersonDependency, detectSingleApproverDependency, buildPriorityPortfolio,
  evaluateHardRiskCoverage, evaluatePortfolioFeasibility, detectCapacityConflict,
  detectScheduleConflict, detectMutuallyExclusivePriorities, buildPriorityDeferralCandidate,
  buildExecutiveLoadBalancingCandidate, simulatePortfolioDecision,
  buildExecutiveCapacityRecommendation, buildPortfolioOutcomeLink, calculateCapacityHealthScore,
  CAPACITY_SUPPORT, type PortfolioPriorityInput,
} from '@/lib/executiveCapacityIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'execcapacity' | 'capsnapshots' | 'decisionload' | 'utilization' | 'effort'
  | 'revieweffort' | 'decisioneffort' | 'meetingload' | 'aging' | 'overdue' | 'delayexposure'
  | 'finexposure' | 'delaycost' | 'roi' | 'nonfinvalue' | 'drift' | 'drifthistory' | 'orgdeps'
  | 'singleperson' | 'singleapprover' | 'missingowners' | 'missingbackups' | 'portfolios'
  | 'candidates' | 'feasibility' | 'hardrisk' | 'capconflicts' | 'resourceconf' | 'schedconf'
  | 'mutex' | 'deferrals' | 'loadbalancing' | 'simulations' | 'recommendations' | 'outcomes'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'execcapacity', label: 'Executive Capacity', icon: Users },
  { key: 'capsnapshots', label: 'Capacity Snapshots', icon: History },
  { key: 'decisionload', label: 'Decision Load', icon: Scale },
  { key: 'utilization', label: 'Capacity Utilization', icon: BarChart3 },
  { key: 'effort', label: 'Priority Effort', icon: Clock },
  { key: 'revieweffort', label: 'Review Effort', icon: Clock },
  { key: 'decisioneffort', label: 'Decision Effort', icon: Clock },
  { key: 'meetingload', label: 'Meeting Load', icon: Calendar },
  { key: 'aging', label: 'Priority Aging', icon: History },
  { key: 'overdue', label: 'Overdue Priorities', icon: AlertTriangle },
  { key: 'delayexposure', label: 'Delay Exposure', icon: AlertTriangle },
  { key: 'finexposure', label: 'Financial Exposure', icon: Briefcase },
  { key: 'delaycost', label: 'Delay Cost', icon: Briefcase },
  { key: 'roi', label: 'Opportunity ROI', icon: TrendingUp },
  { key: 'nonfinvalue', label: 'Non-Financial Value', icon: Lightbulb },
  { key: 'drift', label: 'Confidence Drift', icon: TrendingUp },
  { key: 'drifthistory', label: 'Confidence History', icon: History },
  { key: 'orgdeps', label: 'Organizational Dependencies', icon: GitBranch },
  { key: 'singleperson', label: 'Single Person Dependencies', icon: Users },
  { key: 'singleapprover', label: 'Single Approver Dependencies', icon: Users },
  { key: 'missingowners', label: 'Missing Owners', icon: AlertTriangle },
  { key: 'missingbackups', label: 'Missing Backup Owners', icon: AlertTriangle },
  { key: 'portfolios', label: 'Priority Portfolios', icon: Target },
  { key: 'candidates', label: 'Portfolio Candidates', icon: ListChecks },
  { key: 'feasibility', label: 'Portfolio Feasibility', icon: Scale },
  { key: 'hardrisk', label: 'Hard Risk Coverage', icon: Shield },
  { key: 'capconflicts', label: 'Capacity Conflicts', icon: GitBranch },
  { key: 'resourceconf', label: 'Resource Conflicts', icon: GitBranch },
  { key: 'schedconf', label: 'Schedule Conflicts', icon: Calendar },
  { key: 'mutex', label: 'Mutually Exclusive Priorities', icon: GitBranch },
  { key: 'deferrals', label: 'Priority Deferrals', icon: Clock },
  { key: 'loadbalancing', label: 'Executive Load Balancing', icon: Scale },
  { key: 'simulations', label: 'Decision Simulations', icon: Lightbulb },
  { key: 'recommendations', label: 'Capacity Recommendations', icon: Lightbulb },
  { key: 'outcomes', label: 'Portfolio Outcomes', icon: Link2 },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Capacity Actions', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_ACTIONS = ['executive_time_reserved_reference', 'meeting_scheduled_reference', 'reviewer_assigned_reference', 'approver_assigned_reference', 'backup_owner_assigned_reference', 'priority_started_reference', 'priority_deferred_reference', 'budget_reserved_reference', 'team_capacity_added_reference', 'deadline_changed_reference', 'portfolio_review_completed_reference', 'manual_capacity_action_reference'];
const PENDING_PRIORITY_STATUSES = ['draft', 'pending_materiality_review', 'pending_urgency_review', 'pending_executive_review', 'under_review'];

export default function ExecutiveCapacitySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ExecCapacitySummary>({});
  const [capSnapshots, setCapSnapshots] = useState<ExecCapacitySnapshotRow[]>([]);
  const [efforts, setEfforts] = useState<EffortEstimateRow[]>([]);
  const [agingRows, setAgingRows] = useState<AgingSnapshotRow[]>([]);
  const [exposures, setExposures] = useState<FinancialExposureRow[]>([]);
  const [driftRows, setDriftRows] = useState<ConfidenceDriftSnapshotRow[]>([]);
  const [portfolios, setPortfolios] = useState<PriorityPortfolioRow[]>([]);
  const [priorities, setPriorities] = useState<ExecPriorityRow[]>([]);
  const [audit, setAudit] = useState<ExecCapacityEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [hoursInput, setHoursInput] = useState('');
  const [extAction, setExtAction] = useState(EXT_ACTIONS[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, cs, ef, ag, ex, dr, pf, pr, au] = await Promise.all([
        fetchExecCapacitySummary(), fetchExecCapacitySnapshots(null, 50), fetchPriorityEfforts(null, 100),
        fetchAgingSnapshots(null, 100), fetchFinancialExposures(null, 100), fetchConfidenceDriftSnapshots(null, 100),
        fetchPriorityPortfolios(null, 50), fetchExecPriorities(null, 100), fetchExecCapacityAudit(100),
      ]);
      setSummary(s); setCapSnapshots(cs); setEfforts(ef); setAgingRows(ag); setExposures(ex);
      setDriftRows(dr); setPortfolios(pf); setPriorities(pr); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  /* ── 실측/순수 로직 분석 ── */
  const actuals = useMemo(() => (summary.source_actuals ?? {}) as Record<string, number | string>, [summary]);
  const mrr = typeof actuals.mrr_actual === 'number' ? actuals.mrr_actual : null;
  const adminCount = typeof actuals.admin_count === 'number' ? actuals.admin_count : null;

  const latestCapacity = capSnapshots[0] ?? null;
  const capacityVerdict = useMemo(() => classifyExecutiveCapacity({
    availableHours: latestCapacity?.available_hours ?? null,
    reservedHours: latestCapacity?.reserved_hours ?? null,
    concurrentLimit: latestCapacity?.concurrent_priority_limit ?? null,
    currentPriorities: latestCapacity?.current_priority_count ?? null,
  }), [latestCapacity]);

  const decisionLoad = useMemo(() => calculateDecisionLoad({
    pendingPriorities: priorities.length ? priorities.filter((p) => PENDING_PRIORITY_STATUSES.includes(p.priority_status)).length : null,
    p0Count: priorities.filter((p) => p.priority_tier === 'P0_human_review_now' && PENDING_PRIORITY_STATUSES.includes(p.priority_status)).length,
    p1Count: priorities.filter((p) => p.priority_tier === 'P1_executive_review').length,
    pendingAgendas: null, pendingConflicts: null,
    singleApprover: adminCount == null ? null : adminCount <= 1,
  }), [priorities, adminCount]);

  const utilization = useMemo(() => calculateCapacityUtilization({
    usedHours: latestCapacity?.reserved_hours ?? null,
    availableHours: latestCapacity?.available_hours ?? null,
    concurrentUsed: latestCapacity?.current_priority_count ?? null,
    concurrentLimit: latestCapacity?.concurrent_priority_limit ?? null,
  }), [latestCapacity]);

  const effortAnalysis = useMemo(() => efforts.map((e) => ({
    e,
    calc: calculatePriorityEffort({ reviewHours: e.review_hours, decisionHours: e.decision_hours, meetingHours: e.meeting_hours, analysisHours: e.analysis_hours, executionHours: e.execution_reference_hours, observationHours: e.observation_hours }),
  })), [efforts]);

  const agingAnalysis = useMemo(() => priorities.map((p) => {
    const aging = calculatePriorityAging({ createdAt: new Date(p.created_at), reviewedAt: p.reviewed_at ? new Date(p.reviewed_at) : null, deadlineAt: p.deadline_at ? new Date(p.deadline_at) : null, now });
    const status = classifyAgingStatus({ ageDays: aging.ageDays, daysToDeadline: aging.daysToDeadline, thresholds: null });
    return { p, aging, status };
  }), [priorities, now]);

  const overdue = useMemo(() => agingAnalysis.filter(({ status }) => status.status === 'overdue_candidate' || status.status === 'critical_overdue_candidate'), [agingAnalysis]);

  const exposureAnalysis = useMemo(() => exposures.map((x) => ({
    x,
    calc: calculateFinancialExposure({ lowEstimate: x.low_estimate, expectedEstimate: x.expected_estimate, highEstimate: x.high_estimate, probabilityPct: x.probability_reference }),
    delay: calculateDelayExposure({ exposureAmountKrw: x.expected_estimate, mrrKrw: mrr, hardRiskWindow: null, causalBasis: x.verification_status === 'internally_measured_reference' }),
  })), [exposures, mrr]);

  const delayCosts = useMemo(() => exposures.map((x) => ({
    x,
    cost: calculateDelayCost({ exposureAmount: x.expected_estimate, delayFactorPerDay: null, delayDays: null, causalBasis: x.verification_status === 'internally_measured_reference' }),
  })), [exposures]);

  const roiAnalysis = useMemo(() => exposures.filter((x) => x.exposure_type === 'opportunity_value_at_risk').map((x) => ({
    x,
    roi: calculateOpportunityROI({ expectedBenefit: x.expected_estimate, expectedCost: null }),   // cost 시스템 없음(실측) → roi_unavailable
  })), [exposures]);

  const nonFinValue = useMemo(() => evaluateNonFinancialValue(priorities.filter((p) => (p.hard_risk_flags ?? []).length > 0).map((p) => ({ kind: 'risk_reduction', rationale: p.title, evidence: [p.priority_code] }))), [priorities]);

  const driftAnalysis = useMemo(() => {
    const byPriority = new Map<string, ConfidenceDriftSnapshotRow[]>();
    for (const d of driftRows) {
      if (!byPriority.has(d.priority_candidate_id)) byPriority.set(d.priority_candidate_id, []);
      byPriority.get(d.priority_candidate_id)!.push(d);
    }
    return [...byPriority.entries()].map(([pid, rows]) => {
      const drift = calculateConfidenceDrift(rows.map((r) => ({ at: new Date(r.snapshot_at), value: r.confidence_value })));
      return { pid, rows, drift, status: classifyConfidenceDrift(drift) };
    });
  }, [driftRows]);

  const orgDependency = useMemo(() => detectOrganizationalDependency({ owners: adminCount != null && adminCount > 0 ? ['admin(실측)'] : [], approvers: adminCount === 1 ? ['admin(실측)'] : adminCount != null ? Array.from({ length: adminCount }, (_, i) => `admin_${i + 1}`) : [], backups: [], orgDataAvailable: adminCount != null }), [adminCount]);
  const singlePerson = useMemo(() => detectSinglePersonDependency(adminCount === 1 ? [{ person: 'admin(실측)', priorityCodes: priorities.slice(0, 5).map((p) => p.priority_code) }] : null), [adminCount, priorities]);
  const singleApprover = useMemo(() => detectSingleApproverDependency(audit.filter((e) => e.event_type === 'portfolio_selected_reference' || e.event_type === 'portfolio_review_started').map((e) => ({ approver: e.actor_id }))), [audit]);

  const portfolioInputs: PortfolioPriorityInput[] = useMemo(() => priorities.map((p) => {
    const effort = efforts.find((e) => e.priority_candidate_id === p.id);
    return {
      code: p.priority_code, tier: p.priority_tier, hardRiskFlags: (p.hard_risk_flags ?? []) as string[],
      reviewHours: effort?.review_hours ?? null, materialityScore: p.materiality_score,
      mutuallyExclusiveWith: ((p.mutually_exclusive_with ?? []) as unknown[]).filter((m): m is string => typeof m === 'string'),
      dependencies: ((p.dependencies ?? []) as unknown[]).filter((d): d is string => typeof d === 'string'),
    };
  }), [priorities, efforts]);

  const candidatePortfolio = useMemo(() => buildPriorityPortfolio({ priorities: portfolioInputs, availableReviewHours: latestCapacity?.available_hours ?? null, strategy: 'hard_risk_first_reference' }), [portfolioInputs, latestCapacity]);

  const hardRiskCoverage = useMemo(() => evaluateHardRiskCoverage({ priorities: portfolioInputs, includedCodes: candidatePortfolio.included, exclusionReasons: null }), [portfolioInputs, candidatePortfolio]);

  const mutexConflicts = useMemo(() => detectMutuallyExclusivePriorities(portfolioInputs.map((p) => ({ code: p.code, mutuallyExclusiveWith: p.mutuallyExclusiveWith })), candidatePortfolio.included), [portfolioInputs, candidatePortfolio]);

  const feasibility = useMemo(() => evaluatePortfolioFeasibility({
    totalReviewHours: candidatePortfolio.totalReviewHours,
    availableReviewHours: latestCapacity?.available_hours ?? null,
    hardRiskCoverage: { covered: hardRiskCoverage.covered, silentlyExcluded: hardRiskCoverage.silentlyExcluded },
    resourceConflicts: [], scheduleConflicts: [],
    mutexConflicts: mutexConflicts.conflicts.map((c) => `${c.a}↔${c.b}`),
    blockingDependencies: [],
  }), [candidatePortfolio, latestCapacity, hardRiskCoverage, mutexConflicts]);

  const capacityConflict = useMemo(() => detectCapacityConflict({
    requiredRoles: ['admin'],
    sharedRoleUsage: adminCount != null ? { admin: priorities.filter((p) => PENDING_PRIORITY_STATUSES.includes(p.priority_status)).length } : null,
    roleLimit: 5,
  }), [adminCount, priorities]);

  const scheduleConflictSample = useMemo(() => detectScheduleConflict(null, null), []);   // 기간 데이터 없음(실측) → insufficient

  const deferrals = useMemo(() => candidatePortfolio.excluded.map((e) => ({
    excludedItem: e,
    candidate: buildPriorityDeferralCandidate({ code: e.code, reason: e.why.includes('Capacity') ? 'capacity_conflict' : 'lower_materiality', riskIfDeferred: null, financialExposure: null, evidence: [e.why] }),
  })), [candidatePortfolio]);

  const loadBalancing = useMemo(() => buildExecutiveLoadBalancingCandidate({
    singleRoleOverload: decisionLoad.verdict === 'overloaded_candidate' || decisionLoad.verdict === 'critical_decision_load',
    singleApprover: adminCount === 1,
    missingBackup: true,   // Backup Owner Reference 부재(실측)
    meetingOverload: false,
    capacityDataAvailable: latestCapacity?.available_hours != null,
  }), [decisionLoad, adminCount, latestCapacity]);

  const simulations = useMemo(() => ['Portfolio A(현재 후보)', 'Capacity 20% 감소 Reference', 'No Action'].map((scenario, idx) => simulatePortfolioDecision({
    scenario,
    totalReviewHours: idx === 2 ? 0 : candidatePortfolio.totalReviewHours,
    availableReviewHours: latestCapacity?.available_hours ?? null,
    capacityReductionPct: idx === 1 ? 20 : 0,
    hardRiskCovered: idx === 2 ? hardRiskCoverage.uncovered.length === 0 : hardRiskCoverage.silentlyExcluded.length === 0,
    evidenceBased: priorities.length > 0,
  })), [candidatePortfolio, latestCapacity, hardRiskCoverage, priorities]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string; severity: string }[] = [];
    const push = (r: ReturnType<typeof buildExecutiveCapacityRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason, severity: r.severity }); };
    if (latestCapacity?.available_hours == null) push(buildExecutiveCapacityRecommendation({ type: 'request_capacity_data', reason: 'Calendar/Working Hours 데이터 없음(실측) — 가용 시간 수동 기록 필요', evidence: ['capacity_scan(0519)'], severity: 'high', capacityImpact: null, riskIfDeferred: null }));
    const p0 = priorities.filter((p) => p.priority_tier === 'P0_human_review_now' && PENDING_PRIORITY_STATUSES.includes(p.priority_status)).length;
    if (p0 > 0) push(buildExecutiveCapacityRecommendation({ type: 'prioritize_hard_risk_review', reason: `P0 ${p0}건 사람 검토 대기`, evidence: [`p0_pending:${p0}`], severity: 'critical', capacityImpact: null, riskIfDeferred: null }));
    if (adminCount === 1) push(buildExecutiveCapacityRecommendation({ type: 'add_backup_owner_reference', reason: '단일 Admin 의존(실측) — Backup Owner 부재', evidence: ['users.role=admin 실측'], severity: 'high', capacityImpact: null, riskIfDeferred: null }));
    if (overdue.length > 0) push(buildExecutiveCapacityRecommendation({ type: 'review_overdue_priority', reason: `deadline 경과 Priority ${overdue.length}건`, evidence: overdue.slice(0, 3).map(({ p }) => p.priority_code), severity: 'high', capacityImpact: null, riskIfDeferred: null }));
    return out;
  }, [latestCapacity, priorities, adminCount, overdue]);

  const outcomeLinks = useMemo(() => portfolios.filter((p) => p.review_status === 'selected_reference').map((p) => ({
    p,
    link: buildPortfolioOutcomeLink({ portfolioCode: p.portfolio_code, decisionMemoryRef: null, observationClosed: null, evidence: [p.portfolio_code] }),
  })), [portfolios]);

  const healthScore = useMemo(() => calculateCapacityHealthScore({
    utilizationScore: utilization.utilizationPct == null ? null : 100 - Math.min(100, utilization.utilizationPct),
    loadScore: decisionLoad.verdict === 'manageable_reference' ? 80 : decisionLoad.verdict === 'elevated_load' ? 50 : decisionLoad.verdict === 'insufficient_data' ? null : 20,
    dependencyScore: adminCount == null ? null : adminCount > 1 ? 60 : 20,
    agingScore: agingAnalysis.length ? Math.max(0, 100 - overdue.length * 25) : null,
  }), [utilization, decisionLoad, adminCount, agingAnalysis, overdue]);

  if (loading) return <AdminCard title="Enterprise Executive Capacity & Priority Portfolio Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Executive Capacity & Priority Portfolio Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const parsedHours = hoursInput.trim() === '' ? null : Number(hoursInput);

  return (
    <AdminCard
      title="Enterprise Executive Capacity & Priority Portfolio Center"
      subtitle="Capacity→Effort→Aging→Exposure/ROI→Portfolio→Feasibility→사람 선택 — 시간 자료 없으면 unknown·Portfolio ≠ 실행 계획·Hard Risk 조용한 제외 금지"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Priority 선택/제외/승격/강등, 자동 일정·캘린더·회의 생성, 자동 업무 할당/인력 배치/채용/해고, 자동 예산 배정/지출/투자, 자동 가격/계약/정산/정책/플레이리스트/서버 변경, 자동 보고서 발송, 자동 Executive Decision, 자동 Confidence/Weight/Prompt 수정, 자동 모델 학습, Merge/Deploy/Migration/Production Apply 는 없습니다. Financial Exposure 는 실제 회계 손실이 아니고 Opportunity ROI 는 실제 투자수익률이 아닙니다. Portfolio 는 실제 업무 계획이 아니며 모든 조합을 검토하지 않았으므로 optimal 을 주장하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Executive Capacity" value={capacityVerdict.status} />
            <Box label="Decision Load" value={decisionLoad.verdict} />
            <Box label="Utilization" value={utilization.utilizationPct == null ? utilization.verdict : `${utilization.utilizationPct}% (${utilization.verdict})`} />
            <Box label="Capacity Health(참고)" value={healthScore.score == null ? 'insufficient_data' : String(healthScore.score)} />
            <Box label="P0 대기" value={NUM(typeof actuals.p0_pending === 'number' ? actuals.p0_pending : null)} />
            <Box label="Pending Priorities" value={NUM(typeof actuals.pending_priorities === 'number' ? actuals.pending_priorities : null)} />
            <Box label="Overdue" value={NUM(overdue.length)} />
            <Box label="Aging Snapshots" value={NUM(agingRows.length)} />
            <Box label="Effort 미검증" value={NUM(summary.effort_unverified as number)} />
            <Box label="Exposure Unknown" value={NUM(summary.exposure_unknown as number)} />
            <Box label="Portfolios" value={NUM(portfolios.length)} />
            <Box label="Hard Risk Uncovered" value={NUM(hardRiskCoverage.silentlyExcluded.length)} />
            <Box label="단일 Admin 의존" value={adminCount == null ? '—' : adminCount <= 1 ? '있음(실측)' : '없음'} />
            <Box label="Calendar 데이터" value={String(actuals.calendar_data ?? 'executive_capacity_unknown')} />
            <Box label="Budget 시스템" value={String(actuals.budget_system ?? 'financial_exposure_unknown')} />
            <Box label="자동 Priority 선택" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 실측: MRR {NUM(mrr)}원 · Admin {NUM(adminCount)}명 · Working Hours/Team Capacity/조직도/현금흐름 데이터 없음(정직 표기)</p>
        </div>
      )}

      {/* ── Executive Capacity / Snapshots ── */}
      {tab === 'execcapacity' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={capacityVerdict.status === 'executive_capacity_unknown' ? 'warning' : capacityVerdict.status === 'available_reference' ? 'success' : 'danger'}>{capacityVerdict.status}</AdminBadge>
            <span className="ml-2 text-muted-foreground">{capacityVerdict.note} · 성과 평가 아님</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="주간 가용 시간(선택 — 비우면 unknown)" className="w-56 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0)) { toast.error('시간은 0 이상 숫자'); return; }
              void act(() => createExecCapacitySnapshot({ code: `ecap_${now.toISOString().slice(0, 19)}`, scope: 'executive_team', domain: 'executive', evidence: [{ label: 'note', value: r.slice(0, 100) }], availableHours: parsedHours, currentPriorities: priorities.filter((p) => PENDING_PRIORITY_STATUSES.includes(p.priority_status)).length, status: parsedHours == null ? 'executive_capacity_unknown' : 'available_reference' }), 'Capacity Snapshot 기록(임의 생성 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Capacity Snapshot 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="근거 메모(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <AdminAlert tone="info" description="실제 Calendar/Working Hours 데이터가 없어(실측) 가용 시간은 수동 입력 시에만 판정됩니다. 입력이 없으면 executive_capacity_unknown 을 유지합니다." />
        </div>
      )}
      {tab === 'capsnapshots' && (
        !capSnapshots.length ? <AdminEmpty title="Snapshot 없음" description="시간 자료 없이 Capacity 를 임의 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {capSnapshots.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.snapshot_code}</span>
                <AdminBadge tone={s.capacity_status === 'executive_capacity_unknown' ? 'warning' : 'info'}>{s.capacity_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{s.capacity_domain} · 가용 {s.available_hours == null ? 'unknown' : `${s.available_hours}h`} · 예약 {s.reserved_hours == null ? '—' : `${s.reserved_hours}h`} · Priority {NUM(s.current_priority_count)}건</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Decision Load / Utilization ── */}
      {tab === 'decisionload' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={decisionLoad.verdict === 'critical_decision_load' ? 'danger' : decisionLoad.verdict === 'manageable_reference' ? 'success' : 'warning'}>{decisionLoad.verdict}</AdminBadge>
            <p className="mt-1 text-muted-foreground">{decisionLoad.reasons.length ? decisionLoad.reasons.join(' · ') : '알려진 과부하 없음'}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">Capacity 부족은 Priority 중요도 부족으로 해석하지 않습니다.</p>
        </div>
      )}
      {tab === 'utilization' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Utilization" value={utilization.utilizationPct == null ? '계산 불가' : `${utilization.utilizationPct}%`} />
            <Box label="판정" value={utilization.verdict} />
            <Box label="가용 시간" value={latestCapacity?.available_hours == null ? 'unknown' : `${latestCapacity.available_hours}h`} />
            <Box label="예약 시간" value={latestCapacity?.reserved_hours == null ? '—' : `${latestCapacity.reserved_hours}h`} />
          </div>
          <AdminAlert tone="info" description="Available Capacity 가 없으면 Utilization 을 계산하지 않습니다(가짜 비율 금지)." />
        </div>
      )}

      {/* ── Effort ── */}
      {tab === 'effort' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="검토 시간(h)" className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !priorities.length} onClick={() => {
              const r = needReason(); if (!r) return;
              if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0)) { toast.error('시간은 0 이상 숫자'); return; }
              void act(() => createPriorityEffort({ code: `eff_${now.toISOString().slice(0, 19)}`, priorityId: priorities[0].id, domain: priorities[0].priority_domain, evidence: [{ label: 'note', value: r.slice(0, 100) }], reviewHours: parsedHours }), 'Effort Estimate 기록(수동 추정)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Priority Effort 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="추정 근거(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!effortAnalysis.length ? <AdminEmpty title="Effort 없음" description="0518 Priority 에 effort 필드가 없어(실측) 수동/Reference 추정만 가능합니다. null 은 0 으로 합산하지 않습니다." /> : effortAnalysis.map(({ e, calc }) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{e.estimate_code}</span>
              <AdminBadge tone={calc.status === 'effort_unverified' ? 'warning' : 'info'}>{calc.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">검토 {calc.reviewTotalHours == null ? 'unknown' : `${calc.reviewTotalHours}h`} · 실행 {calc.executionTotalHours == null ? 'unknown' : `${calc.executionTotalHours}h`} · 누락: {calc.missing.join(',') || '없음'}</span>
            </div>
          ))}
        </div>
      )}
      {(tab === 'revieweffort' || tab === 'decisioneffort' || tab === 'meetingload') && (() => {
        const field = tab === 'revieweffort' ? 'review_hours' : tab === 'decisioneffort' ? 'decision_hours' : 'meeting_hours';
        const label = tab === 'revieweffort' ? '검토' : tab === 'decisioneffort' ? '결정' : '회의';
        const known = efforts.filter((e) => (e as unknown as Record<string, number | null>)[field] != null);
        const total = known.reduce((s, e) => s + ((e as unknown as Record<string, number | null>)[field] ?? 0), 0);
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Box label={`${label} 시간 기록 건수`} value={NUM(known.length)} />
              <Box label={`${label} 시간 합계(기록분만)`} value={known.length ? `${total}h` : 'unknown(0 아님)'} />
              <Box label="미기록" value={NUM(efforts.length - known.length)} />
            </div>
            <p className="text-[10px] text-muted-foreground">{tab === 'meetingload' ? '실제 회의 시스템이 없어(실측) 수동 기록 기반입니다. 의사결정 회의와 실행 시간을 혼동하지 않습니다.' : '미기록 항목은 합계에서 0 으로 처리하지 않습니다.'}</p>
          </div>
        );
      })()}

      {/* ── Aging / Overdue ── */}
      {tab === 'aging' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !priorities.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const top = agingAnalysis[0];
              void act(() => createAgingSnapshot({ code: `age_${now.toISOString().slice(0, 19)}`, priorityId: top.p.id, evidence: [{ label: 'note', value: r.slice(0, 100) }], status: top.status.status, daysToDeadline: top.aging.daysToDeadline }), 'Aging Snapshot 기록(자동 승격 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Priority Aging 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!agingAnalysis.length ? <AdminEmpty title="Priority 없음" description="Aging 은 잘못된 의사결정 단정이 아니며 자동 승격하지 않습니다." /> : agingAnalysis.slice(0, 30).map(({ p, aging, status }) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{p.priority_code}</span>
              <AdminBadge tone={status.status.includes('overdue') ? 'danger' : status.status === 'aging_threshold_unverified' ? 'warning' : 'neutral'}>{status.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">age {aging.ageDays == null ? '—' : `${Math.round(aging.ageDays)}일`} · D{aging.daysToDeadline == null ? '—' : Math.round(aging.daysToDeadline)} · {status.note}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">운영 Aging Threshold 미정(실측) — deadline 기반 외에는 aging_threshold_unverified 를 유지합니다.</p>
        </div>
      )}
      {tab === 'overdue' && (
        !overdue.length ? <AdminEmpty title="Overdue 없음" description="deadline 경과 Priority 가 없습니다." /> : (
          <div className="space-y-1">
            {overdue.map(({ p, aging, status }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.priority_code}</span>
                <AdminBadge tone="danger">{status.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{p.title} · deadline {Math.abs(Math.round(aging.daysToDeadline ?? 0))}일 경과 — 사람 검토 필요(자동 승격 없음)</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Exposure / Delay Cost / ROI / Non-Financial ── */}
      {tab === 'delayexposure' && (
        !exposureAnalysis.length ? <AdminEmpty title="Exposure 없음" description="비용 자료 없이 Delay Exposure 를 임의 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {exposureAnalysis.map(({ x, delay }) => (
              <div key={x.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{x.exposure_code}</span>
                <AdminBadge tone={delay.verdict.includes('critical') || delay.verdict.includes('high') ? 'danger' : delay.verdict === 'causality_unverified' || delay.verdict === 'financial_exposure_unknown' ? 'warning' : 'neutral'}>{delay.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">MRR 대비 상대 평가 — 실제 손실 아님</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'finexposure' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="예상 금액(KRW, 선택)" className="w-44 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !priorities.length} onClick={() => {
              const r = needReason(); if (!r) return;
              if (parsedHours != null && !Number.isFinite(parsedHours)) { toast.error('금액은 숫자'); return; }
              void act(() => createFinancialExposure({ code: `fex_${now.toISOString().slice(0, 19)}`, priorityId: priorities[0].id, type: 'revenue_at_risk', evidence: [{ label: 'note', value: r.slice(0, 100) }], expected: parsedHours, verification: 'assumption_based' }), 'Exposure 기록(회계 손실 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Priority Exposure 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="산정 근거(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!exposureAnalysis.length ? <AdminEmpty title="Exposure 없음" description="Financial Exposure 는 추정 Reference 이며 실제 회계 손실이 아닙니다." /> : exposureAnalysis.map(({ x, calc }) => (
            <div key={x.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{x.exposure_code}</span>
              <AdminBadge tone="info">{x.exposure_type}</AdminBadge>
              <AdminBadge tone={x.verification_status === 'financial_exposure_unknown' ? 'warning' : 'neutral'}>{x.verification_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">기대 {calc.expectedExposure == null ? 'unknown(0 아님)' : `${NUM(calc.expectedExposure)}원`} · 범위 {calc.range.low == null ? '—' : NUM(calc.range.low)}~{calc.range.high == null ? '—' : NUM(calc.range.high)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'delaycost' && (
        !delayCosts.length ? <AdminEmpty title="계산 대상 없음" description="Exposure/Delay Factor/Time/인과 근거가 전부 있을 때만 계산합니다(가짜 수치 금지)." /> : (
          <div className="space-y-1">
            {delayCosts.map(({ x, cost }) => (
              <div key={x.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{x.exposure_code}</span>
                <AdminBadge tone={cost.status === 'delay_cost_estimated_reference' ? 'info' : 'warning'}>{cost.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{cost.cost == null ? 'Delay Factor/Time/인과 미상 — 계산 안 함' : `${NUM(cost.cost)}원(추정 Reference)`}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'roi' && (
        <div className="space-y-2">
          {!roiAnalysis.length ? <AdminEmpty title="Opportunity 없음" description="Expected Cost 가 0 또는 null 이면 ROI 를 계산하지 않습니다." /> : roiAnalysis.map(({ x, roi }) => (
            <div key={x.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{x.exposure_code}</span>
              <AdminBadge tone={roi.verdict === 'roi_unavailable' ? 'warning' : 'info'}>{roi.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{roi.roiPct == null ? 'Cost 자료 없음(실측) — 계산 금지' : `${roi.roiPct}% (실제 투자수익률 아님)`}</span>
            </div>
          ))}
          <AdminAlert tone="info" description="Budget/원가 시스템이 없어(실측) Expected Cost 미상 → roi_unavailable 이 기본입니다." />
        </div>
      )}
      {tab === 'nonfinvalue' && (
        !nonFinValue.items.length ? <AdminEmpty title="비금전 가치 후보 없음" description="금액 환산 근거가 없으면 qualitative_reference 로만 표시합니다." /> : (
          <div className="space-y-1">
            {nonFinValue.items.map((v, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{v.kind}</AdminBadge>
                <AdminBadge tone="neutral">{v.label}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{v.rationale} · 금액 환산 없음</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Confidence Drift ── */}
      {tab === 'drift' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="현재 confidence(0~100)" className="w-44 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !priorities.length} onClick={() => {
              const r = needReason(); if (!r) return;
              if (parsedHours == null || !Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 100) { toast.error('confidence 0~100 필수'); return; }
              void act(() => createConfidenceDriftSnapshot({ code: `cdr_${now.toISOString().slice(0, 19)}`, priorityId: priorities[0].id, confidence: parsedHours, source: 'manual_review', evidence: [{ label: 'note', value: r.slice(0, 100) }], reason: r }), 'Confidence Snapshot 기록(자동 수정 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Priority Confidence 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!driftAnalysis.length ? <AdminEmpty title="Drift 분석 대상 없음" description="Snapshot 표본<3 이면 drift 를 판정하지 않습니다." /> : driftAnalysis.map(({ pid, drift, status }) => (
            <div key={pid} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{priorities.find((p) => p.id === pid)?.priority_code ?? pid.slice(0, 8)}</span>
              <AdminBadge tone={status.status === 'decreasing_candidate' || status.status === 'volatile_candidate' ? 'warning' : 'neutral'}>{status.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">표본 {drift.sampleSize} · 초기 대비 {drift.driftFromInitial == null ? '—' : drift.driftFromInitial} · 변동성 {drift.volatility ?? '—'} · Confidence 감소 ≠ 자동 폐기</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'drifthistory' && (
        !driftRows.length ? <AdminEmpty title="Confidence 이력 없음" description="Snapshot 은 덮어쓰지 않고 누적됩니다." /> : (
          <div className="space-y-1">
            {driftRows.slice(0, 40).map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{d.snapshot_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="ml-2 font-bold">{d.confidence_value}</span>
                <AdminBadge tone="neutral">{d.drift_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">이전 대비 {d.drift_from_previous ?? '—'} · {d.confidence_source}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Organizational Dependencies ── */}
      {tab === 'orgdeps' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={orgDependency.verdict.includes('single') || orgDependency.verdict.includes('missing') ? 'danger' : orgDependency.verdict === 'organizational_dependency_unverified' ? 'warning' : 'success'}>{orgDependency.verdict}</AdminBadge>
            <p className="mt-1 text-muted-foreground">{orgDependency.findings.join(' · ') || '발견 사항 없음'} · 인사 평가 아님</p>
          </div>
          <AdminAlert tone="info" description="조직도/Team 테이블이 없어(실측) users.role=admin 실측과 수동 Reference 만 사용합니다. CEO/CTO/COO 의존성을 임의 생성하지 않습니다." />
        </div>
      )}
      {tab === 'singleperson' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone={singlePerson.verdict === 'concentration_candidate' ? 'danger' : 'neutral'}>{singlePerson.verdict}</AdminBadge>
          {singlePerson.concentrated.map((c) => <p key={c.person} className="mt-1 text-muted-foreground">{c.person} — Priority {c.count}건 집중(실측)</p>)}
          {!singlePerson.concentrated.length && <p className="mt-1 text-muted-foreground">집중 감지 없음 또는 자료 부재</p>}
        </div>
      )}
      {tab === 'singleapprover' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone={singleApprover.verdict === 'single_approver_dependency_candidate' ? 'danger' : singleApprover.verdict === 'organizational_dependency_unverified' ? 'warning' : 'success'}>{singleApprover.verdict}</AdminBadge>
          <p className="mt-1 text-muted-foreground">검토 이력 상 Approver {singleApprover.approverCount}명 — 단일 Approver 의존은 정상 상태로 단정하지 않습니다.</p>
        </div>
      )}
      {tab === 'missingowners' && (
        <div className="space-y-1">
          {priorities.slice(0, 30).map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{p.priority_code}</span>
              <AdminBadge tone="warning">owner_reference 부재(실측)</AdminBadge>
              <span className="ml-2 text-muted-foreground">0518 Priority 에 Owner 필드 없음 — External Action(reviewer_assigned_reference)으로 기록 가능</span>
            </div>
          ))}
          {!priorities.length && <AdminEmpty title="Priority 없음" description="Owner Reference 는 External Action 으로 기록합니다." />}
        </div>
      )}
      {tab === 'missingbackups' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone="danger">missing_backup_owner</AdminBadge>
          <p className="mt-1 text-muted-foreground">Backup Owner Reference 기록 없음(실측) — 단일 Admin 운영 구조에서 Backup 부재는 조직 의존성 위험 후보입니다(인사 평가 아님).</p>
        </div>
      )}

      {/* ── Portfolios ── */}
      {tab === 'portfolios' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !priorities.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const ids = priorities.filter((p) => candidatePortfolio.included.includes(p.priority_code)).map((p) => p.id);
              const excludedIds = priorities.filter((p) => candidatePortfolio.excluded.some((e) => e.code === p.priority_code)).map((p) => p.id);
              void act(() => createPriorityPortfolio({ code: `pf_${now.toISOString().slice(0, 19)}`, title: r.slice(0, 100), type: 'balanced', evidence: [{ label: 'strategy', value: 'hard_risk_first_reference' }], priorityIds: ids, excludedIds, reviewHours: candidatePortfolio.totalReviewHours, riskSummary: hardRiskCoverage.uncovered.map((u) => ({ code: u.code, flags: u.flags })), conflictSummary: mutexConflicts.conflicts as unknown as Array<Record<string, unknown>> }), 'Portfolio 후보 기록(자동 선택·optimal 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">현재 후보로 Portfolio 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Portfolio 제목(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!portfolios.length ? <AdminEmpty title="Portfolio 없음" description="Portfolio 는 실제 업무 계획이 아닙니다." /> : portfolios.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{p.portfolio_code}</span>
                <AdminBadge tone="info">{p.portfolio_type}</AdminBadge>
                <AdminBadge tone={p.feasibility_status === 'feasible_reference' ? 'success' : p.feasibility_status === 'hard_risk_uncovered' ? 'danger' : 'warning'}>{p.feasibility_status}</AdminBadge>
                <AdminBadge tone={p.review_status === 'selected_reference' ? 'success' : 'neutral'}>{p.review_status}</AdminBadge>
                {(p.warnings ?? []).length > 0 && <AdminBadge tone="warning">warnings {p.warnings.length}</AdminBadge>}
              </div>
              <p className="mt-1">{p.title} · 포함 {p.priority_candidate_ids.length} / 제외 {p.excluded_priority_ids.length} · 검토 {p.total_review_hours == null ? 'unknown' : `${p.total_review_hours}h`}</p>
              {!['rejected', 'invalidated'].includes(p.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['pending_executive_review', 'waiting_capacity', 'selected_reference', 'deferred_reference', 'rejected'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewPriorityPortfolio(p.id, st, rr), `${st}(실행 확정 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'candidates' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">자동 생성 후보(hard_risk_first_reference) — 자동 선택 아님</p>
            <p className="mt-1">포함: {candidatePortfolio.included.join(', ') || '—'}</p>
            <p>검토 시간 합계: {candidatePortfolio.totalReviewHours == null ? 'unknown(Effort 미상)' : `${candidatePortfolio.totalReviewHours}h`}</p>
          </div>
          {candidatePortfolio.excluded.map((e) => (
            <div key={e.code} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{e.code}</span>
              <span className="ml-2 text-muted-foreground">제외 사유: {e.why}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">모든 조합을 검토하지 않았으므로 optimal 을 주장하지 않습니다(optimalClaimed=false).</p>
        </div>
      )}
      {tab === 'feasibility' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={feasibility.status === 'feasible_reference' ? 'success' : feasibility.status === 'hard_risk_uncovered' ? 'danger' : 'warning'}>{feasibility.status}</AdminBadge>
            <p className="mt-1 text-muted-foreground">{feasibility.reasons.join(' · ') || '충돌/초과 없음'} · 실행 계획 아님</p>
          </div>
          <AdminAlert tone="info" description="가용 시간 자료가 없으면 feasible 로 단정하지 않습니다(executive_capacity_unknown)." />
        </div>
      )}
      {tab === 'hardrisk' && (
        <div className="space-y-1">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={hardRiskCoverage.covered ? 'success' : 'danger'}>{hardRiskCoverage.covered ? 'hard_risk_covered' : 'hard_risk_uncovered'}</AdminBadge>
            <span className="ml-2 text-muted-foreground">P0/Hard Risk Priority 전수 확인 — 조용한 제외 시 feasible 서버 차단</span>
          </div>
          {hardRiskCoverage.uncovered.map((u) => (
            <div key={u.code} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{u.code}</span>
              <AdminBadge tone="danger">{u.flags.join(',') || 'P0'}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{hardRiskCoverage.silentlyExcluded.includes(u.code) ? '사유 없이 제외됨 — feasible 금지' : '명시 사유 제외'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Conflicts ── */}
      {tab === 'capconflicts' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone={capacityConflict.verdict === 'resource_conflict' ? 'danger' : capacityConflict.verdict === 'insufficient_data' ? 'warning' : 'success'}>{capacityConflict.verdict}</AdminBadge>
          <p className="mt-1 text-muted-foreground">{capacityConflict.overloadedRoles.length ? `과부하 Role: ${capacityConflict.overloadedRoles.join(', ')}` : 'Role 자료 부재 또는 과부하 없음'} · 충돌은 자동 제거하지 않습니다</p>
        </div>
      )}
      {tab === 'resourceconf' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone={capacityConflict.verdict === 'resource_conflict' ? 'danger' : 'neutral'}>{capacityConflict.verdict}</AdminBadge>
          <p className="mt-1 text-muted-foreground">동일 자원(Admin 검토 시간) 동시 점유 기준 — 같은 사람이 여러 Priority 에 100% 동시 배정 가능하다고 가정하지 않습니다.</p>
        </div>
      )}
      {tab === 'schedconf' && (
        <div className="rounded-lg border border-border p-2 text-[11px]">
          <AdminBadge tone="warning">{scheduleConflictSample.verdict}</AdminBadge>
          <p className="mt-1 text-muted-foreground">실제 Calendar/기간 데이터 없음(실측) — 기간 입력이 있는 경우에만 Schedule Conflict 를 판정합니다.</p>
        </div>
      )}
      {tab === 'mutex' && (
        !mutexConflicts.conflicts.length ? <AdminEmpty title="상호 배타 충돌 없음" description="동시 포함 시 conflict 를 반환하며 자동 제거하지 않습니다." /> : (
          <div className="space-y-1">
            {mutexConflicts.conflicts.map((c) => (
              <div key={`${c.a}-${c.b}`} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="danger">mutually_exclusive_conflict</AdminBadge>
                <span className="ml-2 font-mono">{c.a} ↔ {c.b}</span>
                <span className="ml-2 text-muted-foreground">자동 제거 없음 — 사람 결정 필요</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Deferrals / Load Balancing / Simulations ── */}
      {tab === 'deferrals' && (
        !deferrals.length ? <AdminEmpty title="Deferral 후보 없음" description="자동 Deferred 상태 변경은 없습니다." /> : (
          <div className="space-y-1">
            {deferrals.map(({ excludedItem, candidate }) => (
              <div key={excludedItem.code} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{excludedItem.code}</span>
                {'insufficient' in candidate ? <AdminBadge tone="warning">{candidate.why}</AdminBadge> : (
                  <><AdminBadge tone="info">{candidate.reason}</AdminBadge><span className="ml-2 text-muted-foreground">{candidate.riskIfDeferred} · Exposure {candidate.financialExposure == null ? 'unknown(0 아님)' : NUM(candidate.financialExposure)}</span></>
                )}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'loadbalancing' && (
        <div className="space-y-1">
          {loadBalancing.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="info">{l.type}</AdminBadge>
              <span className="ml-2 text-muted-foreground">권고만 — 실제 업무 할당 없음(workAssigned=false)</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'simulations' && (
        <div className="space-y-1">
          {simulations.map((s) => (
            <div key={s.scenario} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.scenario}</span>
              <AdminBadge tone={s.verdict === 'feasible_candidate' ? 'success' : s.verdict.includes('unverified') || s.verdict === 'insufficient_data' ? 'warning' : 'danger'}>{s.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">counterfactual — 자동 실행 없음</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">고정 수치를 운영 사실로 사용하지 않으며 입력/Evidence 기반 값만 사용합니다.</p>
        </div>
      )}

      {/* ── Recommendations / Outcomes ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={r.severity === 'critical' ? 'danger' : 'info'}>{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'outcomes' && (
        !outcomeLinks.length ? <AdminEmpty title="Outcome 연결 대상 없음" description="selected_reference Portfolio 가 생기면 Decision Memory(0514) 연결 후보가 표시됩니다. 연결 ≠ 인과." /> : (
          <div className="space-y-1">
            {outcomeLinks.map(({ p, link }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.portfolio_code}</span>
                {'insufficient' in link ? <AdminBadge tone="warning">{link.why}</AdminBadge> : (<><AdminBadge tone="neutral">{link.linkStatus}</AdminBadge><span className="ml-2 text-muted-foreground">causallyAttributed=false</span></>)}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Human Reviews / External / Audit / Support ── */}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['portfolio_review_started', 'portfolio_selected_reference', 'portfolio_deferred_reference'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Portfolio 선택은 사람 검토를 통해서만 이뤄집니다." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordExecCapacityExternalAction(extAction, r, [{ label: 'note', value: r.slice(0, 200) }]), '외부 Capacity 활동 기록(Calendar/인력/예산 미변경)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">외부 활동 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="활동 내용(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {(() => { const ext = audit.filter((e) => e.event_type === 'external_capacity_action_recorded'); return !ext.length ? <AdminEmpty title="외부 활동 없음" description="회의 예약/담당 지정/예산 확보 등은 참조 기록만 합니다." /> : ext.slice(0, 30).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
          )); })()}
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="모든 기록/검토가 이벤트로 남습니다(17종 whitelist). Event 는 실행 완료가 아닙니다." /> : (
          <div className="space-y-1">
            {audit.slice(0, 60).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {CAPACITY_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.label}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
