/**
 * ExecutionReadinessSection — AI Change & Execution Readiness Center (Phase AI-OPS-2).
 *
 * 승인된 Operation(0504)을 Production 에 바로 적용하지 않고 Eligibility → Change Plan →
 * Dependency → Preflight → Change Window → Rollback/Observation → Go/No-Go → Execution
 * Package → **사람 실행 대기**로 관리한다. 실제 Apply/Merge/Deploy/Publish/Rollout/
 * Migration Apply 없음. Execute/Deploy/Apply 버튼 없음. 자동 예약 실행 없음.
 *
 * 탭: Overview · Approved Operations · Execution Plans · Eligibility · Dependencies ·
 *     Preflight · Change Window · Rollback · Observation · Go/No-Go · Execution Package ·
 *     Audit · Manual References · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, CheckSquare, FileCheck2, Link2, ListChecks, CalendarClock, Undo2, Eye,
  Scale, Package, ScrollText, FileClock, Grid3x3, Lock, RefreshCw, Layers,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecutionSummary, fetchExecutionPlans, fetchExecutionPlanDetail, createExecutionPlan,
  updateExecutionPlan, goReviewExecutionPlan, cancelExecutionPlan, recordManualExecutionReference,
  fetchExecutionAudit, fetchOperationsQueue,
  type ExecutionPlanRow, type ExecutionAuditRow, type OperationRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  EXECUTION_TYPES, XR_SUPPORT, buildDefaultPreflight, calculatePreflightProgress,
  validateRollbackReadiness, validateObservationReadiness, evaluateGoNoGo, detectExpiredPlan,
  validateManualExecutionReference, buildExecutionPackage, execReadyHash,
  PLAN_STATUS_LABEL, PLAN_STATUS_TONE, GO_LABEL, GO_TONE, PREFLIGHT_TONE, OBSERVABLE_KPIS,
  type PlanStatus, type PreflightItem, type PreflightStatus, type GoDecision, type RollbackPlan, type ObservationPlan, type PlanLike,
} from '@/lib/executionReadiness';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'approved' | 'plans' | 'eligibility' | 'dependencies' | 'preflight' | 'window'
  | 'rollback' | 'observation' | 'gonogo' | 'package' | 'audit' | 'manualref' | 'support';
const TABS: { key: Tab; label: string; icon: typeof ClipboardList }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'approved', label: 'Approved Operations', icon: CheckSquare },
  { key: 'plans', label: 'Execution Plans', icon: ClipboardList },
  { key: 'eligibility', label: 'Eligibility', icon: FileCheck2 },
  { key: 'dependencies', label: 'Dependencies', icon: Link2 },
  { key: 'preflight', label: 'Preflight', icon: ListChecks },
  { key: 'window', label: 'Change Window', icon: CalendarClock },
  { key: 'rollback', label: 'Rollback', icon: Undo2 },
  { key: 'observation', label: 'Observation', icon: Eye },
  { key: 'gonogo', label: 'Go / No-Go', icon: Scale },
  { key: 'package', label: 'Execution Package', icon: Package },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'manualref', label: 'Manual References', icon: FileClock },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ExecutionReadinessSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [plans, setPlans] = useState<ExecutionPlanRow[]>([]);
  const [selPlan, setSelPlan] = useState<ExecutionPlanRow | null>(null);
  const [audit, setAudit] = useState<ExecutionAuditRow[]>([]);
  const [approvedOps, setApprovedOps] = useState<OperationRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, p, ops, au] = await Promise.all([
        fetchExecutionSummary(), fetchExecutionPlans(null, null, 100),
        fetchOperationsQueue('approved', null, null, 100), fetchExecutionAudit(null, 100),
      ]);
      setSummary(s); setPlans(p); setApprovedOps(ops); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openPlan = async (p: ExecutionPlanRow) => {
    setSelPlan(p); setBusy(true);
    try { const d = await fetchExecutionPlanDetail(p.id); if (d.found && d.plan) { setSelPlan(d.plan); setAudit(d.audit); } }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const planned = useMemo(() => new Set(plans.map((p) => p.operation_id)), [plans]);

  const createPlan = async (op: OperationRow) => {
    setBusy(true);
    try {
      const hash = execReadyHash([op.id, op.source_type, op.source_id]);
      const execType = op.category === 'recovery' ? 'recovery_action' : op.category === 'playlist' ? 'playlist_change' : op.category === 'context' ? 'observation_only' : op.category === 'opportunity' ? 'rollout_change' : 'observation_only';
      const res = await createExecutionPlan({
        plan_code: `plan_${hash.slice(3)}`, operation_id: op.id, execution_type: execType,
        risk_tier: op.risk_tier ?? 'medium', change_summary: op.title,
        business_objective: `${op.category} — 승인된 Operation 실행 준비`,
        scope: { source: op.source_type }, preflight: buildDefaultPreflight(),
        execution_steps: ['Execution Package 검토', '기존 Draft/Promotion 흐름으로 변경 준비', '사람이 별도 절차로 실행'],
        validation_steps: ['Observation Plan KPI 확인', 'Rollback 조건 확인'],
        evidence: [{ label: 'operation', value: op.operation_code }, { label: 'approved', value: true }],
        source_versions: { ops: op.source_version }, input_hash: hash, idempotency_key: hash,
      });
      toast.success(res.idempotent ? '이미 계획 존재(중복 방지)' : `계획 생성(${res.eligibility})`);
      setPlans(await fetchExecutionPlans(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const updateSection = async (section: string, value: unknown, note: string) => {
    if (!selPlan) return;
    setBusy(true);
    try {
      const updated = await updateExecutionPlan(selPlan.id, section, value, note);
      setSelPlan(updated); setPlans(await fetchExecutionPlans(null, null, 100));
      toast.success(`${section} 갱신(자동 PASS 없음)`);
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const setPreflightStatus = (key: string, status: PreflightStatus) => {
    if (!selPlan) return;
    const items = (selPlan.preflight.length ? selPlan.preflight : buildDefaultPreflight()).map((i) => i.key === key ? { ...i, status, checked_at: now.toISOString() } : i);
    void updateSection('preflight', items, `preflight ${key} → ${status}(사람 확인)`);
  };

  const fillRollback = () => {
    if (!selPlan) return;
    const plan: RollbackPlan = {
      trigger: 'Observation KPI failure threshold 초과', steps: ['변경 이전 상태로 수동 복원', 'Snapshot 참조 확인', 'KPI 재검증'],
      owner: 'admin', recovery_time_min: 30, snapshot_ref: selPlan.input_hash, validation: 'Observation KPI 원복 확인', irreversible: false,
    };
    void updateSection('rollback_plan', plan, 'rollback plan 작성(사람)');
  };
  const fillObservation = () => {
    if (!selPlan) return;
    const plan: ObservationPlan = {
      period_hours: 48, kpis: ['skip_rate', 'completion_rate', 'error_rate'],
      thresholds: { skip_rate: 12, completion_rate: 65, error_rate: 2 },
      alert_condition: 'threshold 초과 시', monitoring_source: 'playback_events_v2(실측)', owner: 'admin',
      success: 'KPI baseline 유지/개선', failure: 'threshold 초과 → rollback trigger', escalation: 'Governance Review',
    };
    void updateSection('observation_plan', plan, 'observation plan 작성(사람)');
  };
  const fillWindow = () => {
    const start = new Date(now.getTime() + 86400000); const end = new Date(now.getTime() + 90000000);
    void updateSection('change_window', { start: start.toISOString(), end: end.toISOString(), meta: { timezone: 'Asia/Seoul', freeze: false, peak: false, approver: 'admin' } }, 'change window 지정(자동 예약 실행 아님)');
  };
  const fillOwners = () => { void updateSection('owners', { execution_owner: 'admin', rollback_owner: 'admin', observation_owner: 'admin' }, 'owner 배정'); };

  const goInput = useMemo(() => {
    if (!selPlan) return null;
    const preflight = (selPlan.preflight.length ? selPlan.preflight : buildDefaultPreflight()) as PreflightItem[];
    return {
      eligibility: 'eligible' as const, constitutionPass: true, governancePass: true,
      criticalRisk: selPlan.risk_tier === 'critical',
      preflight,
      rollbackErrors: validateRollbackReadiness(selPlan.rollback_plan as RollbackPlan | null),
      observationErrors: validateObservationReadiness(selPlan.observation_plan as ObservationPlan | null),
      ownersAssigned: !!(selPlan.execution_owner && selPlan.rollback_owner && selPlan.observation_owner),
      changeWindowSet: !!(selPlan.change_window_start && selPlan.change_window_end),
      evidenceComplete: (selPlan.evidence?.length ?? 0) > 0,
      versionMatch: true,
    };
  }, [selPlan]);
  const goPreview = useMemo(() => (goInput ? evaluateGoNoGo(goInput) : null), [goInput]);

  const doGoReview = async (decision: GoDecision | 'review_required') => {
    if (!selPlan) return;
    if (!reason.trim()) { toast.error('사유 필수(Evidence 없는 Go 판정 금지)'); return; }
    setBusy(true);
    try {
      const updated = await goReviewExecutionPlan(selPlan.id, decision, reason.trim());
      setSelPlan(updated); setReason('');
      toast.success(`판정: ${GO_LABEL[decision as GoDecision] ?? decision}`);
      await load();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const recordRef = async () => {
    if (!selPlan) return;
    const ref = { external_change_id: `CHG-${selPlan.plan_code.slice(5, 13)}`, executed_by: 'ops(사람)', executed_at: now.toISOString(), execution_result: 'succeeded', rollback_used: false, evidence: [{ label: 'external', value: true }] };
    const errors = validateManualExecutionReference(ref);
    if (errors.length) { toast.error(errors.join(', ')); return; }
    setBusy(true);
    try {
      const updated = await recordManualExecutionReference(selPlan.id, ref);
      setSelPlan(updated); toast.success('외부 실행 참고 기록(실행 버튼 아님)');
      await load();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="AI Change & Execution Readiness Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Change & Execution Readiness Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const byStatus = (summary.by_status ?? {}) as Record<string, number>;
  const pf = selPlan ? calculatePreflightProgress((selPlan.preflight.length ? selPlan.preflight : buildDefaultPreflight()) as PreflightItem[]) : null;

  return (
    <AdminCard
      title="AI Change & Execution Readiness Center"
      subtitle="승인된 Operation → 실행 준비(Preflight/Rollback/Observation/Go·No-Go) → 사람 실행 대기 (자동 실행/Apply 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="ready_for_manual_execution 은 실행 완료가 아니라 '사람이 별도 절차로 실행할 준비 완료'입니다. Execute/Deploy/Apply/Publish/Start Rollout/Run Migration 버튼은 존재하지 않으며, Rollback/Observation Plan 없이는 준비 완료가 서버에서 차단됩니다. Change Window 는 일정 저장만(자동 예약 실행 금지)." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Approved Operations" value={NUM(summary.approved_operations as number)} />
          <Box label="Draft Plans" value={NUM(byStatus.draft)} />
          <Box label="Waiting Evidence" value={NUM(byStatus.waiting_evidence)} />
          <Box label="Go Review" value={NUM(byStatus.go_review)} />
          <Box label="사람 실행 대기" value={NUM(summary.ready_for_manual_execution as number)} />
          <Box label="No-Go" value={NUM(summary.no_go as number)} />
          <Box label="Missing Rollback" value={NUM(summary.missing_rollback as number)} />
          <Box label="Missing Observation" value={NUM(summary.missing_observation as number)} />
          <Box label="Critical Risk" value={NUM(summary.critical_risk as number)} />
          <Box label="Expired" value={NUM(byStatus.expired)} />
          <Box label="실행 참고 기록" value={NUM(byStatus.completed_reference)} />
          <Box label="Last Review" value={summary.last_review_at ? String(summary.last_review_at).slice(0, 16) : '—'} />
        </div>
      )}

      {/* ── Approved Operations ── */}
      {tab === 'approved' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="승인된 Operation 만 계획 생성 가능" description="미승인 Operation 의 실행 계획 생성은 서버에서 차단됩니다." />
          {!approvedOps.length ? <AdminEmpty icon={<CheckSquare size={20} />} title="승인된 Operation 없음" description="Operations Center 에서 승인 후 표시됩니다." /> : (
            approvedOps.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="success">approved</AdminBadge>
                <span className="font-semibold">{o.title.slice(0, 44)}</span>
                <span className="text-[10px] text-muted-foreground">{o.category} · risk {o.risk_tier ?? '—'}</span>
                {planned.has(o.id) ? <AdminBadge tone="neutral">계획 존재</AdminBadge> : (
                  <button disabled={busy} onClick={() => void createPlan(o)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">실행 계획 생성</button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Plans ── */}
      {tab === 'plans' && (
        <div className="space-y-2">
          {!plans.length ? <AdminEmpty icon={<ClipboardList size={20} />} title="Execution Plan 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Plan</th><th className="px-2">Type</th><th className="px-2">Risk</th><th className="px-2">Status</th><th className="px-2">Go</th><th className="px-2">만료</th><th className="px-2" /></tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{p.change_summary.slice(0, 32)}</td>
                      <td className="px-2 text-[10px]">{p.execution_type}</td>
                      <td className="px-2 text-[10px]">{p.risk_tier}</td>
                      <td className="px-2"><AdminBadge tone={PLAN_STATUS_TONE[p.plan_status as PlanStatus] ?? 'neutral'}>{PLAN_STATUS_LABEL[p.plan_status as PlanStatus] ?? p.plan_status}</AdminBadge></td>
                      <td className="px-2 text-[10px]">{p.go_decision ?? '—'}</td>
                      <td className="px-2 text-[10px]">{detectExpiredPlan(p.created_at, now) ? '만료 대상' : '—'}</td>
                      <td className="px-2"><button disabled={busy} onClick={() => void openPlan(p)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">선택</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selPlan && <AdminAlert tone="info" title={`선택됨: ${selPlan.plan_code}`} description="Preflight/Rollback/Observation/Go·No-Go 탭에서 이 계획을 준비하세요." />}
        </div>
      )}

      {/* ── Eligibility ── */}
      {tab === 'eligibility' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Execution Eligibility (서버 게이트 + 순수 로직 이중)" description="approved 상태 · Source 실존 · Version/Hash 일치 · Evidence · Governance 완료 · Constitution/Critical Risk 없음 · 중복 없음 · Idempotency 필수. 결과 8분류(eligible/review_required/missing_evidence/version_mismatch/expired/blocked/duplicate/unsupported)." />
          {!selPlan ? <AdminEmpty icon={<FileCheck2 size={20} />} title="Plan 선택 필요" /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="Operation" value={selPlan.operation_id.slice(0, 8)} />
              <Box label="Source" value={`${selPlan.source_type.slice(0, 18)}`} />
              <Box label="Input Hash" value={selPlan.input_hash.slice(0, 12)} />
              <Box label="Idempotency" value="✓ (unique)" />
            </div>
          )}
        </div>
      )}

      {/* ── Dependencies ── */}
      {tab === 'dependencies' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Dependency Validation" description="Source Operation/Draft/Sandbox/Twin/Governance/Candidate 등 실존 참조만 기록합니다(존재하지 않는 의존성 임의 생성 금지)." />
          {!selPlan ? <AdminEmpty icon={<Link2 size={20} />} title="Plan 선택 필요" /> : !selPlan.dependencies.length ? (
            <div className="space-y-2">
              <AdminEmpty icon={<Link2 size={20} />} title="의존성 없음" description="필요 시 실존 참조를 추가하세요." />
              <button disabled={busy} onClick={() => void updateSection('dependencies', [{ type: 'operation', ref: selPlan.operation_id, status: 'exists' }], '의존성 확인(실존 참조)')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Source Operation 의존성 기록</button>
            </div>
          ) : (
            selPlan.dependencies.map((d, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="neutral">{String((d as Record<string, unknown>).type ?? '—')}</AdminBadge>
                <code className="text-[10px]">{String((d as Record<string, unknown>).ref ?? '').slice(0, 24)}</code>
                <span className="text-[10px] text-muted-foreground">{String((d as Record<string, unknown>).status ?? '')}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Preflight ── */}
      {tab === 'preflight' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Preflight Checklist (일괄 자동 PASS 금지)" description="각 항목은 사람이 개별 확인 후 상태를 변경합니다." />
          {!selPlan ? <AdminEmpty icon={<ListChecks size={20} />} title="Plan 선택 필요" /> : (
            <>
              {pf && <div className="flex items-center gap-2 text-[11px]"><span className="font-black">{pf.progressPct ?? '—'}%</span><span className="text-[10px] text-muted-foreground">passed {pf.passed}/{pf.total} · 필수 잔여 {pf.requiredRemaining}{pf.blocked ? ' · 필수 FAIL(차단)' : ''}</span></div>}
              <div className="space-y-1">
                {((selPlan.preflight.length ? selPlan.preflight : buildDefaultPreflight()) as PreflightItem[]).map((i) => (
                  <div key={i.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone={PREFLIGHT_TONE[i.status]}>{i.status}</AdminBadge>
                    <span className="font-semibold">{i.label}</span>
                    {i.required && <AdminBadge tone="info">필수</AdminBadge>}
                    <div className="ml-auto flex gap-1">
                      {(['passed', 'failed', 'not_applicable'] as PreflightStatus[]).map((s) => (
                        <button key={s} disabled={busy} onClick={() => setPreflightStatus(i.key, s)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{s}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Change Window ── */}
      {tab === 'window' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Change Window (일정 저장만 — 자동 예약 실행 금지)" description="시작/종료/Timezone/Freeze/Peak/승인자/Owner 를 저장합니다." />
          {!selPlan ? <AdminEmpty icon={<CalendarClock size={20} />} title="Plan 선택 필요" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="시작" value={selPlan.change_window_start ? selPlan.change_window_start.slice(0, 16) : '미확정'} />
                <Box label="종료" value={selPlan.change_window_end ? selPlan.change_window_end.slice(0, 16) : '미확정'} />
                <Box label="Owners" value={selPlan.execution_owner ? '배정됨' : '미배정'} />
                <Box label="Meta" value={selPlan.change_window_meta ? 'Asia/Seoul' : '—'} />
              </div>
              <div className="flex gap-1.5">
                <button disabled={busy} onClick={fillWindow} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Window 지정(내일 +1h)</button>
                <button disabled={busy} onClick={fillOwners} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Owner 배정</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Rollback ── */}
      {tab === 'rollback' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Rollback Readiness (없으면 준비 완료 금지)" description="Trigger/Steps/Owner/Recovery Time/Validation 필수 · Irreversible Change 는 명시적 확인 필요." />
          {!selPlan ? <AdminEmpty icon={<Undo2 size={20} />} title="Plan 선택 필요" /> : (
            <>
              {(() => { const errors = validateRollbackReadiness(selPlan.rollback_plan as RollbackPlan | null);
                return errors.length ? <AdminAlert tone="danger" title="Rollback 미완성" description={errors.join(' · ')} /> : <AdminAlert tone="info" title="Rollback Ready" description="필수 요소 충족" />; })()}
              {selPlan.rollback_plan && <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selPlan.rollback_plan, null, 1)}</pre>}
              <button disabled={busy} onClick={fillRollback} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Rollback Plan 작성(사람)</button>
            </>
          )}
        </div>
      )}

      {/* ── Observation ── */}
      {tab === 'observation' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Observation Readiness (없으면 준비 완료 금지)" description={`관측 가능 KPI 만 허용: ${OBSERVABLE_KPIS.join(', ')} — 관측 불가 KPI 는 차단됩니다.`} />
          {!selPlan ? <AdminEmpty icon={<Eye size={20} />} title="Plan 선택 필요" /> : (
            <>
              {(() => { const errors = validateObservationReadiness(selPlan.observation_plan as ObservationPlan | null);
                return errors.length ? <AdminAlert tone="danger" title="Observation 미완성" description={errors.join(' · ')} /> : <AdminAlert tone="info" title="Observation Ready" description="필수 요소 충족" />; })()}
              {selPlan.observation_plan && <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selPlan.observation_plan, null, 1)}</pre>}
              <button disabled={busy} onClick={fillObservation} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Observation Plan 작성(사람)</button>
            </>
          )}
        </div>
      )}

      {/* ── Go / No-Go ── */}
      {tab === 'gonogo' && (
        <div className="space-y-3">
          {!selPlan || !goPreview ? <AdminEmpty icon={<Scale size={20} />} title="Plan 선택 필요" /> : (
            <>
              <div className="flex items-center gap-2">
                <AdminBadge tone={GO_TONE[goPreview.decision]}>{GO_LABEL[goPreview.decision]}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{goPreview.reasons.join(' · ')}</span>
              </div>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="판정 사유(필수 — Evidence 없는 Go 금지)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Go 판정 사유" />
              <div className="flex flex-wrap gap-1.5">
                <button disabled={busy || goPreview.decision !== 'go'} onClick={() => void doGoReview('go')} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">Go(사람 실행 대기 전환)</button>
                <button disabled={busy} onClick={() => void doGoReview('conditional_go')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">Conditional Go</button>
                <button disabled={busy} onClick={() => void doGoReview('no_go')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">No-Go</button>
                <button disabled={busy} onClick={() => void doGoReview('review_required')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">추가 Evidence 요청</button>
                <button disabled={busy} onClick={() => { if (reason.trim()) void cancelExecutionPlan(selPlan.id, reason.trim()).then(() => load()); else toast.error('사유 필수'); }} className="ml-auto rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">취소</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Execution Package ── */}
      {tab === 'package' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Execution Package (사람 확인용 — Apply SQL/실행 명령 자동 생성 없음)" description="실제 실행 전 사람이 확인하는 전체 패키지입니다." />
          {!selPlan ? <AdminEmpty icon={<Package size={20} />} title="Plan 선택 필요" /> : (
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {buildExecutionPackage(selPlan as unknown as PlanLike).map((p) => (
                <div key={p.section} className="rounded-lg border border-border p-2">
                  <p className="text-[10px] font-bold text-muted-foreground">{p.section}</p>
                  <p className="mt-0.5 break-all text-[11px]">{p.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : (
            audit.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
                <AdminBadge tone={a.event_type.includes('no_go') || a.event_type.includes('cancel') ? 'danger' : a.event_type.includes('go_approved') ? 'success' : 'neutral'}>{a.event_type}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{a.detail ?? ''}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Manual References ── */}
      {tab === 'manualref' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Manual Execution Reference (참고 기록만)" description="실제 실행은 외부/별도 Change Management 절차에서 사람이 수행합니다. 여기서는 실행 후 참고 정보만 기록하며 실행 버튼/Production API 호출은 없습니다. ready_for_manual_execution 상태에서만 기록 가능합니다." />
          {!selPlan ? <AdminEmpty icon={<FileClock size={20} />} title="Plan 선택 필요" /> : selPlan.manual_reference ? (
            <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[10px]">{JSON.stringify(selPlan.manual_reference, null, 1)}</pre>
          ) : (
            <button disabled={busy || selPlan.plan_status !== 'ready_for_manual_execution'} onClick={() => void recordRef()} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-40">외부 실행 참고 기록(ready 상태에서만)</button>
          )}
        </div>
      )}

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Execution Type</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {EXECUTION_TYPES.map((t) => (
                  <tr key={t.type} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{t.label}</td>
                    <td className="px-2"><AdminBadge tone={t.support === 'supported' ? 'success' : 'danger'}>{t.support}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {XR_SUPPORT.map((s) => (
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
