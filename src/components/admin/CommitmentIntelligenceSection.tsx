/**
 * CommitmentIntelligenceSection — Enterprise Commitment Intelligence,
 * Strategic Execution Assurance & Accountability Center (Phase AI-OPS-17).
 *
 * Selected Priority/Portfolio → Commitment → Ownership → Success Criteria/Milestone →
 * Execution Evidence → Progress/Blocker/Dependency → Delivery Confidence/Risk →
 * Completion Verification → Outcome Readiness → Accountability → Audit.
 * 선택 ≠ 실행 · Owner Reference ≠ 책임 수락 · Reported ≠ Verified Progress ·
 * 완료 ≠ Outcome · Accountability ≠ 인사 평가 · 자동 업무/일정/완료 처리 없음.
 *
 * 탭 41개(스펙 42절 전체).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Briefcase, Calendar, CheckCircle2, Clock, FileText, GitBranch,
  Grid3x3, History, Layers, Lightbulb, Link2, ListChecks, Lock, RefreshCw, Scale, ScrollText,
  Shield, Target, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchCommitmentSummary, createCommitment, reviewCommitment, setCommitmentOwnership,
  fetchCommitments, createCommitmentMilestone, reviewCommitmentMilestone, fetchCommitmentMilestones,
  createCommitmentProgress, fetchCommitmentProgress, createCommitmentBlocker, reviewCommitmentBlocker,
  fetchCommitmentBlockers, reportCommitmentCompletion, reviewCommitmentCompletion,
  fetchCompletionReviews, recordCommitmentGovernance, recordCommitmentExternalAction,
  fetchCommitmentAudit, fetchExecPriorities,
  type CommitmentSummary, type CommitmentRow, type CommitmentMilestoneRow, type CommitmentProgressRow,
  type CommitmentBlockerRow, type CompletionReviewRow, type CommitmentEventRow, type ExecPriorityRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateOwnershipVerification, validateOwnershipAcknowledgement, evaluateSuccessCriteria,
  evaluateMilestoneEvidence, calculateReportedProgress, calculateVerifiedProgress,
  classifyProgressStatus, calculateBlockerImpact, evaluateDependencyReadiness,
  calculateScheduleVariance, detectScopeDrift, calculateCommitmentAging, calculateDeliveryConfidence,
  calculateCommitmentRisk, evaluateCompletionVerification, evaluateOutcomeReadiness,
  evaluateAccountability, detectRepeatedCommitmentGap, buildCommitmentRecommendation,
  buildCommitmentOutcomeLink, buildCommitmentTimeline, COMMITMENT_SUPPORT,
  type ScheduleVariance, type ScopeDrift,
} from '@/lib/commitmentIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? 'null(0 아님)' : `${Math.round(n)}%`);

type Tab = 'overview' | 'commitments' | 'prioritycommits' | 'portfoliocommits' | 'ownership' | 'ownerack'
  | 'sponsors' | 'reviewers' | 'backups' | 'ownershipgaps' | 'criteria' | 'milestones' | 'msevidence'
  | 'progress' | 'reported' | 'verified' | 'blockers' | 'activeblockers' | 'blockerimpact'
  | 'dependencies' | 'depreadiness' | 'schedbaseline' | 'schedvariance' | 'scopebaseline' | 'scopedrift'
  | 'aging' | 'overdue' | 'confidence' | 'risk' | 'completionreports' | 'completionverify'
  | 'outcomereadiness' | 'accountability' | 'repeatedgaps' | 'recommendations' | 'outcomes'
  | 'humanreviews' | 'external' | 'timeline' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'commitments', label: 'Commitments', icon: Briefcase },
  { key: 'prioritycommits', label: 'Selected Priority Commitments', icon: Target },
  { key: 'portfoliocommits', label: 'Portfolio Commitments', icon: Target },
  { key: 'ownership', label: 'Ownership', icon: Users },
  { key: 'ownerack', label: 'Owner Acknowledgements', icon: CheckCircle2 },
  { key: 'sponsors', label: 'Sponsors', icon: Users },
  { key: 'reviewers', label: 'Reviewers', icon: Users },
  { key: 'backups', label: 'Backup Owners', icon: Users },
  { key: 'ownershipgaps', label: 'Ownership Gaps', icon: AlertTriangle },
  { key: 'criteria', label: 'Success Criteria', icon: ListChecks },
  { key: 'milestones', label: 'Milestones', icon: ListChecks },
  { key: 'msevidence', label: 'Milestone Evidence', icon: FileText },
  { key: 'progress', label: 'Progress Snapshots', icon: BarChart3 },
  { key: 'reported', label: 'Reported Progress', icon: BarChart3 },
  { key: 'verified', label: 'Verified Progress', icon: CheckCircle2 },
  { key: 'blockers', label: 'Blockers', icon: AlertTriangle },
  { key: 'activeblockers', label: 'Active Blockers', icon: AlertTriangle },
  { key: 'blockerimpact', label: 'Blocker Impact', icon: Scale },
  { key: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { key: 'depreadiness', label: 'Dependency Readiness', icon: GitBranch },
  { key: 'schedbaseline', label: 'Schedule Baseline', icon: Calendar },
  { key: 'schedvariance', label: 'Schedule Variance', icon: Clock },
  { key: 'scopebaseline', label: 'Scope Baseline', icon: FileText },
  { key: 'scopedrift', label: 'Scope Drift', icon: GitBranch },
  { key: 'aging', label: 'Commitment Aging', icon: History },
  { key: 'overdue', label: 'Overdue Commitments', icon: AlertTriangle },
  { key: 'confidence', label: 'Delivery Confidence', icon: TrendingUp },
  { key: 'risk', label: 'Commitment Risk', icon: Shield },
  { key: 'completionreports', label: 'Completion Reports', icon: FileText },
  { key: 'completionverify', label: 'Completion Verification', icon: CheckCircle2 },
  { key: 'outcomereadiness', label: 'Outcome Readiness', icon: Target },
  { key: 'accountability', label: 'Accountability Reviews', icon: Scale },
  { key: 'repeatedgaps', label: 'Repeated Commitment Gaps', icon: History },
  { key: 'recommendations', label: 'Commitment Recommendations', icon: Lightbulb },
  { key: 'outcomes', label: 'Commitment Outcomes', icon: Link2 },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Commitment Actions', icon: ScrollText },
  { key: 'timeline', label: 'Commitment Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_ACTIONS = ['owner_acknowledged_reference', 'sponsor_acknowledged_reference', 'reviewer_acknowledged_reference', 'work_started_reference', 'milestone_started_reference', 'milestone_completed_reference', 'blocker_reported_reference', 'blocker_resolved_reference', 'deadline_changed_reference', 'scope_changed_reference', 'completion_reported_reference', 'completion_verified_reference', 'outcome_observation_started_reference', 'commitment_cancelled_reference', 'manual_commitment_action_reference'];
const TERMINAL = ['cancelled_reference', 'invalidated', 'expired'];
const ACTIVE_BLOCKER = ['detected', 'pending_review', 'active_reference'];

export default function CommitmentIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<CommitmentSummary>({});
  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [milestones, setMilestones] = useState<CommitmentMilestoneRow[]>([]);
  const [progressRows, setProgressRows] = useState<CommitmentProgressRow[]>([]);
  const [blockers, setBlockers] = useState<CommitmentBlockerRow[]>([]);
  const [completions, setCompletions] = useState<CompletionReviewRow[]>([]);
  const [priorities, setPriorities] = useState<ExecPriorityRow[]>([]);
  const [audit, setAudit] = useState<CommitmentEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [refInput, setRefInput] = useState('');
  const [extAction, setExtAction] = useState(EXT_ACTIONS[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, co, ms, pr, bl, cr, pri, au] = await Promise.all([
        fetchCommitmentSummary(), fetchCommitments(null, 100), fetchCommitmentMilestones(null, 100),
        fetchCommitmentProgress(null, 100), fetchCommitmentBlockers(null, 100), fetchCompletionReviews(null, 100),
        fetchExecPriorities(null, 100), fetchCommitmentAudit(100),
      ]);
      setSummary(s); setCommitments(co); setMilestones(ms); setProgressRows(pr); setBlockers(bl);
      setCompletions(cr); setPriorities(pri); setAudit(au);
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

  /* ── 순수 로직 분석 ── */
  const actuals = useMemo(() => (summary.source_actuals ?? {}) as Record<string, number | string>, [summary]);

  const analysis = useMemo(() => commitments.map((c) => {
    const ownership = evaluateOwnershipVerification({
      owner: c.owner_reference, sponsor: c.sponsor_reference, reviewer: c.reviewer_reference,
      backup: c.backup_owner_reference, ownerAcknowledged: c.owner_acknowledged,
      sponsorAcknowledged: c.sponsor_acknowledged, reviewerAcknowledged: c.reviewer_acknowledged,
    });
    const criteria = evaluateSuccessCriteria((c.success_criteria as { metric: string | null; baseline: number | null; target: number | null; verificationMethod: string | null; qualitative: boolean }[]) ?? null);
    const cMilestones = milestones.filter((m) => m.commitment_id === c.id);
    const cBlockers = blockers.filter((b) => b.commitment_id === c.id);
    const activeBlockers = cBlockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status));
    const verified = calculateVerifiedProgress({ verifiedMilestones: cMilestones.filter((m) => m.milestone_status === 'verified_complete_reference').length, totalMilestones: cMilestones.length || null });
    const reported = calculateReportedProgress(progressRows.filter((p) => p.commitment_id === c.id).map((p) => ({ pct: p.reported_progress_percentage })));
    const progressStatus = classifyProgressStatus({ reported, verified, activeBlockers: activeBlockers.length, externallyStarted: c.commitment_status === 'externally_started_reference' || c.actual_start_reference_at != null, daysSinceLastEvidence: null });
    const deps = ((c.dependencies ?? []) as unknown[]).map((d) => (typeof d === 'string' ? { name: d, status: 'unknown' as const } : d as { name: string; status: 'ready' | 'waiting' | 'blocking' | 'unknown' }));
    const dependency = evaluateDependencyReadiness(c.dependencies == null ? null : deps);
    const aging = calculateCommitmentAging({ createdAt: new Date(c.created_at), targetAt: c.target_reference_at ? new Date(c.target_reference_at) : null, now, thresholds: null });
    const schedule = calculateScheduleVariance({ plannedAt: c.start_reference_at ? new Date(c.start_reference_at) : null, actualAt: c.actual_start_reference_at ? new Date(c.actual_start_reference_at) : null, baselineExists: c.start_reference_at != null });
    const scope = detectScopeDrift({ baselineExists: (c.success_criteria ?? []).length > 0, changes: [] });
    const hardBlocked = activeBlockers.some((b) => ['security', 'privacy', 'compliance'].includes(b.blocker_type) && (b.severity === 'critical' || b.severity === 'high'));
    const confidence = calculateDeliveryConfidence({
      ownershipScore: ownership.verification === 'verified_reference' ? 90 : ownership.verification === 'partially_verified' ? 60 : ownership.verification === 'owner_unverified' ? null : 40,
      criteriaScore: criteria.status === 'defined_reference' ? 90 : criteria.status === 'success_criteria_missing' ? 10 : 50,
      milestoneScore: cMilestones.length ? 70 : null,
      evidenceCoverage: (c.evidence ?? []).length ? 60 : null,
      dependencyScore: dependency.readiness === 'dependency_clear_reference' ? 90 : dependency.readiness === 'dependency_unverified' ? null : 40,
      blockerScore: activeBlockers.length === 0 ? 90 : Math.max(10, 90 - activeBlockers.length * 25),
      scheduleScore: schedule.verdict === 'on_reference_schedule' ? 90 : schedule.verdict === 'schedule_baseline_unverified' ? null : 50,
      hardRiskBlocked: hardBlocked,
    });
    const risk = calculateCommitmentRisk({
      ownershipGap: ownership.verification !== 'verified_reference',
      criteriaGap: criteria.status === 'success_criteria_missing',
      milestoneGap: cMilestones.length === 0,
      evidenceGap: (c.evidence ?? []).length === 0,
      activeBlockers: activeBlockers.length,
      dependencyDelay: dependency.readiness === 'waiting_dependency' || dependency.readiness === 'blocking_dependency',
      scheduleVariance: schedule.verdict as ScheduleVariance,
      scopeDrift: scope.drift as ScopeDrift,
      hardRisk: hardBlocked,
    });
    return { c, ownership, criteria, cMilestones, activeBlockers, reported, verified, progressStatus, dependency, aging, schedule, scope, confidence, risk };
  }), [commitments, milestones, blockers, progressRows, now]);

  const overdue = useMemo(() => analysis.filter(({ aging }) => aging.status === 'overdue_candidate' || aging.status === 'critical_overdue_candidate'), [analysis]);
  const ownershipGaps = useMemo(() => analysis.filter(({ ownership, c }) => ownership.verification !== 'verified_reference' && !TERMINAL.includes(c.commitment_status)), [analysis]);

  const milestoneEvidence = useMemo(() => milestones.map((m) => ({
    m,
    ev: evaluateMilestoneEvidence({ evidenceRequired: (m.evidence_required ?? []).length, evidenceProvided: (m.evidence ?? []).length, statusReported: m.milestone_status }),
  })), [milestones]);

  const blockerAnalysis = useMemo(() => blockers.map((b) => ({
    b,
    impact: calculateBlockerImpact({ milestonesAffected: b.milestone_id ? 1 : null, deadlineAtRisk: null, hardRisk: ['security', 'privacy', 'compliance'].includes(b.blocker_type) && b.severity === 'critical', financialExposureKrw: null, reversible: null }),
  })), [blockers]);

  const completionAnalysis = useMemo(() => completions.map((cr) => {
    const cAnalysis = analysis.find((a) => a.c.id === cr.commitment_id);
    return {
      cr,
      verdict: evaluateCompletionVerification({
        evidenceCount: (cr.completion_evidence ?? []).length,
        criteriaResultCount: (cr.success_criteria_results ?? []).length,
        criteriaTotal: (cAnalysis?.c.success_criteria ?? []).length,
        requiredMilestonesVerified: (cAnalysis?.cMilestones ?? []).every((m) => m.milestone_status === 'verified_complete_reference' || TERMINAL.includes(m.milestone_status)),
        criticalBlockersOpen: (cAnalysis?.activeBlockers ?? []).filter((b) => b.severity === 'critical').length,
        reviewerExists: Boolean(cr.reviewer_reference || cAnalysis?.c.reviewer_reference),
      }),
    };
  }), [completions, analysis]);

  const readinessAnalysis = useMemo(() => analysis.filter(({ c }) => ['completion_review_pending', 'verified_complete_reference', 'outcome_observation_pending'].includes(c.commitment_status)).map((a) => ({
    ...a,
    readiness: evaluateOutcomeReadiness({
      expectedOutcomeDefined: (a.c.success_criteria ?? []).length > 0,
      baselineExists: a.criteria.status !== 'baseline_unavailable' && a.criteria.status !== 'success_criteria_missing',
      metricDefined: a.criteria.definedCount > 0 || a.criteria.status === 'qualitative_reference',
      observationWindowDefined: false,   // Observation Plan 별도 정의 없음(실측) — Ready 금지
      dataSourceExists: true, reviewerExists: Boolean(a.c.reviewer_reference),
      executionEvidenceExists: audit.some((e) => e.event_type === 'external_commitment_action_recorded' && e.ref_id === a.c.id),
    }),
  })), [analysis, audit]);

  const accountabilityAnalysis = useMemo(() => analysis.map((a) => ({
    ...a,
    accountability: evaluateAccountability({
      ownerClear: Boolean(a.c.owner_reference), sponsorClear: Boolean(a.c.sponsor_reference),
      reviewerIndependent: Boolean(a.c.reviewer_reference) && a.c.reviewer_reference !== a.c.owner_reference,
      criteriaDefined: a.criteria.status !== 'success_criteria_missing',
      milestonesDefined: a.cMilestones.length > 0,
      evidenceCoverage: (a.c.evidence ?? []).length ? 60 : 0,
      blockersDisclosed: true, scopeChangesRecorded: true,
      completionVerified: a.c.commitment_status === 'verified_complete_reference' || a.c.commitment_status === 'outcome_observation_pending',
      outcomeObserved: false,
    }),
  })), [analysis]);

  const repeatedGaps = useMemo(() => detectRepeatedCommitmentGap(
    analysis.flatMap(({ c, ownership, criteria }) => {
      const out: { gapKind: string; commitmentCode: string }[] = [];
      if (ownership.verification === 'owner_unverified') out.push({ gapKind: 'owner_gap', commitmentCode: c.commitment_code });
      if (criteria.status === 'success_criteria_missing') out.push({ gapKind: 'criteria_gap', commitmentCode: c.commitment_code });
      if (c.commitment_status === 'completion_review_pending') out.push({ gapKind: 'completion_unverified_repeat', commitmentCode: c.commitment_code });
      return out;
    }),
  ), [analysis]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string; severity: string }[] = [];
    const push = (r: ReturnType<typeof buildCommitmentRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason, severity: r.severity }); };
    const noAck = analysis.filter(({ c }) => c.owner_reference && !c.owner_acknowledged && !TERMINAL.includes(c.commitment_status)).length;
    if (noAck > 0) push(buildCommitmentRecommendation({ type: 'request_owner_acknowledgement', reason: `Owner 미수락 Commitment ${noAck}건(Reference ≠ 수락)`, evidence: [`owner_ack_pending:${noAck}`], severity: 'high', riskIfDeferred: null }));
    const noCriteria = analysis.filter(({ criteria, c }) => criteria.status === 'success_criteria_missing' && !TERMINAL.includes(c.commitment_status)).length;
    if (noCriteria > 0) push(buildCommitmentRecommendation({ type: 'define_success_criteria', reason: `Success Criteria 없는 Commitment ${noCriteria}건 — 성공 판정 불가`, evidence: [`criteria_missing:${noCriteria}`], severity: 'high', riskIfDeferred: null }));
    const unverified100 = analysis.filter(({ progressStatus }) => progressStatus.status === 'completion_unverified').length;
    if (unverified100 > 0) push(buildCommitmentRecommendation({ type: 'verify_reported_progress', reason: `보고 100% 검증 미완 ${unverified100}건`, evidence: [`completion_unverified:${unverified100}`], severity: 'critical', riskIfDeferred: null }));
    const activeCnt = blockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status)).length;
    if (activeCnt > 0) push(buildCommitmentRecommendation({ type: 'review_active_blocker', reason: `Active Blocker ${activeCnt}건`, evidence: [`active_blockers:${activeCnt}`], severity: 'high', riskIfDeferred: null }));
    if (overdue.length > 0) push(buildCommitmentRecommendation({ type: 'review_schedule_variance', reason: `Deadline 경과 ${overdue.length}건(실패 확정 아님 — 검토 필요)`, evidence: overdue.slice(0, 3).map(({ c }) => c.commitment_code), severity: 'high', riskIfDeferred: null }));
    return out;
  }, [analysis, blockers, overdue]);

  const outcomeLinks = useMemo(() => analysis.filter(({ c }) => ['verified_complete_reference', 'outcome_observation_pending'].includes(c.commitment_status)).map(({ c }) => ({
    c,
    link: buildCommitmentOutcomeLink({ commitmentCode: c.commitment_code, decisionMemoryRef: null, completionVerified: true, observationClosed: null, evidence: [c.commitment_code] }),
  })), [analysis]);

  const timeline = useMemo(() => buildCommitmentTimeline(audit.map((e) => ({ at: new Date(e.created_at), kind: e.event_type, label: e.detail ?? e.event_type })), 50), [audit]);

  if (loading) return <AdminCard title="Enterprise Commitment Intelligence & Execution Assurance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Commitment Intelligence & Execution Assurance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const selectedPriority = priorities.find((p) => p.priority_status === 'accepted_reference');

  return (
    <AdminCard
      title="Enterprise Commitment Intelligence & Execution Assurance Center"
      subtitle="Commitment→Ownership→Criteria/Milestone→Progress/Blocker→Confidence/Risk→Completion→Outcome Readiness→Accountability — 선택 ≠ 실행·Reported ≠ Verified·완료 ≠ Outcome"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Commitment 생성/Owner·Sponsor·Reviewer 배정/업무 할당/일정 생성·변경/Deadline 변경/Milestone 생성/Progress 변경/완료 처리/Blocker 해제/Scope 변경/Escalation/독촉 발송/캘린더·회의 생성/인력 배치/채용·해고/예산/인사·성과 평가/Confidence·Weight 수정/모델 학습/Merge/Deploy/Migration/Production Apply 는 없습니다. Owner Reference 는 실제 책임 수락이 아니고, 자기보고 Progress 는 검증된 Progress 로 표시되지 않으며, 완료 보고는 Outcome 달성이 아닙니다. Accountability 는 인사 평가/징계 시스템이 아닙니다." />
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
            <Box label="Total Commitments" value={NUM(summary.commitments_total as number)} />
            <Box label="Owner 미수락" value={NUM(summary.waiting_owner_ack as number)} />
            <Box label="Owner Gaps" value={NUM(summary.owner_gaps as number)} />
            <Box label="Criteria Missing" value={NUM(summary.success_criteria_missing as number)} />
            <Box label="Milestones" value={NUM(summary.milestones_total as number)} />
            <Box label="Milestone 미검증" value={NUM(summary.milestones_unverified as number)} />
            <Box label="Active Blockers" value={NUM(summary.active_blockers as number)} />
            <Box label="Overdue" value={NUM(overdue.length)} />
            <Box label="Completion 검증 대기" value={NUM(summary.completion_reviews_pending as number)} />
            <Box label="Verified Complete" value={NUM(summary.verified_complete as number)} />
            <Box label="Accountability Gaps" value={NUM(accountabilityAnalysis.filter((a) => a.accountability.verdict === 'accountability_gap_candidate').length)} />
            <Box label="선택된 Priority(실측)" value={NUM(typeof actuals.selected_priorities === 'number' ? actuals.selected_priorities : null)} />
            <Box label="PM/Ticket 시스템" value={String(actuals.project_management_system ?? 'unsupported')} />
            <Box label="Calendar" value={String(actuals.calendar_integration ?? 'schedule_baseline_unverified')} />
            <Box label="자동 업무/완료 처리" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">HR/조직도/Working Day 정의 없음(실측) — Owner/Sponsor/Reviewer 는 Reference 기록이며 실제 인사 발령이 아닙니다.</p>
        </div>
      )}

      {/* ── Commitments ── */}
      {tab === 'commitments' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createCommitment({ code: `cmt_${now.toISOString().slice(0, 19)}`, domain: selectedPriority?.priority_domain ?? 'executive', type: selectedPriority ? 'priority_execution_reference' : 'manual', title: r.slice(0, 100), evidence: [{ label: 'source', value: selectedPriority?.priority_code ?? 'manual' }], priorityId: selectedPriority?.id ?? null }), 'Commitment 기록(업무 지시·실행 시작 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Commitment 생성{selectedPriority ? `(${selectedPriority.priority_code})` : '(manual)'}</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Commitment 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!analysis.length ? <AdminEmpty title="Commitment 없음" description="Priority 선택 ≠ 실행 시작 — Commitment 는 추적 기록입니다." /> : analysis.map(({ c, ownership, criteria, risk }) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone="info">{c.commitment_type}</AdminBadge>
                <AdminBadge tone={TERMINAL.includes(c.commitment_status) ? 'neutral' : c.commitment_status === 'verified_complete_reference' ? 'success' : 'warning'}>{c.commitment_status}</AdminBadge>
                <AdminBadge tone={ownership.verification === 'verified_reference' ? 'success' : 'warning'}>{ownership.verification}</AdminBadge>
                <AdminBadge tone={criteria.status === 'success_criteria_missing' ? 'danger' : 'neutral'}>{criteria.status}</AdminBadge>
                <AdminBadge tone={risk.level === 'critical' ? 'danger' : risk.level === 'low' ? 'success' : 'warning'}>risk: {risk.level}</AdminBadge>
                {(c.warnings ?? []).length > 0 && <AdminBadge tone="warning">warnings {c.warnings.length}</AdminBadge>}
              </div>
              <p className="mt-1">{c.title}</p>
              {!TERMINAL.includes(c.commitment_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['pending_review', 'waiting_evidence', 'reviewed_reference', 'at_risk_reference', 'cancelled_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCommitment(c.id, st, rr), st); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(tab === 'prioritycommits' || tab === 'portfoliocommits') && (() => {
        const items = analysis.filter(({ c }) => (tab === 'prioritycommits' ? c.priority_candidate_id != null : c.priority_portfolio_id != null));
        return !items.length ? <AdminEmpty title={tab === 'prioritycommits' ? 'Priority 연결 Commitment 없음' : 'Portfolio 연결 Commitment 없음'} description="0518/0519 선택 Reference 와 FK 로 연결됩니다(원본 미변경)." /> : (
          <div className="space-y-1">
            {items.map(({ c, progressStatus }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone="neutral">{progressStatus.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{c.title}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Ownership 계열 ── */}
      {tab === 'ownership' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="Owner Reference(이름/역할)" className="w-52 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !commitments.length} onClick={() => {
              const r = needReason(); if (!r) return;
              if (!refInput.trim()) { toast.error('Reference 필수'); return; }
              void act(() => setCommitmentOwnership({ id: commitments[0].id, role: 'owner', reference: refInput.trim(), reason: r }), 'Owner Reference 기록(실제 배정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Commitment Owner 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[160px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {analysis.map(({ c, ownership }) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{c.commitment_code}</span>
              <AdminBadge tone={ownership.verification === 'verified_reference' ? 'success' : 'warning'}>{ownership.verification}</AdminBadge>
              <span className="ml-2 text-muted-foreground">O: {c.owner_reference ?? '—'} / S: {c.sponsor_reference ?? '—'} / R: {c.reviewer_reference ?? '—'} / B: {c.backup_owner_reference ?? '—'}</span>
              {ownership.warnings.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{ownership.warnings.join(' · ')}</p>}
            </div>
          ))}
          {!analysis.length && <AdminEmpty title="Commitment 없음" description="역할은 Reference 기록이며 인사 발령이 아닙니다." />}
        </div>
      )}
      {tab === 'ownerack' && (
        <div className="space-y-2">
          {analysis.filter(({ c }) => c.owner_reference).map(({ c }) => {
            const ackCheck = validateOwnershipAcknowledgement({ acknowledged: c.owner_acknowledged, evidence: c.owner_acknowledged ? ['event'] : null });
            return (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={c.owner_acknowledged ? 'success' : 'warning'}>{c.owner_acknowledged ? 'acknowledged_reference' : '미수락(Reference ≠ 수락)'}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{ackCheck.why}</span>
                {!c.owner_acknowledged && !TERMINAL.includes(c.commitment_status) && (
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => setCommitmentOwnership({ id: c.id, role: 'owner', reference: c.owner_reference!, reason: rr, acknowledged: true, evidence: [{ label: 'ack', value: rr.slice(0, 100) }] }), 'Acknowledgement Reference 기록'); }} className="ml-2 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">수락 Reference 기록</button>
                )}
              </div>
            );
          })}
          {!analysis.some(({ c }) => c.owner_reference) && <AdminEmpty title="Owner Reference 없음" description="Acknowledgement Reference 없이 책임 수락으로 표시하지 않습니다." />}
          <div className="flex"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="수락 근거(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" /></div>
        </div>
      )}
      {(tab === 'sponsors' || tab === 'reviewers' || tab === 'backups') && (() => {
        const field = tab === 'sponsors' ? 'sponsor_reference' : tab === 'reviewers' ? 'reviewer_reference' : 'backup_owner_reference';
        const label = tab === 'sponsors' ? 'Sponsor' : tab === 'reviewers' ? 'Reviewer' : 'Backup Owner';
        const items = commitments.filter((c) => (c as unknown as Record<string, string | null>)[field]);
        return (
          <div className="space-y-1">
            {items.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <span className="ml-2">{label}: {(c as unknown as Record<string, string | null>)[field]}</span>
                <span className="ml-2 text-muted-foreground">Reference — 실제 배정 아님</span>
              </div>
            ))}
            {!items.length && <AdminEmpty title={`${label} Reference 없음`} description={tab === 'backups' ? '단일 Admin 운영(실측) — Backup 부재는 의존성 위험 후보입니다.' : `${label} 미지정 시 ${tab === 'sponsors' ? 'sponsor' : 'reviewer'}_unverified 상태를 유지합니다.`} />}
          </div>
        );
      })()}
      {tab === 'ownershipgaps' && (
        !ownershipGaps.length ? <AdminEmpty title="Ownership Gap 없음" description="Gap 은 인사평가 근거로 사용하지 않습니다." /> : (
          <div className="space-y-1">
            {ownershipGaps.map(({ c, ownership }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone="warning">{ownership.verification}</AdminBadge>
                <p className="mt-1 text-muted-foreground">{ownership.gaps.join(' · ')} · 인사 평가 아님</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Success Criteria / Milestones ── */}
      {tab === 'criteria' && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="Success Criteria 없으면 성공을 판정하지 않습니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, criteria }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={criteria.status === 'defined_reference' ? 'success' : criteria.status === 'success_criteria_missing' ? 'danger' : 'warning'}>{criteria.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">정의 {criteria.definedCount}건 · {criteria.issues.slice(0, 2).join(' · ') || '이슈 없음'}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'milestones' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !commitments.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const seq = milestones.filter((m) => m.commitment_id === commitments[0].id).length + 1;
              void act(() => createCommitmentMilestone({ code: `ms_${now.toISOString().slice(0, 19)}`, commitmentId: commitments[0].id, title: r.slice(0, 100), sequence: seq, type: 'review', evidence: [{ label: 'note', value: r.slice(0, 100) }], evidenceRequired: [{ label: 'review_evidence' }] }), 'Milestone 기록(자동 Task 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Commitment Milestone 추가</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Milestone 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!milestones.length ? <AdminEmpty title="Milestone 없음" description="Milestone 완료 표시만으로 성과 달성을 보장하지 않습니다." /> : milestones.map((m) => (
            <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">#{m.milestone_sequence} {m.milestone_code}</span>
                <AdminBadge tone="info">{m.milestone_type}</AdminBadge>
                <AdminBadge tone={m.milestone_status === 'verified_complete_reference' ? 'success' : 'neutral'}>{m.milestone_status}</AdminBadge>
                <span className="text-muted-foreground">{m.title}</span>
              </div>
              {!['cancelled_reference', 'invalidated'].includes(m.milestone_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['externally_started_reference', 'completion_reported_reference', 'verified_complete_reference', 'blocked_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCommitmentMilestone(m.id, st, rr, st === 'verified_complete_reference' ? [{ label: 'verify', value: rr.slice(0, 100) }] : []), `${st}(성과 보장 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'msevidence' && (
        !milestoneEvidence.length ? <AdminEmpty title="Milestone 없음" description="Evidence 부족 시 verified_complete 가 서버에서 차단됩니다." /> : (
          <div className="space-y-1">
            {milestoneEvidence.map(({ m, ev }) => (
              <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{m.milestone_code}</span>
                <AdminBadge tone={ev.verdict === 'verified_eligible' ? 'success' : 'warning'}>{ev.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{ev.note} · 제공 {(m.evidence ?? []).length}/필수 {(m.evidence_required ?? []).length}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Progress ── */}
      {tab === 'progress' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="보고 진행률(0~100, 선택)" className="w-48 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy || !commitments.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const pct = refInput.trim() === '' ? null : Number(refInput);
              if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) { toast.error('0~100'); return; }
              void act(() => createCommitmentProgress({ code: `pg_${now.toISOString().slice(0, 19)}`, commitmentId: commitments[0].id, evidence: [{ label: 'note', value: r.slice(0, 100) }], reported: pct }), 'Progress Snapshot 기록(자기보고 ≠ 검증)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Commitment Progress 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="근거(필수)" className="min-w-[160px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!progressRows.length ? <AdminEmpty title="Snapshot 없음" description="Progress Percentage 는 Evidence 없이 임의 생성하지 않습니다." /> : progressRows.slice(0, 30).map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{p.snapshot_code}</span>
              <AdminBadge tone={p.progress_status === 'completion_unverified' ? 'warning' : 'neutral'}>{p.progress_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">reported {PCT(p.reported_progress_percentage)} / verified {PCT(p.verified_progress_percentage)} · milestone {NUM(p.completed_milestone_count)}/{NUM(p.total_milestone_count)}</span>
            </div>
          ))}
        </div>
      )}
      {(tab === 'reported' || tab === 'verified') && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description={tab === 'reported' ? '자기보고 Progress 는 검증으로 표시하지 않습니다.' : 'Verified 는 검증된 Milestone 실측만 사용합니다.'} /> : (
          <div className="space-y-1">
            {analysis.map(({ c, reported, verified, progressStatus }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <span className="ml-2 font-bold">{tab === 'reported' ? PCT(reported) : PCT(verified)}</span>
                <AdminBadge tone={progressStatus.status === 'completion_unverified' ? 'warning' : 'neutral'}>{progressStatus.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{progressStatus.note}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Blockers ── */}
      {tab === 'blockers' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !commitments.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createCommitmentBlocker({ code: `blk_${now.toISOString().slice(0, 19)}`, commitmentId: commitments[0].id, type: 'dependency', summary: r.slice(0, 200), evidence: [{ label: 'note', value: r.slice(0, 100) }] }), 'Blocker 기록(자동 해결 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Commitment Blocker 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Blocker 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!blockers.length ? <AdminEmpty title="Blocker 없음" description="Blocker 수는 담당자 능력 평가가 아닙니다." /> : blockers.map((b) => (
            <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{b.blocker_code}</span>
                <AdminBadge tone="info">{b.blocker_type}</AdminBadge>
                <AdminBadge tone={b.severity === 'critical' ? 'danger' : b.severity === 'severity_unverified' ? 'warning' : 'neutral'}>{b.severity}</AdminBadge>
                <AdminBadge tone={ACTIVE_BLOCKER.includes(b.blocker_status) ? 'warning' : 'neutral'}>{b.blocker_status}</AdminBadge>
              </div>
              <p className="mt-1 text-muted-foreground">{b.blocker_summary}</p>
              {!['cancelled_reference', 'invalidated'].includes(b.blocker_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['active_reference', 'resolution_reported_reference', 'resolved_reference', 'accepted_risk_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCommitmentBlocker(b.id, st, rr), `${st}(위험 소멸 보장 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'activeblockers' && (() => {
        const items = blockers.filter((b) => ACTIVE_BLOCKER.includes(b.blocker_status));
        return !items.length ? <AdminEmpty title="Active Blocker 없음" description="해결 보고와 해결 검증은 분리됩니다." /> : (
          <div className="space-y-1">
            {items.map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{b.blocker_code}</span>
                <AdminBadge tone="warning">{b.blocker_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{b.blocker_summary}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'blockerimpact' && (
        !blockerAnalysis.length ? <AdminEmpty title="Blocker 없음" description="영향 불명확 시 blocker_impact_unverified 를 유지합니다." /> : (
          <div className="space-y-1">
            {blockerAnalysis.map(({ b, impact }) => (
              <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{b.blocker_code}</span>
                <AdminBadge tone={impact.impact === 'critical_candidate' ? 'danger' : impact.impact === 'blocker_impact_unverified' ? 'warning' : 'neutral'}>{impact.impact}</AdminBadge>
                <span className="ml-2 text-muted-foreground">Hard Risk 즉시 critical(희석 없음) · 능력 평가 아님</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Dependencies / Schedule / Scope ── */}
      {(tab === 'dependencies' || tab === 'depreadiness') && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="의존성 미확인 상태를 dependency_clear 로 표시하지 않습니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, dependency }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={dependency.readiness === 'dependency_clear_reference' ? 'success' : dependency.readiness === 'blocking_dependency' ? 'danger' : 'warning'}>{dependency.readiness}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{tab === 'dependencies' ? `의존 ${(c.dependencies ?? []).length}건` : `waiting: ${dependency.waiting.join(',') || '—'} / blocking: ${dependency.blocking.join(',') || '—'}`}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'schedbaseline' && (
        <div className="space-y-1">
          {analysis.map(({ c }) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{c.commitment_code}</span>
              <AdminBadge tone={c.start_reference_at ? 'info' : 'warning'}>{c.start_reference_at ? 'baseline_recorded' : 'schedule_baseline_unverified'}</AdminBadge>
              <span className="ml-2 text-muted-foreground">start {c.start_reference_at?.slice(0, 10) ?? '—'} → target {c.target_reference_at?.slice(0, 10) ?? '—'} · Calendar/Working Day 정의 없음(실측)</span>
            </div>
          ))}
          {!analysis.length && <AdminEmpty title="Commitment 없음" description="Calendar/Working Day 기준이 없으면 schedule_baseline_unverified 입니다." />}
        </div>
      )}
      {tab === 'schedvariance' && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="기준 날짜가 없으면 variance 를 계산하지 않습니다. 자동 Deadline 변경 없음." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, schedule }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={schedule.verdict === 'critical_variance_candidate' ? 'danger' : schedule.verdict.includes('unverified') || schedule.verdict === 'insufficient_data' ? 'warning' : 'neutral'}>{schedule.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">variance {schedule.varianceDays == null ? '계산 불가' : `${schedule.varianceDays}일`}</span>
              </div>
            ))}
          </div>
        )
      )}
      {(tab === 'scopebaseline' || tab === 'scopedrift') && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="일정 변경을 자동으로 Scope Drift 로 단정하지 않으며, 승인/무단 변경을 구분합니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, scope }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={scope.drift === 'no_known_drift' ? 'success' : scope.drift === 'scope_baseline_unverified' ? 'warning' : 'danger'}>{scope.drift}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{tab === 'scopebaseline' ? `Baseline = Success Criteria ${(c.success_criteria ?? []).length}건` : '변경 이력은 scope_changed_reference 외부 기록으로 추적'}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Aging / Confidence / Risk ── */}
      {tab === 'aging' && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="Deadline 경과는 실패 확정이 아니며 자동 Escalation 이 없습니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, aging }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={aging.status.includes('overdue') ? 'danger' : aging.status === 'aging_threshold_unverified' ? 'warning' : 'neutral'}>{aging.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">age {aging.ageDays ?? '—'}일 · D{aging.daysToTarget ?? '—'} · 실패 확정 아님</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'overdue' && (
        !overdue.length ? <AdminEmpty title="Overdue 없음" description="target 경과 Commitment 가 없습니다." /> : (
          <div className="space-y-1">
            {overdue.map(({ c, aging }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone="danger">{aging.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{c.title} · {Math.abs(aging.daysToTarget ?? 0)}일 경과 — 사람 검토 필요(실패 확정 아님)</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'confidence' && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="High Confidence 는 실제 완료 보장이 아닙니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, confidence }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={confidence.status === 'critical_delivery_risk' ? 'danger' : confidence.status === 'high_confidence_reference' ? 'success' : 'warning'}>{confidence.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">score {confidence.score ?? 'null'} · 지지: {confidence.supporting.join(',') || '—'} · 위험: {confidence.risks.join(',') || '—'} · 누락: {confidence.missing.join(',') || '—'}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'risk' && (
        !analysis.length ? <AdminEmpty title="Commitment 없음" description="Hard Security/Privacy/Compliance Risk 는 평균으로 희석하지 않습니다." /> : (
          <div className="space-y-1">
            {analysis.map(({ c, risk }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={risk.level === 'critical' ? 'danger' : risk.level === 'low' ? 'success' : 'warning'}>{risk.level}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{risk.factors.join(' · ') || '위험 요인 없음'}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Completion / Outcome Readiness / Accountability ── */}
      {tab === 'completionreports' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !commitments.length} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => reportCommitmentCompletion({ code: `cpr_${now.toISOString().slice(0, 19)}`, commitmentId: commitments[0].id, summary: r.slice(0, 200), evidence: [{ label: 'note', value: r.slice(0, 100) }] }), '완료 보고 기록(검증 ≠ Outcome 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">최근 Commitment 완료 보고</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="완료 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!completions.length ? <AdminEmpty title="완료 보고 없음" description="완료 보고와 Outcome 은 동일하지 않습니다." /> : completions.map((cr) => (
            <div key={cr.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{cr.review_code}</span>
              <AdminBadge tone={cr.verification_status === 'verified_complete_reference' ? 'success' : 'warning'}>{cr.verification_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{cr.completion_summary}</span>
              {!['rejected_completion_reference', 'invalidated'].includes(cr.verification_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['verification_pending', 'completion_unverified', 'verified_complete_reference', 'rejected_completion_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCommitmentCompletion(cr.id, st, rr), `${st}(Outcome 달성 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'completionverify' && (
        !completionAnalysis.length ? <AdminEmpty title="검증 대상 없음" description="Evidence/Criteria/Critical Blocker/Reviewer 조건 없이 verified_complete 를 표시하지 않습니다." /> : (
          <div className="space-y-1">
            {completionAnalysis.map(({ cr, verdict }) => (
              <div key={cr.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{cr.review_code}</span>
                <AdminBadge tone={verdict.verdict === 'verified_complete_reference' ? 'success' : 'warning'}>{verdict.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{verdict.blockers.join(' · ') || '게이트 통과(검토 가능)'} · outcomeAchieved=false</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'outcomereadiness' && (
        <div className="space-y-2">
          {!readinessAnalysis.length ? <AdminEmpty title="대상 없음" description="Observation Plan 이 없으면 Outcome Ready 로 표시하지 않습니다." /> : readinessAnalysis.map(({ c, readiness }) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{c.commitment_code}</span>
              <AdminBadge tone={readiness.readiness === 'ready_for_observation_reference' ? 'success' : 'warning'}>{readiness.readiness}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{readiness.missing.join(' · ') || '준비 완료 후보'}</span>
              <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordCommitmentGovernance('outcome_readiness_reviewed', rr, { commitment: c.commitment_code, readiness: readiness.readiness }, c.id), 'Readiness 검토 기록'); }} className="ml-2 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토 기록</button>
            </div>
          ))}
          <div className="flex"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" /></div>
        </div>
      )}
      {tab === 'accountability' && (
        <div className="space-y-2">
          {!accountabilityAnalysis.length ? <AdminEmpty title="Commitment 없음" description="Accountability 는 약속·근거·절차의 완결성 검토이며 인사 평가/징계가 아닙니다." /> : accountabilityAnalysis.map(({ c, accountability }) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{c.commitment_code}</span>
              <AdminBadge tone={accountability.verdict === 'well_documented_reference' ? 'success' : accountability.verdict === 'accountability_gap_candidate' ? 'danger' : 'warning'}>{accountability.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">문서화 {accountability.documented.length}/9 · Gap: {accountability.gaps.slice(0, 3).join(',') || '—'} · 인사 평가 아님</span>
              <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordCommitmentGovernance('accountability_reviewed', rr, { commitment: c.commitment_code, verdict: accountability.verdict }, c.id), 'Accountability 검토 기록(인사 평가 아님)'); }} className="ml-2 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토 기록</button>
            </div>
          ))}
          <div className="flex"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" /></div>
        </div>
      )}
      {tab === 'repeatedgaps' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={repeatedGaps.verdict === 'critical_commitment_gap' ? 'danger' : repeatedGaps.verdict === 'no_known_pattern' ? 'success' : 'warning'}>{repeatedGaps.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">개인 능력 문제로 단정하지 않습니다(personBlamed=false)</span>
          </div>
          {repeatedGaps.patterns.map((p) => (
            <div key={p.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">{p.kind}</AdminBadge>
              <span className="ml-2">{p.count}건 반복</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Recommendations / Outcomes / Reviews / External / Timeline / Audit / Support ── */}
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
        !outcomeLinks.length ? <AdminEmpty title="Outcome 연결 대상 없음" description="완료 검증 후 Decision Memory(0514) 연결 후보가 표시됩니다. 완료와 Outcome 을 자동 인과로 연결하지 않습니다." /> : (
          <div className="space-y-1">
            {outcomeLinks.map(({ c, link }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                {'insufficient' in link ? <AdminBadge tone="warning">{link.why}</AdminBadge> : (<><AdminBadge tone="neutral">{link.linkStatus}</AdminBadge><span className="ml-2 text-muted-foreground">causallyAttributed=false</span></>)}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['completion_verified_reference', 'completion_review_started', 'milestone_verified_reference', 'accountability_reviewed', 'outcome_readiness_reviewed'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="모든 검증은 사람 검토를 통해서만 이뤄집니다." /> : (
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
              void act(() => recordCommitmentExternalAction(extAction, r, [{ label: 'note', value: r.slice(0, 200) }], commitments[0]?.id ?? null), '외부 활동 기록(업무/일정/HR 미변경)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">외부 활동 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="활동 내용(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {(() => { const ext = audit.filter((e) => e.event_type === 'external_commitment_action_recorded'); return !ext.length ? <AdminEmpty title="외부 활동 없음" description="External Action Reference 는 실행 성공을 보장하지 않습니다." /> : ext.slice(0, 30).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
          )); })()}
        </div>
      )}
      {tab === 'timeline' && (
        !timeline.items.length ? <AdminEmpty title="타임라인 없음" description="이벤트가 기록되면 최신순으로 표시됩니다." /> : (
          <div className="space-y-1">
            {timeline.items.map((e, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone="neutral">{e.kind}</AdminBadge>
                <span className="ml-2">{e.label}</span>
              </div>
            ))}
            {timeline.truncated && <p className="text-[10px] text-muted-foreground">50건 초과분 생략(명시)</p>}
          </div>
        )
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="Event 는 실제 업무 완료나 Outcome 성공을 자동 의미하지 않습니다(25종 whitelist)." /> : (
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
          {COMMITMENT_SUPPORT.map((s) => (
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
