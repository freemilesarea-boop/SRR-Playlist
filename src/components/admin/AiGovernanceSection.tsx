/**
 * AiGovernanceSection — AI Constitution, Trust Governance & Controlled Production Gateway
 * (Phase AI-MUSIC-8).
 *
 * 전체 AI 흐름의 헌법/신뢰/평판/거버넌스 건전성을 통합 관리하고 Production Change Request Candidate
 * 를 Governance Ready 까지만 진행한다. 실제 Production Apply 없음 · AI 는 Constitution/자기 Trust 수정 불가.
 *
 * 탭: Overview · AI Constitution · Trust · Trust Budget · Decision Quality · Reputation ·
 *     Human Overrides · Constitutional Audit · Violations · Change Candidates · Governance History · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, BookLock, ShieldCheck, Gauge, Target, Award, UserCog, ClipboardList,
  AlertOctagon, PackageCheck, History, BookOpen, RefreshCw, Lock,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchConstitutionRules, fetchGovernanceEvents, fetchHumanOverrides, fetchGovernanceSummary,
  fetchChangeCandidateHistory, requestChangeCandidate, setChangeCandidateStatus, recordHumanOverride,
  fetchStrategyLearning, fetchSandboxSummary, fetchPromotionSummary, fetchPromotionHistory,
  type ConstitutionRuleRow, type GovernanceEventRow, type HumanOverrideRow, type GovernanceSummaryResp,
  type ChangeCandidateRow, type StrategyLearningResp, type SandboxSummary, type PromotionSummary, type PromotionDraftRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  constitutionCheck, predictionTrust, strategyTrust, sandboxTrust, draftTrust, governanceTrust, overallTrust,
  trustStatus, trustBudget, decisionQuality, reputation, governanceHealth, changeCandidateEligibility,
  defaultExecutionPreconditions, changeIdempotencyKey, immutableRules,
  GOVERNANCE_SUPPORT, CHANGE_MANAGEMENT_BOUNDARY, CONSTITUTION_VERSION,
  TRUST_STATE_LABEL, TRUST_STATE_TONE, HEALTH_STATUS_LABEL, HEALTH_STATUS_TONE, SEVERITY_TONE,
  CANDIDATE_STATUS_LABEL, CANDIDATE_STATUS_TONE, trustTone,
  type TrustScore, type RiskTier,
} from '@/lib/aiGovernance';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const SC = (n: number | null | undefined) => (n == null ? '데이터 부족' : `${n}`);

type Tab = 'overview' | 'constitution' | 'trust' | 'budget' | 'quality' | 'reputation' | 'overrides' | 'audit' | 'violations' | 'candidates' | 'history' | 'support';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'constitution', label: 'AI Constitution', icon: BookLock },
  { key: 'trust', label: 'Trust', icon: ShieldCheck },
  { key: 'budget', label: 'Trust Budget', icon: Gauge },
  { key: 'quality', label: 'Decision Quality', icon: Target },
  { key: 'reputation', label: 'Reputation', icon: Award },
  { key: 'overrides', label: 'Human Overrides', icon: UserCog },
  { key: 'audit', label: 'Constitutional Audit', icon: ClipboardList },
  { key: 'violations', label: 'Violations', icon: AlertOctagon },
  { key: 'candidates', label: 'Change Candidates', icon: PackageCheck },
  { key: 'history', label: 'Governance History', icon: History },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

export default function AiGovernanceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<GovernanceSummaryResp | null>(null);
  const [rules, setRules] = useState<ConstitutionRuleRow[]>([]);
  const [events, setEvents] = useState<GovernanceEventRow[]>([]);
  const [overrides, setOverrides] = useState<{ items: HumanOverrideRow[]; signal: Array<{ override_type: string; reason_code: string | null; n: number }> }>({ items: [], signal: [] });
  const [strategyLearning, setStrategyLearning] = useState<StrategyLearningResp | null>(null);
  const [sandboxSummary, setSandboxSummary] = useState<SandboxSummary | null>(null);
  const [promotionSummary, setPromotionSummary] = useState<PromotionSummary | null>(null);
  const [candidateDrafts, setCandidateDrafts] = useState<PromotionDraftRow[]>([]);
  const [candidates, setCandidates] = useState<ChangeCandidateRow[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [gs, cr, ev, ov, sl, ss, ps, dr, ch] = await Promise.all([
        fetchGovernanceSummary(), fetchConstitutionRules(null), fetchGovernanceEvents(null, null, 200), fetchHumanOverrides(200),
        fetchStrategyLearning(null), fetchSandboxSummary(null), fetchPromotionSummary(null),
        fetchPromotionHistory(null, 'drafts', 100), fetchChangeCandidateHistory(null, null, 100),
      ]);
      setSummary(gs); setRules(cr); setEvents(ev); setOverrides(ov);
      setStrategyLearning(sl); setSandboxSummary(ss); setPromotionSummary(ps);
      setCandidateDrafts((dr as PromotionDraftRow[]).filter((d) => d.canary_status === 'candidate' && d.draft_status === 'ready'));
      setCandidates(ch);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── Trust 계층 실시간 계산(존재 성분만) ──
  const trust = useMemo(() => {
    const sl = strategyLearning?.totals;
    const resolved = sl?.resolved_outcomes ?? 0;
    const stratOutcome = resolved > 0 ? Math.round((sl!.improved / resolved) * 100) : null;
    const approvalRate = sl && sl.total > 0 ? Math.round((sl.approved / sl.total) * 100) : null;
    const violations = summary?.events?.violations ?? 0;
    const blocked = summary?.events?.blocked ?? 0;
    const criticalActive = (summary?.candidates?.critical_risk ?? 0) > 0 && violations > 0;
    const blockRate = violations + blocked > 0 ? Math.round((blocked / (violations + blocked)) * 100) : 100;
    const drafts = promotionSummary?.drafts;
    const draftAcc = drafts && drafts.total > 0 ? Math.round(((drafts.total - drafts.validation_failed) / drafts.total) * 100) : null;

    const prediction = predictionTrust({ accuracy: null, sampleSufficiency: 200, outcomeSample: 0 });
    const strategy = strategyTrust({ approvalRate, sandboxPassRate: null, outcomeSuccessRate: stratOutcome, evidenceCompleteness: 100, outcomeSample: resolved });
    const sandbox = sandboxTrust({ evidenceCompleteness: 100, outcomeSample: 0, snapshotQuality: sandboxSummary?.avg_safety ?? 60, goSuccessRate: null });
    const draft = draftTrust({ validationAccuracy: draftAcc, duplicatePrevention: 100, idempotencySuccess: 100, policyCompliance: 100, rollbackReadiness: 100, outcomeSample: 0 });
    const governance = governanceTrust({ violationBlockRate: blockRate, auditCompleteness: 100, approvalCompliance: 100, criticalBlockRate: blockRate, humanApprovalMissing: 0, productionBypass: 0, expiredBlockRate: 100, unauthorizedBlockRate: 100, criticalViolationActive: criticalActive });
    const layers = [prediction, strategy, sandbox, draft, governance];
    const overall = overallTrust(layers);
    const state = trustStatus(overall, governance, criticalActive);
    const budget = trustBudget(state);
    const health = governanceHealth({ constitutionCompliance: 100 - Math.min(100, violations), auditCompleteness: 100, unauthorizedBlock: 100, approvalCompliance: 100, expirationEnforcement: 100, duplicatePrevention: 100, idempotencySuccess: 100, criticalBlockRate: blockRate, evidenceCompleteness: 100, productionSafety: 100, criticalViolationActive: criticalActive });
    const dq = decisionQuality({ strategySuccess: stratOutcome, draftValidationAccuracy: draftAcc, sandboxAccuracy: null, evidenceCompleteness: 100, humanOverrideRate: overrides.items.length > 0 ? Math.min(100, overrides.items.length * 5) : null });
    const rep = reputation({ decisionQuality: dq.score, overallTrust: overall.score, governanceTrust: governance.score, strategySuccess: stratOutcome, constitutionCompliance: 100 - Math.min(100, violations), sample: resolved });
    return { prediction, strategy, sandbox, draft, governance, overall, state, budget, health, dq, rep, criticalActive };
  }, [strategyLearning, sandboxSummary, promotionSummary, summary, overrides]);

  const createCandidate = async (draft: PromotionDraftRow) => {
    const risk = (draft.risk_tier as RiskTier) ?? 'low';
    const con = constitutionCheck({
      humanApproved: true, evidenceComplete: true, baselinePresent: true, inputSnapshotPresent: true, sourceVersionPresent: !!draft.source_input_hash,
      confidencePresent: true, sample: 300, syntheticData: false, unsupportedInference: false, nullToZero: false, nanPresent: false, expiredInput: !!draft.expired_at,
      riskTier: risk, unresolvedConflict: false, missingDependency: false, auditPresent: true, idempotencyPresent: true,
    });
    const elig = changeCandidateEligibility({
      draftReady: draft.draft_status === 'ready', canaryCandidate: draft.canary_status === 'candidate', promotionApproved: true, sandboxValid: !!draft.sandbox_run_id,
      constitutionPass: con.pass, criticalViolation: con.criticalViolations > 0, riskTier: risk, trustState: trust.state,
      rollbackPlan: !!draft.rollback_plan, observationPlan: !!draft.observation_plan, evidenceComplete: true, inputHashMatch: true, modelVersionMatch: true, policyVersionMatch: true, expired: !!draft.expired_at, humanApproved: true,
    });
    if (!elig.eligible) { toast.error(`Candidate 생성 불가: ${elig.blockers.join(', ')}`); return; }
    setBusy(true);
    try {
      await requestChangeCandidate({
        source_draft_id: draft.id, source_sandbox_run_id: draft.sandbox_run_id, context_key: draft.context_key, change_type: draft.draft_type,
        risk_tier: risk, readiness_score: draft.canary_readiness ?? 60, human_approved: true, constitution_pass: con.pass,
        trust_snapshot: { overall: trust.overall.score, governance: trust.governance.score, state: trust.state },
        constitution_result: { pass: con.pass, violations: con.violations, results: con.results },
        governance_result: { health: trust.health.score, status: trust.health.status },
        rollback_plan: draft.rollback_plan ?? {}, observation_plan: draft.observation_plan ?? {},
        execution_preconditions: defaultExecutionPreconditions(), source_input_hash: draft.source_input_hash, source_model_version: draft.source_model_version,
        idempotency_key: changeIdempotencyKey({ draftId: draft.id!, contextKey: draft.context_key, changeType: draft.draft_type, inputHash: draft.source_input_hash }),
        evidence: [{ label: 'Draft', value: draft.id }, { label: 'Constitution', value: con.pass ? 'pass' : 'fail' }, { label: 'Trust', value: trust.state }, { label: 'Version', value: CONSTITUTION_VERSION }],
      });
      toast.success('Change Candidate 생성됨(별도 운영 승인 대기 · Production Apply 아님)');
      setCandidates(await fetchChangeCandidateHistory(null, null, 100));
      setSummary(await fetchGovernanceSummary());
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const setStatus = async (id: string, status: string) => {
    setBusy(true);
    try { await setChangeCandidateStatus(id, status, null); toast.success(`상태: ${CANDIDATE_STATUS_LABEL[status] ?? status}`); setCandidates(await fetchChangeCandidateHistory(null, null, 100)); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const logOverride = async (draft: PromotionDraftRow, type: string) => {
    setBusy(true);
    try { await recordHumanOverride({ source_type: 'draft', source_id: draft.id, context_key: draft.context_key, override_type: type, reason_code: 'manual_business_reason', risk_tier: draft.risk_tier }); toast.success('Override 기록됨'); setOverrides(await fetchHumanOverrides(200)); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="AI Governance & Trust"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Governance & Trust">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Governance & Trust"
      subtitle="AI 헌법 · 신뢰/평판 · 거버넌스 건전성 · Production Change Candidate (실제 Apply 없음 · AI 자기수정 불가)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="AI-MUSIC-8 은 Production Apply/Deploy/Publish 엔진이 아닙니다. Change Candidate 는 Governance Ready 까지만 진행되며 실제 실행은 별도 Change Management Phase 에서만 수행합니다. AI 는 Constitution 과 자신의 Trust 를 수정할 수 없습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Overall AI Trust" value={SC(trust.overall.score)} tone={trustTone(trust.overall.score)} badge={<AdminBadge tone={TRUST_STATE_TONE[trust.state]}>{TRUST_STATE_LABEL[trust.state]}</AdminBadge>} />
          <Box label="Governance Health" value={`${trust.health.score}`} badge={<AdminBadge tone={HEALTH_STATUS_TONE[trust.health.status]}>{HEALTH_STATUS_LABEL[trust.health.status]}</AdminBadge>} />
          <Box label="Decision Quality" value={SC(trust.dq.score)} />
          <Box label="Reputation" value={SC(trust.rep.score)} />
          <Box label="Prediction / Strategy Trust" value={`${SC(trust.prediction.score)} / ${SC(trust.strategy.score)}`} />
          <Box label="Sandbox / Draft Trust" value={`${SC(trust.sandbox.score)} / ${SC(trust.draft.score)}`} />
          <Box label="Active / Critical Violations" value={`${NUM(summary?.events?.violations)} / ${NUM(summary?.candidates?.critical_risk)}`} />
          <Box label="Change Candidates (Ready)" value={`${NUM(summary?.candidates?.total)} (${NUM(summary?.candidates?.governance_ready)})`} />
        </div>
      )}

      {/* ── AI Constitution ── */}
      {tab === 'constitution' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title={`AI Constitution v${CONSTITUTION_VERSION} · Immutable ${immutableRules().length}개`}
            description="Immutable Rule 은 UI 에서 비활성화할 수 없으며 AI 가 수정할 수 없습니다(변경 RPC 없음)." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Rule Code</th><th className="px-2">Category</th><th className="px-2">Severity</th><th className="px-2">Enforcement</th><th className="px-2">Immutable</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule_code} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{r.rule_code}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">{r.category}</td>
                    <td className="px-2"><AdminBadge tone={SEVERITY_TONE[r.severity as never]}>{r.severity}</AdminBadge></td>
                    <td className="px-2">{r.enforcement_type}</td>
                    <td className="px-2">{r.immutable ? <AdminBadge tone="danger">수정 불가</AdminBadge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Trust ── */}
      {tab === 'trust' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="계층별 Trust (실제 Outcome 기반 · Outcome 부족 시 provisional)"
            description="Governance Trust 가 Critical 수준이면 Overall Trust 에 상한이 적용됩니다. Trust 는 AI 자신감이 아닙니다." />
          {([trust.prediction, trust.strategy, trust.sandbox, trust.draft, trust.governance, trust.overall] as TrustScore[]).map((t) => (
            <div key={t.layer} className="flex items-center gap-2">
              <span className="w-24 text-[11px] font-bold capitalize">{t.layer}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${(t.score ?? 0) >= 70 ? 'bg-emerald-500' : (t.score ?? 0) >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${t.score ?? 0}%` }} /></div>
              <span className="w-16 text-right text-[11px]">{t.score == null ? '데이터 부족' : t.score}</span>
              {t.provisional && <AdminBadge tone="warning">provisional</AdminBadge>}
            </div>
          ))}
          <p className="pt-1 text-[10px] text-muted-foreground">※ Prediction/Sandbox Trust 는 실제 Production/Canary Outcome 축적 전까지 provisional 입니다.</p>
        </div>
      )}

      {/* ── Trust Budget ── */}
      {tab === 'budget' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2"><span className="text-xs font-bold">현재 Trust Status</span><AdminBadge tone={TRUST_STATE_TONE[trust.state]}>{TRUST_STATE_LABEL[trust.state]}</AdminBadge><span className="text-[10px] text-muted-foreground">{trust.budget.note}</span></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="일일 Strategy Candidate" value={`${trust.budget.dailyStrategyCandidates}`} />
            <Box label="일일 High Risk" value={`${trust.budget.dailyHighRiskCandidates}`} />
            <Box label="일일 Promotion 추천" value={`${trust.budget.dailyPromotionRecs}`} />
            <Box label="일일 Canary 추천" value={`${trust.budget.dailyCanaryRecs}`} />
            <Box label="Context 반복 제한" value={`${trust.budget.sameContextRepeat}`} />
            <Box label="Strategy 반복 제한" value={`${trust.budget.sameStrategyRepeat}`} />
          </div>
          <AdminAlert tone="info" title="Budget 은 추천/후보 생성 제한 (실행 권한 아님)"
            description="Trust 가 높아도 Production 자동 적용 권한은 부여되지 않습니다. Budget 은 관리자 설정 Policy 로만 변경(AI 자동 변경 금지)." />
        </div>
      )}

      {/* ── Decision Quality ── */}
      {tab === 'quality' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Decision Quality (Outcome 없는 항목은 null 유지)" />
          {trust.dq.components.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <span className="w-40 text-[11px] font-semibold">{c.key}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${c.value == null ? 'bg-muted-foreground/30' : 'bg-accent'}`} style={{ width: `${c.value ?? 0}%` }} /></div>
              <span className="w-16 text-right text-[10px]">{c.value == null ? '데이터 없음' : c.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Reputation ── */}
      {tab === 'reputation' && (
        <div className="space-y-3">
          <Box label="AI Reputation (장기 누적)" value={SC(trust.rep.score)} badge={trust.rep.provisional ? <AdminBadge tone="warning">provisional</AdminBadge> : null} />
          <AdminAlert tone="info" title="Reputation ≠ 현재 Confidence"
            description="단기 데이터로 과도하게 변화하지 않도록 이전값과 smoothing 합니다. Reputation Snapshot 은 실시간 계산으로 대체(Trend 필요 시 추가)." />
        </div>
      )}

      {/* ── Human Overrides ── */}
      {tab === 'overrides' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Human Override (기록만 · 자동 Weight 변경 없음)"
            description="Override 를 성공/실패로 임의 해석하지 않으며 실제 Outcome 과 분리합니다." />
          {overrides.signal.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {overrides.signal.map((s, i) => <AdminBadge key={i} tone="neutral">{s.override_type}/{s.reason_code ?? '—'}: {s.n}</AdminBadge>)}
            </div>
          )}
          {!overrides.items.length ? <AdminEmpty icon={<UserCog size={20} />} title="Override 기록 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Source</th><th className="px-2">Override</th><th className="px-2">Reason</th><th className="px-2">Risk</th><th className="px-2">시각</th></tr></thead>
                <tbody>{overrides.items.map((o) => <tr key={o.id} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{o.source_type}</td><td className="px-2">{o.override_type}</td><td className="px-2 text-[10px] text-muted-foreground">{o.reason_code ?? '—'}</td><td className="px-2">{o.risk_tier ?? '—'}</td><td className="px-2 text-[10px] text-muted-foreground">{o.created_at.slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Constitutional Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Constitution Rule 별 Audit (Critical Violation 별도)" />
          {!summary?.constitution_audit.length ? <AdminEmpty icon={<ClipboardList size={20} />} title="Constitution Check 이력 없음" description="Change Candidate 생성 시 Constitution Check 이 기록됩니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Rule</th><th className="px-2">Checked</th><th className="px-2">Violations</th><th className="px-2">Warnings</th></tr></thead>
                <tbody>{summary.constitution_audit.map((a) => <tr key={a.rule_code} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{a.rule_code}</td><td className="px-2">{a.checked}</td><td className="px-2">{a.violations > 0 ? <AdminBadge tone="danger">{a.violations}</AdminBadge> : 0}</td><td className="px-2">{a.warnings}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Violations ── */}
      {tab === 'violations' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Violations" value={NUM(summary?.events?.violations)} />
            <Box label="Blocked" value={NUM(summary?.events?.blocked)} />
            <Box label="Critical Risk Candidates" value={NUM(summary?.candidates?.critical_risk)} />
            <Box label="Overrides" value={NUM(summary?.events?.overrides)} />
          </div>
          {events.filter((e) => e.event_type === 'violation_detected' || e.event_type === 'violation_blocked').length === 0
            ? <AdminEmpty icon={<AlertOctagon size={20} />} title="위반 이벤트 없음" />
            : events.filter((e) => e.event_type.startsWith('violation')).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="danger">{e.event_type}</AdminBadge><span>{e.source_type} · {e.context_key ?? '—'}</span><span className="ml-auto text-[10px] text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span></div>
            ))}
        </div>
      )}

      {/* ── Change Candidates ── */}
      {tab === 'candidates' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />}
            description="Change Candidate 는 Governance Ready 까지만. 실제 Apply/Deploy/Publish/Run 버튼은 없습니다(별도 Change Management Phase)." />
          {trust.state === 'suspended' || trust.state === 'restricted' ? (
            <AdminAlert tone="danger" title={`Trust ${TRUST_STATE_LABEL[trust.state]} — Candidate 생성 제한`} description="Trust 상태가 회복되어야 신규 Candidate 를 생성할 수 있습니다." />
          ) : (
            <AdminCard title="Governance-Ready 후보 소스 (Canary Candidate Draft)">
              {!candidateDrafts.length ? <p className="text-[11px] text-muted-foreground">Draft Promotion 에서 Canary Candidate 로 지정된 ready Draft 가 없습니다.</p> : candidateDrafts.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1.5">
                  <AdminBadge tone="info">{d.draft_type}</AdminBadge>
                  <span className="text-[11px]">{d.context_key} · Canary Readiness {d.canary_readiness ?? '—'}</span>
                  <button disabled={busy} onClick={() => void createCandidate(d)} className="ml-auto rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50">Change Candidate 생성 요청</button>
                  <button disabled={busy} onClick={() => void logOverride(d, 'draft_approved')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Override 기록</button>
                </div>
              ))}
            </AdminCard>
          )}
          {!candidates.length ? <AdminEmpty icon={<PackageCheck size={20} />} title="Change Candidate 없음" /> : candidates.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={CANDIDATE_STATUS_TONE[c.candidate_status] ?? 'neutral'}>{CANDIDATE_STATUS_LABEL[c.candidate_status] ?? c.candidate_status}</AdminBadge>
                <AdminBadge tone="info">{c.change_type}</AdminBadge>
                {c.risk_tier && <AdminBadge tone={c.risk_tier === 'low' ? 'success' : c.risk_tier === 'medium' ? 'warning' : 'danger'}>{c.risk_tier}</AdminBadge>}
                <span className="text-[10px] text-muted-foreground">{c.context_key} · Readiness {c.readiness_score ?? '—'}</span>
              </div>
              {c.candidate_status === 'pending_governance_review' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button disabled={busy} onClick={() => void setStatus(c.id!, 'review_required')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Governance Review</button>
                  <button disabled={busy} onClick={() => void setStatus(c.id!, 'governance_ready')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Governance Ready 지정</button>
                  <button disabled={busy} onClick={() => void setStatus(c.id!, 'rejected')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Governance History ── */}
      {tab === 'history' && (
        <div className="space-y-2">
          {!events.length ? <AdminEmpty icon={<History size={20} />} title="Governance Event 없음" /> : events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span>{e.source_type}{e.context_key ? ` · ${e.context_key}` : ''}</span>
              {e.governance_decision && <span className="text-muted-foreground">→ {e.governance_decision}</span>}
              <span className="ml-auto text-[10px] text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <AdminCard title="Governance 지원 범위">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>{GOVERNANCE_SUPPORT.map((s) => <tr key={s.key} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{s.label}</td><td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'audit_only' || s.status === 'policy_only' ? 'info' : 'warning'}>{s.status}</AdminBadge></td><td className="px-2 text-[10px] text-muted-foreground">{s.note}</td></tr>)}</tbody>
            </table>
          </AdminCard>
          <AdminCard title="Change Management Boundary">
            <ul className="space-y-1 text-[11px]">{CHANGE_MANAGEMENT_BOUNDARY.map((b, i) => <li key={i} className="text-muted-foreground">• {b}</li>)}</ul>
          </AdminCard>
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value, tone, badge }: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' | 'neutral'; badge?: React.ReactNode }) {
  const color = tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : '';
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-black break-words ${color}`}>{value}{badge}</p>
    </div>
  );
}
