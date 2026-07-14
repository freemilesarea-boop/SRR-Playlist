/**
 * OrganizationalLearningSection — Enterprise Organizational Learning, Policy Evolution &
 * Adaptive Governance Center (Phase AI-OPS-12).
 *
 * Decision Memory/Outcome/Lesson → Evidence Pool → Pattern → Repeatability/Applicability →
 * Organizational Learning → Policy Outcome Mapping → Evolution Candidate → Safety Gate →
 * Governance Adaptation → Human Review → Audit.
 * 1회 성공 ≠ Best Practice · 1회 실패 ≠ 폐기 · 상관 ≠ 인과 · 자동 정책 변경/모델 학습 없음.
 *
 * 탭 26개: Overview · Learning Evidence · Evidence Eligibility · Context Signatures ·
 * Learning Patterns · Repeatability · Applicability · Conflicting Evidence ·
 * Organizational Learnings · Learning Maturity · Policy Outcome Mapping · Policy Performance ·
 * Policy Evolution Candidates · Evolution Safety Gate · Repeated Failures · Repeated Successes ·
 * Practice Candidates · Learning Staleness · Knowledge Refresh · Decision Chains ·
 * Governance Adaptation · Policy Evolution Timeline · Human Reviews · External Policy Actions ·
 * Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Brain, FileText, Grid3x3, History, Layers, Lightbulb, Link2,
  Lock, RefreshCw, Scale, ScrollText, Search, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchOLSummary, createOLEvidence, fetchOLEvidence, createOLPattern, fetchOLPatterns,
  saveOLLearning, reviewOLLearning, fetchOLLearnings, createOLEvolutionCandidate, reviewOLEvolution,
  fetchOLEvolutionCandidates, recordOLExternalPolicyAction, fetchOLAudit,
  fetchDMRecords, fetchDMOutcomes, fetchPolicyInventory,
  type OLSummary, type OLEvidenceRow, type OLPatternRow, type OLLearningRow, type OLEvolutionRow,
  type OLEventRow, type DMRecordRow, type DMOutcomeRow, type PolicyRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateEvidenceEligibility, buildContextSignature, groupLearningEvidence, detectLearningPattern,
  evaluateApplicability, detectConflictingEvidence, calculateLearningMaturity, mapPolicyOutcomes,
  evaluatePolicyPerformance, buildPolicyEvolutionCandidate, evaluatePolicyEvolutionSafety,
  detectRepeatedFailure, detectRepeatedSuccess, evaluateLearningStaleness,
  buildKnowledgeRefreshRecommendation, buildDecisionChain, buildGovernanceAdaptationRecommendation,
  EXTERNAL_POLICY_ACTION_TYPES, OL_SUPPORT,
  type LearningEvidenceItem, type ConflictLevel, type EvidenceStrength,
} from '@/lib/organizationalLearning';
import type { OutcomeStatus } from '@/lib/decisionOutcomeIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'evidence' | 'eligibility' | 'contexts' | 'patterns' | 'repeatability' | 'applicability'
  | 'conflicts' | 'learnings' | 'maturity' | 'policymapping' | 'policyperf' | 'evolution' | 'safetygate'
  | 'failures' | 'successes' | 'practices' | 'staleness' | 'refresh' | 'chains' | 'governance' | 'timeline'
  | 'reviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'evidence', label: 'Learning Evidence', icon: BookOpen },
  { key: 'eligibility', label: 'Evidence Eligibility', icon: Scale },
  { key: 'contexts', label: 'Context Signatures', icon: Search },
  { key: 'patterns', label: 'Learning Patterns', icon: Brain },
  { key: 'repeatability', label: 'Repeatability', icon: RefreshCw },
  { key: 'applicability', label: 'Applicability', icon: Target },
  { key: 'conflicts', label: 'Conflicting Evidence', icon: AlertTriangle },
  { key: 'learnings', label: 'Organizational Learnings', icon: Lightbulb },
  { key: 'maturity', label: 'Learning Maturity', icon: TrendingUp },
  { key: 'policymapping', label: 'Policy Outcome Mapping', icon: Link2 },
  { key: 'policyperf', label: 'Policy Performance', icon: FileText },
  { key: 'evolution', label: 'Policy Evolution Candidates', icon: History },
  { key: 'safetygate', label: 'Evolution Safety Gate', icon: Lock },
  { key: 'failures', label: 'Repeated Failures', icon: AlertTriangle },
  { key: 'successes', label: 'Repeated Successes', icon: TrendingUp },
  { key: 'practices', label: 'Practice Candidates', icon: Lightbulb },
  { key: 'staleness', label: 'Learning Staleness', icon: History },
  { key: 'refresh', label: 'Knowledge Refresh', icon: RefreshCw },
  { key: 'chains', label: 'Decision Chains', icon: Link2 },
  { key: 'governance', label: 'Governance Adaptation', icon: Scale },
  { key: 'timeline', label: 'Policy Evolution Timeline', icon: History },
  { key: 'reviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Policy Actions', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function OrganizationalLearningSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<OLSummary>({});
  const [evidence, setEvidence] = useState<OLEvidenceRow[]>([]);
  const [patterns, setPatterns] = useState<OLPatternRow[]>([]);
  const [learnings, setLearnings] = useState<OLLearningRow[]>([]);
  const [candidates, setCandidates] = useState<OLEvolutionRow[]>([]);
  const [audit, setAudit] = useState<OLEventRow[]>([]);
  const [dmRecords, setDmRecords] = useState<DMRecordRow[]>([]);
  const [dmOutcomes, setDmOutcomes] = useState<DMOutcomeRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState<string>(EXTERNAL_POLICY_ACTION_TYPES[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ev, pa, le, ca, au, dm, out, po] = await Promise.all([
        fetchOLSummary(), fetchOLEvidence(null, null, 100), fetchOLPatterns(null, null, 100),
        fetchOLLearnings(null, 100), fetchOLEvolutionCandidates(null, 100), fetchOLAudit(100),
        fetchDMRecords(null, null, 100), fetchDMOutcomes(null, 100), fetchPolicyInventory(null, null, 100),
      ]);
      setSummary(s); setEvidence(ev); setPatterns(pa); setLearnings(le); setCandidates(ca); setAudit(au);
      setDmRecords(dm); setDmOutcomes(out); setPolicies(po);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  /* ── 순수 로직 분석 ── */
  const eligibilityRows = useMemo(() => dmOutcomes.map((o) => {
    const rec = dmRecords.find((r) => r.id === o.decision_memory_id);
    const e = evaluateEvidenceEligibility({
      hasDecision: !!rec, hasHumanDecision: rec?.decision_at != null,
      executionKnown: true,   // 0514 에서 execution_unverified 명시 지원
      outcomeStatus: (o.outcome_status === 'pending' ? 'outcome_pending' : o.outcome_status) as OutcomeStatus | 'outcome_pending',
      observationClosed: o.observation_window_id != null,
      baselineAvailable: null, hasEvidence: (o.evidence?.length ?? 0) > 0, hasScope: rec?.decision_domain != null,
      decisionTerminal: rec ? ['invalidated', 'cancelled', 'expired'].includes(rec.decision_status) : false,
    });
    return { outcome: o, rec, ...e };
  }), [dmOutcomes, dmRecords]);

  const kgItems: LearningEvidenceItem[] = useMemo(() => evidence.filter((e) => e.eligibility === 'eligible').map((e) => ({
    id: e.id, contextSignature: e.context_signature, outcomeStatus: e.outcome_status as OutcomeStatus, domain: e.learning_domain,
  })), [evidence]);
  const contextGroups = useMemo(() => groupLearningEvidence(kgItems), [kgItems]);
  const detectedPatterns = useMemo(() => [...contextGroups.entries()].map(([ctx, group]) => ({ ctx, r: detectLearningPattern(group) })), [contextGroups]);

  const conflicts = useMemo(() => [...contextGroups.entries()].map(([ctx, group]) => ({
    ctx,
    r: detectConflictingEvidence({
      positive: group.filter((g) => g.outcomeStatus === 'positive').length,
      negative: group.filter((g) => g.outcomeStatus === 'negative').length,
      axis: ctx, paymentOrSettlement: ctx.includes('settlement'),
    }),
  })).filter((c) => c.r.level !== 'insufficient_data'), [contextGroups]);

  const maturity = useMemo(() => {
    const total = evidence.length || null;
    const eligible = evidence.filter((e) => e.eligibility === 'eligible').length;
    return calculateLearningMaturity({
      evidenceCoverage: total ? Math.min(100, (eligible / total) * 100) : null,
      observationRate: dmOutcomes.length && dmRecords.length ? Math.min(100, (dmOutcomes.length / dmRecords.length) * 100) : null,
      baselineAvailability: null, executionVerification: null,
      repeatabilityCoverage: patterns.length ? Math.min(100, patterns.filter((p) => p.repeatability_status === 'consistently_observed' || p.repeatability_status === 'partially_repeated').length / patterns.length * 100) : null,
      contextCoverage: contextGroups.size ? Math.min(100, contextGroups.size * 20) : null,
      policyMapping: candidates.length ? 60 : null,
      humanValidation: learnings.length ? Math.min(100, learnings.filter((l) => l.review_status === 'validated_reference').length / learnings.length * 100) : null,
      auditCompleteness: audit.length ? 80 : null, freshness: null,
    });
  }, [evidence, dmOutcomes, dmRecords, patterns, contextGroups, candidates, learnings, audit]);

  const policyMappings = useMemo(() => policies.map((p) => {
    const linked = evidence.filter((e) => e.source_policy_id === p.id);
    const m = mapPolicyOutcomes({
      policyCode: p.policy_code,
      positive: linked.filter((e) => e.outcome_status === 'positive').length,
      negative: linked.filter((e) => e.outcome_status === 'negative').length,
      mixed: linked.filter((e) => e.outcome_status === 'mixed').length,
      inconclusive: linked.filter((e) => ['inconclusive', 'neutral', 'insufficient_data'].includes(e.outcome_status)).length,
      applicationVerified: null,   // 실제 적용 자동 확인 불가 — 정직 표기
    });
    const perf = evaluatePolicyPerformance({ positive: m.positive, negative: m.negative, mixed: m.mixed, inconclusive: m.inconclusive, applicationVerified: null, stale: false });
    return { policy: p, mapping: m, performance: perf };
  }), [policies, evidence]);

  const failures = useMemo(() => [...contextGroups.entries()].map(([ctx, group]) => ({
    ctx, r: detectRepeatedFailure({ negativeCount: group.filter((g) => g.outcomeStatus === 'negative').length, sameContext: true, critical: ctx.includes('settlement') || ctx.includes('security') }),
  })).filter((f) => f.r.verdict !== 'no_known_repeat_failure' && f.r.verdict !== 'insufficient_data'), [contextGroups]);

  const successes = useMemo(() => [...contextGroups.entries()].map(([ctx, group]) => ({
    ctx, r: detectRepeatedSuccess({ positiveCount: group.filter((g) => g.outcomeStatus === 'positive').length, sameContext: true, distinctScopes: 1, humanValidated: false }),
  })).filter((s) => s.r.verdict !== 'insufficient_data'), [contextGroups]);

  const staleRows = useMemo(() => evidence.map((e) => ({
    e,
    r: evaluateLearningStaleness({
      evidenceAgeDays: e.observed_at ? Math.floor((now.getTime() - new Date(e.observed_at).getTime()) / 86400000) : null,
      policyVersionChanged: false, metricDefinitionChanged: false, scopeRetired: false,
    }),
  })), [evidence, now]);

  const governanceRecs = useMemo(() => {
    const out: Exclude<ReturnType<typeof buildGovernanceAdaptationRecommendation>, { insufficient: true; why: string }>[] = [];
    const noBaseline = eligibilityRows.filter((r) => r.exclusionReason === 'baseline_unavailable').length;
    const noObs = eligibilityRows.filter((r) => r.exclusionReason === 'observation_incomplete').length;
    const conflicted = conflicts.filter((c) => c.r.level === 'material_conflict' || c.r.level === 'critical_conflict').length;
    const push = (r: ReturnType<typeof buildGovernanceAdaptationRecommendation>) => { if (!('insufficient' in r)) out.push(r); };
    if (noBaseline > 0) push(buildGovernanceAdaptationRecommendation({ code: `ga_baseline_${now.toISOString().slice(0, 10)}`, adaptationType: 'require_baseline', finding: `baseline 없는 결정 ${noBaseline}건`, evidenceCount: noBaseline, severity: 'moderate' }));
    if (noObs > 0) push(buildGovernanceAdaptationRecommendation({ code: `ga_obs_${now.toISOString().slice(0, 10)}`, adaptationType: 'require_observation_window', finding: `관찰 미완료 결정 ${noObs}건`, evidenceCount: noObs, severity: 'moderate' }));
    if (conflicted > 0) push(buildGovernanceAdaptationRecommendation({ code: `ga_conflict_${now.toISOString().slice(0, 10)}`, adaptationType: 'review_conflicting_evidence', finding: `충돌 근거 context ${conflicted}건`, evidenceCount: conflicted, severity: 'high' }));
    if (staleRows.some((s) => s.r.status === 'stale_candidate')) push(buildGovernanceAdaptationRecommendation({ code: `ga_stale_${now.toISOString().slice(0, 10)}`, adaptationType: 'refresh_stale_learning', finding: `stale 근거 ${staleRows.filter((s) => s.r.status === 'stale_candidate').length}건`, evidenceCount: staleRows.filter((s) => s.r.status === 'stale_candidate').length, severity: 'low' }));
    return out;
  }, [eligibilityRows, conflicts, staleRows, now]);

  if (loading) return <AdminCard title="Enterprise Organizational Learning & Policy Evolution Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Organizational Learning & Policy Evolution Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const evidenceByStrength = (summary.evidence_by_strength ?? {}) as Record<string, number>;
  const learningsByStatus = (summary.learnings_by_status ?? {}) as Record<string, number>;
  const evolutionByStatus = (summary.evolution_by_status ?? {}) as Record<string, number>;
  const sourceCounts = (summary.source_counts ?? {}) as Record<string, number>;

  return (
    <AdminCard
      title="Enterprise Organizational Learning & Policy Evolution Center"
      subtitle="학습 근거→패턴→조직 학습→정책 성과 매핑→진화 후보→Safety Gate→Governance 권고 — 1회 성공≠Best Practice·상관≠인과(자동 정책 변경/학습 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 정책 변경/승인/폐기/적용, 자동 계약/정산/가격/요금제/플레이리스트/추천 알고리즘 변경, 자동 모델 학습/Fine-tuning/Weight/Prompt/Trust/Constitution 변경, Production Apply/Merge/Deploy 는 없습니다. Evolution Candidate 는 후보일 뿐이며 approved_reference 도 실제 적용 완료가 아닙니다. 정책 존재 ≠ 실제 적용(policy_application_unverified). Learning Maturity/Decision Quality 는 인사·조직 평가 용도가 아닙니다." />
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
            <Box label="Eligible Evidence" value={NUM(summary.evidence_eligible as number)} />
            <Box label="Excluded Evidence" value={NUM(summary.evidence_excluded as number)} />
            <Box label="Patterns" value={NUM(patterns.length)} />
            <Box label="Conflicting Contexts" value={NUM(conflicts.length)} />
            <Box label="Repeated Failure 후보" value={NUM(failures.length)} />
            <Box label="Repeated Success 후보" value={NUM(successes.filter((s) => s.r.verdict !== 'single_success').length)} />
            <Box label="Validated Learnings" value={NUM(learningsByStatus.validated_reference ?? 0)} />
            <Box label="Learnings 대기" value={NUM((learningsByStatus.pending_review ?? 0) + (learningsByStatus.waiting_evidence ?? 0))} />
            <Box label="Stale Learning 후보" value={NUM(staleRows.filter((s) => s.r.status === 'stale_candidate').length)} />
            <Box label="Evolution Candidates" value={NUM(candidates.length)} />
            <Box label="Approved References" value={NUM(evolutionByStatus.approved_reference ?? 0)} />
            <Box label="Learning Maturity" value={maturity.score == null ? maturity.maturity : `${maturity.score} (${maturity.maturity})`} />
            <Box label="근거 강도(strong)" value={NUM(evidenceByStrength.strong ?? 0)} />
            <Box label="자동 정책 변경/학습" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 실측: decisions {NUM(sourceCounts.decisions)} · outcomes {NUM(sourceCounts.outcomes)}(평가 가능 {NUM(sourceCounts.outcomes_evaluable)}) · validated lessons {NUM(sourceCounts.lessons_validated)} · policies {NUM(sourceCounts.policies)}(v {NUM(sourceCounts.policy_versions)}) · policy recs {NUM(sourceCounts.policy_recommendations)}</p>
        </div>
      )}

      {/* ── Learning Evidence ── */}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !dmOutcomes.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const target = dmOutcomes.find((o) => ['positive', 'mixed', 'neutral', 'negative'].includes(o.outcome_status));
              const rec = target ? dmRecords.find((x) => x.id === target.decision_memory_id) : null;
              if (!target || !rec) { toast.error('평가 가능한 Outcome 없음 — 미관측 Decision 은 학습 증거로 사용하지 않습니다'); return; }
              const ctx = buildContextSignature({ domain: rec.decision_domain, type: rec.decision_type, source: rec.source_system });
              void act(() => createOLEvidence({
                code: `olev_${target.id.slice(0, 8)}`, domain: rec.decision_domain, summary: r,
                contextSignature: ctx, outcomeStatus: target.outcome_status, evidenceStrength: 'weak',
                sourceDecisionId: rec.id, sourceOutcomeId: target.id,
                causality: target.causality_status, repeatability: target.repeatability_status,
              }), 'Evidence 수집(원본 미변경)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">평가된 Outcome 에서 Evidence 수집</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="근거 요약(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!evidence.length ? <AdminEmpty title="Learning Evidence 없음" description="평가 완료된 Outcome 만 학습 근거가 됩니다(outcome_pending 제외). 데이터 부족 상태를 숨기지 않습니다." /> : (
            <div className="space-y-1">
              {evidence.slice(0, 40).map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{e.evidence_code}</span>
                    <AdminBadge tone={e.eligibility === 'eligible' ? 'success' : 'neutral'}>{e.eligibility}</AdminBadge>
                    <AdminBadge tone={e.evidence_strength === 'strong' ? 'success' : e.evidence_strength === 'conflicting' ? 'danger' : 'info'}>{e.evidence_strength}</AdminBadge>
                    <AdminBadge tone="neutral">{e.outcome_status}</AdminBadge>
                    <AdminBadge tone="neutral">{e.causality_status}</AdminBadge>
                  </div>
                  <p className="mt-1">{e.evidence_summary}</p>
                  <p className="text-muted-foreground">ctx: {e.context_signature}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Eligibility ── */}
      {tab === 'eligibility' && (
        !eligibilityRows.length ? <AdminEmpty title="평가 대상 없음" description="Decision Memory(0514)의 Outcome 이 쌓이면 자동 판정됩니다." /> : (
          <div className="space-y-1">
            {eligibilityRows.slice(0, 40).map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{r.rec?.decision_code ?? r.outcome.decision_memory_id.slice(0, 8)}</span>
                  <AdminBadge tone={r.eligible ? 'success' : 'neutral'}>{r.eligible ? 'eligible' : 'excluded'}</AdminBadge>
                </div>
                {r.exclusionReason && <p className="mt-1 text-muted-foreground">exclusion_reason: {r.exclusionReason} (삭제하지 않고 보존)</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Context Signatures ── */}
      {tab === 'contexts' && (
        !contextGroups.size ? <AdminEmpty title="Context 없음" description="Context 가 다르면 동일 학습으로 강제 통합하지 않습니다. Brand/Region/Team 구조는 미존재(scope_unverified)." /> : (
          <div className="space-y-1">
            {[...contextGroups.entries()].map(([ctx, group]) => (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{ctx}</span>
                <span className="ml-2 text-muted-foreground">근거 {group.length}건 — positive {group.filter((g) => g.outcomeStatus === 'positive').length} · negative {group.filter((g) => g.outcomeStatus === 'negative').length}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Patterns ── */}
      {tab === 'patterns' && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold">감지된 패턴(순수 로직 — 저장 전 미리보기)</p>
          {!detectedPatterns.length ? <AdminEmpty title="패턴 없음" /> : detectedPatterns.map(({ ctx, r }) => {
            if ('insufficient' in r) return null;
            return (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={r.patternType === 'repeated_success_candidate' ? 'success' : r.patternType === 'repeated_failure_candidate' ? 'danger' : r.patternType === 'insufficient_data' ? 'neutral' : 'info'}>{r.patternType}</AdminBadge>
                  <AdminBadge tone="neutral">{r.repeatability}</AdminBadge>
                  <span className="text-muted-foreground">표본 {r.sampleSize} (+{r.positive}/-{r.negative}/~{r.mixed})</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.note}</p>
                {r.patternType !== 'insufficient_data' && (
                  <button disabled={busy} onClick={() => {
                    const rr = needReason(); if (!rr) return;
                    const ids = contextGroups.get(ctx)!.map((g) => g.id);
                    void act(() => createOLPattern({
                      code: `olpat_${ctx.slice(0, 30).replace(/[^a-z0-9]/g, '_')}_${now.toISOString().slice(0, 10)}`,
                      domain: contextGroups.get(ctx)![0].domain, patternType: r.patternType, summary: `${rr} — ${r.note}`,
                      contextSignature: ctx, supporting: ids, sampleSize: r.sampleSize,
                      positive: r.positive, negative: r.negative, mixed: r.mixed, inconclusive: r.inconclusive,
                      repeatability: r.repeatability,
                    }), '패턴 저장(경향 — Best Practice 아님)');
                  }} className="mt-1 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">패턴 저장</button>
                )}
              </div>
            );
          })}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="패턴 요약(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          <p className="text-[11px] font-bold">저장된 패턴</p>
          {!patterns.length ? <AdminEmpty title="저장된 패턴 없음" /> : patterns.slice(0, 20).map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{p.pattern_code}</span>
                <AdminBadge tone="info">{p.pattern_type}</AdminBadge>
                <AdminBadge tone="neutral">{p.lifecycle_status}</AdminBadge>
              </div>
              <p className="mt-1">{p.pattern_summary}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Repeatability / Applicability ── */}
      {tab === 'repeatability' && (
        !patterns.length && !detectedPatterns.length ? <AdminEmpty title="평가 대상 없음" description="단일 관찰은 single_observation — 재현 보장 아님. 표본<3 은 sample_too_small." /> : (
          <div className="space-y-1">
            {detectedPatterns.map(({ ctx, r }) => 'insufficient' in r ? null : (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono">{ctx}</span>
                <AdminBadge tone={r.repeatability === 'consistently_observed' ? 'success' : 'neutral'}>{r.repeatability}</AdminBadge>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'applicability' && (
        <div className="space-y-1">
          {!evidence.length ? <AdminEmpty title="평가 대상 없음" description="전사 적용 가능성은 다수 Scope 일관 근거가 있을 때만 후보로 표시합니다." /> : evidence.slice(0, 30).map((e) => {
            const a = evaluateApplicability({ scopeType: e.scope_type, consistentScopeCount: null, totalScopeCount: null });
            return (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{e.evidence_code}</span>
                <AdminBadge tone={a === 'broadly_applicable_candidate' ? 'success' : 'neutral'}>{a}</AdminBadge>
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground">Enterprise·업종별 차이를 무시한 전사 일반화는 하지 않습니다.</p>
        </div>
      )}

      {/* ── Conflicts ── */}
      {tab === 'conflicts' && (
        !conflicts.length ? <AdminEmpty title="no_known_conflict" description="충돌 근거를 제거하거나 평균으로 숨기지 않습니다(자동 해결 없음)." /> : (
          <div className="space-y-1">
            {conflicts.map(({ ctx, r }) => (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={r.level === 'critical_conflict' ? 'danger' : r.level === 'material_conflict' ? 'danger' : 'warning'}>{r.level}</AdminBadge>
                  <span className="font-mono">{ctx}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.note}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Organizational Learnings ── */}
      {tab === 'learnings' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !patterns.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const p = patterns[0];
              void act(() => saveOLLearning({
                code: `ollearn_${now.toISOString().slice(0, 19)}`, title: r.slice(0, 80), domain: p.learning_domain,
                summary: `${r} — 근거 패턴 ${p.pattern_code}(표본 ${p.sample_size})`, supportingPatterns: [p.id],
                repeatability: p.repeatability_status, strength: p.pattern_strength,
              }), 'Learning 초안 저장(AI 초안 ≠ 검증 지식 — 사람 검토 필요)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Learning 초안 생성</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Learning 제목/사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!learnings.length ? <AdminEmpty title="Organizational Learning 없음" description="패턴이 축적되어야 초안 생성이 가능합니다 — 표본 부족 시 승격하지 않습니다." /> : learnings.map((l) => (
            <div key={l.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{l.learning_code}</span>
                <AdminBadge tone={l.review_status === 'validated_reference' ? 'success' : l.review_status === 'rejected' || l.review_status === 'invalidated' ? 'danger' : 'info'}>{l.review_status}</AdminBadge>
                <AdminBadge tone="neutral">{l.evidence_strength}</AdminBadge>
              </div>
              <p className="mt-1 font-bold">{l.title}</p>
              <p>{l.learning_summary}</p>
              {!['rejected', 'invalidated'].includes(l.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['waiting_evidence', 'validated_reference', 'stale_candidate', 'rejected', 'invalidated'] as const).map((t) => (
                    <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewOLLearning(l.id, t, rr), `${t}(사람 검토 — 자동 적용 아님)`); }} className={`rounded-md px-2 py-0.5 text-[10px] font-bold disabled:opacity-50 ${t === 'validated_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Maturity ── */}
      {tab === 'maturity' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Learning Maturity" value={maturity.score == null ? maturity.maturity : `${maturity.score} (${maturity.maturity})`} />
            <Box label="측정 성분" value={String(10 - maturity.missing.length)} />
            <Box label="누락 성분(제외)" value={maturity.missing.join(', ') || '없음'} />
            <Box label="인사 평가 용도" value="아님(금지)" />
          </div>
          <AdminAlert tone="info" description="Evidence Coverage/관측률/재현성/Context/정책 매핑/사람 검증/Audit/신선도 10성분 재정규화 — initial → developing → defined → measured → adaptive_candidate. 직원·조직 성과 등급이 아닙니다." />
        </div>
      )}

      {/* ── Policy Mapping / Performance ── */}
      {tab === 'policymapping' && (
        !policyMappings.length ? <AdminEmpty title="정책 없음" description="정책 registry(0512)에 정책이 등록되면 Outcome 매핑이 표시됩니다." /> : (
          <div className="space-y-1">
            {policyMappings.map(({ policy, mapping }) => (
              <div key={policy.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{mapping.policyCode}</span>
                  <AdminBadge tone="warning">{mapping.applicationStatus}</AdminBadge>
                  <span className="text-muted-foreground">근거 {mapping.total}건 (+{mapping.positive}/-{mapping.negative})</span>
                </div>
                <p className="mt-1 text-muted-foreground">{mapping.note}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'policyperf' && (
        !policyMappings.length ? <AdminEmpty title="정책 없음" /> : (
          <div className="space-y-1">
            {policyMappings.map(({ policy, performance }) => (
              <div key={policy.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{policy.policy_code}</span>
                <AdminBadge tone={performance === 'evidence_supports_current_policy' ? 'success' : performance === 'deprecation_candidate' ? 'danger' : performance === 'policy_application_unverified' ? 'warning' : 'info'}>{performance}</AdminBadge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">실제 적용 자동 확인 불가 → policy_application_unverified 유지(성과 판정 금지). 정책 성과 ≠ 합법성/계약 유효성.</p>
          </div>
        )
      )}

      {/* ── Evolution Candidates ── */}
      {tab === 'evolution' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || !policies.length} onClick={() => {
              const r = needReason(); if (!r) return;
              const pm = policyMappings.find((m) => m.mapping.total >= 3);
              if (!pm) { toast.error('표본 3건 이상 정책 없음 — 1회 결과로 후보를 만들지 않습니다'); return; }
              const draft = buildPolicyEvolutionCandidate({ code: `olevo_${pm.policy.policy_code}_${now.toISOString().slice(0, 10)}`, performance: pm.performance, sampleSize: pm.mapping.total, conflictLevel: 'no_known_conflict' });
              if ('insufficient' in draft) { toast.error(draft.why); return; }
              void act(() => createOLEvolutionCandidate({
                code: draft.code, policyId: pm.policy.id, candidateType: draft.candidateType,
                changeSummary: `${r} — ${draft.changeSummary}`, reason: draft.reason,
                expectedBenefit: draft.expectedBenefit, expectedRisk: draft.expectedRisk,
                alternatives: draft.alternatives, confidence: draft.confidence,
              }), 'Evolution Candidate 생성(Policy Version 미생성)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">후보 생성(표본≥3)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="후보 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!candidates.length ? <AdminEmpty title="Evolution Candidate 없음" description="후보는 실제 정책 버전을 생성하거나 적용하지 않습니다." /> : candidates.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone="info">{c.candidate_type}</AdminBadge>
                <AdminBadge tone={c.review_status === 'approved_reference' ? 'success' : c.review_status === 'rejected' ? 'danger' : 'neutral'}>{c.review_status}</AdminBadge>
                {c.self_approval_warning && <AdminBadge tone="warning">self-approval 경고</AdminBadge>}
              </div>
              <p className="mt-1">{c.proposed_change_summary}</p>
              <p className="text-muted-foreground">Benefit: {c.expected_benefit} · Risk: {c.expected_risk}</p>
              {!['approved_reference', 'rejected', 'cancelled', 'expired', 'invalidated'].includes(c.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['waiting_evidence', 'validated_reference', 'approved_reference', 'rejected', 'cancelled'] as const).map((t) => (
                    <button key={t} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewOLEvolution(c.id, t, rr), `${t}(approved_reference ≠ 실제 적용)`); }} className={`rounded-md px-2 py-0.5 text-[10px] font-bold disabled:opacity-50 ${t === 'approved_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Safety Gate ── */}
      {tab === 'safetygate' && (
        !candidates.length ? <AdminEmpty title="후보 없음" description="Safety Gate 는 Production Apply 상태를 포함하지 않습니다." /> : (
          <div className="space-y-1">
            {candidates.map((c) => {
              const gate = evaluatePolicyEvolutionSafety({
                applicationVerified: null, scopeVerified: c.target_scope_type !== 'unverified',
                conflictLevel: 'no_known_conflict' as ConflictLevel,
                evidenceStrength: c.evidence_strength as EvidenceStrength,
                hasBaselinePlan: false, hasObservationPlan: false,
                separateApprover: c.self_approval_warning ? false : null,
              });
              return (
                <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold">{c.candidate_code}</span>
                    <AdminBadge tone={gate.verdict === 'ready_for_human_review' ? 'success' : 'warning'}>{gate.verdict}</AdminBadge>
                  </div>
                  {gate.blockers.length > 0 && <p className="mt-1 text-muted-foreground">blockers: {gate.blockers.join(' · ')}</p>}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Failures / Successes / Practices ── */}
      {tab === 'failures' && (
        !failures.length ? <AdminEmpty title="no_known_repeat_failure" description="1회 실패는 폐기 근거로 확정하지 않습니다. 자동 추천 차단 없음." /> : (
          <div className="space-y-1">
            {failures.map(({ ctx, r }) => (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={r.verdict === 'critical_repeat_failure' ? 'danger' : 'warning'}>{r.verdict}</AdminBadge>
                  <span className="font-mono">{ctx}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.note}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'successes' && (
        !successes.length ? <AdminEmpty title="성공 표본 없음" description="1회 성공은 single_success — Best Practice 확정 금지." /> : (
          <div className="space-y-1">
            {successes.map(({ ctx, r }) => (
              <div key={ctx} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={r.verdict === 'validated_practice_reference' ? 'success' : 'info'}>{r.verdict}</AdminBadge>
                  <span className="font-mono">{ctx}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.note}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'practices' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Practice Candidate 는 Event 기록으로 관리(테이블 최소화). validated_practice_reference 는 사람 검토 Reference 이며 자동 표준 정책이 아닙니다." />
          {audit.filter((e) => e.event_type === 'practice_candidate_created').length === 0
            ? <AdminEmpty title="Practice Candidate 없음" description="교차 scope 반복 성공 + 사람 검토가 있어야 후보가 됩니다." />
            : audit.filter((e) => e.event_type === 'practice_candidate_created').map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><p>{e.detail}</p></div>
            ))}
        </div>
      )}

      {/* ── Staleness / Refresh ── */}
      {tab === 'staleness' && (
        !staleRows.length ? <AdminEmpty title="근거 없음" /> : (
          <div className="space-y-1">
            {staleRows.slice(0, 30).map(({ e, r }) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{e.evidence_code}</span>
                <AdminBadge tone={r.status === 'current' ? 'success' : r.status === 'stale_candidate' || r.status === 'invalidated_by_change' ? 'warning' : 'neutral'}>{r.status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{r.note}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'refresh' && (
        <div className="space-y-1">
          {staleRows.filter(({ r }) => r.status !== 'current').length === 0 ? <AdminEmpty title="Refresh 대상 없음" description="재실행/재관찰은 자동 수행하지 않습니다." /> : staleRows.filter(({ r }) => r.status !== 'current').slice(0, 20).map(({ e, r }) => {
            const rec = buildKnowledgeRefreshRecommendation(r.status);
            return (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{e.evidence_code}</span>
                <span className="ml-2">{rec.refreshType ?? '—'}</span>
                <span className="ml-2 text-muted-foreground">자동 실행 없음</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Decision Chains ── */}
      {tab === 'chains' && (
        <div className="space-y-2">
          {(() => {
            const links = evidence.filter((e) => e.source_decision_id && e.source_policy_id).map((e) => ({ parent: e.source_policy_id as string, child: e.source_decision_id as string, dependencyType: 'evidence' }));
            if (!links.length) return <AdminEmpty title="체인 없음" description="Policy→Decision→Outcome 연결 근거가 쌓이면 표시됩니다. Outcome 기여는 후보 표현만(causality_unverified)." />;
            const chain = buildDecisionChain(links, links[0].parent);
            return (
              <div className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{chain.verdict}</AdminBadge>
                <p className="mt-1 break-all">{chain.chain.join(' → ')}</p>
                <p className="text-muted-foreground">cycle 방어 · 인과 확정 아님</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Governance Adaptation ── */}
      {tab === 'governance' && (
        !governanceRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {governanceRecs.map((r) => (
              <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{r.adaptationType}</AdminBadge>
                  <AdminBadge tone={r.severity === 'high' || r.severity === 'critical' ? 'danger' : 'warning'}>{r.severity}</AdminBadge>
                  <span className="text-muted-foreground">confidence {r.confidence}</span>
                  <AdminBadge tone="warning">Human Approval 필수</AdminBadge>
                </div>
                <p className="mt-1">{r.recommendation}</p>
                <p className="text-muted-foreground">{r.limitations.join(' · ')}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Timeline ── */}
      {tab === 'timeline' && (
        !audit.length ? <AdminEmpty title="Timeline 없음" /> : (
          <div className="space-y-1">
            {[...audit].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-40).map((e) => (
              <div key={e.id} className="border-l-2 border-border pl-2 text-[11px]">
                <p><span className="font-mono font-bold">{e.event_type}</span> <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>{e.event_type === 'external_policy_action_reference' && <AdminBadge tone="neutral">reference(실제 적용 이벤트 아님)</AdminBadge>}</p>
                {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Human Reviews ── */}
      {tab === 'reviews' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Learning: draft→pending_review→waiting_evidence→validated_reference/rejected/invalidated/stale_candidate. Evolution: …→approved_reference(≠적용)/rejected/cancelled. 종결 상태 재결정 불가." />
          <p className="text-[11px]">Learnings 대기: {NUM((learningsByStatus.pending_review ?? 0) + (learningsByStatus.waiting_evidence ?? 0))} · Evolution 대기: {NUM((evolutionByStatus.pending_review ?? 0) + (evolutionByStatus.waiting_evidence ?? 0))} — 각 탭에서 결정하세요.</p>
        </div>
      )}

      {/* ── External Policy Actions ── */}
      {tab === 'external' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부에서 실제 정책 변경을 수행한 경우의 참고 기록만 저장 — 시스템이 정책 변경을 실행하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXTERNAL_POLICY_ACTION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => recordOLExternalPolicyAction(extAction, rr, [{ label: 'manual_report', value: rr.slice(0, 200) }]), '참고 기록(reference only)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">참고 기록</button>
          </div>
          {audit.filter((e) => e.event_type === 'external_policy_action_reference').length === 0 ? <AdminEmpty title="참고 기록 없음" /> : audit.filter((e) => e.event_type === 'external_policy_action_reference').map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
              <p className="mt-1">{e.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={e.event_type.includes('conflict') || e.event_type.includes('failure') ? 'warning' : 'info'}>{e.event_type}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {e.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-1">
          {OL_SUPPORT.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'info'}>{s.status}</AdminBadge>
              <span className="font-bold">{s.label}</span>
              <span className="text-muted-foreground">{s.note}</span>
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
