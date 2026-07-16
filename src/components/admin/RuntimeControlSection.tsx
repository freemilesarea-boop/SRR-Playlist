/**
 * RuntimeControlSection — Enterprise Connector Governance, Approved Automation Lifecycle &
 * Supervised Runtime Control Center (Phase AI-OPS-33).
 *
 * Approved Execution Request→Connector Resolution→Automation Definition→Runtime Preconditions→
 * Supervised Session→Checkpoint/Pause/Cancel→Connector Action Evidence→Result Verification→
 * Observation→Human Closure.
 * Connector Registry ≠ Availability ≠ Permission · Approval ≠ Runtime Start ·
 * Runtime Start ≠ Action Completion · HTTP 2xx ≠ Business Success · Closure ≠ Outcome.
 * 자동 Connector 실행/발송/생성/재시도/Cleanup/Rollback/무인 장기 실행 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ClipboardList, Clock, FlaskConical,
  Grid3x3, HeartPulse, History, Layers, Lightbulb, ListChecks, Lock, PauseCircle,
  Plug, RefreshCw, Scale, ScrollText, Shield, Trash2, XCircle,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchRuntimeControlSummary, fetchConnectorDefinitions, recordConnectorDefinition,
  fetchConnectorInstances, recordConnectorInstance, fetchAutomationDefinitions,
  recordAutomationDefinition, fetchRuntimeSessions, reviewRuntimeSession,
  recordRuntimeEvent, fetchRuntimeAudit,
  type RuntimeControlSummary, type ConnectorDefinitionRow, type ConnectorInstanceRow,
  type AutomationDefinitionRow, type RuntimeSessionRow, type RuntimeEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateConnectorInstance, evaluateRuntimePreconditions, buildRuntimeRecommendation,
  buildRuntimeTimeline, RUNTIME_COMPONENTS, RUNTIME_CONTROL_SUPPORT,
} from '@/lib/runtimeControl';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'connectordefs' | 'instances' | 'availability' | 'permissions' | 'scope' | 'health'
  | 'automations' | 'automationreviews' | 'readiness' | 'sessions' | 'pendingstarts' | 'activerefs'
  | 'checkpoints' | 'pause' | 'cancellation' | 'timeouts' | 'attempts' | 'responses' | 'resultverification'
  | 'idempotency' | 'retry' | 'cleanup' | 'observation' | 'unexpected' | 'humanreviews' | 'recommendations'
  | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'connectordefs', label: 'Connector Definitions', icon: Plug },
  { key: 'instances', label: 'Connector Instances', icon: Plug },
  { key: 'availability', label: 'Connector Availability', icon: Activity },
  { key: 'permissions', label: 'Connector Permissions', icon: Shield },
  { key: 'scope', label: 'Connector Scope', icon: Shield },
  { key: 'health', label: 'Connector Health', icon: HeartPulse },
  { key: 'automations', label: 'Automation Definitions', icon: Bot },
  { key: 'automationreviews', label: 'Automation Reviews', icon: Scale },
  { key: 'readiness', label: 'Runtime Readiness', icon: ListChecks },
  { key: 'sessions', label: 'Runtime Sessions', icon: ClipboardList },
  { key: 'pendingstarts', label: 'Pending Runtime Starts', icon: Clock },
  { key: 'activerefs', label: 'Active References', icon: Activity },
  { key: 'checkpoints', label: 'Runtime Checkpoints', icon: History },
  { key: 'pause', label: 'Pause Requests', icon: PauseCircle },
  { key: 'cancellation', label: 'Cancellation Requests', icon: XCircle },
  { key: 'timeouts', label: 'Timeouts', icon: Clock },
  { key: 'attempts', label: 'Action Attempts', icon: FlaskConical },
  { key: 'responses', label: 'Connector Responses', icon: ScrollText },
  { key: 'resultverification', label: 'Result Verification', icon: CheckCircle2 },
  { key: 'idempotency', label: 'Idempotency', icon: Lock },
  { key: 'retry', label: 'Retry Safety', icon: RefreshCw },
  { key: 'cleanup', label: 'Cleanup', icon: Trash2 },
  { key: 'observation', label: 'Runtime Observation', icon: Activity },
  { key: 'unexpected', label: 'Unexpected Effects', icon: AlertTriangle },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'timeline', label: 'Runtime Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: AlertTriangle },
];

const KNOWN_LIMITATIONS = [
  '범용 Agent Runtime/Runtime Scheduler/Worker Queue/Durable Execution 없음',
  '실제 Pause/Cancellation 지원 Connector 제한 — Request/Reference 기록 중심',
  '실제 Sandbox 환경 미확인(unknown 유지)',
  'Connector Credential 자동 검증 없음 — Reference 만 저장(원문 차단)',
  'Gmail/Slack/GitHub/Jira/Linear 자동 실행 없음(연동 자체 없음)',
  '이메일은 Draft 또는 Reference 흐름만(Draft Created ≠ Message Sent)',
  'Connector Action 은 Reference 기록 중심 — 자동 Result Verification 없음',
  '자동 Retry/Cleanup/Rollback 없음 · Observation 자동 Outcome 판정 없음',
  'Human Supervisor/Human Closure 필수 · Production Action/Apply 미지원',
];

export default function RuntimeControlSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<RuntimeControlSummary>({});
  const [defs, setDefs] = useState<ConnectorDefinitionRow[]>([]);
  const [instances, setInstances] = useState<ConnectorInstanceRow[]>([]);
  const [autos, setAutos] = useState<AutomationDefinitionRow[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionRow[]>([]);
  const [audit, setAudit] = useState<RuntimeEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selSess, setSelSess] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, d, ins, au, se, ev] = await Promise.all([
        fetchRuntimeControlSummary(), fetchConnectorDefinitions(200), fetchConnectorInstances(200),
        fetchAutomationDefinitions(200), fetchRuntimeSessions(null, 200), fetchRuntimeAudit(200),
      ]);
      setSummary(s); setDefs(d); setInstances(ins); setAutos(au); setSessions(se); setAudit(ev);
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
  const needSess = (): RuntimeSessionRow | null => {
    const s = sessions.find((x) => x.id === selSess);
    if (!s) { toast.error('Runtime Session 선택 필수'); return null; }
    return s;
  };
  const evtRecord = (kind: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const s = needSess();
    if (!r || !s) return;
    void act(() => recordRuntimeEvent(kind, s.id, r, payload), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const sel = useMemo(() => sessions.find((s) => s.id === selSess) ?? null, [sessions, selSess]);
  const selPre = useMemo(() => {
    if (!sel) return null;
    const pre = sel.runtime_preconditions as Record<string, unknown> | null;
    const inst = instances.find((i) => i.id === sel.connector_instance_id) ?? null;
    const instVerdict = inst ? evaluateConnectorInstance({ connectionStatus: inst.connection_status, permissionStatus: inst.permission_status, scopeStatus: inst.scope_status, credentialReferenced: inst.credential_reference_type !== 'none', environmentScope: inst.environment_scope }).verdict : 'connector_status_unknown';
    const auto = autos.find((a) => a.id === sel.automation_definition_id) ?? null;
    return evaluateRuntimePreconditions({
      approvalLinked: sel.approval_reference_id != null,
      gateReady: sel.gate_reference_id != null,
      automationActive: auto != null && !['disabled', 'invalidated', 'deprecated', 'unsupported'].includes(auto.status),
      connectorAvailable: instVerdict === 'available_reference',
      permissionVerified: inst?.permission_status === 'permission_verified_reference',
      scopeVerified: inst?.scope_status === 'scope_verified_reference',
      environmentAllowed: sel.environment_scope !== 'production',
      dryRunSatisfied: !(auto?.dry_run_required ?? true) || audit.some((e) => e.runtime_session_id === sel.id && e.event_type === 'connector_action_attempt_recorded') === false,   // Dry Run 원본은 0535 이벤트 — 여기서는 요구 플래그 기준 계획만 표시
      sandboxSatisfied: !(auto?.sandbox_required ?? false),
      idempotencyKeyPresent: sel.id != null,
      timeoutDefined: Boolean(pre?.timeout_policy_defined),
      cancellationPolicyDefined: Boolean(pre?.cancellation_policy_defined),
      cleanupPolicyDefined: Boolean(pre?.cleanup_policy_defined),
      evidenceRequirementsDefined: Boolean(pre?.evidence_requirements_defined),
      observationPlanDefined: Boolean(pre?.observation_plan_defined),
      supervisorAssigned: sel.supervised_by != null,
    });
  }, [sel, instances, autos, audit]);

  const timeline = useMemo(() => buildRuntimeTimeline([
    { stage: 'connector', count: num('connectors', 'definitions'), source: 'definitions 실측' },
    { stage: 'automation', count: num('automations', 'total'), source: 'automations 실측' },
    { stage: 'session', count: num('sessions', 'total'), source: 'sessions 실측' },
    { stage: 'preconditions', count: num('sessions', 'ready_reference'), source: 'ready_reference 실측' },
    { stage: 'start', count: num('sessions', 'started_reference'), source: 'started_reference 실측' },
    { stage: 'action', count: num('runtime_events', 'action_attempts'), source: 'action_attempt 실측' },
    { stage: 'response', count: num('runtime_events', 'connector_responses'), source: 'connector_response 실측' },
    { stage: 'observation', count: num('sessions', 'observation_pending'), source: 'observation_pending 실측' },
    { stage: 'closure', count: num('sessions', 'completed_reference'), source: 'completed_reference 실측' },
  ]), [num]);

  const recommendations = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildRuntimeRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const permUnv = num('connectors', 'permission_unverified');
    if (permUnv != null && permUnv > 0) push(buildRuntimeRecommendation({ type: 'validate_connector_permission', reason: `Permission 미검증 Instance ${permUnv}개 — Availability ≠ Permission`, evidence: ['instances 실측'], confidence: null }));
    const credUnv = num('connectors', 'credential_unverified');
    if (credUnv != null && credUnv > 0) push(buildRuntimeRecommendation({ type: 'verify_connector_instance', reason: `Credential Reference 미검증 Instance ${credUnv}개`, evidence: ['instances 실측'], confidence: null }));
    const pendingAuto = num('automations', 'pending_review');
    if (pendingAuto != null && pendingAuto > 0) push(buildRuntimeRecommendation({ type: 'request_automation_review', reason: `검토 대기 Automation ${pendingAuto}건 — 정의 ≠ 승인`, evidence: ['automations 실측'], confidence: null }));
    const draftSess = num('sessions', 'draft');
    if (draftSess != null && draftSess > 0) push(buildRuntimeRecommendation({ type: 'review_runtime_preconditions', reason: `draft Session ${draftSess}건 — Supervisor/정책 정의 없이 ready 불가`, evidence: ['sessions 실측'], confidence: null }));
    const rvp = num('sessions', 'result_verification_pending');
    if (rvp != null && rvp > 0) push(buildRuntimeRecommendation({ type: 'verify_connector_response', reason: `Response 검증 대기 ${rvp}건 — HTTP 2xx ≠ Business Success`, evidence: ['sessions 실측'], confidence: null }));
    const unexpected = num('runtime_events', 'unexpected_effects');
    if (unexpected != null && unexpected > 0) push(buildRuntimeRecommendation({ type: 'review_unexpected_runtime_effect', reason: `Unexpected Runtime Effect 후보 ${unexpected}건 — 사람 검토 필요`, evidence: ['events 실측'], confidence: null }));
    return out;
  }, [num]);

  if (loading) return <AdminCard title="Enterprise Connector Governance & Supervised Runtime Control"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Connector Governance & Supervised Runtime Control">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const sessSelect = (
    <select value={selSess} onChange={(e) => setSelSess(e.target.value)} className="min-w-[220px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Runtime Session 선택</option>
      {sessions.map((s) => <option key={s.id} value={s.id}>{s.runtime_session_code} · {s.session_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const statusTone = (s: string) => (s.includes('unverified') || s.includes('unavailable') || s.includes('unknown') ? 'warning' as const : s.includes('blocked') || s === 'disabled' || s === 'invalidated' ? 'danger' as const : 'info' as const);

  return (
    <AdminCard
      title="Enterprise Connector Governance & Supervised Runtime Control"
      subtitle="Approved Request→Connector Resolution→Automation→Preconditions→Supervised Session→Checkpoint/Pause/Cancel→Evidence→Observation→Human Closure — 자동 Connector 실행 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Connector 실행/이메일·Slack 발송/Ticket·Issue·PR 생성/재시도/Rollback/Cleanup/무인 장기 실행은 없습니다. Runtime Session 은 0535 Gate Ready + 0534 사람 승인 실존 없이 생성될 수 없고, Human Supervisor 지정과 Timeout/Cancellation/Cleanup/Evidence/Observation 정책 정의 없이 ready 가 될 수 없습니다. Connector Registry ≠ Availability ≠ Permission, Approval ≠ Runtime Start, Runtime Start ≠ Action Completion, HTTP 2xx ≠ Business Success, Draft Created ≠ Message Sent, Pause/Cancel Requested ≠ Paused/Cancelled, Timeout ≠ 실패 확정, Closure ≠ Outcome. Credential/Secret/Token 원문은 저장·반환하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Connector Definitions" value={NUM(num('connectors', 'definitions'))} />
            <Box label="Connector Instances" value={NUM(num('connectors', 'instances'))} />
            <Box label="Permission Unverified" value={NUM(num('connectors', 'permission_unverified'))} />
            <Box label="Credential Unverified" value={NUM(num('connectors', 'credential_unverified'))} />
            <Box label="Automation Definitions" value={NUM(num('automations', 'total'))} />
            <Box label="Pending Automation Review" value={NUM(num('automations', 'pending_review'))} />
            <Box label="Runtime Sessions" value={NUM(num('sessions', 'total'))} />
            <Box label="Runtime Ready" value={NUM(num('sessions', 'ready_reference'))} />
            <Box label="Started References" value={NUM(num('sessions', 'started_reference'))} />
            <Box label="Pause Requested" value={NUM(num('sessions', 'pause_requested'))} />
            <Box label="Cancellation Requested" value={NUM(num('sessions', 'cancellation_requested'))} />
            <Box label="Timeout References" value={NUM(num('sessions', 'timeout_reference'))} />
            <Box label="Action Attempts" value={NUM(num('runtime_events', 'action_attempts'))} />
            <Box label="Connector Responses" value={NUM(num('runtime_events', 'connector_responses'))} />
            <Box label="Result Verification Pending" value={NUM(num('sessions', 'result_verification_pending'))} />
            <Box label="Closed References" value={NUM(num('sessions', 'completed_reference'))} />
          </div>
          <AdminAlert tone="info" description={`runtime_unavailable: ${Array.isArray(summary.runtime_unavailable) ? (summary.runtime_unavailable as unknown[]).map(String).join(', ') : '—'} · runtime_available_reference: ${Array.isArray(summary.runtime_available_reference) ? (summary.runtime_available_reference as unknown[]).map(String).join(', ') : '—'} — 0 과 Unknown 을 혼동하지 않습니다(데이터 없으면 — 표시).`} />
        </div>
      )}

      {tab === 'connectordefs' && (
        <div className="space-y-2">
          {btn('실측 Connector Definition 4종 기록(사람)', () => {
            void act(async () => {
              await recordConnectorDefinition({ connector_code: 'resend_email_draft', connector_name: 'Resend Email(Draft)', connector_domain: 'email', provider: 'resend', supports_draft: true, supports_idempotency: true, status: 'draft_only', idempotency_key: 'conn-resend-email', limitations: ['자동 발송 없음 — Draft Created ≠ Message Sent'] });
              await recordConnectorDefinition({ connector_code: 'kakao_message_draft', connector_name: 'Kakao Message(Draft)', connector_domain: 'messaging', provider: 'kakao', supports_draft: true, status: 'draft_only', idempotency_key: 'conn-kakao-msg', limitations: ['자동 발송 없음'] });
              await recordConnectorDefinition({ connector_code: 'pdf_report_export', connector_name: 'PDF Report Export', connector_domain: 'document_generation', provider: 'pdf_internal', supports_read: true, status: 'available_reference', idempotency_key: 'conn-pdf-report', limitations: ['게이트에서 자동 호출 없음'] });
              await recordConnectorDefinition({ connector_code: 'payapp_webhook_read', connector_name: 'PayApp Webhook(참조)', connector_domain: 'webhook_reference', provider: 'payapp_webhook', supports_read: true, supports_idempotency: true, status: 'read_only', idempotency_key: 'conn-payapp-webhook', limitations: ['결제 Write 도메인 차단 — 수신 Reference 만'] });
            }, 'Connector Definition 기록(Definition ≠ Availability)');
          }, true)}
          {!defs.length ? <AdminEmpty title="Connector Definition 없음" description="Definition 은 실제 Credential/연결 성공을 의미하지 않습니다." /> : (
            <div className="space-y-1">
              {defs.slice(0, 30).map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{d.connector_code}</span>
                  <AdminBadge tone={statusTone(d.status)}>{d.status}</AdminBadge>
                  <AdminBadge tone="neutral">{d.connector_domain}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{d.provider} · timeout {d.timeout_seconds}s · retry≤{d.retry_limit} · 사람 승인 필수{d.supports_pause ? ' · pause' : ''}{d.supports_cancellation ? ' · cancel' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'instances' && (
        <div className="space-y-2">
          {btn('Instance 등록(사람 — unverified 시작)', () => {
            if (!defs.length) { toast.error('먼저 Connector Definition 을 기록하세요'); return; }
            void act(() => recordConnectorInstance({ connector_definition_id: defs[0].id, instance_code: `${defs[0].connector_code}_default`, environment_scope: 'non_production', credential_reference_type: 'env_reference', credential_reference_id: 'ENV_REFERENCE_NAME_ONLY', idempotency_key: `inst-${defs[0].connector_code}` }), 'Instance 등록(Credential 원문 저장 없음)');
          }, true)}
          {!instances.length ? <AdminEmpty title="Connector Instance 없음" description="Instance 는 연결/권한/자격증명 전부 unverified 로 시작합니다." /> : (
            <div className="space-y-1">
              {instances.slice(0, 30).map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{i.instance_code}</span>
                  <AdminBadge tone={statusTone(i.connection_status)}>{i.connection_status}</AdminBadge>
                  <AdminBadge tone={statusTone(i.permission_status)}>{i.permission_status}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{i.environment_scope} · {i.scope_type} · credential: {i.credential_reference_type}(원문 없음)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'availability' && (
        <div className="space-y-1">
          {!instances.length ? <AdminEmpty title="Instance 없음" description="Availability 는 Instance 실측 기준입니다." /> : instances.slice(0, 30).map((i) => {
            const v = evaluateConnectorInstance({ connectionStatus: i.connection_status, permissionStatus: i.permission_status, scopeStatus: i.scope_status, credentialReferenced: i.credential_reference_type !== 'none', environmentScope: i.environment_scope });
            return (
              <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{i.instance_code}</span>
                <AdminBadge tone={v.verdict === 'available_reference' ? 'success' : 'warning'}>{v.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">Registry ≠ Availability ≠ Permission — 단계별 검증 필요</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'permissions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Connector Permission 검토 기록', () => evtRecord('connector_permission_reviewed', { result: 'permission_verified_reference', evidence: [reason.trim()] }, 'Permission 검토 기록(Permission ≠ Approval)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">Permission ≠ Approval — 검증돼도 별도 사람 승인과 게이트가 필요합니다. Secret Scope 는 등록 자체가 차단됩니다.</p>
        </div>
      )}
      {tab === 'scope' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Connector Scope 검토 기록', () => evtRecord('connector_scope_reviewed', { result: 'scope_verified_reference', evidence: [reason.trim()] }, 'Scope 검토 기록'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">Cross-Enterprise/Brand/Store 차단 · production environment 는 Instance 등록 시점에 차단됩니다.</p>
        </div>
      )}
      {tab === 'health' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Connector Health 검토 기록', () => evtRecord('connector_health_reviewed', { result: 'health_unverified', evidence: [reason.trim()] }, 'Health 검토 기록(자동 Polling 없음)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">health_unverified 시작 — 자동 Connector Polling 없음, 사람 검토 Reference 만.</p>
        </div>
      )}

      {tab === 'automations' && (
        <div className="space-y-2">
          {btn('실측 Automation 2종 기록(draft)', () => {
            void act(async () => {
              await recordAutomationDefinition({ automation_code: 'weekly_report_draft', title: '주간 리포트 초안 생성', execution_domain: 'report_generation', connector_definition_id: defs.find((d) => d.connector_domain === 'document_generation')?.id ?? null, execution_mode: 'reference_only', idempotency_key: 'auto-weekly-report', limitations: ['자동 발송/게시 없음'] });
              await recordAutomationDefinition({ automation_code: 'evidence_bundle_draft', title: 'Evidence 수집 번들 초안', execution_domain: 'evidence_collection', execution_mode: 'manual_external_reference', idempotency_key: 'auto-evidence-bundle', limitations: ['사람 수집 Reference'] });
            }, 'Automation 기록(정의 ≠ 실행 요청 ≠ 승인)');
          }, true)}
          {!autos.length ? <AdminEmpty title="Automation Definition 없음" description="Definition 은 실행 요청도, 승인도, 실행 권한도 아닙니다." /> : (
            <div className="space-y-1">
              {autos.slice(0, 30).map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{a.automation_code}</span>
                  <AdminBadge tone={statusTone(a.status)}>{a.status}</AdminBadge>
                  <AdminBadge tone="neutral">{a.execution_domain}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{a.execution_mode} · ≤{a.max_execution_duration_seconds}s · retry≤{a.max_retry_count}{a.dry_run_required ? ' · dryrun 필수' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'automationreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Automation 검토 기록', () => evtRecord('automation_definition_reviewed', { result: 'pending_review', evidence: [reason.trim()] }, 'Automation 검토 기록(approved ≠ 실행 허용)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">approved_reference 여도 실행 허용이 아닙니다 — 각 Execution Request 는 별도 승인과 Gate 검증 필요.</p>
        </div>
      )}

      {tab === 'readiness' && (
        <div className="space-y-2">
          <div className="space-y-1">
            {RUNTIME_COMPONENTS.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{c.key}</span>
                <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'neutral'}>{c.available === true ? 'available_reference' : c.available === false ? 'runtime_unavailable' : 'unknown'}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          {selPre && (
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">선택 Session Preconditions</span>
              <AdminBadge tone={selPre.result === 'runtime_ready_reference' ? 'success' : 'warning'}>{selPre.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{selPre.blockers.length ? `blockers: ${selPre.blockers.join(', ')}` : 'ready(≠ started)'}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}</div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="space-y-2">
          {!sessions.length ? <AdminEmpty title="Runtime Session 없음" description="Session 은 0535 Gate Ready + 0534 사람 승인 실존 없이 생성될 수 없습니다(서버 차단)." /> : (
            <div className="space-y-1">
              {sessions.slice(0, 30).map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{s.runtime_session_code}</span>
                  <AdminBadge tone={s.session_status === 'completed_reference' ? 'success' : statusTone(s.session_status)}>{s.session_status}</AdminBadge>
                  <AdminBadge tone="neutral">{s.execution_mode}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{s.supervised_by ? 'supervisor 지정' : 'supervisor_missing'} · checkpoint {s.checkpoint_count} · {s.result_verification_status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {sessSelect}{reasonInput}
            {btn('Review 시작', () => { const r = needReason(); const s = needSess(); if (!r || !s) return; void act(() => reviewRuntimeSession(s.id, 'start_review', r), 'Review 시작'); })}
            {btn('Preconditions Review(정책+Supervisor 필수)', () => {
              const r = needReason(); const s = needSess(); if (!r || !s) return;
              void act(() => reviewRuntimeSession(s.id, 'preconditions_review', r, { supervised_by: s.started_by ?? s.supervised_by ?? undefined, timeout_policy_defined: true, cancellation_policy_defined: true, cleanup_policy_defined: true, evidence_requirements_defined: true, observation_plan_defined: true }), 'Preconditions 검토(ready ≠ started)');
            }, true)}
            {btn('기각', () => { const r = needReason(); const s = needSess(); if (!r || !s) return; void act(() => reviewRuntimeSession(s.id, 'reject', r), '기각'); })}
            {btn('무효화', () => { const r = needReason(); const s = needSess(); if (!r || !s) return; void act(() => reviewRuntimeSession(s.id, 'invalidate', r), '무효화'); })}
          </div>
          <p className="text-[10px] text-muted-foreground">Session 생성은 Execution Gateway(0535)에서 gate ready 가 된 Request 로만 가능합니다 — 이 화면은 검토/감독 전용.</p>
        </div>
      )}
      {tab === 'pendingstarts' && (
        <div className="space-y-2">
          {sessions.filter((s) => ['ready_reference', 'start_requested_reference'].includes(s.session_status)).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone="info">{s.session_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">자동 시작 없음 — 사람이 요청/기록</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {sessSelect}{reasonInput}
            {btn('Start 요청 기록', () => { const r = needReason(); const s = needSess(); if (!r || !s) return; void act(() => reviewRuntimeSession(s.id, 'request_start', r), 'Start 요청(요청 ≠ 시작)'); })}
            {btn('Start Reference 기록(Evidence 필수)', () => { const r = needReason(); const s = needSess(); if (!r || !s) return; void act(() => reviewRuntimeSession(s.id, 'record_start_reference', r, { evidence: [r] }), 'Start Reference(Start ≠ Action Success)'); }, true)}
          </div>
        </div>
      )}
      {tab === 'activerefs' && (() => {
        const active = sessions.filter((s) => ['started_reference', 'action_reported_reference', 'pause_requested', 'cancellation_requested', 'result_verification_pending', 'observation_pending'].includes(s.session_status));
        return !active.length ? <AdminEmpty title="Active Reference 없음" description="무인 장기 실행은 금지 — Active 는 사람 감독 중인 Reference 입니다." /> : (
          <div className="space-y-1">
            {active.slice(0, 30).map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.runtime_session_code}</span>
                <AdminBadge tone="info">{s.session_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">supervised · Runtime Start ≠ Action Completion</span>
              </div>
            ))}
          </div>
        );
      })()}

      {tab === 'checkpoints' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Checkpoint 기록', () => evtRecord('runtime_checkpoint_recorded', { current_step: reason.trim(), evidence: [reason.trim()] }, 'Checkpoint 기록(완전한 검증 아님)'), true)}
          </div>
          {(() => {
            const cps = audit.filter((e) => e.event_type === 'runtime_checkpoint_recorded');
            return !cps.length ? <AdminEmpty title="Checkpoint 없음" description="Checkpoint 는 실제 상태의 완전한 검증을 의미하지 않습니다." /> : (
              <div className="space-y-1">{cps.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'pause' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Pause Request 기록', () => evtRecord('pause_requested', { source: 'admin_ui' }, 'Pause 요청(Requested ≠ Paused)'), true)}
            {btn('Pause Confirmation 기록(Evidence 필수)', () => evtRecord('pause_confirmed_reference', { evidence: [reason.trim()] }, 'Pause 확정 Reference'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Pause Request ≠ Pause Success — 확정은 Evidence 필수(서버 차단). Cancellation Token 런타임 없음.</p>
        </div>
      )}
      {tab === 'cancellation' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Cancellation Request 기록', () => evtRecord('cancellation_requested', { source: 'admin_ui' }, 'Cancel 요청(Requested ≠ Cancelled)'), true)}
            {btn('Cancellation Confirmation 기록(Evidence 필수)', () => evtRecord('cancellation_confirmed_reference', { evidence: [reason.trim()] }, 'Cancel 확정 Reference'))}
          </div>
          <p className="text-[10px] text-muted-foreground">부분 실행/중복 Side Effect/Cleanup 필요 여부를 함께 검토 — 자동 취소 실행 없음.</p>
        </div>
      )}
      {tab === 'timeouts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Timeout Reference 기록', () => evtRecord('timeout_recorded', { external_action_may_continue: true }, 'Timeout 기록(≠ 실패 확정)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">Timeout ≠ Safe Termination — 외부 Action 이 계속될 수 있어 result_recheck_required 를 함께 검토합니다.</p>
        </div>
      )}

      {tab === 'attempts' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Action Attempt Reference 기록(사람 수행)', () => evtRecord('connector_action_attempt_recorded', { evidence: [reason.trim()], action_attempt_number: 1 }, 'Attempt 기록(≠ Success·Connector 자동 호출 아님)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">started_reference 이후에만 기록 가능(서버 차단) — Queue Accepted ≠ Task Completed.</p>
        </div>
      )}
      {tab === 'responses' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Connector Response Evidence 기록', () => evtRecord('connector_response_recorded', { evidence: [reason.trim()], http_status: 200 }, 'Response 기록(HTTP 2xx ≠ Business Success)'), true)}
          </div>
          {(() => {
            const rs = audit.filter((e) => e.event_type === 'connector_response_recorded');
            return !rs.length ? <AdminEmpty title="Response 없음" description="Connector Response ≠ Trusted Evidence — 검증 방법과 Side Effect 확인이 별도 필요합니다." /> : (
              <div className="space-y-1">{rs.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'resultverification' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('결과 검증: verified_reference', () => evtRecord('action_result_reviewed', { result: 'verified_reference', evidence: [reason.trim()] }, '결과 검증 기록'), true)}
            {btn('result_unverified', () => evtRecord('action_result_reviewed', { result: 'result_unverified' }, 'result_unverified 기록'))}
            {btn('response_only', () => evtRecord('action_result_reviewed', { result: 'response_only' }, 'response_only 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Action Completion ≠ Result Verification — 자동 검증 없음, 사람 검토 Reference 만.</p>
        </div>
      )}

      {tab === 'idempotency' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Idempotency 검토: verified', () => evtRecord('idempotency_reviewed', { result: 'idempotency_verified_reference', evidence: [reason.trim()] }, 'Idempotency 검토 기록'), true)}
            {btn('duplicate_side_effect_risk', () => evtRecord('idempotency_reviewed', { result: 'duplicate_side_effect_risk' }, '중복 Side Effect 위험 기록'))}
            {btn('execution_blocked', () => evtRecord('idempotency_reviewed', { result: 'execution_blocked' }, 'Write 차단 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Idempotency 미검증 Write Action 은 시작할 수 없습니다(execution_blocked).</p>
        </div>
      )}
      {tab === 'retry' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Retry 검토: manual_retry_required', () => evtRecord('retry_reviewed', { result: 'manual_retry_required' }, 'Retry 검토(자동 Retry 없음)'), true)}
            {btn('result_recheck_required', () => evtRecord('retry_reviewed', { result: 'result_recheck_required' }, '이전 Action 성공 가능 — 재조회 필요'))}
            {btn('retry_blocked', () => evtRecord('retry_reviewed', { result: 'retry_blocked' }, 'Retry 차단 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Retry ≠ Recovery — 이전 Action 이 성공했을 수 있어 재시도 전 결과 재조회를 우선합니다.</p>
        </div>
      )}
      {tab === 'cleanup' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Cleanup 검토: ready_reference', () => evtRecord('cleanup_reviewed', { result: 'cleanup_ready_reference', evidence: [reason.trim()] }, 'Cleanup 검토(자동 Cleanup 없음)'), true)}
            {btn('cleanup_pending', () => evtRecord('cleanup_reviewed', { result: 'cleanup_pending' }, 'cleanup_pending 기록'))}
            {btn('orphan_resource_candidate', () => evtRecord('cleanup_reviewed', { result: 'orphan_resource_candidate' }, 'Orphan 리소스 후보 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Temporary/Sandbox 리소스·Draft·Lock 잔존 검토 — Cleanup Plan ≠ Cleanup Success.</p>
        </div>
      )}

      {tab === 'observation' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Observations(0506 실측)" value={NUM(num('gateway_actuals', 'observations_0506'))} />
            <Box label="Open Incidents(0502)" value={NUM(num('gateway_actuals', 'incidents_open_0502'))} />
            <Box label="Observation Pending Sessions" value={NUM(num('sessions', 'observation_pending'))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Observation 시작 Reference', () => evtRecord('runtime_observation_started_reference', { evidence: [reason.trim()] }, 'Observation 시작(≠ Causality)'), true)}
            {btn('Observation 완료 Reference', () => evtRecord('runtime_observation_completed_reference', { evidence: [reason.trim()] }, 'Observation 완료(Completion ≠ Outcome)'))}
          </div>
        </div>
      )}
      {tab === 'unexpected' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Unexpected Runtime Effect 기록', () => evtRecord('unexpected_runtime_effect_detected', { evidence: [reason.trim()] }, 'Unexpected Effect 기록(사람 검토 필요)'), true)}
          </div>
          {(() => {
            const ux = audit.filter((e) => e.event_type === 'unexpected_runtime_effect_detected');
            return !ux.length ? <AdminEmpty title="Unexpected Effect 없음" description="후보 감지/기록만 — 자동 대응 없음." /> : (
              <div className="space-y-1">{ux.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">unexpected</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'humanreviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Human Closure: closed_reference(Response 선행 필수)', () => evtRecord('runtime_closure_reviewed', { closure: 'closed_reference', evidence: [reason.trim()] }, 'Closure 기록(≠ Outcome)'), true)}
            {btn('closed_with_limitation', () => evtRecord('runtime_closure_reviewed', { closure: 'closed_with_limitation', evidence: [reason.trim()] }, 'Closure(제한 포함)'))}
            {btn('rejected', () => evtRecord('runtime_closure_reviewed', { closure: 'rejected' }, 'Closure 반려'))}
          </div>
          {(() => {
            const reviews = audit.filter((e) => ['runtime_preconditions_reviewed', 'runtime_started_reference', 'action_result_reviewed', 'runtime_closure_reviewed', 'runtime_session_invalidated', 'automation_definition_reviewed'].includes(e.event_type));
            return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Connector/Automation/Start/Result/Closure 검토는 전부 사람이 수행합니다." /> : (
              <div className="space-y-1">{reviews.slice(0, 40).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="info">{e.event_type}</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}

      {tab === 'recommendations' && (
        !recommendations.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다(runtime_unverified)." /> : (
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoExecuted=false · Approval ≠ Runtime Start</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'measured' ? 'info' : 'warning'}>{s.stage}</AdminBadge>
              <span className="ml-2">{s.count == null ? 'null(원본 없음)' : NUM(s.count)}</span>
              <span className="ml-2 text-muted-foreground">{s.source} · timelineIsNotCompletionClaim</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Connector→Automation→Session→Preconditions→Start→Action→Response→Observation→Closure 9단계 실측 집계</p>
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="Runtime 활동이 이벤트로 남습니다(30종 whitelist)." /> : (
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
          {RUNTIME_CONTROL_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
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
