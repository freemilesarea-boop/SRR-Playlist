/**
 * CorporateIntelligenceSection — Enterprise Corporate Intelligence, Executive Command &
 * Strategic Priority Orchestration Center (Phase AI-OPS-15).
 *
 * Corporate Signal → Materiality/Urgency 검토 → Cross-Domain Conflict → Priority Candidate →
 * Tier(P0~P3) → Executive Attention → Daily Briefing → Agenda → Decision Package →
 * Board Reference → Priority Outcome → Timeline → Audit.
 * Priority Score ≠ 자동 실행 순서 · P0 = 즉시 사람 검토 · Hard Risk 희석 금지 ·
 * 캘린더 자동 생성/보고서 자동 발송 없음 · Board Reference ≠ 법적 이사회 자료.
 *
 * 탭 32개(스펙 45절 전체).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, BookOpen, Briefcase, Calendar, Clock, FileText, GitBranch, Grid3x3,
  History, Layers, Lightbulb, Link2, ListChecks, Lock, RefreshCw, Scale, ScrollText, Shield,
  Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchCorporateIntelSummary, createCorpSignal, reviewCorpSignal, fetchCorpSignals,
  createExecPriority, reviewExecPriority, fetchExecPriorities,
  createCorpConflict, reviewCorpConflict, fetchCorpConflicts,
  createExecAgenda, reviewExecAgenda, fetchExecAgendas,
  recordCorpBriefing, recordCorpExternalAction, fetchCorpIntelAudit,
  type CorporateIntelSummary, type CorpSignalRow, type ExecPriorityRow, type CorpConflictRow,
  type ExecAgendaRow, type CorpIntelEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateMateriality, calculateUrgency, classifyUrgentVsImportant, calculateExecutivePriority,
  classifyPriorityTier, detectCorporateConflict, detectDecisionBottleneck, calculateCorporateHealth,
  detectStrategicOpportunity, detectMaterialRisk, buildExecutiveAttentionCandidate,
  buildExecutiveDailyBriefing, buildExecutiveAgenda, buildDecisionPackage, buildBoardReference,
  buildPriorityDependencyGraph, buildConflictResolutionCandidate, buildCorporateRecommendation,
  buildPriorityOutcomeLink, buildCorporateTimeline, CORP_SUPPORT,
  type HardRiskFlag, type PriorityTier, type UrgentVsImportant, type ConflictType,
  type MaterialityStatus, type UrgencyStatus,
} from '@/lib/corporateIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'signals' | 'whatchanged' | 'health' | 'materiality' | 'urgency' | 'urgentimportant'
  | 'priorities' | 'tiers' | 'opportunities' | 'risks' | 'conflicts' | 'resourceconf' | 'policyconf'
  | 'strategyconf' | 'bottlenecks' | 'attention' | 'briefing' | 'agendas' | 'reviews' | 'board'
  | 'packages' | 'dependencies' | 'mutex' | 'resolution' | 'recommendations' | 'outcomes' | 'timeline'
  | 'humanreviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'signals', label: 'Corporate Signals', icon: BarChart3 },
  { key: 'whatchanged', label: 'What Changed', icon: History },
  { key: 'health', label: 'Corporate Health', icon: Shield },
  { key: 'materiality', label: 'Materiality', icon: Scale },
  { key: 'urgency', label: 'Urgency', icon: Clock },
  { key: 'urgentimportant', label: 'Urgent vs Important', icon: Grid3x3 },
  { key: 'priorities', label: 'Executive Priorities', icon: Target },
  { key: 'tiers', label: 'Priority Tiers', icon: ListChecks },
  { key: 'opportunities', label: 'Strategic Opportunities', icon: TrendingUp },
  { key: 'risks', label: 'Material Risks', icon: AlertTriangle },
  { key: 'conflicts', label: 'Cross-Domain Conflicts', icon: GitBranch },
  { key: 'resourceconf', label: 'Resource Conflicts', icon: GitBranch },
  { key: 'policyconf', label: 'Policy Conflicts', icon: BookOpen },
  { key: 'strategyconf', label: 'Strategy Conflicts', icon: GitBranch },
  { key: 'bottlenecks', label: 'Decision Bottlenecks', icon: Clock },
  { key: 'attention', label: 'Executive Attention', icon: Target },
  { key: 'briefing', label: 'Daily Briefing', icon: FileText },
  { key: 'agendas', label: 'Executive Agendas', icon: Calendar },
  { key: 'reviews', label: 'Weekly·Monthly·Quarterly Reviews', icon: Calendar },
  { key: 'board', label: 'Board References', icon: Briefcase },
  { key: 'packages', label: 'Decision Packages', icon: FileText },
  { key: 'dependencies', label: 'Priority Dependencies', icon: Link2 },
  { key: 'mutex', label: 'Mutually Exclusive', icon: GitBranch },
  { key: 'resolution', label: 'Conflict Resolution', icon: Scale },
  { key: 'recommendations', label: 'Corporate Recommendations', icon: Lightbulb },
  { key: 'outcomes', label: 'Priority Outcomes', icon: Link2 },
  { key: 'timeline', label: 'Corporate Timeline', icon: History },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Executive Actions', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_ACTIONS = ['executive_meeting_reference', 'board_meeting_reference', 'investor_communication_reference', 'partner_negotiation_reference', 'regulatory_response_reference', 'legal_consultation_reference', 'external_audit_reference', 'manual_executive_action_reference'];
const PENDING_STATUSES = ['draft', 'pending_materiality_review', 'pending_urgency_review', 'pending_executive_review', 'under_review'];

export default function CorporateIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<CorporateIntelSummary>({});
  const [signals, setSignals] = useState<CorpSignalRow[]>([]);
  const [priorities, setPriorities] = useState<ExecPriorityRow[]>([]);
  const [conflicts, setConflicts] = useState<CorpConflictRow[]>([]);
  const [agendas, setAgendas] = useState<ExecAgendaRow[]>([]);
  const [audit, setAudit] = useState<CorpIntelEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState(EXT_ACTIONS[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sig, pr, cf, ag, au] = await Promise.all([
        fetchCorporateIntelSummary(), fetchCorpSignals(null, 100), fetchExecPriorities(null, 100),
        fetchCorpConflicts(null, 100), fetchExecAgendas(null, 50), fetchCorpIntelAudit(100),
      ]);
      setSummary(s); setSignals(sig); setPriorities(pr); setConflicts(cf); setAgendas(ag); setAudit(au);
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
  const totalStores = typeof actuals.active_stores === 'number' ? actuals.active_stores : null;

  const signalAnalysis = useMemo(() => signals.map((s) => {
    const hard: HardRiskFlag[] = (['security_risk_change', 'privacy_risk_change', 'compliance_risk_change'].includes(s.signal_type)
      ? [s.signal_type.split('_')[0] as HardRiskFlag] : []);
    const materiality = calculateMateriality({
      monetaryImpactKrw: s.monetary_impact_krw, mrrKrw: mrr,
      affectedStores: null, totalStores, hardRiskFlags: hard, strategicRelevance: null,
    });
    const urgency = calculateUrgency({
      deadlineAt: s.deadline_at ? new Date(s.deadline_at) : null, now,
      escalationVelocity: null, alreadyBreaching: null,
    });
    return { s, hard, materiality, urgency };
  }), [signals, mrr, totalStores, now]);

  const priorityAnalysis = useMemo(() => priorities.map((p) => {
    const hard = (p.hard_risk_flags ?? []) as HardRiskFlag[];
    const score = calculateExecutivePriority({
      materialityScore: p.materiality_score, urgencyScore: p.urgency_score,
      hardRiskFlags: hard, blastRadiusScore: null, confidence: null,
    });
    const tier = classifyPriorityTier({
      priorityScore: p.priority_score ?? score.score, hardRiskFlags: hard,
      urgencyStatus: p.urgency_status as UrgencyStatus, materialityStatus: p.materiality_status as MaterialityStatus,
    });
    const uvi = classifyUrgentVsImportant(p.materiality_status as MaterialityStatus, p.urgency_status as UrgencyStatus);
    return { p, hard, score, tier, uvi };
  }), [priorities]);

  const bottleneck = useMemo(() => {
    const pending = priorities.filter((p) => PENDING_STATUSES.includes(p.priority_status));
    const oldest = pending.length ? Math.max(...pending.map((p) => (now.getTime() - new Date(p.created_at).getTime()) / 86400000)) : null;
    return detectDecisionBottleneck({
      pendingReviewCount: priorities.length ? pending.length : null,
      oldestPendingDays: oldest == null ? null : Math.floor(oldest),
      p0PendingCount: pending.filter((p) => p.priority_tier === 'P0_human_review_now').length,
    });
  }, [priorities, now]);

  const health = useMemo(() => calculateCorporateHealth({
    revenueHealth: mrr != null && mrr > 0 ? 70 : mrr === 0 ? 20 : null,
    growthHealth: null, costHealth: null,
    reliabilityHealth: typeof actuals.open_incidents === 'number' ? (actuals.open_incidents === 0 ? 80 : 40) : null,
    securityHealth: null, settlementHealth: null,
    criticalRisks: ['PayApp 단일 결제 의존(코드 실측)', 'Supabase 단일 인프라 의존(코드 실측)', '단일 Admin 운영(실측)'],
    unknownFactors: ['인건비/마케팅비(cost_unknown)', '시장/경쟁사(market_data_unavailable)'],
  }), [mrr, actuals]);

  const opportunity = useMemo(() => detectStrategicOpportunity({
    growthSignalCount: signals.filter((s) => ['store_growth_change', 'enterprise_growth_change', 'artist_growth_change'].includes(s.signal_type)).length,
    positiveOutcomeCount: typeof actuals.decision_outcomes === 'number' ? actuals.decision_outcomes : null,
    capacityHeadroom: null,
    evidence: signals.length ? signals.slice(0, 3).map((s) => s.signal_code) : null,
  }), [signals, actuals]);

  const materialRisks = useMemo(() => signalAnalysis.map(({ s, hard }) => ({
    s,
    risk: detectMaterialRisk({ hardRiskFlags: hard, monetaryImpactKrw: s.monetary_impact_krw, mrrKrw: mrr, singlePointDependencies: [] }),
  })).filter((x) => x.risk.verdict === 'material_risk_candidate' || x.risk.verdict === 'watch_risk_candidate'), [signalAnalysis, mrr]);

  const globalRisk = useMemo(() => detectMaterialRisk({
    hardRiskFlags: [], monetaryImpactKrw: null, mrrKrw: mrr,
    singlePointDependencies: ['PayApp(결제)', 'Supabase(인프라)', 'Vercel(배포)', '단일 Admin'],
  }), [mrr]);

  const attention = useMemo(() => priorityAnalysis
    .map(({ p, uvi }) => buildExecutiveAttentionCandidate({ code: p.priority_code, tier: p.priority_tier as PriorityTier, urgentVsImportant: uvi as UrgentVsImportant, deadlineAt: p.deadline_at ? new Date(p.deadline_at) : null, now }))
    .filter((r): r is Exclude<typeof r, { excluded: true; why: string }> => !('excluded' in r))
    .sort((a, b) => a.attentionRank - b.attentionRank), [priorityAnalysis, now]);

  const briefing = useMemo(() => buildExecutiveDailyBriefing({
    date: now.toISOString().slice(0, 10),
    whatChanged: signals.slice(0, 10).map((s) => ({ title: s.title, evidence: [s.source_system] })),
    whatMatters: priorityAnalysis.filter(({ tier }) => tier.tier === 'P0_human_review_now' || tier.tier === 'P1_executive_review').map(({ p, tier }) => ({ title: p.title, tier: tier.tier })),
    decisionRequired: priorityAnalysis.filter(({ p, tier }) => tier.tier === 'P0_human_review_now' && PENDING_STATUSES.includes(p.priority_status)).map(({ p }) => ({ title: p.title, deadline: p.deadline_at })),
    canWait: priorityAnalysis.filter(({ tier }) => tier.tier === 'P2_planned_review' || tier.tier === 'P3_monitor').map(({ p }) => p.title),
    mustNotDo: ['자동 가격/계약/정산 변경', '자동 예산/투자 집행', '자동 Priority 확정', '자동 이사회 안건 확정/발송'],
  }), [signals, priorityAnalysis, now]);

  const agendaPreview = useMemo(() => buildExecutiveAgenda({
    window: 'daily',
    priorities: priorityAnalysis.map(({ p, tier }) => ({ code: p.priority_code, tier: tier.tier })),
    conflicts: conflicts.filter((c) => !['resolved_reference', 'accepted_tradeoff', 'invalidated'].includes(c.conflict_status)).map((c) => c.conflict_code),
    risks: materialRisks.slice(0, 5).map(({ s }) => s.signal_code),
  }), [priorityAnalysis, conflicts, materialRisks]);

  const decisionPackage = useMemo(() => {
    const top = priorityAnalysis.find(({ tier }) => tier.tier === 'P0_human_review_now' || tier.tier === 'P1_executive_review');
    if (!top) return null;
    return buildDecisionPackage({
      title: top.p.title,
      options: [
        { name: '옵션 A: 우선 검토·대응', expectedImpact: top.p.expected_impact ?? '기대 효과 미상(과장 금지)', risks: top.hard.map((h) => `hard_risk:${h}`), evidence: [top.p.priority_code] },
      ],
      evidence: [top.p.priority_code],
    });
  }, [priorityAnalysis]);

  const boardRef = useMemo(() => buildBoardReference({
    period: now.toISOString().slice(0, 7),
    healthStatus: health.status,
    topPriorities: priorityAnalysis.filter(({ tier }) => tier.tier !== 'P3_monitor' && tier.tier !== 'insufficient_data').slice(0, 10).map(({ p }) => p.title),
    materialRisks: [...health.criticalRisks, ...materialRisks.slice(0, 5).map(({ s }) => s.title)],
    openConflicts: conflicts.filter((c) => !['resolved_reference', 'accepted_tradeoff', 'invalidated'].includes(c.conflict_status)).map((c) => c.title),
    evidence: ['admin_corporate_intel_summary'],
  }), [health, priorityAnalysis, materialRisks, conflicts, now]);

  const depGraph = useMemo(() => {
    const edges = priorities.flatMap((p) => ((p.dependencies ?? []) as unknown[]).filter((d): d is string => typeof d === 'string').map((d) => ({ from: p.priority_code, to: d })));
    const root = priorities[0]?.priority_code;
    return root ? buildPriorityDependencyGraph(edges, root) : { nodes: [], cycles: [], truncated: false };
  }, [priorities]);

  const pairConflictScan = useMemo(() => {
    const out: { a: string; b: string; verdict: string; types: string[] }[] = [];
    const top = priorities.slice(0, 8);
    for (let i = 0; i < top.length; i += 1) {
      for (let j = i + 1; j < top.length; j += 1) {
        const pa = top[i]; const pb = top[j];
        const paDeadline = pa.deadline_at; const pbDeadline = pb.deadline_at;
        const r = detectCorporateConflict(
          { id: pa.id, domain: pa.priority_domain, resources: ((pa.dependencies ?? []) as unknown[]).filter((d): d is string => typeof d === 'string'), deadlineAt: paDeadline ? new Date(paDeadline) : null, direction: null },
          { id: pb.id, domain: pb.priority_domain, resources: ((pb.dependencies ?? []) as unknown[]).filter((d): d is string => typeof d === 'string'), deadlineAt: pbDeadline ? new Date(pbDeadline) : null, direction: null },
        );
        if (r.verdict === 'conflict_candidate') out.push({ a: pa.priority_code, b: pb.priority_code, verdict: r.verdict, types: r.conflictTypes });
      }
    }
    return out;
  }, [priorities]);

  const resolutions = useMemo(() => conflicts.map((c) => ({
    c,
    r: buildConflictResolutionCandidate({ conflictType: c.conflict_type as ConflictType, severity: c.severity === 'critical' || c.severity === 'high' || c.severity === 'medium' || c.severity === 'low' ? c.severity : null, bothSidesPreserved: Boolean(c.side_a_summary && c.side_b_summary), evidence: [c.conflict_code] }),
  })), [conflicts]);

  const autoRecs = useMemo(() => {
    const out: { type: string; rationale: string }[] = [];
    const push = (r: ReturnType<typeof buildCorporateRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, rationale: r.rationale }); };
    const p0 = priorityAnalysis.filter(({ p, tier }) => tier.tier === 'P0_human_review_now' && PENDING_STATUSES.includes(p.priority_status)).length;
    if (p0 > 0) push(buildCorporateRecommendation({ type: 'review_p0_priority_now', rationale: `P0 ${p0}건 사람 검토 대기(자동 실행 아님)`, evidence: [`p0_pending:${p0}`], expectedBenefit: null }));
    if (bottleneck.verdict === 'material_bottleneck' || bottleneck.verdict === 'bottleneck_candidate') push(buildCorporateRecommendation({ type: 'resolve_decision_bottleneck', rationale: bottleneck.reasons.join(' · '), evidence: bottleneck.reasons, expectedBenefit: null }));
    push(buildCorporateRecommendation({ type: 'review_material_risk', rationale: '단일 Provider(PayApp/Supabase)·단일 Admin 의존(코드 실측)', evidence: ['dependency_scan(0517)'], expectedBenefit: null }));
    const unverified = signals.filter((s) => s.materiality_status === 'materiality_unverified').length;
    if (unverified > 0) push(buildCorporateRecommendation({ type: 'collect_missing_evidence', rationale: `Materiality 미검증 신호 ${unverified}건 — 검토 필요(0 변환 금지)`, evidence: [`materiality_unverified:${unverified}`], expectedBenefit: null }));
    return out;
  }, [priorityAnalysis, bottleneck, signals]);

  const outcomeLinks = useMemo(() => priorities.filter((p) => p.priority_status === 'accepted_reference').map((p) => ({
    p,
    link: buildPriorityOutcomeLink({ priorityCode: p.priority_code, outcomeRef: null, observationClosed: null, evidence: [p.priority_code] }),
  })), [priorities]);

  const timeline = useMemo(() => buildCorporateTimeline(audit.map((e) => ({ at: new Date(e.created_at), kind: e.event_type, label: e.detail ?? e.event_type })), 50), [audit]);

  if (loading) return <AdminCard title="Enterprise Corporate Intelligence & Executive Command Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Corporate Intelligence & Executive Command Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const tiersByStatus = (summary.priorities_by_tier ?? {}) as Record<string, number>;

  return (
    <AdminCard
      title="Enterprise Corporate Intelligence & Executive Command Center"
      subtitle="Corporate Signal→Materiality/Urgency→충돌→Priority(P0~P3)→Attention→Briefing→Agenda→Decision Package→Board Reference — Priority Score ≠ 자동 실행 순서(P0 = 즉시 사람 검토)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 경영 결정/Priority 확정/예산/투자/인력/가격/계약/정산/정책/플레이리스트/서버/영업 실행, 자동 보고서 발송, 자동 이사회 안건 확정, 자동 Confidence/Weight 수정, 자동 모델 학습, Governance/Trust/Constitution 자동 변경, Merge/Deploy/Migration/Production Apply 는 없습니다. Priority Score 는 자동 실행 순서가 아니고 P0 는 즉시 사람 검토 대상입니다. Hard Security/Privacy/Compliance Risk 는 평균으로 희석되지 않으며 비금전 Risk 를 0 으로 평가하지 않습니다. Agenda 는 캘린더를 만들지 않고 Board Reference 는 법적 이사회 자료가 아닙니다." />
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
            <Box label="Corporate Signals" value={NUM(summary.signals_total as number)} />
            <Box label="Materiality 미검증" value={NUM(summary.materiality_unverified as number)} />
            <Box label="Urgency 미검증" value={NUM(summary.urgency_unverified as number)} />
            <Box label="Priority Candidates" value={NUM(priorities.length)} />
            <Box label="P0(즉시 사람 검토)" value={NUM(summary.p0_pending_human_review as number)} />
            <Box label="P1 후보" value={NUM(tiersByStatus.P1_executive_review ?? 0)} />
            <Box label="Conflicts" value={NUM(conflicts.length)} />
            <Box label="Decision Bottleneck" value={bottleneck.verdict} />
            <Box label="Corporate Health" value={`${health.score == null ? '—' : health.score} / ${health.status}`} />
            <Box label="Agendas" value={NUM(agendas.length)} />
            <Box label="Briefings 기록" value={NUM(summary.briefings_recorded as number)} />
            <Box label="시장 데이터" value={String(actuals.market_data ?? 'market_data_unavailable')} />
            <Box label="캘린더 연동" value={String(actuals.calendar_integration ?? 'not_integrated')} />
            <Box label="보고서 발송" value={String(actuals.board_report_delivery ?? 'not_sent')} />
            <Box label="자동 경영 실행" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 실측: MRR {NUM(mrr)}원 · 활성 매장 {NUM(totalStores)} · 아티스트 {NUM(typeof actuals.active_artists === 'number' ? actuals.active_artists : null)} · open incidents {NUM(typeof actuals.open_incidents === 'number' ? actuals.open_incidents : null)} · 인과 후보 {NUM(typeof actuals.causal_candidates === 'number' ? actuals.causal_candidates : null)}</p>
        </div>
      )}

      {/* ── Signals ── */}
      {tab === 'signals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createCorpSignal({ code: `csig_mrr_${now.toISOString().slice(0, 19)}`, domain: 'revenue', type: 'mrr_change', sourceSystem: 'subscriptions', title: 'MRR 관측', observedAt: now.toISOString(), evidence: [{ label: 'note', value: r.slice(0, 100) }], metricName: 'mrr', metricValue: mrr, unit: 'krw' }), 'MRR Signal 기록(우선순위 확정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">MRR Signal 기록</button>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createCorpSignal({ code: `csig_store_${now.toISOString().slice(0, 19)}`, domain: 'store', type: 'store_growth_change', sourceSystem: 'users', title: '활성 매장 관측', observedAt: now.toISOString(), evidence: [{ label: 'note', value: r.slice(0, 100) }], metricName: 'active_stores', metricValue: totalStores, unit: 'count' }), '매장 Signal 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">매장 Signal 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="관측 메모(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!signals.length ? <AdminEmpty title="Signal 없음" description="관측 신호는 우선순위/실행 확정이 아닙니다." /> : signals.slice(0, 40).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.signal_code}</span>
                <AdminBadge tone="info">{s.signal_type}</AdminBadge>
                <AdminBadge tone={s.materiality_status === 'materiality_unverified' ? 'warning' : 'neutral'}>{s.materiality_status}</AdminBadge>
                <AdminBadge tone={s.urgency_status === 'urgency_unverified' ? 'warning' : 'neutral'}>{s.urgency_status}</AdminBadge>
                <span className="text-muted-foreground">{s.title} · {s.metric_name ?? '—'} = {s.metric_value == null ? 'insufficient_data' : NUM(s.metric_value)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── What Changed ── */}
      {tab === 'whatchanged' && (
        !signals.length ? <AdminEmpty title="변화 없음" description="최근 관측 신호가 없습니다." /> : (
          <div className="space-y-1">
            {signals.slice(0, 20).map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{new Date(s.observed_at).toISOString().slice(0, 10)}</span>
                <span className="ml-2">{s.title}</span>
                <span className="ml-2 text-muted-foreground">{s.source_system} · baseline {s.baseline_value == null ? '—' : NUM(s.baseline_value)} → {s.metric_value == null ? 'insufficient_data' : NUM(s.metric_value)}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Corporate Health ── */}
      {tab === 'health' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Health Score(단독 해석 금지)" value={health.score == null ? 'insufficient_data' : String(health.score)} />
            <Box label="Status" value={health.status} />
            <Box label="Coverage" value={`${health.coverage}%`} />
            <Box label="누락 구성 요소" value={health.missing.length ? health.missing.join(', ') : '없음'} />
          </div>
          <AdminAlert tone={health.status === 'critical_risk_present' ? 'danger' : 'info'} title="Critical Risks(평균 희석 없음)" description={health.criticalRisks.join(' · ') || '없음'} />
          <AdminAlert tone="warning" title="Unknown Factors" description={health.unknownFactors.join(' · ') || '없음'} />
          <p className="text-[10px] text-muted-foreground">{health.limitations.join(' · ')}</p>
        </div>
      )}

      {/* ── Materiality ── */}
      {tab === 'materiality' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!signalAnalysis.length ? <AdminEmpty title="Signal 없음" description="비금전 Risk 는 0 으로 평가하지 않습니다(금액 미상 → materiality_unverified)." /> : signalAnalysis.slice(0, 30).map(({ s, materiality }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.signal_code}</span>
                <AdminBadge tone={materiality.status === 'material_candidate' ? 'danger' : materiality.status === 'materiality_unverified' ? 'warning' : 'neutral'}>{materiality.status}</AdminBadge>
                <span className="text-muted-foreground">score {materiality.score == null ? 'null(0 변환 금지)' : materiality.score} · {materiality.note}</span>
              </div>
              {!['dismissed_reference', 'invalidated'].includes(s.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['material_candidate', 'possibly_material', 'not_material_candidate'] as const).map((ms) => (
                    <button key={ms} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCorpSignal({ id: s.id, reason: rr, materialityStatus: ms, materialityScore: materiality.score, reviewStatus: 'materiality_reviewed' }), `materiality: ${ms}`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{ms}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Urgency ── */}
      {tab === 'urgency' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!signalAnalysis.length ? <AdminEmpty title="Signal 없음" description="Urgency 는 deadline 기반 후보이며 자동 실행이 아닙니다." /> : signalAnalysis.slice(0, 30).map(({ s, urgency }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.signal_code}</span>
                <AdminBadge tone={urgency.status === 'urgent_candidate' ? 'danger' : urgency.status === 'urgency_unverified' ? 'warning' : 'neutral'}>{urgency.status}</AdminBadge>
                <span className="text-muted-foreground">score {urgency.score == null ? 'null' : urgency.score} · D{urgency.daysToDeadline == null ? '—' : Math.ceil(urgency.daysToDeadline)} · 자동 실행 아님</span>
              </div>
              {!['dismissed_reference', 'invalidated'].includes(s.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['urgent_candidate', 'possibly_urgent', 'not_urgent_candidate'] as const).map((us) => (
                    <button key={us} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCorpSignal({ id: s.id, reason: rr, urgencyStatus: us, urgencyScore: urgency.score, reviewStatus: 'urgency_reviewed' }), `urgency: ${us}`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{us}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Urgent vs Important ── */}
      {tab === 'urgentimportant' && (
        !priorityAnalysis.length ? <AdminEmpty title="Priority 없음" description="Urgent 와 Important 는 별도 축으로 분리 기록됩니다." /> : (
          <div className="space-y-1">
            {(['urgent_and_important', 'important_not_urgent', 'urgent_not_important', 'neither_candidate', 'insufficient_data'] as const).map((q) => {
              const items = priorityAnalysis.filter(({ uvi }) => uvi === q);
              return (
                <div key={q} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={q === 'urgent_and_important' ? 'danger' : q === 'insufficient_data' ? 'warning' : 'neutral'}>{q}</AdminBadge>
                  <span className="ml-2 font-bold">{items.length}건</span>
                  <p className="mt-1 text-muted-foreground">{items.slice(0, 5).map(({ p }) => p.title).join(' · ') || '—'}</p>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Priorities ── */}
      {tab === 'priorities' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !signals.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const top = signalAnalysis[0];
              void act(() => createExecPriority({ code: `eprio_${now.toISOString().slice(0, 19)}`, type: 'revenue_protection', title: r.slice(0, 100), domain: top?.s.signal_domain ?? 'revenue', evidence: [{ label: 'signal', value: top?.s.signal_code ?? 'manual' }], sourceSignalIds: top ? [top.s.id] : [], materialityScore: top?.materiality.score ?? null, materialityStatus: top?.materiality.status ?? 'materiality_unverified', urgencyScore: top?.urgency.score ?? null, urgencyStatus: top?.urgency.status ?? 'urgency_unverified' }), 'Priority 후보 생성(자동 실행 순서 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Priority 후보 생성(최근 Signal)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Priority 제목/사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!priorities.length ? <AdminEmpty title="Priority 후보 없음" description="Priority Score 는 자동 실행 순서가 아닙니다." /> : priorities.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{p.priority_code}</span>
                <AdminBadge tone={p.priority_tier === 'P0_human_review_now' ? 'danger' : p.priority_tier === 'insufficient_data' ? 'warning' : 'info'}>{p.priority_tier}</AdminBadge>
                <AdminBadge tone={PENDING_STATUSES.includes(p.priority_status) ? 'warning' : p.priority_status === 'accepted_reference' ? 'success' : 'neutral'}>{p.priority_status}</AdminBadge>
                {(p.hard_risk_flags ?? []).length > 0 && <AdminBadge tone="danger">hard: {(p.hard_risk_flags as string[]).join(',')}</AdminBadge>}
                {(p.warnings ?? []).length > 0 && <AdminBadge tone="warning">warnings {p.warnings.length}</AdminBadge>}
              </div>
              <p className="mt-1">{p.title} · score {p.priority_score == null ? 'null' : p.priority_score}</p>
              {!['rejected', 'invalidated'].includes(p.priority_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['under_review', 'accepted_reference', 'deferred', 'monitoring', 'rejected'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewExecPriority(p.id, st, rr), `${st}(실행 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Tiers ── */}
      {tab === 'tiers' && (
        <div className="space-y-1">
          {(['P0_human_review_now', 'P1_executive_review', 'P2_planned_review', 'P3_monitor', 'insufficient_data'] as const).map((t) => {
            const items = priorityAnalysis.filter(({ tier }) => tier.tier === t);
            return (
              <div key={t} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={t === 'P0_human_review_now' ? 'danger' : t === 'insufficient_data' ? 'warning' : 'info'}>{t}</AdminBadge>
                <span className="ml-2 font-bold">{items.length}건</span>
                <span className="ml-2 text-muted-foreground">{t === 'P0_human_review_now' ? '즉시 사람 검토(자동 실행 아님)' : t === 'insufficient_data' ? 'Tier 확정 금지(데이터 부족)' : items.slice(0, 4).map(({ p }) => p.title).join(' · ') || '—'}</span>
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground">Hard Risk 존재 시 P3_monitor 강등은 서버 CHECK + RPC 에서 차단됩니다(평균 희석 금지).</p>
        </div>
      )}

      {/* ── Opportunities / Risks ── */}
      {tab === 'opportunities' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={opportunity.verdict === 'opportunity_candidate' ? 'success' : opportunity.verdict === 'insufficient_data' ? 'warning' : 'neutral'}>{opportunity.verdict}</AdminBadge>
            <span className="ml-2 text-muted-foreground">성장 신호 기반 후보 — 성공 보장 아님(guaranteed=false)</span>
          </div>
          {opportunity.evidence.length > 0 && <p className="text-[10px] text-muted-foreground">Evidence: {opportunity.evidence.join(' · ')}</p>}
          <AdminAlert tone="info" description="시장/경쟁사 데이터 없음(market_data_unavailable) — 기회 판정은 내부 신호만 사용한 후보입니다." />
        </div>
      )}
      {tab === 'risks' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone="danger">{globalRisk.verdict}</AdminBadge>
            <p className="mt-1 text-muted-foreground">{globalRisk.reasons.join(' · ')}</p>
          </div>
          {!materialRisks.length ? <AdminEmpty title="Signal 기반 Material Risk 후보 없음" description="비금전 Risk 는 0 으로 평가하지 않습니다 — Hard Risk 는 금액 미상이어도 material." /> : materialRisks.map(({ s, risk }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.signal_code}</span>
              <AdminBadge tone={risk.verdict === 'material_risk_candidate' ? 'danger' : 'warning'}>{risk.verdict}</AdminBadge>
              <p className="mt-1 text-muted-foreground">{risk.reasons.join(' · ')}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Conflicts ── */}
      {tab === 'conflicts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || priorities.length < 2} onClick={() => {
              const r = needReason(); if (!r) return;
              const [a, b] = priorities;
              void act(() => createCorpConflict({ code: `cconf_${now.toISOString().slice(0, 19)}`, type: 'priority_conflict', title: r.slice(0, 100), domain: a.priority_domain, sideA: `${a.priority_code}: ${a.title}`, sideB: `${b.priority_code}: ${b.title}`, evidence: [{ label: 'priorities', value: `${a.priority_code}/${b.priority_code}` }] }), '충돌 기록(자동 해소 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">충돌 기록(최근 Priority 2건)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="충돌 제목/사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {pairConflictScan.length > 0 && (
            <AdminAlert tone="warning" title={`자동 스캔 충돌 후보 ${pairConflictScan.length}건`} description={pairConflictScan.slice(0, 5).map((x) => `${x.a}↔${x.b}(${x.types.join(',')})`).join(' · ')} />
          )}
          {!conflicts.length ? <AdminEmpty title="충돌 없음" description="충돌은 평균으로 숨기지 않고 양쪽 입장을 보존합니다." /> : conflicts.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.conflict_code}</span>
                <AdminBadge tone="info">{c.conflict_type}</AdminBadge>
                <AdminBadge tone={c.severity === 'critical' ? 'danger' : c.severity === 'severity_unverified' ? 'warning' : 'neutral'}>{c.severity}</AdminBadge>
                <AdminBadge tone={['resolved_reference', 'accepted_tradeoff'].includes(c.conflict_status) ? 'success' : 'neutral'}>{c.conflict_status}</AdminBadge>
              </div>
              <p className="mt-1">A: {c.side_a_summary}</p>
              <p>B: {c.side_b_summary}</p>
              {!['invalidated'].includes(c.conflict_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['under_review', 'resolution_candidate_proposed', 'resolved_reference', 'accepted_tradeoff', 'deferred'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCorpConflict(c.id, st, rr), st); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(tab === 'resourceconf' || tab === 'policyconf' || tab === 'strategyconf') && (() => {
        const types = tab === 'resourceconf' ? ['resource_conflict', 'budget_conflict', 'personnel_capacity_conflict', 'timeline_conflict'] : tab === 'policyconf' ? ['policy_conflict', 'compliance_vs_speed_conflict', 'risk_appetite_conflict'] : ['strategy_conflict', 'priority_conflict', 'growth_vs_margin_conflict', 'short_term_vs_long_term_conflict'];
        const items = conflicts.filter((c) => types.includes(c.conflict_type));
        return !items.length ? <AdminEmpty title="해당 축 충돌 없음" description={`축: ${types.join(', ')}`} /> : (
          <div className="space-y-1">
            {items.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.conflict_code}</span>
                <AdminBadge tone="info">{c.conflict_type}</AdminBadge>
                <AdminBadge tone="neutral">{c.conflict_status}</AdminBadge>
                <p className="mt-1 text-muted-foreground">A: {c.side_a_summary} / B: {c.side_b_summary}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Bottlenecks ── */}
      {tab === 'bottlenecks' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={bottleneck.verdict === 'material_bottleneck' ? 'danger' : bottleneck.verdict === 'bottleneck_candidate' ? 'warning' : 'neutral'}>{bottleneck.verdict}</AdminBadge>
            <p className="mt-1 text-muted-foreground">{bottleneck.reasons.length ? bottleneck.reasons.join(' · ') : '알려진 병목 없음'}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">병목 해소는 사람 검토 촉진 권고일 뿐 자동 승인/실행이 아닙니다.</p>
        </div>
      )}

      {/* ── Attention ── */}
      {tab === 'attention' && (
        !attention.length ? <AdminEmpty title="Attention 후보 없음" description="P0/P1/P2 후보가 생기면 여기 정렬됩니다(자동 실행 아님)." /> : (
          <div className="space-y-1">
            {attention.map((a) => (
              <div key={a.code} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={a.attentionRank === 1 ? 'danger' : a.attentionRank === 2 ? 'warning' : 'neutral'}>rank {a.attentionRank}</AdminBadge>
                <span className="ml-2 font-mono font-bold">{a.code}</span>
                <span className="ml-2 text-muted-foreground">{a.reason}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        'insufficient' in briefing ? <AdminAlert tone="warning" title="Briefing 생성 불가" description={briefing.why} /> : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => recordCorpBriefing('briefing_generated', r, { date: briefing.date, sections: briefing.sections as unknown as Record<string, unknown> }), 'Briefing 기록(자동 발송 없음)');
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Briefing Event 기록</button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            </div>
            {([['What Changed', briefing.sections.whatChanged.map((w) => `${w.title} (${w.evidence.join(',')})`)], ['What Matters', briefing.sections.whatMatters.map((w) => `${w.title} [${w.tier}]`)], ['Decision Required(사람 결정)', briefing.sections.decisionRequired.map((d) => `${d.title}${d.deadline ? ` ~${d.deadline.slice(0, 10)}` : ''}`)], ['Can Wait', briefing.sections.canWait], ['Must Not Do', briefing.sections.mustNotDo]] as const).map(([label, items]) => (
              <div key={label} className="rounded-lg border border-border p-2 text-[11px]">
                <p className="font-bold">{label}</p>
                {items.length ? items.map((i, idx) => <p key={idx} className="text-muted-foreground">· {i}</p>) : <p className="text-muted-foreground">—</p>}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">{briefing.limitations.join(' · ')}</p>
          </div>
        )
      )}

      {/* ── Agendas ── */}
      {tab === 'agendas' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createExecAgenda({ code: `eag_${now.toISOString().slice(0, 19)}`, type: agendaPreview.items.some((i) => i.kind === 'p0_immediate_review') ? 'p0_immediate_review' : 'daily_briefing_review', title: r.slice(0, 100), evidence: [{ label: 'items', value: String(agendaPreview.items.length) }], window: 'daily', items: agendaPreview.items as unknown as Array<Record<string, unknown>>, linkedPriorityIds: [] }), 'Agenda 기록(캘린더 생성 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">오늘 Agenda 기록({agendaPreview.items.length}건)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Agenda 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!agendas.length ? <AdminEmpty title="Agenda 없음" description="Agenda 는 기록일 뿐 캘린더를 만들지 않으며 확정 ≠ 실행입니다." /> : agendas.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{a.agenda_code}</span>
                <AdminBadge tone="info">{a.agenda_type}</AdminBadge>
                <AdminBadge tone={a.agenda_status === 'confirmed_reference' ? 'success' : 'neutral'}>{a.agenda_status}</AdminBadge>
                <span className="text-muted-foreground">{a.title} · items {a.items.length}</span>
              </div>
              {!['cancelled', 'invalidated'].includes(a.agenda_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['pending_executive_review', 'confirmed_reference', 'completed_reference', 'cancelled'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewExecAgenda(a.id, st, rr), `${st}(확정 ≠ 실행)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Weekly·Monthly·Quarterly Reviews ── */}
      {tab === 'reviews' && (
        <div className="space-y-2">
          {(['weekly_review', 'monthly_review', 'quarterly_review'] as const).map((t) => {
            const items = agendas.filter((a) => a.agenda_type === t);
            return (
              <div key={t} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{t}</AdminBadge>
                <span className="ml-2 font-bold">{items.length}건</span>
                <span className="ml-2 text-muted-foreground">{items.slice(0, 3).map((a) => `${a.title}(${a.agenda_status})`).join(' · ') || '기록 없음'}</span>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createExecAgenda({ code: `eag_w_${now.toISOString().slice(0, 19)}`, type: 'weekly_review', title: r.slice(0, 100), evidence: [{ label: 'window', value: 'weekly' }], window: 'weekly' }), 'Weekly Review Agenda 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Review 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Review 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
        </div>
      )}

      {/* ── Board References ── */}
      {tab === 'board' && (
        'insufficient' in boardRef ? <AdminAlert tone="warning" title="Board Reference 생성 불가" description={boardRef.why} /> : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => recordCorpBriefing('board_reference_created', r, { period: boardRef.period, summary: boardRef.summary as unknown as Record<string, unknown> }), 'Board Reference 기록(법적 자료 아님·발송 없음)');
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Board Reference 기록</button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            </div>
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <p className="font-bold">{boardRef.period} · Health: {boardRef.summary.healthStatus}</p>
              <p className="mt-1">Top Priorities: {boardRef.summary.topPriorities.join(' · ') || '—'}</p>
              <p>Material Risks(생략 금지): {boardRef.summary.materialRisks.join(' · ') || '—'}</p>
              <p>Open Conflicts: {boardRef.summary.openConflicts.join(' · ') || '—'}</p>
            </div>
            <p className="text-[10px] text-muted-foreground">{boardRef.limitations.join(' · ')}</p>
          </div>
        )
      )}

      {/* ── Decision Packages ── */}
      {tab === 'packages' && (
        !decisionPackage ? <AdminEmpty title="Package 대상 없음" description="P0/P1 후보가 생기면 Decision Package 초안이 구성됩니다." /> :
        'insufficient' in decisionPackage ? <AdminAlert tone="warning" title="Package 생성 불가" description={decisionPackage.why} /> : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => recordCorpBriefing('decision_package_created', r, { title: decisionPackage.title, options: decisionPackage.options as unknown as Record<string, unknown>[] } as unknown as Record<string, unknown>), 'Decision Package 기록(사람 결정 필요)');
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Package Event 기록</button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            </div>
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <p className="font-bold">{decisionPackage.title}</p>
              {decisionPackage.options.map((o, i) => (
                <div key={i} className="mt-1 rounded-md border border-border p-1.5">
                  <p className="font-bold">{o.name}</p>
                  <p className="text-muted-foreground">기대: {o.expectedImpact} · 위험: {o.risks.join(', ') || '—'}</p>
                </div>
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground">No Action 옵션 포함 · humanDecisionRequired · 자동 실행 없음</p>
            </div>
          </div>
        )
      )}

      {/* ── Dependencies / Mutex ── */}
      {tab === 'dependencies' && (
        !depGraph.nodes.length ? <AdminEmpty title="의존 그래프 없음" description="Priority dependencies 기반 · depth 기본 3(최대 5) · cycle 방어." /> : (
          <div className="space-y-1">
            {depGraph.nodes.map((n) => (
              <div key={n.code} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{'· '.repeat(n.depth)}{n.code}</span>
                <AdminBadge tone="neutral">depth {n.depth}</AdminBadge>
              </div>
            ))}
            {depGraph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지" description={depGraph.cycles.join(' · ')} />}
            {depGraph.truncated && <p className="text-[10px] text-muted-foreground">depth 제한으로 일부 생략(silent truncation 아님 — 명시)</p>}
          </div>
        )
      )}
      {tab === 'mutex' && (() => {
        const items = priorities.filter((p) => ((p.mutually_exclusive_with ?? []) as unknown[]).length > 0);
        return !items.length ? <AdminEmpty title="상호 배타 관계 없음" description="mutually_exclusive_with 가 기록된 Priority 가 없습니다." /> : (
          <div className="space-y-1">
            {items.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.priority_code}</span>
                <span className="ml-2 text-muted-foreground">배타: {(p.mutually_exclusive_with as unknown[]).map(String).join(', ')}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Resolution ── */}
      {tab === 'resolution' && (
        !resolutions.length ? <AdminEmpty title="충돌 없음" description="해소 후보는 자동 해소가 아니며 사람 승인 필요입니다." /> : (
          <div className="space-y-1">
            {resolutions.map(({ c, r }) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.conflict_code}</span>
                {'insufficient' in r ? <AdminBadge tone="warning">{r.why}</AdminBadge> : (<><AdminBadge tone="info">{r.type}</AdminBadge><span className="ml-2 text-muted-foreground">{r.rationale}</span></>)}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.rationale}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Outcomes ── */}
      {tab === 'outcomes' && (
        !outcomeLinks.length ? <AdminEmpty title="Outcome 연결 대상 없음" description="accepted_reference Priority 가 생기면 Outcome 연결 후보가 표시됩니다. 연결 ≠ 인과." /> : (
          <div className="space-y-1">
            {outcomeLinks.map(({ p, link }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.priority_code}</span>
                {'insufficient' in link ? <AdminBadge tone="warning">{link.why}</AdminBadge> : (<><AdminBadge tone="neutral">{link.linkStatus}</AdminBadge><span className="ml-2 text-muted-foreground">causallyAttributed=false(인과는 0517 워크플로만)</span></>)}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Timeline ── */}
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

      {/* ── Human Reviews ── */}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['priority_reviewed', 'conflict_reviewed', 'agenda_reviewed', 'materiality_reviewed', 'urgency_reviewed', 'human_review_recorded'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="모든 확정은 사람 검토를 통해서만 이뤄집니다." /> : (
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

      {/* ── External ── */}
      {tab === 'external' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordCorpExternalAction(extAction, r, [{ label: 'note', value: r.slice(0, 200) }]), '외부 경영 활동 기록(진위 자동 보장 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">외부 활동 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="활동 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {(() => { const ext = audit.filter((e) => e.event_type === 'external_executive_action_reference'); return !ext.length ? <AdminEmpty title="외부 활동 없음" description="이사회/투자자/파트너/규제 대응 등은 참조 기록만 합니다." /> : ext.slice(0, 30).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
          )); })()}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="모든 기록/검토가 이벤트로 남습니다(18종 whitelist)." /> : (
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

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="space-y-1">
          {CORP_SUPPORT.map((s) => (
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
