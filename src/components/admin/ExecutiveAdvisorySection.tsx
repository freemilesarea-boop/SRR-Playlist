/**
 * ExecutiveAdvisorySection — Autonomous Executive Advisory, Decision Synthesis &
 * Human Approval Center (Phase AI-OPS-40).
 *
 * Enterprise State→Decision Context→Evidence→Multi-Agent Advisory→Decision Options→
 * Policy Constraints→Impact/Trade-off/Robustness/Regret→Reversibility/Feasibility→
 * Executive Brief→Recommendation Candidate→Human Executive Review→
 * Decision/Commitment/Outcome Reference→Quality/Drift→Learning→Audit.
 * Advisory ≠ Decision · Brief ≠ Approval · Option ≠ Selected Option ·
 * Approval Reference ≠ Applied Change · Agent Agreement ≠ Truth.
 * 자동 Decision/승인/실행/Policy 적용/Payment/Settlement·Contract·Production 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, DollarSign, Gauge, Grid3x3,
  History, Inbox, Layers, Lightbulb, ListOrdered, Lock, RefreshCw, Scale, Search,
  Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecutiveAdvisorySummary, fetchDecisionContexts, createDecisionContext, reviewDecisionContext,
  fetchDecisionOptions, createDecisionOption, reviewDecisionOption, fetchExecutiveBriefs,
  createExecutiveBrief, reviewExecutiveBrief, recordExecutiveReview, recordExecutiveAdvisoryEvent,
  fetchExecutiveAdvisoryAudit,
  type ExecutiveAdvisorySummary, type DecisionContextRow, type DecisionOptionRow,
  type ExecutiveBriefRow, type ExecutiveAdvisoryEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  DECISION_DOMAINS, DECISION_OPTION_TYPES, ADVISORY_SYNTHESIS_RESULTS, AGENT_AGREEMENT_RESULTS,
  AGENT_CONFLICT_RESULTS, EVIDENCE_QUALITY_RESULTS, CONSTRAINT_RESULTS, IMPACT_SYNTHESIS_RESULTS,
  FINANCIAL_IMPACT_RESULTS, REVERSIBILITY_RESULTS, FEASIBILITY_RESULTS, TRADEOFF_AXES,
  TRADEOFF_RESULTS, ROBUSTNESS_RESULTS, REGRET_RESULTS, EXECUTIVE_RECOMMENDATION_TYPES,
  DECISION_QUALITY_RESULTS, DECISION_DRIFT_RESULTS, buildExecutiveTimeline,
  EXECUTIVE_COMPONENTS, EXECUTIVE_SUPPORT_MATRIX,
} from '@/lib/executiveAdvisory';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'contexts' | 'pendingevidence' | 'pendingadvisory' | 'pendingreview'
  | 'critical' | 'urgent' | 'options' | 'noaction' | 'deferopts' | 'evidenceopts' | 'advisory'
  | 'agreement' | 'conflicts' | 'evidence' | 'evidencegaps' | 'evidenceconflicts' | 'policycon'
  | 'constitutioncon' | 'compliancecon' | 'contractcon' | 'financialcon' | 'impact' | 'ifinancial'
  | 'icapacity' | 'ioperational' | 'isecurity' | 'iprivacy' | 'icompliance' | 'icustomer' | 'iworkload'
  | 'tradeoff' | 'robustness' | 'regret' | 'reversibility' | 'feasibility' | 'briefs' | 'recommendations'
  | 'humanreviews' | 'approved' | 'rejected' | 'deferred' | 'revisions' | 'decisionrefs' | 'commitrefs'
  | 'observation' | 'reviewtriggers' | 'outcomes' | 'quality' | 'drift' | 'learning' | 'timeline'
  | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'inbox', label: 'Decision Inbox', icon: Inbox },
  { key: 'contexts', label: 'Decision Contexts', icon: BookOpen },
  { key: 'pendingevidence', label: 'Pending Evidence', icon: Search },
  { key: 'pendingadvisory', label: 'Pending Advisory', icon: Users },
  { key: 'pendingreview', label: 'Pending Executive Review', icon: Scale },
  { key: 'critical', label: 'Critical Decisions', icon: AlertTriangle },
  { key: 'urgent', label: 'Urgent Decisions', icon: AlertTriangle },
  { key: 'options', label: 'Decision Options', icon: ListOrdered },
  { key: 'noaction', label: 'No Action Options', icon: ListOrdered },
  { key: 'deferopts', label: 'Deferred Options', icon: History },
  { key: 'evidenceopts', label: 'Evidence Gathering Options', icon: Search },
  { key: 'advisory', label: 'Multi-Agent Advisory', icon: Users },
  { key: 'agreement', label: 'Agent Agreement', icon: Users },
  { key: 'conflicts', label: 'Agent Conflicts', icon: AlertTriangle },
  { key: 'evidence', label: 'Evidence', icon: Search },
  { key: 'evidencegaps', label: 'Evidence Gaps', icon: Search },
  { key: 'evidenceconflicts', label: 'Evidence Conflicts', icon: AlertTriangle },
  { key: 'policycon', label: 'Policy Constraints', icon: Lock },
  { key: 'constitutioncon', label: 'Constitutional Constraints', icon: Lock },
  { key: 'compliancecon', label: 'Compliance Constraints', icon: Shield },
  { key: 'contractcon', label: 'Contract Constraints', icon: ClipboardList },
  { key: 'financialcon', label: 'Financial Constraints', icon: DollarSign },
  { key: 'impact', label: 'Impact Synthesis', icon: Layers },
  { key: 'ifinancial', label: 'Financial Impact', icon: DollarSign },
  { key: 'icapacity', label: 'Capacity Impact', icon: Activity },
  { key: 'ioperational', label: 'Operational Impact', icon: Activity },
  { key: 'isecurity', label: 'Security Impact', icon: Shield },
  { key: 'iprivacy', label: 'Privacy Impact', icon: Shield },
  { key: 'icompliance', label: 'Compliance Impact', icon: Shield },
  { key: 'icustomer', label: 'Customer Experience Impact', icon: Users },
  { key: 'iworkload', label: 'Human Workload Impact', icon: Users },
  { key: 'tradeoff', label: 'Trade-off Analysis', icon: Scale },
  { key: 'robustness', label: 'Robustness', icon: Gauge },
  { key: 'regret', label: 'Regret Analysis', icon: Scale },
  { key: 'reversibility', label: 'Reversibility', icon: RefreshCw },
  { key: 'feasibility', label: 'Feasibility', icon: Gauge },
  { key: 'briefs', label: 'Executive Briefs', icon: BookOpen },
  { key: 'recommendations', label: 'Recommendation Candidates', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Executive Reviews', icon: Users },
  { key: 'approved', label: 'Approved References', icon: Scale },
  { key: 'rejected', label: 'Rejected References', icon: Scale },
  { key: 'deferred', label: 'Deferred References', icon: History },
  { key: 'revisions', label: 'Revision Requests', icon: RefreshCw },
  { key: 'decisionrefs', label: 'Decision References', icon: ClipboardList },
  { key: 'commitrefs', label: 'Commitment References', icon: ClipboardList },
  { key: 'observation', label: 'Observation Plans', icon: Search },
  { key: 'reviewtriggers', label: 'Review Triggers', icon: TrendingUp },
  { key: 'outcomes', label: 'Decision Outcomes', icon: Search },
  { key: 'quality', label: 'Decision Quality', icon: Gauge },
  { key: 'drift', label: 'Decision Drift', icon: Activity },
  { key: 'learning', label: 'Decision Learning', icon: Lightbulb },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 Executive Decision 없음 — 모든 승인/거절/보류는 사람 Reference 기록(production_applied 항상 false)',
  '경영진 조직도/Reviewer Role Directory 데이터 없음 — Owner Role/Reviewer Role 은 Candidate 문자열',
  'Agent Advisory 는 ai_agents(0497) 8종 시드 기반 — 실행 이력 데이터 부족 시 advisory_input_unavailable',
  'Agent Independence 검증기 없음 — 공유 Evidence 의존은 shared_evidence_dependency_candidate 로만 표시',
  'Evidence Reliability 평가 모델 없음 — Evidence Volume ≠ Evidence Quality',
  'Financial Impact 는 Estimate 중심(회계 실적 피드 없음) — Accounting Fact 아님, Revenue 데이터 제한',
  'Contract/Settlement/Payment 영향은 Reference 중심 — 원문/원본 변경·조회 없음',
  'Reversibility 는 실제 Rollback 보장 아님 · Feasibility 는 리소스 예약 아님',
  'Historical Decision Outcome 표본 부족 가능 — Quality 는 Outcome 연결 후에만, Drift 는 장기 관찰 필요',
  'Correlation ≠ Causality — Outcome Link 는 인과 증명이 아님, Human Executive Review 필수',
  'Migration 0472~0544 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

const IMPACT_TAB_DOMAIN: Partial<Record<Tab, string>> = {
  icapacity: 'capacity', ioperational: 'operational', isecurity: 'security',
  iprivacy: 'privacy', icompliance: 'compliance', icustomer: 'customer_experience', iworkload: 'human_workload',
};
const CONSTRAINT_TAB_KIND: Partial<Record<Tab, string>> = {
  policycon: 'policy', constitutioncon: 'constitution', compliancecon: 'compliance',
  contractcon: 'contract', financialcon: 'financial',
};

export default function ExecutiveAdvisorySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ExecutiveAdvisorySummary>({});
  const [contexts, setContexts] = useState<DecisionContextRow[]>([]);
  const [options, setOptions] = useState<DecisionOptionRow[]>([]);
  const [briefs, setBriefs] = useState<ExecutiveBriefRow[]>([]);
  const [audit, setAudit] = useState<ExecutiveAdvisoryEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selCtx, setSelCtx] = useState('');
  const [selOpt, setSelOpt] = useState('');
  const [selBrief, setSelBrief] = useState('');
  const [domain, setDomain] = useState<string>('capacity_planning');
  const [optionType, setOptionType] = useState<string>('reversible_action_reference');
  const [axisSel, setAxisSel] = useState<string>('risk_vs_cost');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, c, o, b, a] = await Promise.all([
        fetchExecutiveAdvisorySummary(), fetchDecisionContexts(null, 200), fetchDecisionOptions(null, null, 200),
        fetchExecutiveBriefs(null, null, 200), fetchExecutiveAdvisoryAudit(200),
      ]);
      setSummary(s); setContexts(c); setOptions(o); setBriefs(b); setAudit(a);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const ctxReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selCtx) { if (!selCtx) toast.error('Context 선택 필수'); return; }
    void act(() => reviewDecisionContext(selCtx, action, r, payload), ok);
  };
  const optReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selOpt) { if (!selOpt) toast.error('Option 선택 필수'); return; }
    void act(() => reviewDecisionOption(selOpt, action, r, payload), ok);
  };
  const briefReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selBrief) { if (!selBrief) toast.error('Brief 선택 필수'); return; }
    void act(() => reviewExecutiveBrief(selBrief, action, r, payload), ok);
  };
  const execReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selCtx) { if (!selCtx) toast.error('Context 선택 필수'); return; }
    void act(() => recordExecutiveReview(selCtx, action, r, payload), ok);
  };
  const exEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { ctx?: boolean; opt?: boolean; brief?: boolean } = { ctx: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordExecutiveAdvisoryEvent(kind, r, payload, ids.ctx ? (selCtx || null) : null, ids.opt ? (selOpt || null) : null, ids.brief ? (selBrief || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildExecutiveTimeline({ present: {
    decision_context: (num('contexts', 'total') ?? 0) > 0,
    evidence: (num('executive_events', 'evidence_records') ?? 0) > 0,
    agent_advisory: (num('executive_events', 'agent_advisories') ?? 0) > 0,
    decision_options: (num('options', 'total') ?? 0) > 0,
    policy_constraints: (num('executive_events', 'policy_constraints') ?? 0) > 0,
    impact_synthesis: (num('executive_events', 'impact_syntheses') ?? 0) > 0,
    executive_brief: (num('briefs', 'total') ?? 0) > 0,
    executive_review: (num('executive_events', 'executive_approvals') ?? 0) + (num('executive_events', 'executive_rejections') ?? 0) + (num('executive_events', 'executive_defers') ?? 0) > 0,
    decision_reference: (num('executive_events', 'decision_references') ?? 0) > 0,
    outcome: (num('executive_events', 'outcome_links') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Executive Advisory & Human Decision Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Executive Advisory & Human Decision Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const ctxSelect = (
    <select value={selCtx} onChange={(e) => setSelCtx(e.target.value)} className="min-w-[190px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Context 선택</option>
      {contexts.map((c) => <option key={c.id} value={c.id}>{c.decision_code} · {c.decision_status}</option>)}
    </select>
  );
  const optSelect = (
    <select value={selOpt} onChange={(e) => setSelOpt(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Option 선택</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.option_code} · {o.option_status}</option>)}
    </select>
  );
  const briefSelect = (
    <select value={selBrief} onChange={(e) => setSelBrief(e.target.value)} className="min-w-[170px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Brief 선택</option>
      {briefs.map((b) => <option key={b.id} value={b.id}>{b.brief_code} v{b.brief_version} · {b.brief_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('viable') || s.includes('ready') || s.includes('feasible_candidate') || s.includes('robust_option') || s.includes('high_quality') || s.includes('closed_reference') || s.includes('clear') ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('infeasible') || s.includes('critical') || s.includes('irreversible') || s.includes('unavailable') || s === 'unsupported' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: ExecutiveAdvisoryEventRow[], emptyTitle: string, emptyDesc: string) => (
    !rows.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {rows.slice(0, 30).map((e) => (
          <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(String(e.payload?.result ?? e.event_type))}>{e.event_type}</AdminBadge>
            <span className="ml-2">{e.detail}</span>
            <span className="ml-2 text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const ctxList = (list: DecisionContextRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((c) => (
          <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(c.decision_status)}>{c.decision_status}</AdminBadge>
            <AdminBadge tone={tone(c.priority_candidate)}>{c.priority_candidate}</AdminBadge>
            <AdminBadge tone={tone(c.urgency_candidate)}>{c.urgency_candidate}</AdminBadge>
            <span className="ml-2 font-bold">{c.decision_code}</span>
            <span className="ml-2 text-muted-foreground">{c.decision_domain} · {c.decision_title}{c.decision_deadline_reference ? ` · deadline ${new Date(c.decision_deadline_reference).toLocaleDateString('ko-KR')}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const optList = (list: DecisionOptionRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(o.option_status)}>{o.option_status}</AdminBadge>
            <span className="ml-2 font-bold">{o.option_code}</span>
            <span className="ml-2 text-muted-foreground">{o.option_type} · {o.option_name}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], ids: { ctx?: boolean; opt?: boolean; brief?: boolean } = { ctx: true }, extraPayload: Record<string, unknown> = {}, filter?: (e: ExecutiveAdvisoryEventRow) => boolean) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.ctx ? ctxSelect : null}{ids.opt ? optSelect : null}{ids.brief ? briefSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => exEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(filter ? evByType(kind).filter(filter) : evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );
  const impactDomain = IMPACT_TAB_DOMAIN[tab];
  const constraintKind = CONSTRAINT_TAB_KIND[tab];

  return (
    <AdminCard
      title="Executive Advisory & Human Decision Center"
      subtitle="Enterprise State→Decision Context→Evidence→Multi-Agent Advisory→Options→Constraints→Impact/Trade-off/Robustness/Regret→Brief→Recommendation Candidate→Human Executive Review→Decision·Commitment·Outcome Reference→Quality/Drift/Learning — 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 여러 AI-OPS 분석을 하나의 경영 의사결정 문맥으로 통합해 사람이 결정할 수 있게 설명합니다. AI 는 정보 수집·충돌 탐지·선택지 구성·장단점 설명·권고 후보 생성까지만 수행하며, 실제 Decision 실행/자동 승인·거절/Commitment 확정/Policy 적용/Threshold·Runtime·Connector·Automation·Capacity·Infrastructure 변경/Payment/Refund/Settlement·Contract·Pricing 변경/Alert·Email·Slack·Push 발송/Ticket·Issue 생성/Deploy/Merge/Migration Apply 는 수행하지 않습니다. Advisory ≠ Decision, Brief ≠ Approval, Option ≠ Selected Option, Approval Reference ≠ Applied Change, Agent Agreement ≠ Truth, Confidence ≠ Correctness. 실행하지 않은 Decision 을 Implemented 로 표시하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Decision Contexts" value={NUM(num('contexts', 'total'))} />
            <Box label="Pending Evidence" value={NUM(num('contexts', 'pending_evidence'))} />
            <Box label="Pending Advisory" value={NUM(num('contexts', 'pending_advisory'))} />
            <Box label="Pending Executive Review" value={NUM(num('contexts', 'pending_executive_review'))} />
            <Box label="Critical Priority Candidates" value={NUM(num('contexts', 'critical_priority'))} />
            <Box label="Immediate Review Candidates" value={NUM(num('contexts', 'immediate_review'))} />
            <Box label="Decision Options" value={NUM(num('options', 'total'))} />
            <Box label="Viable / Cond. Viable" value={`${NUM(num('options', 'viable'))} / ${NUM(num('options', 'conditionally_viable'))}`} />
            <Box label="Blocked / Infeasible Options" value={`${NUM(num('options', 'blocked'))} / ${NUM(num('options', 'infeasible'))}`} />
            <Box label="No Action / Defer / Evidence" value={`${NUM(num('options', 'no_action'))} / ${NUM(num('options', 'defer'))} / ${NUM(num('options', 'evidence_gathering'))}`} />
            <Box label="Agent Advisories" value={NUM(num('executive_events', 'agent_advisories'))} />
            <Box label="Agreement / Conflict Reviews" value={`${NUM(num('executive_events', 'agent_agreements'))} / ${NUM(num('executive_events', 'agent_conflicts'))}`} />
            <Box label="Evidence Gaps / Conflicts" value={`${NUM(num('executive_events', 'evidence_gaps'))} / ${NUM(num('executive_events', 'evidence_conflicts'))}`} />
            <Box label="Constraint Reviews" value={NUM(num('executive_events', 'policy_constraints'))} />
            <Box label="Impact Syntheses" value={NUM(num('executive_events', 'impact_syntheses'))} />
            <Box label="Reversibility / Feasibility" value={`${NUM(num('executive_events', 'reversibility_reviews'))} / ${NUM(num('executive_events', 'feasibility_reviews'))}`} />
            <Box label="Trade-off / Robustness / Regret" value={`${NUM(num('executive_events', 'tradeoff_reviews'))} / ${NUM(num('executive_events', 'robustness_reviews'))} / ${NUM(num('executive_events', 'regret_reviews'))}`} />
            <Box label="Executive Briefs" value={NUM(num('briefs', 'total'))} />
            <Box label="Briefs Ready / Under Review" value={`${NUM(num('briefs', 'ready_for_executive_review'))} / ${NUM(num('briefs', 'under_executive_review'))}`} />
            <Box label="Recommendation Candidates" value={NUM(num('executive_events', 'recommendations'))} />
            <Box label="Approved / Rejected / Deferred" value={`${NUM(num('contexts', 'approved_references'))} / ${NUM(num('contexts', 'rejected_references'))} / ${NUM(num('contexts', 'deferred_references'))}`} />
            <Box label="Revision Requests" value={NUM(num('contexts', 'revision_requested'))} />
            <Box label="Decision / Commitment Refs" value={`${NUM(num('executive_events', 'decision_references'))} / ${NUM(num('executive_events', 'commitment_links'))}`} />
            <Box label="Outcome Pending / Linked" value={`${NUM(num('contexts', 'outcome_pending'))} / ${NUM(num('executive_events', 'outcome_links'))}`} />
            <Box label="Quality / Drift Reviews" value={`${NUM(num('executive_events', 'quality_reviews'))} / ${NUM(num('executive_events', 'drift_reviews'))}`} />
            <Box label="Learning References" value={NUM(num('executive_events', 'learning_references'))} />
          </div>
          <AdminAlert tone="info" description={`advisory_unavailable: ${Array.isArray(summary.advisory_unavailable) ? (summary.advisory_unavailable as unknown[]).map(String).join(', ') : '—'}. Advisory 원천 실측 — Decision Memory(0514) ${NUM(num('advisory_actuals', 'decision_memory_0514'))}건 · Commitments(0520) ${NUM(num('advisory_actuals', 'commitments_0520'))}건 · Agents(0497) ${NUM(num('advisory_actuals', 'agents_0497'))}건 · Scenario Runs(0542) ${NUM(num('advisory_actuals', 'scenario_runs_0542'))}건 · Forecast Runs(0543) ${NUM(num('advisory_actuals', 'forecast_runs_0543'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="결정 대기함 — draft/pending/ready/under review 상태의 Context. 가장 중요한 사안이 무엇인지, 왜 지금 결정해야 하는지 사람이 판단합니다." />
          {ctxList(contexts.filter((c) => ['draft', 'pending_evidence', 'pending_advisory', 'pending_review', 'ready_for_executive_review_reference', 'under_executive_review', 'revision_requested'].includes(c.decision_status)), 'Inbox 비어 있음', '0건은 결정할 사안이 없음을 의미하지 않습니다(No Detected ≠ None).')}
        </div>
      )}

      {tab === 'contexts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {DECISION_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {reasonInput}
            {btn('Decision Context 생성(≠ Decision)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createDecisionContext({ decision_domain: domain, decision_title: r, decision_question: r }), 'Context 생성됨(draft — 실제 의사결정 아님)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Evidence 요청', () => ctxReview('request_evidence', {}, 'pending_evidence'))}
            {btn('Advisory 대기', () => ctxReview('mark_pending_advisory', {}, 'pending_advisory'))}
            {btn('검토 시작', () => ctxReview('start_review', {}, 'pending_review'))}
            {btn('Executive Review 상정(Evidence)', () => ctxReview('mark_ready_for_executive_review', { evidence: [reason.trim()] }, 'ready(승인 아님 — 사람 검토 대기)'), true)}
            {btn('Outcome 대기', () => ctxReview('mark_outcome_pending', {}, 'outcome_pending'))}
            {btn('종결(Evidence)', () => ctxReview('close_reference', { evidence: [reason.trim()] }, 'closed_reference'))}
            {btn('제한부 종결(Evidence)', () => ctxReview('close_with_limitation', { evidence: [reason.trim()] }, 'closed_with_limitation'))}
            {btn('대체', () => ctxReview('supersede', {}, 'superseded'))}
            {btn('무효화', () => ctxReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="금지 도메인 13종(자동 투자/결제/계약/채용·해고/신용/법률/의료/Production 등) 서버 차단 · Executive 승인/거절/보류는 Human Executive Reviews 탭 전용." />
          {ctxList(contexts, 'Decision Context 없음', '핵심 질문 예: 지금 결정해야 할 가장 중요한 사안은? 아무것도 안 하면? 대안별 비용·위험·기회는? — 전부 Advisory 분석.')}
        </div>
      )}

      {tab === 'pendingevidence' && ctxList(contexts.filter((c) => c.decision_status === 'pending_evidence'), 'Pending Evidence 없음', 'Evidence 요청 상태의 Context 가 여기에 표시됩니다.')}
      {tab === 'pendingadvisory' && ctxList(contexts.filter((c) => c.decision_status === 'pending_advisory'), 'Pending Advisory 없음', 'Agent Advisory 대기 상태의 Context 가 여기에 표시됩니다.')}
      {tab === 'pendingreview' && ctxList(contexts.filter((c) => ['ready_for_executive_review_reference', 'under_executive_review'].includes(c.decision_status)), 'Pending Executive Review 없음', '경영진 검토 대기/진행 Context 가 여기에 표시됩니다.')}
      {tab === 'critical' && ctxList(contexts.filter((c) => c.priority_candidate === 'critical_candidate'), 'Critical Decision 없음', 'Priority Candidate ≠ 경영 우선순위 확정 — 0건은 위험 없음이 아닙니다.')}
      {tab === 'urgent' && ctxList(contexts.filter((c) => ['urgent_candidate', 'immediate_review_candidate'].includes(c.urgency_candidate)), 'Urgent Decision 없음', 'Urgency ≠ 자동 승인 — deadline 은 Reference 입니다.')}

      {tab === 'options' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}
            <select value={optionType} onChange={(e) => setOptionType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {DECISION_OPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Option 생성(≠ 실행 계획)', () => {
              const r = needReason();
              if (!r || !selCtx) { if (!selCtx) toast.error('Context 선택 필수'); return; }
              void act(() => createDecisionOption({ decision_context_id: selCtx, option_type: optionType, option_name: r }), 'Option 생성됨(draft — 선택 완료 아님)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {optSelect}{reasonInput}
            {btn('Evidence 요청', () => optReview('request_evidence', {}, 'pending_evidence'))}
            {btn('검토 시작', () => optReview('start_review', {}, 'pending_review'))}
            {btn('Viable', () => optReview('mark_viable', {}, 'viable_candidate(선택 완료 아님)'), true)}
            {btn('조건부 Viable', () => optReview('mark_conditionally_viable', {}, 'conditionally_viable_candidate'))}
            {btn('차단', () => optReview('mark_blocked', {}, 'blocked_candidate'))}
            {btn('실행 불가', () => optReview('mark_infeasible', {}, 'infeasible_candidate'))}
            {btn('기각 Reference', () => optReview('reject_reference', {}, 'rejected_reference'))}
            {btn('무효화', () => optReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="금지 Option Type 6종(direct_production_execution/automatic_payment 등) 서버 차단 · Context당 최대 20개 · Viable Candidate ≠ 선택 완료." />
          {optList(options, 'Decision Option 없음', 'No Action/Defer/Gather Evidence 옵션도 명시적으로 생성해 비교합니다.')}
        </div>
      )}
      {tab === 'noaction' && optList(options.filter((o) => o.is_no_action_option), 'No Action Option 없음', '아무것도 하지 않는 선택지도 명시적 Option 으로 비교합니다.')}
      {tab === 'deferopts' && optList(options.filter((o) => o.is_defer_option), 'Defer Option 없음', '결정을 미루는 선택지가 여기에 표시됩니다.')}
      {tab === 'evidenceopts' && optList(options.filter((o) => o.is_evidence_gathering_option), 'Evidence Gathering Option 없음', '추가 Evidence 수집 후 재검토 선택지가 여기에 표시됩니다.')}

      {tab === 'advisory' && resultEventTab('agent_advisory_recorded', 'Agent Advisory 기록', 'Multi-Agent Advisory 수집(최대 50) — Advisory ≠ Decision · Consensus ≠ Truth · 자동 Option 선택 없음.', ADVISORY_SYNTHESIS_RESULTS)}
      {tab === 'agreement' && resultEventTab('agent_agreement_reviewed', 'Agent Agreement 검토', 'Agent Majority ≠ Correctness — 다수결로 Option 을 자동 선택하지 않습니다.', AGENT_AGREEMENT_RESULTS)}
      {tab === 'conflicts' && resultEventTab('agent_conflict_reviewed', 'Agent Conflict 검토', 'Agent Conflict ≠ Error — 충돌 원인(Evidence/Scope/Assumption/Version)을 사람이 검토합니다.', AGENT_CONFLICT_RESULTS)}
      {tab === 'evidence' && resultEventTab('evidence_recorded', 'Evidence 기록', 'Evidence Volume ≠ Evidence Quality — Freshness/Independence/Scope/Version 검토.', EVIDENCE_QUALITY_RESULTS)}
      {tab === 'evidencegaps' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Evidence Gap 기록', () => exEvent('evidence_gap_recorded', { note: 'evidence_missing' }, 'Evidence Gap 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="핵심 근거가 없으면 evidence_missing — 미탐지 ≠ 없음." />
          {eventList(evByType('evidence_gap_recorded'), 'Evidence Gap 없음', 'Evidence 공백 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'evidenceconflicts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Evidence Conflict 기록', () => exEvent('evidence_conflict_recorded', { note: 'evidence_conflict_candidate' }, 'Evidence Conflict 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="동일 key 에 상충 값 — 자동 채택 없이 사람이 해소합니다." />
          {eventList(evByType('evidence_conflict_recorded'), 'Evidence Conflict 없음', 'Evidence 충돌 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {constraintKind != null && resultEventTab('policy_constraint_reviewed', `${constraintKind} Constraint 검토`, 'AI 는 Constraint 를 우회하지 않습니다 — Block 판정 시 해당 Option 은 사람 재검토 대상.', CONSTRAINT_RESULTS, { ctx: true, opt: true }, { constraint_kind: constraintKind }, (e) => String(e.payload?.constraint_kind ?? '') === constraintKind)}

      {tab === 'impact' && resultEventTab('impact_synthesis_recorded', 'Impact Synthesis 기록', 'Risk/Opportunity/Cost/Capacity/Runtime/Security/Privacy/Compliance/Contract/Customer/Workload 종합 — Settlement·Payment 는 Reference 만.', IMPACT_SYNTHESIS_RESULTS)}
      {tab === 'ifinancial' && resultEventTab('financial_impact_reviewed', 'Financial Impact 검토', 'Financial Impact Candidate ≠ Accounting Fact — Estimate 중심(회계 실적 피드 없음).', FINANCIAL_IMPACT_RESULTS, { ctx: true, opt: true })}
      {impactDomain != null && resultEventTab('impact_synthesis_recorded', `${impactDomain} Impact 기록`, `${impactDomain} 도메인 영향 Candidate — 실제 변경 없음(Impact ≠ 실측 결과).`, IMPACT_SYNTHESIS_RESULTS, { ctx: true, opt: true }, { domain: impactDomain }, (e) => String(e.payload?.domain ?? '') === impactDomain)}

      {tab === 'tradeoff' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{optSelect}
            <select value={axisSel} onChange={(e) => setAxisSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRADEOFF_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={(TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : TRADEOFF_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRADEOFF_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Trade-off 기록', () => exEvent('tradeoff_reviewed', { axis: axisSel, result: (TRADEOFF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : TRADEOFF_RESULTS[0] }, 'Trade-off 기록됨', { ctx: true, opt: true }), true)}
          </div>
          <AdminAlert tone="info" description="12개 축(risk_vs_cost/speed_vs_safety/growth_vs_stability 등) — 자동 점수 순위로 최종 선택하지 않습니다." />
          {eventList(evByType('tradeoff_reviewed'), 'Trade-off 없음', '축별 트레이드오프 검토가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'robustness' && resultEventTab('robustness_reviewed', 'Robustness 검토', 'Base/Best/Worst/No Action 케이스 견고성 — Robust Option ≠ Correct Option.', ROBUSTNESS_RESULTS, { ctx: true, opt: true })}
      {tab === 'regret' && resultEventTab('regret_reviewed', 'Regret 검토', '최악 손실·기회비용·가역성 비교 — Lowest Regret Candidate ≠ Best Decision.', REGRET_RESULTS, { ctx: true, opt: true })}
      {tab === 'reversibility' && resultEventTab('reversibility_reviewed', 'Reversibility 검토', 'Reversibility Candidate ≠ Guaranteed Rollback — 계약/비용/운영 비가역성 검토.', REVERSIBILITY_RESULTS, { ctx: true, opt: true })}
      {tab === 'feasibility' && resultEventTab('feasibility_reviewed', 'Feasibility 검토', 'Feasibility ≠ 리소스 예약 — 승인자/예산 Reference/Capacity/일정 검토.', FEASIBILITY_RESULTS, { ctx: true, opt: true })}

      {tab === 'briefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Executive Brief 생성(≠ Approval)', () => {
              const r = needReason();
              if (!r || !selCtx) { if (!selCtx) toast.error('Context 선택 필수'); return; }
              void act(() => createExecutiveBrief({ decision_context_id: selCtx, executive_summary: r, why_now: r }), 'Brief 생성됨(draft — Decision/Approval 아님)');
            }, true)}
            {btn('새 버전 생성', () => {
              const r = needReason();
              if (!r || !selCtx || !selBrief) { if (!selCtx || !selBrief) toast.error('Context+이전 Brief 선택 필수'); return; }
              void act(() => createExecutiveBrief({ decision_context_id: selCtx, executive_summary: r, previous_brief_id: selBrief }), '새 버전 생성됨(이전 버전 superseded)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {briefSelect}{reasonInput}
            {btn('Evidence 요청', () => briefReview('request_evidence', {}, 'pending_evidence'))}
            {btn('Advisory 대기', () => briefReview('mark_pending_advisory', {}, 'pending_advisory'))}
            {btn('검토 시작', () => briefReview('start_review', {}, 'pending_review'))}
            {btn('Executive Review 상정(Evidence)', () => briefReview('mark_ready_for_executive_review', { evidence: [reason.trim()] }, 'ready(승인 아님)'), true)}
            {btn('Executive 검토 시작', () => briefReview('start_executive_review', {}, 'under_executive_review'))}
            {btn('수정 요청', () => briefReview('request_revision', {}, 'revision_requested'))}
            {btn('검토 완료(≠ 승인)', () => briefReview('mark_reviewed', {}, 'reviewed_reference(승인 아님)'))}
            {btn('무효화', () => briefReview('invalidate', {}, '무효화'))}
          </div>
          {!briefs.length ? <AdminEmpty title="Executive Brief 없음" description="Why Now/No Action Consequence/Trade-off/Reversibility 를 사람이 읽을 수 있게 요약합니다 — Brief ≠ Approval." /> : (
            <div className="space-y-1">
              {briefs.slice(0, 30).map((b) => (
                <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(b.brief_status)}>{b.brief_status}</AdminBadge>
                  <span className="ml-2 font-bold">{b.brief_code} v{b.brief_version}</span>
                  <span className="ml-2 text-muted-foreground">{b.recommendation_candidate ?? 'recommendation 없음'} · confidence {NUM(b.confidence)} · human_approval_required {String(b.human_approval_required)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{briefSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXECUTIVE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation Candidate 기록(Evidence)', () => exEvent('recommendation_candidate_recorded', { recommendation_type: recTypeSel, evidence: [reason.trim()] }, 'Recommendation Candidate 기록됨(≠ Approval)', { ctx: true, brief: true }), true)}
          </div>
          <AdminAlert tone="info" description="20 유형 전부 Candidate — Evidence 필수(서버 거부) · 자동 선택/승인/실행 없음 · Human Executive Approval Required." />
          {eventList(evByType('recommendation_candidate_recorded'), 'Recommendation 없음', '권고 후보 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'humanreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{briefSelect}{reasonInput}
            {btn('Executive 검토 시작', () => execReview('start_executive_review', { executive_brief_id: selBrief || null }, 'under_executive_review'))}
            {btn('Approve Reference(Evidence)', () => execReview('approve_reference', { executive_brief_id: selBrief || null, selected_option_reference: selOpt || null, evidence: [reason.trim()] }, 'approved_reference(Applied Change 아님)'), true)}
            {btn('조건부 Approve Reference', () => execReview('approve_with_conditions_reference', { executive_brief_id: selBrief || null, selected_option_reference: selOpt || null, evidence: [reason.trim()], conditions: [reason.trim()] }, 'approved_reference(조건부 — 적용 아님)'))}
            {btn('Reject Reference', () => execReview('reject_reference', {}, 'rejected_reference'))}
            {btn('Defer Reference', () => execReview('defer_reference', {}, 'deferred_reference'))}
            {btn('수정 요청', () => execReview('request_revision_reference', {}, 'revision_requested'))}
            {btn('Evidence 추가 요청', () => execReview('request_more_evidence_reference', {}, 'pending_evidence'))}
            {btn('전문가 검토 요청', () => execReview('request_specialist_review_reference', {}, 'pending_advisory'))}
            {btn('무효화', () => execReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Approve Reference ≠ 실제 Production Apply(production_applied 항상 false) · Self-Approval 서버 차단 · Evidence 없는 승인 거부 · 승인/거절/보류/수정 전부 Reason 필수." />
          {eventList(audit.filter((e) => ['executive_review_started', 'executive_approval_reference_recorded', 'executive_rejection_reference_recorded', 'executive_defer_reference_recorded', 'executive_revision_requested'].includes(e.event_type)), 'Executive Review 없음', '사람 경영 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'approved' && ctxList(contexts.filter((c) => c.decision_status === 'approved_reference'), 'Approved Reference 없음', 'approved_reference 는 실제 적용 완료가 아닙니다(production_applied=false).')}
      {tab === 'rejected' && ctxList(contexts.filter((c) => c.decision_status === 'rejected_reference'), 'Rejected Reference 없음', '거절 Reference 가 여기에 표시됩니다.')}
      {tab === 'deferred' && ctxList(contexts.filter((c) => c.decision_status === 'deferred_reference'), 'Deferred Reference 없음', '보류 Reference 가 여기에 표시됩니다.')}
      {tab === 'revisions' && ctxList(contexts.filter((c) => c.decision_status === 'revision_requested'), 'Revision Request 없음', '수정 요청 상태의 Context 가 여기에 표시됩니다.')}

      {tab === 'decisionrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Decision Reference 기록', () => exEvent('decision_reference_recorded', { decision_reference_type: 'manual_reference' }, 'Decision Reference 기록됨(≠ Execution)'), true)}
          </div>
          <AdminAlert tone="info" description="Decision Reference ≠ 실제 실행 — production_applied 는 서버가 false 로 고정합니다." />
          {eventList(evByType('decision_reference_recorded'), 'Decision Reference 없음', '결정 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'commitrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Commitment Reference 연결', () => exEvent('commitment_reference_linked', { note: 'commitment_reference_only' }, 'Commitment Reference 연결됨(자동 완료 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="Commitment 실존 검증(0520) — Commitment Reference ≠ Completed Commitment, 자동 완료 없음." />
          {eventList(evByType('commitment_reference_linked'), 'Commitment Reference 없음', '커밋먼트 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'observation' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Observation Plan Reference — 결정 후 무엇을 관찰할지. Brief/Review 의 observation_plan_reference 를 표시합니다(자동 Polling 없음)." />
          {!briefs.filter((b) => b.observation_plan_reference != null).length ? <AdminEmpty title="Observation Plan 없음" description="Brief 에 observation_plan_reference 가 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {briefs.filter((b) => b.observation_plan_reference != null).slice(0, 30).map((b) => (
                <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="warning">observation_plan</AdminBadge>
                  <span className="ml-2 font-bold">{b.brief_code} v{b.brief_version}</span>
                  <span className="ml-2 text-muted-foreground">{JSON.stringify(b.observation_plan_reference).slice(0, 160)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'reviewtriggers' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Trigger Reference — 실제 결과가 예상과 다를 때 언제 재검토할지. Brief 의 review_trigger_reference 를 표시합니다." />
          {!briefs.filter((b) => b.review_trigger_reference != null).length ? <AdminEmpty title="Review Trigger 없음" description="Brief 에 review_trigger_reference 가 기록되면 여기에 표시됩니다." /> : (
            <div className="space-y-1">
              {briefs.filter((b) => b.review_trigger_reference != null).slice(0, 30).map((b) => (
                <div key={b.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="warning">review_trigger</AdminBadge>
                  <span className="ml-2 font-bold">{b.brief_code} v{b.brief_version}</span>
                  <span className="ml-2 text-muted-foreground">{JSON.stringify(b.review_trigger_reference).slice(0, 160)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Outcome Reference 연결', () => exEvent('observed_outcome_linked', { causality_status: 'causality_unverified' }, 'Outcome 연결됨(≠ Causality)'), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ Decision Causality — 외부 요인/표본 부족 시 unverified 유지, 실제 Outcome 없으면 outcome_unverified." />
          {eventList(evByType('observed_outcome_linked'), 'Decision Outcome 없음', '실측 결과 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'quality' && resultEventTab('decision_quality_reviewed', 'Decision Quality 검토', 'Quality Candidate ≠ Verified Decision Quality ≠ 경영진 평가 — Outcome 연결 후에만 평가.', DECISION_QUALITY_RESULTS)}
      {tab === 'drift' && resultEventTab('decision_drift_reviewed', 'Decision Drift 검토', 'Context/Policy/Cost/Assumption/Goal Drift — Drift Candidate ≠ Confirmed Drift, 장기 관찰 필요.', DECISION_DRIFT_RESULTS)}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {ctxSelect}{reasonInput}
            {btn('Learning Reference 기록', () => exEvent('decision_learning_reference_recorded', { note: 'learning_reference_only' }, 'Learning Reference 기록됨(자동 정책 변경 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="어떤 Evidence/Agent 의견/Forecast 가 유효했는지, 어떤 Risk 가 누락됐는지 — Learning Reference ≠ 자동 정책 변경." />
          {eventList(evByType('decision_learning_reference_recorded'), 'Decision Learning 없음', '결정 학습 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="단계별 기록 존재 여부 — 완료 주장이 아닙니다. Unknown 은 insufficient_data 로 유지합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.present ? 'recorded' : 'insufficient_data'}</p>
              </div>
            ))}
          </div>
          <AdminAlert tone="info" description={`기록된 단계 ${NUM(timeline.completedCount)} / ${timeline.stages.length} — Timeline ≠ Execution Log.`} />
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '37종 Executive 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {EXECUTIVE_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available ? 'success' : 'danger'}>{c.available ? 'available' : 'unavailable'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {EXECUTIVE_SUPPORT_MATRIX.map((s) => (
              <div key={s.feature} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.status === 'unsupported' ? 'danger' : s.status === 'fully_supported' ? 'success' : 'warning'}>{s.status}</AdminBadge>
                <span className="ml-2 font-bold">{s.feature}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">limitation</AdminBadge>
              <span className="ml-2">{l}</span>
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
