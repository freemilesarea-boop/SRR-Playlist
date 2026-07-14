// Phase AI-OPS-6 — Operational Command 순수 로직 단위 테스트.
// Work Item(whitelist/중복·금지 상태) · Priority(재정규화/Override) · Assignment(실존·활성/
// Conflict/자동 배정 없음) · SLA(미정의 시 위반 없음/Pause) · Workload(업무 수 단정 없음) ·
// Bottleneck · Escalation(자동 없음) · Notification Reference(발송 없음) · Handover(수신 확인) ·
// Single Operator Risk · Emergency(실행 없음) · Report/Health(재정규화).
import { describe, it, expect } from 'vitest';
import {
  validateWorkItem, WORK_STATUSES, FORBIDDEN_WORK_STATUSES, calculateWorkPriority,
  validatePriorityOverride, validateAssignment, recommendOwnership, calculateSlaStatus,
  validateSlaPause, calculateWorkAge, calculateWeightedWorkload, classifyWorkload,
  detectApprovalBottleneck, assessEscalation, validateEscalationDecision,
  validateNotificationReference, evaluateHandoverReadiness, resolveOperatorAvailability,
  assessSingleOperatorRisk, evaluateEmergencyReadiness, buildExecutiveSituationReport,
  calculateOperationalHealth, buildWorkRecommendation, OPS_SUPPORT, UNSUPPORTED_SOURCES,
  type PriorityComponents, type HealthComponents, type WorkloadItem,
} from './operationalCommand';

const NOW = new Date('2026-07-14T12:00:00Z');

describe('Work Item', () => {
  it('Source whitelist · manual_task 는 source_id 불필요 · evidence/idempotency 필수', () => {
    expect(validateWorkItem({ work_item_code: 'w', source_type: 'incident', source_id: 'x', work_type: 'incident_response', title: 't', evidence: [1], idempotency_key: 'k' })).toEqual([]);
    expect(validateWorkItem({ work_item_code: 'w', source_type: 'manual_task', work_type: 'manual_follow_up', title: 't', evidence: [1], idempotency_key: 'k' })).toEqual([]);
    expect(validateWorkItem({ work_item_code: 'w', source_type: 'support_ticket', work_type: 'review', title: 't', evidence: [1], idempotency_key: 'k' }).some((e) => e.includes('미지원'))).toBe(true);
    expect(validateWorkItem({ work_item_code: 'w', source_type: 'incident', work_type: 'review', title: 't', evidence: [1], idempotency_key: 'k' }).some((e) => e.includes('source_id'))).toBe(true);
    expect(validateWorkItem({ work_item_code: 'w', source_type: 'incident', source_id: 'x', work_type: 'review', title: 't', evidence: [], idempotency_key: 'k' }).some((e) => e.includes('evidence'))).toBe(true);
    expect(UNSUPPORTED_SOURCES).toContain('settlement_review');
  });
  it('금지 상태(auto_completed/auto_approved/deployed 등) 미포함', () => {
    for (const f of FORBIDDEN_WORK_STATUSES) expect(WORK_STATUSES).not.toContain(f);
    expect(WORK_STATUSES).toContain('resolved');
    expect(WORK_STATUSES).toContain('completed_reference');
  });
});

describe('Priority', () => {
  const C = (v: number | null): PriorityComponents => ({ severityRisk: v, businessImpact: v, urgency: v, affectedStores: v, activeIncident: v, sloBreach: v, errorBudget: v, rollbackRecommended: v, deadlineProximity: v });
  it('Low~Critical 밴드 · Missing 재정규화 · 전부 없음 insufficient', () => {
    expect(calculateWorkPriority(C(10)).priority).toBe('low');
    expect(calculateWorkPriority(C(30)).priority).toBe('normal');
    expect(calculateWorkPriority(C(50)).priority).toBe('high');
    expect(calculateWorkPriority(C(70)).priority).toBe('urgent');
    expect(calculateWorkPriority(C(90)).priority).toBe('critical');
    const partial = calculateWorkPriority({ ...C(50), errorBudget: null, deadlineProximity: null });
    expect(partial.score).toBe(50); expect(partial.missing.length).toBe(2);
    expect(calculateWorkPriority(C(null)).priority).toBe('insufficient_data');
  });
  it('Override — previous/new/reason/actor 필수(AI 자동 Override 없음)', () => {
    expect(validatePriorityOverride({ previous: 'normal', next: 'urgent', reason: 'r', actor: 'admin' })).toEqual([]);
    expect(validatePriorityOverride({ previous: 'normal', next: 'urgent', actor: 'admin' }).some((e) => e.includes('reason'))).toBe(true);
    expect(validatePriorityOverride({ previous: 'normal', next: 'urgent', reason: 'r' }).some((e) => e.includes('AI 자동'))).toBe(true);
    expect(validatePriorityOverride({ previous: 'normal', next: 'p0', reason: 'r', actor: 'a' }).some((e) => e.includes('whitelist'))).toBe(true);
  });
});

describe('Assignment / Ownership', () => {
  it('Owner 실존·활성 검증 · 비존재/비활성 차단', () => {
    expect(validateAssignment({ userExists: true, userActive: true, role: 'owner' }).errors).toEqual([]);
    expect(validateAssignment({ userExists: false, userActive: false, role: 'owner' }).errors.some((e) => e.includes('미존재'))).toBe(true);
    expect(validateAssignment({ userExists: true, userActive: false, role: 'owner' }).errors.some((e) => e.includes('비활성'))).toBe(true);
    expect(validateAssignment({ userExists: true, userActive: true, role: 'auto_assign' }).errors.some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateAssignment({ userExists: true, userActive: true, role: 'owner', scopeAllowed: false }).errors.some((e) => e.includes('scope'))).toBe(true);
  });
  it('동일인 Role Conflict 경고(자기 승인/Backup=Owner)', () => {
    expect(validateAssignment({ userExists: true, userActive: true, role: 'approver', sameAsOwner: true }).warnings.some((w) => w.includes('자기 승인'))).toBe(true);
    expect(validateAssignment({ userExists: true, userActive: true, role: 'backup', sameAsOwner: true }).warnings.length).toBe(1);
  });
  it('Ownership 추천 — 근무 데이터 없으면 unavailable 단정 없음', () => {
    expect(recommendOwnership({ userActive: true, openAssigned: 2, urgentAssigned: 0, hasConflict: false, availabilityKnown: false }).result).toBe('recommended');
    expect(recommendOwnership({ userActive: true, openAssigned: 20, urgentAssigned: 6, hasConflict: false, availabilityKnown: false }).result).toBe('overloaded');
    expect(recommendOwnership({ userActive: true, openAssigned: 8, urgentAssigned: 1, hasConflict: false, availabilityKnown: false }).result).toBe('available');
    expect(recommendOwnership({ userActive: true, openAssigned: 2, urgentAssigned: 0, hasConflict: true, availabilityKnown: false }).result).toBe('conflict');
    expect(recommendOwnership({ userActive: false, openAssigned: 0, urgentAssigned: 0, hasConflict: false, availabilityKnown: false }).result).toBe('unavailable');
    expect(recommendOwnership({ userActive: true, openAssigned: null, urgentAssigned: null, hasConflict: false, availabilityKnown: false }).result).toBe('insufficient_data');
    expect(recommendOwnership({ userActive: null, openAssigned: null, urgentAssigned: null, hasConflict: false, availabilityKnown: false }).result).toBe('insufficient_data');
  });
});

describe('SLA', () => {
  it('SLA 미정의 → 위반 계산 안 함(sla_not_defined)', () => {
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: null, acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('sla_not_defined');
  });
  it('On Track / Warning / Response·Resolution Overdue / Breached / Paused', () => {
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: '2026-07-15T12:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('on_track');
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: '2026-07-14T14:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('warning');
    expect(calculateSlaStatus({ responseDueAt: '2026-07-14T10:00:00Z', resolutionDueAt: '2026-07-15T12:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('response_overdue');
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: '2026-07-14T10:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('resolution_overdue');
    expect(calculateSlaStatus({ responseDueAt: '2026-07-14T09:00:00Z', resolutionDueAt: '2026-07-14T10:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: null, now: NOW }).status).toBe('breached');
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: '2026-07-15T12:00:00Z', acknowledgedAt: null, completedAt: null, pausedAt: '2026-07-14T11:00:00Z', now: NOW }).status).toBe('paused');
    expect(calculateSlaStatus({ responseDueAt: null, resolutionDueAt: '2026-07-14T10:00:00Z', acknowledgedAt: null, completedAt: '2026-07-14T09:00:00Z', pausedAt: null, now: NOW }).status).toBe('on_track');
  });
  it('Pause — 사유 whitelist + 무제한 중첩 금지', () => {
    expect(validateSlaPause('waiting_evidence', false)).toEqual([]);
    expect(validateSlaPause('vacation', false).some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateSlaPause('waiting_evidence', true).some((e) => e.includes('무제한'))).toBe(true);
  });
  it('Aging — 구간 분류 · SLA 없이도 표시', () => {
    expect(calculateWorkAge('2026-07-14T11:30:00Z', NOW).bucket).toBe('0-1h');
    expect(calculateWorkAge('2026-07-14T09:00:00Z', NOW).bucket).toBe('1-4h');
    expect(calculateWorkAge('2026-07-13T00:00:00Z', NOW).bucket).toBe('1-3d');
    expect(calculateWorkAge('2026-07-01T00:00:00Z', NOW).bucket).toBe('7d+');
    expect(calculateWorkAge(null, NOW).minutes).toBeNull();
  });
});

describe('Workload', () => {
  const item = (p: WorkloadItem['priority'], over: Partial<WorkloadItem> = {}): WorkloadItem => ({ priority: p, status: 'in_progress', overdue: false, isIncident: false, ...over });
  it('Weighted Load — priority/overdue/incident/대기 감점', () => {
    const r = calculateWeightedWorkload([item('critical'), item('normal', { overdue: true }), item('high', { status: 'waiting_approval' })]);
    expect(r.weightedLoad).toBe(10 + 5 + 3); // critical 10 + (normal 2 + overdue 3) + (high 4 - 대기 1)
    expect(r.criticalCount).toBe(1); expect(r.overdueCount).toBe(1); expect(r.provisional).toBe(true);
  });
  it('Available~Critical Overload · 단일 긴급 업무만으로 과부하 단정 없음 · 데이터 없음 insufficient', () => {
    expect(classifyWorkload({ weightedLoad: 2, criticalCount: 0, overdueCount: 0, availabilityKnown: false }).status).toBe('available');
    expect(classifyWorkload({ weightedLoad: 10, criticalCount: 0, overdueCount: 0, availabilityKnown: false }).status).toBe('balanced');
    expect(classifyWorkload({ weightedLoad: 10, criticalCount: 1, overdueCount: 0, availabilityKnown: false }).status).toBe('busy'); // critical 1건 → busy 까지만
    expect(classifyWorkload({ weightedLoad: 45, criticalCount: 1, overdueCount: 0, availabilityKnown: false }).status).toBe('overloaded');
    expect(classifyWorkload({ weightedLoad: 70, criticalCount: 3, overdueCount: 4, availabilityKnown: false }).status).toBe('critical_overload');
    expect(classifyWorkload({ weightedLoad: null, criticalCount: 0, overdueCount: 0, availabilityKnown: false }).status).toBe('insufficient_data');
    expect(classifyWorkload({ weightedLoad: 10, criticalCount: 0, overdueCount: 0, availabilityKnown: false }).note).toContain('단정 아님');
  });
});

describe('Approval Bottleneck', () => {
  const IN = { waitingApprovalCount: 5 as number | null, longWaitingApprovalCount: 0, distinctApprovers: 1 as number | null, singleApproverDependency: false, dualApprovalUnmet: 0, repeatedRejections: 0, reviewerEqualsApprover: 0, inactiveAssignee: 0 };
  it('No Known / Emerging / Bottleneck / Critical · 문구 고정', () => {
    expect(detectApprovalBottleneck(IN).level).toBe('no_known_bottleneck');
    expect(detectApprovalBottleneck({ ...IN, singleApproverDependency: true }).level).toBe('emerging');
    expect(detectApprovalBottleneck({ ...IN, singleApproverDependency: true, dualApprovalUnmet: 2 }).level).toBe('bottleneck');
    expect(detectApprovalBottleneck({ ...IN, singleApproverDependency: true, longWaitingApprovalCount: 4 }).level).toBe('critical_bottleneck');
    expect(detectApprovalBottleneck({ ...IN, inactiveAssignee: 1 }).level).toBe('critical_bottleneck');
    expect(detectApprovalBottleneck({ ...IN, waitingApprovalCount: null }).level).toBe('insufficient_data');
    expect(detectApprovalBottleneck(IN).note).toContain('미확인');
  });
});

describe('Escalation(자동 실행 없음)', () => {
  const IN = { slaStatus: 'on_track' as const, priority: 'normal' as const, hasOwner: true, ownerActive: true, unacknowledgedMinutes: 10, activeCriticalIncident: false, rollbackRecommended: false, freezeRecommended: false, dataSufficient: true };
  it('No / Recommended / Urgent / Manual Review / Insufficient', () => {
    expect(assessEscalation(IN).assessment).toBe('no_escalation');
    expect(assessEscalation({ ...IN, slaStatus: 'resolution_overdue' }).assessment).toBe('escalation_recommended');
    expect(assessEscalation({ ...IN, rollbackRecommended: true }).assessment).toBe('escalation_recommended');
    expect(assessEscalation({ ...IN, slaStatus: 'breached' }).assessment).toBe('urgent_escalation_recommended');
    expect(assessEscalation({ ...IN, priority: 'critical', hasOwner: false }).assessment).toBe('urgent_escalation_recommended');
    expect(assessEscalation({ ...IN, ownerActive: false }).assessment).toBe('manual_review_required');
    expect(assessEscalation({ ...IN, dataSufficient: false }).assessment).toBe('insufficient_data');
  });
  it('항상 noAutoExecution + 사람 결정 필요 명시', () => {
    const r = assessEscalation({ ...IN, slaStatus: 'breached' });
    expect(r.noAutoExecution).toBe(true);
    expect(r.reasons.some((x) => x.includes('자동 Escalation'))).toBe(true);
  });
  it('Human Decision whitelist · Notification Reference(발송 없음)', () => {
    expect(validateEscalationDecision({ decision: 'escalation_requested', reason: 'r' })).toEqual([]);
    expect(validateEscalationDecision({ decision: 'auto_escalate', reason: 'r' }).some((e) => e.includes('whitelist'))).toBe(true);
    const ref = validateNotificationReference({ channel: 'email_reference', sent_by: 'ops', sent_at: 't' });
    expect(ref.errors).toEqual([]); expect(ref.sendNotSupported).toBe(true);
    expect(validateNotificationReference({ channel: 'email_send', sent_by: 'x', sent_at: 't' }).errors.some((e) => e.includes('발송 API 없음'))).toBe(true);
    expect(validateNotificationReference(null).errors.length).toBe(1);
  });
});

describe('Handover / Availability / Single Operator Risk', () => {
  const H = { toShiftExists: true, toOperatorExists: true, includesCriticalWork: true, includesIncidents: true, includesPendingApprovals: true, includesRollbackFreeze: true, includesEscalations: true, hasEvidence: true, hasLimitations: true };
  it('Handover Ready / Partial / Blocked · 수신자 확인 필수', () => {
    const r = evaluateHandoverReadiness(H);
    expect(r.readiness).toBe('ready'); expect(r.requiresAcceptance).toBe(true);
    expect(evaluateHandoverReadiness({ ...H, includesIncidents: false, hasLimitations: false }).readiness).toBe('partially_ready');
    expect(evaluateHandoverReadiness({ ...H, toOperatorExists: false }).readiness).toBe('blocked');
  });
  it('Operator Availability — 근무 연동 없으면 unknown(임의 판단 없음)', () => {
    expect(resolveOperatorAvailability({ isActive: true, shiftKnown: false })).toBe('unknown');
    expect(resolveOperatorAvailability({ isActive: true, shiftKnown: true, onShift: true })).toBe('on_shift');
    expect(resolveOperatorAvailability({ isActive: false, shiftKnown: false })).toBe('inactive');
    expect(resolveOperatorAvailability({ isActive: true, shiftKnown: false, unavailableReference: true })).toBe('unavailable_reference');
    expect(resolveOperatorAvailability({ isActive: null, shiftKnown: false })).toBe('unknown');
  });
  it('Single Operator Risk — 관리자 1명 정직 표시 · 자동 조치 없음', () => {
    const r = assessSingleOperatorRisk({ activeAdminCount: 1, criticalWithoutBackup: 2, singleApprover: true, allShiftsSameOperator: true, hasBackupContact: false, handoverSupported: true, hasOpsDocs: false });
    expect(r.risk).toBe('critical'); expect(r.noAutoAction).toBe(true);
    expect(assessSingleOperatorRisk({ activeAdminCount: 1, criticalWithoutBackup: 0, singleApprover: false, allShiftsSameOperator: false, hasBackupContact: true, handoverSupported: true, hasOpsDocs: true }).risk).toBe('high');
    expect(assessSingleOperatorRisk({ activeAdminCount: 3, criticalWithoutBackup: 0, singleApprover: false, allShiftsSameOperator: false, hasBackupContact: true, handoverSupported: true, hasOpsDocs: true }).risk).toBe('low');
    expect(assessSingleOperatorRisk({ activeAdminCount: 3, criticalWithoutBackup: 1, singleApprover: false, allShiftsSameOperator: false, hasBackupContact: true, handoverSupported: true, hasOpsDocs: true }).risk).toBe('moderate');
    expect(assessSingleOperatorRisk({ activeAdminCount: null, criticalWithoutBackup: 0, singleApprover: false, allShiftsSameOperator: false, hasBackupContact: false, handoverSupported: false, hasOpsDocs: false }).risk).toBe('insufficient_data');
  });
});

describe('Emergency / Report / Health', () => {
  it('Emergency — Decision Authority/Scope 필수 · 실행 없음', () => {
    expect(evaluateEmergencyReadiness({ decision_authority: 'admin', scope: 'global', activation_trigger: 't' }).errors).toEqual([]);
    const r = evaluateEmergencyReadiness({ scope: 'global' });
    expect(r.errors.some((e) => e.includes('Decision Authority'))).toBe(true);
    expect(r.executionBlocked).toBe(true);
    expect(evaluateEmergencyReadiness(null).errors[0]).toContain('없음');
  });
  it('Executive Situation Report — 필수 섹션 + 조치 아님 명시', () => {
    const pkg = buildExecutiveSituationReport({ openTotal: 5, unassigned: 2, criticalOpen: 1, urgentOpen: 1, slaWarning: 0, slaBreach: 0, bottleneckLevel: 'no_known_bottleneck', overloadedOperators: 0, activeIncidents: 0, rollbackRecommendations: 0, freezeRecommendations: 0, capacityCritical: 0, continuityCritical: 0, decisionsRequired: ['x'] }, NOW);
    const sections = pkg.map((p) => p.section);
    for (const s of ['Overall Operational Status', 'Critical Work', 'SLA Risks', 'Approval Bottlenecks', 'Rollback Recommendations', 'Decisions Required', 'Next Review Time', 'Limitations']) expect(sections).toContain(s);
    expect(JSON.stringify(pkg.find((p) => p.section === 'Limitations')!.content)).toContain('조치 결과가 아님');
  });
  it('Operational Health — 재정규화 · Critical 조건 우선 · 자동 실행 권한 없음', () => {
    const C = (v: number | null): HealthComponents => ({ workQueueHealth: v, ownershipCoverage: v, slaHealth: v, approvalFlow: v, workloadBalance: v, escalationReadiness: v, handoverReadiness: v, singleOperatorRisk: v, incidentLoad: v, continuityReadiness: v });
    const ctx = { criticalUnassigned: false, criticalSlaBreach: false, criticalIncidentNoBackup: false, criticalBottleneck: false, handoverBlocked: false, noDecisionAuthority: false, singleOperatorCritical: false };
    expect(calculateOperationalHealth(C(85), ctx).status).toBe('healthy');
    expect(calculateOperationalHealth(C(50), ctx).status).toBe('strained');
    expect(calculateOperationalHealth(C(85), { ...ctx, criticalUnassigned: true }).status).toBe('critical');
    expect(calculateOperationalHealth(C(85), { ...ctx, singleOperatorCritical: true }).status).toBe('critical');
    const partial = calculateOperationalHealth({ ...C(60), incidentLoad: null, continuityReadiness: null }, ctx);
    expect(partial.score).toBe(60);
    expect(calculateOperationalHealth(C(null), ctx).status).toBe('insufficient_data');
    expect(calculateOperationalHealth(C(95), ctx).noExecutionAuthority).toBe(true);
  });
  it('Work Recommendation — 유형/권고 전용', () => {
    const base = { unassigned: false, slaStatus: 'on_track' as const, priority: 'normal' as const, acknowledged: true, workloadStatus: 'balanced' as const, hasSlaPolicy: true, hasEscalationPolicy: true };
    expect(buildWorkRecommendation({ ...base, unassigned: true, priority: 'critical' }).type).toBe('assign_owner');
    expect(buildWorkRecommendation({ ...base, slaStatus: 'sla_not_defined', hasSlaPolicy: false }).type).toBe('define_sla');
    expect(buildWorkRecommendation({ ...base, slaStatus: 'breached' }).type).toBe('escalate_review');
    expect(buildWorkRecommendation({ ...base, workloadStatus: 'overloaded' }).type).toBe('redistribute_work');
    expect(buildWorkRecommendation({ ...base, priority: 'insufficient_data' }).type).toBe('insufficient_data');
    const r = buildWorkRecommendation(base);
    expect(r.noExecution).toBe(true);
    expect(r.limitations[0]).toContain('자동 실행');
  });
});

describe('Support Matrix', () => {
  it('자동 배정/Escalation/Messaging/Production Apply unsupported · notification_unsupported/sla_not_defined 정직 표기', () => {
    expect(OPS_SUPPORT.find((s) => s.key === 'automatic_assignment')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'automatic_escalation')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'automatic_messaging')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'notification_reference')!.status).toBe('notification_unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'sla_policy')!.status).toBe('sla_not_defined');
    expect(OPS_SUPPORT.find((s) => s.key === 'operator_availability')!.status).toBe('insufficient_data');
  });
});
