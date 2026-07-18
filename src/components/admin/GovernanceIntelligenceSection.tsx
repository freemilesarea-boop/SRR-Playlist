/**
 * GovernanceIntelligenceSection — Enterprise Governance Intelligence,
 * Strategic Decision Governance & Executive Approval Center (Phase AI-OPS-47).
 *
 * Enterprise Policy→Strategic Decision Candidate→Decision Context→Decision
 * Evidence→Governance Validation→Policy Compliance→Approval Workflow→
 * Executive Approval→Decision Record→Governance Learning→Audit.
 * Decision Candidate ≠ Approved Decision · Review ≠ Approval · Approval
 * Chain ≠ Final Approval · Policy Match ≠ Policy Compliance.
 * 자동 승인/거절·자동 Policy/Governance/Budget/Strategy/Production 변경 없음.
 * (기존 AiGovernanceSection(0496)/PolicyGovernanceSection(0512) 과 별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Search,
  Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseGovernanceSummary, fetchEnterpriseGovernanceDecisions,
  createEnterpriseGovernanceDecision, reviewEnterpriseGovernanceDecision,
  createEnterpriseApprovalWorkflow, reviewEnterpriseApprovalWorkflow,
  fetchEnterpriseApprovalWorkflows, recordEnterpriseGovernanceReview,
  recordEnterpriseGovernanceEvent, fetchEnterpriseGovernanceAudit,
  type EnterpriseGovernanceSummary, type EnterpriseGovernanceDecisionRow,
  type EnterpriseApprovalWorkflowRow, type EnterpriseGovernanceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  GOVERNANCE_CATEGORIES, GOVERNANCE_VALIDATION_RESULTS, DECISION_RISK_DIMENSIONS,
  DECISION_RISK_RESULTS, POLICY_MAPPING_RESULTS, COMPLIANCE_CHECK_RESULTS,
  APPROVAL_CHAIN_RESULTS, GOVERNANCE_RECOMMENDATION_TYPES, GOVERNANCE_SCORECARD_FIELDS,
  buildGovernanceTimeline, ENTERPRISE_GOVERNANCE_COMPONENTS, ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX,
} from '@/lib/enterpriseGovernance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'queue' | 'decisions' | 'context' | 'evidence' | 'related' | 'policymap'
  | 'validation' | 'compliance' | 'risk' | 'workflows' | 'chain' | 'timeline' | 'comparison'
  | 'brief' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'approved' | 'rejected'
  | 'links' | 'learning' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Governance Overview', icon: Layers },
  { key: 'queue', label: 'Decision Queue', icon: Inbox },
  { key: 'decisions', label: 'Governance Decisions', icon: BookOpen },
  { key: 'context', label: 'Decision Context', icon: ClipboardList },
  { key: 'evidence', label: 'Decision Evidence', icon: Search },
  { key: 'related', label: 'Related Decisions', icon: GitBranch },
  { key: 'policymap', label: 'Policy Compliance', icon: Shield },
  { key: 'validation', label: 'Governance Validation', icon: Gauge },
  { key: 'compliance', label: 'Compliance Check', icon: Shield },
  { key: 'risk', label: 'Decision Risk', icon: Activity },
  { key: 'workflows', label: 'Approval Workflow', icon: Users },
  { key: 'chain', label: 'Approval Chain', icon: GitBranch },
  { key: 'timeline', label: 'Decision Timeline', icon: History },
  { key: 'comparison', label: 'Decision Comparison', icon: Search },
  { key: 'brief', label: 'Executive Briefs', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Governance Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Governance Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Users },
  { key: 'approved', label: 'Approval References', icon: Scale },
  { key: 'rejected', label: 'Rejection References', icon: Scale },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'learning', label: 'Governance Learning', icon: Lightbulb },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Decision 자동 승인/거절·자동 Policy/Governance 변경·자동 Budget/Capital/Strategy/계약/Payment 승인·자동 Merge/Deploy/Rollback/Production 변경 없음 — 모든 반환 flag(decision_auto_approved/policy_changed/budget_approved 등) 항상 false',
  'Decision Candidate ≠ Approved Decision — awaiting_approval 진입은 Evidence 필수, 종결(approved/rejected/archived) 재결정 차단',
  'Executive Approval Reference 는 Self-Approval 차단(작성자 ≠ 승인자) + Evidence 필수 — 사람의 승인 기록이며 자동 집행이 아님',
  'Approval Chain ≠ Final Approval — approval_ready 표시는 Evidence 필수(Ready ≠ 승인)',
  'Policy Match ≠ Policy Compliance · Compliance Check ≠ Regulatory Approval — 해석과 최종 판단은 사람',
  'Risk Summary ≠ Risk Elimination · Evidence Link ≠ Proven Fact · Similar Decision ≠ Same Outcome',
  'Governance Score ≠ Executive Judgment — Scorecard 는 우선순위 후보 정렬일 뿐',
  'ai_policy_rules 테이블 부재(실측) — 실제 정책 원장은 ai_enterprise_policies(0512)/ai_constitution_rules(0496)',
  'Legal Review/규제 신고/이사회/계약 관리/외부 감사 시스템 피드 부재 — insufficient_data 유지',
  'Migration 0472~0551 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function GovernanceIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseGovernanceSummary>({});
  const [decisions, setDecisions] = useState<EnterpriseGovernanceDecisionRow[]>([]);
  const [workflows, setWorkflows] = useState<EnterpriseApprovalWorkflowRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseGovernanceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selDecision, setSelDecision] = useState('');
  const [selWorkflow, setSelWorkflow] = useState('');
  const [catSel, setCatSel] = useState<string>('strategy');
  const [riskDimSel, setRiskDimSel] = useState<string>('strategic_risk');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, d, w, a] = await Promise.all([
        fetchEnterpriseGovernanceSummary(), fetchEnterpriseGovernanceDecisions(null, null, 200),
        fetchEnterpriseApprovalWorkflows(null, 200), fetchEnterpriseGovernanceAudit(200),
      ]);
      setSummary(s); setDecisions(d); setWorkflows(w); setAudit(a);
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
  const decReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selDecision) { if (!selDecision) toast.error('Decision 선택 필수'); return; }
    void act(() => reviewEnterpriseGovernanceDecision(selDecision, action, r, payload), ok);
  };
  const wfReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selWorkflow) { if (!selWorkflow) toast.error('Workflow 선택 필수'); return; }
    void act(() => reviewEnterpriseApprovalWorkflow(selWorkflow, action, r, payload), ok);
  };
  const govReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selDecision) { if (!selDecision) toast.error('Decision 선택 필수'); return; }
    void act(() => recordEnterpriseGovernanceReview(selDecision, action, r, payload), ok);
  };
  const govEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { dec?: boolean; wf?: boolean } = { dec: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseGovernanceEvent(kind, r, payload, ids.dec ? (selDecision || null) : null, ids.wf ? (selWorkflow || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildGovernanceTimeline({ present: {
    enterprise_policy: (num('governance_actuals', 'enterprise_policies_0512') ?? 0) > 0,
    strategic_decision_candidate: (num('decisions', 'total') ?? 0) > 0,
    decision_context: (num('governance_events', 'contexts') ?? 0) > 0,
    decision_evidence: (num('governance_events', 'evidence_records') ?? 0) > 0,
    governance_validation: (num('governance_events', 'validations') ?? 0) > 0,
    policy_compliance: (num('governance_events', 'policy_mappings') ?? 0) + (num('governance_events', 'compliance_checks') ?? 0) > 0,
    approval_workflow: (num('workflows', 'total') ?? 0) > 0,
    executive_approval: (num('governance_events', 'approval_references') ?? 0) > 0,
    decision_record: (num('decisions', 'approved') ?? 0) + (num('decisions', 'rejected') ?? 0) > 0,
    governance_learning: (num('governance_events', 'learning_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Governance Intelligence & Executive Approval Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Governance Intelligence & Executive Approval Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const decSelect = (
    <select value={selDecision} onChange={(e) => setSelDecision(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Decision 선택</option>
      {decisions.map((d) => <option key={d.id} value={d.id}>{d.decision_code} · {d.decision_status}</option>)}
    </select>
  );
  const wfSelect = (
    <select value={selWorkflow} onChange={(e) => setSelWorkflow(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Workflow 선택(선택)</option>
      {workflows.map((w) => <option key={w.id} value={w.id}>{w.workflow_code} · {w.workflow_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('fully_validated') || s.includes('aligned') || s.includes('compliant_candidate') || s.includes('chain_complete') || s.includes('approval_ready') || s.includes('low_risk') || s.includes('approved_reference') ? 'success' as const : s.includes('high_risk') || s.includes('policy_conflict') || s.includes('non_compliant') || s.includes('validation_incomplete') || s.includes('evidence_missing') || s.includes('rejected') || s.includes('approver_missing') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseGovernanceEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const decList = (list: EnterpriseGovernanceDecisionRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((d) => (
          <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(d.decision_status)}>{d.decision_status}</AdminBadge>
            <AdminBadge tone={tone(d.validation_status)}>{d.validation_status}</AdminBadge>
            <AdminBadge tone={tone(d.risk_status)}>{d.risk_status}</AdminBadge>
            <span className="ml-2 font-bold">{d.decision_code}</span>
            <span className="ml-2 text-muted-foreground">{d.governance_category} · {d.decision_name} · evidence {Array.isArray(d.evidence) ? d.evidence.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const wfList = (list: EnterpriseApprovalWorkflowRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((w) => (
          <div key={w.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(w.workflow_status)}>{w.workflow_status}</AdminBadge>
            <span className="ml-2 font-bold">{w.workflow_code}</span>
            <span className="ml-2 text-muted-foreground">initiator {w.initiator_reference ?? '—'} · owner {w.final_decision_owner_reference ?? '—'} · reviews {Array.isArray(w.review_history) ? w.review_history.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}, ids: { dec?: boolean; wf?: boolean } = { dec: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.dec ? decSelect : null}{ids.wf ? wfSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => govEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Governance Intelligence & Executive Approval Center"
      subtitle="Enterprise Policy→Decision Candidate→Context/Evidence→Governance Validation→Policy Compliance→Approval Workflow→Executive Approval→Decision Record→Learning — 최종 승인과 의사결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 모든 전략적 의사결정을 Governance 관점에서 추적·검토·승인 가능하게 만드는 Governance Intelligence 계층입니다. AI 는 Decision Candidate/Context 구조화·Evidence 요약·Related Decision 검색·Policy Mapping·Governance Validation·Compliance Check·Risk Summary·Approval Chain·Timeline·Comparison·Executive Brief·Scorecard·Recommendation·Review 요청까지만 수행하며, Decision 자동 승인/거절·자동 Policy/Governance 변경·자동 Budget/Capital/Strategy/계약/Payment 승인·자동 Merge/Deploy/Rollback/Production 변경은 수행하지 않습니다. Decision Candidate ≠ Approved Decision, Review ≠ Approval, Approval Chain ≠ Final Approval, Policy Match ≠ Policy Compliance, Governance Score ≠ Executive Judgment. AI 는 의사결정을 설명하고 근거를 정리하며 승인 절차를 지원합니다. 사람이 승인하고 책임집니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Governance Decisions" value={NUM(num('decisions', 'total'))} />
            <Box label="Under Review / Awaiting Approval" value={`${NUM(num('decisions', 'under_review'))} / ${NUM(num('decisions', 'awaiting_approval'))}`} />
            <Box label="Approved / Rejected / Archived" value={`${NUM(num('decisions', 'approved'))} / ${NUM(num('decisions', 'rejected'))} / ${NUM(num('decisions', 'archived'))}`} />
            <Box label="Fully Validated / Incomplete" value={`${NUM(num('decisions', 'fully_validated'))} / ${NUM(num('decisions', 'validation_incomplete'))}`} />
            <Box label="High-Risk Decisions" value={NUM(num('decisions', 'high_risk'))} />
            <Box label="Approval Workflows" value={NUM(num('workflows', 'total'))} />
            <Box label="Ready / Add. Review / Conflict / Ev. Missing" value={`${NUM(num('workflows', 'approval_ready'))} / ${NUM(num('workflows', 'additional_review'))} / ${NUM(num('workflows', 'policy_conflict'))} / ${NUM(num('workflows', 'evidence_missing'))}`} />
            <Box label="Contexts / Evidence Records" value={`${NUM(num('governance_events', 'contexts'))} / ${NUM(num('governance_events', 'evidence_records'))}`} />
            <Box label="Related Searches / Policy Mappings" value={`${NUM(num('governance_events', 'related_searches'))} / ${NUM(num('governance_events', 'policy_mappings'))}`} />
            <Box label="Validations / Compliance Checks" value={`${NUM(num('governance_events', 'validations'))} / ${NUM(num('governance_events', 'compliance_checks'))}`} />
            <Box label="Risk / Chain Reviews" value={`${NUM(num('governance_events', 'risk_reviews'))} / ${NUM(num('governance_events', 'chain_reviews'))}`} />
            <Box label="Timelines / Comparisons / Briefs" value={`${NUM(num('governance_events', 'timelines'))} / ${NUM(num('governance_events', 'comparisons'))} / ${NUM(num('governance_events', 'briefs'))}`} />
            <Box label="Scorecards / Recommendations" value={`${NUM(num('governance_events', 'scorecards'))} / ${NUM(num('governance_events', 'recommendations'))}`} />
            <Box label="Governance / Executive / Compliance Review 요청" value={`${NUM(num('governance_events', 'governance_review_requests'))} / ${NUM(num('governance_events', 'executive_review_requests'))} / ${NUM(num('governance_events', 'compliance_review_requests'))}`} />
            <Box label="Approval / Rejection References" value={`${NUM(num('governance_events', 'approval_references'))} / ${NUM(num('governance_events', 'rejection_references'))}`} />
            <Box label="Policy / Portfolio Links" value={`${NUM(num('governance_events', 'policy_links'))} / ${NUM(num('governance_events', 'portfolio_links'))}`} />
            <Box label="Outcome Links / Learning" value={`${NUM(num('governance_events', 'outcome_links'))} / ${NUM(num('governance_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`governance_unavailable: ${Array.isArray(summary.governance_unavailable) ? (summary.governance_unavailable as unknown[]).map(String).join(', ') : '—'}. Governance 원천 실측 — Investment Portfolios(0550) ${NUM(num('governance_actuals', 'investment_portfolios_0550'))}건 · Business Values(0549) ${NUM(num('governance_actuals', 'business_values_0549'))}건 · KPIs(0548) ${NUM(num('governance_actuals', 'enterprise_kpis_0548'))}건 · Programs(0547) ${NUM(num('governance_actuals', 'execution_programs_0547'))}건 · Policies(0512) ${NUM(num('governance_actuals', 'enterprise_policies_0512'))}건 · Constitution Rules(0496) ${NUM(num('governance_actuals', 'constitution_rules_0496'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Decision Queue — Review 대상/승인 대기/고위험 Decision. 우선순위와 최종 승인은 사람이 결정합니다." />
          {decList(decisions.filter((d) => ['draft', 'under_review', 'awaiting_approval'].includes(d.decision_status)), '대기 Decision 없음', '0건은 결정할 것이 없음을 의미하지 않습니다.')}
          {decList(decisions.filter((d) => ['elevated_risk_candidate', 'high_risk_candidate'].includes(d.risk_status) || d.validation_status === 'validation_incomplete'), '고위험/미검증 Decision 없음', 'High-Risk/Validation Incomplete 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'decisions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {GOVERNANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Decision Candidate 생성(≠ 승인)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseGovernanceDecision({ governance_category: catSel, decision_name: r }), 'Decision Candidate 생성됨(draft — 자동 승인 없음)');
            }, true)}
            {btn('검토 시작', () => decReview('start_review', {}, 'under_review'))}
            {btn('Awaiting Approval(Evidence 필수)', () => decReview('mark_awaiting_approval', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'awaiting_approval(≠ 승인)'))}
            {btn('Archive', () => decReview('archive_reference', {}, 'archived_reference'))}
            {decSelect}
          </div>
          <AdminAlert tone="info" description="Category 16종 · 자동 승인/개인 평가 계열 category 서버 차단 · 종결 재결정 차단." />
          {decList(decisions, 'Governance Decision 없음', '핵심 질문 예: 어떤 Decision 이 Review 대상인가? 근거는 충분한가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'context' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Decision Context 기록', () => govEvent('decision_context_recorded', { note: reason.trim() }, 'Context 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Context Candidate ≠ 결정 확정 — 배경/제약/가정을 구조화한 후보입니다." />
          {eventList(evByType('decision_context_recorded'), 'Context 없음', 'Decision Context 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Evidence 기록', () => govEvent('decision_evidence_recorded', { note: reason.trim() }, 'Evidence 기록됨(≠ Proven Fact)'), true)}
            {btn('Evidence Summary 기록', () => govEvent('evidence_summary_recorded', { note: reason.trim() }, 'Evidence Summary 기록됨'))}
          </div>
          <AdminAlert tone="warning" description="Evidence Link ≠ Proven Fact — 부족한 Evidence 는 부족한 대로 표시합니다." />
          {eventList([...evByType('decision_evidence_recorded'), ...evByType('evidence_summary_recorded')], 'Evidence 기록 없음', '결정 근거 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'related' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Related Decision 검색 기록', () => govEvent('related_decision_search_recorded', { note: reason.trim() }, 'Related Search 기록됨(≠ Same Outcome)'), true)}
          </div>
          <AdminAlert tone="info" description="Similar Decision ≠ Same Outcome — 과거 유사 결정과 결과 참조는 후보 비교용입니다." />
          {eventList(evByType('related_decision_search_recorded'), 'Related Search 없음', '유사 결정 검색 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'policymap' && resultEventTab('policy_mapping_reviewed', 'Policy Mapping 검토', 'Policy(0512 실존 검증) 매핑 — Policy Match ≠ Policy Compliance.', POLICY_MAPPING_RESULTS)}
      {tab === 'validation' && resultEventTab('governance_validation_reviewed', 'Governance Validation 검토', 'Validation 5단계(§5) — Validation Candidate ≠ Approval.', GOVERNANCE_VALIDATION_RESULTS)}
      {tab === 'compliance' && resultEventTab('compliance_check_reviewed', 'Compliance Check 검토', 'Compliance Check ≠ Regulatory Approval — 규제 판단은 사람.', COMPLIANCE_CHECK_RESULTS)}
      {tab === 'risk' && resultEventTab('decision_risk_reviewed', 'Decision Risk 검토', 'Risk 7차원(§7 — Strategic/Financial/Operational/Technical/Security/Compliance/Reputational) — Risk Summary ≠ Risk Elimination.', DECISION_RISK_RESULTS, { risk_dimension: riskDimSel })}
      {tab === 'risk' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Risk Dimension:</span>
          <select value={riskDimSel} onChange={(e) => setRiskDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {DECISION_RISK_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}

      {tab === 'workflows' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Approval Workflow 생성(Decision 필수)', () => {
              const r = needReason();
              if (!r || !selDecision) { if (!selDecision) toast.error('Decision 선택 필수'); return; }
              void act(() => createEnterpriseApprovalWorkflow({ governance_decision_id: selDecision, initiator_reference: r }), 'Workflow 생성됨(Chain ≠ Final Approval)');
            }, true)}
            {wfSelect}
            {btn('Approval Ready(Evidence 필수)', () => wfReview('mark_approval_ready', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'approval_ready_candidate(≠ 승인)'))}
            {btn('추가 Review 필요', () => wfReview('mark_additional_review', {}, 'additional_review_required'))}
            {btn('Policy 충돌', () => wfReview('mark_policy_conflict', {}, 'policy_conflict_detected'))}
            {btn('Evidence 부족', () => wfReview('mark_evidence_missing', {}, 'evidence_missing'))}
          </div>
          <AdminAlert tone="warning" description="Approval Workflow(§6 — Initiator/Reviewer/Executive Approver/Final Decision Owner/Review History/Timeline) — Chain ≠ Final Approval, approval_ready 는 Evidence 필수." />
          {wfList(workflows, 'Approval Workflow 없음', '승인 절차 구성이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'chain' && resultEventTab('approval_chain_reviewed', 'Approval Chain 검토', 'Chain 완전성 후보 — Approval Chain ≠ Final Approval.', APPROVAL_CHAIN_RESULTS, {}, { dec: true, wf: true })}
      {tab === 'timeline' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Decision Timeline 기록', () => govEvent('decision_timeline_recorded', { note: reason.trim() }, 'Timeline 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Timeline ≠ 승인 일정 확정 — 재검토 시점 후보를 포함한 관측 기록입니다." />
          {eventList(evByType('decision_timeline_recorded'), 'Timeline 없음', '결정 타임라인 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'comparison' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Decision Comparison 기록', () => govEvent('decision_comparison_recorded', { note: reason.trim() }, 'Comparison 기록됨(≠ 자동 선택)'), true)}
          </div>
          <AdminAlert tone="info" description="Decision Comparison — 대안 비교 후보이며 자동 선택이 아닙니다." />
          {eventList(evByType('decision_comparison_recorded'), 'Comparison 없음', '결정 비교 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'brief' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Executive Brief 기록', () => govEvent('executive_brief_recorded', { note: reason.trim() }, 'Brief 기록됨(자동 발송 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive Brief ≠ 결정 — 자동 발송 없음, 승인 판단 보조 자료입니다." />
          {eventList(evByType('executive_brief_recorded'), 'Brief 없음', 'Executive Brief 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Governance Scorecard 기록', () => govEvent('executive_governance_scorecard_recorded', { fields: [...GOVERNANCE_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ Executive Judgment)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${GOVERNANCE_SCORECARD_FIELDS.join(', ')}) — Governance Score ≠ Executive Judgment(고위험/충돌/미검증 우선 정렬 후보).`} />
          {eventList(evByType('executive_governance_scorecard_recorded'), 'Scorecard 없음', 'Executive Governance Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {GOVERNANCE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => govEvent('governance_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Governance Recommendation ≠ Decision — Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('governance_recommendation_recorded'), 'Recommendation 없음', 'Governance Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Governance Review 요청', () => govReview('request_governance_review', {}, 'Governance Review 요청됨'), true)}
            {btn('Executive Review 요청', () => govReview('request_executive_review', {}, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Compliance Review 요청', () => govReview('request_compliance_review', {}, 'Compliance Review 요청됨'))}
            {btn('Review Reference 기록(Evidence 필수)', () => govReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'))}
            {btn('수정 요청', () => govReview('request_revision', {}, '수정 요청됨'))}
          </div>
          <AdminAlert tone="warning" description="Governance Review — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · Review ≠ Approval. 최종 승인과 의사결정은 반드시 사람이 수행합니다." />
          {eventList([...evByType('governance_review_requested'), ...evByType('executive_review_requested'), ...evByType('compliance_review_requested'), ...evByType('decision_revision_requested')], 'Review 요청 없음', 'Governance/Executive/Compliance Review 요청이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'approved' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Executive Approval Reference 기록(Evidence 필수)', () => decReview('record_approval_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Approval Reference 기록됨(사람의 승인 기록)'), true)}
          </div>
          <AdminAlert tone="warning" description="Executive Approval Reference — Self-Approval 서버 차단 + Evidence 필수. 사람의 승인 기록이며 자동 집행(Budget/Capital/Production)은 없습니다." />
          {decList(decisions.filter((d) => d.decision_status === 'approved_reference'), 'Approved Reference 없음', '사람이 승인한 Decision 기록이 여기에 표시됩니다.')}
          {eventList(evByType('executive_approval_reference_recorded'), 'Approval 이벤트 없음', '승인 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'rejected' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Rejection Reference 기록', () => decReview('record_rejection_reference', {}, 'Rejection Reference 기록됨'), true)}
          </div>
          {decList(decisions.filter((d) => d.decision_status === 'rejected_reference'), 'Rejected Reference 없음', '사람이 거절한 Decision 기록이 여기에 표시됩니다.')}
          {eventList(evByType('decision_rejection_reference_recorded'), 'Rejection 이벤트 없음', '거절 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Policy Link(0512 실존 검증)', () => govEvent('policy_reference_linked', { note: reason.trim() }, 'Policy Link 기록됨'), true)}
            {btn('Portfolio Link(0550)', () => govEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Program Link(0547)', () => govEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Value Link(0549)', () => govEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨'))}
            {btn('Decision Outcome Link(0514)', () => govEvent('decision_outcome_linked', { note: reason.trim() }, 'Outcome Link 기록됨(≠ Proven Causality)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0512/0514/0547/0549/0550). Link ≠ 준수/승인/인과 확정." />
          {eventList([...evByType('policy_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('value_reference_linked'), ...evByType('decision_outcome_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {decSelect}{reasonInput}
            {btn('Governance Learning 기록', () => govEvent('governance_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 Governance 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('governance_learning_reference_recorded'), 'Learning Reference 없음', '거버넌스 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Governance 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
          <div className="space-y-1">
            {flowTimeline.map((s) => (
              <div key={s.stage} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.present ? 'success' : 'warning'}>{s.present ? '관측됨' : '미관측'}</AdminBadge>
                <span className="font-bold">{s.stage}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`Governance 이벤트 32종 통합 Audit — 총 ${NUM(num('governance_events', 'total'))}건. 자동 승인 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Governance Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_GOVERNANCE_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 승인/거절/정책 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_GOVERNANCE_SUPPORT_MATRIX.map((e) => (
              <div key={e.capability} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.capability}</span>
                <AdminBadge tone={e.support === 'unavailable' ? 'danger' : e.support === 'fully_supported' ? 'success' : 'warning'}>{e.support}</AdminBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l) => (
            <div key={l} className="rounded-lg border border-border p-2 text-[11px]">{l}</div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
