/**
 * RuntimeAssuranceSection — Enterprise Runtime Assurance, Connector Health Intelligence &
 * Human Escalation Control Center (Phase AI-OPS-34).
 *
 * Runtime Session→Signal Collection→Connector Health→Progress Assurance→
 * Stall/Timeout/Duplicate/Evidence Gap Detection→Incident Candidate→Human Escalation→
 * Recovery Readiness→Observation→Human Resolution→Audit.
 * Signal ≠ Fact · Candidate ≠ Confirmed Incident · Connector Health ≠ Action Success ·
 * Timeout ≠ Failure · Resolution ≠ Outcome. 자동 Runtime/Connector 제어·자동 조치 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardList, Clock, Copy, FlaskConical,
  Grid3x3, HeartPulse, History, Layers, Lightbulb, Lock, PauseCircle, RefreshCw,
  Scale, ScrollText, Search, Shield, Trash2, Undo2,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchRuntimeAssuranceSummary, fetchRuntimeSignals, recordRuntimeSignal,
  fetchRuntimeIncidentCandidates, createRuntimeIncidentCandidate, reviewRuntimeIncidentCandidate,
  recordRuntimeAssuranceEvent, fetchRuntimeAssuranceAudit, fetchRuntimeSessions, fetchConnectorInstances,
  type RuntimeAssuranceSummary, type RuntimeSignalRow, type RuntimeIncidentCandidateRow,
  type RuntimeAssuranceEventRow, type RuntimeSessionRow, type ConnectorInstanceRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  evaluateConnectorHealth, evaluateRuntimeProgress, detectStallCandidate, detectTimeoutCandidate,
  evaluateEvidenceCompleteness, evaluateRuntimeAssurance, buildAssuranceRecommendation,
  buildAssuranceTimeline, ASSURANCE_COMPONENTS, RUNTIME_ASSURANCE_SUPPORT,
} from '@/lib/runtimeAssurance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'assurance' | 'connectorhealth' | 'sessions' | 'activerefs' | 'progress' | 'checkpoints'
  | 'stalled' | 'timeouts' | 'duplicates' | 'evidence' | 'verifdelays' | 'cleanupdelays' | 'obsdelays'
  | 'reviewdelays' | 'incidents' | 'severity' | 'escalations' | 'investigations' | 'recovery' | 'resolution'
  | 'unexpected' | 'recommendations' | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'assurance', label: 'Runtime Assurance', icon: Shield },
  { key: 'connectorhealth', label: 'Connector Health', icon: HeartPulse },
  { key: 'sessions', label: 'Runtime Sessions', icon: ClipboardList },
  { key: 'activerefs', label: 'Active Runtime References', icon: Activity },
  { key: 'progress', label: 'Session Progress', icon: Activity },
  { key: 'checkpoints', label: 'Checkpoint Continuity', icon: History },
  { key: 'stalled', label: 'Stalled Candidates', icon: PauseCircle },
  { key: 'timeouts', label: 'Timeout Candidates', icon: Clock },
  { key: 'duplicates', label: 'Duplicate Candidates', icon: Copy },
  { key: 'evidence', label: 'Evidence Completeness', icon: ScrollText },
  { key: 'verifdelays', label: 'Result Verification Delays', icon: Clock },
  { key: 'cleanupdelays', label: 'Cleanup Delays', icon: Trash2 },
  { key: 'obsdelays', label: 'Observation Delays', icon: Clock },
  { key: 'reviewdelays', label: 'Human Review Delays', icon: Scale },
  { key: 'incidents', label: 'Runtime Incident Candidates', icon: AlertTriangle },
  { key: 'severity', label: 'Severity', icon: AlertTriangle },
  { key: 'escalations', label: 'Escalations', icon: Scale },
  { key: 'investigations', label: 'Investigations', icon: Search },
  { key: 'recovery', label: 'Recovery Readiness', icon: Undo2 },
  { key: 'resolution', label: 'Runtime Resolution', icon: CheckCircle2 },
  { key: 'unexpected', label: 'Unexpected Effects', icon: AlertTriangle },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'timeline', label: 'Assurance Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: FlaskConical },
];

const KNOWN_LIMITATIONS = [
  '범용 Runtime Heartbeat/Metrics/Worker Queue/Durable Execution 없음',
  '자동 Connector Health Probe 없음 — 사람 검토 Reference 만',
  '자동 Stall/Timeout/Duplicate 확정 없음 — 전부 Candidate 유지',
  '실제 Incident(0502) 자동 생성/등록 없음 · 자동 Escalation 메시지 발송 없음',
  '자동 Pause/Cancellation/Connector Disable/Retry/Cleanup/Rollback/Recovery 없음',
  '자동 Incident Resolution 없음 · Observation 자동 Causality 판정 없음',
  'Connector last_success/last_failure/rate_limit 컬럼 없음(0536 실측) — 해당 Signal unavailable',
  'SLA 원본 없음 — Review Delay 는 임의 SLA 를 만들지 않고 insufficient_data 유지',
  'Human Review 필수 · Production Action/Apply 미지원',
];

export default function RuntimeAssuranceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<RuntimeAssuranceSummary>({});
  const [signals, setSignals] = useState<RuntimeSignalRow[]>([]);
  const [incidents, setIncidents] = useState<RuntimeIncidentCandidateRow[]>([]);
  const [audit, setAudit] = useState<RuntimeAssuranceEventRow[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionRow[]>([]);
  const [instances, setInstances] = useState<ConnectorInstanceRow[]>([]);
  const [reason, setReason] = useState('');
  const [selSess, setSelSess] = useState('');
  const [selInc, setSelInc] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, sig, inc, au, se, ins] = await Promise.all([
        fetchRuntimeAssuranceSummary(), fetchRuntimeSignals(null, 200), fetchRuntimeIncidentCandidates(null, 200),
        fetchRuntimeAssuranceAudit(200), fetchRuntimeSessions(null, 200), fetchConnectorInstances(200),
      ]);
      setSummary(s); setSignals(sig); setIncidents(inc); setAudit(au); setSessions(se); setInstances(ins);
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
  const needInc = (): RuntimeIncidentCandidateRow | null => {
    const c = incidents.find((x) => x.id === selInc);
    if (!c) { toast.error('Incident Candidate 선택 필수'); return null; }
    return c;
  };
  const evtRecord = (kind: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const s = needSess();
    if (!r || !s) return;
    void act(() => recordRuntimeAssuranceEvent(kind, r, payload, s.id), ok);
  };
  const incReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const c = needInc();
    if (!r || !c) return;
    void act(() => reviewRuntimeIncidentCandidate(c.id, action, r, payload), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const now = useMemo(() => new Date(), []);

  const perSession = useMemo(() => sessions.slice(0, 30).map((s) => {
    const inst = instances.find((i) => i.id === s.connector_instance_id) ?? null;
    const health = evaluateConnectorHealth({
      instanceExists: inst != null, connectionStatus: inst?.connection_status ?? null,
      permissionStatus: inst?.permission_status ?? null, scopeStatus: inst?.scope_status ?? null,
      credentialReferenced: inst ? inst.credential_reference_type !== 'none' : null,
      lastVerifiedAt: inst?.last_verified_at ? new Date(inst.last_verified_at) : null,
      now, staleAfterSeconds: 7 * 86400, recentFailures: null, rateLimited: null,
    });
    const progress = evaluateRuntimeProgress({ sessionStatus: s.session_status, checkpointCount: s.checkpoint_count, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: s.result_verification_status === 'verified_reference' });
    const stall = detectStallCandidate({
      started: s.started_at != null,
      lastActivityAt: s.last_checkpoint_at ? new Date(s.last_checkpoint_at) : s.started_at ? new Date(s.started_at) : null,
      now, expectedDurationSeconds: null,   // Expected Duration 원본 없음 — 임의 판정 없음(insufficient_data)
      paused: s.session_status === 'paused_reference', cancellationRequested: s.session_status === 'cancellation_requested',
    });
    const timeout = detectTimeoutCandidate({ timeoutPolicySeconds: null, startedAt: s.started_at ? new Date(s.started_at) : null, now, timeoutReferenceRecorded: s.timeout_reference_at != null });
    const evidence = evaluateEvidenceCompleteness({
      approval: s.approval_reference_id != null, gate: s.gate_reference_id != null,
      start: s.started_at != null ? true : null, action: null, response: null,
      verification: s.result_verification_status === 'verified_reference' ? true : s.result_verification_status === 'result_verification_pending' ? null : false,
      cleanup: null, observation: null, closure: null,
    });
    const openInc = incidents.filter((c) => c.runtime_session_id === s.id && !['resolved_reference', 'resolved_with_limitation', 'false_positive_reference', 'invalidated'].includes(c.incident_status)).length;
    const escPending = incidents.filter((c) => c.runtime_session_id === s.id && c.escalation_status === 'escalation_pending').length;
    const assurance = evaluateRuntimeAssurance({
      connectorHealthy: inst == null ? null : health.result === 'connector_healthy_reference' || health.result === 'connector_healthy_with_limitation',
      progressResult: progress.result, stallResult: stall.result, timeoutResult: timeout.result,
      duplicateVerdict: 'insufficient_data', evidenceResult: evidence.result,
      openIncidentCandidates: openInc, escalationsPending: escPending,
    });
    return { s, health, progress, stall, timeout, evidence, assurance };
  }), [sessions, instances, incidents, now]);

  const timeline = useMemo(() => buildAssuranceTimeline([
    { stage: 'signal', count: num('signals', 'total'), source: 'signals 실측' },
    { stage: 'connector_health', count: num('assurance_events', 'health_reviews'), source: 'health_evaluated 실측' },
    { stage: 'progress', count: num('runtime_actuals', 'sessions_active_0536'), source: 'active sessions 실측' },
    { stage: 'detection', count: (num('signals', 'stall_candidates') ?? 0) + (num('signals', 'duplicate_candidates') ?? 0) + (num('signals', 'evidence_gaps') ?? 0), source: '후보 signal 실측' },
    { stage: 'incident_candidate', count: num('incidents', 'total'), source: 'candidates 실측' },
    { stage: 'escalation', count: num('assurance_events', 'escalations_requested'), source: 'escalation_requested 실측' },
    { stage: 'investigation', count: num('assurance_events', 'investigations'), source: 'investigation 실측' },
    { stage: 'recovery', count: num('assurance_events', 'recovery_reviews'), source: 'recovery_reviewed 실측' },
    { stage: 'resolution', count: num('incidents', 'resolved'), source: 'resolved 실측' },
  ]), [num]);

  const recommendations = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildAssuranceRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const healthUnv = num('runtime_actuals', 'connector_health_unverified_0536');
    if (healthUnv != null && healthUnv > 0) push(buildAssuranceRecommendation({ type: 'review_connector_health', reason: `Health 미검증 Connector ${healthUnv}개 — Health ≠ Action Success`, evidence: ['instances 실측'], confidence: null }));
    const stale = num('runtime_actuals', 'connector_stale_0536');
    if (stale != null && stale > 0) push(buildAssuranceRecommendation({ type: 'verify_connector_credential_reference', reason: `검증 7일 초과/미검증 Connector ${stale}개 — stale 상태`, evidence: ['last_verified_at 실측'], confidence: null }));
    const noCp = num('runtime_actuals', 'sessions_no_checkpoint_0536');
    if (noCp != null && noCp > 0) push(buildAssuranceRecommendation({ type: 'review_stall_candidate', reason: `Checkpoint 없는 started Session ${noCp}건 — Stall 후보 검토(확정 아님)`, evidence: ['sessions 실측'], confidence: null }));
    const gaps = num('signals', 'evidence_gaps');
    if (gaps != null && gaps > 0) push(buildAssuranceRecommendation({ type: 'gather_missing_evidence', reason: `Evidence Gap Signal ${gaps}건 — Gap ≠ Execution Failure`, evidence: ['signals 실측'], confidence: null }));
    const dup = num('signals', 'duplicate_candidates');
    if (dup != null && dup > 0) push(buildAssuranceRecommendation({ type: 'review_duplicate_candidate', reason: `Duplicate 후보 Signal ${dup}건 — 자동 제거/취소 없음`, evidence: ['signals 실측'], confidence: null }));
    const crit = num('incidents', 'critical_severity');
    if (crit != null && crit > 0) push(buildAssuranceRecommendation({ type: 'request_executive_review', reason: `Critical Candidate ${crit}건 — Critical 도 자동 조치 없음, 사람 검토 필요`, evidence: ['candidates 실측'], confidence: null }));
    const escal = num('incidents', 'escalated');
    if (escal != null && escal > 0) push(buildAssuranceRecommendation({ type: 'request_human_resolution', reason: `Escalated Candidate ${escal}건 — 사람 Resolution 대기`, evidence: ['candidates 실측'], confidence: null }));
    return out;
  }, [num]);

  if (loading) return <AdminCard title="Enterprise Runtime Assurance & Human Escalation Control"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Runtime Assurance & Human Escalation Control">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const sessSelect = (
    <select value={selSess} onChange={(e) => setSelSess(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Runtime Session 선택</option>
      {sessions.map((s) => <option key={s.id} value={s.id}>{s.runtime_session_code} · {s.session_status}</option>)}
    </select>
  );
  const incSelect = (
    <select value={selInc} onChange={(e) => setSelInc(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Incident Candidate 선택</option>
      {incidents.map((c) => <option key={c.id} value={c.id}>{c.incident_code} · {c.incident_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('healthy') || s.includes('resolved') || s === 'no_stall_reference' ? 'success' as const : s.includes('candidate') || s.includes('gap') || s.includes('pending') || s.includes('stale') ? 'warning' as const : s.includes('unavailable') || s === 'critical' ? 'danger' as const : 'neutral' as const);

  return (
    <AdminCard
      title="Enterprise Runtime Assurance & Human Escalation Control"
      subtitle="Signal→Connector Health→Progress→Stall/Timeout/Duplicate/Evidence Gap Detection→Incident Candidate→Escalation→Recovery→Human Resolution — 자동 제어 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="실제 Runtime 중단/재개/취소, Connector 비활성/재연결, 자동 Retry/Cleanup/Rollback/Incident 해결, 자동 메시지·Ticket·Issue 발송은 없습니다. 이 계층은 분석/후보 감지/권고 계층이며 모든 조치는 사람이 검토·실행합니다. Signal ≠ Fact, Missing Signal ≠ Failure, Stalled Candidate ≠ Confirmed Stall, Timeout ≠ Failed Execution, Connector Health ≠ Action Success, Duplicate Candidate ≠ Confirmed Duplicate, Evidence Gap ≠ Execution Failure, Incident Candidate ≠ Confirmed Incident, Resolution ≠ Outcome Achievement." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Runtime Sessions(0536)" value={NUM(num('runtime_actuals', 'sessions_total_0536'))} />
            <Box label="Active References" value={NUM(num('runtime_actuals', 'sessions_active_0536'))} />
            <Box label="Signals" value={NUM(num('signals', 'total'))} />
            <Box label="Stale Signals" value={NUM(num('signals', 'stale'))} />
            <Box label="Stall 후보 Signal" value={NUM(num('signals', 'stall_candidates'))} />
            <Box label="Duplicate 후보 Signal" value={NUM(num('signals', 'duplicate_candidates'))} />
            <Box label="Evidence Gaps" value={NUM(num('signals', 'evidence_gaps'))} />
            <Box label="Review Delay Signal" value={NUM(num('signals', 'delayed_reviews'))} />
            <Box label="Incident Candidates" value={NUM(num('incidents', 'total'))} />
            <Box label="High Severity" value={NUM(num('incidents', 'high_severity'))} />
            <Box label="Critical Severity" value={NUM(num('incidents', 'critical_severity'))} />
            <Box label="Escalated" value={NUM(num('incidents', 'escalated'))} />
            <Box label="Investigation" value={NUM(num('incidents', 'investigation'))} />
            <Box label="Recovery Review Pending" value={NUM(num('incidents', 'recovery_review_pending'))} />
            <Box label="Resolution Pending" value={NUM(num('incidents', 'resolution_pending'))} />
            <Box label="Resolved References" value={NUM(num('incidents', 'resolved'))} />
          </div>
          <AdminAlert tone="info" description={`signal_unavailable: ${Array.isArray(summary.signal_unavailable) ? (summary.signal_unavailable as unknown[]).map(String).join(', ') : '—'} · signal_available_reference: ${Array.isArray(summary.signal_available_reference) ? (summary.signal_available_reference as unknown[]).map(String).join(', ') : '—'} — 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'assurance' && (
        <div className="space-y-1">
          {!perSession.length ? <AdminEmpty title="Runtime Session 없음" description="Assurance State 는 순수 로직 Snapshot 이며 원본 Runtime Event 를 대체하지 않습니다." /> : perSession.map(({ s, assurance }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone={tone(assurance.status)}>{assurance.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.session_status} · Snapshot(원본 대체 없음)</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Assurance 평가 Snapshot 기록', () => {
              const p = perSession.find((x) => x.s.id === selSess);
              evtRecord('assurance_evaluation_completed_reference', { snapshot: p ? { assurance: p.assurance.status, progress: p.progress.result, stall: p.stall.result, evidence: p.evidence.result } : {}, evidence: [reason.trim()] }, '평가 Snapshot 기록(Signal ≠ Fact)');
            }, true)}
          </div>
        </div>
      )}

      {tab === 'connectorhealth' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Connector Instances(0536)" value={NUM(num('runtime_actuals', 'connector_instances_0536'))} />
            <Box label="Health Unverified" value={NUM(num('runtime_actuals', 'connector_health_unverified_0536'))} />
            <Box label="Stale(7일+/미검증)" value={NUM(num('runtime_actuals', 'connector_stale_0536'))} />
          </div>
          {instances.slice(0, 20).map((i) => {
            const h = evaluateConnectorHealth({ instanceExists: true, connectionStatus: i.connection_status, permissionStatus: i.permission_status, scopeStatus: i.scope_status, credentialReferenced: i.credential_reference_type !== 'none', lastVerifiedAt: i.last_verified_at ? new Date(i.last_verified_at) : null, now, staleAfterSeconds: 7 * 86400, recentFailures: null, rateLimited: null });
            return (
              <div key={i.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{i.instance_code}</span>
                <AdminBadge tone={tone(h.result)}>{h.result}</AdminBadge>
                <span className="ml-2 text-muted-foreground">Health ≠ Action Success · last_success/failure 컬럼 없음(signal_unavailable)</span>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Connector Health 평가 기록', () => evtRecord('connector_health_evaluated', { evidence: [reason.trim()] }, 'Health 평가 기록(≠ Action Success)'), true)}
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        !sessions.length ? <AdminEmpty title="Runtime Session 없음" description="0536 Session 실측 — 본 계층은 읽기 전용으로 분석합니다." /> : (
          <div className="space-y-1">
            {sessions.slice(0, 30).map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.runtime_session_code}</span>
                <AdminBadge tone={tone(s.session_status)}>{s.session_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">checkpoint {s.checkpoint_count} · {s.result_verification_status} · {s.observation_status}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'activerefs' && (() => {
        const active = sessions.filter((s) => ['started_reference', 'action_reported_reference', 'pause_requested', 'cancellation_requested', 'result_verification_pending', 'observation_pending'].includes(s.session_status));
        return !active.length ? <AdminEmpty title="Active Reference 없음" description="Active 는 감독 중 Reference — 실시간 자동 제어 대상이 아닙니다." /> : (
          <div className="space-y-1">{active.map((s) => <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono font-bold">{s.runtime_session_code}</span><AdminBadge tone="info">{s.session_status}</AdminBadge></div>)}</div>
        );
      })()}
      {tab === 'progress' && (
        <div className="space-y-1">
          {!perSession.length ? <AdminEmpty title="Session 없음" description="Progress 는 상태/Checkpoint 실측 기반 — Heartbeat ≠ Progress." /> : perSession.map(({ s, progress }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone={tone(progress.result)}>{progress.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Checkpoint ≠ Verified Completion</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Progress 평가 기록', () => evtRecord('runtime_progress_evaluated', { evidence: [reason.trim()] }, 'Progress 평가 기록'), true)}
          </div>
        </div>
      )}
      {tab === 'checkpoints' && (
        <div className="space-y-1">
          {!sessions.length ? <AdminEmpty title="Session 없음" description="Checkpoint Continuity 는 last_checkpoint_at 실측 기반입니다." /> : sessions.slice(0, 30).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone={s.last_checkpoint_at ? 'info' : 'warning'}>{s.last_checkpoint_at ? `checkpoint ${s.checkpoint_count}` : 'checkpoint_missing'}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.last_checkpoint_at ? s.last_checkpoint_at.slice(0, 16).replace('T', ' ') : 'null(0 아님 — 미기록)'}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'stalled' && (
        <div className="space-y-2">
          {perSession.filter(({ stall }) => ['stall_candidate', 'checkpoint_stale_candidate'].includes(stall.result)).map(({ s, stall }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone="warning">{stall.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{stall.notes.join(' · ') || 'Candidate ≠ Confirmed Stall'}</span>
            </div>
          ))}
          <AdminAlert tone="info" description="Expected Duration 원본이 없는 Session 은 insufficient_data 로 유지되며 임의 판정하지 않습니다. Stall Candidate 는 확정 장애가 아닙니다." />
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Stall Candidate 기록', () => evtRecord('stall_candidate_detected', { evidence: [reason.trim()] }, 'Stall 후보 기록(≠ Confirmed)'), true)}
            {btn('Pause Review 요청', () => evtRecord('escalation_requested', { escalation_type: 'pause_review_requested', evidence: [reason.trim()] }, 'Pause 검토 요청(실행 아님)'))}
          </div>
        </div>
      )}
      {tab === 'timeouts' && (
        <div className="space-y-2">
          {perSession.filter(({ timeout }) => timeout.result !== 'timeout_not_detected' && timeout.result !== 'insufficient_data').map(({ s, timeout }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone="warning">{timeout.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{timeout.notes.join(' · ')}</span>
            </div>
          ))}
          <AdminAlert tone="info" description="Timeout Policy 원본이 없으면 insufficient_data — Timeout ≠ Failed Execution, 외부 Action 이 계속될 수 있어 result_recheck 를 함께 검토합니다." />
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Timeout Candidate 기록', () => evtRecord('timeout_candidate_detected', { evidence: [reason.trim()] }, 'Timeout 후보 기록(≠ Failure)'), true)}
            {btn('Result Recheck 요청', () => evtRecord('escalation_requested', { escalation_type: 'result_recheck_requested', evidence: [reason.trim()] }, '재조회 요청'))}
          </div>
        </div>
      )}
      {tab === 'duplicates' && (
        <div className="space-y-2">
          {(() => {
            const dup = signals.filter((s) => s.signal_type === 'duplicate_action_candidate');
            return !dup.length ? <AdminEmpty title="Duplicate 후보 없음" description="Duplicate Candidate ≠ Confirmed Duplicate — 자동 제거/취소 없음." /> : (
              <div className="space-y-1">{dup.slice(0, 20).map((s) => <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">{s.signal_type}</AdminBadge><span className="ml-2">{s.observed_value}</span></div>)}</div>
            );
          })()}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Duplicate Candidate 기록', () => evtRecord('duplicate_candidate_detected', { evidence: [reason.trim()] }, 'Duplicate 후보 기록(자동 취소 없음)'), true)}
          </div>
        </div>
      )}
      {tab === 'evidence' && (
        <div className="space-y-1">
          {!perSession.length ? <AdminEmpty title="Session 없음" description="Evidence Gap ≠ Execution Failure — 미도달 단계는 unknown 으로 유지합니다." /> : perSession.map(({ s, evidence }) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{s.runtime_session_code}</span>
              <AdminBadge tone={evidence.result === 'evidence_complete_reference' ? 'success' : 'warning'}>{evidence.result}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{evidence.missing.join(', ') || '결측 없음'} · 미도달 {evidence.notApplicable}단계(unknown 유지)</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Evidence Gap 기록', () => evtRecord('evidence_gap_detected', { evidence: [reason.trim()] }, 'Evidence Gap 기록(≠ Failure)'), true)}
          </div>
        </div>
      )}

      {tab === 'verifdelays' && <DelayTab kind="Result Verification" note="SLA 원본이 코드/정책에 없어 임의 SLA 판정을 하지 않습니다(insufficient_data 유지). 지연 후보는 사람이 사유와 함께 기록합니다." sessSelect={sessSelect} reasonInput={reasonInput} onRecord={() => evtRecord('review_delay_detected', { delay_kind: 'result', evidence: [reason.trim()] }, 'Result 검증 지연 후보 기록')} btn={btn} />}
      {tab === 'cleanupdelays' && <DelayTab kind="Cleanup" note="자동 Cleanup 없음 — 지연 후보는 검토 대상 기록입니다." sessSelect={sessSelect} reasonInput={reasonInput} onRecord={() => evtRecord('review_delay_detected', { delay_kind: 'cleanup', evidence: [reason.trim()] }, 'Cleanup 지연 후보 기록')} btn={btn} />}
      {tab === 'obsdelays' && <DelayTab kind="Observation" note="Observation ≠ Causality — 연장 요청은 기록만." sessSelect={sessSelect} reasonInput={reasonInput} onRecord={() => evtRecord('observation_extension_requested', { evidence: [reason.trim()] }, 'Observation 연장 요청 기록')} btn={btn} />}
      {tab === 'reviewdelays' && <DelayTab kind="Human Review" note="Reviewer 미지정은 reviewer_missing 으로 표시 — SLA 임의 생성 없음." sessSelect={sessSelect} reasonInput={reasonInput} onRecord={() => evtRecord('review_delay_detected', { delay_kind: 'closure', evidence: [reason.trim()] }, 'Review 지연 후보 기록')} btn={btn} />}

      {tab === 'incidents' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
            {btn('Incident Candidate 생성(Evidence 필수)', () => {
              const r = needReason(); const s = needSess();
              if (!r || !s) return;
              void act(() => createRuntimeIncidentCandidate({ runtime_session_id: s.id, incident_type: 'unknown_runtime_anomaly_candidate', severity: 'severity_unverified', evidence: [r], detection_source: 'manual_review' }), 'Candidate 생성(≠ Confirmed·0502 자동 등록 없음)');
            }, true)}
          </div>
          {!incidents.length ? <AdminEmpty title="Incident Candidate 없음" description="Candidate 는 확정 Incident 가 아니며 ai_incidents(0502)에 자동 등록되지 않습니다." /> : (
            <div className="space-y-1">
              {incidents.slice(0, 30).map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{c.incident_code}</span>
                  <AdminBadge tone={tone(c.incident_status)}>{c.incident_status}</AdminBadge>
                  <AdminBadge tone={c.severity === 'critical' ? 'danger' : c.severity === 'high' ? 'warning' : 'neutral'}>{c.severity}</AdminBadge>
                  <span className="ml-2 text-muted-foreground">{c.incident_type}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">{incSelect}
            {btn('Review 시작', () => incReview('start_review', {}, 'Review 시작'))}
            {btn('확인(Acknowledge)', () => incReview('acknowledge', {}, 'Acknowledge 기록'))}
            {btn('False Positive', () => incReview('false_positive', {}, 'False Positive 기록'))}
            {btn('무효화', () => incReview('invalidate', {}, '무효화'))}
          </div>
        </div>
      )}
      {tab === 'severity' && (
        <div className="space-y-1">
          {(['critical', 'high', 'moderate', 'low', 'informational', 'severity_unverified', 'insufficient_data'] as const).map((sev) => {
            const count = incidents.filter((c) => c.severity === sev).length;
            return (
              <div key={sev} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={sev === 'critical' ? 'danger' : sev === 'high' ? 'warning' : 'neutral'}>{sev}</AdminBadge>
                <span className="ml-2">{NUM(count)}</span>
                <span className="ml-2 text-muted-foreground">{sev === 'critical' ? 'Critical 도 자동 조치 없음' : sev === 'severity_unverified' ? '결측 시 재정규화 없이 unverified 유지' : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'escalations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{incSelect}{reasonInput}
            {btn('Escalation 요청(자동 발송 없음)', () => incReview('escalate', {}, 'Escalation 기록(권고 ≠ 실행)'), true)}
          </div>
          {(() => {
            const esc = audit.filter((e) => ['escalation_requested', 'escalation_acknowledged_reference'].includes(e.event_type));
            return !esc.length ? <AdminEmpty title="Escalation 없음" description="Escalation 은 요청/확인 기록 — 자동 이메일/Slack/Ticket 발송이 없습니다." /> : (
              <div className="space-y-1">{esc.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="info">{e.event_type}</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'investigations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{incSelect}{reasonInput}
            {btn('Investigation 시작 Reference', () => incReview('investigate', {}, 'Investigation 시작 기록'), true)}
            {btn('Monitoring 전환', () => incReview('monitor', {}, 'Monitoring 기록'))}
          </div>
          {(() => {
            const inv = incidents.filter((c) => c.incident_status === 'investigation_reference');
            return !inv.length ? <AdminEmpty title="Investigation 없음" description="조사 시작은 Reference 기록입니다." /> : (
              <div className="space-y-1">{inv.map((c) => <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono font-bold">{c.incident_code}</span><AdminBadge tone="info">investigation</AdminBadge></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'recovery' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{incSelect}{reasonInput}
            {btn('Recovery Readiness Review', () => incReview('recovery_review', {}, 'Recovery 검토(자동 Recovery 없음)'), true)}
          </div>
          <AdminAlert tone="info" description="Pause/Cancellation/Result Recheck/Cleanup/Rollback/Connector Disable 는 전부 검토 요청 Reference 이며 자동 실행되지 않습니다. Recovery Plan ≠ Recovery Execution ≠ Recovery Success. 비가역 잔존은 irreversible_effect_candidate 로 표시됩니다." />
        </div>
      )}
      {tab === 'resolution' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{incSelect}{reasonInput}
            {btn('Resolve(Evidence 필수)', () => incReview('resolve', { evidence: [reason.trim()] }, 'Resolution 기록(≠ Outcome Success)'), true)}
            {btn('Resolve with Limitation', () => incReview('resolve_with_limitation', { evidence: [reason.trim()], limitations: [reason.trim()] }, 'Resolution(제한 포함)'))}
            {btn('Resolution 반려', () => incReview('reject_resolution', {}, 'Resolution 반려'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Evidence 없는 Resolution 은 서버에서 차단 — resolved_reference 는 Business Outcome 성공이 아닙니다.</p>
        </div>
      )}
      {tab === 'unexpected' && (() => {
        const ux = signals.filter((s) => s.signal_type === 'unexpected_effect_candidate');
        return (
          <div className="space-y-2">
            {!ux.length ? <AdminEmpty title="Unexpected Effect 없음" description="후보 감지/기록만 — 자동 대응 없음." /> : (
              <div className="space-y-1">{ux.slice(0, 20).map((s) => <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">unexpected</AdminBadge><span className="ml-2">{s.observed_value}</span></div>)}</div>
            )}
            <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}
              {btn('Unexpected Effect Signal 기록', () => {
                const r = needReason(); const s = needSess();
                if (!r || !s) return;
                void act(() => recordRuntimeSignal({ runtime_session_id: s.id, signal_type: 'unexpected_effect_candidate', signal_status: 'available_reference', observed_value: r, evidence: [r] }), 'Signal 기록(Signal ≠ Fact)');
              }, true)}
            </div>
          </div>
        );
      })()}

      {tab === 'recommendations' && (
        !recommendations.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다(insufficient_data)." /> : (
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoActionTaken=false · Candidate ≠ Confirmed Incident</p>
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
          <p className="text-[10px] text-muted-foreground">Signal→Connector Health→Progress→Detection→Incident Candidate→Escalation→Investigation→Recovery→Resolution 9단계 실측 집계</p>
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="Assurance 활동이 이벤트로 남습니다(18종 whitelist)." /> : (
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
          {RUNTIME_ASSURANCE_SUPPORT.map((s) => (
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
          {ASSURANCE_COMPONENTS.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'neutral'}>{c.available === true ? 'available_reference' : c.available === false ? 'signal_unavailable' : 'unknown'}</AdminBadge>
              <span className="ml-2 font-bold">{c.key}</span>
              <span className="ml-2 text-muted-foreground">{c.note}</span>
            </div>
          ))}
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

function DelayTab({ kind, note, sessSelect, reasonInput, onRecord, btn }: { kind: string; note: string; sessSelect: React.ReactNode; reasonInput: React.ReactNode; onRecord: () => void; btn: (label: string, onClick: () => void, primary?: boolean) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" description={`${kind} 지연 검토 — ${note}`} />
      <div className="flex flex-wrap items-center gap-2">{sessSelect}{reasonInput}{btn(`${kind} 지연 후보 기록`, onRecord, true)}</div>
    </div>
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
