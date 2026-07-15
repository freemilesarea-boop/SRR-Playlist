/**
 * ExecutionDeliverySection — Enterprise Execution Intelligence, Strategic Delivery
 * Analytics & Organizational Performance Center (Phase AI-OPS-18).
 *
 * Commitment → Execution → Outcome → Business Impact → Executive Analytics.
 * "약속을 지켰는가"(0520)가 아니라 "실행력이 어떤 결과를 만들었는가"를 분석.
 * 표본<5 확정 금지 · 상관 ≠ 인과 · Delivery Score ≠ 인사 평가 · 자동 실행/KPI 변경 없음.
 *
 * 탭 23개(Executive Cockpit 포함).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Briefcase, Calendar, GitBranch, Grid3x3, History, Layers,
  Lightbulb, Link2, ListChecks, Lock, RefreshCw, ScrollText, Shield, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchDeliverySummary, createDeliverySnapshot, fetchDeliverySnapshots, createKpiCorrelation,
  fetchKpiCorrelations, recordDeliveryGovernance, fetchDeliveryAudit,
  fetchCommitments, fetchCommitmentBlockers, fetchCompletionReviews, fetchCommitmentAudit,
  fetchExecPriorities, fetchPriorityPortfolios,
  type DeliverySummary, type DeliverySnapshotRow, type KpiCorrelationRow, type DeliveryEventRow,
  type CommitmentRow, type CommitmentBlockerRow, type CompletionReviewRow, type CommitmentEventRow,
  type ExecPriorityRow, type PriorityPortfolioRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateCommitmentSuccessRate, calculateDeliveryTrend, calculateDomainDelivery,
  calculateExecutiveDeliveryScore, detectExecutionBottleneck, analyzeCrossCommitmentImpact,
  buildStrategicExecutionGraph, buildExecutiveTimeline, detectDeliveryPattern,
  calculateDeliveryQuality, correlateKpi, calculateExecutionHealth, buildExecutiveCockpit,
  buildDeliveryRecommendation, DELIVERY_SUPPORT,
} from '@/lib/executionDeliveryAnalytics';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const TERMINAL = ['cancelled_reference', 'invalidated', 'expired'];
const CLOSED = ['verified_complete_reference', 'outcome_observation_pending', 'cancelled_reference', 'invalidated', 'expired'];

type Tab = 'cockpit' | 'successrate' | 'trend' | 'domaindelivery' | 'initiativedelivery' | 'portfoliodelivery'
  | 'prioritydelivery' | 'execscore' | 'bottlenecks' | 'crossimpact' | 'executiongraph' | 'timeline'
  | 'patterns' | 'quality' | 'kpicorr' | 'health' | 'risk' | 'execsummary' | 'recommendations'
  | 'snapshots' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Executive Cockpit', icon: Layers },
  { key: 'successrate', label: 'Commitment Success Rate', icon: BarChart3 },
  { key: 'trend', label: 'Delivery Trend', icon: TrendingUp },
  { key: 'domaindelivery', label: 'Department(Domain) Delivery', icon: Briefcase },
  { key: 'initiativedelivery', label: 'Strategic Initiative Delivery', icon: Target },
  { key: 'portfoliodelivery', label: 'Portfolio Delivery', icon: Target },
  { key: 'prioritydelivery', label: 'Priority Delivery', icon: Target },
  { key: 'execscore', label: 'Executive Delivery Score', icon: BarChart3 },
  { key: 'bottlenecks', label: 'Execution Bottlenecks', icon: AlertTriangle },
  { key: 'crossimpact', label: 'Cross Commitment Analytics', icon: GitBranch },
  { key: 'executiongraph', label: 'Strategic Execution Graph', icon: GitBranch },
  { key: 'timeline', label: 'Executive Timeline', icon: Calendar },
  { key: 'patterns', label: 'Delivery Patterns', icon: History },
  { key: 'quality', label: 'Delivery Quality', icon: ListChecks },
  { key: 'kpicorr', label: 'KPI Correlation', icon: Link2 },
  { key: 'health', label: 'Execution Health', icon: Shield },
  { key: 'risk', label: 'Risk', icon: AlertTriangle },
  { key: 'execsummary', label: 'Executive Summary', icon: ScrollText },
  { key: 'recommendations', label: 'Delivery Recommendations', icon: Lightbulb },
  { key: 'snapshots', label: 'Delivery Snapshots', icon: History },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ExecutionDeliverySection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<DeliverySummary>({});
  const [snapshots, setSnapshots] = useState<DeliverySnapshotRow[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiCorrelationRow[]>([]);
  const [audit, setAudit] = useState<DeliveryEventRow[]>([]);
  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [blockers, setBlockers] = useState<CommitmentBlockerRow[]>([]);
  const [completions, setCompletions] = useState<CompletionReviewRow[]>([]);
  const [commitmentAudit, setCommitmentAudit] = useState<CommitmentEventRow[]>([]);
  const [priorities, setPriorities] = useState<ExecPriorityRow[]>([]);
  const [portfolios, setPortfolios] = useState<PriorityPortfolioRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sn, kp, au, co, bl, cr, ca, pr, pf] = await Promise.all([
        fetchDeliverySummary(), fetchDeliverySnapshots(null, 50), fetchKpiCorrelations(null, 100),
        fetchDeliveryAudit(100), fetchCommitments(null, 100), fetchCommitmentBlockers(null, 100),
        fetchCompletionReviews(null, 100), fetchCommitmentAudit(100), fetchExecPriorities(null, 100),
        fetchPriorityPortfolios(null, 50),
      ]);
      setSummary(s); setSnapshots(sn); setKpiRows(kp); setAudit(au); setCommitments(co);
      setBlockers(bl); setCompletions(cr); setCommitmentAudit(ca); setPriorities(pr); setPortfolios(pf);
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
  const kpiActuals = useMemo(() => (summary.kpi_actuals ?? {}) as Record<string, number | string>, [summary]);
  const mrr = typeof kpiActuals.mrr_actual === 'number' ? kpiActuals.mrr_actual : null;

  const verifiedCount = typeof summary.verified_complete === 'number' ? summary.verified_complete : 0;
  const closedCommitments = useMemo(() => commitments.filter((c) => CLOSED.includes(c.commitment_status)), [commitments]);

  const successRate = useMemo(() => calculateCommitmentSuccessRate({
    verifiedComplete: commitments.length ? verifiedCount : null,
    totalClosed: commitments.length ? closedCommitments.length : null,
  }), [commitments, verifiedCount, closedCommitments]);

  const trend = useMemo(() => calculateDeliveryTrend(
    snapshots.filter((s) => s.snapshot_kind === 'delivery_summary').slice(0, 8).reverse().map((s) => ({ label: s.generated_at.slice(0, 10), rate: s.success_rate })),
  ), [snapshots]);

  const domainDelivery = useMemo(() => calculateDomainDelivery(commitments.map((c) => ({
    domain: c.commitment_domain,
    verified: c.commitment_status === 'verified_complete_reference' || c.commitment_status === 'outcome_observation_pending',
    closed: CLOSED.includes(c.commitment_status),
  }))), [commitments]);

  const execScore = useMemo(() => calculateExecutiveDeliveryScore({
    successRate: successRate.status === 'insufficient_data' ? null : successRate.rate,
    verifiedProgressAvg: null, onScheduleRate: null,
    qualityScore: null,
  }), [successRate]);

  const bottleneck = useMemo(() => detectExecutionBottleneck(
    blockers.map((b) => ({ stage: b.blocker_type, commitmentCode: b.commitment_id })),
  ), [blockers]);

  const crossImpact = useMemo(() => analyzeCrossCommitmentImpact(commitments.map((c) => {
    const target = c.target_reference_at ? new Date(c.target_reference_at) : null;
    const delay = target && target.getTime() < now.getTime() && !CLOSED.includes(c.commitment_status) ? Math.round((now.getTime() - target.getTime()) / 86400000) : null;
    const dep = ((c.dependencies ?? []) as unknown[]).find((d): d is string => typeof d === 'string') ?? null;
    return { code: c.commitment_code, delayDays: delay, dependsOn: dep };
  })), [commitments, now]);

  const executionGraph = useMemo(() => {
    const nodes = [
      ...priorities.filter((p) => p.priority_status === 'accepted_reference').slice(0, 10).map((p) => ({ id: `d_${p.id}`, stage: 'decision', label: p.priority_code, ref: p.id })),
      ...commitments.slice(0, 10).map((c) => ({ id: `c_${c.id}`, stage: 'commitment', label: c.commitment_code, ref: c.id })),
      ...completions.slice(0, 10).map((cr) => ({ id: `cp_${cr.id}`, stage: 'completion', label: cr.review_code, ref: cr.id })),
    ];
    const edges = [
      ...commitments.filter((c) => c.priority_candidate_id).map((c) => ({ from: `d_${c.priority_candidate_id}`, to: `c_${c.id}` })),
      ...completions.map((cr) => ({ from: `c_${cr.commitment_id}`, to: `cp_${cr.id}` })),
    ];
    return buildStrategicExecutionGraph(nodes, edges);
  }, [priorities, commitments, completions]);

  const timeline = useMemo(() => buildExecutiveTimeline(
    commitmentAudit.map((e) => ({ at: new Date(e.created_at), kind: e.event_type, label: e.detail ?? e.event_type })), now,
  ), [commitmentAudit, now]);

  const patterns = useMemo(() => detectDeliveryPattern(
    blockers.map((b) => ({ patternKind: `blocker_${b.blocker_type}`, commitmentCode: b.commitment_id })),
  ), [blockers]);

  const quality = useMemo(() => {
    const withEvidence = commitments.filter((c) => (c.evidence ?? []).length > 0).length;
    const withReviewer = commitments.filter((c) => c.reviewer_reference && c.reviewer_reference !== c.owner_reference).length;
    return calculateDeliveryQuality({
      evidenceCoverage: commitments.length ? (withEvidence / commitments.length) * 100 : null,
      verificationCoverage: completions.length ? (completions.filter((cr) => cr.verification_status === 'verified_complete_reference').length / completions.length) * 100 : null,
      reviewerIndependence: commitments.length ? (withReviewer / commitments.length) * 100 : null,
      accountabilityCoverage: null,
    });
  }, [commitments, completions]);

  const kpiCorrelation = useMemo(() => correlateKpi({
    deliverySeries: snapshots.filter((s) => s.snapshot_kind === 'delivery_summary').slice(0, 8).reverse().map((s) => s.success_rate),
    kpiSeries: snapshots.filter((s) => s.snapshot_kind === 'delivery_summary').slice(0, 8).reverse().map((s) => (typeof (s.metrics as Record<string, unknown>).mrr === 'number' ? (s.metrics as Record<string, number>).mrr : null)),
    kpiAvailable: mrr != null,
  }), [snapshots, mrr]);

  const criticalRisks = useMemo(() => {
    const out: string[] = [];
    if (blockers.some((b) => ['security', 'privacy', 'compliance'].includes(b.blocker_type) && b.severity === 'critical' && ['detected', 'pending_review', 'active_reference'].includes(b.blocker_status))) out.push('Hard Security/Privacy/Compliance Blocker 미해결');
    out.push('단일 Admin 운영(실측)');
    return out;
  }, [blockers]);

  const health = useMemo(() => calculateExecutionHealth({
    deliveryHealth: successRate.status === 'measured_reference' ? successRate.rate : null,
    executionStability: null, throughput: null, reviewLatency: null,
    evidenceCoverage: quality.score, completionQuality: null,
    accountabilityCoverage: null, deliveryConfidence: null, strategicProgress: null,
    criticalRisks,
  }), [successRate, quality, criticalRisks]);

  const cockpit = useMemo(() => buildExecutiveCockpit({
    strategy: { openPriorities: priorities.filter((p) => !['rejected', 'invalidated'].includes(p.priority_status)).length, selectedPortfolios: portfolios.filter((p) => p.review_status === 'selected_reference').length },
    commitments: { total: commitments.length, active: commitments.filter((c) => !TERMINAL.includes(c.commitment_status) && !CLOSED.includes(c.commitment_status)).length, blocked: commitments.filter((c) => c.commitment_status === 'blocked_reference').length },
    delivery: { rate: successRate.rate, rateStatus: successRate.status },
    businessImpact: { outcomesObserved: typeof summary.decision_outcomes === 'number' ? summary.decision_outcomes : 0, kpiCorrelations: kpiRows.length },
    health: { score: health.score, status: health.status },
    risks: criticalRisks,
  }), [priorities, portfolios, commitments, successRate, summary, kpiRows, health, criticalRisks]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string; severity: string }[] = [];
    const push = (r: ReturnType<typeof buildDeliveryRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason, severity: r.severity }); };
    if (bottleneck.verdict === 'recurring_bottleneck_candidate' || bottleneck.verdict === 'critical_bottleneck_candidate') push(buildDeliveryRecommendation({ type: 'review_recurring_bottleneck', reason: `반복 병목: ${bottleneck.stages[0]?.stage}(${bottleneck.stages[0]?.count}건)`, evidence: bottleneck.stages.slice(0, 3).map((s) => s.stage), severity: 'high' }));
    if (trend.verdict === 'declining_candidate') push(buildDeliveryRecommendation({ type: 'review_delivery_decline', reason: `Delivery Trend 하락(Δ${trend.delta})`, evidence: ['trend'], severity: 'high' }));
    if (crossImpact.impacted.length > 0) push(buildDeliveryRecommendation({ type: 'review_cross_commitment_delay', reason: `선행 지연 전파 후보 ${crossImpact.impacted.length}건(확정 아님)`, evidence: crossImpact.impacted.slice(0, 3).map((x) => x.code), severity: 'moderate' }));
    if (quality.score != null && quality.score < 50) push(buildDeliveryRecommendation({ type: 'improve_evidence_coverage', reason: `Delivery Quality ${quality.score} — Evidence/검증 보강 필요`, evidence: ['quality'], severity: 'moderate' }));
    if (kpiCorrelation.verdict === 'positive_candidate' || kpiCorrelation.verdict === 'negative_candidate') push(buildDeliveryRecommendation({ type: 'request_causal_review_reference', reason: `KPI 상관 후보(${kpiCorrelation.verdict}) — 인과 검토는 0517 워크플로`, evidence: ['kpi'], severity: 'low' }));
    return out;
  }, [bottleneck, trend, crossImpact, quality, kpiCorrelation]);

  if (loading) return <AdminCard title="Enterprise Execution Intelligence & Strategic Delivery Analytics Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Execution Intelligence & Strategic Delivery Analytics Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Execution Intelligence & Strategic Delivery Analytics Center"
      subtitle="Commitment→Execution→Outcome→Business Impact→Executive Analytics — 표본<5 확정 금지·상관 ≠ 인과·Delivery Score ≠ 인사 평가"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 업무 배정/일정 변경/Owner 변경/Commitment 생성/KPI 변경/Outcome 생성/Budget 변경/Production 변경/Merge/Deploy 는 없습니다(AI-OPS-17 원칙 유지). Success Rate 는 verified_complete 기반이며 표본<5 이면 확정하지 않습니다. KPI 상관은 인과가 아니고(0517 워크플로만), Delivery Score/패턴/병목 분석은 인사 평가·개인 능력 판단이 아닙니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Executive Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordDeliveryGovernance('executive_cockpit_reviewed', r, { sections: cockpit.sections.length, health: health.status }), 'Cockpit 검토 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Cockpit 검토 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <p className="text-[10px] text-muted-foreground">{cockpit.limitations.join(' · ')} · MRR 실측 {NUM(mrr)}원 · CSAT {String(kpiActuals.customer_satisfaction ?? 'kpi_unavailable')}</p>
        </div>
      )}

      {/* ── Success Rate / Trend ── */}
      {tab === 'successrate' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Success Rate" value={successRate.rate == null ? '산출 불가' : `${Math.round(successRate.rate)}%`} />
            <Box label="판정" value={successRate.status} />
            <Box label="종결 표본" value={NUM(successRate.sampleSize)} />
            <Box label="Verified Complete(실측)" value={NUM(verifiedCount)} />
          </div>
          <AdminAlert tone="info" description={successRate.note + ' — 완료 보고가 아닌 verified_complete_reference 만 성공으로 집계합니다.'} />
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createDeliverySnapshot({ code: `dsnap_${now.toISOString().slice(0, 19)}`, kind: 'delivery_summary', evidence: [{ label: 'note', value: r.slice(0, 100) }], sample: successRate.sampleSize, successRate: successRate.rate, metrics: { mrr, verified: verifiedCount, closed: closedCommitments.length } }), 'Delivery Snapshot 기록(표본<5 시 서버가 확정 차단)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">현재 상태 Snapshot 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
        </div>
      )}
      {tab === 'trend' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={trend.verdict === 'declining_candidate' ? 'danger' : trend.verdict === 'improving_candidate' ? 'success' : 'warning'}>{trend.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">Δ {trend.delta ?? '—'} · Snapshot {trend.series.length}건 기반</span>
          </div>
          {trend.series.map((p, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono">{p.label}</span>
              <span className="ml-2 font-bold">{p.rate == null ? 'null' : `${Math.round(p.rate)}%`}</span>
            </div>
          ))}
          {!trend.series.length && <AdminEmpty title="Trend 데이터 없음" description="delivery_summary Snapshot 이 누적되면 추세를 계산합니다(표본 부족 시 확정 금지)." />}
        </div>
      )}

      {/* ── Domain / Initiative / Portfolio / Priority Delivery ── */}
      {tab === 'domaindelivery' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="부서(Department) 구조가 없어(실측) Domain 단위로 대체 분석합니다." />
          {!domainDelivery.length ? <AdminEmpty title="Commitment 없음" description="Domain 별 verified 기반 성공률입니다." /> : domainDelivery.map((d) => (
            <div key={d.domain} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{d.domain}</span>
              <span className="ml-2">{d.rate == null ? '종결 표본 없음' : `${Math.round(d.rate)}%`}</span>
              <AdminBadge tone={d.status === 'sample_too_small' ? 'warning' : d.status === 'measured_reference' ? 'success' : 'neutral'}>{d.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">총 {d.total}건</span>
            </div>
          ))}
        </div>
      )}
      {(tab === 'initiativedelivery' || tab === 'portfoliodelivery' || tab === 'prioritydelivery') && (() => {
        const linked = commitments.filter((c) => (tab === 'portfoliodelivery' ? c.priority_portfolio_id != null : tab === 'prioritydelivery' ? c.priority_candidate_id != null : c.commitment_type === 'strategic_initiative_reference'));
        const label = tab === 'portfoliodelivery' ? 'Portfolio(0519)' : tab === 'prioritydelivery' ? 'Priority(0518)' : 'Strategic Initiative(0516)';
        return !linked.length ? <AdminEmpty title={`${label} 연결 Commitment 없음`} description="연결된 Commitment 가 생기면 Delivery 를 집계합니다." /> : (
          <div className="space-y-1">
            {linked.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.commitment_code}</span>
                <AdminBadge tone={c.commitment_status === 'verified_complete_reference' ? 'success' : 'neutral'}>{c.commitment_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{c.title}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'execscore' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Executive Delivery Score" value={execScore.score == null ? 'insufficient_data' : String(execScore.score)} />
            <Box label="사용 성분" value={execScore.used.join(', ') || '—'} />
            <Box label="누락 성분" value={execScore.missing.join(', ') || '없음'} />
          </div>
          <p className="text-[10px] text-muted-foreground">{execScore.limitations.join(' · ')}</p>
        </div>
      )}

      {/* ── Bottlenecks / Cross Impact / Graph / Timeline / Patterns ── */}
      {tab === 'bottlenecks' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={bottleneck.verdict.includes('critical') ? 'danger' : bottleneck.verdict === 'no_known_bottleneck' ? 'success' : 'warning'}>{bottleneck.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">개인 능력 단정 아님(personBlamed=false)</span>
          </div>
          {bottleneck.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">{s.stage}</AdminBadge>
              <span className="ml-2">{s.count}건 반복</span>
              <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => recordDeliveryGovernance('bottleneck_detected', rr, { stage: s.stage, count: s.count }), '병목 검토 기록'); }} className="ml-2 rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토 기록</button>
            </div>
          ))}
          {!bottleneck.stages.length && <AdminEmpty title="병목 없음" description="Blocker/단계 반복이 누적되면 감지합니다." />}
          <div className="flex"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" /></div>
        </div>
      )}
      {tab === 'crossimpact' && (
        !crossImpact.impacted.length ? <AdminEmpty title="지연 전파 후보 없음" description="A 지연 → B/C 영향은 후보이며 확정 영향/인과가 아닙니다." /> : (
          <div className="space-y-1">
            {crossImpact.impacted.map((x) => (
              <div key={x.code} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{x.code}</span>
                <AdminBadge tone="warning">upstream +{x.upstreamDelay}일</AdminBadge>
                <span className="ml-2 text-muted-foreground">{x.note}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">confirmedImpact=false · causallyAttributed=false</p>
          </div>
        )
      )}
      {tab === 'executiongraph' && (
        <div className="space-y-2">
          {executionGraph.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.nodes.length ? 'info' : 'neutral'}>{s.stage}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.nodes.length ? s.nodes.slice(0, 6).map((n) => n.label).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {executionGraph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지" description={executionGraph.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Decision→Commitment→Milestone→Evidence→Completion→Outcome→Learning · orphan edge {executionGraph.orphanEdges.length}건</p>
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Box label="오늘" value={NUM(timeline.today)} />
            <Box label="이번 주" value={NUM(timeline.thisWeek)} />
            <Box label="이번 달" value={NUM(timeline.thisMonth)} />
            <Box label="분기" value={NUM(timeline.thisQuarter)} />
            <Box label="연간" value={NUM(timeline.thisYear)} />
          </div>
          {timeline.buckets.week.slice(0, 15).map((e, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="neutral">{e.kind}</AdminBadge>
              <span className="ml-2">{e.label}</span>
            </div>
          ))}
          {!timeline.thisYear && <AdminEmpty title="실행 이벤트 없음" description="Commitment 이벤트가 누적되면 CEO 관점 타임라인이 구성됩니다." />}
        </div>
      )}
      {tab === 'patterns' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={patterns.verdict.includes('persistent') ? 'danger' : patterns.verdict === 'sample_too_small' ? 'warning' : 'neutral'}>{patterns.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">표본&lt;3 판정 금지 · 개인 능력 단정 금지</span>
          </div>
          {patterns.patterns.map((p) => (
            <div key={p.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">{p.kind}</AdminBadge>
              <span className="ml-2">{p.count}건</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Quality / KPI / Health / Risk / Summary ── */}
      {tab === 'quality' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Delivery Quality" value={quality.score == null ? 'insufficient_data' : String(quality.score)} />
            <Box label="사용 성분" value={quality.used.join(', ') || '—'} />
            <Box label="누락 성분" value={quality.missing.join(', ') || '없음'} />
          </div>
          <p className="text-[10px] text-muted-foreground">{quality.limitations.join(' · ')}</p>
        </div>
      )}
      {tab === 'kpicorr' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={kpiCorrelation.verdict === 'kpi_unavailable' || kpiCorrelation.verdict === 'sample_too_small' ? 'warning' : 'info'}>{kpiCorrelation.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">{kpiCorrelation.note} · 대응 표본 {kpiCorrelation.pairs}건</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createKpiCorrelation({ code: `kpi_${now.toISOString().slice(0, 19)}`, scope: 'company', kpiType: 'mrr', kpiSource: 'subscriptions', summary: r.slice(0, 200), evidence: [{ label: 'note', value: r.slice(0, 100) }], sample: kpiCorrelation.pairs, direction: kpiCorrelation.verdict === 'positive_candidate' ? 'positive_candidate' : kpiCorrelation.verdict === 'negative_candidate' ? 'negative_candidate' : null }), 'KPI 상관 기록(상관 ≠ 인과)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">MRR 상관 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="관측 요약(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {kpiRows.map((k) => (
            <div key={k.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{k.correlation_code}</span>
              <AdminBadge tone="info">{k.kpi_type}</AdminBadge>
              <AdminBadge tone={k.correlation_status === 'correlational_only' ? 'neutral' : 'warning'}>{k.correlation_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{k.correlation_summary} · 인과 검토는 0517 워크플로만</span>
            </div>
          ))}
          {!kpiRows.length && <AdminEmpty title="KPI 상관 기록 없음" description="Customer Satisfaction 등 원본 없는 KPI 는 kpi_unavailable 로 강제됩니다." />}
        </div>
      )}
      {tab === 'health' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Execution Health(단독 해석 금지)" value={health.score == null ? 'insufficient_data' : String(health.score)} />
            <Box label="Status" value={health.status} />
            <Box label="Coverage" value={`${health.coverage}%`} />
            <Box label="누락 성분" value={health.missing.length ? `${health.missing.length}개` : '없음'} />
          </div>
          <AdminAlert tone={health.status === 'critical_risk_present' ? 'danger' : 'info'} title="Critical Risks(희석 없음)" description={health.criticalRisks.join(' · ') || '없음'} />
          <p className="text-[10px] text-muted-foreground">{health.limitations.join(' · ')} · 9성분: Delivery/Stability/Throughput/Review Latency/Evidence/Completion Quality/Accountability/Confidence/Strategic Progress</p>
        </div>
      )}
      {tab === 'risk' && (
        <div className="space-y-1">
          {criticalRisks.map((r) => (
            <div key={r} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="danger">critical</AdminBadge>
              <span className="ml-2">{r}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Risk 는 평균으로 희석되지 않고 Health 상태를 직접 결정합니다.</p>
        </div>
      )}
      {tab === 'execsummary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">Executive Summary(사람 검토용 — 자동 결정 없음)</p>
            <p className="mt-1">Commitment {commitments.length}건 · Success Rate {successRate.rate == null ? '산출 불가' : `${Math.round(successRate.rate)}% (${successRate.status})`} · Trend {trend.verdict}</p>
            <p>병목 {bottleneck.verdict} · 지연 전파 후보 {crossImpact.impacted.length}건 · Quality {quality.score ?? '—'} · Health {health.status}</p>
            <p>KPI 상관 {kpiCorrelation.verdict}(상관 ≠ 인과) · Critical Risk {criticalRisks.length}건</p>
          </div>
          <p className="text-[10px] text-muted-foreground">MRR {NUM(mrr)}원 · 매장 {NUM(typeof kpiActuals.active_stores === 'number' ? kpiActuals.active_stores : null)} · 아티스트 {NUM(typeof kpiActuals.active_artists === 'number' ? kpiActuals.active_artists : null)} (실측)</p>
        </div>
      )}

      {/* ── Recommendations / Snapshots / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={r.severity === 'high' ? 'danger' : 'info'}>{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'snapshots' && (
        !snapshots.length ? <AdminEmpty title="Snapshot 없음" description="Snapshot 은 덮어쓰지 않고 누적됩니다." /> : (
          <div className="space-y-1">
            {snapshots.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.snapshot_code}</span>
                <AdminBadge tone="info">{s.snapshot_kind}</AdminBadge>
                <AdminBadge tone={s.rate_status === 'sample_too_small' ? 'warning' : 'neutral'}>{s.rate_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">rate {s.success_rate == null ? 'null' : `${Math.round(s.success_rate)}%`} · 표본 {s.sample_size}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_delivery_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 Delivery 자료는 external_reference_only 로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="분석/검토가 이벤트로 남습니다(12종 whitelist)." /> : (
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
          {DELIVERY_SUPPORT.map((s) => (
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
