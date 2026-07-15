/**
 * commitmentIntelligence — Commitment/Execution Assurance/Accountability 순수 로직
 * (Phase AI-OPS-17).
 *
 * Selected Priority/Portfolio → Commitment 정의 → Ownership Reference →
 * Success Criteria/Milestone → Execution Evidence → Progress/Blocker/Dependency →
 * Delivery Confidence/Risk → Completion Verification → Outcome Readiness →
 * Accountability → Learning → Audit.
 *
 * Commitment 정직성(전부 코드로 강제):
 *  - 선택 ≠ 실행. Owner Reference ≠ 실제 책임 수락. Status ≠ Evidence.
 *  - Reported ≠ Verified Progress(복사 금지). 100% 보고 ≠ 완료 검증. 완료 ≠ Outcome.
 *  - Deadline 경과 ≠ 실패 확정. 일정 변경 ≠ 자동 Scope Drift. Blocker ≠ 능력 평가.
 *  - Accountability ≠ 인사 평가. Hard Risk 평균 희석 금지.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type OwnershipVerification = 'verified_reference' | 'partially_verified' | 'owner_unverified' | 'sponsor_unverified' | 'reviewer_unverified' | 'backup_missing' | 'self_review_risk' | 'single_person_concentration' | 'external_reference_only' | 'insufficient_data';
export type SuccessCriteriaStatus = 'defined_reference' | 'partially_defined' | 'qualitative_reference' | 'success_criteria_missing' | 'baseline_unavailable' | 'verification_method_missing' | 'insufficient_data';
export type ProgressStatus = 'not_started_reference' | 'externally_started_reference' | 'progressing_reference' | 'stalled_candidate' | 'blocked_reference' | 'at_risk_reference' | 'completion_reported_reference' | 'completion_unverified' | 'verified_complete_reference' | 'insufficient_data';
export type BlockerImpact = 'negligible_candidate' | 'low_candidate' | 'moderate_candidate' | 'high_candidate' | 'critical_candidate' | 'blocker_impact_unverified' | 'insufficient_data';
export type DependencyReadiness = 'dependency_clear_reference' | 'partially_ready' | 'waiting_dependency' | 'blocking_dependency' | 'dependency_unverified' | 'insufficient_data';
export type ScheduleVariance = 'on_reference_schedule' | 'minor_variance_candidate' | 'material_variance_candidate' | 'critical_variance_candidate' | 'schedule_baseline_unverified' | 'insufficient_data';
export type ScopeDrift = 'no_known_drift' | 'minor_drift_candidate' | 'material_drift_candidate' | 'critical_drift_candidate' | 'approved_scope_change_reference' | 'scope_baseline_unverified' | 'insufficient_data';
export type CommitmentAging = 'fresh_reference' | 'aging_candidate' | 'stale_commitment_candidate' | 'overdue_candidate' | 'critical_overdue_candidate' | 'aging_threshold_unverified' | 'insufficient_data';
export type DeliveryConfidenceStatus = 'high_confidence_reference' | 'moderate_confidence_reference' | 'low_confidence_candidate' | 'at_risk_candidate' | 'critical_delivery_risk' | 'delivery_confidence_unverified' | 'insufficient_data';
export type CompletionVerification = 'completion_reported_reference' | 'evidence_partial' | 'success_criteria_partial' | 'verification_pending' | 'completion_unverified' | 'verified_complete_reference' | 'rejected_completion_reference' | 'insufficient_data';
export type OutcomeReadiness = 'ready_for_observation_reference' | 'partially_ready' | 'outcome_readiness_incomplete' | 'baseline_unavailable' | 'metric_definition_missing' | 'observation_window_missing' | 'execution_unverified' | 'insufficient_data';
export type AccountabilityVerdict = 'well_documented_reference' | 'adequately_documented' | 'partially_documented' | 'weakly_documented' | 'accountability_gap_candidate' | 'insufficient_data';
export type RepeatedGapVerdict = 'no_known_pattern' | 'isolated_gap' | 'repeated_gap_candidate' | 'persistent_gap_pattern' | 'critical_commitment_gap' | 'insufficient_data';

export const COMMITMENT_TYPES = ['priority_execution_reference', 'portfolio_execution_reference', 'strategic_initiative_reference', 'policy_action_reference', 'contract_review_reference', 'settlement_review_reference', 'security_remediation_reference', 'privacy_action_reference', 'compliance_action_reference', 'capacity_action_reference', 'incident_recovery_reference', 'deployment_reference', 'operational_improvement_reference', 'manual'] as const;

/* ── Commitment 검증(선택 ≠ 실행·업무 지시 아님) ────────────────────── */
export function validateCommitment(c: { type?: string; title?: string | null; evidence?: unknown[] | null; sourceRef?: string | null } | null): string[] {
  if (!c) return ['commitment 없음'];
  const errors: string[] = [];
  if (!c.type || !(COMMITMENT_TYPES as readonly string[]).includes(c.type)) errors.push('허용되지 않는 commitment type');
  if (!c.title?.trim()) errors.push('title 필수');
  if (!c.evidence?.length) errors.push('Evidence 필수');
  return errors;   // owner 없음은 생성 오류 아님 — owner_unverified 상태로 추적
}

/* ── Ownership(Reference ≠ 실제 배정·인사 평가 아님) ─────────────────── */
export function evaluateOwnershipVerification(o: { owner: string | null; sponsor: string | null; reviewer: string | null; backup: string | null; ownerAcknowledged: boolean; sponsorAcknowledged: boolean; reviewerAcknowledged: boolean }): { verification: OwnershipVerification; gaps: string[]; warnings: string[]; notPersonnelEvaluation: true } {
  const gaps: string[] = [];
  const warnings: string[] = [];
  if (!o.owner?.trim()) return { verification: 'owner_unverified', gaps: ['Owner Reference 없음'], warnings, notPersonnelEvaluation: true };
  if (!o.ownerAcknowledged) gaps.push('Owner 미수락(Reference 존재 ≠ 책임 수락)');
  if (!o.sponsor?.trim()) gaps.push('Sponsor 없음');
  else if (!o.sponsorAcknowledged) gaps.push('Sponsor 미수락');
  if (!o.reviewer?.trim()) gaps.push('Reviewer 없음');
  else if (!o.reviewerAcknowledged) gaps.push('Reviewer 미수락');
  if (!o.backup?.trim()) gaps.push('Backup Owner 없음');
  if (o.owner && o.reviewer && o.owner === o.reviewer) warnings.push('self_review_risk: Owner=Reviewer(경고 보존)');
  const people = new Set([o.owner, o.sponsor, o.reviewer, o.backup].filter((p): p is string => Boolean(p?.trim())));
  if (people.size === 1) warnings.push('single_person_concentration: 전 역할 동일인');
  let verification: OwnershipVerification;
  if (warnings.some((w) => w.startsWith('single_person'))) verification = 'single_person_concentration';
  else if (warnings.some((w) => w.startsWith('self_review'))) verification = 'self_review_risk';
  else if (!o.sponsor?.trim()) verification = 'sponsor_unverified';
  else if (!o.reviewer?.trim()) verification = 'reviewer_unverified';
  else if (!o.backup?.trim()) verification = 'backup_missing';
  else if (gaps.length > 0) verification = 'partially_verified';
  else verification = 'verified_reference';
  return { verification, gaps, warnings, notPersonnelEvaluation: true };
}

export function validateOwnershipAcknowledgement(a: { acknowledged: boolean; evidence: string[] | null }): { valid: boolean; why: string } {
  if (!a.acknowledged) return { valid: true, why: '미수락 상태 유지(수락으로 표시하지 않음)' };
  if (!a.evidence?.length) return { valid: false, why: 'Acknowledgement Reference(Evidence) 없이 수락 표시 금지' };
  return { valid: true, why: 'Acknowledgement Reference 존재' };
}

/* ── Success Criteria(없으면 성공 판정 금지) ─────────────────────────── */
export function evaluateSuccessCriteria(criteria: { metric: string | null; baseline: number | null; target: number | null; verificationMethod: string | null; qualitative: boolean }[] | null): { status: SuccessCriteriaStatus; definedCount: number; issues: string[] } {
  if (!criteria?.length) return { status: 'success_criteria_missing', definedCount: 0, issues: ['Success Criteria 없음 — 성공 판정 금지'] };
  const issues: string[] = [];
  let fullyDefined = 0; let qualitativeCount = 0;
  for (const c of criteria) {
    if (c.qualitative) { qualitativeCount += 1; continue; }
    if (!c.metric?.trim()) { issues.push('metric 없음'); continue; }
    if (c.baseline == null || !isFiniteNumber(c.baseline)) { issues.push(`${c.metric}: baseline 없음(개선률 계산 금지)`); continue; }
    if (!c.verificationMethod?.trim()) { issues.push(`${c.metric}: 검증 방법 없음`); continue; }
    if (c.target == null || !isFiniteNumber(c.target)) { issues.push(`${c.metric}: target 없음`); continue; }
    fullyDefined += 1;
  }
  if (fullyDefined === criteria.length) return { status: 'defined_reference', definedCount: fullyDefined, issues };
  if (qualitativeCount === criteria.length) return { status: 'qualitative_reference', definedCount: 0, issues };
  if (issues.some((i) => i.includes('baseline'))) return { status: 'baseline_unavailable', definedCount: fullyDefined, issues };
  if (issues.some((i) => i.includes('검증 방법'))) return { status: 'verification_method_missing', definedCount: fullyDefined, issues };
  return { status: 'partially_defined', definedCount: fullyDefined, issues };
}

/* ── Milestone(자동 Task 아님·Evidence 게이트) ──────────────────────── */
export const MILESTONE_TYPES = ['review', 'approval', 'analysis', 'design', 'implementation_reference', 'validation', 'deployment_reference', 'observation', 'certification', 'handover', 'external_action', 'manual'] as const;

export function validateMilestone(m: { type?: string; title?: string | null; sequence?: number | null } | null): string[] {
  if (!m) return ['milestone 없음'];
  const errors: string[] = [];
  if (!m.type || !(MILESTONE_TYPES as readonly string[]).includes(m.type)) errors.push('허용되지 않는 milestone type');
  if (!m.title?.trim()) errors.push('title 필수');
  if (m.sequence == null || !isFiniteNumber(m.sequence) || m.sequence < 1) errors.push('sequence 1 이상 필수');
  return errors;
}

export function evaluateMilestoneEvidence(m: { evidenceRequired: number; evidenceProvided: number; statusReported: string }): { verifiable: boolean; verdict: 'verified_eligible' | 'milestone_unverified' | 'insufficient_data'; note: string } {
  if (!isFiniteNumber(m.evidenceRequired) || !isFiniteNumber(m.evidenceProvided)) return { verifiable: false, verdict: 'insufficient_data', note: 'Evidence 수 미상' };
  if (m.evidenceProvided === 0) return { verifiable: false, verdict: 'milestone_unverified', note: 'Evidence 없음 — 완료 표시만으로 성과 달성 보장 안 함' };
  if (m.evidenceRequired > 0 && m.evidenceProvided < m.evidenceRequired) return { verifiable: false, verdict: 'milestone_unverified', note: `필수 Evidence 부족(${m.evidenceProvided}/${m.evidenceRequired})` };
  return { verifiable: true, verdict: 'verified_eligible', note: '검증 검토 가능(자동 검증 아님)' };
}

/* ── Progress(reported/verified 분리·복사 금지) ─────────────────────── */
export function calculateReportedProgress(reports: { pct: number | null }[] | null): number | null {
  const valid = (reports ?? []).map((r) => r.pct).filter((p): p is number => p != null && isFiniteNumber(p) && p >= 0 && p <= 100);
  if (!valid.length) return null;   // 없으면 null 유지(임의 생성 금지)
  return valid[valid.length - 1];
}

export function calculateVerifiedProgress(m: { verifiedMilestones: number | null; totalMilestones: number | null }): number | null {
  if (!isFiniteNumber(m.verifiedMilestones) || !isFiniteNumber(m.totalMilestones) || m.totalMilestones <= 0) return null;
  return clampScore((m.verifiedMilestones / m.totalMilestones) * 100);
}

export function classifyProgressStatus(i: { reported: number | null; verified: number | null; activeBlockers: number; externallyStarted: boolean; daysSinceLastEvidence: number | null }): { status: ProgressStatus; reportedCopiedToVerified: false; note: string } {
  if (i.activeBlockers > 0) return { status: 'blocked_reference', reportedCopiedToVerified: false, note: `Active Blocker ${i.activeBlockers}건` };
  if (i.reported == null && i.verified == null) {
    return { status: i.externallyStarted ? 'externally_started_reference' : 'not_started_reference', reportedCopiedToVerified: false, note: i.externallyStarted ? '외부 시작 Reference — 내부 검증 아님' : '시작 Reference 없음' };
  }
  // reported 100% + verified 미달 → completion_unverified(복사 금지)
  if ((i.reported ?? 0) >= 100 && (i.verified == null || i.verified < 100)) return { status: 'completion_unverified', reportedCopiedToVerified: false, note: '보고 100% — 검증 미완(verified 로 복사하지 않음)' };
  if (i.verified != null && i.verified >= 100) return { status: 'verified_complete_reference', reportedCopiedToVerified: false, note: '검증 완료 Reference — Outcome 달성 아님' };
  if (i.daysSinceLastEvidence != null && isFiniteNumber(i.daysSinceLastEvidence) && i.daysSinceLastEvidence >= 14) return { status: 'stalled_candidate', reportedCopiedToVerified: false, note: `Evidence ${Math.round(i.daysSinceLastEvidence)}일 없음` };
  return { status: 'progressing_reference', reportedCopiedToVerified: false, note: '진행 Reference(자기보고 포함 — 검증 분리)' };
}

/* ── Blocker(자동 해결 없음·능력 평가 아님) ─────────────────────────── */
export const BLOCKER_TYPES = ['dependency', 'capacity', 'resource', 'budget_reference', 'technical', 'security', 'privacy', 'compliance', 'contract', 'settlement', 'policy', 'approval', 'evidence', 'external_party', 'schedule', 'scope', 'data', 'manual'] as const;

export function validateBlocker(b: { type?: string; summary?: string | null; evidence?: unknown[] | null } | null): string[] {
  if (!b) return ['blocker 없음'];
  const errors: string[] = [];
  if (!b.type || !(BLOCKER_TYPES as readonly string[]).includes(b.type)) errors.push('허용되지 않는 blocker type');
  if (!b.summary?.trim()) errors.push('summary 필수');
  if (!b.evidence?.length) errors.push('Evidence 필수');
  return errors;
}

export function calculateBlockerImpact(i: { milestonesAffected: number | null; deadlineAtRisk: boolean | null; hardRisk: boolean; financialExposureKrw: number | null; reversible: boolean | null }): { impact: BlockerImpact; notCapabilityJudgement: true } {
  // Hard Risk 는 평균 희석 없이 즉시 critical
  if (i.hardRisk) return { impact: 'critical_candidate', notCapabilityJudgement: true };
  if (i.milestonesAffected == null && i.deadlineAtRisk == null && i.financialExposureKrw == null) return { impact: 'blocker_impact_unverified', notCapabilityJudgement: true };
  const affected = isFiniteNumber(i.milestonesAffected) ? i.milestonesAffected : 0;
  if (i.deadlineAtRisk === true && affected >= 2) return { impact: 'high_candidate', notCapabilityJudgement: true };
  if (i.deadlineAtRisk === true || affected >= 2 || (isFiniteNumber(i.financialExposureKrw) && i.financialExposureKrw > 0)) return { impact: 'moderate_candidate', notCapabilityJudgement: true };
  if (affected >= 1) return { impact: 'low_candidate', notCapabilityJudgement: true };
  return { impact: 'negligible_candidate', notCapabilityJudgement: true };
}

/* ── Dependency(미확인 → clear 금지) ────────────────────────────────── */
export function evaluateDependencyReadiness(deps: { name: string; status: 'ready' | 'waiting' | 'blocking' | 'unknown' }[] | null): { readiness: DependencyReadiness; waiting: string[]; blocking: string[] } {
  if (deps == null) return { readiness: 'dependency_unverified', waiting: [], blocking: [] };
  if (!deps.length) return { readiness: 'dependency_clear_reference', waiting: [], blocking: [] };
  const blocking = deps.filter((d) => d.status === 'blocking').map((d) => d.name);
  const waiting = deps.filter((d) => d.status === 'waiting').map((d) => d.name);
  const unknown = deps.filter((d) => d.status === 'unknown');
  if (blocking.length) return { readiness: 'blocking_dependency', waiting, blocking };
  if (unknown.length) return { readiness: 'dependency_unverified', waiting, blocking };   // 미확인 → clear 금지
  if (waiting.length) return { readiness: deps.length === waiting.length ? 'waiting_dependency' : 'partially_ready', waiting, blocking };
  return { readiness: 'dependency_clear_reference', waiting, blocking };
}

/* ── Schedule(기준 없으면 계산 금지·자동 Deadline 변경 없음) ─────────── */
export function calculateScheduleVariance(i: { plannedAt: Date | null; actualAt: Date | null; baselineExists: boolean }): { varianceDays: number | null; verdict: ScheduleVariance; autoDeadlineChanged: false } {
  if (!i.baselineExists) return { varianceDays: null, verdict: 'schedule_baseline_unverified', autoDeadlineChanged: false };
  if (!i.plannedAt || !i.actualAt) return { varianceDays: null, verdict: 'insufficient_data', autoDeadlineChanged: false };
  const days = (i.actualAt.getTime() - i.plannedAt.getTime()) / 86400000;
  const rounded = Math.round(days * 100) / 100;
  if (Math.abs(days) <= 1) return { varianceDays: rounded, verdict: 'on_reference_schedule', autoDeadlineChanged: false };
  if (Math.abs(days) <= 7) return { varianceDays: rounded, verdict: 'minor_variance_candidate', autoDeadlineChanged: false };
  if (Math.abs(days) <= 30) return { varianceDays: rounded, verdict: 'material_variance_candidate', autoDeadlineChanged: false };
  return { varianceDays: rounded, verdict: 'critical_variance_candidate', autoDeadlineChanged: false };
}

/* ── Scope Drift(승인 변경과 무단 변경 구분) ─────────────────────────── */
export function detectScopeDrift(i: { baselineExists: boolean; changes: { kind: string; approved: boolean }[] | null }): { drift: ScopeDrift; unapproved: string[]; approved: string[]; autoScopeChanged: false } {
  if (!i.baselineExists) return { drift: 'scope_baseline_unverified', unapproved: [], approved: [], autoScopeChanged: false };
  const changes = i.changes ?? [];
  if (!changes.length) return { drift: 'no_known_drift', unapproved: [], approved: [], autoScopeChanged: false };
  const approved = changes.filter((c) => c.approved).map((c) => c.kind);
  const unapproved = changes.filter((c) => !c.approved).map((c) => c.kind);
  if (!unapproved.length) return { drift: 'approved_scope_change_reference', unapproved, approved, autoScopeChanged: false };
  const critical = unapproved.some((k) => ['success_criteria_changed', 'deliverable_removed', 'domain_changed'].includes(k));
  if (critical) return { drift: 'critical_drift_candidate', unapproved, approved, autoScopeChanged: false };
  if (unapproved.length >= 2) return { drift: 'material_drift_candidate', unapproved, approved, autoScopeChanged: false };
  return { drift: 'minor_drift_candidate', unapproved, approved, autoScopeChanged: false };
}

/* ── Aging(자동 Escalation 없음) ────────────────────────────────────── */
export function calculateCommitmentAging(i: { createdAt: Date | null; targetAt: Date | null; now: Date; thresholds: { agingDays: number; staleDays: number } | null }): { ageDays: number | null; daysToTarget: number | null; status: CommitmentAging; autoEscalated: false; failureDeclared: false } {
  const age = i.createdAt ? Math.max(0, (i.now.getTime() - i.createdAt.getTime()) / 86400000) : null;
  const toTarget = i.targetAt ? (i.targetAt.getTime() - i.now.getTime()) / 86400000 : null;
  const base = { ageDays: age == null ? null : Math.round(age), daysToTarget: toTarget == null ? null : Math.round(toTarget), autoEscalated: false as const, failureDeclared: false as const };
  if (toTarget != null) {
    // Deadline 경과 ≠ 실패 확정 — overdue 후보일 뿐
    if (toTarget < -14) return { ...base, status: 'critical_overdue_candidate' };
    if (toTarget < 0) return { ...base, status: 'overdue_candidate' };
  }
  if (age == null) return { ...base, status: 'insufficient_data' };
  if (!i.thresholds) return { ...base, status: 'aging_threshold_unverified' };
  if (age >= i.thresholds.staleDays) return { ...base, status: 'stale_commitment_candidate' };
  if (age >= i.thresholds.agingDays) return { ...base, status: 'aging_candidate' };
  return { ...base, status: 'fresh_reference' };
}

/* ── Delivery Confidence(재정규화·Hard Risk 희석 금지·점수 단독 금지) ── */
export function calculateDeliveryConfidence(c: {
  ownershipScore: number | null; criteriaScore: number | null; milestoneScore: number | null;
  evidenceCoverage: number | null; dependencyScore: number | null; blockerScore: number | null;
  scheduleScore: number | null; hardRiskBlocked: boolean;
}): { score: number | null; status: DeliveryConfidenceStatus; supporting: string[]; risks: string[]; missing: string[]; completionGuaranteed: false } {
  // Hard Risk Blocker 존재 → 평균 희석 없이 critical
  if (c.hardRiskBlocked) return { score: null, status: 'critical_delivery_risk', supporting: [], risks: ['Hard Security/Privacy/Compliance Blocker 존재(희석 금지)'], missing: [], completionGuaranteed: false };
  const components = [
    { key: 'ownership', value: c.ownershipScore, weight: 0.2 },
    { key: 'criteria', value: c.criteriaScore, weight: 0.15 },
    { key: 'milestone', value: c.milestoneScore, weight: 0.15 },
    { key: 'evidence', value: c.evidenceCoverage, weight: 0.15 },
    { key: 'dependency', value: c.dependencyScore, weight: 0.1 },
    { key: 'blocker', value: c.blockerScore, weight: 0.15 },
    { key: 'schedule', value: c.scheduleScore, weight: 0.1 },
  ];
  const { score, used, missing } = normalizeAvailableComponents(components);
  if (score == null) return { score: null, status: 'delivery_confidence_unverified', supporting: [], risks: [], missing, completionGuaranteed: false };
  const supporting = components.filter((x) => x.value != null && x.value >= 70 && used.includes(x.key)).map((x) => x.key);
  const risks = components.filter((x) => x.value != null && x.value < 40 && used.includes(x.key)).map((x) => x.key);
  const s = clampScore(score);
  const status: DeliveryConfidenceStatus = s >= 75 ? 'high_confidence_reference' : s >= 50 ? 'moderate_confidence_reference' : s >= 30 ? 'low_confidence_candidate' : s >= 15 ? 'at_risk_candidate' : 'critical_delivery_risk';
  return { score: s, status, supporting, risks, missing, completionGuaranteed: false };
}

export function classifyDeliveryConfidence(score: number | null): DeliveryConfidenceStatus {
  if (score == null || !isFiniteNumber(score)) return 'delivery_confidence_unverified';
  if (score >= 75) return 'high_confidence_reference';
  if (score >= 50) return 'moderate_confidence_reference';
  if (score >= 30) return 'low_confidence_candidate';
  if (score >= 15) return 'at_risk_candidate';
  return 'critical_delivery_risk';
}

/* ── Commitment Risk(Hard Risk 희석 금지) ───────────────────────────── */
export function calculateCommitmentRisk(r: { ownershipGap: boolean; criteriaGap: boolean; milestoneGap: boolean; evidenceGap: boolean; activeBlockers: number; dependencyDelay: boolean; scheduleVariance: ScheduleVariance; scopeDrift: ScopeDrift; hardRisk: boolean }): { level: 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data'; factors: string[] } {
  const factors: string[] = [];
  if (r.hardRisk) return { level: 'critical', factors: ['Hard Security/Privacy/Compliance Risk(평균 희석 없음)'] };
  if (r.ownershipGap) factors.push('Ownership Gap');
  if (r.criteriaGap) factors.push('Success Criteria Gap');
  if (r.milestoneGap) factors.push('Milestone Gap');
  if (r.evidenceGap) factors.push('Evidence Gap');
  if (r.activeBlockers > 0) factors.push(`Active Blocker ${r.activeBlockers}건`);
  if (r.dependencyDelay) factors.push('Dependency Delay');
  if (r.scheduleVariance === 'critical_variance_candidate' || r.scheduleVariance === 'material_variance_candidate') factors.push(`Schedule: ${r.scheduleVariance}`);
  if (r.scopeDrift === 'critical_drift_candidate' || r.scopeDrift === 'material_drift_candidate') factors.push(`Scope: ${r.scopeDrift}`);
  if (factors.length >= 5) return { level: 'critical', factors };
  if (factors.length >= 3) return { level: 'high', factors };
  if (factors.length >= 1) return { level: 'moderate', factors };
  return { level: 'low', factors };
}

/* ── Completion Verification(완료 ≠ Outcome) ────────────────────────── */
export function evaluateCompletionVerification(c: { evidenceCount: number; criteriaResultCount: number; criteriaTotal: number; requiredMilestonesVerified: boolean; criticalBlockersOpen: number; reviewerExists: boolean }): { verdict: CompletionVerification; blockers: string[]; outcomeAchieved: false } {
  const blockers: string[] = [];
  if (c.evidenceCount === 0) return { verdict: 'completion_unverified', blockers: ['Completion Evidence 없음'], outcomeAchieved: false };
  if (c.criticalBlockersOpen > 0) blockers.push(`미해결 Critical Blocker ${c.criticalBlockersOpen}건`);
  if (!c.reviewerExists) blockers.push('Reviewer Reference 없음');
  if (!c.requiredMilestonesVerified) blockers.push('필수 Milestone 미검증');
  if (c.criteriaTotal === 0) blockers.push('Success Criteria 없음 — 성공 판정 금지');
  else if (c.criteriaResultCount < c.criteriaTotal) blockers.push(`Criteria 결과 부족(${c.criteriaResultCount}/${c.criteriaTotal})`);
  if (blockers.length === 0) return { verdict: 'verified_complete_reference', blockers, outcomeAchieved: false };
  if (blockers.some((b) => b.includes('Critical Blocker') || b.includes('Reviewer'))) return { verdict: 'verification_pending', blockers, outcomeAchieved: false };
  if (blockers.some((b) => b.includes('Criteria'))) return { verdict: 'success_criteria_partial', blockers, outcomeAchieved: false };
  return { verdict: 'evidence_partial', blockers, outcomeAchieved: false };
}

/* ── Outcome Readiness(Gate — 준비 안 되면 Ready 금지) ──────────────── */
export function evaluateOutcomeReadiness(o: { expectedOutcomeDefined: boolean; baselineExists: boolean; metricDefined: boolean; observationWindowDefined: boolean; dataSourceExists: boolean; reviewerExists: boolean; executionEvidenceExists: boolean }): { readiness: OutcomeReadiness; missing: string[]; autoOutcomeCreated: false } {
  if (!o.executionEvidenceExists) return { readiness: 'execution_unverified', missing: ['실행 Evidence 없음'], autoOutcomeCreated: false };
  const missing: string[] = [];
  if (!o.expectedOutcomeDefined) missing.push('Expected Outcome 미정의');
  if (!o.baselineExists) return { readiness: 'baseline_unavailable', missing: [...missing, 'Baseline 없음'], autoOutcomeCreated: false };
  if (!o.metricDefined) return { readiness: 'metric_definition_missing', missing: [...missing, 'Metric 미정의'], autoOutcomeCreated: false };
  if (!o.observationWindowDefined) return { readiness: 'observation_window_missing', missing: [...missing, 'Observation Window 없음'], autoOutcomeCreated: false };
  if (!o.dataSourceExists) missing.push('Data Source 미확인');
  if (!o.reviewerExists) missing.push('Reviewer 없음');
  if (missing.length) return { readiness: missing.length >= 2 ? 'outcome_readiness_incomplete' : 'partially_ready', missing, autoOutcomeCreated: false };
  return { readiness: 'ready_for_observation_reference', missing: [], autoOutcomeCreated: false };
}

/* ── Accountability(인사 평가 아님 — 문서/절차 완결성만) ─────────────── */
export function evaluateAccountability(a: { ownerClear: boolean; sponsorClear: boolean; reviewerIndependent: boolean; criteriaDefined: boolean; milestonesDefined: boolean; evidenceCoverage: number | null; blockersDisclosed: boolean; scopeChangesRecorded: boolean; completionVerified: boolean; outcomeObserved: boolean }): { verdict: AccountabilityVerdict; documented: string[]; gaps: string[]; notPersonnelEvaluation: true; notDisciplinary: true } {
  const checks: [string, boolean][] = [
    ['Owner 명확', a.ownerClear], ['Sponsor 명확', a.sponsorClear], ['Reviewer 독립', a.reviewerIndependent],
    ['Success Criteria', a.criteriaDefined], ['Milestone', a.milestonesDefined],
    ['Blocker 공개', a.blockersDisclosed], ['Scope 변경 기록', a.scopeChangesRecorded],
    ['Completion 검증', a.completionVerified], ['Outcome 관측', a.outcomeObserved],
  ];
  const documented = checks.filter(([, ok]) => ok).map(([k]) => k);
  const gaps = checks.filter(([, ok]) => !ok).map(([k]) => k);
  // Evidence 없으면 결과가 좋아도 well_documented 금지
  const evidenceOk = a.evidenceCoverage != null && isFiniteNumber(a.evidenceCoverage) && a.evidenceCoverage >= 70;
  if (!evidenceOk) gaps.push('Evidence Coverage 부족(<70%)');
  const ratio = documented.length / checks.length;
  let verdict: AccountabilityVerdict;
  if (ratio >= 0.9 && evidenceOk) verdict = 'well_documented_reference';
  else if (ratio >= 0.7 && evidenceOk) verdict = 'adequately_documented';
  else if (ratio >= 0.5) verdict = 'partially_documented';
  else if (ratio >= 0.3) verdict = 'weakly_documented';
  else verdict = 'accountability_gap_candidate';
  return { verdict, documented, gaps, notPersonnelEvaluation: true, notDisciplinary: true };
}

/* ── Repeated Gap(개인 능력 단정 금지) ──────────────────────────────── */
export function detectRepeatedCommitmentGap(occurrences: { gapKind: string; commitmentCode: string }[] | null): { verdict: RepeatedGapVerdict; patterns: { kind: string; count: number }[]; personBlamed: false } {
  if (occurrences == null) return { verdict: 'insufficient_data', patterns: [], personBlamed: false };
  if (!occurrences.length) return { verdict: 'no_known_pattern', patterns: [], personBlamed: false };
  const byKind = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (!byKind.has(o.gapKind)) byKind.set(o.gapKind, new Set());
    byKind.get(o.gapKind)!.add(o.commitmentCode);
  }
  const patterns = [...byKind.entries()].map(([kind, codes]) => ({ kind, count: codes.size })).sort((a, b) => b.count - a.count);
  const max = patterns[0]?.count ?? 0;
  const criticalKinds = ['completion_unverified_repeat', 'evidence_missing_progress', 'outcome_missing'];
  if (max >= 5 && patterns.some((p) => criticalKinds.includes(p.kind) && p.count >= 5)) return { verdict: 'critical_commitment_gap', patterns, personBlamed: false };
  if (max >= 4) return { verdict: 'persistent_gap_pattern', patterns, personBlamed: false };
  if (max >= 2) return { verdict: 'repeated_gap_candidate', patterns, personBlamed: false };
  return { verdict: 'isolated_gap', patterns, personBlamed: false };
}

/* ── Recommendation(17종·Evidence 필수·사람 승인) ───────────────────── */
export const COMMITMENT_RECOMMENDATION_TYPES = ['request_owner_acknowledgement', 'assign_backup_reference', 'define_success_criteria', 'define_milestones', 'request_execution_evidence', 'verify_reported_progress', 'review_active_blocker', 'review_dependency_delay', 'review_schedule_variance', 'review_scope_drift', 'extend_observation_plan_candidate', 'request_completion_verification', 'prepare_outcome_observation', 'review_accountability_gap', 'create_decision_memory_link', 'create_executive_review_reference', 'insufficient_data'] as const;
export type CommitmentRecommendationType = (typeof COMMITMENT_RECOMMENDATION_TYPES)[number];

export function buildCommitmentRecommendation(i: { type: string; reason: string; evidence: string[]; severity: 'critical' | 'high' | 'moderate' | 'low'; riskIfDeferred: string | null }): { type: CommitmentRecommendationType; reason: string; evidence: string[]; severity: string; riskIfDeferred: string; humanApprovalRequired: true; autoExecuted: false } | { rejected: true; why: string } {
  if (!(COMMITMENT_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.reason.trim()) return { rejected: true, why: '사유 필수' };
  return { type: i.type as CommitmentRecommendationType, reason: i.reason, evidence: i.evidence, severity: i.severity, riskIfDeferred: i.riskIfDeferred?.trim() || '미룰 경우 위험 미상(0 아님)', humanApprovalRequired: true, autoExecuted: false };
}

/* ── Outcome Link / Timeline ─────────────────────────────────────────── */
export function buildCommitmentOutcomeLink(i: { commitmentCode: string; decisionMemoryRef: string | null; completionVerified: boolean; observationClosed: boolean | null; evidence: string[] }): { commitmentCode: string; decisionMemoryRef: string; linkStatus: 'outcome_linked_reference' | 'outcome_pending'; causallyAttributed: false } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Outcome 연결 금지' };
  if (!i.decisionMemoryRef?.trim()) return { insufficient: true, why: 'Decision Memory 참조 없음(자동 생성 금지)' };
  if (!i.completionVerified) return { insufficient: true, why: '완료 미검증 — Outcome 연결 전 completion verification 필요' };
  return { commitmentCode: i.commitmentCode, decisionMemoryRef: i.decisionMemoryRef, linkStatus: i.observationClosed === true ? 'outcome_linked_reference' : 'outcome_pending', causallyAttributed: false };
}

export function buildCommitmentTimeline(events: { at: Date; kind: string; label: string }[] | null, maxItems = 50): { items: { at: string; kind: string; label: string }[]; truncated: boolean } {
  if (!events?.length) return { items: [], truncated: false };
  const limit = Math.min(Math.max(1, Math.floor(isFiniteNumber(maxItems) ? maxItems : 50)), 200);
  const sorted = [...events].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: sorted.slice(0, limit).map((e) => ({ at: e.at.toISOString(), kind: e.kind, label: e.label })), truncated: sorted.length > limit };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const COMMITMENT_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'commitment', label: 'Commitment Record', status: 'supported', note: '선택 ≠ 실행 — 업무 지시 아님' },
  { key: 'priority_commitment', label: 'Priority Commitment', status: 'supported', note: '0518 accepted_reference 연결(FK 실존 검증)' },
  { key: 'portfolio_commitment', label: 'Portfolio Commitment', status: 'supported', note: '0519 selected_reference 연결' },
  { key: 'ownership', label: 'Ownership Reference', status: 'partial', note: 'HR/조직도 없음(실측) — Reference 기록만' },
  { key: 'owner_ack', label: 'Owner Acknowledgement', status: 'supported', note: 'Evidence 필수 — Reference 없으면 수락 아님' },
  { key: 'sponsor', label: 'Sponsor Reference', status: 'partial', note: 'Sponsor Role 실체 없음 — Reference만' },
  { key: 'reviewer', label: 'Reviewer Reference', status: 'supported', note: 'self_review 경고 보존' },
  { key: 'backup_owner', label: 'Backup Owner', status: 'partial', note: '단일 Admin 운영(실측) — 대부분 backup_missing' },
  { key: 'ownership_gap', label: 'Ownership Gap 감지', status: 'supported', note: '인사 평가 아님(notPersonnelEvaluation)' },
  { key: 'success_criteria', label: 'Success Criteria', status: 'supported', note: '없으면 성공 판정 금지 — 정성 기준은 qualitative_reference' },
  { key: 'milestone', label: 'Milestone', status: 'supported', note: '자동 Task 아님 — 30개 제한' },
  { key: 'milestone_evidence', label: 'Milestone Evidence', status: 'supported', note: '부족 시 verified_complete 서버 차단' },
  { key: 'reported_progress', label: 'Reported Progress', status: 'supported', note: '자기보고 — 검증 아님을 명시' },
  { key: 'verified_progress', label: 'Verified Progress', status: 'partial', note: '검증된 Milestone 실측만 — 자동 수집 없음' },
  { key: 'progress_snapshot', label: 'Progress Snapshot', status: 'supported', note: '덮어쓰기 금지 · reported 100%+미검증 → completion_unverified 강제' },
  { key: 'blocker', label: 'Blocker', status: 'supported', note: '18종 whitelist — 자동 해결 없음' },
  { key: 'blocker_impact', label: 'Blocker Impact', status: 'supported', note: 'Hard Risk 즉시 critical(희석 없음) — 능력 평가 아님' },
  { key: 'dependency_readiness', label: 'Dependency Readiness', status: 'supported', note: '미확인 → dependency_unverified(clear 금지)' },
  { key: 'schedule_baseline', label: 'Schedule Baseline', status: 'partial', note: 'Calendar/Working Day 없음(실측) → schedule_baseline_unverified' },
  { key: 'schedule_variance', label: 'Schedule Variance', status: 'partial', note: '기준 날짜 있을 때만 계산 — 자동 Deadline 변경 없음' },
  { key: 'scope_baseline', label: 'Scope Baseline', status: 'supported', note: '없으면 scope_baseline_unverified' },
  { key: 'scope_drift', label: 'Scope Drift', status: 'supported', note: '승인/무단 변경 구분 — 자동 Scope 변경 없음' },
  { key: 'commitment_aging', label: 'Commitment Aging', status: 'supported', note: 'Deadline 경과 ≠ 실패 확정 — 자동 Escalation 없음' },
  { key: 'delivery_confidence', label: 'Delivery Confidence', status: 'supported', note: '재정규화 + Hard Risk 희석 금지 — 점수 단독 반환 없음' },
  { key: 'commitment_risk', label: 'Commitment Risk', status: 'supported', note: 'Hard Risk 즉시 critical' },
  { key: 'completion_report', label: 'Completion Report', status: 'supported', note: '보고 ≠ 검증 ≠ Outcome' },
  { key: 'completion_verification', label: 'Completion Verification', status: 'supported', note: 'Evidence+Criteria+Critical Blocker 서버 3중 게이트' },
  { key: 'outcome_readiness', label: 'Outcome Readiness', status: 'supported', note: 'Baseline/Metric/Window 없으면 Ready 금지' },
  { key: 'accountability', label: 'Accountability Review', status: 'supported', note: '문서/절차 완결성만 — 인사 평가/징계 아님' },
  { key: 'repeated_gap', label: 'Repeated Commitment Gap', status: 'supported', note: '패턴 감지 — 개인 능력 단정 금지' },
  { key: 'recommendation', label: 'Commitment Recommendation', status: 'supported', note: '17종 whitelist · Evidence 필수 · 사람 승인' },
  { key: 'outcome_link', label: 'Commitment Outcome Link', status: 'supported', note: '0514 연결 — 완료·Outcome 자동 인과 없음' },
  { key: 'human_review', label: 'Human Review Workflow', status: 'supported', note: 'Commitment/Milestone/Completion/Accountability 4단 검토' },
  { key: 'external_action', label: 'External Commitment Action', status: 'supported', note: '15종 whitelist — 업무/일정/HR 미변경' },
  { key: 'pm_integration', label: 'Project Management 연동', status: 'unsupported', note: 'Jira/Linear/Asana 없음(실측)' },
  { key: 'calendar', label: 'Calendar 연동', status: 'unsupported', note: '연동 없음 — 날짜는 Reference' },
  { key: 'auto_commitment', label: '자동 Commitment 생성', status: 'unsupported', note: '전면 금지' },
  { key: 'auto_owner_assignment', label: '자동 Owner/업무 배정', status: 'unsupported', note: 'HR 시스템 없음 + 금지' },
  { key: 'auto_schedule_change', label: '자동 일정/Deadline 변경', status: 'unsupported', note: '전면 금지' },
  { key: 'auto_progress', label: '자동 Progress/완료 처리', status: 'unsupported', note: '전면 금지' },
  { key: 'auto_personnel_eval', label: '자동 인사/성과 평가', status: 'unsupported', note: '전면 금지(의도적)' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '미지원(의도적)' },
];
