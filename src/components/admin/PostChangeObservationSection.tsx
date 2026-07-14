/**
 * PostChangeObservationSection — AI Post-Change Observation & Certification Center (Phase AI-OPS-3).
 *
 * completed_reference(0505 — 외부에서 사람이 실행) Plan 의 사후 관측:
 * Baseline 대비 실측 KPI(playback_events_v2) → Regression → Incident 상관 → Rollback 권고
 * → 사람 Rollback 결정 → 외부 Rollback Reference 기록 → 사람 Certification.
 * 실제 Apply/Rollback/Deploy 실행 없음. Execute Rollback/Apply Rollback/Deploy Previous
 * Version/Run Migration/Update Playlist·Scheduler·Queue·Playback 버튼 없음.
 * 실시간 WebSocket 미지원 — 수동 Refresh 만(실시간인 척하지 않음).
 *
 * 탭: Overview · Executed Changes · Observation Sessions · Baselines · Targets ·
 *     Live Observation · KPI Validation · Regressions · Incident Correlation · Trade-offs ·
 *     Rollback Assessment · Rollback References · Certification · Outcome Evidence ·
 *     Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Award, Eye, FileClock, FileSearch, Grid3x3, Layers, Link2, Lock,
  RefreshCw, Ruler, Scale, ScrollText, Target, TrendingDown, Undo2,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchPostChangeSummary, fetchPostChangeObservations, fetchPostChangeObservationDetail,
  createPostChangeObservation, startPostChangeObservation, collectPostChangeMetrics,
  updatePostChangeReview, recordPostChangeRollbackDecision, recordPostChangeRollbackReference,
  certifyPostChangeObservation, fetchPostChangeAudit, fetchExecutionPlans, fetchIncidents,
  type PostChangeObservationRow, type PostChangeMetricRow, type PostChangeAuditRow,
  type ExecutionPlanRow, type IncidentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SUPPORTED_METRICS, UNSUPPORTED_METRICS, PCO_SUPPORT, MIN_OBSERVATION_POLICY,
  classifyMetricResult, detectRegression, detectCrossMetricTradeoff, correlateIncident,
  assessRollbackNeed, evaluateCertification, buildCertificationPackage, validateRollbackReference,
  calculateObservationProgress, detectDataDelay, pcoHash,
  OBS_STATUS_LABEL, OBS_STATUS_TONE, METRIC_STATUS_TONE, CERT_LABEL, CERT_TONE, ROLLBACK_ASSESS_TONE,
  type ObservationStatus, type MetricRow, type MetricValidationStatus, type MetricRole,
  type RiskTier, type RollbackAssessment, type CertificationResult, type ObservationLike,
} from '@/lib/postChangeObservation';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const VAL = (n: number | null | undefined) => (n == null ? '—' : String(n));

type Tab = 'overview' | 'executed' | 'sessions' | 'baselines' | 'targets' | 'live' | 'validation'
  | 'regressions' | 'incidents' | 'tradeoffs' | 'rollback' | 'rollbackref' | 'certification' | 'evidence' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'executed', label: 'Executed Changes', icon: FileClock },
  { key: 'sessions', label: 'Observation Sessions', icon: Eye },
  { key: 'baselines', label: 'Baselines', icon: Ruler },
  { key: 'targets', label: 'Targets', icon: Target },
  { key: 'live', label: 'Live Observation', icon: Activity },
  { key: 'validation', label: 'KPI Validation', icon: FileSearch },
  { key: 'regressions', label: 'Regressions', icon: TrendingDown },
  { key: 'incidents', label: 'Incident Correlation', icon: Link2 },
  { key: 'tradeoffs', label: 'Trade-offs', icon: Scale },
  { key: 'rollback', label: 'Rollback Assessment', icon: Undo2 },
  { key: 'rollbackref', label: 'Rollback References', icon: ScrollText },
  { key: 'certification', label: 'Certification', icon: Award },
  { key: 'evidence', label: 'Outcome Evidence', icon: FileSearch },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function PostChangeObservationSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [observations, setObservations] = useState<PostChangeObservationRow[]>([]);
  const [executed, setExecuted] = useState<ExecutionPlanRow[]>([]);
  const [selObs, setSelObs] = useState<PostChangeObservationRow | null>(null);
  const [metrics, setMetrics] = useState<PostChangeMetricRow[]>([]);
  const [audit, setAudit] = useState<PostChangeAuditRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, obs, plans, au, inc] = await Promise.all([
        fetchPostChangeSummary(), fetchPostChangeObservations(null, 100),
        fetchExecutionPlans('completed_reference', null, 100), fetchPostChangeAudit(null, 100),
        fetchIncidents(null, null, 50),
      ]);
      setSummary(s); setObservations(obs); setExecuted(plans); setAudit(au); setIncidents(inc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openObs = async (o: PostChangeObservationRow) => {
    setSelObs(o); setBusy(true);
    try {
      const d = await fetchPostChangeObservationDetail(o.id);
      if (d.found && d.observation) { setSelObs(d.observation); setMetrics(d.metrics); setAudit(d.audit); }
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const refreshObs = async () => {
    if (!selObs) return;
    const d = await fetchPostChangeObservationDetail(selObs.id);
    if (d.found && d.observation) { setSelObs(d.observation); setMetrics(d.metrics); setAudit(d.audit); }
    setObservations(await fetchPostChangeObservations(null, 100));
  };

  const observedPlanIds = useMemo(() => new Set(observations.map((o) => o.execution_plan_id)), [observations]);

  const createObs = async (plan: ExecutionPlanRow) => {
    setBusy(true);
    try {
      const ref = (plan.manual_reference ?? {}) as Record<string, string>;
      const executedAt = ref.executed_at ? new Date(ref.executed_at) : now;
      const baselineStart = new Date(executedAt.getTime() - 7 * 86400000);
      const hash = pcoHash([plan.id, plan.input_hash]);
      const res = await createePayload(plan, ref, baselineStart, executedAt, hash);
      toast.success(res.idempotent ? '이미 Observation 존재(중복 방지)' : `Observation 생성(${res.eligibility})`);
      await load();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const createePayload = (plan: ExecutionPlanRow, ref: Record<string, string>, baselineStart: Date, executedAt: Date, hash: string) =>
    createPostChangeObservation({
      observation_code: `obs_${hash.slice(4)}`, execution_plan_id: plan.id,
      observation_scope: JSON.stringify((plan.scope ?? {})).slice(0, 200),
      baseline_start: baselineStart.toISOString(), baseline_end: executedAt.toISOString(),
      source_version: JSON.stringify(plan.source_versions ?? {}).slice(0, 200), deployed_version: ref.external_change_id ?? '',
      input_hash: plan.input_hash, idempotency_key: hash,
      baseline_snapshot: { method: '변경 전 동일 기간(7일)', source: 'playback_events_v2', period: [baselineStart.toISOString(), executedAt.toISOString()], note: '실측 값은 KPI 수집 시 계산(가짜 값 생성 없음)' },
      target_snapshot: { warning_threshold_pct: 10, failure_threshold_pct: 25, minimum_sample: MIN_OBSERVATION_POLICY[(plan.risk_tier as RiskTier) ?? 'medium']?.minEvents ?? 200 },
      monitoring_sources: ['playback_events_v2'],
      success_criteria: ['primary KPI baseline 유지/개선', 'guardrail 위반 없음'],
      failure_criteria: ['failure threshold 초과', 'critical regression'],
      evidence: [{ label: 'execution_plan', value: plan.plan_code }, { label: 'external_change_id', value: ref.external_change_id ?? '' }],
      limitations: ['Queue/Scheduler/Buffer/TTFA/Revenue telemetry 미수집 — 해당 KPI unsupported', 'Rollback 은 외부 수동 실행(시스템 실행 없음)'],
    });

  /* 선택 Observation 의 metric 을 순수 로직 행으로 변환(클라이언트 검토 미리보기). */
  const minSample = useMemo(() => MIN_OBSERVATION_POLICY[(selObs?.observation_scope ? 'medium' : 'medium') as RiskTier].minEvents, [selObs]);
  const logicRows: MetricRow[] = useMemo(() => metrics.map((m) => ({
    metricCode: m.metric_code, metricRole: (m.metric_role as MetricRole) ?? 'primary',
    validationStatus: (m.validation_status === 'pending'
      ? classifyMetricResult({ metricCode: m.metric_code, metricType: m.metric_type, baseline: m.baseline_value, observed: m.observed_value, sampleSize: m.sample_size, minSample, warningThresholdPct: 10, failureThresholdPct: 25 })
      : m.validation_status) as MetricValidationStatus,
    sampleSize: m.sample_size,
  })), [metrics, minSample]);

  const dataDelayed = useMemo(() => detectDataDelay(metrics[0]?.observed_at ?? null, now, 24 * 60), [metrics, now]);
  const regressions = useMemo(() => (selObs ? detectRegression(logicRows, { versionMatch: true, monitoringGap: false, dataDelayed, minSample }) : []), [selObs, logicRows, dataDelayed, minSample]);
  const tradeoff = useMemo(() => detectCrossMetricTradeoff(logicRows), [logicRows]);
  const correlated = useMemo(() => {
    if (!selObs) return [];
    const win = { start: selObs.observation_start, end: selObs.observation_end, scopeKeys: [selObs.observation_scope ?? ''] };
    return incidents.map((i) => ({ incident: i, res: correlateIncident({ occurredAt: i.detected_at, scopeKeys: [i.scope_key ?? '', i.scope] }, win) }));
  }, [incidents, selObs]);
  const rollbackPreview = useMemo(() => {
    if (!selObs || !metrics.length) return null;
    return assessRollbackNeed({
      dataSufficient: metrics.length > 0 && !dataDelayed,
      criticalRegressions: regressions.filter((r) => r.severity === 'critical').length,
      primaryFailed: logicRows.some((r) => r.metricRole === 'primary' && r.validationStatus === 'failed'),
      guardrailViolated: logicRows.some((r) => r.metricRole === 'guardrail' && ['failed', 'degraded'].includes(r.validationStatus)),
      failureThresholdExceeded: logicRows.some((r) => r.validationStatus === 'failed'),
      incidentIncrease: correlated.filter((c) => c.res.correlation !== 'unrelated' && c.res.correlation !== 'insufficient_data').length > 0,
      errorSpike: regressions.some((r) => r.type === 'error_spike'),
      versionMismatch: false, monitoringGap: false,
      rollbackPlanExists: true, rollbackOwnerExists: true, irreversible: false,
    });
  }, [selObs, metrics, logicRows, regressions, correlated, dataDelayed]);
  const certPreview = useMemo(() => {
    if (!selObs) return null;
    return evaluateCertification({
      dataSufficient: metrics.length > 0 && !dataDelayed,
      primaryPassed: logicRows.filter((r) => r.metricRole === 'primary').every((r) => ['improved', 'stable'].includes(r.validationStatus)) && logicRows.some((r) => r.metricRole === 'primary'),
      guardrailFailed: logicRows.some((r) => r.metricRole === 'guardrail' && r.validationStatus === 'failed'),
      warningRegressions: regressions.filter((r) => r.severity === 'warning' || r.severity === 'high').length,
      criticalRegressions: regressions.filter((r) => r.severity === 'critical').length,
      criticalIncidents: correlated.filter((c) => c.incident.severity === 'critical' && c.res.correlation !== 'unrelated').length,
      windowMet: !!selObs.observation_start, sampleMet: (metrics[0]?.sample_size ?? 0) >= 50,
      versionMatch: true, monitoringGap: false,
      humanReviewed: selObs.observation_status === 'review_required' || !!selObs.rollback_decision,
      evidenceComplete: (selObs.evidence?.length ?? 0) > 0,
      rollbackAssessment: (rollbackPreview?.assessment ?? null) as RollbackAssessment | null,
      rollbackDecision: (selObs.rollback_decision ?? null) as never,
      riskTier: 'medium',
    });
  }, [selObs, metrics, logicRows, regressions, correlated, rollbackPreview, dataDelayed]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await refreshObs(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수(Evidence 없는 판정 금지)'); return null; }
    return reason.trim();
  };

  if (loading) return <AdminCard title="AI Post-Change Observation & Certification Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Post-Change Observation & Certification Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const byStatus = (summary.by_status ?? {}) as Record<string, number>;
  const progress = selObs ? calculateObservationProgress(selObs.observation_start, 24, now) : null;

  return (
    <AdminCard
      title="AI Post-Change Observation & Certification Center"
      subtitle="외부 실행된 변경의 사후 관측 → Baseline 대비 실측 KPI 검증 → Regression/Incident → Rollback 권고(실행 아님) → 사람 인증"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 실행/Rollback 엔진이 아닙니다. Rollback 권고는 권고일 뿐이며 Execute Rollback/Apply Rollback/Deploy Previous Version/Run Migration/Update Playlist·Scheduler·Queue·Playback 버튼은 존재하지 않습니다. Rollback Reference 는 외부 수동 수행의 참고 기록이고, 기록 후에도 별도 재검증 없이 성공으로 인증되지 않습니다. Certification 은 사람이 사유와 함께 확정합니다(자동 인증 없음). 관측은 실시간이 아니라 수동 Refresh 기반입니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Executed Changes" value={NUM(summary.executed_changes as number)} />
          <Box label="Active Observations" value={NUM(byStatus.observing)} />
          <Box label="Pending Data" value={NUM(byStatus.data_delayed)} />
          <Box label="Review Required" value={NUM(byStatus.review_required)} />
          <Box label="Rollback Review" value={NUM(byStatus.rollback_review)} />
          <Box label="Certified" value={NUM(summary.certified as number)} />
          <Box label="조건부 인증" value={NUM(summary.certified_with_conditions as number)} />
          <Box label="인증 불가" value={NUM(summary.not_certified as number)} />
          <Box label="Rollback 권고" value={NUM(summary.rollback_recommended as number)} />
          <Box label="Invalidated" value={NUM(byStatus.invalidated)} />
          <Box label="전체 Observation" value={NUM(summary.total as number)} />
          <Box label="Last Observation" value={summary.last_observation_at ? String(summary.last_observation_at).slice(0, 16) : '—'} />
        </div>
      )}

      {/* ── Executed Changes ── */}
      {tab === 'executed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="completed_reference Plan 만 관측 가능" description="Manual Execution Reference(external_change_id/executed_by/executed_at/execution_result)가 완전한 Plan 만 Observation 을 생성할 수 있습니다(서버 게이트). Baseline 은 변경 전 동일 7일 기간으로 기록됩니다." />
          {!executed.length ? <AdminEmpty icon={<FileClock size={20} />} title="외부 실행 기록 없음" description="Execution Readiness Center 에서 Manual Reference 기록 후 표시됩니다." /> : (
            executed.map((p) => {
              const ref = (p.manual_reference ?? {}) as Record<string, string>;
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="success">실행 참고 기록됨</AdminBadge>
                  <span className="font-semibold">{p.change_summary.slice(0, 40)}</span>
                  <span className="text-[10px] text-muted-foreground">CHG {ref.external_change_id ?? '—'} · by {ref.executed_by ?? '—'} · {String(ref.executed_at ?? '').slice(0, 16)}</span>
                  {observedPlanIds.has(p.id) ? <AdminBadge tone="neutral">Observation 존재</AdminBadge> : (
                    <button disabled={busy} onClick={() => void createObs(p)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Observation 생성</button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Observation Sessions ── */}
      {tab === 'sessions' && (
        <div className="space-y-2">
          {!observations.length ? <AdminEmpty icon={<Eye size={20} />} title="Observation 없음" description="Executed Changes 탭에서 생성하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Code</th><th className="px-2">CHG</th><th className="px-2">Status</th><th className="px-2">Certification</th><th className="px-2">Baseline</th><th className="px-2" /></tr></thead>
                <tbody>
                  {observations.map((o) => (
                    <tr key={o.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{o.observation_code.slice(0, 20)}</td>
                      <td className="px-2 text-[10px]">{o.external_change_id ?? '—'}</td>
                      <td className="px-2"><AdminBadge tone={OBS_STATUS_TONE[o.observation_status as ObservationStatus] ?? 'neutral'}>{OBS_STATUS_LABEL[o.observation_status as ObservationStatus] ?? o.observation_status}</AdminBadge></td>
                      <td className="px-2">{o.certification_result ? <AdminBadge tone={CERT_TONE[o.certification_result as CertificationResult] ?? 'neutral'}>{CERT_LABEL[o.certification_result as CertificationResult] ?? o.certification_result}</AdminBadge> : <span className="text-[10px] text-muted-foreground">—</span>}</td>
                      <td className="px-2 text-[10px]">{o.baseline_start.slice(0, 10)} ~ {o.baseline_end.slice(0, 10)}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => void openObs(o)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">선택</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selObs && <AdminAlert tone="info" title={`선택됨: ${selObs.observation_code}`} description="Live Observation/KPI Validation/Rollback/Certification 탭에서 이 세션을 검토하세요." />}
        </div>
      )}

      {/* ── Baselines ── */}
      {tab === 'baselines' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Baseline 필수" description="Baseline 없는 KPI 검증은 서버에서 차단됩니다. Baseline 실측 값은 KPI 수집 시 playback_events_v2 의 변경 전 기간에서 계산되며(가짜 값 생성 없음), 지원되지 않는 비교 기간은 임의 생성하지 않습니다." />
          {!selObs ? <AdminEmpty icon={<Ruler size={20} />} title="Observation 선택 필요" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Baseline 시작" value={selObs.baseline_start.slice(0, 16)} />
                <Box label="Baseline 종료" value={selObs.baseline_end.slice(0, 16)} />
                <Box label="Source" value="playback_events_v2" />
                <Box label="Baseline Sample" value={VAL(metrics[0]?.baseline_sample_size ?? null)} />
              </div>
              <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selObs.baseline_snapshot, null, 1)}</pre>
              {metrics.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Metric</th><th className="px-2">Baseline(실측)</th><th className="px-2">Sample</th></tr></thead>
                    <tbody>{metrics.map((m) => (
                      <tr key={m.metric_code} className="border-b border-border/50"><td className="py-1.5 pr-2 font-semibold">{m.metric_code}</td><td className="px-2">{VAL(m.baseline_value)}</td><td className="px-2 text-[10px]">{NUM(m.baseline_sample_size)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Targets ── */}
      {tab === 'targets' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Target Model" description="expected_direction/warning·failure threshold/minimum sample. Target 이 없는 KPI 는 성공 판정에 사용하지 않고 참고 관측으로만 표시합니다. 기본 threshold: warning 10% / failure 25%(상대 변화)." />
          {!selObs ? <AdminEmpty icon={<Target size={20} />} title="Observation 선택 필요" /> : (
            <>
              <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selObs.target_snapshot, null, 1)}</pre>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Metric</th><th className="px-2">방향</th><th className="px-2">Role</th><th className="px-2">Target</th></tr></thead>
                  <tbody>{SUPPORTED_METRICS.map((s) => {
                    const m = metrics.find((x) => x.metric_code === s.code);
                    return (
                      <tr key={s.code} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                        <td className="px-2 text-[10px]">{s.direction}</td>
                        <td className="px-2 text-[10px]">{m?.metric_role ?? s.defaultRole}</td>
                        <td className="px-2 text-[10px]">{m?.target_value != null ? m.target_value : '참고 관측(Target 없음)'}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Live Observation ── */}
      {tab === 'live' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Live Observation (수동 Refresh — 실시간 WebSocket 미지원)" description="KPI 수집은 playback_events_v2 실측만 사용합니다. 관측 구간 이벤트가 0건이면 data_delayed 로 표시하고 가짜 값을 만들지 않습니다." />
          {!selObs ? <AdminEmpty icon={<Activity size={20} />} title="Observation 선택 필요" /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={OBS_STATUS_TONE[selObs.observation_status as ObservationStatus] ?? 'neutral'}>{OBS_STATUS_LABEL[selObs.observation_status as ObservationStatus] ?? selObs.observation_status}</AdminBadge>
                {progress?.progressPct != null && <span className="text-[10px] text-muted-foreground">Window(24h 기준) 진행 {progress.progressPct}% · 경과 {progress.elapsedHours}h</span>}
                {dataDelayed && metrics.length > 0 && <AdminBadge tone="warning">데이터 지연 가능</AdminBadge>}
                <div className="ml-auto flex gap-1.5">
                  {['draft', 'pending_observation'].includes(selObs.observation_status) && (
                    <button disabled={busy} onClick={() => void act(() => startPostChangeObservation(selObs.id, '관측 시작(사람)'), '관측 시작')} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">관측 시작</button>
                  )}
                  <button disabled={busy || !['observing', 'data_delayed', 'review_required'].includes(selObs.observation_status)} onClick={() => void act(() => collectPostChangeMetrics(selObs.id), '실측 KPI 수집(actual)')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-40">KPI 수집(실측)</button>
                </div>
              </div>
              {!metrics.length ? <AdminEmpty icon={<Activity size={20} />} title="수집된 Metric 없음" description="관측 시작 후 KPI 수집을 실행하세요." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Metric</th><th className="px-2">Baseline</th><th className="px-2">Observed</th><th className="px-2">Δ</th><th className="px-2">Δ%</th><th className="px-2">Sample</th><th className="px-2">Status</th><th className="px-2">Updated</th></tr></thead>
                    <tbody>{metrics.map((m) => (
                      <tr key={m.metric_code} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-semibold">{m.metric_code}</td>
                        <td className="px-2">{VAL(m.baseline_value)}</td>
                        <td className="px-2">{VAL(m.observed_value)}</td>
                        <td className="px-2 text-[10px]">{VAL(m.absolute_delta)}</td>
                        <td className="px-2 text-[10px]">{m.relative_delta == null ? 'null(baseline 0)' : `${m.relative_delta}%`}</td>
                        <td className="px-2 text-[10px]">{NUM(m.sample_size)}</td>
                        <td className="px-2"><AdminBadge tone={METRIC_STATUS_TONE[m.validation_status as MetricValidationStatus] ?? 'neutral'}>{m.validation_status}</AdminBadge></td>
                        <td className="px-2 text-[10px]">{m.observed_at ? m.observed_at.slice(0, 16) : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── KPI Validation ── */}
      {tab === 'validation' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Metric Validation (순수 로직 미리보기 → 사람 기록)" description="Baseline 존재 · 최소 Sample · NaN/Infinity 없음 · Baseline 0 이면 상대 변화 계산 안 함(절대 delta 만). simulated/predicted 값은 actual 로 저장 금지." />
          {!selObs || !metrics.length ? <AdminEmpty icon={<FileSearch size={20} />} title="수집된 Metric 필요" /> : (
            <>
              <div className="space-y-1">
                {metrics.map((m) => {
                  const preview = classifyMetricResult({ metricCode: m.metric_code, metricType: m.metric_type, baseline: m.baseline_value, observed: m.observed_value, sampleSize: m.sample_size, minSample, warningThresholdPct: 10, failureThresholdPct: 25 });
                  return (
                    <div key={m.metric_code} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                      <span className="font-semibold">{m.metric_code}</span>
                      <AdminBadge tone="neutral">{m.metric_role}</AdminBadge>
                      <span className="text-[10px] text-muted-foreground">기록됨: {m.validation_status}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">판정 미리보기 →</span>
                      <AdminBadge tone={METRIC_STATUS_TONE[preview]}>{preview}</AdminBadge>
                    </div>
                  );
                })}
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검증 기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="검증 사유" />
              <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                const rows = metrics.map((m) => ({ metric_code: m.metric_code, validation_status: classifyMetricResult({ metricCode: m.metric_code, metricType: m.metric_type, baseline: m.baseline_value, observed: m.observed_value, sampleSize: m.sample_size, minSample, warningThresholdPct: 10, failureThresholdPct: 25 }) }));
                void act(() => updatePostChangeReview(selObs.id, 'metric_validation', rows, r), '검증 결과 기록(사람 확인)'); setReason('');
              }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">순수 로직 판정을 검토 후 기록</button>
            </>
          )}
        </div>
      )}

      {/* ── Regressions ── */}
      {tab === 'regressions' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Regression Detection" description="Primary/Guardrail 구분 · 단일 KPI 소폭 악화만으로 전체 실패 처리하지 않음 · Severity: informational/warning/high/critical." />
          {!selObs ? <AdminEmpty icon={<TrendingDown size={20} />} title="Observation 선택 필요" /> : !regressions.length ? (
            <AdminEmpty icon={<TrendingDown size={20} />} title="Regression 없음" description={metrics.length ? '탐지된 회귀가 없습니다.' : '수집된 Metric 이 없어 판정할 수 없습니다(insufficient_data).'} />
          ) : (
            <>
              {regressions.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={r.severity === 'critical' ? 'danger' : r.severity === 'high' ? 'danger' : r.severity === 'warning' ? 'warning' : 'neutral'}>{r.severity}</AdminBadge>
                  <span className="font-semibold">{r.type}</span>
                  {r.metricCode && <code className="text-[10px]">{r.metricCode}</code>}
                  <span className="text-[10px] text-muted-foreground">{r.note}</span>
                </div>
              ))}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Regression 기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Regression 사유" />
              <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                const value = { critical: regressions.filter((x) => x.severity === 'critical').length, high: regressions.filter((x) => x.severity === 'high').length, warning: regressions.filter((x) => x.severity === 'warning').length, items: regressions };
                void act(() => updatePostChangeReview(selObs.id, 'regression_summary', value, r), 'Regression Summary 기록'); setReason('');
              }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Regression Summary 기록</button>
            </>
          )}
        </div>
      )}

      {/* ── Incident Correlation ── */}
      {tab === 'incidents' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} title="Incident Correlation (인과 단정 없음)" description="Observation Window 와 Incident(0502)의 시간/Scope 상관만 표기합니다: temporally_correlated/scope_correlated/possibly_related/unrelated/insufficient_data." />
          {!selObs ? <AdminEmpty icon={<Link2 size={20} />} title="Observation 선택 필요" /> : !correlated.length ? <AdminEmpty icon={<Link2 size={20} />} title="Incident 없음" /> : (
            <>
              {correlated.map(({ incident, res }) => (
                <div key={incident.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={incident.severity === 'critical' ? 'danger' : 'warning'}>{incident.severity}</AdminBadge>
                  <span className="font-semibold">{incident.incident_code}</span>
                  <span className="text-[10px] text-muted-foreground">{incident.incident_type} · {incident.detected_at.slice(0, 16)}</span>
                  <AdminBadge tone={res.correlation === 'unrelated' ? 'neutral' : res.correlation === 'insufficient_data' ? 'neutral' : 'warning'}>{res.correlation}</AdminBadge>
                </div>
              ))}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Incident 상관 기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Incident 사유" />
              <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                const value = { correlations: correlated.map((c) => ({ incident: c.incident.incident_code, severity: c.incident.severity, correlation: c.res.correlation })), note: '상관 표기일 뿐 인과관계 단정 아님' };
                void act(() => updatePostChangeReview(selObs.id, 'incident_summary', value, r), 'Incident Summary 기록'); setReason('');
              }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Incident Summary 기록</button>
            </>
          )}
        </div>
      )}

      {/* ── Trade-offs ── */}
      {tab === 'tradeoffs' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Cross-Metric Trade-off" description="Completion 개선/Error 악화 같은 교차 검증. Critical Trade-off 는 Certification 금지." />
          {!selObs ? <AdminEmpty icon={<Scale size={20} />} title="Observation 선택 필요" /> : (
            <>
              <div className="flex items-center gap-2">
                <AdminBadge tone={tradeoff.result === 'consistent_improvement' ? 'success' : tradeoff.result === 'critical_tradeoff' || tradeoff.result === 'degraded' ? 'danger' : tradeoff.result === 'insufficient_data' ? 'neutral' : 'warning'}>{tradeoff.result}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{tradeoff.pairs.length ? tradeoff.pairs.join(' · ') : '교차 악화 조합 없음'}</span>
              </div>
              {!metrics.length && <AdminAlert tone="warning" description="수집된 Metric 이 없어 insufficient_data 입니다(0 으로 조작하지 않음)." />}
            </>
          )}
        </div>
      )}

      {/* ── Rollback Assessment ── */}
      {tab === 'rollback' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Rollback Assessment (권고 전용)" description="rollback_recommended 는 실행이 아니라 권고입니다. 실행 버튼은 존재하지 않으며, 사람이 결정을 기록합니다." />
          {!selObs ? <AdminEmpty icon={<Undo2 size={20} />} title="Observation 선택 필요" /> : (
            <>
              {rollbackPreview ? (
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={ROLLBACK_ASSESS_TONE[rollbackPreview.assessment]}>{rollbackPreview.assessment}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{rollbackPreview.reasons.join(' · ')}</span>
                </div>
              ) : <AdminAlert tone="info" description="수집된 Metric 이 없어 평가할 수 없습니다(insufficient_data)." />}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정/기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Rollback 사유" />
              <div className="flex flex-wrap gap-1.5">
                <button disabled={busy || !rollbackPreview} onClick={() => { const r = needReason(); if (!r || !rollbackPreview) return;
                  void act(() => updatePostChangeReview(selObs.id, 'rollback_assessment', { assessment: rollbackPreview.assessment, reasons: rollbackPreview.reasons, note: '권고 전용 — 실행 아님' }, r), 'Rollback Assessment 기록'); setReason('');
                }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-40">평가 기록</button>
                {(['continue_observation', 'accept_degradation', 'rollback_requested', 'change_cancelled', 'invalidated'] as const).map((d) => (
                  <button key={d} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => recordPostChangeRollbackDecision(selObs.id, d, r), `결정 기록: ${d}`); setReason(''); }}
                    className={`rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50 ${d === 'rollback_requested' ? 'text-red-500' : ''}`}>{d === 'continue_observation' ? '계속 관측' : d === 'accept_degradation' ? '악화 수용' : d === 'rollback_requested' ? 'Rollback 요청 기록' : d === 'change_cancelled' ? '변경 취소' : '무효화'}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Rollback References ── */}
      {tab === 'rollbackref' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Rollback Reference (외부 수행 참고 기록)" description="rollback_requested(rollback_review) 상태에서만 기록 가능하며, 기록 시 rollback_completed_pending_validation 이 됩니다 — 실측 재검증 없이 성공으로 인증하지 않습니다. Rollback 이후 별도 Observation/Validation 이 필요합니다." />
          {!selObs ? <AdminEmpty icon={<ScrollText size={20} />} title="Observation 선택 필요" /> : selObs.rollback_reference ? (
            <>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selObs.rollback_reference, null, 1)}</pre>
              <AdminAlert tone="warning" description="Rollback 후 재검증 대기 — 별도 재관측 전에는 성공 인증 불가." />
            </>
          ) : (
            <button disabled={busy || selObs.observation_status !== 'rollback_review'} onClick={() => {
              const payload = { external_rollback_id: `RB-${selObs.observation_code.slice(4, 12)}`, rollback_executed_by: 'ops(사람)', rollback_executed_at: now.toISOString(), rollback_result: 'succeeded', validation_result: 'pending_revalidation', evidence: [{ label: 'external', value: true }] };
              const v = validateRollbackReference(payload);
              if (v.errors.length) { toast.error(v.errors.join(', ')); return; }
              void act(() => recordPostChangeRollbackReference(selObs.id, payload), '외부 Rollback 참고 기록(재검증 필요)');
            }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-40">외부 Rollback Reference 기록(rollback_review 상태에서만)</button>
          )}
        </div>
      )}

      {/* ── Certification ── */}
      {tab === 'certification' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Operational Certification (자동 Certification 없음)" description="서버 게이트: 관측 데이터 없는 인증 금지 · primary failed 금지 · guardrail 위반 시 certified 금지 · pending KPI 금지 · sample<50 금지 · critical regression 금지 · Evidence 필수. 모든 판정은 사람 사유 필수." />
          {!selObs ? <AdminEmpty icon={<Award size={20} />} title="Observation 선택 필요" /> : (
            <>
              {certPreview && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground">순수 로직 미리보기:</span>
                  <AdminBadge tone={CERT_TONE[certPreview.result]}>{CERT_LABEL[certPreview.result]}</AdminBadge>
                  <span className="text-[10px] text-muted-foreground">{certPreview.reasons.join(' · ')}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Primary KPI" value={logicRows.some((r) => r.metricRole === 'primary') ? (logicRows.filter((r) => r.metricRole === 'primary').every((r) => ['improved', 'stable'].includes(r.validationStatus)) ? '통과' : '미통과') : 'insufficient_data'} />
                <Box label="Guardrail" value={logicRows.some((r) => r.metricRole === 'guardrail' && ['failed', 'degraded'].includes(r.validationStatus)) ? '위반' : logicRows.length ? '정상' : '—'} />
                <Box label="Sample" value={VAL(metrics[0]?.sample_size ?? null)} />
                <Box label="Regressions" value={`${regressions.length} (critical ${regressions.filter((r) => r.severity === 'critical').length})`} />
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Certification 사유(필수 — 자동 인증 없음)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Certification 사유" />
              <div className="flex flex-wrap gap-1.5">
                <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updatePostChangeReview(selObs.id, 'status_review', {}, r), 'Certification Review 시작'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Certification Review 시작</button>
                {(['certified', 'certified_with_conditions', 'not_certified', 'rollback_recommended', 'insufficient_data', 'invalidated'] as const).map((res) => (
                  <button key={res} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => certifyPostChangeObservation(selObs.id, res, r), `판정: ${CERT_LABEL[res]}`); setReason(''); }}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${res === 'certified' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{res === 'insufficient_data' ? '추가 관측' : CERT_LABEL[res]}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Outcome Evidence ── */}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Certification Package (Learning Evidence)" description="Simulation/Prediction/Actual 을 분리 표기합니다. 자동 Weight/Memory/Pattern/Trust 변경 없음 — 참고 Evidence 만 제공합니다." />
          {!selObs ? <AdminEmpty icon={<FileSearch size={20} />} title="Observation 선택 필요" /> : (
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {buildCertificationPackage(selObs as unknown as ObservationLike, logicRows).map((p) => (
                <div key={p.section} className="rounded-lg border border-border p-2">
                  <p className="text-[10px] font-bold text-muted-foreground">{p.section}</p>
                  <p className="mt-0.5 break-all text-[11px]">{typeof p.content === 'string' ? p.content : JSON.stringify(p.content).slice(0, 240)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Observation/검증/권고/인증 이벤트 기록입니다 — 실제 Deploy/Rollback 실행 로그가 아닙니다." />
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : (
            audit.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
                <AdminBadge tone={a.event_type.includes('rejected') || a.event_type.includes('rollback_requested') ? 'danger' : a.event_type.startsWith('certified') ? 'success' : 'neutral'}>{a.event_type}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{(a.detail ?? '').slice(0, 80)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {PCO_SUPPORT.map((s) => (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                    <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">KPI</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {SUPPORTED_METRICS.map((m) => (
                  <tr key={m.code} className="border-b border-border/50"><td className="py-1.5 pr-2 font-semibold">{m.label}</td><td className="px-2"><AdminBadge tone="success">supported(actual)</AdminBadge></td><td className="px-2 text-[10px] text-muted-foreground">{m.note}</td></tr>
                ))}
                {UNSUPPORTED_METRICS.map((m) => (
                  <tr key={m.code} className="border-b border-border/50"><td className="py-1.5 pr-2 font-semibold">{m.code}</td><td className="px-2"><AdminBadge tone="danger">unsupported</AdminBadge></td><td className="px-2 text-[10px] text-muted-foreground">{m.note}</td></tr>
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
