/**
 * BusinessCausalIntelligenceSection — Enterprise Business Causal Intelligence,
 * Confidence Calibration & Corporate Digital Twin Center (Phase AI-OPS-14).
 *
 * Signal → Causal Candidate → Temporal/Mechanism/Confounder/Counter-Evidence →
 * Confidence → Path/Propagation/Feedback → Counterfactual → Corporate Twin →
 * Vulnerability/Resilience → Confidence Record → Calibration → 권고 → Audit.
 * causal_confirmed 없음 · 상관 ≠ 인과 · Twin ≠ 실제 회사/미래 · 자동 개입/Confidence 수정 없음.
 *
 * 탭 32개(스펙 41절 전체).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, BookOpen, Brain, FileText, GitBranch, Grid3x3, History, Layers,
  Lightbulb, Link2, Lock, RefreshCw, Scale, ScrollText, Search, Target, TrendingUp, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchCausalSummary, createBizSignal, fetchBizSignals, createCausalCandidate, reviewCausalCandidate,
  fetchCausalCandidates, createCounterfactual, fetchCounterfactuals, createCorporateTwin,
  fetchCorporateTwins, createConfidenceRecord, fetchConfidenceRecords, createCalibrationSnapshot,
  fetchCalibrationSnapshots, recordCausalExternalEvidence, fetchCausalAudit,
  type CausalSummary, type BizSignalRow, type CausalCandidateRow, type CounterfactualRow,
  type CorporateTwinRow, type ConfidenceRecordRow, type CalibrationSnapshotRow, type CausalEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateTemporalOrder, evaluateConfounders, evaluateCounterEvidence, calculateCausalEvidenceStrength,
  buildCausalPath, calculatePropagation, detectFeedbackLoop,
  simulateCounterfactual, evaluateTwinInputCoverage, simulateCorporateTwin, simulateIntervention,
  detectVulnerabilityChain, calculateBusinessResilience, evaluateCalibrationEligibility,
  calculateConfidenceCalibrationV2, calculateCalibrationMetrics, buildConfidenceAdjustmentRecommendation,
  calculateCausalRisk, buildCausalRecommendation, CAUSAL_SUPPORT,
  type CausalEdge, type CausalStatus, type CausalRecommendation, type MechanismStatus,
  type ConfounderStatus, type CounterEvidenceStatus, type CalibrationSample,
} from '@/lib/businessCausalIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'signals' | 'candidates' | 'temporal' | 'mechanism' | 'confounders' | 'counterev'
  | 'causalev' | 'confidence' | 'paths' | 'propagation' | 'feedback' | 'counterfactuals' | 'twins'
  | 'twininputs' | 'twinsims' | 'interventions' | 'twinoutputs' | 'vulnerability' | 'resilience'
  | 'confrecords' | 'eligibility' | 'calibration' | 'calibmetrics' | 'calibsnapshots' | 'confrecs'
  | 'causalrisk' | 'recommendations' | 'reviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'signals', label: 'Business Signals', icon: BarChart3 },
  { key: 'candidates', label: 'Causal Candidates', icon: GitBranch },
  { key: 'temporal', label: 'Temporal Order', icon: History },
  { key: 'mechanism', label: 'Mechanism Review', icon: Search },
  { key: 'confounders', label: 'Confounders', icon: AlertTriangle },
  { key: 'counterev', label: 'Counter-Evidence', icon: Scale },
  { key: 'causalev', label: 'Causal Evidence', icon: BookOpen },
  { key: 'confidence', label: 'Causal Confidence', icon: Brain },
  { key: 'paths', label: 'Causal Paths', icon: Link2 },
  { key: 'propagation', label: 'Propagation Analysis', icon: TrendingUp },
  { key: 'feedback', label: 'Feedback Loops', icon: RefreshCw },
  { key: 'counterfactuals', label: 'Counterfactuals', icon: Lightbulb },
  { key: 'twins', label: 'Corporate Digital Twins', icon: Layers },
  { key: 'twininputs', label: 'Twin Inputs', icon: BookOpen },
  { key: 'twinsims', label: 'Twin Simulations', icon: Zap },
  { key: 'interventions', label: 'Intervention Simulations', icon: Target },
  { key: 'twinoutputs', label: 'Twin Outputs', icon: FileText },
  { key: 'vulnerability', label: 'Vulnerability Chains', icon: AlertTriangle },
  { key: 'resilience', label: 'Business Resilience', icon: Scale },
  { key: 'confrecords', label: 'Confidence Records', icon: BookOpen },
  { key: 'eligibility', label: 'Calibration Eligibility', icon: Scale },
  { key: 'calibration', label: 'Confidence Calibration', icon: Brain },
  { key: 'calibmetrics', label: 'Calibration Metrics', icon: BarChart3 },
  { key: 'calibsnapshots', label: 'Calibration Snapshots', icon: History },
  { key: 'confrecs', label: 'Confidence Recommendations', icon: Lightbulb },
  { key: 'causalrisk', label: 'Causal Risk', icon: AlertTriangle },
  { key: 'recommendations', label: 'Causal Recommendations', icon: Lightbulb },
  { key: 'reviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Evidence', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const EXT_EVIDENCE = ['experiment_result_reference', 'market_data_reference', 'provider_incident_reference', 'contract_outcome_reference', 'customer_research_reference', 'pricing_test_reference', 'capacity_test_reference', 'security_test_reference', 'operational_test_reference', 'manual_causal_evidence_reference'];

export default function BusinessCausalIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<CausalSummary>({});
  const [signals, setSignals] = useState<BizSignalRow[]>([]);
  const [candidates, setCandidates] = useState<CausalCandidateRow[]>([]);
  const [counterfactuals, setCounterfactuals] = useState<CounterfactualRow[]>([]);
  const [twins, setTwins] = useState<CorporateTwinRow[]>([]);
  const [confRecords, setConfRecords] = useState<ConfidenceRecordRow[]>([]);
  const [calibSnapshots, setCalibSnapshots] = useState<CalibrationSnapshotRow[]>([]);
  const [audit, setAudit] = useState<CausalEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState(EXT_EVIDENCE[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sig, ca, cf, tw, cr, cs, au] = await Promise.all([
        fetchCausalSummary(), fetchBizSignals(null, 100), fetchCausalCandidates(null, 100),
        fetchCounterfactuals(100), fetchCorporateTwins(50), fetchConfidenceRecords(null, 100),
        fetchCalibrationSnapshots(50), fetchCausalAudit(100),
      ]);
      setSummary(s); setSignals(sig); setCandidates(ca); setCounterfactuals(cf); setTwins(tw);
      setConfRecords(cr); setCalibSnapshots(cs); setAudit(au);
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
  const signalById = useMemo(() => new Map(signals.map((s) => [s.id, s])), [signals]);

  const causalEdges: CausalEdge[] = useMemo(() => candidates.map((c) => ({
    from: signalById.get(c.cause_signal_id)?.metric_name ?? c.cause_signal_id.slice(0, 8),
    to: signalById.get(c.effect_signal_id)?.metric_name ?? c.effect_signal_id.slice(0, 8),
    status: c.causal_status as CausalStatus, confidence: c.causal_confidence,
  })), [candidates, signalById]);

  const paths = useMemo(() => {
    const start = causalEdges[0]?.from;
    return start ? buildCausalPath(causalEdges, start) : { paths: [], note: '' };
  }, [causalEdges]);
  const feedback = useMemo(() => detectFeedbackLoop(causalEdges), [causalEdges]);
  const propagation = useMemo(() => calculatePropagation({
    directCount: causalEdges.length ? new Set(causalEdges.map((e) => e.to)).size : null,
    indirectCount: paths.paths.filter((p) => p.nodes.length > 2).length,
    domainsAffected: new Set(candidates.map((c) => c.causal_domain)).size,
    hasFeedbackLoop: feedback.loops.length > 0,
  }), [causalEdges, paths, candidates, feedback]);

  const twinSim = useMemo(() => simulateCorporateTwin({
    name: '매장 +30% 가정', storeGrowthPct: 30,
    state: { stores: typeof actuals.active_stores === 'number' ? actuals.active_stores : null, mrr, capacityLimit: null },
  }), [actuals, mrr]);

  const vulnerabilities = useMemo(() => [
    detectVulnerabilityChain({ axis: '단일 Payment Provider(PayApp — 코드 실측)', singlePoint: true, hasBackup: false, chainLength: 3 }),
    detectVulnerabilityChain({ axis: '단일 Infra Provider(Supabase — 코드 실측)', singlePoint: true, hasBackup: false, chainLength: 4 }),
    detectVulnerabilityChain({ axis: '단일 Admin', singlePoint: true, hasBackup: false, chainLength: 2 }),
    detectVulnerabilityChain({ axis: '수익원 다변화', singlePoint: null, hasBackup: null, chainLength: null }),
  ], []);

  const resilience = useMemo(() => calculateBusinessResilience({
    revenueDiversification: null, customerDiversification: null,
    providerRedundancy: 0, operationalRedundancy: null, capacityHeadroom: null,
    recoveryCapability: null, securityReadiness: null, auditCoverage: audit.length > 0 ? 70 : null, ownerBackup: 0,
  }), [audit]);

  const calibSamples: CalibrationSample[] = useMemo(() => confRecords.filter((r) => r.calibration_eligible).map((r) => ({
    predictedConfidence: r.predicted_confidence,
    directionCorrect: r.actual_direction != null && r.predicted_direction != null ? r.actual_direction === r.predicted_direction : null,
    withinRange: null,
  })), [confRecords]);
  const calibration = useMemo(() => calculateConfidenceCalibrationV2(calibSamples), [calibSamples]);
  const calibMetrics = useMemo(() => calculateCalibrationMetrics(confRecords.filter((r) => r.calibration_eligible).map((r) => ({ predicted: r.predicted_confidence, actual: r.actual_value }))), [confRecords]);

  const causalRisk = useMemo(() => calculateCausalRisk({
    unsupportedClaimRisk: candidates.length ? Math.min(100, candidates.filter((c) => c.causal_status === 'correlational_only').length / candidates.length * 100) : null,
    confounderRisk: candidates.length ? Math.min(100, candidates.filter((c) => c.confounder_status === 'confounders_unreviewed').length / candidates.length * 100) : null,
    counterEvidenceRisk: candidates.some((c) => c.counter_evidence_status === 'conflicting_evidence') ? 70 : candidates.length ? 20 : null,
    staleInputRisk: null,
    experimentalGapRisk: 80,   // Random Assignment/Control Group 미존재(실측)
    calibrationGapRisk: calibration.status === 'calibration_sample_too_small' || calibration.status === 'insufficient_data' ? 60 : 30,
    twinInputGapRisk: twins.length ? (twins.some((t) => t.input_validation === 'complete_reference') ? 30 : 60) : null,
    propagationRisk: propagation === 'critical_propagation_candidate' ? 80 : propagation === 'insufficient_data' ? null : 30,
    vulnerabilityRisk: vulnerabilities.some((v) => v.verdict === 'critical_vulnerability_chain') ? 80 : 40,
  }), [candidates, calibration, twins, propagation, vulnerabilities]);

  const autoRecs = useMemo(() => {
    const out: CausalRecommendation[] = [];
    const push = (r: CausalRecommendation | { insufficient: true; why: string }) => { if (!('insufficient' in r)) out.push(r); };
    const unreviewed = candidates.filter((c) => c.confounder_status === 'confounders_unreviewed').length;
    if (unreviewed > 0) push(buildCausalRecommendation({ code: `crec_conf_${now.toISOString().slice(0, 10)}`, recType: 'review_confounders', finding: `교란 미검토 후보 ${unreviewed}건`, evidenceCount: unreviewed, severity: 'high' }));
    push(buildCausalRecommendation({ code: `crec_exp_${now.toISOString().slice(0, 10)}`, recType: 'run_controlled_experiment_candidate', finding: 'Random Assignment/Control Group 구조 미존재(실측)', evidenceCount: 1, severity: 'moderate' }));
    if (vulnerabilities.some((v) => v.verdict === 'critical_vulnerability_chain')) push(buildCausalRecommendation({ code: `crec_vuln_${now.toISOString().slice(0, 10)}`, recType: 'add_backup_dependency', finding: 'Provider/Infra 단일 의존 critical 체인', evidenceCount: vulnerabilities.filter((v) => v.verdict === 'critical_vulnerability_chain').length, severity: 'high' }));
    if (calibration.status === 'overconfident_candidate') push(buildCausalRecommendation({ code: `crec_calib_${now.toISOString().slice(0, 10)}`, recType: 'recalibrate_confidence_candidate', finding: `과신 후보(gap ${calibration.confidenceGap})`, evidenceCount: calibration.sampleSize, severity: 'moderate' }));
    return out;
  }, [candidates, vulnerabilities, calibration, now]);

  if (loading) return <AdminCard title="Enterprise Business Causal Intelligence & Corporate Digital Twin Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Business Causal Intelligence & Corporate Digital Twin Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const candidatesByStatus = (summary.candidates_by_status ?? {}) as Record<string, number>;

  return (
    <AdminCard
      title="Enterprise Business Causal Intelligence & Corporate Digital Twin Center"
      subtitle="Signal→인과 후보→교란/반증→Confidence→경로/전파→Counterfactual→Corporate Twin→취약/복원력→Calibration — 상관≠인과·causal_confirmed 없음(자동 개입/Confidence 수정 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 계약/가격/정산/정책/플레이리스트/서버/예산/인력 변경, 자동 실험 실행, 자동 AI Confidence/Weight/Prompt 수정, 자동 모델 학습, Production Apply/Merge/Deploy 는 없습니다. 시간 선행/상관/Knowledge Graph 관계를 인과로 자동 승격하지 않으며 causal_confirmed 상태 자체가 없습니다(최대 experimentally_supported_reference). Counterfactual 은 실제 일어나지 않은 가상 결과이고 Digital Twin 은 실제 회사/미래가 아닙니다. Calibration 은 표본<5 확정 금지·모델 전체 성능 일반화 금지입니다." />
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
            <Box label="Business Signals" value={NUM(summary.signals_total as number)} />
            <Box label="Causal Candidates" value={NUM(candidates.length)} />
            <Box label="Correlational Only" value={NUM(candidatesByStatus.correlational_only ?? 0)} />
            <Box label="Plausible Contributions" value={NUM(candidatesByStatus.plausible_contribution ?? 0)} />
            <Box label="교란 미검토" value={NUM(summary.confounders_unreviewed as number)} />
            <Box label="Counterfactuals" value={NUM(counterfactuals.length)} />
            <Box label="Digital Twins" value={NUM(twins.length)} />
            <Box label="Vulnerability(critical)" value={NUM(vulnerabilities.filter((v) => v.verdict === 'critical_vulnerability_chain').length)} />
            <Box label="Business Resilience" value={resilience.score == null ? resilience.status : `${resilience.score} (${resilience.status})`} />
            <Box label="Calibration Eligible" value={NUM(summary.confidence_eligible as number)} />
            <Box label="Calibration Excluded" value={NUM(summary.confidence_excluded as number)} />
            <Box label="Calibration 판정" value={calibration.status} />
            <Box label="Causal Risk" value={causalRisk.score == null ? causalRisk.level : `${causalRisk.score} (${causalRisk.level})`} />
            <Box label="실험 설계(RCT)" value={String(actuals.random_assignment)} />
            <Box label="자동 인과 확정/개입" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 실측: MRR {NUM(mrr)}원 · 활성 매장 {NUM(typeof actuals.active_stores === 'number' ? actuals.active_stores : null)} · decision outcomes {NUM(typeof actuals.decision_outcomes === 'number' ? actuals.decision_outcomes : null)} · KG 관계 {NUM(typeof actuals.kg_relationships === 'number' ? actuals.kg_relationships : null)}</p>
        </div>
      )}

      {/* ── Signals ── */}
      {tab === 'signals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createBizSignal({ code: `bsig_mrr_${now.toISOString().slice(0, 19)}`, domain: 'revenue', type: 'mrr_change', sourceSystem: 'subscriptions', metricName: 'mrr', observedAt: now.toISOString(), evidence: [{ label: 'note', value: r.slice(0, 100) }], metricValue: mrr, unit: 'krw' }), 'MRR Signal 기록(원인 단정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">MRR Signal 기록</button>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createBizSignal({ code: `bsig_store_${now.toISOString().slice(0, 19)}`, domain: 'store', type: 'store_growth', sourceSystem: 'users', metricName: 'active_stores', observedAt: now.toISOString(), evidence: [{ label: 'note', value: r.slice(0, 100) }], metricValue: typeof actuals.active_stores === 'number' ? actuals.active_stores : null, unit: 'count' }), '매장 Signal 기록');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">매장 Signal 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="관측 메모(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!signals.length ? <AdminEmpty title="Signal 없음" description="관측 신호는 원인/결과 단정이 아닙니다." /> : signals.slice(0, 40).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.signal_code}</span>
                <AdminBadge tone="info">{s.signal_type}</AdminBadge>
                <span className="text-muted-foreground">{s.metric_name} = {s.metric_value == null ? 'insufficient_data' : NUM(s.metric_value)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Candidates ── */}
      {tab === 'candidates' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy || signals.length < 2} onClick={() => {
              const r = needReason(); if (!r) return;
              const [a, b] = signals;
              void act(() => createCausalCandidate({ code: `bcc_${now.toISOString().slice(0, 19)}`, causeId: b.id, effectId: a.id, domain: 'revenue', type: 'indirect_effect_candidate', evidence: [{ label: 'hypothesis', value: r.slice(0, 150) }], mechanism: r }), '인과 후보 생성(확정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">후보 생성(최근 Signal 2건)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mechanism 가설(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!candidates.length ? <AdminEmpty title="후보 없음" description="Signal 2건 이상 기록 후 후보를 만드세요. causal_confirmed 상태는 존재하지 않습니다." /> : candidates.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone="info">{c.candidate_type}</AdminBadge>
                <AdminBadge tone={c.causal_status === 'plausible_contribution' ? 'success' : c.causal_status === 'conflicting_evidence' ? 'danger' : 'neutral'}>{c.causal_status}</AdminBadge>
                <AdminBadge tone={c.confounder_status === 'confounders_unreviewed' ? 'warning' : 'neutral'}>{c.confounder_status}</AdminBadge>
              </div>
              <p className="mt-1">{signalById.get(c.cause_signal_id)?.metric_name ?? '?'} → {signalById.get(c.effect_signal_id)?.metric_name ?? '?'} · {c.mechanism_hypothesis ?? 'mechanism 없음'}</p>
              {!['rejected', 'invalidated'].includes(c.review_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {([['correlational_reference', 'correlational_only'], ['plausible_contribution_reference', 'plausible_contribution'], ['conflicting', 'conflicting_evidence'], ['rejected', 'rejected']] as const).map(([rs, cs]) => (
                    <button key={rs} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewCausalCandidate(c.id, rs, rr, cs), `${rs}(절대 확정 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{rs}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Temporal / Mechanism / Confounders / Counter-Evidence / Evidence / Confidence ── */}
      {tab === 'temporal' && (
        !candidates.length ? <AdminEmpty title="후보 없음" description="효과가 원인보다 먼저 발생하면 direct candidate 승격이 서버에서 차단됩니다." /> : (
          <div className="space-y-1">
            {candidates.map((c) => {
              const cause = signalById.get(c.cause_signal_id); const effect = signalById.get(c.effect_signal_id);
              const t = evaluateTemporalOrder(cause ? new Date(cause.observed_at) : null, effect ? new Date(effect.observed_at) : null);
              return (
                <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{c.candidate_code}</span>
                  <AdminBadge tone={t.order === 'cause_precedes_effect' ? 'success' : 'warning'}>{t.order}</AdminBadge>
                  {!t.directCandidateAllowed && <span className="ml-2 text-muted-foreground">direct 승격 금지</span>}
                </div>
              );
            })}
          </div>
        )
      )}
      {tab === 'mechanism' && (
        !candidates.length ? <AdminEmpty title="후보 없음" description="Mechanism 은 가설과 지지를 분리합니다." /> : (
          <div className="space-y-1">
            {candidates.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone={c.mechanism_status === 'mechanism_supported' ? 'success' : 'neutral'}>{c.mechanism_status}</AdminBadge>
                <p className="mt-1 text-muted-foreground">{c.mechanism_hypothesis ?? 'mechanism_missing'}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'confounders' && (
        <div className="space-y-1">
          {!candidates.length ? <AdminEmpty title="후보 없음" description="교란 요인은 자동 제거하지 않고 목록으로 보존합니다(Season/Release/Price/Promotion/Mix/Incident/정의 변경 등 검토)." /> : candidates.map((c) => {
            const r = evaluateConfounders((c.confounders as { name: string; material: boolean | null }[] | null) ?? null);
            return (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone={r.status === 'confounders_unreviewed' ? 'warning' : r.status === 'material_confounder' ? 'danger' : 'success'}>{r.status}</AdminBadge>
                {r.preserved.length > 0 && <p className="mt-1 text-muted-foreground">보존: {r.preserved.join(', ')}</p>}
              </div>
            );
          })}
        </div>
      )}
      {tab === 'counterev' && (
        <div className="space-y-1">
          {!candidates.length ? <AdminEmpty title="후보 없음" description="반증 근거를 숨기거나 평균으로 제거하지 않습니다." /> : candidates.map((c) => {
            const r = evaluateCounterEvidence({ counterCount: c.counter_evidence?.length ?? null, supportingCount: c.supporting_evidence?.length ?? null });
            return (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone={r === 'no_known_counter_evidence' ? 'success' : r === 'conflicting_evidence' || r === 'dominant_counter_evidence' ? 'danger' : 'warning'}>{r}</AdminBadge>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'causalev' && (
        <div className="space-y-1">
          {!candidates.length ? <AdminEmpty title="후보 없음" description="실험 Evidence 없으면 strong 상한이 제한됩니다." /> : candidates.map((c) => {
            const r = calculateCausalEvidenceStrength({
              temporalOrder: c.temporal_order_status as 'cause_precedes_effect', mechanism: c.mechanism_status as MechanismStatus,
              scopeMatch: null, baselineQuality: null, sampleSize: null, repeatability: null,
              hasExperimentalEvidence: false, confounderStatus: c.confounder_status as ConfounderStatus,
              counterStatus: c.counter_evidence_status as CounterEvidenceStatus,
            });
            return (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <AdminBadge tone={r.strength === 'strong_reference' ? 'success' : r.strength === 'conflicting' ? 'danger' : 'neutral'}>{r.strength}</AdminBadge>
                <p className="mt-1 text-muted-foreground">{r.note}</p>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'confidence' && (
        !candidates.length ? <AdminEmpty title="후보 없음" description="Confidence 는 Status/Limitations 와 함께 표시합니다." /> : (
          <div className="space-y-1">
            {candidates.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.candidate_code}</span>
                <span className="ml-2">confidence {c.causal_confidence ?? 'insufficient_data'}</span>
                <AdminBadge tone="neutral">{c.causal_status}</AdminBadge>
                <p className="mt-1 text-muted-foreground">{(c.limitations ?? []).map(String).join(' · ')}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Paths / Propagation / Feedback ── */}
      {tab === 'paths' && (
        !paths.paths.length ? <AdminEmpty title="경로 없음" description="depth 기본 4(clamp 6)·cycle 방어 — 경로는 후보 연결이며 인과 확정이 아닙니다." /> : (
          <div className="space-y-1">
            {paths.paths.slice(0, 20).map((p, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <p className="break-all">{p.nodes.join(' → ')}</p>
                <AdminBadge tone="neutral">최약: {p.weakestStatus}</AdminBadge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">{paths.note}</p>
          </div>
        )
      )}
      {tab === 'propagation' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Propagation" value={propagation} />
            <Box label="영향 도메인" value={NUM(new Set(candidates.map((c) => c.causal_domain)).size)} />
            <Box label="Feedback Loop" value={feedback.verdict} />
          </div>
          <AdminAlert tone="info" description="Direct/1차/2차/3차 전파 후보 — 실제 피해 규모를 근거 없이 확정하지 않습니다." />
        </div>
      )}
      {tab === 'feedback' && (
        <div className="space-y-1">
          <AdminBadge tone={feedback.verdict === 'no_known_loop' ? 'success' : feedback.verdict === 'insufficient_data' ? 'neutral' : 'warning'}>{feedback.verdict}</AdminBadge>
          {feedback.loops.slice(0, 10).map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px] break-all">{l.join(' → ')}</div>
          ))}
          <p className="text-[10px] text-muted-foreground">Loop 는 후보 분석 — 자동 개입 없음.</p>
        </div>
      )}

      {/* ── Counterfactuals ── */}
      {tab === 'counterfactuals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              const sim = simulateCounterfactual({ baseline: mrr, causeEffectPct: 10, interventionScalePct: -100 });
              void act(() => createCounterfactual({ code: `bcf_${now.toISOString().slice(0, 19)}`, interventionType: 'remove_cause_candidate', summary: r, scenario: `${r} — 원인 제거 가정(가상)`, evidence: [{ label: 'baseline_mrr', value: mrr }], expected: sim.expected, low: sim.low, high: sim.high, confidence: 30 }), 'Counterfactual 기록(가상 — 실제 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">원인 제거 Counterfactual 생성</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="가정 설명(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!counterfactuals.length ? <AdminEmpty title="Counterfactual 없음" description="실제 일어나지 않은 가상 결과임을 항상 명시합니다." /> : counterfactuals.map((cf) => (
            <div key={cf.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{cf.counterfactual_code}</span>
                <AdminBadge tone="info">{cf.intervention_type}</AdminBadge>
                <AdminBadge tone="neutral">{cf.verification_status}</AdminBadge>
              </div>
              <p className="mt-1">{cf.intervention_summary} — expected {cf.expected_effect == null ? 'unverified' : `${NUM(cf.expected_effect)} (${NUM(cf.low_range)}~${NUM(cf.high_range)})`}</p>
              <p className="text-muted-foreground">가상 결과 — 실제 Outcome 아님</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Twins ── */}
      {tab === 'twins' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              const inputs = evaluateTwinInputCoverage([
                { name: 'revenue', present: mrr != null, ageDays: 0 },
                { name: 'stores', present: typeof actuals.active_stores === 'number', ageDays: 0 },
                { name: 'cost', present: false, ageDays: null },
                { name: 'labor_capacity', present: false, ageDays: null },
              ]);
              void act(() => createCorporateTwin({ code: `ctwin_${now.toISOString().slice(0, 19)}`, title: r, scope: 'company', evidence: [{ label: 'mrr', value: mrr }], includedDomains: ['revenue', 'store'], state: { mrr, stores: actuals.active_stores }, simulations: [twinSim as unknown as Record<string, unknown>], inputCoverage: inputs.coverage, inputValidation: inputs.validation }), 'Twin 생성(실제 회사 복제 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Company Twin 생성</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Twin 제목(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!twins.length ? <AdminEmpty title="Twin 없음" description="제한된 집계 모델 — 실제 회사를 완전히 복제하지 않습니다." /> : twins.map((t) => (
            <div key={t.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{t.twin_code}</span>
                <AdminBadge tone="info">{t.twin_scope}</AdminBadge>
                <AdminBadge tone={t.input_validation === 'complete_reference' ? 'success' : 'warning'}>{t.input_validation}</AdminBadge>
                <AdminBadge tone="neutral">{t.twin_status}</AdminBadge>
                {t.input_coverage != null && <span className="text-muted-foreground">coverage {t.input_coverage}%</span>}
              </div>
              <p className="mt-1">{t.title}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'twininputs' && (
        <div className="space-y-2">
          {(() => {
            const inputs = evaluateTwinInputCoverage([
              { name: 'revenue(실측)', present: mrr != null, ageDays: 0 },
              { name: 'stores(실측)', present: typeof actuals.active_stores === 'number', ageDays: 0 },
              { name: 'cost(인건비/마케팅)', present: false, ageDays: null },
              { name: 'labor_capacity', present: false, ageDays: null },
              { name: 'market_data', present: false, ageDays: null },
            ]);
            return (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Input Validation" value={inputs.validation} />
                  <Box label="Coverage" value={inputs.coverage == null ? '—' : `${inputs.coverage}%`} />
                  <Box label="누락 입력" value={inputs.missing.join(', ') || '없음'} />
                </div>
                <AdminAlert tone="info" description="비용/인력/시장 입력 미존재 → twin_input_incomplete 정직 표기. Twin 은 필요한 집계 Snapshot 만 저장합니다(원본 복제 금지)." />
              </>
            );
          })()}
        </div>
      )}
      {tab === 'twinsims' && (
        <div className="space-y-1">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <p className="font-bold">{twinSim.name}</p>
            {twinSim.effects.map((e) => (
              <p key={e.domain} className="mt-1"><AdminBadge tone={e.direction === 'increase' ? 'info' : e.direction === 'decrease' ? 'warning' : 'neutral'}>{e.domain}: {e.direction}</AdminBadge> <span className="text-muted-foreground">{e.magnitudeNote}</span></p>
            ))}
            {twinSim.constraintViolations.length > 0 && <p className="mt-1 text-muted-foreground">위반: {twinSim.constraintViolations.join(' · ')}</p>}
            <p className="mt-1 text-muted-foreground">notActualFuture · productionIdentical=false — 단일 종합점수로 결론내리지 않음</p>
          </div>
        </div>
      )}
      {tab === 'interventions' && (
        <div className="space-y-1">
          {[
            { name: 'Add Capacity', r: simulateIntervention({ positives: 2, negatives: 0, constraintViolated: false, hasBaseline: mrr != null }) },
            { name: 'Add Backup Owner', r: simulateIntervention({ positives: 1, negatives: 0, constraintViolated: false, hasBaseline: true }) },
            { name: 'Change Price Candidate', r: simulateIntervention({ positives: 1, negatives: 1, constraintViolated: false, hasBaseline: mrr != null }) },
            { name: 'No Action', r: simulateIntervention({ positives: 0, negatives: 0, constraintViolated: false, hasBaseline: true }) },
          ].map((x) => (
            <div key={x.name} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{x.name}</span>
              <AdminBadge tone={x.r === 'beneficial_candidate' ? 'success' : x.r === 'harmful_candidate' || x.r === 'infeasible' ? 'danger' : 'info'}>{x.r}</AdminBadge>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Intervention 은 후보 비교 — 실제 실행 없음.</p>
        </div>
      )}
      {tab === 'twinoutputs' && (
        <AdminAlert tone="info" description="Twin Output 은 Revenue/Cost/Capacity/Reliability/Security/Contract/Settlement 등 도메인별 방향+제약 위반+Unknown Factors 로 표시하며(Twin Simulations 탭), 단일 종합점수만으로 결론내리지 않습니다. Twin 결과 ≠ 실제 미래." />
      )}

      {/* ── Vulnerability / Resilience ── */}
      {tab === 'vulnerability' && (
        <div className="space-y-1">
          {vulnerabilities.map((v) => (
            <div key={v.axis} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{v.axis}</span>
              <AdminBadge tone={v.verdict === 'critical_vulnerability_chain' ? 'danger' : v.verdict === 'resilient_reference' ? 'success' : v.verdict === 'insufficient_data' ? 'neutral' : 'warning'}>{v.verdict}</AdminBadge>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">구조 분류 — 실제 장애 확률 미계산.</p>
        </div>
      )}
      {tab === 'resilience' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Resilience" value={resilience.score == null ? resilience.status : `${resilience.score} (${resilience.status})`} />
            <Box label="누락 성분(제외)" value={resilience.missing.join(', ') || '없음'} />
            <Box label="인사 평가 용도" value="아님(금지)" />
          </div>
          <AdminAlert tone="info" description="12성분 중 실측 가능한 성분만 재정규화(Provider/Owner backup = 0 실측, 나머지 다수 insufficient). 직원/조직 성과 평가 용도가 아닙니다." />
        </div>
      )}

      {/* ── Confidence Records / Eligibility / Calibration ── */}
      {tab === 'confrecords' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              const elig = evaluateCalibrationEligibility({ hasPrediction: true, hasConfidence: true, executed: null, outcomeObserved: false, metricDefinitionChanged: false, scopeMismatch: false, horizonEnded: false });
              void act(() => createConfidenceRecord({ code: `bconf_${now.toISOString().slice(0, 19)}`, domain: 'revenue', sourceType: 'manual', evidence: [{ label: 'note', value: r.slice(0, 100) }], predicted: 70, direction: 'increase', eligible: elig.eligible, exclusionReason: elig.exclusionReason }), 'Confidence Record 기록(제외 사유 보존)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">예측 기록(예시)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예측 메모(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!confRecords.length ? <AdminEmpty title="Confidence Record 없음" description="Confidence ≠ 사업 성공 확률." /> : confRecords.slice(0, 30).map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.confidence_code}</span>
                <AdminBadge tone={r.calibration_eligible ? 'success' : 'neutral'}>{r.calibration_eligible ? 'eligible' : 'excluded'}</AdminBadge>
                <span className="text-muted-foreground">predicted {r.predicted_confidence ?? '—'} ({r.predicted_direction ?? '—'})</span>
              </div>
              {r.exclusion_reason && <p className="mt-1 text-muted-foreground">exclusion: {r.exclusion_reason} (보존)</p>}
            </div>
          ))}
        </div>
      )}
      {tab === 'eligibility' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Eligible" value={NUM(summary.confidence_eligible as number)} />
            <Box label="Excluded" value={NUM(summary.confidence_excluded as number)} />
          </div>
          <AdminAlert tone="info" description="포함 조건: 예측+Confidence+실행 확인+Horizon 종료+Outcome 관찰 완료+Metric 정의 일치. not_executed/outcome_pending/metric 변경/scope 불일치는 제외하되 사유를 삭제하지 않고 보존합니다." />
        </div>
      )}
      {tab === 'calibration' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="판정" value={calibration.status} />
            <Box label="표본" value={NUM(calibration.sampleSize)} />
            <Box label="평균 Confidence" value={calibration.avgConfidence == null ? '—' : String(calibration.avgConfidence)} />
            <Box label="방향 정확도" value={calibration.directionAccuracy == null ? '—' : `${calibration.directionAccuracy}%`} />
          </div>
          <AdminAlert tone="info" description={`${calibration.note}. 표본<5 → calibration_sample_too_small(확정 금지). 과거 Confidence 오류로 미래 전체를 낮게 평가하지 않습니다.`} />
        </div>
      )}
      {tab === 'calibmetrics' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="MAE" value={calibMetrics.mae == null ? 'insufficient_data' : String(calibMetrics.mae)} />
            <Box label="% Error" value={calibMetrics.pctError == null ? '미계산' : `${calibMetrics.pctError}%`} />
            <Box label="Confidence Gap" value={calibration.confidenceGap == null ? '—' : String(calibration.confidenceGap)} />
          </div>
          <p className="text-[10px] text-muted-foreground">{calibMetrics.note} — 0으로 나눌 수 없는 경우 계산하지 않습니다.</p>
        </div>
      )}
      {tab === 'calibsnapshots' && (
        <div className="space-y-2">
          <button disabled={busy} onClick={() => {
            const r = needReason(); if (!r) return;
            void act(() => createCalibrationSnapshot({ code: `bcs_${now.toISOString().slice(0, 19)}`, domain: 'revenue', evidence: [{ label: 'note', value: r.slice(0, 100) }], sample: calibration.sampleSize, eligible: calibration.sampleSize, excluded: confRecords.filter((x) => !x.calibration_eligible).length, status: calibration.status, metrics: { mae: calibMetrics.mae, gap: calibration.confidenceGap } }), 'Snapshot 저장(덮어쓰기 없음·자동 수정 없음)');
          }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Calibration Snapshot 저장</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Snapshot 메모(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          {!calibSnapshots.length ? <AdminEmpty title="Snapshot 없음" description="Snapshot 은 덮어쓰지 않고 버전으로 축적합니다." /> : calibSnapshots.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.snapshot_code}</span>
              <AdminBadge tone="neutral">{s.calibration_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">eligible {s.eligible_count} / excluded {s.excluded_count}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'confrecs' && (
        <div className="space-y-1">
          {(() => {
            const rec = buildConfidenceAdjustmentRecommendation(calibration.status);
            return (
              <div className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{rec.adjustmentType}</AdminBadge>
                <span className="ml-2 text-muted-foreground">autoApplied=false — 실제 Confidence/Weight 를 자동 변경하지 않습니다</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Risk / Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'causalrisk' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Causal Risk" value={causalRisk.score == null ? causalRisk.level : `${causalRisk.score} (${causalRisk.level})`} />
            <Box label="실험 Gap(실측)" value="RCT 미존재 → 80" />
          </div>
          <AdminAlert tone="info" description="Unsupported Claim/교란/반증/Stale/실험 Gap/Calibration Gap/Twin Gap/전파/취약 9성분 재정규화." />
        </div>
      )}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성하지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r) => (
              <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{r.recType}</AdminBadge>
                  <AdminBadge tone={r.severity === 'high' || r.severity === 'critical' ? 'danger' : 'warning'}>{r.severity}</AdminBadge>
                  <span className="text-muted-foreground">confidence {r.confidence}</span>
                  <AdminBadge tone="warning">Human Approval 필수</AdminBadge>
                </div>
                <p className="mt-1">{r.recommendation}</p>
                <p className="text-muted-foreground">{r.mechanismNote} · {r.limitations.join(' · ')}</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'reviews' && (
        <AdminAlert tone="info" description="Causal Review(correlational/plausible/experimentally_supported_reference — 절대 확정 아님)는 Causal Candidates 탭에서, Twin/Calibration 검토는 각 탭에서 수행합니다. 종결 상태 재결정은 서버가 차단합니다." />
      )}
      {tab === 'external' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부 실험/시장/Provider 결과의 참고 기록만 저장 — 외부 자료의 진위를 시스템이 자동 보장하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXT_EVIDENCE.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="근거 내용(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => recordCausalExternalEvidence(extAction, rr, [{ label: 'manual_report', value: rr.slice(0, 200) }]), '참고 기록(진위 미보장)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">참고 기록</button>
          </div>
          {audit.filter((e) => e.event_type === 'external_evidence_reference').map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
              <p className="mt-1">{e.detail}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">{e.event_type}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {e.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {CAUSAL_SUPPORT.map((s) => (
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
