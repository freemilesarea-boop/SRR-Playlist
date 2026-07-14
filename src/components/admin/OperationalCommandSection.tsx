/**
 * OperationalCommandSection — AI Operational Command Center (Phase AI-OPS-6).
 *
 * Sources → Work Items → Priority → Ownership → SLA → Workload → Escalation →
 * Shift Handover → Executive Report → 사람 결정 → Evidence/Audit.
 * Production 실행/외부 메시지 자동 발송 엔진 아님. Send Email/Slack/SMS/Call/
 * Auto Escalate/Auto Assign/Enable Emergency Mode/Block Deployments/Stop Playback·
 * Scheduler/Lock Queue/Execute Rollback 버튼 없음.
 *
 * 탭 20개: Overview · Work Queue · Triage · Ownership · SLA · Aging · Workload ·
 * Approval Bottlenecks · Escalations · Notification References · Shifts · Handovers ·
 * Operator Availability · Single Operator Risk · Emergency Operations ·
 * Executive Situation Report · Operational Health · Recommendations · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ClipboardList, Clock, FileText, Gauge, Grid3x3, Layers, LifeBuoy,
  Lock, Megaphone, RefreshCw, ScrollText, Shield, Users, UserCheck, Waypoints, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchOpsCommandSummary, enrollOpsWorkItem, fetchOpsWorkItems, updateOpsWorkItem, assignOpsWorkItem,
  saveOpsPolicy, fetchOpsPolicies, requestOpsEscalation, decideOpsEscalation, fetchOpsEscalations,
  saveOpsShift, fetchOpsShifts, createOpsHandover, acceptOpsHandover, fetchOpsHandovers,
  recordOpsEmergencyReference, fetchOpsEmergencyReferences, fetchOpsOperators, fetchOpsAudit, fetchIncidents,
  type OpsWorkItemRow, type OpsPolicyRow, type OpsEscalationRow, type OpsShiftRow, type OpsHandoverRow,
  type OpsEmergencyRow, type OpsOperatorRow, type OpsEventRow, type IncidentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateSlaStatus, calculateWorkAge, calculateWeightedWorkload, classifyWorkload,
  detectApprovalBottleneck, assessEscalation, evaluateHandoverReadiness, assessSingleOperatorRisk,
  buildExecutiveSituationReport, calculateOperationalHealth, buildWorkRecommendation,
  recommendOwnership, OPS_SUPPORT, AGE_BUCKETS, PRIORITY_TONE, WSTATUS_TONE, SLA_TONE, WORKLOAD_TONE, HEALTH_TONE,
  type Priority, type WorkStatus, type WorkloadItem, type SlaStatus,
} from '@/lib/operationalCommand';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'queue' | 'triage' | 'ownership' | 'sla' | 'aging' | 'workload' | 'bottlenecks'
  | 'escalations' | 'notifications' | 'shifts' | 'handovers' | 'availability' | 'singleop' | 'emergency'
  | 'report' | 'health' | 'recommendations' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'queue', label: 'Work Queue', icon: ClipboardList },
  { key: 'triage', label: 'Triage', icon: Zap },
  { key: 'ownership', label: 'Ownership', icon: UserCheck },
  { key: 'sla', label: 'SLA', icon: Clock },
  { key: 'aging', label: 'Aging', icon: Clock },
  { key: 'workload', label: 'Workload', icon: Gauge },
  { key: 'bottlenecks', label: 'Approval Bottlenecks', icon: AlertTriangle },
  { key: 'escalations', label: 'Escalations', icon: Megaphone },
  { key: 'notifications', label: 'Notification References', icon: FileText },
  { key: 'shifts', label: 'Shifts', icon: Users },
  { key: 'handovers', label: 'Handovers', icon: Waypoints },
  { key: 'availability', label: 'Operator Availability', icon: Users },
  { key: 'singleop', label: 'Single Operator Risk', icon: Shield },
  { key: 'emergency', label: 'Emergency Operations', icon: LifeBuoy },
  { key: 'report', label: 'Executive Situation Report', icon: FileText },
  { key: 'health', label: 'Operational Health', icon: Activity },
  { key: 'recommendations', label: 'Recommendations', icon: Zap },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function OperationalCommandSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [items, setItems] = useState<OpsWorkItemRow[]>([]);
  const [policies, setPolicies] = useState<OpsPolicyRow[]>([]);
  const [escalations, setEscalations] = useState<OpsEscalationRow[]>([]);
  const [shifts, setShifts] = useState<OpsShiftRow[]>([]);
  const [handovers, setHandovers] = useState<OpsHandoverRow[]>([]);
  const [emergencies, setEmergencies] = useState<OpsEmergencyRow[]>([]);
  const [operators, setOperators] = useState<OpsOperatorRow[]>([]);
  const [operatorNote, setOperatorNote] = useState('');
  const [audit, setAudit] = useState<OpsEventRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [selItem, setSelItem] = useState<OpsWorkItemRow | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, w, p, e, sh, h, em, op, au, inc] = await Promise.all([
        fetchOpsCommandSummary(), fetchOpsWorkItems(null, null, null, 100), fetchOpsPolicies(null, 100),
        fetchOpsEscalations(null, 100), fetchOpsShifts(50), fetchOpsHandovers(50),
        fetchOpsEmergencyReferences(20), fetchOpsOperators(), fetchOpsAudit(null, 100), fetchIncidents(null, null, 30),
      ]);
      setSummary(s); setItems(w); setPolicies(p); setEscalations(e); setShifts(sh); setHandovers(h);
      setEmergencies(em); setOperators(op.items); setOperatorNote(op.note); setAudit(au); setIncidents(inc);
    } catch (e2) { setErr(classifyAdminError(e2)); } finally { setLoading(false); }
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

  const OPEN: WorkStatus[] = useMemo(() => ['new', 'triage', 'assigned', 'acknowledged', 'in_progress', 'waiting_evidence', 'waiting_approval', 'waiting_external', 'blocked', 'escalated'], []);
  const openItems = useMemo(() => items.filter((i) => OPEN.includes(i.work_status as WorkStatus)), [items, OPEN]);
  const slaOf = useCallback((w: OpsWorkItemRow) => calculateSlaStatus({ responseDueAt: w.response_due_at, resolutionDueAt: w.resolution_due_at, acknowledgedAt: w.acknowledged_at, completedAt: w.completed_at, pausedAt: w.sla_paused_at, now }), [now]);

  const bottleneck = useMemo(() => detectApprovalBottleneck({
    waitingApprovalCount: items.length ? items.filter((i) => i.work_status === 'waiting_approval').length : null,
    longWaitingApprovalCount: items.filter((i) => i.work_status === 'waiting_approval' && (calculateWorkAge(i.created_at, now).minutes ?? 0) > 1440).length,
    distinctApprovers: new Set(items.map((i) => i.approver_id).filter(Boolean)).size || null,
    singleApproverDependency: operators.filter((o) => o.is_active).length <= 1,
    dualApprovalUnmet: 0, repeatedRejections: items.filter((i) => i.work_status === 'rejected').length,
    reviewerEqualsApprover: items.filter((i) => i.reviewer_id && i.reviewer_id === i.approver_id).length,
    inactiveAssignee: 0,
  }), [items, operators, now]);

  const workloadByOperator = useMemo(() => operators.map((o) => {
    const assigned = openItems.filter((i) => i.assigned_to === o.id);
    const wl = calculateWeightedWorkload(assigned.map((i): WorkloadItem => ({
      priority: i.priority as Priority, status: i.work_status as WorkStatus,
      overdue: ['response_overdue', 'resolution_overdue', 'breached'].includes(slaOf(i).status),
      isIncident: i.work_type === 'incident_response',
    })));
    return { operator: o, wl, cls: classifyWorkload({ weightedLoad: assigned.length ? wl.weightedLoad : (o.open_assigned ? o.open_assigned * 2 : 0), criticalCount: wl.criticalCount, overdueCount: wl.overdueCount, availabilityKnown: false }) };
  }), [operators, openItems, slaOf]);

  const singleOpRisk = useMemo(() => assessSingleOperatorRisk({
    activeAdminCount: operators.length ? operators.filter((o) => o.is_active).length : null,
    criticalWithoutBackup: openItems.filter((i) => i.priority === 'critical' && !i.backup_assignee).length,
    singleApprover: operators.filter((o) => o.is_active).length <= 1,
    allShiftsSameOperator: shifts.length > 0 && new Set(shifts.map((s) => s.primary_operator)).size <= 1,
    hasBackupContact: false, handoverSupported: true, hasOpsDocs: false,
  }), [operators, openItems, shifts]);

  const health = useMemo(() => {
    const slaStatuses = openItems.map((i) => slaOf(i).status);
    const defined = slaStatuses.filter((s) => s !== 'sla_not_defined');
    return calculateOperationalHealth({
      workQueueHealth: items.length ? Math.max(0, 100 - openItems.filter((i) => ['urgent', 'critical'].includes(i.priority)).length * 15) : null,
      ownershipCoverage: openItems.length ? (openItems.filter((i) => i.assigned_to).length / openItems.length) * 100 : null,
      slaHealth: defined.length ? (defined.filter((s) => s === 'on_track').length / defined.length) * 100 : null,
      approvalFlow: bottleneck.level === 'insufficient_data' ? null : bottleneck.level === 'no_known_bottleneck' ? 90 : bottleneck.level === 'emerging' ? 60 : bottleneck.level === 'bottleneck' ? 35 : 10,
      workloadBalance: workloadByOperator.length ? (workloadByOperator.filter((w) => ['available', 'balanced'].includes(w.cls.status)).length / workloadByOperator.length) * 100 : null,
      escalationReadiness: policies.some((p) => p.policy_type === 'escalation' && p.lifecycle_status === 'active') ? 80 : 20,
      handoverReadiness: handovers.length ? (handovers.some((h) => h.status === 'pending_acceptance') ? 50 : 80) : null,
      singleOperatorRisk: singleOpRisk.risk === 'insufficient_data' ? null : singleOpRisk.risk === 'low' ? 90 : singleOpRisk.risk === 'moderate' ? 60 : singleOpRisk.risk === 'high' ? 30 : 10,
      incidentLoad: incidents.length ? Math.max(0, 100 - incidents.filter((i) => !i.resolved_at).length * 20) : null,
      continuityReadiness: null,
    }, {
      criticalUnassigned: openItems.some((i) => i.priority === 'critical' && !i.assigned_to),
      criticalSlaBreach: openItems.some((i) => i.priority === 'critical' && slaOf(i).status === 'breached'),
      criticalIncidentNoBackup: incidents.some((i) => i.severity === 'critical' && !i.resolved_at) && singleOpRisk.risk !== 'low',
      criticalBottleneck: bottleneck.level === 'critical_bottleneck',
      handoverBlocked: handovers.some((h) => h.status === 'declined'),
      noDecisionAuthority: false,
      singleOperatorCritical: singleOpRisk.risk === 'critical',
    });
  }, [items, openItems, slaOf, bottleneck, workloadByOperator, policies, handovers, singleOpRisk, incidents]);

  const report = useMemo(() => buildExecutiveSituationReport({
    openTotal: items.length ? openItems.length : (summary.open_total as number ?? null),
    unassigned: openItems.filter((i) => !i.assigned_to).length,
    criticalOpen: openItems.filter((i) => i.priority === 'critical').length,
    urgentOpen: openItems.filter((i) => i.priority === 'urgent').length,
    slaWarning: openItems.filter((i) => slaOf(i).status === 'warning').length,
    slaBreach: openItems.filter((i) => ['breached', 'response_overdue', 'resolution_overdue'].includes(slaOf(i).status)).length,
    bottleneckLevel: bottleneck.level,
    overloadedOperators: workloadByOperator.filter((w) => ['overloaded', 'critical_overload'].includes(w.cls.status)).length,
    activeIncidents: incidents.filter((i) => !i.resolved_at).length,
    rollbackRecommendations: 0, freezeRecommendations: 0, capacityCritical: 0, continuityCritical: 0,
    decisionsRequired: openItems.filter((i) => i.work_status === 'waiting_approval').map((i) => i.title.slice(0, 30)).slice(0, 5),
  }, now), [items, openItems, slaOf, bottleneck, workloadByOperator, incidents, summary, now]);

  const enrolledIncidentIds = useMemo(() => new Set(items.filter((i) => i.source_type === 'incident').map((i) => i.source_id)), [items]);

  if (loading) return <AdminCard title="AI Operational Command Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Operational Command Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Operational Command Center"
      subtitle="업무 등록 → 우선순위 → 배정 → SLA → 업무량 → Escalation → Handover → 경영진 보고 — 등록·추적·권고·보고만 (자동 배정/발송/실행 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Production 실행 엔진/외부 메시지 발송 엔진이 아닙니다. 자동 담당자 배정·자동 승인·자동 업무 완료·자동 Escalation·자동 Email/Slack/SMS/전화/Calendar 발송은 없으며, 외부 연락은 Reference 기록만 저장합니다. SLA 기준이 없으면 위반을 계산하지 않고(sla_not_defined), 근무시간 정보가 없으면 부재를 단정하지 않습니다(unknown). SLA 잔여 시간은 분 단위/수동 Refresh 입니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Open Work" value={NUM(summary.open_total as number)} />
          <Box label="Unassigned" value={NUM(summary.unassigned as number)} />
          <Box label="Critical" value={NUM(summary.critical_open as number)} />
          <Box label="Urgent" value={NUM(summary.urgent_open as number)} />
          <Box label="Waiting Approval" value={NUM(summary.waiting_approval as number)} />
          <Box label="Waiting Evidence" value={NUM(summary.waiting_evidence as number)} />
          <Box label="Escalated" value={NUM(summary.escalated as number)} />
          <Box label="Open Escalations" value={NUM(summary.open_escalations as number)} />
          <Box label="Pending Handovers" value={NUM(summary.pending_handovers as number)} />
          <Box label="Active Admins" value={NUM(summary.active_admins as number)} />
          <Box label="Single Operator Risk" value={singleOpRisk.risk} />
          <Box label="Operational Health" value={health.score == null ? 'insufficient_data' : `${health.score} (${health.status})`} />
        </div>
      )}

      {/* ── Work Queue ── */}
      {tab === 'queue' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Unified Work Queue" description="Source 원본을 복제하지 않고 참조만 등록합니다(source_type+source_id 중복 차단). 미확인 업무를 정상 처리로 표시하지 않습니다." />
          <div className="flex flex-wrap gap-1.5">
            <button disabled={busy} onClick={() => void act(() => enrollOpsWorkItem({
              work_item_code: `wi_manual_${now.getTime().toString(36)}`, source_type: 'manual_task', work_type: 'manual_follow_up',
              title: '수동 운영 점검(관리자 등록)', priority: 'normal', idempotency_key: `manual_${now.toISOString().slice(0, 13)}`,
              evidence: [{ label: 'manual', value: true }],
            }), 'Manual Task 등록')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ Manual Task</button>
            {incidents.filter((i) => !i.resolved_at && !enrolledIncidentIds.has(i.id)).slice(0, 3).map((i) => (
              <button key={i.id} disabled={busy} onClick={() => void act(() => enrollOpsWorkItem({
                work_item_code: `wi_inc_${i.incident_code}`, source_type: 'incident', source_id: i.id, work_type: 'incident_response',
                title: `Incident 대응: ${i.incident_code}`, priority: i.severity === 'critical' ? 'critical' : 'high', severity: i.severity,
                idempotency_key: `inc_${i.id}`, evidence: [{ label: 'incident', value: i.incident_code }],
              }), 'Incident 업무 등록')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ {i.incident_code} 등록</button>
            ))}
          </div>
          {!items.length ? <AdminEmpty icon={<ClipboardList size={20} />} title="Work Item 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Work</th><th className="px-2">Source</th><th className="px-2">Priority</th><th className="px-2">Status</th><th className="px-2">Owner</th><th className="px-2">SLA</th><th className="px-2">Age</th><th className="px-2" /></tr></thead>
                <tbody>
                  {items.map((w) => {
                    const sla = slaOf(w); const age = calculateWorkAge(w.created_at, now);
                    return (
                      <tr key={w.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-semibold">{w.title.slice(0, 30)}</td>
                        <td className="px-2 text-[10px]">{w.source_type}</td>
                        <td className="px-2"><AdminBadge tone={PRIORITY_TONE[w.priority as Priority] ?? 'neutral'}>{w.priority}</AdminBadge></td>
                        <td className="px-2"><AdminBadge tone={WSTATUS_TONE[w.work_status as WorkStatus] ?? 'neutral'}>{w.work_status}</AdminBadge></td>
                        <td className="px-2 text-[10px]">{w.assigned_to ? w.assigned_to.slice(0, 8) : <AdminBadge tone="warning">unassigned</AdminBadge>}</td>
                        <td className="px-2"><AdminBadge tone={SLA_TONE[sla.status]}>{sla.status}</AdminBadge></td>
                        <td className="px-2 text-[10px]">{age.bucket ?? '—'}</td>
                        <td className="px-2"><button disabled={busy} onClick={() => setSelItem(w)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">선택</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selItem && <AdminAlert tone="info" title={`선택됨: ${selItem.work_item_code}`} description="Triage/Ownership/SLA/Escalations 탭에서 이 업무를 처리하세요." />}
        </div>
      )}

      {/* ── Triage ── */}
      {tab === 'triage' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Triage — 상태/Priority Override" description="모든 변경은 사유 필수. Priority Override 는 이전/신규/사유/Actor 가 Audit 에 기록되며 AI 가 운영자 판단을 덮어쓰지 않습니다." />
          {!selItem ? <AdminEmpty icon={<Zap size={20} />} title="Work Queue 에서 업무 선택" /> : (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="triage 사유" />
              <div className="flex flex-wrap gap-1.5">
                {(['triage', 'in_progress', 'waiting_evidence', 'waiting_approval', 'blocked', 'resolved', 'completed_reference', 'rejected', 'cancelled'] as const).map((st) => (
                  <button key={st} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updateOpsWorkItem(selItem.id, 'status', { status: st }, r), `상태 → ${st}`); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                ))}
                <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updateOpsWorkItem(selItem.id, 'acknowledge', {}, r), '확인(acknowledge)'); setReason(''); }} className="rounded-md bg-accent px-2 py-1 text-[10px] font-bold text-black disabled:opacity-50">확인(Ack)</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['low', 'normal', 'high', 'urgent', 'critical'] as const).map((p) => (
                  <button key={p} disabled={busy || selItem.priority === p} onClick={() => { const r = needReason(); if (!r) return; void act(() => updateOpsWorkItem(selItem.id, 'priority_override', { priority: p }, r), `Priority Override → ${p}`); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-40">P:{p}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Ownership ── */}
      {tab === 'ownership' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Ownership (자동 배정 없음)" description="실존·활성 계정만 배정 가능(서버 검증). AI 는 추천 후보만 제시하며 배정은 사람이 사유와 함께 수행합니다. 담당자 없는 업무는 unassigned 로 정직 표시됩니다." />
          {!selItem ? <AdminEmpty icon={<UserCheck size={20} />} title="Work Queue 에서 업무 선택" /> : (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="배정 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="배정 사유" />
              {operators.map((o) => {
                const rec = recommendOwnership({ userActive: o.is_active, openAssigned: o.open_assigned, urgentAssigned: o.urgent_assigned, hasConflict: false, availabilityKnown: false });
                return (
                  <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <span className="font-semibold">{o.email}</span>
                    <AdminBadge tone={rec.result === 'recommended' ? 'success' : rec.result === 'overloaded' ? 'danger' : 'info'}>{rec.result}</AdminBadge>
                    <span className="text-[10px] text-muted-foreground">{rec.note} · availability {o.availability}</span>
                    <div className="ml-auto flex gap-1">
                      {(['owner', 'backup', 'reviewer', 'approver'] as const).map((role) => (
                        <button key={role} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => assignOpsWorkItem(selItem.id, role, o.id, r), `${role} 지정(사람)`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{role}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => assignOpsWorkItem(selItem.id, 'owner', null, r), '담당자 해제'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">담당자 해제</button>
            </>
          )}
        </div>
      )}

      {/* ── SLA ── */}
      {tab === 'sla' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="SLA (기준 없으면 위반 계산 안 함)" description="초기 SLA Policy 없음(임의 생성 안 함) — 관리자가 정책을 저장한 뒤 업무에 기한을 연결해야 추적됩니다. 잔여 시간은 분 단위(초 단위 타이머 없음)." />
          <button disabled={busy} onClick={() => void act(() => saveOpsPolicy({
            policy_code: 'sla_critical_default', policy_type: 'sla', work_type: 'incident_response', priority: 'critical',
            config: { response_target_minutes: 60, resolution_target_minutes: 480, escalation_after_minutes: 120, business_hours_only: false, timezone: 'Asia/Seoul' },
            lifecycle_status: 'draft', change_reason: '관리자 초안 — 운영 기준 확정 전 draft',
          }), 'SLA Policy 초안 저장(draft — 승인 필요)')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ Critical Incident SLA 초안(draft)</button>
          {policies.filter((p) => p.policy_type === 'sla').map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{p.policy_code}</span>
              <AdminBadge tone="neutral">v{p.version}</AdminBadge>
              <AdminBadge tone={p.lifecycle_status === 'active' ? 'success' : 'warning'}>{p.lifecycle_status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{JSON.stringify(p.config).slice(0, 60)}</span>
            </div>
          ))}
          {openItems.map((w) => {
            const sla = slaOf(w);
            return (
              <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{w.title.slice(0, 28)}</span>
                <AdminBadge tone={SLA_TONE[sla.status]}>{sla.status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{sla.remainingMinutes != null ? `잔여 ${sla.remainingMinutes}분` : sla.note}</span>
                {selItem?.id === w.id && sla.status !== 'sla_not_defined' && !w.sla_paused_at && (
                  <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updateOpsWorkItem(w.id, 'sla_pause', { pause_reason: 'waiting_external' }, r), 'SLA Pause(Audit)'); setReason(''); }} className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Pause</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Aging ── */}
      {tab === 'aging' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Aging" description="SLA 미정의 업무는 Aging 만 표시하고 SLA 위반으로 표기하지 않습니다." />
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {AGE_BUCKETS.map((b) => (
              <Box key={b} label={b} value={String(openItems.filter((i) => calculateWorkAge(i.created_at, now).bucket === b).length)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Workload ── */}
      {tab === 'workload' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Workload (provisional)" description="가중치(low1/normal2/high4/urgent7/critical10 + overdue/incident 가산)는 조직 기준 미확정으로 provisional 입니다. 업무 수만으로 과부하를 단정하지 않으며 근무 가능 시간 미확인 시 절대 수용량을 단정하지 않습니다." />
          {workloadByOperator.map(({ operator, wl, cls }) => (
            <div key={operator.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{operator.email}</span>
              <AdminBadge tone={WORKLOAD_TONE[cls.status]}>{cls.status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">weighted {wl.weightedLoad ?? '—'} · open {wl.openCount || operator.open_assigned} · critical {wl.criticalCount} · overdue {wl.overdueCount} · {cls.note}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Bottlenecks ── */}
      {tab === 'bottlenecks' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AdminBadge tone={bottleneck.level === 'critical_bottleneck' ? 'danger' : bottleneck.level === 'bottleneck' ? 'warning' : bottleneck.level === 'emerging' ? 'info' : bottleneck.level === 'no_known_bottleneck' ? 'success' : 'neutral'}>{bottleneck.level}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{bottleneck.signals.join(' · ') || '탐지된 신호 없음'}</span>
          </div>
          <AdminAlert tone="info" description={bottleneck.note} />
        </div>
      )}

      {/* ── Escalations ── */}
      {tab === 'escalations' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Escalation (자동 실행 없음)" description="권고/요청/확인 기록만 생성하며 메시지 발송 성공 상태는 존재하지 않습니다. 실제 연락은 외부 수동 절차로 수행 후 Reference 만 기록합니다." />
          {selItem && (() => {
            const sla = slaOf(selItem);
            const a = assessEscalation({ slaStatus: sla.status as SlaStatus, priority: selItem.priority as Priority, hasOwner: !!selItem.assigned_to, ownerActive: true, unacknowledgedMinutes: selItem.acknowledged_at ? 0 : calculateWorkAge(selItem.created_at, now).minutes, activeCriticalIncident: false, rollbackRecommended: false, freezeRecommended: false, dataSufficient: true });
            return <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-muted-foreground">권고(순수 로직):</span><AdminBadge tone={a.assessment.includes('urgent') ? 'danger' : a.assessment.includes('recommended') ? 'warning' : 'success'}>{a.assessment}</AdminBadge><span className="text-[10px] text-muted-foreground">{a.reasons.join(' · ')}</span></div>;
          })()}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Escalation 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="Escalation 사유" />
          {selItem && (
            <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => requestOpsEscalation({ work_item_id: selItem.id, trigger_type: 'manual', reason: r, evidence: [{ label: 'work', value: selItem.work_item_code }] }), 'Escalation 요청 기록'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Escalation 요청 기록</button>
          )}
          {escalations.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{(e.title ?? '').slice(0, 24)}</span>
              <AdminBadge tone="neutral">L{e.escalation_level}</AdminBadge>
              <AdminBadge tone={e.escalation_status === 'resolved_reference' ? 'success' : e.escalation_status === 'declined' ? 'neutral' : 'warning'}>{e.escalation_status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{e.trigger_type} · {e.reason.slice(0, 30)}</span>
              {['recommended', 'requested'].includes(e.escalation_status) && (
                <div className="ml-auto flex gap-1">
                  {(['acknowledged', 'declined', 'resolved_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => decideOpsEscalation(e.id, 'decision', { status: st }, r), `결정: ${st}`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st === 'acknowledged' ? '확인' : st === 'declined' ? '기각' : '해결 Ref'}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Notification References ── */}
      {tab === 'notifications' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Notification Reference (notification_unsupported)" description="발송 API 미연동 — 외부에서 수행한 연락의 참고 기록만 저장합니다(sent_by/sent_at 필수). 미지원 알림을 전송 완료로 표시하지 않습니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="reference 사유" />
          {escalations.slice(0, 5).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{(e.title ?? e.work_item_id).slice(0, 24)}</span>
                <span className="text-[10px] text-muted-foreground">기록 {e.notification_references.length}건</span>
                <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
                  void act(() => decideOpsEscalation(e.id, 'notification_reference', { channel: 'phone_reference', sent_by: 'ops(사람)', sent_at: now.toISOString(), recipient_reference: 'on-call', delivery_status: 'reported_by_human' }, r), '외부 연락 Reference 기록(발송 아님)'); setReason('');
                }} className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">외부 연락 Ref 기록</button>
              </div>
              {e.notification_references.map((n, i) => (
                <p key={i} className="mt-1 text-[10px] text-muted-foreground">{String((n as Record<string, unknown>).channel)} · by {String((n as Record<string, unknown>).sent_by)} · {String((n as Record<string, unknown>).sent_at).slice(0, 16)}</p>
              ))}
            </div>
          ))}
          {!escalations.length && <AdminEmpty icon={<FileText size={20} />} title="Escalation 없음" description="Reference 는 Escalation 에 연결되어 기록됩니다." />}
        </div>
      )}

      {/* ── Shifts ── */}
      {tab === 'shifts' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Shifts (provisional — 수동 등록)" description="근무 시스템 연동이 없어 수동 등록만 지원합니다. 자동 Shift 생성이 없습니다." />
          <button disabled={busy || !operators.length} onClick={() => void act(() => saveOpsShift({
            shift_code: `shift_${now.toISOString().slice(0, 10)}`, shift_date: now.toISOString().slice(0, 10),
            shift_start: now.toISOString(), shift_end: new Date(now.getTime() + 12 * 3600_000).toISOString(),
            primary_operator: operators[0].id, evidence: [{ label: 'manual', value: true }],
          }), 'Shift 초안 생성(수동)')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ 오늘 Shift 초안</button>
          {shifts.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{s.shift_code}</span>
              <AdminBadge tone="neutral">{s.status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{s.shift_start.slice(0, 16)} ~ {s.shift_end.slice(11, 16)} · primary {s.primary_operator.slice(0, 8)} · backup {s.backup_operator ? s.backup_operator.slice(0, 8) : '없음'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Handovers ── */}
      {tab === 'handovers' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Handover (수신자 확인 필수)" description="자동 인수 완료가 없습니다 — 수신 운영자가 확인해야 완료됩니다. Snapshot 은 미처리 Critical/Incident/승인 대기 실측 집계입니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Handover/수락 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="handover 사유" />
          <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => createOpsHandover({ handover_summary: r, evidence: [{ label: 'manual', value: true }] }), 'Handover 생성(수신 확인 대기)'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ Handover 생성</button>
          {handovers.map((h) => {
            const readiness = evaluateHandoverReadiness({
              toShiftExists: !!h.to_shift_id, toOperatorExists: !!h.to_shift_id || operators.length > 0,
              includesCriticalWork: 'critical_open' in h.snapshot, includesIncidents: 'active_incidents' in h.snapshot,
              includesPendingApprovals: 'waiting_approval' in h.snapshot, includesRollbackFreeze: 'rollback_recommendations' in h.snapshot,
              includesEscalations: 'open_escalations' in h.snapshot, hasEvidence: h.evidence.length > 0, hasLimitations: true,
            });
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{h.handover_summary.slice(0, 30)}</span>
                <AdminBadge tone={h.status === 'accepted' ? 'success' : h.status === 'declined' ? 'danger' : 'warning'}>{h.status}</AdminBadge>
                <AdminBadge tone={readiness.readiness === 'ready' ? 'success' : readiness.readiness === 'blocked' ? 'danger' : 'warning'}>{readiness.readiness}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">critical {h.snapshot.critical_open ?? '—'} · incidents {h.snapshot.active_incidents ?? '—'} · 승인 대기 {h.snapshot.waiting_approval ?? '—'}</span>
                {h.status === 'pending_acceptance' && (
                  <div className="ml-auto flex gap-1">
                    {(['accepted', 'declined', 'needs_evidence'] as const).map((a) => (
                      <button key={a} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => acceptOpsHandover(h.id, a, r), `Handover ${a}`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{a === 'accepted' ? '확인 수락' : a === 'declined' ? '거절' : '추가 Evidence'}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Availability ── */}
      {tab === 'availability' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Operator Availability" description={operatorNote || '근무시간/휴가 연동 없음 — unknown(임의 판단 금지)'} />
          {operators.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{o.email}</span>
              <AdminBadge tone={o.is_active ? 'success' : 'danger'}>{o.is_active ? 'active' : 'inactive'}</AdminBadge>
              <AdminBadge tone="neutral">{o.availability}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">open {o.open_assigned} · urgent {o.urgent_assigned}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Single Operator Risk ── */}
      {tab === 'singleop' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={singleOpRisk.risk === 'critical' ? 'danger' : singleOpRisk.risk === 'high' ? 'danger' : singleOpRisk.risk === 'moderate' ? 'warning' : singleOpRisk.risk === 'low' ? 'success' : 'neutral'}>{singleOpRisk.risk}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{singleOpRisk.factors.join(' · ') || '위험 요인 없음'}</span>
          </div>
          <AdminAlert tone="warning" description="단일 관리자 환경을 정직하게 표시하며 자동 조치는 없습니다. Backup 운영자 확보/연락 대체 수단/운영 문서화가 필요합니다." />
        </div>
      )}

      {/* ── Emergency ── */}
      {tab === 'emergency' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Emergency Operations (실행 없음 — Reference 만)" description="시스템이 Emergency Mode 를 실행하지 않습니다. Enable Emergency Mode/Block Deployments/Disable System/Stop Playback·Scheduler/Lock Queue/Execute Rollback/Send Notification 버튼은 존재하지 않습니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reference 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="emergency 사유" />
          <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => recordOpsEmergencyReference({
            reference_code: `em_${now.toISOString().slice(0, 10)}`, mode_status: 'heightened_monitoring', scope: 'global',
            activation_trigger: r, decision_authority: 'super_admin(사람)', reason: r,
            expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(), evidence: [{ label: 'manual', value: true }],
          }), '외부 운영 정책 Reference 기록(실행 아님)'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">외부 Emergency 정책 Reference 기록</button>
          {emergencies.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{e.reference_code}</span>
              <AdminBadge tone={e.mode_status.includes('emergency') ? 'danger' : e.mode_status === 'normal' ? 'success' : 'warning'}>{e.mode_status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">scope {e.scope} · authority {e.decision_authority} · 만료 {e.expires_at ? e.expires_at.slice(0, 16) : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Executive Report ── */}
      {tab === 'report' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Executive Situation Report" description="보고서는 참고 자료이며 실제 조치 결과가 아닙니다." />
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {report.map((p) => (
              <div key={p.section} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{p.section}</p>
                <p className="mt-0.5 break-all text-[11px]">{typeof p.content === 'string' || typeof p.content === 'number' ? String(p.content) : JSON.stringify(p.content).slice(0, 160)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Health ── */}
      {tab === 'health' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black">{health.score ?? '—'}</span>
            <AdminBadge tone={HEALTH_TONE[health.status]}>{health.status}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{health.reasons.join(' · ')}</span>
          </div>
          <AdminAlert tone="info" description="없는 성분은 제외 후 재정규화합니다. Score 가 높아도 자동 승인/자동 실행 권한은 없습니다." />
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Work Recommendations (자동 실행 없음)" description="권고는 Reason/Confidence/Expected Benefit/Preconditions 를 포함하며 자동 배정/발송이 없습니다." />
          {openItems.slice(0, 10).map((w) => {
            const sla = slaOf(w);
            const r = buildWorkRecommendation({
              unassigned: !w.assigned_to, slaStatus: sla.status as SlaStatus, priority: w.priority as Priority,
              acknowledged: !!w.acknowledged_at, workloadStatus: 'balanced',
              hasSlaPolicy: policies.some((p) => p.policy_type === 'sla'), hasEscalationPolicy: policies.some((p) => p.policy_type === 'escalation'),
            });
            return (
              <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{w.title.slice(0, 26)}</span>
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{r.reason} · confidence {r.confidence ?? '—'}</span>
              </div>
            );
          })}
          {!openItems.length && <AdminEmpty icon={<Zap size={20} />} title="Open 업무 없음" />}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : audit.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
              <AdminBadge tone={a.event_type.includes('escalation') ? 'warning' : a.event_type.includes('emergency') ? 'danger' : 'neutral'}>{a.event_type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{(a.detail ?? '').slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>{OPS_SUPPORT.map((s) => (
              <tr key={s.key} className="border-b border-border/50">
                <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' || s.status === 'notification_unsupported' ? 'danger' : ['insufficient_data', 'sla_not_defined', 'unassigned'].includes(s.status) ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
              </tr>
            ))}</tbody>
          </table>
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
