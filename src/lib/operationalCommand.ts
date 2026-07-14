/**
 * operationalCommand — Operational Command Center, Workload Intelligence,
 * Escalation Governance & Business Continuity Operations 순수 로직 (Phase AI-OPS-6).
 *
 * AI Operations Sources → Work Items → Priority → Ownership → SLA → Workload →
 * Escalation → Handover → Executive Report → 사람 결정 → Evidence/Audit.
 * Production 실행 엔진/외부 메시지 자동 발송 엔진이 아님.
 *
 * 원칙: 자동 배정/승인/완료/Escalation/발송 없음 · 담당자 없는 업무를 배정 완료로 표시 금지 ·
 *       SLA 기준 없으면 위반 계산 금지(sla_not_defined) · 근무시간 정보 없으면 부재 단정 금지 ·
 *       단일 긴급 업무만으로 팀 과부하 단정 금지 · null→0 없음 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const OPSCMD_SOURCE_VERSION = 'opscmd_v1(0509)';

/* ── Whitelists ─────────────────────────────────────────────────────────── */
export const WORK_SOURCES = ['ai_operation', 'execution_plan', 'post_change_observation', 'reliability_decision', 'capacity_plan', 'incident', 'recovery_candidate', 'governance_event', 'production_change_candidate', 'manual_task'] as const;
export const UNSUPPORTED_SOURCES = ['playlist_draft', 'settlement_review', 'contract_review', 'content_review', 'support_ticket'];
export const WORK_TYPES = ['review', 'approval', 'investigation', 'incident_response', 'recovery_review', 'execution_preparation', 'observation', 'certification', 'reliability_review', 'capacity_review', 'cost_review', 'continuity_review', 'governance_review', 'manual_follow_up'] as const;
export type WorkStatus = 'new' | 'triage' | 'assigned' | 'acknowledged' | 'in_progress' | 'waiting_evidence' | 'waiting_approval' | 'waiting_external' | 'blocked' | 'escalated' | 'resolved' | 'completed_reference' | 'rejected' | 'cancelled' | 'expired' | 'invalidated';
export const WORK_STATUSES: WorkStatus[] = ['new', 'triage', 'assigned', 'acknowledged', 'in_progress', 'waiting_evidence', 'waiting_approval', 'waiting_external', 'blocked', 'escalated', 'resolved', 'completed_reference', 'rejected', 'cancelled', 'expired', 'invalidated'];
export const FORBIDDEN_WORK_STATUSES = ['auto_completed', 'auto_approved', 'production_applied', 'deployed', 'executed', 'rolled_back'];
export const OPEN_STATUSES: WorkStatus[] = ['new', 'triage', 'assigned', 'acknowledged', 'in_progress', 'waiting_evidence', 'waiting_approval', 'waiting_external', 'blocked', 'escalated'];
export type Priority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent', 'critical'];

export interface WorkItemLike { work_item_code?: unknown; source_type?: unknown; source_id?: unknown; work_type?: unknown; title?: unknown; evidence?: unknown; idempotency_key?: unknown }
export function validateWorkItem(w: WorkItemLike | null): string[] {
  if (!w) return ['work item 없음'];
  const errors: string[] = [];
  if (!w.work_item_code) errors.push('work_item_code 필수');
  if (!WORK_SOURCES.includes(w.source_type as (typeof WORK_SOURCES)[number])) errors.push(`source ${String(w.source_type)} 미지원(whitelist)`);
  if (w.source_type !== 'manual_task' && !w.source_id) errors.push('source_id 필수(존재하지 않는 업무 등록 금지)');
  if (!WORK_TYPES.includes(w.work_type as (typeof WORK_TYPES)[number])) errors.push('work_type whitelist 위반');
  if (!w.title) errors.push('title 필수');
  if (!Array.isArray(w.evidence) || w.evidence.length === 0) errors.push('evidence 필수');
  if (!w.idempotency_key) errors.push('idempotency_key 필수');
  return errors;
}

/* ── Priority(성분 재정규화 · 임의 지정 없음) ───────────────────────────── */
export interface PriorityComponents {
  severityRisk: number | null; businessImpact: number | null; urgency: number | null; affectedStores: number | null;
  activeIncident: number | null; sloBreach: number | null; errorBudget: number | null; rollbackRecommended: number | null; deadlineProximity: number | null;
}
export function calculateWorkPriority(c: PriorityComponents): { priority: Priority | 'insufficient_data'; score: number | null; missing: string[] } {
  const weights: Record<keyof PriorityComponents, number> = {
    severityRisk: 20, businessImpact: 16, urgency: 14, affectedStores: 10, activeIncident: 14, sloBreach: 10, errorBudget: 6, rollbackRecommended: 6, deadlineProximity: 4,
  };
  const comps = (Object.keys(weights) as Array<keyof PriorityComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (base.score === null) return { priority: 'insufficient_data', score: null, missing: base.missing };
  const priority: Priority = base.score >= 85 ? 'critical' : base.score >= 65 ? 'urgent' : base.score >= 45 ? 'high' : base.score >= 20 ? 'normal' : 'low';
  return { priority, score: base.score, missing: base.missing };
}
export function validatePriorityOverride(o: { previous?: unknown; next?: unknown; reason?: unknown; actor?: unknown } | null): string[] {
  if (!o) return ['override 없음'];
  const errors: string[] = [];
  if (!PRIORITIES.includes(o.previous as Priority)) errors.push('previous priority 필수');
  if (!PRIORITIES.includes(o.next as Priority)) errors.push('new priority whitelist 위반');
  if (!o.reason) errors.push('reason 필수(사유 없는 Override 금지)');
  if (!o.actor) errors.push('actor 필수 — AI 자동 Override 없음');
  return errors;
}

/* ── Assignment(실존·활성 계정만 · 자동 배정 없음) ──────────────────────── */
export interface AssignmentInput { userExists: boolean; userActive: boolean; role: string; sameAsOwner?: boolean; sameAsReviewer?: boolean; scopeAllowed?: boolean }
export function validateAssignment(inp: AssignmentInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  if (!['owner', 'backup', 'reviewer', 'approver'].includes(inp.role)) errors.push('role whitelist 위반');
  if (!inp.userExists) errors.push('담당자 계정 미존재 — 없는 담당자를 배정 완료로 표시 금지');
  else if (!inp.userActive) errors.push('비활성 계정 배정 금지');
  if (inp.scopeAllowed === false) errors.push('scope 권한 없음');
  if (inp.role === 'approver' && inp.sameAsOwner) warnings.push('Owner=Approver 자기 승인 위험');
  if (inp.role === 'approver' && inp.sameAsReviewer) warnings.push('Reviewer=Approver 동일 — 분리 권장');
  if (inp.role === 'backup' && inp.sameAsOwner) warnings.push('Backup=Owner 동일 — 백업 의미 없음');
  return { errors, warnings };
}
export type OwnershipRecommendation = 'recommended' | 'available' | 'overloaded' | 'conflict' | 'unavailable' | 'insufficient_data';
export function recommendOwnership(inp: { userActive: boolean | null; openAssigned: number | null; urgentAssigned: number | null; hasConflict: boolean; availabilityKnown: boolean; unavailableConfirmed?: boolean }): { result: OwnershipRecommendation; note: string } {
  if (inp.userActive === null) return { result: 'insufficient_data', note: '계정 정보 없음' };
  if (!inp.userActive) return { result: 'unavailable', note: '비활성 계정' };
  if (inp.hasConflict) return { result: 'conflict', note: 'Role 충돌(자기 승인 등)' };
  if (!inp.availabilityKnown && inp.unavailableConfirmed !== true) {
    // 근무시간/휴가 데이터 없으면 unavailable 을 단정하지 않음
    if (!isFiniteNumber(inp.openAssigned)) return { result: 'insufficient_data', note: '업무량 데이터 없음' };
  }
  if (inp.unavailableConfirmed === true) return { result: 'unavailable', note: '부재 확인됨(외부 기록)' };
  if (!isFiniteNumber(inp.openAssigned)) return { result: 'insufficient_data', note: '업무량 데이터 없음' };
  if (inp.openAssigned >= 15 || (isFiniteNumber(inp.urgentAssigned) && inp.urgentAssigned >= 5)) return { result: 'overloaded', note: `open ${inp.openAssigned} · urgent ${inp.urgentAssigned ?? 0}` };
  if (inp.openAssigned <= 5) return { result: 'recommended', note: `open ${inp.openAssigned}` };
  return { result: 'available', note: `open ${inp.openAssigned}` };
}

/* ── SLA(기준 없으면 위반 계산 금지) ────────────────────────────────────── */
export type SlaStatus = 'on_track' | 'warning' | 'response_overdue' | 'resolution_overdue' | 'breached' | 'paused' | 'sla_not_defined' | 'insufficient_data';
export interface SlaInput {
  responseDueAt: string | null; resolutionDueAt: string | null; acknowledgedAt: string | null; completedAt: string | null;
  pausedAt: string | null; now: Date; warningThresholdPct?: number;
}
export function calculateSlaStatus(inp: SlaInput): { status: SlaStatus; remainingMinutes: number | null; note: string } {
  if (!inp.responseDueAt && !inp.resolutionDueAt) return { status: 'sla_not_defined', remainingMinutes: null, note: 'SLA 기준 미정의 — 위반 계산하지 않음' };
  if (inp.pausedAt) return { status: 'paused', remainingMinutes: null, note: 'SLA 일시 정지(Audit 기록)' };
  const nowMs = inp.now.getTime();
  const parse = (s: string | null) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
  const respDue = parse(inp.responseDueAt); const resDue = parse(inp.resolutionDueAt);
  if (respDue === null && resDue === null) return { status: 'insufficient_data', remainingMinutes: null, note: '기한 파싱 불가' };
  if (!inp.completedAt) {
    if (respDue !== null && !inp.acknowledgedAt && nowMs > respDue) {
      if (resDue !== null && nowMs > resDue) return { status: 'breached', remainingMinutes: Math.round((resDue - nowMs) / 60000), note: '응답+해결 기한 모두 초과' };
      return { status: 'response_overdue', remainingMinutes: resDue !== null ? Math.round((resDue - nowMs) / 60000) : null, note: '응답 기한 초과' };
    }
    if (resDue !== null && nowMs > resDue) return { status: 'resolution_overdue', remainingMinutes: Math.round((resDue - nowMs) / 60000), note: '해결 기한 초과' };
    const target = resDue ?? respDue!;
    const remaining = Math.round((target - nowMs) / 60000);
    const warnPct = inp.warningThresholdPct ?? 20;
    const warnWindowMinutes = (24 * 60 * warnPct) / 100; // 24h 기준창의 warnPct% 이내면 임박
    if (remaining <= warnWindowMinutes) return { status: 'warning', remainingMinutes: remaining, note: '기한 임박' };
    return { status: 'on_track', remainingMinutes: remaining, note: '' };
  }
  const doneMs = parse(inp.completedAt)!;
  if (resDue !== null && doneMs > resDue) return { status: 'breached', remainingMinutes: 0, note: '해결 기한 초과 후 완료' };
  return { status: 'on_track', remainingMinutes: 0, note: '기한 내 완료' };
}
export const SLA_PAUSE_REASONS = ['waiting_evidence', 'waiting_external', 'waiting_approval', 'maintenance_window', 'legal_hold', 'customer_response'];
export function validateSlaPause(reason: string | null, alreadyPaused: boolean): string[] {
  const errors: string[] = [];
  if (!reason || !SLA_PAUSE_REASONS.includes(reason)) errors.push('pause 사유 whitelist 위반');
  if (alreadyPaused) errors.push('이미 pause — 무제한 중첩 pause 금지(수동 review 필요)');
  return errors;
}

/* ── Aging ──────────────────────────────────────────────────────────────── */
export const AGE_BUCKETS = ['0-1h', '1-4h', '4-24h', '1-3d', '3-7d', '7d+'] as const;
export function calculateWorkAge(createdAt: string | null, now: Date): { minutes: number | null; bucket: (typeof AGE_BUCKETS)[number] | null } {
  if (!createdAt) return { minutes: null, bucket: null };
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return { minutes: null, bucket: null };
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60000));
  const bucket = minutes <= 60 ? '0-1h' : minutes <= 240 ? '1-4h' : minutes <= 1440 ? '4-24h' : minutes <= 4320 ? '1-3d' : minutes <= 10080 ? '3-7d' : '7d+';
  return { minutes, bucket };
}

/* ── Workload(업무 수만으로 과부하 단정 없음) ───────────────────────────── */
export const PRIORITY_WEIGHTS: Record<Priority, number> = { low: 1, normal: 2, high: 4, urgent: 7, critical: 10 };
export interface WorkloadItem { priority: Priority; status: WorkStatus; overdue: boolean; isIncident: boolean }
export function calculateWeightedWorkload(items: WorkloadItem[]): { weightedLoad: number | null; openCount: number; criticalCount: number; overdueCount: number; provisional: true } {
  const open = items.filter((i) => OPEN_STATUSES.includes(i.status));
  if (!open.length) return { weightedLoad: open.length === items.length && !items.length ? null : 0, openCount: 0, criticalCount: 0, overdueCount: 0, provisional: true };
  let load = 0;
  for (const i of open) {
    let w = PRIORITY_WEIGHTS[i.priority];
    if (i.overdue) w += 3;
    if (i.isIncident) w += 2;
    if (['waiting_evidence', 'waiting_external', 'waiting_approval'].includes(i.status)) w = Math.max(1, w - 1); // 대기 상태 감점
    load += w;
  }
  return {
    weightedLoad: load, openCount: open.length,
    criticalCount: open.filter((i) => i.priority === 'critical').length,
    overdueCount: open.filter((i) => i.overdue).length,
    provisional: true, // 조직 기준 가중치 미정 — provisional
  };
}
export type WorkloadStatus = 'available' | 'balanced' | 'busy' | 'overloaded' | 'critical_overload' | 'insufficient_data';
export function classifyWorkload(inp: { weightedLoad: number | null; criticalCount: number; overdueCount: number; availabilityKnown: boolean }): { status: WorkloadStatus; note: string } {
  if (inp.weightedLoad === null) return { status: 'insufficient_data', note: '업무량 데이터 없음(과부하 판정 안 함)' };
  const note = inp.availabilityKnown ? '' : '근무 가능 시간 미확인 — 절대 수용량 단정 아님(provisional)';
  // 단일 긴급 업무만으로 과부하 단정하지 않음 — critical 1건 + 낮은 총 load 는 busy 까지만.
  if (inp.criticalCount >= 3 || (inp.weightedLoad >= 60 && inp.overdueCount >= 3)) return { status: 'critical_overload', note };
  if (inp.weightedLoad >= 40 || (inp.criticalCount >= 2 && inp.overdueCount >= 1)) return { status: 'overloaded', note };
  if (inp.weightedLoad >= 20 || inp.criticalCount >= 1) return { status: 'busy', note };
  if (inp.weightedLoad >= 6) return { status: 'balanced', note };
  return { status: 'available', note };
}

/* ── Approval Bottleneck ────────────────────────────────────────────────── */
export type BottleneckLevel = 'no_known_bottleneck' | 'emerging' | 'bottleneck' | 'critical_bottleneck' | 'insufficient_data';
export interface BottleneckInput {
  waitingApprovalCount: number | null; longWaitingApprovalCount: number; distinctApprovers: number | null;
  singleApproverDependency: boolean; dualApprovalUnmet: number; repeatedRejections: number;
  reviewerEqualsApprover: number; inactiveAssignee: number;
}
export function detectApprovalBottleneck(inp: BottleneckInput): { level: BottleneckLevel; signals: string[]; note: string } {
  const note = 'no_known_bottleneck 은 병목 부재 보장이 아니라 현재 Evidence 미확인이라는 뜻';
  if (inp.waitingApprovalCount === null) return { level: 'insufficient_data', signals: [], note };
  const signals: string[] = [];
  if (inp.longWaitingApprovalCount > 0) signals.push(`장기 승인 대기 ${inp.longWaitingApprovalCount}건`);
  if (inp.singleApproverDependency) signals.push('단일 Approver 의존');
  if (inp.dualApprovalUnmet > 0) signals.push(`dual approval 미충족 ${inp.dualApprovalUnmet}건`);
  if (inp.repeatedRejections >= 2) signals.push('반복 반려');
  if (inp.reviewerEqualsApprover > 0) signals.push('Reviewer=Approver 동일');
  if (inp.inactiveAssignee > 0) signals.push('비활성 계정 배정');
  if ((inp.longWaitingApprovalCount >= 3 && inp.singleApproverDependency) || inp.inactiveAssignee > 0) return { level: 'critical_bottleneck', signals, note };
  if (signals.length >= 2) return { level: 'bottleneck', signals, note };
  if (signals.length === 1) return { level: 'emerging', signals, note };
  return { level: 'no_known_bottleneck', signals, note };
}

/* ── Escalation(권고만 — 자동 실행 없음) ────────────────────────────────── */
export type EscalationAssessment = 'no_escalation' | 'escalation_recommended' | 'urgent_escalation_recommended' | 'manual_review_required' | 'insufficient_data';
export interface EscalationInput {
  slaStatus: SlaStatus; priority: Priority | 'insufficient_data'; hasOwner: boolean; ownerActive: boolean;
  unacknowledgedMinutes: number | null; activeCriticalIncident: boolean; rollbackRecommended: boolean; freezeRecommended: boolean; dataSufficient: boolean;
}
export function assessEscalation(inp: EscalationInput): { assessment: EscalationAssessment; reasons: string[]; noAutoExecution: true } {
  const done = (assessment: EscalationAssessment, reasons: string[]) => {
    reasons.push('권고만 — 자동 Escalation/자동 연락 발송 없음(사람 결정 필요)');
    return { assessment, reasons, noAutoExecution: true as const };
  };
  if (!inp.dataSufficient) return done('insufficient_data', ['데이터 부족']);
  if (inp.hasOwner && !inp.ownerActive) return done('manual_review_required', ['배정된 담당자 비활성']);
  if (inp.slaStatus === 'breached' || (inp.priority === 'critical' && !inp.hasOwner) || inp.activeCriticalIncident) {
    return done('urgent_escalation_recommended', ['SLA breach/critical 미배정/critical incident']);
  }
  if (['response_overdue', 'resolution_overdue'].includes(inp.slaStatus) || inp.rollbackRecommended || inp.freezeRecommended
      || (isFiniteNumber(inp.unacknowledgedMinutes) && inp.unacknowledgedMinutes > 240 && ['urgent', 'critical'].includes(inp.priority as string))) {
    return done('escalation_recommended', ['기한 초과/rollback·freeze 권고/장기 미확인']);
  }
  return done('no_escalation', []);
}
export const ESCALATION_DECISIONS = ['escalation_requested', 'target_changed', 'escalation_declined', 'resolved_without_escalation', 'escalation_acknowledged', 'invalidated'];
export function validateEscalationDecision(d: { decision?: unknown; reason?: unknown } | null): string[] {
  if (!d) return ['decision 없음'];
  const errors: string[] = [];
  if (!ESCALATION_DECISIONS.includes(d.decision as string)) errors.push('decision whitelist 위반');
  if (!d.reason) errors.push('reason 필수');
  return errors;
}

/* ── Notification Reference(발송 없음 — 참고 기록만) ────────────────────── */
export const NOTIFICATION_CHANNELS = ['email_reference', 'slack_reference', 'sms_reference', 'phone_reference', 'messenger_reference', 'in_app_reference'];
export function validateNotificationReference(r: { channel?: unknown; sent_by?: unknown; sent_at?: unknown } | null): { errors: string[]; sendNotSupported: true } {
  const errors: string[] = [];
  if (!r) errors.push('reference 없음');
  else {
    if (!NOTIFICATION_CHANNELS.includes(r.channel as string)) errors.push('channel whitelist 위반(참고 기록 전용 — 발송 API 없음)');
    if (!r.sent_by) errors.push('sent_by 필수(외부에서 수행한 사람)');
    if (!r.sent_at) errors.push('sent_at 필수');
  }
  return { errors, sendNotSupported: true };
}

/* ── Handover Readiness(수신자 확인 필수) ───────────────────────────────── */
export type HandoverReadiness = 'ready' | 'partially_ready' | 'blocked' | 'insufficient_data';
export interface HandoverInput {
  toShiftExists: boolean; toOperatorExists: boolean; includesCriticalWork: boolean; includesIncidents: boolean;
  includesPendingApprovals: boolean; includesRollbackFreeze: boolean; includesEscalations: boolean; hasEvidence: boolean; hasLimitations: boolean;
}
export function evaluateHandoverReadiness(inp: HandoverInput): { readiness: HandoverReadiness; gaps: string[]; requiresAcceptance: true } {
  const gaps: string[] = [];
  if (!inp.toShiftExists) gaps.push('수신 Shift 없음');
  if (!inp.toOperatorExists) gaps.push('수신 운영자 없음');
  if (!inp.includesCriticalWork) gaps.push('Critical 업무 미포함');
  if (!inp.includesIncidents) gaps.push('Active Incident 미포함');
  if (!inp.includesPendingApprovals) gaps.push('Pending Approval 미포함');
  if (!inp.includesRollbackFreeze) gaps.push('Rollback/Freeze 권고 미포함');
  if (!inp.includesEscalations) gaps.push('Escalation 상태 미포함');
  if (!inp.hasEvidence) gaps.push('Evidence 미포함');
  if (!inp.hasLimitations) gaps.push('제한사항 미포함');
  if (!inp.toShiftExists || !inp.toOperatorExists) return { readiness: 'blocked', gaps, requiresAcceptance: true };
  if (gaps.length === 0) return { readiness: 'ready', gaps, requiresAcceptance: true };
  if (gaps.length <= 3) return { readiness: 'partially_ready', gaps, requiresAcceptance: true };
  return { readiness: 'blocked', gaps, requiresAcceptance: true };
}

/* ── Operator Availability / Single Operator Risk ───────────────────────── */
export type OperatorAvailability = 'active' | 'inactive' | 'on_shift' | 'off_shift' | 'unavailable_reference' | 'unknown';
export function resolveOperatorAvailability(inp: { isActive: boolean | null; shiftKnown: boolean; onShift?: boolean; unavailableReference?: boolean }): OperatorAvailability {
  if (inp.isActive === null) return 'unknown';
  if (!inp.isActive) return 'inactive';
  if (inp.unavailableReference) return 'unavailable_reference'; // 외부 기록 근거만 — AI 임의 판단 없음
  if (!inp.shiftKnown) return 'unknown';
  return inp.onShift ? 'on_shift' : 'off_shift';
}
export type SingleOperatorRisk = 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
export interface SingleOperatorInput {
  activeAdminCount: number | null; criticalWithoutBackup: number; singleApprover: boolean;
  allShiftsSameOperator: boolean; hasBackupContact: boolean; handoverSupported: boolean; hasOpsDocs: boolean;
}
export function assessSingleOperatorRisk(inp: SingleOperatorInput): { risk: SingleOperatorRisk; factors: string[]; noAutoAction: true } {
  if (inp.activeAdminCount === null) return { risk: 'insufficient_data', factors: [], noAutoAction: true };
  const factors: string[] = [];
  if (inp.activeAdminCount <= 1) factors.push('활성 관리자 1명');
  if (inp.criticalWithoutBackup > 0) factors.push(`critical 업무 backup 없음 ${inp.criticalWithoutBackup}건`);
  if (inp.singleApprover) factors.push('Approver 1명');
  if (inp.allShiftsSameOperator) factors.push('모든 Shift 동일 운영자');
  if (!inp.hasBackupContact) factors.push('연락 대체 수단 없음');
  if (!inp.handoverSupported) factors.push('Handover 미지원');
  if (!inp.hasOpsDocs) factors.push('운영 문서 없음');
  const risk: SingleOperatorRisk =
    inp.activeAdminCount <= 1 && factors.length >= 3 ? 'critical'
    : inp.activeAdminCount <= 1 ? 'high'
    : factors.length >= 3 ? 'high'
    : factors.length >= 1 ? 'moderate'
    : 'low';
  return { risk, factors, noAutoAction: true }; // 정직 표시만 — 자동 조치 없음
}

/* ── Emergency Operations(실행 없음 — Reference 만) ─────────────────────── */
export const EMERGENCY_MODES = ['normal', 'heightened_monitoring', 'restricted_changes', 'emergency_operations_requested', 'emergency_reference_active', 'recovery_transition', 'invalidated'];
export function evaluateEmergencyReadiness(plan: { decision_authority?: unknown; scope?: unknown; activation_trigger?: unknown; expires_at?: unknown } | null): { errors: string[]; executionBlocked: true } {
  const errors: string[] = [];
  if (!plan) errors.push('emergency plan 없음');
  else {
    if (!plan.decision_authority) errors.push('Decision Authority 필수(사람)');
    if (!plan.scope) errors.push('Scope 필수');
    if (!plan.activation_trigger) errors.push('Activation Trigger 필수');
  }
  return { errors, executionBlocked: true }; // 시스템이 Emergency Mode 를 실행하지 않음
}

/* ── Executive Situation Report(참고 자료 — 조치 아님) ──────────────────── */
export interface SituationInput {
  openTotal: number | null; unassigned: number; criticalOpen: number; urgentOpen: number;
  slaWarning: number; slaBreach: number; bottleneckLevel: BottleneckLevel; overloadedOperators: number;
  activeIncidents: number; rollbackRecommendations: number; freezeRecommendations: number;
  capacityCritical: number; continuityCritical: number; decisionsRequired: string[];
}
export function buildExecutiveSituationReport(inp: SituationInput, now: Date): Array<{ section: string; content: unknown }> {
  return [
    { section: 'Overall Operational Status', content: inp.openTotal === null ? 'insufficient_data' : `open ${inp.openTotal} · unassigned ${inp.unassigned}` },
    { section: 'Critical Work', content: `critical ${inp.criticalOpen} · urgent ${inp.urgentOpen}` },
    { section: 'Active Incidents', content: inp.activeIncidents },
    { section: 'SLA Risks', content: `warning ${inp.slaWarning} · breach ${inp.slaBreach}` },
    { section: 'Approval Bottlenecks', content: inp.bottleneckLevel },
    { section: 'Unassigned Work', content: inp.unassigned },
    { section: 'Overloaded Operators', content: inp.overloadedOperators },
    { section: 'Rollback Recommendations', content: inp.rollbackRecommendations },
    { section: 'Freeze Recommendations', content: inp.freezeRecommendations },
    { section: 'Capacity Risks', content: inp.capacityCritical },
    { section: 'Continuity Risks', content: inp.continuityCritical },
    { section: 'Decisions Required', content: inp.decisionsRequired },
    { section: 'Next Review Time', content: new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 16) },
    { section: 'Limitations', content: ['본 보고서는 참고 자료 — 실제 조치 결과가 아님', '단일 관리자 환경 — Reviewer 분리 제한'] },
  ];
}

/* ── Operational Health(재정규화 · 자동 실행 권한 없음) ─────────────────── */
export interface HealthComponents {
  workQueueHealth: number | null; ownershipCoverage: number | null; slaHealth: number | null; approvalFlow: number | null;
  workloadBalance: number | null; escalationReadiness: number | null; handoverReadiness: number | null;
  singleOperatorRisk: number | null; incidentLoad: number | null; continuityReadiness: number | null;
}
export type HealthStatus = 'healthy' | 'stable' | 'strained' | 'critical' | 'insufficient_data';
export function calculateOperationalHealth(c: HealthComponents, ctx: { criticalUnassigned: boolean; criticalSlaBreach: boolean; criticalIncidentNoBackup: boolean; criticalBottleneck: boolean; handoverBlocked: boolean; noDecisionAuthority: boolean; singleOperatorCritical: boolean }): {
  score: number | null; status: HealthStatus; reasons: string[]; noExecutionAuthority: true;
} {
  const criticals: string[] = [];
  if (ctx.criticalUnassigned) criticals.push('critical 업무 미배정');
  if (ctx.criticalSlaBreach) criticals.push('critical SLA breach');
  if (ctx.criticalIncidentNoBackup) criticals.push('critical incident + backup 없음');
  if (ctx.criticalBottleneck) criticals.push('approval critical bottleneck');
  if (ctx.handoverBlocked) criticals.push('handover blocked');
  if (ctx.noDecisionAuthority) criticals.push('emergency decision authority 없음');
  if (ctx.singleOperatorCritical) criticals.push('single operator critical risk');
  const weights: Record<keyof HealthComponents, number> = {
    workQueueHealth: 14, ownershipCoverage: 12, slaHealth: 12, approvalFlow: 10, workloadBalance: 10,
    escalationReadiness: 8, handoverReadiness: 8, singleOperatorRisk: 10, incidentLoad: 8, continuityReadiness: 8,
  };
  const comps = (Object.keys(weights) as Array<keyof HealthComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (base.score === null) return { score: null, status: 'insufficient_data', reasons: ['성분 데이터 없음'], noExecutionAuthority: true };
  if (criticals.length > 0) return { score: base.score, status: 'critical', reasons: criticals, noExecutionAuthority: true };
  const status: HealthStatus = base.score >= 80 ? 'healthy' : base.score >= 60 ? 'stable' : base.score >= 40 ? 'strained' : 'critical';
  return { score: base.score, status, reasons: [], noExecutionAuthority: true }; // 높아도 자동 승인/실행 권한 없음
}

/* ── Work Recommendation(자동 실행 없음) ────────────────────────────────── */
export type WorkRecommendationType = 'assign_owner' | 'assign_backup' | 'request_acknowledgement' | 'request_evidence' | 'prioritize_review' | 'escalate_review' | 'reduce_workload' | 'redistribute_work' | 'create_handover' | 'define_sla' | 'define_escalation_policy' | 'continuity_review' | 'emergency_plan_review' | 'insufficient_data';
export function buildWorkRecommendation(inp: { unassigned: boolean; slaStatus: SlaStatus; priority: Priority | 'insufficient_data'; acknowledged: boolean; workloadStatus: WorkloadStatus; hasSlaPolicy: boolean; hasEscalationPolicy: boolean }): {
  type: WorkRecommendationType; reason: string; confidence: number | null; expectedBenefit: string; preconditions: string[]; limitations: string[]; noExecution: true;
} {
  const base = { confidence: 60, preconditions: ['관리자 검토'], limitations: ['권고만 — 자동 실행/자동 배정/자동 발송 없음'], noExecution: true as const };
  if (inp.priority === 'insufficient_data') return { ...base, type: 'insufficient_data', reason: 'priority 판정 데이터 부족', confidence: null, expectedBenefit: '—' };
  if (inp.unassigned && ['urgent', 'critical'].includes(inp.priority)) return { ...base, type: 'assign_owner', reason: '긴급 업무 미배정(unassigned)', expectedBenefit: '대응 시간 단축' };
  if (!inp.hasSlaPolicy && inp.slaStatus === 'sla_not_defined') return { ...base, type: 'define_sla', reason: 'SLA 기준 미정의 — 위반 계산 불가', expectedBenefit: '기한 추적 가능' };
  if (['breached', 'resolution_overdue'].includes(inp.slaStatus)) return { ...base, type: 'escalate_review', reason: 'SLA 초과 — Escalation 검토', expectedBenefit: '지연 해소' };
  if (!inp.acknowledged && ['urgent', 'critical'].includes(inp.priority)) return { ...base, type: 'request_acknowledgement', reason: '긴급 업무 미확인', expectedBenefit: '인지 확인' };
  if (inp.workloadStatus === 'overloaded' || inp.workloadStatus === 'critical_overload') return { ...base, type: 'redistribute_work', reason: '담당자 과부하', expectedBenefit: '부하 분산' };
  if (!inp.hasEscalationPolicy) return { ...base, type: 'define_escalation_policy', reason: 'Escalation 정책 미정의', expectedBenefit: '비상 대응 체계' };
  return { ...base, type: 'prioritize_review', reason: '정기 검토', confidence: 40, expectedBenefit: '—' };
}

/* ── UI 톤 ──────────────────────────────────────────────────────────────── */
export const PRIORITY_TONE: Record<Priority, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger', critical: 'danger' };
export const WSTATUS_TONE: Record<WorkStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  new: 'info', triage: 'info', assigned: 'info', acknowledged: 'info', in_progress: 'warning',
  waiting_evidence: 'warning', waiting_approval: 'warning', waiting_external: 'warning', blocked: 'danger', escalated: 'danger',
  resolved: 'success', completed_reference: 'success', rejected: 'danger', cancelled: 'neutral', expired: 'neutral', invalidated: 'neutral',
};
export const SLA_TONE: Record<SlaStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  on_track: 'success', warning: 'warning', response_overdue: 'danger', resolution_overdue: 'danger', breached: 'danger',
  paused: 'info', sla_not_defined: 'neutral', insufficient_data: 'neutral',
};
export const WORKLOAD_TONE: Record<WorkloadStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  available: 'success', balanced: 'info', busy: 'warning', overloaded: 'danger', critical_overload: 'danger', insufficient_data: 'neutral',
};
export const HEALTH_TONE: Record<HealthStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  healthy: 'success', stable: 'info', strained: 'warning', critical: 'danger', insufficient_data: 'neutral',
};

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data' | 'unassigned' | 'sla_not_defined' | 'notification_unsupported';
export const OPS_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'unified_work_queue', label: 'Unified Work Queue', status: 'fully_supported', note: '실존 Source 10종 참조 등록(복제 없음)' },
  { key: 'manual_task', label: 'Manual Task', status: 'fully_supported', note: 'evidence 필수' },
  { key: 'ownership', label: 'Ownership', status: 'partially_supported', note: '실존·활성 계정만 — 단일 admin Role(세분 Role 없음)' },
  { key: 'backup_ownership', label: 'Backup Ownership', status: 'partially_supported', note: '단일 관리자 환경에서 실질 분리 제한' },
  { key: 'reviewer', label: 'Reviewer', status: 'partially_supported', note: '전용 reviewer role 없음 — admin 계정 지정' },
  { key: 'approver', label: 'Approver', status: 'partially_supported', note: '자기 승인 경고만 가능(단일 계정)' },
  { key: 'priority', label: 'Priority', status: 'fully_supported', note: '성분 재정규화 · 임의 지정 없음' },
  { key: 'priority_override', label: 'Priority Override', status: 'fully_supported', note: '사유+이력 필수 · AI 자동 덮어쓰기 없음' },
  { key: 'sla_policy', label: 'SLA Policy', status: 'sla_not_defined', note: '초기 Policy 없음 — 관리자 입력 필요(임의 생성 안 함)' },
  { key: 'sla_tracking', label: 'SLA Tracking', status: 'partially_supported', note: '기한 설정된 업무만 · 기준 없으면 위반 계산 안 함' },
  { key: 'sla_pause', label: 'SLA Pause', status: 'fully_supported', note: '사유 whitelist + 중첩 금지 + Audit' },
  { key: 'aging', label: 'Aging', status: 'fully_supported', note: 'SLA 없으면 Aging 만 표시(위반 표기 안 함)' },
  { key: 'workload', label: 'Workload', status: 'provisional', note: '가중치 조직 기준 미정 — 업무 수만으로 과부하 단정 안 함' },
  { key: 'approval_bottleneck', label: 'Approval Bottleneck', status: 'partially_supported', note: 'Evidence 기반 — 부재 보장 아님' },
  { key: 'escalation_policy', label: 'Escalation Policy', status: 'insufficient_data', note: '초기 정책 없음 — 관리자 입력 필요' },
  { key: 'escalation_recommendation', label: 'Escalation Recommendation', status: 'fully_supported', note: '권고만 — 자동 실행 없음' },
  { key: 'human_escalation_decision', label: 'Human Escalation Decision', status: 'fully_supported', note: '6 결정 + 사유 필수' },
  { key: 'notification_reference', label: 'Notification Reference', status: 'notification_unsupported', note: '발송 API 미연동 — 외부 수행 참고 기록만' },
  { key: 'shift', label: 'Shift', status: 'provisional', note: '수동 등록만 — 근무 시스템 연동 없음' },
  { key: 'handover', label: 'Handover', status: 'fully_supported', note: '수신자 확인 필수(자동 수락 없음)' },
  { key: 'operator_availability', label: 'Operator Availability', status: 'insufficient_data', note: '근무시간/휴가 연동 없음 — unknown(임의 판단 없음)' },
  { key: 'single_operator_risk', label: 'Single Operator Risk', status: 'fully_supported', note: '단일 관리자 환경 정직 표시 · 자동 조치 없음' },
  { key: 'emergency_plan', label: 'Emergency Operating Plan', status: 'evidence_only', note: 'Policy 문서로 저장 — 자동 승인/실행 없음' },
  { key: 'emergency_reference', label: 'Emergency Reference', status: 'evidence_only', note: '외부 운영 정책 적용 참고 기록만' },
  { key: 'executive_report', label: 'Executive Situation Report', status: 'fully_supported', note: '참고 자료 — 실제 조치 아님 명시' },
  { key: 'operational_health', label: 'Operational Health', status: 'partially_supported', note: '재정규화 · 자동 실행 권한 없음' },
  { key: 'work_recommendation', label: 'Work Recommendation', status: 'fully_supported', note: '권고만' },
  { key: 'automatic_assignment', label: 'Automatic Assignment', status: 'unsupported', note: '금지 — 추천 후보만' },
  { key: 'automatic_escalation', label: 'Automatic Escalation', status: 'unsupported', note: '금지' },
  { key: 'automatic_messaging', label: 'Automatic Messaging', status: 'unsupported', note: '금지 — Slack/SMS/전화/Email/Calendar API 호출 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];
