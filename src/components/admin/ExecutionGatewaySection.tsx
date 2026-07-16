/**
 * ExecutionGatewaySection — Enterprise AI Runtime Readiness, Controlled Execution Gateway &
 * Human-Approved Automation Center (Phase AI-OPS-32).
 *
 * Governed AI Proposal→Human Approval→Execution Request→Permission/Scope Validation→
 * Dry Run/Sandbox→Controlled External Action→Evidence→Observation→Human Closure.
 * Proposal ≠ Approval · Approval ≠ Execution · Dry Run ≠ Real Execution ·
 * External Reference ≠ Verified Result · HTTP Success ≠ Business Success · Closure ≠ Outcome Success.
 * 자동 실행/승인/재시도/Rollback/Connector 호출 없음 — production mode 미지원.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardList, Clock, FlaskConical, GitBranch,
  Grid3x3, History, Layers, Lightbulb, ListChecks, Lock, Plug, RefreshCw, Scale,
  ScrollText, Shield, Undo2, XCircle,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecutionGatewaySummary, fetchExecutionRequests, createExecutionRequest,
  reviewExecutionRequest, fetchExecutionCapabilities, recordExecutionCapability,
  recordExecutionEvent, fetchExecutionGatewayAudit,
  type ExecutionGatewaySummary, type ExecutionRequestRow, type ExecutionCapabilityRow, type ExecutionGatewayEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateRuntimeReadiness, evaluateExecutionGate, evaluateSandboxReadiness,
  evaluateTimeoutCancellation, buildExecutionRecommendation, buildExecutionTimeline,
  EXECUTION_DOMAINS, EXECUTION_MODES, CONNECTOR_REGISTRY, EXECUTION_GATEWAY_SUPPORT,
} from '@/lib/executionGateway';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'readiness' | 'requests' | 'pendingapprovals' | 'approved' | 'capabilities' | 'connectors'
  | 'permission' | 'scope' | 'risk' | 'dryruns' | 'sandbox' | 'gate' | 'external' | 'evidence' | 'retry'
  | 'timeout' | 'cancellation' | 'rollback' | 'observation' | 'unexpected' | 'closure' | 'recommendations'
  | 'humanreviews' | 'timeline' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'readiness', label: 'Runtime Readiness', icon: Activity },
  { key: 'requests', label: 'Execution Requests', icon: ClipboardList },
  { key: 'pendingapprovals', label: 'Pending Approvals', icon: Scale },
  { key: 'approved', label: 'Approved References', icon: CheckCircle2 },
  { key: 'capabilities', label: 'Capabilities', icon: ListChecks },
  { key: 'connectors', label: 'Connectors', icon: Plug },
  { key: 'permission', label: 'Permission Validation', icon: Shield },
  { key: 'scope', label: 'Scope Validation', icon: Shield },
  { key: 'risk', label: 'Execution Risk', icon: AlertTriangle },
  { key: 'dryruns', label: 'Dry Runs', icon: FlaskConical },
  { key: 'sandbox', label: 'Sandbox', icon: FlaskConical },
  { key: 'gate', label: 'Execution Gate', icon: Lock },
  { key: 'external', label: 'External Actions', icon: GitBranch },
  { key: 'evidence', label: 'Result Evidence', icon: ScrollText },
  { key: 'retry', label: 'Retry Safety', icon: RefreshCw },
  { key: 'timeout', label: 'Timeout', icon: Clock },
  { key: 'cancellation', label: 'Cancellation', icon: XCircle },
  { key: 'rollback', label: 'Rollback Readiness', icon: Undo2 },
  { key: 'observation', label: 'Post-Execution Observation', icon: Activity },
  { key: 'unexpected', label: 'Unexpected Effects', icon: AlertTriangle },
  { key: 'closure', label: 'Human Closure', icon: Scale },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'timeline', label: 'Execution Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ExecutionGatewaySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ExecutionGatewaySummary>({});
  const [requests, setRequests] = useState<ExecutionRequestRow[]>([]);
  const [caps, setCaps] = useState<ExecutionCapabilityRow[]>([]);
  const [audit, setAudit] = useState<ExecutionGatewayEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selReq, setSelReq] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDomain, setNewDomain] = useState<string>('report_generation');
  const [newMode, setNewMode] = useState<string>('reference_only');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, rq, cp, au] = await Promise.all([
        fetchExecutionGatewaySummary(), fetchExecutionRequests(null, 200),
        fetchExecutionCapabilities(200), fetchExecutionGatewayAudit(200),
      ]);
      setSummary(s); setRequests(rq); setCaps(cp); setAudit(au);
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
  const needSel = (): ExecutionRequestRow | null => {
    const r = requests.find((x) => x.id === selReq);
    if (!r) { toast.error('Execution Request 선택 필수'); return null; }
    return r;
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const readiness = useMemo(() => evaluateRuntimeReadiness([
    { key: 'edge_functions', available: true, note: 'dispatch-emails/kakao/push/PDF 등 20종 코드 실측 — 게이트에서 자동 호출하지 않음' },
    { key: 'human_approval_source_0534', available: true, note: 'oversight_approved 이벤트 실존 검증 연결' },
    { key: 'observation_source_0506', available: true, note: 'ai_post_change_observations 읽기 전용 연결' },
    { key: 'agent_runtime', available: false, note: 'Agent 실행 런타임 없음' },
    { key: 'runtime_scheduler', available: false, note: '범용 Scheduler 없음(process-scheduled-releases 는 별개 용도)' },
    { key: 'worker_queue', available: false, note: 'Worker/Queue 없음' },
    { key: 'generic_connector_registry', available: false, note: '범용 Connector Registry 없음 — Capability 는 사람 기록' },
    { key: 'sandbox_environment', available: null, note: '실제 Sandbox 환경 미확인(unknown 유지)' },
  ]), []);

  const sel = useMemo(() => requests.find((r) => r.id === selReq) ?? null, [requests, selReq]);
  const selEvents = useMemo(() => audit.filter((e) => e.execution_request_id === selReq), [audit, selReq]);
  const selGate = useMemo(() => {
    if (!sel) return null;
    const has = (t: string, key?: string, val?: string) => selEvents.some((e) => e.event_type === t && (!key || String(e.payload?.[key] ?? '') === val));
    return evaluateExecutionGate({
      approvalLinked: sel.approval_reference_id != null,
      permissionVerified: has('permission_validated', 'result', 'permission_verified_reference'),
      scopeVerified: has('scope_validated', 'result', 'scope_verified_reference'),
      riskLevel: sel.risk_level,
      dryRunRequired: sel.dry_run_required,
      dryRunPassed: selEvents.some((e) => e.event_type === 'dry_run_completed_reference' && ['passed_reference', 'warning_reference'].includes(String(e.payload?.dry_run_status ?? ''))),
      sandboxRequired: sel.sandbox_required,
      sandboxReady: has('sandbox_validated'),
      observationPlanDefined: sel.observation_required,   // 계획 필드 존재 여부(계획 ≠ 수행)
      rollbackRequired: sel.rollback_required,
      rollbackReady: ['rollback_ready_reference', 'partially_ready'].includes(sel.reversibility_status),
    });
  }, [sel, selEvents]);

  const sandbox = useMemo(() => evaluateSandboxReadiness({ environmentExists: null, isolationVerified: null, credentialIsolated: null, cleanupDefined: null }), []);   // 실제 Sandbox 환경 미확인 — 정직 유지

  const timeline = useMemo(() => buildExecutionTimeline([
    { stage: 'request', count: num('requests', 'total'), source: 'requests 실측' },
    { stage: 'approval', count: num('requests', 'approved_reference'), source: 'approved_reference 실측' },
    { stage: 'validation', count: (num('gateway_events', 'permission_validated') ?? 0) + (num('gateway_events', 'scope_validated') ?? 0), source: 'permission/scope 이벤트 실측' },
    { stage: 'dry_run', count: num('gateway_events', 'dry_runs_completed'), source: 'dry_run_completed 실측' },
    { stage: 'gate', count: num('requests', 'ready'), source: 'ready_for_controlled_execution 실측' },
    { stage: 'external_action', count: num('gateway_events', 'external_actions'), source: 'external_action_recorded 실측' },
    { stage: 'evidence', count: num('gateway_events', 'results_reported'), source: 'execution_result_reported 실측' },
    { stage: 'observation', count: num('requests', 'observation_pending'), source: 'observation_pending 실측' },
    { stage: 'closure', count: num('requests', 'closed_reference'), source: 'closed_reference 실측' },
  ]), [num]);

  const recommendations = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildExecutionRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const missing = num('requests', 'approval_missing');
    if (missing != null && missing > 0) push(buildExecutionRecommendation({ type: 'request_human_approval', reason: `승인 Reference 없는 Request ${missing}건 — 사람 승인 필요(approval_missing)`, evidence: ['requests 실측'], confidence: null }));
    const riskUnv = num('requests', 'risk_unverified');
    if (riskUnv != null && riskUnv > 0) push(buildExecutionRecommendation({ type: 'review_execution_risk', reason: `Risk 미검증 Request ${riskUnv}건 — 평가 전 게이트 진입 불가`, evidence: ['risk_unverified 실측'], confidence: null }));
    const rbUnv = num('requests', 'rollback_unverified');
    if (rbUnv != null && rbUnv > 0) push(buildExecutionRecommendation({ type: 'prepare_rollback_reference', reason: `Rollback 미검증 Request ${rbUnv}건 — Rollback Plan ≠ Rollback Success`, evidence: ['reversibility 실측'], confidence: null }));
    const reported = num('requests', 'execution_reported');
    if (reported != null && reported > 0) push(buildExecutionRecommendation({ type: 'verify_external_result', reason: `External Action 보고 ${reported}건 — Reference ≠ Verified Result, 결과 검증 필요`, evidence: ['execution_reported 실측'], confidence: null }));
    const obsPending = num('requests', 'observation_pending');
    if (obsPending != null && obsPending > 0) push(buildExecutionRecommendation({ type: 'prepare_observation_plan', reason: `Observation 대기 ${obsPending}건 — Observation ≠ Causality`, evidence: ['observation_pending 실측'], confidence: null }));
    const unexpected = num('gateway_events', 'unexpected_effects');
    if (unexpected != null && unexpected > 0) push(buildExecutionRecommendation({ type: 'review_unexpected_effect', reason: `Unexpected Effect 후보 ${unexpected}건 — 사람 검토 필요`, evidence: ['unexpected_effect 실측'], confidence: null }));
    return out;
  }, [num]);

  const evtRecord = (kind: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const s = needSel();
    if (!r || !s) return;
    void act(() => recordExecutionEvent(kind, s.id, r, payload), ok);
  };

  if (loading) return <AdminCard title="Enterprise AI Runtime Readiness & Controlled Execution Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise AI Runtime Readiness & Controlled Execution Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const reqSelect = (
    <select value={selReq} onChange={(e) => setSelReq(e.target.value)} className="min-w-[220px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Execution Request 선택</option>
      {requests.map((r) => <option key={r.id} value={r.id}>{r.execution_code} · {r.title.slice(0, 40)} · {r.execution_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );

  return (
    <AdminCard
      title="Enterprise AI Runtime Readiness & Controlled Execution Center"
      subtitle="Proposal→Human Approval→Request→Permission/Scope→Dry Run→Gate→External Reference→Evidence→Observation→Human Closure — 자동 실행 없음·production mode 미지원"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Execution Request/승인/Connector 실행/외부 API 호출/이메일·메시지 발송/Ticket·Issue·PR 생성/Merge/Deploy/Migration Apply/결제/환불/계약·가격·권한·정책 변경/데이터 삭제/Secret 변경은 없습니다. 이 게이트는 Reference 기록/검증 계층이며 실제 외부 작업은 항상 사람이 수행하고 그 결과를 Evidence 로 기록합니다. Proposal ≠ Approval, Approval ≠ Execution, Dry Run ≠ Real Execution, External Reference ≠ Verified Result, HTTP Success ≠ Business Success, Closure ≠ Outcome Success." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Total Requests" value={NUM(num('requests', 'total'))} />
            <Box label="Approval Missing" value={NUM(num('requests', 'approval_missing'))} />
            <Box label="Approved References" value={NUM(num('requests', 'approved_reference'))} />
            <Box label="Gate Ready" value={NUM(num('requests', 'ready'))} />
            <Box label="External Actions" value={NUM(num('gateway_events', 'external_actions'))} />
            <Box label="Results Reported" value={NUM(num('gateway_events', 'results_reported'))} />
            <Box label="Observation Pending" value={NUM(num('requests', 'observation_pending'))} />
            <Box label="Closed References" value={NUM(num('requests', 'closed_reference'))} />
            <Box label="Risk Unverified" value={NUM(num('requests', 'risk_unverified'))} />
            <Box label="Rollback Unverified" value={NUM(num('requests', 'rollback_unverified'))} />
            <Box label="Capabilities" value={NUM(num('capabilities', 'total'))} />
            <Box label="Unexpected Effects" value={NUM(num('gateway_events', 'unexpected_effects'))} />
          </div>
          <AdminAlert tone="info" description={`runtime_unavailable: ${Array.isArray(summary.runtime_unavailable) ? (summary.runtime_unavailable as unknown[]).map(String).join(', ') : '—'} — Agent Runtime/Scheduler/Worker Queue/범용 Connector Registry/Sandbox 환경 없음(실측). 기존 실측: 0505 plans ${NUM(num('execution_actuals', 'execution_plans_0505'))} · 0520 commitments ${NUM(num('execution_actuals', 'commitments_0520'))} · 0506 observations ${NUM(num('execution_actuals', 'observations_0506'))} · 0534 승인 ${NUM(num('execution_actuals', 'oversight_approvals_0534'))}`} />
        </div>
      )}

      {tab === 'readiness' && (
        <div className="space-y-1">
          {readiness.rows.map((r) => (
            <div key={r.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.key}</span>
              <AdminBadge tone={r.status === 'available_reference' ? 'success' : r.status === 'unknown' ? 'neutral' : 'danger'}>{r.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{r.note}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">verdict: {readiness.verdict} · readinessIsNotExecution=true — Readiness 는 실행 능력 보유를 의미하지 않습니다.</p>
        </div>
      )}

      {tab === 'requests' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={newDomain} onChange={(e) => setNewDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXECUTION_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={newMode} onChange={(e) => setNewMode(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXECUTION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Request 제목(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            {btn('Request 생성(draft — 실행 아님)', () => {
              if (!newTitle.trim()) { toast.error('제목 필수'); return; }
              void act(() => createExecutionRequest({ title: newTitle.trim(), execution_domain: newDomain, execution_mode: newMode }), 'Request 생성(Request ≠ Execution)');
            }, true)}
          </div>
          {!requests.length ? <AdminEmpty title="Execution Request 없음" description="Request 는 실행이 아니라 검증/게이트 대상 기록입니다." /> : (
            <div className="space-y-1">
              {requests.slice(0, 30).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{r.execution_code}</span>
                  <span className="ml-2">{r.title}</span>
                  <AdminBadge tone={r.execution_status === 'ready_for_controlled_execution' ? 'success' : ['rejected', 'cancelled', 'invalidated'].includes(r.execution_status) ? 'danger' : 'info'}>{r.execution_status}</AdminBadge>
                  <AdminBadge tone="neutral">{r.execution_domain}</AdminBadge>
                  <AdminBadge tone={['high', 'critical'].includes(r.risk_level) ? 'danger' : r.risk_level === 'risk_unverified' ? 'warning' : 'neutral'}>{r.risk_level}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{r.approval_reference_id ? 'approval_linked' : 'approval_missing'} · {r.execution_mode}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Review 시작', () => { const r = needReason(); const s = needSel(); if (!r || !s) return; void act(() => reviewExecutionRequest(s.id, 'start_review', r), 'Review 시작'); })}
            {btn('기각', () => { const r = needReason(); const s = needSel(); if (!r || !s) return; void act(() => reviewExecutionRequest(s.id, 'reject', r), '기각(사람 결정)'); })}
            {btn('무효화', () => { const r = needReason(); const s = needSel(); if (!r || !s) return; void act(() => reviewExecutionRequest(s.id, 'invalidate', r), '무효화'); })}
          </div>
        </div>
      )}

      {tab === 'pendingapprovals' && (
        <div className="space-y-2">
          {requests.filter((r) => !r.approval_reference_id && !['rejected', 'cancelled', 'invalidated', 'closed_reference'].includes(r.execution_status)).map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{r.execution_code}</span><span className="ml-2">{r.title}</span>
              <AdminBadge tone="warning">approval_missing</AdminBadge>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}
            <input value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} placeholder="0534 oversight_approved 이벤트 ID(필수)" className="min-w-[240px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            {reasonInput}
            {btn('Approval Reference 연결(사람 승인 실존 검증)', () => {
              const r = needReason(); const s = needSel();
              if (!r || !s) return;
              if (!approvalRef.trim()) { toast.error('approval_reference_id 필수'); return; }
              void act(() => reviewExecutionRequest(s.id, 'link_approval', r, { approval_reference_id: approvalRef.trim() }), 'Approval 연결(Approval ≠ Execution)');
            }, true)}
          </div>
          <p className="text-[10px] text-muted-foreground">0534 oversight_approved 실존 이벤트만 인정 — AI 승인/임의 ID 는 서버에서 거부됩니다.</p>
        </div>
      )}

      {tab === 'approved' && (() => {
        const approved = requests.filter((r) => r.approval_reference_id != null);
        return !approved.length ? <AdminEmpty title="Approved Reference 없음" description="Approval 은 항상 사람이며 approved_reference 는 실행 완료가 아닙니다." /> : (
          <div className="space-y-1">
            {approved.slice(0, 30).map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.execution_code}</span><span className="ml-2">{r.title}</span>
                <AdminBadge tone="info">{r.execution_status}</AdminBadge>
                <span className="ml-2 font-mono text-muted-foreground">approval: {r.approval_reference_id?.slice(0, 8)}… · Approval ≠ Execution</span>
              </div>
            ))}
          </div>
        );
      })()}

      {tab === 'capabilities' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {btn('실측 Capability 4종 기록(사람)', () => {
              void act(async () => {
                await recordExecutionCapability({ capability_code: 'email_draft_resend', capability_domain: 'email_draft', connector_type: 'email_dispatch', execution_mode: 'draft_only', status: 'available_reference', idempotency_key: 'cap-email-draft-resend', limitations: ['자동 발송 없음 — Draft/사람 승인 흐름만'] });
                await recordExecutionCapability({ capability_code: 'report_generation_pdf', capability_domain: 'report_generation', connector_type: 'pdf_generation', execution_mode: 'reference_only', status: 'available_reference', idempotency_key: 'cap-report-pdf', limitations: ['게이트에서 자동 호출 없음'] });
                await recordExecutionCapability({ capability_code: 'evidence_collection_manual', capability_domain: 'evidence_collection', connector_type: 'manual', execution_mode: 'manual_external_reference', status: 'available_reference', idempotency_key: 'cap-evidence-manual', limitations: ['사람 수집 Reference'] });
                await recordExecutionCapability({ capability_code: 'validation_check_readonly', capability_domain: 'validation_check', connector_type: 'db_admin_function', execution_mode: 'read_only', status: 'available_reference', idempotency_key: 'cap-validation-ro', limitations: ['읽기 전용'] });
              }, 'Capability 기록(Connector 실존과 별개)');
            }, true)}
          </div>
          {!caps.length ? <AdminEmpty title="Capability 없음" description="Capability 는 사람이 기록하며 Connector 실존과 동일하지 않습니다." /> : (
            <div className="space-y-1">
              {caps.slice(0, 30).map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{c.capability_code}</span>
                  <AdminBadge tone={c.status === 'available_reference' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'}>{c.status}</AdminBadge>
                  <AdminBadge tone="neutral">{c.connector_type}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{c.capability_domain} · {c.execution_mode} · timeout {c.timeout_seconds}s · retry≤{c.retry_limit} · 사람 승인 필수</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'connectors' && (
        <div className="space-y-1">
          {CONNECTOR_REGISTRY.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={c.status === 'available_reference' ? 'success' : c.status === 'disabled' ? 'danger' : 'warning'}>{c.status}</AdminBadge>
              <span className="ml-2 font-bold">{c.key}</span>
              <span className="ml-2 text-muted-foreground">{c.note}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">코드 실측(빌드 시점) 기준 — 어떤 Connector 도 이 게이트에서 자동 호출되지 않습니다.</p>
        </div>
      )}

      {tab === 'permission' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Permission 검증 기록(verified)', () => evtRecord('permission_validated', { result: 'permission_verified_reference', evidence: [reason.trim()] }, 'Permission 검증 기록'), true)}
            {btn('미검증 기록', () => evtRecord('permission_validated', { result: 'permission_unverified' }, 'permission_unverified 기록'))}
            {btn('Secret Scope 차단 기록', () => evtRecord('permission_validated', { result: 'secret_scope_detected' }, 'Secret Scope 차단'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Admin Guard/Scope 소유권/2차 승인/민감·Secret Scope 검토 — Secret 은 직접 노출하지 않습니다.</p>
        </div>
      )}
      {tab === 'scope' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Scope 검증 기록(verified)', () => evtRecord('scope_validated', { result: 'scope_verified_reference', evidence: [reason.trim()] }, 'Scope 검증 기록'), true)}
            {btn('불일치 기록', () => evtRecord('scope_validated', { result: 'scope_mismatch' }, 'scope_mismatch 기록'))}
            {btn('Production Scope 차단 기록', () => evtRecord('scope_validated', { result: 'production_scope_blocked' }, 'Production Scope 차단'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Cross-Enterprise/Brand/Store 차단 · Production Scope 차단 — 승인 Scope 와 요청 Scope 일치 필수.</p>
        </div>
      )}
      {tab === 'risk' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Risk 평가: low', () => evtRecord('execution_risk_evaluated', { risk_level: 'low', evidence: [reason.trim()] }, 'Risk 평가 기록'), true)}
            {btn('moderate', () => evtRecord('execution_risk_evaluated', { risk_level: 'moderate', evidence: [reason.trim()] }, 'Risk 평가 기록'))}
            {btn('high(게이트 차단)', () => evtRecord('execution_risk_evaluated', { risk_level: 'high', evidence: [reason.trim()] }, 'Risk 평가 기록 — high 는 Controlled 대상 아님'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Critical/High 는 Controlled Execution 대상이 아닙니다(서버 게이트 차단) · Risk ≠ Failure.</p>
        </div>
      )}

      {tab === 'dryruns' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Dry Run passed 기록(Evidence 필수)', () => evtRecord('dry_run_completed_reference', { dry_run_status: 'passed_reference', evidence: [reason.trim()] }, 'Dry Run 기록(≠ Real Execution)'), true)}
            {btn('blocked 기록', () => evtRecord('dry_run_completed_reference', { dry_run_status: 'blocked_reference' }, 'Dry Run blocked 기록'))}
            {btn('failed 기록', () => evtRecord('dry_run_completed_reference', { dry_run_status: 'failed_reference' }, 'Dry Run failed 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">실행하지 않은 Dry Run 을 passed 로 표시하지 않습니다 — Evidence 없는 passed 는 서버에서 거부됩니다.</p>
        </div>
      )}
      {tab === 'sandbox' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <span className="font-bold">Sandbox Readiness</span>
            <AdminBadge tone="warning">{sandbox.result}</AdminBadge>
            <span className="ml-2 text-muted-foreground">실제 Sandbox 환경/Test Account/격리 미확인 — unknown 유지(가짜 ready 없음)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Sandbox 검토 기록', () => evtRecord('sandbox_validated', { result: 'sandbox_unavailable', evidence: [reason.trim()] }, 'Sandbox 검토 기록'))}
          </div>
        </div>
      )}

      {tab === 'gate' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{reqSelect}{reasonInput}
            {btn('Gate Review(ready 승격 — 서버 게이트 검증)', () => { const r = needReason(); const s = needSel(); if (!r || !s) return; void act(() => reviewExecutionRequest(s.id, 'mark_ready', r, { risk_level: s.risk_level }), 'Gate ready(ready ≠ executed)'); }, true)}
          </div>
          {selGate ? (
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={selGate.result === 'gate_ready_reference' ? 'success' : 'danger'}>{selGate.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{selGate.blockers.length ? `blockers: ${selGate.blockers.join(', ')}` : '13조건 충족(클라 검증) — 서버 게이트가 최종 판정'}</span>
            </div>
          ) : <AdminEmpty title="Request 미선택" description="게이트 상태는 선택된 Request 의 이벤트 실측으로 계산됩니다." />}
          <p className="text-[10px] text-muted-foreground">승인+Permission+Scope+(필요 시 Dry Run)+Risk 허용 범위 — 하나라도 없으면 서버가 gate_blocked 예외로 차단 · gateReadyIsNotExecuted=true</p>
        </div>
      )}

      {tab === 'external' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('External Action Reference 기록(사람 수행 결과)', () => evtRecord('external_action_recorded', { evidence: [reason.trim()], external_reference_id: 'manual', external_system: 'manual_external' }, 'External Reference 기록(≠ Verified Result)'), true)}
          </div>
          {(() => {
            const ext = audit.filter((e) => e.event_type === 'external_action_recorded');
            return !ext.length ? <AdminEmpty title="External Action 없음" description="ready 상태 Request 에만 기록 가능 — Connector 자동 실행은 없습니다." /> : (
              <div className="space-y-1">{ext.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('실행 결과 보고(Evidence 필수)', () => evtRecord('execution_result_reported', { evidence: [reason.trim()] }, '결과 보고(HTTP ≠ Business Success)'), true)}
            {btn('결과 Evidence 검토 기록', () => evtRecord('result_evidence_reviewed', { result: 'evidence_partial', evidence: [reason.trim()] }, 'Evidence 검토 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Connector Response ≠ Trusted Evidence · Side Effect 검증 없으면 side_effect_unverified.</p>
        </div>
      )}
      {tab === 'retry' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Retry 검토: manual_retry_required', () => evtRecord('retry_reviewed', { result: 'manual_retry_required' }, 'Retry 검토(자동 재시도 없음)'), true)}
            {btn('retry_blocked', () => evtRecord('retry_reviewed', { result: 'retry_blocked' }, 'Retry 차단 기록'))}
            {btn('duplicate_side_effect_risk', () => evtRecord('retry_reviewed', { result: 'duplicate_side_effect_risk' }, '중복 Side Effect 위험 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Retry Success ≠ Correct Outcome — 안전해 보여도 자동 재시도는 없으며 사람 승인이 필요합니다.</p>
        </div>
      )}
      {tab === 'timeout' && (() => {
        const selCap = caps[0] ?? null;
        const t = evaluateTimeoutCancellation({ timeoutSeconds: selCap?.timeout_seconds ?? null, cancellationSupported: selCap ? selCap.supports_cancellation : null, partialExecutionPossible: true, cleanupRequired: false });
        return (
          <div className="space-y-1">
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">Timeout Policy{selCap ? `(${selCap.capability_code})` : ''}</span>
              <span className="ml-2">{t.timeoutSeconds == null ? 'null(정의 없음)' : `${t.timeoutSeconds}s (1~600 clamp)`}</span>
              <span className="ml-2 text-muted-foreground">{t.results.join(' · ')}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Timeout 은 정책 정의이며 런타임 강제 장치가 아닙니다(런타임 없음).</p>
          </div>
        );
      })()}
      {tab === 'cancellation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Cancellation Reference 기록', () => evtRecord('cancellation_recorded', { evidence: [reason.trim()] }, 'Cancellation 기록'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">Partial Execution 위험/Cleanup 필요 여부를 함께 검토 — 자동 취소 실행은 없습니다.</p>
        </div>
      )}
      {tab === 'rollback' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Rollback: ready_reference', () => evtRecord('rollback_readiness_reviewed', { result: 'rollback_ready_reference', evidence: [reason.trim()] }, 'Rollback 검토(Plan ≠ Success)'), true)}
            {btn('unverified', () => evtRecord('rollback_readiness_reviewed', { result: 'rollback_unverified' }, 'rollback_unverified 기록'))}
            {btn('irreversible_action', () => evtRecord('rollback_readiness_reviewed', { result: 'irreversible_action' }, '비가역 작업 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Rollback Plan ≠ Rollback Success · 자동 Rollback 실행 없음.</p>
        </div>
      )}

      {tab === 'observation' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Observations(0506 실측)" value={NUM(num('execution_actuals', 'observations_0506'))} />
            <Box label="Reliability Indicators(0507)" value={NUM(num('execution_actuals', 'reliability_indicators_0507'))} />
            <Box label="Open Incidents(0502)" value={NUM(num('execution_actuals', 'incidents_open_0502'))} />
            <Box label="Decision Outcomes(0514)" value={NUM(num('execution_actuals', 'decision_outcomes_0514'))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Observation 시작 Reference', () => evtRecord('observation_started_reference', { evidence: [reason.trim()] }, 'Observation 시작(≠ Causality)'), true)}
            {btn('Observation 완료 Reference', () => evtRecord('observation_completed_reference', { evidence: [reason.trim()] }, 'Observation 완료(Completion ≠ Outcome)'))}
          </div>
        </div>
      )}
      {tab === 'unexpected' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Unexpected Effect 후보 기록', () => evtRecord('unexpected_effect_detected', { evidence: [reason.trim()] }, 'Unexpected Effect 기록(사람 검토 필요)'), true)}
          </div>
          {(() => {
            const ux = audit.filter((e) => e.event_type === 'unexpected_effect_detected');
            return !ux.length ? <AdminEmpty title="Unexpected Effect 없음" description="후보 감지/기록만 — 자동 대응 없음." /> : (
              <div className="space-y-1">{ux.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">unexpected</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'closure' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reqSelect}{reasonInput}
            {btn('Human Closure(closed_reference — 결과 보고 선행 필수)', () => evtRecord('closure_reviewed', { closure: 'closed_reference', evidence: [reason.trim()] }, 'Closure 기록(≠ Outcome Success)'), true)}
            {btn('closed_with_limitation', () => evtRecord('closure_reviewed', { closure: 'closed_with_limitation', evidence: [reason.trim()], limitations: [reason.trim()] }, 'Closure(제한 포함) 기록'))}
            {btn('rejected_closure', () => evtRecord('closure_reviewed', { closure: 'rejected_closure' }, 'Closure 반려'))}
          </div>
          <p className="text-[10px] text-muted-foreground">결과 보고 없는 Closure 는 서버에서 차단 — Human Closure ≠ Business/Outcome Success.</p>
        </div>
      )}

      {tab === 'recommendations' && (
        !recommendations.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다(execution_unverified)." /> : (
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false · Proposal ≠ Approval ≠ Execution</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['execution_request_reviewed', 'approval_reference_linked', 'execution_gate_reviewed', 'result_evidence_reviewed', 'closure_reviewed', 'execution_invalidated'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="승인/게이트/결과/Closure 검토는 전부 사람이 수행합니다." /> : (
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
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'measured' ? 'info' : 'warning'}>{s.stage}</AdminBadge>
              <span className="ml-2">{s.count == null ? 'null(원본 없음)' : NUM(s.count)}</span>
              <span className="ml-2 text-muted-foreground">{s.source} · timelineIsNotCompletionClaim</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Request→Approval→Validation→Dry Run→Gate→External Action→Evidence→Observation→Closure 9단계 실측 집계</p>
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="게이트 활동이 이벤트로 남습니다(22종 whitelist)." /> : (
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
      {tab === 'support' && (
        <div className="space-y-1">
          {EXECUTION_GATEWAY_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
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
