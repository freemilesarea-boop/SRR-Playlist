/**
 * ReliabilityGovernanceSection — AI Reliability & Release Governance Center (Phase AI-OPS-4).
 *
 * SLI(실측) → SLO(버전 관리) → Error Budget → Burn Rate → Multi-Window → Release Risk →
 * Change Freeze **권고** → 사람 결정 → Evidence 만. 자동 Freeze/Release 차단/Rollback/
 * Deploy/Certification 없음. Apply Freeze/Block Deployment/Update Branch Protection/
 * Disable Vercel/Stop Scheduler/Update Queue·Playback/Rollback Production 버튼 없음.
 *
 * 탭: Overview · Reliability Domains · SLI · SLO · Data Coverage · Error Budget ·
 *     Burn Rate · Multi-Window Analysis · Release Risk · Change Correlation ·
 *     Change Freeze · Release Portfolio · Change Velocity · Reliability Certification ·
 *     Policy History · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, Flame, Gauge, Grid3x3, History, Layers, Link2, Lock, PauseCircle,
  RefreshCw, Scale, ScrollText, Shield, Target, TrendingUp, Wallet,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchReliabilitySummary, fetchReliabilityIndicators, fetchReliabilityObjectives, fetchReliabilitySnapshots,
  fetchReliabilityDecisions, fetchReliabilityAudit, saveReliabilityIndicator, saveReliabilityObjective,
  computeReliabilitySli, recordReliabilityFreezeDecision, certifyReliability,
  fetchExecutionPlans, fetchPostChangeObservations, fetchIncidents,
  type ReliabilityIndicatorRow, type ReliabilityObjectiveRow, type ReliabilitySnapshotRow,
  type ReliabilityDecisionRow, type ReliabilityEventRow, type ExecutionPlanRow, type PostChangeObservationRow, type IncidentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  RELIABILITY_DOMAINS, REL_SUPPORT, COMPLIANCE_WINDOWS, UNSUPPORTED_WINDOWS,
  evaluateSloCompliance, calculateErrorBudget, calculateBurnRate, classifyBurnRate, evaluateMultiWindowBurn,
  correlateChangeWithReliability, calculateReleaseRisk, classifyReleaseRisk, assessFreezeRecommendation,
  validateFreezeReference, calculateChangeVelocity, evaluateReliabilityCertification, validatePolicyVersion,
  SLO_TONE, BUDGET_TONE, BURN_TONE, FREEZE_TONE, RELCERT_TONE, RISK_TONE,
  type ReleaseRiskComponents, type MultiWindowBurn,
} from '@/lib/reliabilityGovernance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? 'insufficient_data' : `${n}%`);

type Tab = 'overview' | 'domains' | 'sli' | 'slo' | 'coverage' | 'budget' | 'burn' | 'multiwindow'
  | 'risk' | 'correlation' | 'freeze' | 'portfolio' | 'velocity' | 'certification' | 'policy' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'domains', label: 'Reliability Domains', icon: Shield },
  { key: 'sli', label: 'SLI', icon: Activity },
  { key: 'slo', label: 'SLO', icon: Target },
  { key: 'coverage', label: 'Data Coverage', icon: Gauge },
  { key: 'budget', label: 'Error Budget', icon: Wallet },
  { key: 'burn', label: 'Burn Rate', icon: Flame },
  { key: 'multiwindow', label: 'Multi-Window', icon: TrendingUp },
  { key: 'risk', label: 'Release Risk', icon: Scale },
  { key: 'correlation', label: 'Change Correlation', icon: Link2 },
  { key: 'freeze', label: 'Change Freeze', icon: PauseCircle },
  { key: 'portfolio', label: 'Release Portfolio', icon: Layers },
  { key: 'velocity', label: 'Change Velocity', icon: TrendingUp },
  { key: 'certification', label: 'Reliability Certification', icon: Award },
  { key: 'policy', label: 'Policy History', icon: History },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ReliabilityGovernanceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [indicators, setIndicators] = useState<ReliabilityIndicatorRow[]>([]);
  const [objectives, setObjectives] = useState<ReliabilityObjectiveRow[]>([]);
  const [snapshots, setSnapshots] = useState<ReliabilitySnapshotRow[]>([]);
  const [decisions, setDecisions] = useState<ReliabilityDecisionRow[]>([]);
  const [audit, setAudit] = useState<ReliabilityEventRow[]>([]);
  const [plans, setPlans] = useState<ExecutionPlanRow[]>([]);
  const [observations, setObservations] = useState<PostChangeObservationRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ind, obj, snap, dec, au, pl, obs, inc] = await Promise.all([
        fetchReliabilitySummary(), fetchReliabilityIndicators(null, 100), fetchReliabilityObjectives(null, 100),
        fetchReliabilitySnapshots(null, null, 200), fetchReliabilityDecisions(null, 100), fetchReliabilityAudit(100),
        fetchExecutionPlans(null, null, 100), fetchPostChangeObservations(null, 100), fetchIncidents(null, null, 50),
      ]);
      setSummary(s); setIndicators(ind); setObjectives(obj); setSnapshots(snap); setDecisions(dec); setAudit(au);
      setPlans(pl); setObservations(obs); setIncidents(inc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수'); return null; }
    return reason.trim();
  };

  const latestSnap = useCallback((indicatorId: string, window: string) =>
    snapshots.find((s) => s.indicator_id === indicatorId && s.window_code === window) ?? null, [snapshots]);

  /* 활성 SLO별 실측 평가(순수 로직 — 서버 판정 아님, 사람 확인용). */
  const activeObjectives = useMemo(() => objectives.filter((o) => o.lifecycle_status === 'active'), [objectives]);
  const sloEvaluations = useMemo(() => activeObjectives.map((o) => {
    const snap = latestSnap(o.indicator_id, o.compliance_window);
    const compliance = evaluateSloCompliance({
      targetPct: Number(o.target_value), actualSliPct: snap?.sli_value ?? null,
      sampleSize: snap?.sample_size ?? null, minSample: o.minimum_sample,
      coveragePct: snap?.data_coverage ?? null, minCoveragePct: Number(o.minimum_data_coverage),
      window: o.compliance_window, windowDataAvailable: !!snap,
    });
    const budget = calculateErrorBudget({ targetPct: Number(o.target_value), actualSliPct: snap?.sli_value ?? null, coverageOk: snap ? (snap.data_coverage ?? 0) >= Number(o.minimum_data_coverage) : undefined });
    const shortSnap = latestSnap(o.indicator_id, 'rolling_1h');
    const longSnap = latestSnap(o.indicator_id, 'rolling_24h');
    const allowed = 100 - Number(o.target_value);
    const shortBurn = classifyBurnRate(calculateBurnRate(shortSnap?.sli_value != null ? 100 - shortSnap.sli_value : null, allowed), { budgetExhausted: budget.status === 'exhausted' });
    const longBurn = classifyBurnRate(calculateBurnRate(longSnap?.sli_value != null ? 100 - longSnap.sli_value : null, allowed));
    const multi = evaluateMultiWindowBurn({ shortBurn, longBurn });
    return { o, snap, compliance, budget, shortBurn, longBurn, multi };
  }), [activeObjectives, latestSnap]);

  const anyBreached = sloEvaluations.some((e) => e.compliance.compliance === 'breached');
  const anyExhausted = sloEvaluations.some((e) => e.budget.status === 'exhausted');
  const anyCriticalBreached = sloEvaluations.some((e) => e.compliance.compliance === 'breached' && e.o.severity === 'critical');
  const worstMulti: MultiWindowBurn = sloEvaluations.some((e) => e.multi.result === 'critical_burn') ? 'critical_burn'
    : sloEvaluations.some((e) => e.multi.result === 'sustained_burn') ? 'sustained_burn'
    : sloEvaluations.some((e) => e.multi.result === 'transient_spike') ? 'transient_spike'
    : sloEvaluations.length ? 'stable' : 'insufficient_data';
  const activeCriticalIncident = incidents.some((i) => i.severity === 'critical' && !i.resolved_at);
  const recentNotCertified = observations.some((ob) => ob.certification_result === 'not_certified');

  const riskComponents: ReleaseRiskComponents = useMemo(() => {
    const compRisk = sloEvaluations.length ? (sloEvaluations.filter((e) => ['breached', 'at_risk'].includes(e.compliance.compliance)).length / sloEvaluations.length) * 100 : null;
    const budgetRisk = sloEvaluations.length ? (sloEvaluations.filter((e) => ['low', 'exhausted'].includes(e.budget.status)).length / sloEvaluations.length) * 100 : null;
    const burnToRisk = (c: string): number | null => (c === 'severe_burn' || c === 'exhausted' ? 100 : c === 'fast_burn' ? 70 : c === 'elevated' ? 40 : c === 'normal' ? 0 : null);
    const shortVals = sloEvaluations.map((e) => burnToRisk(e.shortBurn)).filter((v): v is number => v !== null);
    const longVals = sloEvaluations.map((e) => burnToRisk(e.longBurn)).filter((v): v is number => v !== null);
    const uncertified = plans.filter((p) => p.plan_status === 'completed_reference' && !observations.some((ob) => ob.execution_plan_id === p.id && ['certified', 'certified_with_conditions'].includes(ob.certification_result ?? ''))).length;
    return {
      sloComplianceRisk: compRisk, errorBudgetRisk: budgetRisk,
      shortBurnRisk: shortVals.length ? Math.max(...shortVals) : null,
      longBurnRisk: longVals.length ? Math.max(...longVals) : null,
      incidentRisk: incidents.length ? (activeCriticalIncident ? 100 : incidents.some((i) => !i.resolved_at) ? 50 : 10) : null,
      regressionRisk: observations.length ? (observations.some((ob) => ((ob.regression_summary as { critical?: number } | null)?.critical ?? 0) > 0) ? 90 : 10) : null,
      certificationRisk: observations.length ? (recentNotCertified ? 90 : 10) : null,
      changeFrequencyRisk: plans.length ? Math.min(100, plans.length * 10) : null,
      uncertifiedChangeRisk: plans.length ? Math.min(100, uncertified * 50) : null,
      monitoringCoverageRisk: snapshots.length ? (snapshots.some((s) => s.status === 'data_gap') ? 70 : 20) : null,
      rollbackReadinessRisk: plans.length ? (plans.some((p) => !p.rollback_plan) ? 60 : 10) : null,
      governanceRisk: 10,
    };
  }, [sloEvaluations, plans, observations, incidents, snapshots, activeCriticalIncident, recentNotCertified]);
  const risk = useMemo(() => calculateReleaseRisk(riskComponents), [riskComponents]);
  const riskStatus = useMemo(() => classifyReleaseRisk(risk.score, {
    criticalSloBreached: anyCriticalBreached, budgetExhausted: anyExhausted,
    sustainedSevereBurn: worstMulti === 'critical_burn', activeCriticalIncident,
    recentNotCertified, monitoringGapWithHighRiskChange: false,
  }), [risk, anyCriticalBreached, anyExhausted, worstMulti, activeCriticalIncident, recentNotCertified]);

  const freezePreview = useMemo(() => assessFreezeRecommendation({
    dataSufficient: sloEvaluations.length > 0 && snapshots.length > 0,
    sloBreached: anyBreached, criticalSloBreached: anyCriticalBreached,
    budgetExhausted: anyExhausted, budgetLow: sloEvaluations.some((e) => e.budget.status === 'low'),
    multiWindowBurn: worstMulti, activeCriticalIncident,
    recentCertificationFailed: recentNotCertified, monitoringGap: false, rollbackIncomplete: false, governanceWarning: false,
  }), [sloEvaluations, snapshots, anyBreached, anyCriticalBreached, anyExhausted, worstMulti, activeCriticalIncident, recentNotCertified]);

  const velocity = useMemo(() => calculateChangeVelocity({
    totalChanges: plans.length,
    highRiskChanges: plans.filter((p) => ['high', 'critical'].includes(p.risk_tier)).length,
    certified: observations.filter((ob) => ['certified', 'certified_with_conditions'].includes(ob.certification_result ?? '')).length,
    failed: observations.filter((ob) => ob.certification_result === 'not_certified').length,
    rollbackRequested: observations.filter((ob) => ob.rollback_decision === 'rollback_requested' || ob.observation_status === 'rollback_review').length,
    observationHours: [], certificationHours: [],
  }), [plans, observations]);

  const certPreview = useMemo(() => evaluateReliabilityCertification({
    dataSufficient: snapshots.length > 0,
    requiredSlosMeeting: sloEvaluations.length > 0 && sloEvaluations.every((e) => ['meeting', 'at_risk'].includes(e.compliance.compliance)),
    criticalSloBreached: anyCriticalBreached, budgetExhausted: anyExhausted,
    sustainedCriticalBurn: worstMulti === 'critical_burn', activeCriticalIncident,
    uncertifiedHighRiskChanges: plans.filter((p) => ['high', 'critical'].includes(p.risk_tier) && p.plan_status === 'completed_reference'
      && !observations.some((ob) => ob.execution_plan_id === p.id && ['certified', 'certified_with_conditions'].includes(ob.certification_result ?? ''))).length,
    coverageSufficient: snapshots.length > 0 && !snapshots.slice(0, 10).some((s) => s.status === 'data_gap'),
    humanReviewed: true, evidenceComplete: snapshots.length > 0,
    warningSignals: sloEvaluations.filter((e) => e.compliance.compliance === 'at_risk' || e.budget.status === 'low').length,
  }), [snapshots, sloEvaluations, anyCriticalBreached, anyExhausted, worstMulti, activeCriticalIncident, plans, observations]);

  const createDraftSlo = (ind: ReliabilityIndicatorRow) => {
    const snap = snapshots.find((s) => s.indicator_id === ind.id && s.sli_value != null);
    if (!snap || snap.sli_value == null) { toast.error('실측 SLI Snapshot 없이 SLO 초안 생성 금지 — 먼저 SLI 를 계산하세요(임의 99.9% 설정 없음)'); return; }
    const target = Math.max(0, Math.min(99, Math.floor(snap.sli_value)));
    void act(() => saveReliabilityObjective({
      objective_code: `slo_${ind.indicator_code}`, indicator_id: ind.id, target_value: target,
      compliance_window: snap.window_code === 'point_in_time' ? 'rolling_24h' : snap.window_code,
      minimum_sample: 50, minimum_data_coverage: 50, severity: ind.domain === 'governance' ? 'high' : 'medium',
      lifecycle_status: 'draft',
      change_reason: `실측 baseline ${snap.sli_value}%(${snap.window_code}) 기반 초안 — 임의 목표 아님`,
    }), `SLO 초안 생성(target ${target}% — draft, 사람 승인 필요)`);
  };

  if (loading) return <AdminCard title="AI Reliability & Release Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Reliability & Release Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const certCounts = (summary.certifications ?? {}) as Record<string, number>;

  return (
    <AdminCard
      title="AI Reliability & Release Governance Center"
      subtitle="SLI(실측) → SLO(버전 관리) → Error Budget → Burn Rate → Release Risk → Freeze 권고 → 사람 결정 (자동 Freeze/차단/Rollback 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 배포·차단·Rollback 실행 엔진이 아닙니다. Error Budget 은 Production 실행 권한이 아니며, SLO 달성만으로 자동 Release 승인되지 않고 Budget 소진만으로 자동 Rollback 되지 않습니다. Freeze 는 권고와 사람 결정 기록만 — 시스템이 Branch Protection/Vercel/GitHub/Scheduler 를 변경하지 않습니다. AI 는 SLO 목표/Error Budget 을 직접 수정할 수 없습니다(사람 승인 + change_reason + Audit 필수)." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Active SLO" value={NUM(summary.objectives_active as number)} />
          <Box label="Meeting" value={sloEvaluations.length ? String(sloEvaluations.filter((e) => e.compliance.compliance === 'meeting').length) : '—'} />
          <Box label="At-Risk" value={sloEvaluations.length ? String(sloEvaluations.filter((e) => e.compliance.compliance === 'at_risk').length) : '—'} />
          <Box label="Breached" value={sloEvaluations.length ? String(sloEvaluations.filter((e) => e.compliance.compliance === 'breached').length) : '—'} />
          <Box label="Data Gaps" value={NUM(summary.snapshots_data_gap as number)} />
          <Box label="Budget Low/Exhausted" value={sloEvaluations.length ? String(sloEvaluations.filter((e) => ['low', 'exhausted'].includes(e.budget.status)).length) : '—'} />
          <Box label="Release Risk" value={risk.score == null ? 'insufficient_data' : `${risk.score} (${riskStatus.status})`} />
          <Box label="Freeze 권고" value={freezePreview.recommendation} />
          <Box label="Active Freeze Refs" value={NUM(summary.active_freeze_references as number)} />
          <Box label="Reliability 인증" value={NUM(certCounts.reliability_certified)} />
          <Box label="SLI 지표(활성/전체)" value={`${NUM(summary.indicators_active as number)}/${NUM(summary.indicators_total as number)}`} />
          <Box label="Last Evaluation" value={summary.last_evaluation_at ? String(summary.last_evaluation_at).slice(0, 16) : '—'} />
        </div>
      )}

      {/* ── Domains ── */}
      {tab === 'domains' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Domain</th><th className="px-2">상태</th><th className="px-2">근거(실제 Telemetry 분석)</th></tr></thead>
            <tbody>
              {RELIABILITY_DOMAINS.map((d) => (
                <tr key={d.domain} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{d.label}</td>
                  <td className="px-2"><AdminBadge tone={d.status === 'fully_supported' || d.status === 'partially_supported' ? 'success' : d.status === 'unsupported' ? 'danger' : 'warning'}>{d.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SLI ── */}
      {tab === 'sli' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="SLI (실측 지표만)" description="AI 는 SLI 정의를 생성·수정·삭제할 수 없습니다 — 활성화는 관리자 승인 + Audit. 계산은 playback_events_v2/ai_governance_events/store_monitoring_status 실측이며 total=0 이면 값 null(0 변환 없음)." />
          {!indicators.length ? <AdminEmpty icon={<Activity size={20} />} title="SLI 정의 없음" /> : indicators.map((ind) => {
            const s24 = latestSnap(ind.id, ind.aggregation_type === 'point_in_time' ? 'point_in_time' : 'rolling_24h');
            return (
              <div key={ind.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">SLI</AdminBadge>
                  <span className="font-semibold">{ind.title}</span>
                  <AdminBadge tone="neutral">{ind.domain}</AdminBadge>
                  <AdminBadge tone={ind.is_active ? 'success' : 'warning'}>{ind.is_active ? 'active' : '미활성(승인 필요)'}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">최근 24h: {s24?.sli_value != null ? `${s24.sli_value}%` : 'insufficient_data'} · sample {NUM(s24?.sample_size)}</span>
                  <div className="ml-auto flex gap-1">
                    {!ind.is_active && (
                      <button disabled={busy} onClick={() => void act(() => saveReliabilityIndicator({ indicator_code: ind.indicator_code, is_active: true, change_reason: '관리자 활성화(실측 근거 확인)', evidence: [{ label: 'source', value: ind.source_type }] }), 'SLI 활성화(사람 승인)')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">활성화</button>
                    )}
                    {(ind.aggregation_type === 'point_in_time' ? ['point_in_time'] : ['rolling_1h', 'rolling_24h', 'rolling_7d']).map((w) => (
                      <button key={w} disabled={busy} onClick={() => void act(() => computeReliabilitySli(ind.id, w === 'point_in_time' ? null : w), `SLI 계산(${w})`)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{w.replace('rolling_', '')}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">good: {ind.good_event_definition} · total: {ind.total_event_definition} · source: {ind.source_type}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SLO ── */}
      {tab === 'slo' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="SLO (버전 관리 · 사람 승인)" description="초기 목표는 실측 baseline 기반 draft 로만 생성됩니다(임의 99.9% 설정 없음). 변경은 새 버전 행으로 저장되며 과거 기간에 소급 적용하지 않습니다." />
          <div className="flex flex-wrap gap-1.5">
            {indicators.filter((i) => i.is_active).map((i) => (
              <button key={i.id} disabled={busy} onClick={() => createDraftSlo(i)} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ {i.indicator_code} SLO 초안(실측 기반)</button>
            ))}
          </div>
          {!objectives.length ? <AdminEmpty icon={<Target size={20} />} title="SLO 없음" description="SLI 활성화·계산 후 실측 기반 초안을 생성하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">SLO</th><th className="px-2">Target</th><th className="px-2">Actual(실측)</th><th className="px-2">Window</th><th className="px-2">v</th><th className="px-2">Lifecycle</th><th className="px-2">Compliance</th><th className="px-2" /></tr></thead>
                <tbody>
                  {objectives.map((o) => {
                    const ev = sloEvaluations.find((e) => e.o.id === o.id);
                    return (
                      <tr key={o.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-semibold">{o.objective_code.slice(0, 28)}</td>
                        <td className="px-2">{o.target_value}%</td>
                        <td className="px-2">{ev?.snap?.sli_value != null ? `${ev.snap.sli_value}%` : '—'}</td>
                        <td className="px-2 text-[10px]">{o.compliance_window}</td>
                        <td className="px-2 text-[10px]">v{o.version}</td>
                        <td className="px-2"><AdminBadge tone={o.lifecycle_status === 'active' ? 'success' : o.lifecycle_status === 'superseded' ? 'neutral' : 'warning'}>{o.lifecycle_status}</AdminBadge></td>
                        <td className="px-2">{ev ? <AdminBadge tone={SLO_TONE[ev.compliance.compliance]}>{ev.compliance.compliance}</AdminBadge> : <span className="text-[10px] text-muted-foreground">—</span>}</td>
                        <td className="px-2">
                          {['draft', 'pending_approval'].includes(o.lifecycle_status) && (
                            <button disabled={busy} onClick={() => void act(() => saveReliabilityObjective({ objective_code: o.objective_code, indicator_id: o.indicator_id, target_value: o.target_value, compliance_window: o.compliance_window, minimum_sample: o.minimum_sample, minimum_data_coverage: o.minimum_data_coverage, severity: o.severity, lifecycle_status: 'active', change_reason: '관리자 승인 — 활성화' }), 'SLO 활성화(새 버전, 사람 승인)')} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">승인·활성화</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Data Coverage ── */}
      {tab === 'coverage' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Data Coverage" description="Coverage 미달이면 SLO Pass/Fail 을 판정하지 않습니다(data_gap). 이벤트가 없는 시간을 정상으로 계산하지 않으며, 관측 불가 시간을 Availability 100% 로 계산하지 않습니다." />
          {!snapshots.length ? <AdminEmpty icon={<Gauge size={20} />} title="Snapshot 없음" description="SLI 탭에서 계산을 실행하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Indicator</th><th className="px-2">Window</th><th className="px-2">SLI</th><th className="px-2">Sample</th><th className="px-2">Coverage</th><th className="px-2">Status</th><th className="px-2">Period End</th></tr></thead>
                <tbody>
                  {snapshots.slice(0, 40).map((s) => (
                    <tr key={s.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{s.indicator_code ?? s.indicator_id.slice(0, 8)}</td>
                      <td className="px-2 text-[10px]">{s.window_code}</td>
                      <td className="px-2">{s.sli_value != null ? `${s.sli_value}%` : 'null(0 변환 없음)'}</td>
                      <td className="px-2 text-[10px]">{NUM(s.sample_size)}</td>
                      <td className="px-2 text-[10px]">{s.data_coverage != null ? `${s.data_coverage}%` : '—'}</td>
                      <td className="px-2"><AdminBadge tone={s.status === 'available' ? 'success' : s.status === 'data_gap' || s.status === 'invalid' ? 'danger' : s.status === 'provisional' ? 'warning' : 'neutral'}>{s.status}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{s.period_end.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Error Budget ── */}
      {tab === 'budget' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Error Budget (실행 권한 아님)" description="Budget = 100 − Target(비율형 SLI 전용). 허용 오류 0(target 100%)이면 나눗셈하지 않습니다. Budget 잔여는 Production 실행 권한으로 해석하지 않습니다." />
          {!sloEvaluations.length ? <AdminEmpty icon={<Wallet size={20} />} title="Active SLO 없음" /> : sloEvaluations.map(({ o, budget }) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{o.objective_code.slice(0, 26)}</span>
              <span className="text-[10px] text-muted-foreground">허용 {budget.budgetTotalPct != null ? `${budget.budgetTotalPct}%` : '—'} · 소비 {budget.consumedPct != null ? `${budget.consumedPct}%` : '—'} · 잔여 {budget.remainingPct != null ? `${budget.remainingPct}%` : '—'} · 소진율 {PCT(budget.consumptionPct)}</span>
              <AdminBadge tone={BUDGET_TONE[budget.status]}>{budget.status}</AdminBadge>
            </div>
          ))}
        </div>
      )}

      {/* ── Burn Rate ── */}
      {tab === 'burn' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Burn Rate" description="관측 오류율 ÷ 허용 오류율. 허용 0 이면 null. 고정 임계치(elevated 1× / fast 2× / severe 10×) — 실데이터 분포 기반 조정 가능 구조이며 근거·제한을 명시합니다." />
          {!sloEvaluations.length ? <AdminEmpty icon={<Flame size={20} />} title="Active SLO 없음" /> : sloEvaluations.map(({ o, shortBurn, longBurn }) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{o.objective_code.slice(0, 26)}</span>
              <span className="text-[10px] text-muted-foreground">Short(1h):</span><AdminBadge tone={BURN_TONE[shortBurn]}>{shortBurn}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">Long(24h):</span><AdminBadge tone={BURN_TONE[longBurn]}>{longBurn}</AdminBadge>
            </div>
          ))}
        </div>
      )}

      {/* ── Multi-Window ── */}
      {tab === 'multiwindow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Multi-Window Burn" description="단일 짧은 Spike 만으로 전체 Freeze 를 권고하지 않습니다 — 단기+장기 동시 초과만 critical." />
          {!sloEvaluations.length ? <AdminEmpty icon={<TrendingUp size={20} />} title="Active SLO 없음" /> : sloEvaluations.map(({ o, multi }) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{o.objective_code.slice(0, 26)}</span>
              <AdminBadge tone={multi.result === 'critical_burn' ? 'danger' : multi.result === 'sustained_burn' ? 'warning' : multi.result === 'transient_spike' ? 'info' : multi.result === 'stable' ? 'success' : 'neutral'}>{multi.result}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{multi.reasons.join(' · ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Release Risk ── */}
      {tab === 'risk' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Release Risk (자동 배포 차단 없음)" description="12개 성분 중 실측 가능한 성분만 재정규화하여 0~100 계산. Critical 이어도 자동 차단하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-black">{risk.score ?? '—'}</span>
            <AdminBadge tone={RISK_TONE[riskStatus.status]}>{riskStatus.status}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">성분 {risk.availableComponents}/12 사용{risk.missing.length ? ` · 제외: ${risk.missing.join(', ')}` : ''}</span>
          </div>
          {riskStatus.reasons.length > 0 && <AdminAlert tone={riskStatus.status === 'critical' ? 'danger' : 'info'} description={riskStatus.reasons.join(' · ')} />}
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
            {Object.entries(riskComponents).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-2"><p className="text-[10px] font-bold text-muted-foreground">{k}</p><p className="text-[11px] font-black">{v == null ? 'insufficient_data' : Math.round(v)}</p></div>
            ))}
          </div>
        </div>
      )}

      {/* ── Change Correlation ── */}
      {tab === 'correlation' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Change ↔ Reliability Correlation (인과 단정 없음)" description="실행된 변경(completed_reference)과 SLI 악화/Incident 의 시간·Scope·Release 상관만 표기합니다." />
          {(() => {
            const executed = plans.filter((p) => p.plan_status === 'completed_reference');
            const degraded = snapshots.filter((s) => s.status === 'available' && s.sli_value != null && s.sli_value < 90);
            if (!executed.length) return <AdminEmpty icon={<Link2 size={20} />} title="실행된 변경 없음" />;
            if (!degraded.length && !incidents.length) return <AdminEmpty icon={<Link2 size={20} />} title="악화 신호 없음" description="상관 판정 대상 SLI 악화/Incident 가 없습니다." />;
            return executed.slice(0, 10).flatMap((p) => {
              const ref = (p.manual_reference ?? {}) as Record<string, string>;
              return incidents.slice(0, 5).map((i) => {
                const r = correlateChangeWithReliability(
                  { executedAt: ref.executed_at ?? null, scopeKeys: [JSON.stringify(p.scope ?? {})], version: p.input_hash },
                  { startedAt: i.detected_at, scopeKeys: [i.scope_key ?? '', i.scope], version: null },
                );
                return (
                  <div key={`${p.id}-${i.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <span className="font-semibold">{p.change_summary.slice(0, 24)}</span>
                    <span className="text-[10px] text-muted-foreground">↔ {i.incident_code}</span>
                    <AdminBadge tone={r.correlation === 'unrelated' ? 'neutral' : r.correlation === 'insufficient_data' ? 'neutral' : 'warning'}>{r.correlation}</AdminBadge>
                  </div>
                );
              });
            });
          })()}
        </div>
      )}

      {/* ── Change Freeze ── */}
      {tab === 'freeze' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Change Freeze (권고 + 사람 결정 기록만)" description="Apply Freeze/Block Deployment/Update Branch Protection/Disable Vercel/Stop Scheduler 버튼은 존재하지 않습니다. 외부에서 실제 Freeze 를 설정한 경우 참고 기록만 저장하며 실제 동작 여부를 자동으로 단정하지 않습니다." />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground">권고(순수 로직):</span>
            <AdminBadge tone={FREEZE_TONE[freezePreview.recommendation]}>{freezePreview.recommendation}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{freezePreview.reasons.join(' · ')}</span>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Freeze 사유" />
          <div className="flex flex-wrap gap-1.5">
            {([['continue_changes', '계속 변경'], ['restrict_high_risk_changes', '고위험 변경 제한 요청'], ['temporary_freeze_requested', '임시 Freeze 요청 기록'], ['freeze_rejected', 'Freeze 기각'], ['emergency_exception_requested', '예외 요청'], ['invalidated', '무효화']] as const).map(([d, label]) => (
              <button key={d} disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                void act(() => recordReliabilityFreezeDecision({ decision: d, reason: r, scope: 'global', risk_snapshot: { score: risk.score, status: riskStatus.status, recommendation: freezePreview.recommendation }, evidence: [{ label: 'release_risk', value: risk.score ?? 'insufficient_data' }] }), `결정 기록: ${label}`); setReason('');
              }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{label}</button>
            ))}
            <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
              const ref = { external_freeze_id: `FRZ-${now.getTime().toString(36)}`, freeze_scope: 'production', freeze_started_at: now.toISOString(), applied_by: 'ops(사람)', external_system: 'external_change_management' };
              const v = validateFreezeReference(ref);
              if (v.errors.length) { toast.error(v.errors.join(', ')); return; }
              void act(() => recordReliabilityFreezeDecision({ decision: 'freeze_accepted_reference', reason: r, scope: 'production', freeze_reference: ref, evidence: [{ label: 'external', value: true }] }), '외부 Freeze Reference 기록(동작 자동 단정 없음)'); setReason('');
            }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">외부 Freeze Reference 기록</button>
          </div>
          {decisions.filter((d) => d.decision_type === 'freeze_decision').slice(0, 10).map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{d.created_at.slice(0, 16)}</span>
              <AdminBadge tone={d.decision === 'freeze_accepted_reference' ? 'warning' : d.decision === 'freeze_rejected' ? 'neutral' : 'info'}>{d.decision}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{d.reason.slice(0, 60)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Release Portfolio ── */}
      {tab === 'portfolio' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Release Portfolio (Change 기반)" description="Release 단위 그룹 metadata 가 없어 개별 Change(Execution Plan + Observation) 기반 Portfolio 만 지원합니다(정직 표기)." />
          {!plans.length ? <AdminEmpty icon={<Layers size={20} />} title="Change 없음" /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Planned" value={String(plans.filter((p) => ['draft', 'pending_review', 'waiting_evidence', 'preflight_ready', 'go_review'].includes(p.plan_status)).length)} />
              <Box label="사람 실행 대기" value={String(plans.filter((p) => p.plan_status === 'ready_for_manual_execution').length)} />
              <Box label="Executed Ref" value={String(plans.filter((p) => p.plan_status === 'completed_reference').length)} />
              <Box label="Observing" value={String(observations.filter((o) => ['observing', 'data_delayed'].includes(o.observation_status)).length)} />
              <Box label="Certified" value={String(observations.filter((o) => o.certification_result === 'certified').length)} />
              <Box label="조건부 인증" value={String(observations.filter((o) => o.certification_result === 'certified_with_conditions').length)} />
              <Box label="Not Certified" value={String(observations.filter((o) => o.certification_result === 'not_certified').length)} />
              <Box label="Rollback 권고" value={String(observations.filter((o) => o.certification_result === 'rollback_recommended').length)} />
              <Box label="Expired" value={String(plans.filter((p) => p.plan_status === 'expired').length)} />
              <Box label="Cancelled" value={String(plans.filter((p) => p.plan_status === 'cancelled').length)} />
            </div>
          )}
        </div>
      )}

      {/* ── Change Velocity ── */}
      {tab === 'velocity' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Change Velocity" description="표본 부족 시 insufficient_data 로 정직 표기합니다. 업계 표준 DORA 지표 지원을 주장하지 않습니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Change Count" value={String(velocity.changeCount)} />
            <Box label="High Risk" value={String(velocity.highRiskCount)} />
            <Box label="Certified Ratio" value={PCT(velocity.certifiedRatioPct)} />
            <Box label="Failed Ratio" value={PCT(velocity.failedRatioPct)} />
            <Box label="Rollback Ratio" value={PCT(velocity.rollbackRatioPct)} />
            <Box label="평균 관측 시간" value={velocity.meanObservationHours != null ? `${velocity.meanObservationHours}h` : 'insufficient_data'} />
            <Box label="평균 인증 시간" value={velocity.meanCertificationHours != null ? `${velocity.meanCertificationHours}h` : 'insufficient_data'} />
            <Box label="상태" value={velocity.status} />
          </div>
        </div>
      )}

      {/* ── Reliability Certification ── */}
      {tab === 'certification' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Reliability Certification (자동 인증 없음)" description="서버 게이트: 실측 Snapshot 없는 인증 금지 · data_gap 존재 시 무조건 인증 금지 · 사유/Evidence 필수. 최종 판정은 사람이 확정합니다." />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground">순수 로직 미리보기:</span>
            <AdminBadge tone={RELCERT_TONE[certPreview.result]}>{certPreview.result}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{certPreview.reasons.join(' · ')}</span>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Certification 사유(필수 — 자동 인증 없음)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Certification 사유" />
          <div className="flex flex-wrap gap-1.5">
            {(['reliability_certified', 'reliability_certified_with_conditions', 'reliability_at_risk', 'reliability_not_certified', 'insufficient_data', 'cert_invalidated'] as const).map((res) => (
              <button key={res} disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                const end = now.toISOString(); const start = new Date(now.getTime() - 7 * 86400000).toISOString();
                void act(() => certifyReliability({ decision: res, reason: r, scope: 'global', period_start: start, period_end: end, risk_snapshot: { score: risk.score, status: riskStatus.status }, evidence: [{ label: 'slo_evaluations', value: sloEvaluations.length }, { label: 'snapshots', value: snapshots.length }] }), `판정: ${res}`); setReason('');
              }} className={`rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${res === 'reliability_certified' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{res.replace('reliability_', '').replace('cert_', '')}</button>
            ))}
          </div>
          {decisions.filter((d) => d.decision_type === 'certification').slice(0, 10).map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{d.created_at.slice(0, 16)}</span>
              <AdminBadge tone={d.decision === 'reliability_certified' ? 'success' : d.decision === 'reliability_not_certified' ? 'danger' : 'warning'}>{d.decision}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{d.reason.slice(0, 60)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Policy History ── */}
      {tab === 'policy' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Policy Versioning" description="SLO 변경은 새 버전 행으로 저장됩니다(previous_version/checksum). 과거 기간은 당시 Policy 버전으로 재현하며, 현재 목표값을 과거 기간에 소급 적용하지 않습니다." />
          {!objectives.length ? <AdminEmpty icon={<History size={20} />} title="Policy 없음" /> : (
            objectives.map((o) => {
              const errors = validatePolicyVersion({ version: o.version, effective_from: o.effective_from, effective_to: o.effective_to, change_reason: o.change_reason, approved_by: o.approved_by, checksum: o.checksum });
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-semibold">{o.objective_code.slice(0, 24)}</span>
                  <AdminBadge tone="neutral">v{o.version}</AdminBadge>
                  <AdminBadge tone={o.lifecycle_status === 'active' ? 'success' : 'neutral'}>{o.lifecycle_status}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{o.effective_from.slice(0, 16)} ~ {o.effective_to ? o.effective_to.slice(0, 16) : '현재'} · {o.change_reason.slice(0, 40)} · checksum {o.checksum.slice(0, 8)}</span>
                  {errors.length > 0 && <AdminBadge tone="danger">version 불완전</AdminBadge>}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Reliability 이벤트 기록입니다 — 실제 Production 차단/배포 로그가 아닙니다." />
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : (
            audit.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
                <AdminBadge tone={a.event_type.includes('breached') || a.event_type.includes('exhausted') || a.event_type.includes('not_certified') ? 'danger' : a.event_type.includes('certified') || a.event_type.includes('met') ? 'success' : 'neutral'}>{a.event_type}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{(a.detail ?? '').slice(0, 80)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <AdminAlert tone="info" description={`지원 Window: ${COMPLIANCE_WINDOWS.join(', ')} — ${UNSUPPORTED_WINDOWS.join('/')} 는 미구현(지원 주장 안 함).`} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {REL_SUPPORT.map((s) => (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                    <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
