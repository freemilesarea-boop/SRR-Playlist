/**
 * PolicySimulationSection — Enterprise Policy Simulation, Change Impact Intelligence &
 * Human-Approved Assurance Rollout Center (Phase AI-OPS-36).
 *
 * Approved Proposal Reference→Change Specification→Baseline→Historical Replay→Counterfactual→
 * Conflict/Compatibility→Blast Radius→Friction→Safety Benefit→Validation Plan→
 * Controlled Rollout Plan→Human Approval→Gate→Application Reference→Observation→Closure→Audit.
 * Simulation ≠ Reality · Replay ≠ Future Outcome · Counterfactual ≠ Fact ·
 * Compatibility ≠ Safety · No Detected Conflict ≠ No Conflict · Plan ≠ Execution ·
 * Sandbox Pass ≠ Production Safety · Application Reference ≠ Verified ≠ Effectiveness.
 * 자동 승인/적용/Threshold·Constitution·Trust·Permission·Scope 변경/Rollout 시작·확대/Rollback 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2, ClipboardList, Copy, FileText,
  FlaskConical, Grid3x3, History, Layers, Lightbulb, Lock, RefreshCw, Scale,
  ScrollText, Search, Shield, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchPolicySimulationSummary, fetchPolicyChangeSpecifications, createPolicyChangeSpecification,
  reviewPolicyChangeSpecification, fetchPolicySimulationRuns, recordPolicySimulationRun,
  fetchPolicyRolloutPlans, createPolicyRolloutPlan, reviewPolicyRollout, recordPolicyRolloutEvent,
  fetchPolicyRolloutAudit, fetchRuntimePolicyProposals,
  type PolicySimulationSummary, type PolicyChangeSpecificationRow, type PolicySimulationRunRow,
  type PolicyRolloutPlanRow, type PolicyRolloutEventRow, type RuntimePolicyProposalRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  POLICY_CHANGE_DOMAINS, POLICY_CHANGE_TYPES, SIMULATION_TYPES, ROLLOUT_STRATEGIES,
  CONFLICT_RESULTS, buildPolicyRolloutRecommendation, buildPolicyRolloutTimeline,
  evaluateRolloutGate, SIMULATION_COMPONENTS, POLICY_ROLLOUT_SUPPORT,
} from '@/lib/policySimulation';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const OBSERVATION_RESULTS = ['expected_effect_candidate', 'mixed_effect_candidate', 'adverse_effect_candidate', 'no_material_change_candidate', 'effectiveness_unverified', 'causality_unverified', 'sample_too_small', 'stale_input_candidate', 'insufficient_data'] as const;
const COMPAT_RESULTS = ['compatible_reference', 'compatible_with_warnings', 'incompatible_candidate', 'compatibility_unverified'] as const;

type Tab = 'overview' | 'proposals' | 'specs' | 'pendingspec' | 'baselines' | 'replay' | 'counterfactual'
  | 'conflicts' | 'compatconstitution' | 'compatgovernance' | 'compatsecurity' | 'compatprivacy'
  | 'compatcompliance' | 'compatconnector' | 'compatautomation' | 'compatruntime' | 'blastradius'
  | 'friction' | 'benefit' | 'validationplans' | 'validationevidence' | 'rolloutplans' | 'pendingrollout'
  | 'gate' | 'applicationrefs' | 'appverify' | 'observation' | 'unexpected' | 'humanreviews'
  | 'recommendations' | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'proposals', label: 'Policy Proposals(0538)', icon: BookOpen },
  { key: 'specs', label: 'Change Specifications', icon: FileText },
  { key: 'pendingspec', label: 'Pending Specification Review', icon: Scale },
  { key: 'baselines', label: 'Baselines', icon: Copy },
  { key: 'replay', label: 'Historical Replay', icon: History },
  { key: 'counterfactual', label: 'Counterfactual Simulation', icon: FlaskConical },
  { key: 'conflicts', label: 'Conflict Analysis', icon: AlertTriangle },
  { key: 'compatconstitution', label: 'Constitution Compatibility', icon: Shield },
  { key: 'compatgovernance', label: 'Governance Compatibility', icon: Scale },
  { key: 'compatsecurity', label: 'Security Compatibility', icon: Lock },
  { key: 'compatprivacy', label: 'Privacy Compatibility', icon: Shield },
  { key: 'compatcompliance', label: 'Compliance Compatibility', icon: ClipboardList },
  { key: 'compatconnector', label: 'Connector Compatibility', icon: Activity },
  { key: 'compatautomation', label: 'Automation Compatibility', icon: RefreshCw },
  { key: 'compatruntime', label: 'Runtime Compatibility', icon: Activity },
  { key: 'blastradius', label: 'Blast Radius', icon: AlertTriangle },
  { key: 'friction', label: 'Operational Friction', icon: Activity },
  { key: 'benefit', label: 'Safety Benefit', icon: TrendingUp },
  { key: 'validationplans', label: 'Validation Plans', icon: ClipboardList },
  { key: 'validationevidence', label: 'Validation Evidence', icon: ScrollText },
  { key: 'rolloutplans', label: 'Rollout Plans', icon: ClipboardList },
  { key: 'pendingrollout', label: 'Pending Rollout Approvals', icon: Scale },
  { key: 'gate', label: 'Rollout Gate', icon: Lock },
  { key: 'applicationrefs', label: 'Application References', icon: Copy },
  { key: 'appverify', label: 'Application Verification', icon: CheckCircle2 },
  { key: 'observation', label: 'Post-Rollout Observation', icon: Search },
  { key: 'unexpected', label: 'Unexpected Effects', icon: AlertTriangle },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'timeline', label: 'Rollout Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: FlaskConical },
];
const COMPAT_DOMAIN_BY_TAB: Partial<Record<Tab, string>> = {
  compatconstitution: 'constitution', compatgovernance: 'governance', compatsecurity: 'security',
  compatprivacy: 'privacy', compatcompliance: 'compliance', compatconnector: 'connector',
  compatautomation: 'automation', compatruntime: 'runtime',
};

const KNOWN_LIMITATIONS = [
  'Simulation ≠ Reality — Counterfactual 모델 엔진 없음(simulation_model_missing 유지·임의 모델 가정 금지)',
  'Historical Replay 는 과거 데이터 기준 참고 — Replay ≠ Future Outcome·선택 편향 미검토 시 bias 후보 유지',
  '범용 Feature Flag/Canary/Staging 환경 없음 — Sandbox Pass ≠ Production Safety(track_rollouts 는 음악 도메인 별개)',
  'Policy 자동 적용 엔진 없음 — Application 은 사람 수행 후 Reference 기록만(Reference ≠ Applied Success)',
  '자동 Rollout 시작/확대/Rollback 없음 — production_global/unattended/automatic_* 전략 서버 차단',
  '금지 policy domain 12종(Constitution/Trust/Auth/RLS/Payment/Settlement/Contract/Pricing/Infra/Secret/Destructive/Employee) 서버 차단',
  'Provider 외부 장애 피드 없음 — 외부 요인 자동 배제 불가(causality_unverified 유지)',
  'Migration 0472~0539 production 미적용 — 운영 수치는 적용 후 축적됩니다',
];

export default function PolicySimulationSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<PolicySimulationSummary>({});
  const [specs, setSpecs] = useState<PolicyChangeSpecificationRow[]>([]);
  const [sims, setSims] = useState<PolicySimulationRunRow[]>([]);
  const [plans, setPlans] = useState<PolicyRolloutPlanRow[]>([]);
  const [audit, setAudit] = useState<PolicyRolloutEventRow[]>([]);
  const [proposals, setProposals] = useState<RuntimePolicyProposalRow[]>([]);
  const [reason, setReason] = useState('');
  const [selProp, setSelProp] = useState('');
  const [selSpec, setSelSpec] = useState('');
  const [selSim, setSelSim] = useState('');
  const [selPlan, setSelPlan] = useState('');
  const [specDomain, setSpecDomain] = useState<string>('timeout_policy');
  const [specChangeType, setSpecChangeType] = useState<string>('modify_timeout');
  const [simType, setSimType] = useState<string>('historical_replay');
  const [strategy, setStrategy] = useState<string>('reference_only');
  const [conflictResult, setConflictResult] = useState<string>('conflict_unverified');
  const [compatResult, setCompatResult] = useState<string>('compatibility_unverified');
  const [obsResult, setObsResult] = useState<string>('effectiveness_unverified');
  const [appUrl, setAppUrl] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sp, si, pl, au, pp] = await Promise.all([
        fetchPolicySimulationSummary(), fetchPolicyChangeSpecifications(null, 200), fetchPolicySimulationRuns(null, 200),
        fetchPolicyRolloutPlans(null, 200), fetchPolicyRolloutAudit(200), fetchRuntimePolicyProposals(null, 200),
      ]);
      setSummary(s); setSpecs(sp); setSims(si); setPlans(pl); setAudit(au); setProposals(pp);
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
  const needSpec = (): PolicyChangeSpecificationRow | null => {
    const s = specs.find((x) => x.id === selSpec);
    if (!s) { toast.error('Change Specification 선택 필수'); return null; }
    return s;
  };
  const needSim = (): PolicySimulationRunRow | null => {
    const s = sims.find((x) => x.id === selSim);
    if (!s) { toast.error('Simulation Run 선택 필수'); return null; }
    return s;
  };
  const needPlan = (): PolicyRolloutPlanRow | null => {
    const p = plans.find((x) => x.id === selPlan);
    if (!p) { toast.error('Rollout Plan 선택 필수'); return null; }
    return p;
  };
  const specReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const s = needSpec();
    if (!r || !s) return;
    void act(() => reviewPolicyChangeSpecification(s.id, action, r, payload), ok);
  };
  const planReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const p = needPlan();
    if (!r || !p) return;
    void act(() => reviewPolicyRollout(p.id, action, r, payload), ok);
  };
  const rolloutEvent = (kind: string, payload: Record<string, unknown>, ok: string, requireSpec = true) => {
    const r = needReason();
    if (!r) return;
    const s = requireSpec ? needSpec() : null;
    if (requireSpec && !s) return;
    void act(() => recordPolicyRolloutEvent(kind, r, payload, s?.id ?? null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildPolicyRolloutTimeline([
    { stage: 'specification', count: num('specifications', 'total'), source: 'specifications 실측' },
    { stage: 'baseline', count: num('rollout_events', 'baselines'), source: 'baseline event 실측' },
    { stage: 'simulation', count: num('simulations', 'total'), source: 'simulation runs 실측' },
    { stage: 'conflict', count: num('rollout_events', 'conflict_reviews'), source: 'conflict review 실측' },
    { stage: 'validation', count: num('rollout_events', 'validation_evidence'), source: 'validation evidence 실측' },
    { stage: 'rollout_plan', count: num('rollouts', 'total'), source: 'rollout plans 실측' },
    { stage: 'approval', count: num('rollouts', 'approved'), source: 'approved_reference 실측' },
    { stage: 'application', count: num('rollouts', 'application_recorded'), source: 'application reference 실측' },
    { stage: 'observation', count: num('rollouts', 'observation_pending'), source: 'observation 실측' },
  ]), [num]);

  const recommendations = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildPolicyRolloutRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const approvedProps = num('policy_actuals', 'proposals_approved_0538');
    const specTotal = num('specifications', 'total');
    if (approvedProps != null && specTotal != null && approvedProps > specTotal) push(buildPolicyRolloutRecommendation({ type: 'create_change_specification', reason: `승인 Proposal ${approvedProps}건 대비 Specification ${specTotal}건 — 명세 미작성 존재`, evidence: ['0538/0539 실측'], confidence: null }));
    const pendingSpec = num('specifications', 'pending_review');
    if (pendingSpec != null && pendingSpec > 0) push(buildPolicyRolloutRecommendation({ type: 'review_change_specification', reason: `검토 대기 Specification ${pendingSpec}건`, evidence: ['specifications 실측'], confidence: null }));
    const approvedSpec = num('specifications', 'approved_for_simulation');
    const simTotal = num('simulations', 'total');
    if (approvedSpec != null && simTotal != null && approvedSpec > simTotal) push(buildPolicyRolloutRecommendation({ type: 'run_historical_replay_reference', reason: `Simulation 승인 Specification ${approvedSpec}건 대비 Simulation ${simTotal}건 — 미실행 존재(미실행은 completed 아님)`, evidence: ['simulations 실측'], confidence: null }));
    const conflictCand = num('rollout_events', 'conflict_candidates');
    if (conflictCand != null && conflictCand > 0) push(buildPolicyRolloutRecommendation({ type: 'review_policy_conflicts', reason: `Conflict 후보 ${conflictCand}건 — 사람 검토 필요(자동 해소 없음)`, evidence: ['events 실측'], confidence: null }));
    const approvalMissing = num('rollouts', 'approval_missing');
    if (approvalMissing != null && approvalMissing > 0) push(buildPolicyRolloutRecommendation({ type: 'request_rollout_approval', reason: `승인 대기 Rollout Plan ${approvalMissing}건 — Plan ≠ Execution`, evidence: ['rollouts 실측'], confidence: null }));
    const appUnv = num('rollouts', 'application_unverified');
    if (appUnv != null && appUnv > 0) push(buildPolicyRolloutRecommendation({ type: 'verify_application_reference', reason: `Application 미검증 ${appUnv}건 — Reference ≠ 적용 성공`, evidence: ['rollouts 실측'], confidence: null }));
    const unexpected = num('rollout_events', 'unexpected_effects');
    if (unexpected != null && unexpected > 0) push(buildPolicyRolloutRecommendation({ type: 'review_unexpected_effect', reason: `Unexpected Effect ${unexpected}건 — 사람 검토 필요(자동 Rollback 없음)`, evidence: ['events 실측'], confidence: null }));
    return out;
  }, [num]);

  const selPlanGate = useMemo(() => {
    const p = plans.find((x) => x.id === selPlan);
    if (!p) return null;
    const sim = sims.find((s) => s.id === p.policy_simulation_run_id) ?? null;
    const spec = specs.find((s) => s.id === p.policy_change_specification_id) ?? null;
    const validationRecorded = audit.some((e) => e.event_type === 'validation_evidence_recorded' && e.policy_change_specification_id === p.policy_change_specification_id);
    const unexpectedOpen = audit.some((e) => e.event_type === 'unexpected_effect_detected' && e.policy_rollout_plan_id === p.id);
    return evaluateRolloutGate({
      rolloutStatus: p.rollout_status, humanApprovalEvidence: p.approved_by ? ['approved_by 기록'] : [],
      specificationStatus: spec?.specification_status ?? null, simulationStatus: sim?.simulation_status ?? null,
      stopConditions: p.stop_conditions.length, rollbackConditions: p.rollback_conditions.length,
      observationWindows: p.observation_windows.length, reviewers: p.assigned_reviewers.length,
      validationEvidenceRecorded: validationRecorded, unexpectedEffectOpen: unexpectedOpen,
    });
  }, [plans, sims, specs, audit, selPlan]);

  if (loading) return <AdminCard title="Enterprise Policy Simulation & Human-Approved Assurance Rollout"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Policy Simulation & Human-Approved Assurance Rollout">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const propSelect = (
    <select value={selProp} onChange={(e) => setSelProp(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Policy Proposal(0538) 선택</option>
      {proposals.map((p) => <option key={p.id} value={p.id}>{p.proposal_code} · {p.proposal_status}</option>)}
    </select>
  );
  const specSelect = (
    <select value={selSpec} onChange={(e) => setSelSpec(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Change Specification 선택</option>
      {specs.map((s) => <option key={s.id} value={s.id}>{s.change_code} · {s.specification_status}</option>)}
    </select>
  );
  const simSelect = (
    <select value={selSim} onChange={(e) => setSelSim(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Simulation Run 선택</option>
      {sims.map((s) => <option key={s.id} value={s.id}>{s.simulation_code} · {s.simulation_type} · {s.simulation_status}</option>)}
    </select>
  );
  const planSelect = (
    <select value={selPlan} onChange={(e) => setSelPlan(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Rollout Plan 선택</option>
      {plans.map((p) => <option key={p.id} value={p.id}>{p.rollout_code} · {p.rollout_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('verified') || s.includes('completed') || s.includes('ready') || s.includes('closed_reference') || s === 'no_conflict_detected_reference' || s === 'compatible_reference' ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('blocked') || s.includes('adverse') || s.includes('incompatible') || s.includes('failed') ? 'danger' as const : s.includes('pending') || s.includes('unverified') || s.includes('missing') || s.includes('candidate') || s === 'draft' ? 'warning' as const : 'neutral' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: PolicyRolloutEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const compatDomain = COMPAT_DOMAIN_BY_TAB[tab];

  return (
    <AdminCard
      title="Enterprise Policy Simulation & Human-Approved Assurance Rollout"
      subtitle="Proposal→Specification→Baseline→Replay→Counterfactual→Conflict/Compatibility→Blast/Friction/Benefit→Validation→Rollout Plan→Human Approval→Gate→Application Reference→Observation→Closure — 자동 승인·적용·Rollout 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 실제 Policy·Threshold·Runtime Rule·Constitution·Trust·Permission·Scope·Production Entity 를 변경하지 않습니다. 자동 승인, 자동 적용, 자동 Rollout 시작/확대, 자동 Rollback, 자동 발송은 없습니다. Simulation ≠ Reality, Replay ≠ Future Outcome, Counterfactual ≠ Fact, Compatibility ≠ Safety, No Detected Conflict ≠ No Conflict, Plan ≠ Execution, Sandbox Pass ≠ Production Safety, Application Reference ≠ Verified ≠ Effectiveness. 모든 승인·적용·종결은 사람이 수행합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Approved Proposals(0538)" value={NUM(num('policy_actuals', 'proposals_approved_0538'))} />
            <Box label="Change Specifications" value={NUM(num('specifications', 'total'))} />
            <Box label="Approved for Simulation" value={NUM(num('specifications', 'approved_for_simulation'))} />
            <Box label="Simulation Blocked" value={NUM(num('specifications', 'simulation_blocked'))} />
            <Box label="Simulation Runs" value={NUM(num('simulations', 'total'))} />
            <Box label="Simulations Completed" value={NUM(num('simulations', 'completed'))} />
            <Box label="Conflict Reviews" value={NUM(num('rollout_events', 'conflict_reviews'))} />
            <Box label="Conflict Candidates" value={NUM(num('rollout_events', 'conflict_candidates'))} />
            <Box label="Rollout Plans" value={NUM(num('rollouts', 'total'))} />
            <Box label="Approval Missing" value={NUM(num('rollouts', 'approval_missing'))} />
            <Box label="Gate Ready" value={NUM(num('rollouts', 'gate_ready'))} />
            <Box label="Application Recorded" value={NUM(num('rollouts', 'application_recorded'))} />
            <Box label="Application Unverified" value={NUM(num('rollouts', 'application_unverified'))} />
            <Box label="Observation Pending" value={NUM(num('rollouts', 'observation_pending'))} />
            <Box label="Unexpected Effects" value={NUM(num('rollout_events', 'unexpected_effects'))} />
            <Box label="Closed" value={NUM(num('rollouts', 'closed'))} />
          </div>
          <AdminAlert tone="info" description={`simulation_unavailable: ${Array.isArray(summary.simulation_unavailable) ? (summary.simulation_unavailable as unknown[]).map(String).join(', ') : '—'} — 가용 참조: ${Array.isArray(summary.simulation_available_reference) ? (summary.simulation_available_reference as unknown[]).map(String).join(', ') : '—'}. Policy Version(0512 ${NUM(num('policy_actuals', 'policy_versions_0512'))}건)/Constitution(0496 활성 ${NUM(num('policy_actuals', 'constitution_rules_0496'))}·immutable ${NUM(num('policy_actuals', 'constitution_immutable_0496'))})/Runtime Session(0536 ${NUM(num('policy_actuals', 'runtime_sessions_0536'))}건)은 읽기 전용 참조. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'proposals' && (
        !proposals.length ? <AdminEmpty title="Policy Proposal 없음" description="0538 승인된 Proposal 만 Change Specification 으로 명세할 수 있습니다." /> : (
          <div className="space-y-1">
            {proposals.slice(0, 30).map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={tone(p.proposal_status)}>{p.proposal_status}</AdminBadge>
                  <span className="font-bold">{p.proposal_code}</span>
                  <span className="text-muted-foreground">{p.policy_domain}</span>
                </div>
                <p className="mt-1">{p.title} — Proposal ≠ Approval ≠ Application</p>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'specs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {propSelect}
            <select value={specDomain} onChange={(e) => setSpecDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {POLICY_CHANGE_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={specChangeType} onChange={(e) => setSpecChangeType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {POLICY_CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Specification 생성(적용 아님)', () => {
              const r = needReason();
              if (!r) return;
              if (!selProp) { toast.error('Policy Proposal 선택 필수'); return; }
              void act(() => createPolicyChangeSpecification({ policy_proposal_id: selProp, policy_domain: specDomain, change_type: specChangeType, expected_benefit: r }), 'Specification 생성됨(draft — 적용 아님)');
            }, true)}
          </div>
          {!specs.length ? <AdminEmpty title="Change Specification 없음" description="승인된 Proposal 기반 변경 명세 — Specification ≠ Application." /> : (
            <div className="space-y-1">
              {specs.slice(0, 30).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(s.specification_status)}>{s.specification_status}</AdminBadge>
                    <span className="font-bold">{s.change_code}</span>
                    <span className="text-muted-foreground">{s.policy_domain} · {s.change_type} · risk {s.risk_level}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.expected_benefit ?? '—'} · reversibility {s.reversibility_status}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'pendingspec' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('검토 시작', () => specReview('start_review', {}, '검토 시작'))}
            {btn('Evidence 요청', () => specReview('request_evidence', {}, 'Evidence 요청'))}
            {btn('검토 완료', () => specReview('mark_reviewed', {}, 'reviewed_reference'))}
            {btn('Simulation 승인(Evidence)', () => specReview('approve_for_simulation', { evidence: [reason.trim()] }, 'Simulation 승인(적용 승인 아님)'), true)}
            {btn('Simulation 차단', () => specReview('mark_simulation_blocked', {}, 'simulation_blocked'))}
            {btn('반려', () => specReview('reject', {}, '반려'))}
            {btn('무효화', () => specReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="approve_for_simulation 은 Simulation 착수 승인일 뿐 적용 승인이 아닙니다. Evidence 없는 승인은 서버가 거부합니다. rejected/invalidated 종결 상태 재결정은 차단됩니다." />
          {eventList(evByType('change_specification_reviewed'), 'Specification 검토 이력 없음', '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'baselines' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Baseline Snapshot 기록', () => rolloutEvent('baseline_snapshot_recorded', { sources: ['runtime_history_0536_0537', 'policy_versions_0512', 'constitution_rules_0496'] }, 'Baseline 기록됨(미래 결과 보장 아님)'), true)}
          </div>
          <AdminAlert tone="info" description="Baseline 은 현재/과거 상태의 스냅샷 Reference 입니다 — Baseline ≠ 미래 결과 보장, Snapshot ≠ Live 상태." />
          {eventList(evByType('baseline_snapshot_recorded'), 'Baseline 없음', 'Baseline Snapshot Reference 가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'replay' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}
            <select value={simType} onChange={(e) => setSimType(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SIMULATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Simulation 기록(draft)', () => {
              const r = needReason(); const s = needSpec();
              if (!r || !s) return;
              void act(() => recordPolicySimulationRun({ policy_change_specification_id: s.id, simulation_type: simType, simulation_status: 'draft', limitations: [r] }), 'Simulation draft 기록(미실행 — completed 아님)');
            })}
            {btn('완료 기록(Evidence 필수)', () => {
              const r = needReason(); const s = needSpec();
              if (!r || !s) return;
              void act(() => recordPolicySimulationRun({ policy_change_specification_id: s.id, simulation_type: simType, simulation_status: 'completed_reference', evidence: [r], started_at: new Date().toISOString(), completed_at: new Date().toISOString() }), 'completed_reference 기록(Simulation ≠ Reality)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Historical Replay 는 과거 데이터(0536/0537 Runtime 이력) 기준 참고입니다 — Replay ≠ Future Outcome. 실행하지 않은 Simulation 을 completed 로 표시하는 것은 서버가 차단합니다(Evidence+started_at 필수). Specification 이 approved_for_simulation_reference 상태여야 기록 가능합니다." />
          {!sims.length ? <AdminEmpty title="Simulation Run 없음" description="승인된 Specification 에 대해서만 기록 가능합니다." /> : (
            <div className="space-y-1">
              {sims.slice(0, 30).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(s.simulation_status)}>{s.simulation_status}</AdminBadge>
                    <span className="font-bold">{s.simulation_code}</span>
                    <span className="text-muted-foreground">{s.simulation_type} · scope {s.simulation_scope_type} · sample {NUM(s.sample_size)} · confidence {NUM(s.confidence)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'counterfactual' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" description="Counterfactual 모델 엔진은 이 코드베이스에 없습니다(실측) — simulation_model_missing. Counterfactual ≠ Fact, 외부 요인 미검토 시 causality_unverified 를 유지합니다. Counterfactual 유형 기록은 Historical Replay 탭의 기록 폼에서 simulation_type=counterfactual 로 수행합니다." />
          {!sims.filter((s) => s.simulation_type === 'counterfactual').length ? <AdminEmpty title="Counterfactual 기록 없음" description="모델 없음이 명시된 참고 기록만 허용됩니다." /> : (
            <div className="space-y-1">
              {sims.filter((s) => s.simulation_type === 'counterfactual').slice(0, 30).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={tone(s.simulation_status)}>{s.simulation_status}</AdminBadge>
                  <span className="ml-2 font-bold">{s.simulation_code}</span>
                  <span className="ml-2 text-muted-foreground">confidence {NUM(s.confidence)} — Counterfactual ≠ Fact</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'conflicts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}
            <select value={conflictResult} onChange={(e) => setConflictResult(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CONFLICT_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Conflict 검토 기록', () => rolloutEvent('policy_conflict_reviewed', { result: conflictResult }, 'Conflict 검토 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="No Detected Conflict ≠ No Conflict — 점검하지 않은 도메인은 conflict_unverified 로 유지됩니다. Constitution immutable 규칙(0496 HUMAN_APPROVAL_REQUIRED) 접촉은 항상 충돌 후보입니다. 자동 해소 없음." />
          {eventList(evByType('policy_conflict_reviewed'), 'Conflict 검토 없음', '17종 result whitelist 로 기록됩니다.')}
        </div>
      )}

      {compatDomain && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}
            <select value={compatResult} onChange={(e) => setCompatResult(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {COMPAT_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn(`${compatDomain} 호환성 검토 기록`, () => rolloutEvent('compatibility_reviewed', { domain: compatDomain, result: compatResult }, '호환성 검토 기록됨(Compatibility ≠ Safety)'), true)}
          </div>
          <AdminAlert tone="info" description={`${compatDomain} 도메인 호환성 검토 — Compatibility ≠ Safety. 검토하지 않으면 compatibility_unverified 로 유지됩니다.`} />
          {eventList(evByType('compatibility_reviewed').filter((e) => String(e.payload?.domain ?? '') === compatDomain), `${compatDomain} 호환성 검토 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'blastradius' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Blast Radius 검토 기록', () => rolloutEvent('blast_radius_reviewed', { note: 'estimate_only' }, 'Blast Radius 검토 기록됨(Estimate ≠ Actual Impact)'), true)}
          </div>
          <AdminAlert tone="info" description="Blast Radius 는 추정입니다 — Estimate ≠ Actual Impact. Cross-Enterprise 확산과 target 50개 초과는 서버에서 차단됩니다. 자동 확대 없음." />
          {eventList(evByType('blast_radius_reviewed'), 'Blast Radius 검토 없음', '영향 범위 추정 검토가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'friction' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Friction 검토 기록', () => rolloutEvent('operational_friction_reviewed', { note: 'estimate_only' }, 'Friction 검토 기록됨(Friction ≠ UX 사실)'), true)}
          </div>
          <AdminAlert tone="info" description="운영 마찰 추정 — Friction Estimate ≠ UX Fact. 실사용자 피드백 없이 '마찰 없음' 을 확정하지 않습니다." />
          {eventList(evByType('operational_friction_reviewed'), 'Friction 검토 없음', '승인 단계 증가/지연/수동 작업 증가 후보가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'benefit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Safety Benefit 검토 기록', () => rolloutEvent('safety_benefit_reviewed', { note: 'candidate_only' }, 'Benefit 검토 기록됨(후보 ≠ 실제 이익)'), true)}
          </div>
          <AdminAlert tone="info" description="Safety Benefit 은 후보입니다 — Benefit Candidate ≠ Actual Benefit. Evidence 없는 Benefit 주장은 기록하지 않습니다." />
          {eventList(evByType('safety_benefit_reviewed'), 'Benefit 검토 없음', 'Incident/Control Gap 대응 후보가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'validationplans' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Validation Plan 기록', () => rolloutEvent('validation_plan_created', { environment: 'non_production' }, 'Validation Plan 기록됨(Plan ≠ 검증 성공)'), true)}
          </div>
          <AdminAlert tone="info" description="Non-Production Validation Plan — production 환경은 차단됩니다. Plan ≠ Validation Success. Vercel Preview 는 실존 참조 가능(실측), Canary/Staging 은 없습니다." />
          {eventList(evByType('validation_plan_created'), 'Validation Plan 없음', 'non_production/sandbox/preview 검증 계획이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'validationevidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{reasonInput}
            {btn('Validation Evidence 기록', () => rolloutEvent('validation_evidence_recorded', { environment: 'non_production' }, 'Validation Evidence 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Sandbox Pass ≠ Production Safety — 비프로덕션 검증 통과는 프로덕션 안전을 보장하지 않습니다." />
          {eventList(evByType('validation_evidence_recorded'), 'Validation Evidence 없음', '검증 Evidence 가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'rolloutplans' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {specSelect}{simSelect}
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ROLLOUT_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {reasonInput}
            {btn('Rollout Plan 생성(실행 아님)', () => {
              const r = needReason(); const s = needSpec(); const si = needSim();
              if (!r || !s || !si) return;
              void act(() => createPolicyRolloutPlan({
                policy_change_specification_id: s.id, policy_simulation_run_id: si.id, rollout_strategy: strategy,
                environment_scope: 'non_production', stop_conditions: [r], rollback_conditions: ['manual_rollback_review_required'],
                observation_windows: ['post_application_review'], assigned_reviewers: ['human_reviewer_required'],
              }), 'Rollout Plan 생성됨(draft — Plan ≠ Execution)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="허용 전략 8종만 가능 — production_global/unattended_rollout/automatic_expansion/automatic_rollback/cross_enterprise_rollout 은 서버 차단. production 환경 차단, target 50개 제한." />
          {!plans.length ? <AdminEmpty title="Rollout Plan 없음" description="Specification + Simulation 실존 검증 후 생성 가능합니다." /> : (
            <div className="space-y-1">
              {plans.slice(0, 30).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(p.rollout_status)}>{p.rollout_status}</AdminBadge>
                    <span className="font-bold">{p.rollout_code}</span>
                    <span className="text-muted-foreground">{p.rollout_strategy} · {p.environment_scope} · {p.target_scope_type} {p.target_scope_ids.length}개 · blast {p.estimated_blast_radius}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'pendingrollout' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}{reasonInput}
            {btn('검토 시작', () => planReview('start_review', {}, '검토 시작'))}
            {btn('승인(Evidence)', () => planReview('approve', { evidence: [reason.trim()] }, 'approved_reference(적용 아님)'), true)}
            {btn('반려', () => planReview('reject', {}, '반려'))}
            {btn('취소', () => planReview('cancel', {}, '취소'))}
            {btn('무효화', () => planReview('invalidate', {}, '무효화'))}
          </div>
          <AdminAlert tone="info" description="Rollout 승인은 항상 사람이 수행하며 Evidence 필수입니다. approved_reference ≠ applied. 작성자=승인자 self-review 는 경고가 부착됩니다." />
          {eventList(evByType('rollout_approval_reference_recorded'), 'Rollout 승인 기록 없음', '사람 승인 Reference 가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'gate' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}{reasonInput}
            {btn('Gate 검토(서버 강제)', () => planReview('gate_review', {}, 'ready_for_manual_application_reference'), true)}
          </div>
          {selPlanGate && (
            <AdminAlert tone={selPlanGate.ready ? 'success' : 'warning'}
              description={selPlanGate.ready ? 'Gate 조건 충족 후보 — Gate Ready ≠ Applied. 최종 판정은 서버 gate_review 가 수행합니다.' : `Gate blockers(클라이언트 참고 평가): ${selPlanGate.blockers.join(', ')} — 서버 게이트가 최종 강제합니다.`} />
          )}
          <AdminAlert tone="info" description="서버 게이트: approved_reference 상태 + Simulation completed + stop/rollback 조건 + observation window + reviewer 지정이 전부 있어야 통과합니다. 통과해도 ready ≠ applied — 수동 Application Reference 만 허용됩니다." />
          {eventList(evByType('rollout_gate_reviewed'), 'Gate 검토 없음', 'Gate 통과/차단 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'applicationrefs' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}
            <input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="External Reference URL(선택·500자 이내)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            {reasonInput}
            {btn('Application Reference 기록', () => planReview('record_application_reference', { evidence: [reason.trim()], external_reference_url: appUrl.trim() }, 'Application Reference 기록(적용 성공 아님)'), true)}
          </div>
          <AdminAlert tone="info" description="사람이 외부에서 적용을 수행한 뒤 Reference 만 기록합니다 — 이 시스템은 Policy 를 적용하지 않습니다. Reference ≠ 실제 적용 성공, 원본 Policy(0512 등)는 미변경." />
          {eventList(evByType('policy_application_reference_recorded'), 'Application Reference 없음', 'gate ready 상태에서만 기록 가능합니다.')}
        </div>
      )}

      {tab === 'appverify' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}{reasonInput}
            {btn('Application 검증(Evidence)', () => planReview('verify_application', { evidence: [reason.trim()] }, 'verified — Verified ≠ Effectiveness'), true)}
          </div>
          <AdminAlert tone="info" description="Application 검증은 Evidence 기반 사람 확인입니다 — Verified Application ≠ Effectiveness. 검증 없으면 application_unverified 유지." />
          {eventList(evByType('policy_application_verified_reference'), 'Application 검증 없음', 'Evidence 기반 검증 Reference 가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'observation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}
            <select value={obsResult} onChange={(e) => setObsResult(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {OBSERVATION_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('관측 시작', () => planReview('start_observation', {}, '관측 시작'))}
            {btn('관측 완료 기록', () => planReview('complete_observation', { observation: obsResult }, '관측 완료(Observation ≠ Causality)'), true)}
            {btn('Closure(Evidence)', () => planReview('close', { evidence: [reason.trim()] }, 'closed_reference'))}
            {btn('Closure(제한 포함)', () => planReview('close_with_limitation', { evidence: [reason.trim()] }, 'closed_with_limitation'))}
          </div>
          <AdminAlert tone="info" description="Post-Rollout Observation — Application ≠ Effectiveness, Observation ≠ Causality. 외부 요인 미배제 시 causality_unverified 를 유지합니다. Closure 는 관측 완료(closure_pending) 후 Evidence 필수." />
          {eventList([...evByType('post_rollout_observation_started_reference'), ...evByType('post_rollout_observation_completed_reference'), ...evByType('rollout_closure_reviewed')], '관측/Closure 기록 없음', '관측 시작/완료와 사람 Closure 가 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'unexpected' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {planSelect}{reasonInput}
            {btn('Unexpected Effect 기록', () => planReview('record_unexpected_effect', { note: 'human_review_required' }, 'Unexpected Effect 기록(자동 Rollback 없음)'), true)}
            {btn('Pause 검토 요청', () => planReview('request_pause_review', {}, 'Pause 검토 요청(Request ≠ Success)'))}
            {btn('Rollback 검토 요청', () => planReview('request_rollback_review', {}, 'Rollback 검토 요청(자동 Rollback 없음)'))}
          </div>
          <AdminAlert tone="warning" description="Unexpected Effect 검출 시에도 자동 Rollback/자동 중지는 없습니다 — Pause/Rollback 은 사람 검토 요청만 기록됩니다." />
          {eventList([...evByType('unexpected_effect_detected'), ...evByType('rollout_pause_review_requested'), ...evByType('rollback_review_requested')], 'Unexpected Effect 없음', '예상 밖 효과 후보와 Pause/Rollback 검토 요청이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'humanreviews' && (
        eventList([...evByType('change_specification_reviewed'), ...evByType('rollout_plan_reviewed'), ...evByType('rollout_closure_reviewed')].sort((a, b) => b.created_at.localeCompare(a.created_at)), 'Human Review 없음', '모든 승인·반려·종결은 사람 기록으로만 남습니다.')
      )}

      {tab === 'recommendations' && (
        !recommendations.length ? <AdminEmpty title="추천 없음" description="실측 수치 기반 조건을 충족한 추천만 표시됩니다 — Evidence 없는 추천 없음." /> : (
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <span className="ml-2 text-muted-foreground">제안 전용 — 실행은 사람이 결정</span>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="측정 카운트 요약 — 완료 주장이 아닙니다(timelineIsNotCompletionClaim). Unknown 은 insufficient_data 로 유지합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {timeline.stages.map((s) => (
              <div key={s.stage} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{s.stage}</p>
                <p className="mt-0.5 text-sm font-black">{s.status === 'measured' ? NUM(s.count) : 'insufficient_data'}</p>
                <p className="text-[10px] text-muted-foreground">{s.source}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        eventList(audit, 'Audit 없음', '27종 이벤트 전체 감사 로그입니다.')
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 구성요소(추측 없음) — available:false 는 이 코드베이스에 해당 구조가 없음을 의미합니다." />
          <div className="space-y-1">
            {SIMULATION_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'warning'}>{c.available === true ? 'available' : c.available === false ? 'unavailable' : 'unverified'}</AdminBadge>
                <span className="ml-2 font-bold">{c.key}</span>
                <span className="ml-2 text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {POLICY_ROLLOUT_SUPPORT.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.status === 'supported' ? 'success' : 'danger'}>{s.status}</AdminBadge>
                <span className="ml-2 font-bold">{s.key}</span>
                <span className="ml-2 text-muted-foreground">{s.note}</span>
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
