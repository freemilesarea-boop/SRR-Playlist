/**
 * executiveCapacityIntelligence — Executive Capacity/Priority Portfolio/Financial Exposure
 * 순수 로직 (Phase AI-OPS-16).
 *
 * Priorities → Capacity Inventory → Effort → Constraints → Aging/Delay Exposure →
 * Financial Exposure/Opportunity Value → Portfolio 생성 → Feasibility/Conflict →
 * Load/Dependency 검토 → 사람 선택 → External Reference → Audit.
 *
 * Capacity 정직성(전부 코드로 강제):
 *  - 시간/인력 자료 없으면 Capacity 임의 생성 금지(unknown 유지). Effort null→0 합산 금지.
 *  - Aging ≠ 자동 승격. Exposure ≠ 실제 회계 손실. ROI Reference ≠ 실제 투자수익률.
 *  - Confidence Drift ≠ 자동 Confidence 수정. Dependency ≠ 인사 평가.
 *  - Portfolio ≠ 실행 계획. 전 조합 미검토 → optimal 단정 없음. Hard Risk 조용한 제외 금지.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type CapacityStatus = 'available_reference' | 'constrained_candidate' | 'overloaded_candidate' | 'critical_overload_candidate' | 'executive_capacity_unknown' | 'workforce_capacity_unknown' | 'stale_candidate' | 'insufficient_data';
export type DecisionLoadVerdict = 'manageable_reference' | 'elevated_load' | 'overloaded_candidate' | 'critical_decision_load' | 'insufficient_data';
export type UtilizationVerdict = 'low_utilization_reference' | 'balanced_reference' | 'high_utilization_candidate' | 'overloaded_candidate' | 'executive_capacity_unknown' | 'insufficient_data';
export type EffortStatus = 'measured_reference' | 'partially_estimated' | 'manually_estimated' | 'effort_unverified' | 'stale_candidate' | 'insufficient_data';
export type AgingStatus = 'fresh_reference' | 'aging_candidate' | 'stale_priority_candidate' | 'deadline_approaching' | 'overdue_candidate' | 'critical_overdue_candidate' | 'aging_threshold_unverified' | 'insufficient_data';
export type DelayExposureVerdict = 'negligible_candidate' | 'low_exposure_candidate' | 'moderate_exposure_candidate' | 'high_exposure_candidate' | 'critical_exposure_candidate' | 'financial_exposure_unknown' | 'causality_unverified' | 'insufficient_data';
export type RoiVerdict = 'favorable_roi_candidate' | 'moderate_roi_candidate' | 'low_roi_candidate' | 'negative_roi_candidate' | 'roi_unavailable' | 'financial_exposure_unknown' | 'insufficient_data';
export type DriftStatus = 'stable_reference' | 'increasing_candidate' | 'decreasing_candidate' | 'volatile_candidate' | 'confidence_drift_unverified' | 'sample_too_small' | 'insufficient_data';
export type OrgDependencyVerdict = 'dependency_resilient_reference' | 'concentration_candidate' | 'single_person_dependency_candidate' | 'single_approver_dependency_candidate' | 'missing_owner' | 'missing_backup_owner' | 'organizational_dependency_unverified' | 'insufficient_data';
export type FeasibilityStatus = 'feasible_reference' | 'partially_feasible' | 'executive_capacity_unknown' | 'workforce_capacity_unknown' | 'over_capacity' | 'resource_conflict' | 'schedule_conflict' | 'mutually_exclusive_conflict' | 'blocking_dependency' | 'hard_risk_uncovered' | 'infeasible' | 'feasibility_unverified' | 'insufficient_data';
export type SimulationVerdict = 'feasible_candidate' | 'mixed_candidate' | 'high_risk_candidate' | 'capacity_overload_candidate' | 'hard_risk_uncovered' | 'infeasible' | 'counterfactual_unverified' | 'insufficient_data';

/* ── Executive Capacity(임의 생성 금지·성과 평가 아님) ──────────────── */
export function validateExecutiveCapacity(c: { availableHours: number | null; reservedHours: number | null; reviewCapacity: number | null; currentPriorities: number | null } | null): string[] {
  if (!c) return ['capacity 입력 없음'];
  const errors: string[] = [];
  if (c.availableHours != null && (!isFiniteNumber(c.availableHours) || c.availableHours < 0)) errors.push('available_hours 음수/NaN 금지');
  if (c.reservedHours != null && (!isFiniteNumber(c.reservedHours) || c.reservedHours < 0)) errors.push('reserved_hours 음수/NaN 금지');
  if (c.availableHours != null && c.reservedHours != null && c.reservedHours > c.availableHours) errors.push('reserved > available 금지');
  if (c.reviewCapacity != null && (!isFiniteNumber(c.reviewCapacity) || c.reviewCapacity < 0)) errors.push('review capacity 음수 금지');
  if (c.currentPriorities != null && (!isFiniteNumber(c.currentPriorities) || c.currentPriorities < 0)) errors.push('priority count 음수 금지');
  return errors;   // hours null 은 오류 아님 — unknown 처리(임의 생성 금지)
}

export function classifyExecutiveCapacity(c: { availableHours: number | null; reservedHours: number | null; concurrentLimit: number | null; currentPriorities: number | null }): { status: CapacityStatus; notPerformanceEvaluation: true; note: string } {
  if (c.availableHours == null) return { status: 'executive_capacity_unknown', notPerformanceEvaluation: true, note: '시간 자료 없음 — 임의 생성 금지' };
  const free = c.availableHours - (c.reservedHours ?? 0);
  const overLimit = isFiniteNumber(c.concurrentLimit) && isFiniteNumber(c.currentPriorities) && c.currentPriorities > c.concurrentLimit;
  if (c.availableHours <= 0 || (overLimit && free <= 0)) return { status: 'critical_overload_candidate', notPerformanceEvaluation: true, note: '가용 시간 0 이하' };
  if (overLimit || free / c.availableHours < 0.1) return { status: 'overloaded_candidate', notPerformanceEvaluation: true, note: '동시 한도 초과 또는 여유 10% 미만' };
  if (free / c.availableHours < 0.3) return { status: 'constrained_candidate', notPerformanceEvaluation: true, note: '여유 30% 미만' };
  return { status: 'available_reference', notPerformanceEvaluation: true, note: '가용 후보(성과 평가 아님)' };
}

/* ── Decision Load ───────────────────────────────────────────────────── */
export function calculateDecisionLoad(i: { pendingPriorities: number | null; p0Count: number | null; p1Count: number | null; pendingAgendas: number | null; pendingConflicts: number | null; singleApprover: boolean | null }): { verdict: DecisionLoadVerdict; reasons: string[] } {
  if (!isFiniteNumber(i.pendingPriorities)) return { verdict: 'insufficient_data', reasons: ['대기 건수 미상'] };
  const reasons: string[] = [];
  const p0 = isFiniteNumber(i.p0Count) ? i.p0Count : 0;
  const total = i.pendingPriorities + (isFiniteNumber(i.pendingAgendas) ? i.pendingAgendas : 0) + (isFiniteNumber(i.pendingConflicts) ? i.pendingConflicts : 0);
  if (p0 > 0) reasons.push(`P0 ${p0}건 집중`);
  if (i.singleApprover === true) reasons.push('단일 Approver 의존(정상 상태 아님)');
  if (total >= 20) reasons.push(`검토 대기 총 ${total}건`);
  else if (total >= 10) reasons.push(`검토 대기 ${total}건 증가`);
  if (p0 >= 3 || (i.singleApprover === true && total >= 20)) return { verdict: 'critical_decision_load', reasons };
  if (total >= 20 || (p0 > 0 && i.singleApprover === true)) return { verdict: 'overloaded_candidate', reasons };
  if (total >= 10 || p0 > 0 || i.singleApprover === true) return { verdict: 'elevated_load', reasons };
  return { verdict: 'manageable_reference', reasons: [] };
}

/* ── Capacity Utilization(Available 없으면 계산 금지) ───────────────── */
export function calculateCapacityUtilization(i: { usedHours: number | null; availableHours: number | null; concurrentUsed: number | null; concurrentLimit: number | null }): { utilizationPct: number | null; verdict: UtilizationVerdict } {
  if (i.availableHours == null || !isFiniteNumber(i.availableHours)) return { utilizationPct: null, verdict: 'executive_capacity_unknown' };
  if (i.availableHours <= 0) return { utilizationPct: null, verdict: 'insufficient_data' };
  if (i.usedHours == null || !isFiniteNumber(i.usedHours)) return { utilizationPct: null, verdict: 'insufficient_data' };
  const pct = (i.usedHours / i.availableHours) * 100;
  const overConcurrent = isFiniteNumber(i.concurrentUsed) && isFiniteNumber(i.concurrentLimit) && i.concurrentLimit > 0 && i.concurrentUsed > i.concurrentLimit;
  if (pct > 100 || overConcurrent) return { utilizationPct: Math.round(pct), verdict: 'overloaded_candidate' };
  if (pct >= 80) return { utilizationPct: Math.round(pct), verdict: 'high_utilization_candidate' };
  if (pct >= 40) return { utilizationPct: Math.round(pct), verdict: 'balanced_reference' };
  return { utilizationPct: Math.round(pct), verdict: 'low_utilization_reference' };
}

/* ── Priority Effort(null→0 합산 금지·검토/실행 분리) ───────────────── */
export function validatePriorityEffort(e: { reviewHours: number | null; decisionHours: number | null; executionHours: number | null } | null): string[] {
  if (!e) return ['effort 입력 없음'];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (v != null && (!isFiniteNumber(v) || v < 0)) errors.push(`${k} 음수/NaN 금지`);
  }
  return errors;
}

export function calculatePriorityEffort(e: { reviewHours: number | null; decisionHours: number | null; meetingHours: number | null; analysisHours: number | null; executionHours: number | null; observationHours: number | null }): { reviewTotalHours: number | null; executionTotalHours: number | null; status: EffortStatus; missing: string[]; nullSummedAsZero: false } {
  const reviewParts = [['review', e.reviewHours], ['decision', e.decisionHours], ['meeting', e.meetingHours], ['analysis', e.analysisHours]] as const;
  const execParts = [['execution', e.executionHours], ['observation', e.observationHours]] as const;
  const missing = [...reviewParts, ...execParts].filter(([, v]) => v == null || !isFiniteNumber(v)).map(([k]) => k);
  const knownReview = reviewParts.filter(([, v]) => v != null && isFiniteNumber(v));
  const knownExec = execParts.filter(([, v]) => v != null && isFiniteNumber(v));
  // 알려진 항목만 부분 합산 — null 을 0 으로 채우지 않음
  const reviewTotal = knownReview.length ? knownReview.reduce((s, [, v]) => s + (v as number), 0) : null;
  const execTotal = knownExec.length ? knownExec.reduce((s, [, v]) => s + (v as number), 0) : null;
  const status: EffortStatus = missing.length === 0 ? 'measured_reference' : knownReview.length + knownExec.length > 0 ? 'partially_estimated' : 'effort_unverified';
  return { reviewTotalHours: reviewTotal, executionTotalHours: execTotal, status, missing, nullSummedAsZero: false };
}

/* ── Priority Aging(자동 승격 없음·Threshold 명시 입력) ─────────────── */
export function calculatePriorityAging(i: { createdAt: Date | null; reviewedAt: Date | null; deadlineAt: Date | null; now: Date }): { ageDays: number | null; statusAgeDays: number | null; daysToDeadline: number | null } {
  const age = i.createdAt ? Math.max(0, (i.now.getTime() - i.createdAt.getTime()) / 86400000) : null;
  const statusAge = i.reviewedAt ? Math.max(0, (i.now.getTime() - i.reviewedAt.getTime()) / 86400000) : null;
  const toDeadline = i.deadlineAt ? (i.deadlineAt.getTime() - i.now.getTime()) / 86400000 : null;
  return { ageDays: age == null ? null : Math.round(age * 100) / 100, statusAgeDays: statusAge == null ? null : Math.round(statusAge * 100) / 100, daysToDeadline: toDeadline == null ? null : Math.round(toDeadline * 100) / 100 };
}

export function classifyAgingStatus(i: { ageDays: number | null; daysToDeadline: number | null; thresholds: { agingDays: number; staleDays: number } | null }): { status: AgingStatus; autoEscalated: false; note: string } {
  if (i.daysToDeadline != null && isFiniteNumber(i.daysToDeadline)) {
    if (i.daysToDeadline < -7) return { status: 'critical_overdue_candidate', autoEscalated: false, note: 'deadline 7일 초과 경과(자동 승격 없음)' };
    if (i.daysToDeadline < 0) return { status: 'overdue_candidate', autoEscalated: false, note: 'deadline 경과' };
    if (i.daysToDeadline <= 7) return { status: 'deadline_approaching', autoEscalated: false, note: 'deadline 7일 이내' };
  }
  if (i.ageDays == null || !isFiniteNumber(i.ageDays)) return { status: 'insufficient_data', autoEscalated: false, note: 'age 미상' };
  if (!i.thresholds) return { status: 'aging_threshold_unverified', autoEscalated: false, note: '운영 Threshold 기준 없음 — 고정값 단정 금지' };
  if (i.ageDays >= i.thresholds.staleDays) return { status: 'stale_priority_candidate', autoEscalated: false, note: `기준(${i.thresholds.staleDays}일) 초과` };
  if (i.ageDays >= i.thresholds.agingDays) return { status: 'aging_candidate', autoEscalated: false, note: `기준(${i.thresholds.agingDays}일) 초과` };
  return { status: 'fresh_reference', autoEscalated: false, note: '기준 이내' };
}

/* ── Delay Exposure / Financial Exposure / Delay Cost ───────────────── */
export function calculateDelayExposure(i: { exposureAmountKrw: number | null; mrrKrw: number | null; hardRiskWindow: boolean | null; causalBasis: boolean | null }): { verdict: DelayExposureVerdict; accountingLoss: false } {
  if (i.hardRiskWindow === true) return { verdict: 'critical_exposure_candidate', accountingLoss: false };
  if (i.exposureAmountKrw == null || !isFiniteNumber(i.exposureAmountKrw)) return { verdict: 'financial_exposure_unknown', accountingLoss: false };
  if (i.causalBasis !== true) return { verdict: 'causality_unverified', accountingLoss: false };
  if (!isFiniteNumber(i.mrrKrw) || i.mrrKrw <= 0) return { verdict: 'insufficient_data', accountingLoss: false };
  const ratio = Math.abs(i.exposureAmountKrw) / i.mrrKrw;
  if (ratio >= 0.5) return { verdict: 'critical_exposure_candidate', accountingLoss: false };
  if (ratio >= 0.2) return { verdict: 'high_exposure_candidate', accountingLoss: false };
  if (ratio >= 0.05) return { verdict: 'moderate_exposure_candidate', accountingLoss: false };
  if (ratio >= 0.01) return { verdict: 'low_exposure_candidate', accountingLoss: false };
  return { verdict: 'negligible_candidate', accountingLoss: false };
}

export function calculateFinancialExposure(i: { lowEstimate: number | null; expectedEstimate: number | null; highEstimate: number | null; probabilityPct: number | null }): { expectedExposure: number | null; range: { low: number | null; high: number | null }; verification: 'assumption_based' | 'financial_exposure_unknown'; accountingLoss: false } {
  const hasAny = [i.lowEstimate, i.expectedEstimate, i.highEstimate].some((v) => v != null && isFiniteNumber(v));
  if (!hasAny) return { expectedExposure: null, range: { low: null, high: null }, verification: 'financial_exposure_unknown', accountingLoss: false };
  const expected = i.expectedEstimate != null && isFiniteNumber(i.expectedEstimate) ? i.expectedEstimate : null;
  const prob = i.probabilityPct != null && isFiniteNumber(i.probabilityPct) ? Math.min(100, Math.max(0, i.probabilityPct)) / 100 : null;
  const weighted = expected != null && prob != null ? expected * prob : expected;
  return { expectedExposure: weighted == null ? null : Math.round(weighted), range: { low: i.lowEstimate, high: i.highEstimate }, verification: 'assumption_based', accountingLoss: false };
}

export function calculateDelayCost(i: { exposureAmount: number | null; delayFactorPerDay: number | null; delayDays: number | null; causalBasis: boolean | null }): { cost: number | null; status: 'delay_cost_estimated_reference' | 'partially_estimated' | 'financial_exposure_unknown' | 'causality_unverified' | 'insufficient_data'; fabricated: false } {
  if (i.exposureAmount == null || !isFiniteNumber(i.exposureAmount)) return { cost: null, status: 'financial_exposure_unknown', fabricated: false };
  if (i.causalBasis !== true) return { cost: null, status: 'causality_unverified', fabricated: false };
  if (i.delayFactorPerDay == null || !isFiniteNumber(i.delayFactorPerDay) || i.delayDays == null || !isFiniteNumber(i.delayDays)) return { cost: null, status: 'insufficient_data', fabricated: false };
  return { cost: Math.round(i.exposureAmount * i.delayFactorPerDay * Math.max(0, i.delayDays)), status: 'delay_cost_estimated_reference', fabricated: false };
}

/* ── Opportunity ROI Reference(Cost 0/null 계산 금지) ───────────────── */
export function calculateOpportunityROI(i: { expectedBenefit: number | null; expectedCost: number | null }): { roiPct: number | null; verdict: RoiVerdict; actualReturn: false } {
  if (i.expectedCost == null || !isFiniteNumber(i.expectedCost) || i.expectedCost === 0) return { roiPct: null, verdict: 'roi_unavailable', actualReturn: false };
  if (i.expectedBenefit == null || !isFiniteNumber(i.expectedBenefit)) return { roiPct: null, verdict: 'financial_exposure_unknown', actualReturn: false };
  const roi = ((i.expectedBenefit - i.expectedCost) / i.expectedCost) * 100;
  const verdict: RoiVerdict = roi >= 100 ? 'favorable_roi_candidate' : roi >= 30 ? 'moderate_roi_candidate' : roi >= 0 ? 'low_roi_candidate' : 'negative_roi_candidate';
  return { roiPct: Math.round(roi), verdict, actualReturn: false };
}

export function evaluateNonFinancialValue(values: { kind: string; rationale: string; evidence: string[] }[] | null): { items: { kind: string; rationale: string; label: 'qualitative_reference' }[]; monetized: false } {
  if (!values?.length) return { items: [], monetized: false };
  return {
    items: values.filter((v) => v.evidence.length > 0).map((v) => ({ kind: v.kind, rationale: v.rationale, label: 'qualitative_reference' as const })),
    monetized: false,   // 금액 환산 근거 없이 환산하지 않음
  };
}

/* ── Confidence Drift(표본<3 판정 금지·자동 수정 없음) ──────────────── */
export function calculateConfidenceDrift(history: { at: Date; value: number }[] | null): { driftFromInitial: number | null; driftFromPrevious: number | null; volatility: number | null; sampleSize: number } {
  const valid = (history ?? []).filter((h) => isFiniteNumber(h.value)).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (valid.length < 2) return { driftFromInitial: null, driftFromPrevious: null, volatility: null, sampleSize: valid.length };
  const first = valid[0].value; const last = valid[valid.length - 1].value; const prev = valid[valid.length - 2].value;
  const diffs = valid.slice(1).map((h, idx) => Math.abs(h.value - valid[idx].value));
  const volatility = diffs.length ? Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 100) / 100 : null;
  return { driftFromInitial: last - first, driftFromPrevious: last - prev, volatility, sampleSize: valid.length };
}

export function classifyConfidenceDrift(i: { driftFromInitial: number | null; volatility: number | null; sampleSize: number }): { status: DriftStatus; autoConfidenceAdjusted: false; autoDiscarded: false } {
  if (i.sampleSize < 3) return { status: 'sample_too_small', autoConfidenceAdjusted: false, autoDiscarded: false };
  if (i.driftFromInitial == null || !isFiniteNumber(i.driftFromInitial)) return { status: 'confidence_drift_unverified', autoConfidenceAdjusted: false, autoDiscarded: false };
  if (i.volatility != null && i.volatility >= 15) return { status: 'volatile_candidate', autoConfidenceAdjusted: false, autoDiscarded: false };
  if (i.driftFromInitial >= 10) return { status: 'increasing_candidate', autoConfidenceAdjusted: false, autoDiscarded: false };
  if (i.driftFromInitial <= -10) return { status: 'decreasing_candidate', autoConfidenceAdjusted: false, autoDiscarded: false };
  return { status: 'stable_reference', autoConfidenceAdjusted: false, autoDiscarded: false };
}

/* ── Organizational Dependency(인사 평가 아님) ──────────────────────── */
export function detectOrganizationalDependency(i: { owners: string[] | null; approvers: string[] | null; backups: string[] | null; orgDataAvailable: boolean }): { verdict: OrgDependencyVerdict; findings: string[]; notPersonnelEvaluation: true } {
  if (!i.orgDataAvailable) return { verdict: 'organizational_dependency_unverified', findings: ['조직도/Role 데이터 없음 — 의존성 임의 생성 금지'], notPersonnelEvaluation: true };
  const owners = i.owners ?? []; const approvers = i.approvers ?? []; const backups = i.backups ?? [];
  const findings: string[] = [];
  if (owners.length === 0) { findings.push('Owner 부재'); return { verdict: 'missing_owner', findings, notPersonnelEvaluation: true }; }
  if (backups.length === 0) findings.push('Backup Owner 부재');
  if (owners.length === 1) findings.push(`단일 담당 의존: ${owners[0]}`);
  if (approvers.length === 1) findings.push(`단일 Approver 의존: ${approvers[0]}`);
  if (backups.length === 0 && owners.length >= 1) return { verdict: 'missing_backup_owner', findings, notPersonnelEvaluation: true };
  if (approvers.length === 1) return { verdict: 'single_approver_dependency_candidate', findings, notPersonnelEvaluation: true };
  if (owners.length === 1) return { verdict: 'single_person_dependency_candidate', findings, notPersonnelEvaluation: true };
  return { verdict: 'dependency_resilient_reference', findings, notPersonnelEvaluation: true };
}

export function detectSinglePersonDependency(assignments: { person: string; priorityCodes: string[] }[] | null): { concentrated: { person: string; count: number }[]; verdict: OrgDependencyVerdict } {
  if (!assignments?.length) return { concentrated: [], verdict: 'organizational_dependency_unverified' };
  const concentrated = assignments.filter((a) => a.priorityCodes.length >= 3).map((a) => ({ person: a.person, count: a.priorityCodes.length }));
  return { concentrated, verdict: concentrated.length ? 'concentration_candidate' : 'dependency_resilient_reference' };
}

export function detectSingleApproverDependency(reviews: { approver: string | null }[] | null): { verdict: OrgDependencyVerdict; approverCount: number } {
  if (!reviews?.length) return { verdict: 'organizational_dependency_unverified', approverCount: 0 };
  const approvers = new Set(reviews.map((r) => r.approver).filter((a): a is string => Boolean(a)));
  if (approvers.size === 0) return { verdict: 'missing_owner', approverCount: 0 };
  if (approvers.size === 1) return { verdict: 'single_approver_dependency_candidate', approverCount: 1 };
  return { verdict: 'dependency_resilient_reference', approverCount: approvers.size };
}

/* ── Portfolio 생성/Feasibility/Hard Risk Coverage ───────────────────── */
export interface PortfolioPriorityInput { code: string; tier: string; hardRiskFlags: string[]; reviewHours: number | null; materialityScore: number | null; mutuallyExclusiveWith: string[]; dependencies: string[] }

export function buildPriorityPortfolio(i: { priorities: PortfolioPriorityInput[]; availableReviewHours: number | null; strategy: 'hard_risk_first_reference' | 'tier_first_reference' | 'greedy_reference' | 'balanced_reference' }): { included: string[]; excluded: { code: string; why: string }[]; totalReviewHours: number | null; optimalClaimed: false; autoSelected: false } {
  const sorted = [...i.priorities].sort((a, b) => {
    if (i.strategy === 'hard_risk_first_reference' || i.strategy === 'balanced_reference') {
      const hardDiff = (b.hardRiskFlags.length > 0 ? 1 : 0) - (a.hardRiskFlags.length > 0 ? 1 : 0);
      if (hardDiff !== 0) return hardDiff;
    }
    const tierRank = (t: string) => (t === 'P0_human_review_now' ? 0 : t === 'P1_executive_review' ? 1 : t === 'P2_planned_review' ? 2 : 3);
    const tierDiff = tierRank(a.tier) - tierRank(b.tier);
    if (tierDiff !== 0) return tierDiff;
    return (b.materialityScore ?? -1) - (a.materialityScore ?? -1);
  });
  const included: string[] = [];
  const excluded: { code: string; why: string }[] = [];
  let usedHours = 0; let anyKnownHours = false;
  for (const p of sorted) {
    const mutex = p.mutuallyExclusiveWith.find((m) => included.includes(m));
    if (mutex) { excluded.push({ code: p.code, why: `상호 배타: ${mutex} 포함됨(자동 제거 아님 — 명시 제외)` }); continue; }
    if (i.availableReviewHours != null && p.reviewHours != null) {
      anyKnownHours = true;
      if (usedHours + p.reviewHours > i.availableReviewHours) { excluded.push({ code: p.code, why: 'Capacity 초과(중요도 부족 아님)' }); continue; }
      usedHours += p.reviewHours;
    }
    included.push(p.code);
  }
  return { included, excluded, totalReviewHours: anyKnownHours ? usedHours : null, optimalClaimed: false, autoSelected: false };
}

export function evaluateHardRiskCoverage(i: { priorities: PortfolioPriorityInput[]; includedCodes: string[]; exclusionReasons: Record<string, string> | null }): { covered: boolean; uncovered: { code: string; flags: string[] }[]; silentlyExcluded: string[] } {
  const hardPriorities = i.priorities.filter((p) => p.hardRiskFlags.length > 0 || p.tier === 'P0_human_review_now');
  const uncovered = hardPriorities.filter((p) => !i.includedCodes.includes(p.code));
  const silentlyExcluded = uncovered.filter((p) => !i.exclusionReasons?.[p.code]?.trim()).map((p) => p.code);
  return { covered: uncovered.length === 0, uncovered: uncovered.map((p) => ({ code: p.code, flags: p.hardRiskFlags })), silentlyExcluded };
}

export function evaluatePortfolioFeasibility(i: {
  totalReviewHours: number | null; availableReviewHours: number | null;
  hardRiskCoverage: { covered: boolean; silentlyExcluded: string[] };
  resourceConflicts: string[]; scheduleConflicts: string[]; mutexConflicts: string[]; blockingDependencies: string[];
}): { status: FeasibilityStatus; reasons: string[]; executionPlan: false } {
  const reasons: string[] = [];
  // Hard Risk 조용한 제외 → feasible 금지(최우선)
  if (i.hardRiskCoverage.silentlyExcluded.length > 0) return { status: 'hard_risk_uncovered', reasons: [`Hard Risk 사유 없이 제외: ${i.hardRiskCoverage.silentlyExcluded.join(', ')}`], executionPlan: false };
  if (i.mutexConflicts.length > 0) return { status: 'mutually_exclusive_conflict', reasons: i.mutexConflicts, executionPlan: false };
  if (i.resourceConflicts.length > 0) return { status: 'resource_conflict', reasons: i.resourceConflicts, executionPlan: false };
  if (i.scheduleConflicts.length > 0) return { status: 'schedule_conflict', reasons: i.scheduleConflicts, executionPlan: false };
  if (i.blockingDependencies.length > 0) return { status: 'blocking_dependency', reasons: i.blockingDependencies, executionPlan: false };
  if (i.availableReviewHours == null) return { status: 'executive_capacity_unknown', reasons: ['가용 시간 자료 없음 — feasible 단정 금지'], executionPlan: false };
  if (i.totalReviewHours == null) return { status: 'feasibility_unverified', reasons: ['Effort 미상 — 검증 불가'], executionPlan: false };
  if (i.totalReviewHours > i.availableReviewHours) return { status: 'over_capacity', reasons: [`필요 ${i.totalReviewHours}h > 가용 ${i.availableReviewHours}h`], executionPlan: false };
  if (!i.hardRiskCoverage.covered) reasons.push('Hard Risk 일부 명시적 제외(사유 존재)');
  return { status: reasons.length ? 'partially_feasible' : 'feasible_reference', reasons, executionPlan: false };
}

/* ── Conflict 감지(보존·자동 제거 없음) ─────────────────────────────── */
export function detectCapacityConflict(i: { requiredRoles: string[]; sharedRoleUsage: Record<string, number> | null; roleLimit: number }): { verdict: 'resource_conflict' | 'no_known_conflict' | 'insufficient_data'; overloadedRoles: string[] } {
  if (!i.sharedRoleUsage) return { verdict: 'insufficient_data', overloadedRoles: [] };
  const overloaded = i.requiredRoles.filter((r) => (i.sharedRoleUsage?.[r] ?? 0) >= i.roleLimit);
  return { verdict: overloaded.length ? 'resource_conflict' : 'no_known_conflict', overloadedRoles: overloaded };
}

export function detectScheduleConflict(a: { code: string; start: Date | null; end: Date | null } | null, b: { code: string; start: Date | null; end: Date | null } | null): { verdict: 'schedule_conflict' | 'no_known_conflict' | 'insufficient_data'; preserved: string[] } {
  if (!a || !b || !a.start || !a.end || !b.start || !b.end) return { verdict: 'insufficient_data', preserved: [] };
  const overlap = a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
  return { verdict: overlap ? 'schedule_conflict' : 'no_known_conflict', preserved: [a.code, b.code] };
}

export function detectMutuallyExclusivePriorities(priorities: { code: string; mutuallyExclusiveWith: string[] }[], includedCodes: string[]): { conflicts: { a: string; b: string }[]; autoRemoved: false } {
  const conflicts: { a: string; b: string }[] = [];
  const includedSet = new Set(includedCodes);
  for (const p of priorities) {
    if (!includedSet.has(p.code)) continue;
    for (const m of p.mutuallyExclusiveWith) {
      if (includedSet.has(m) && p.code < m) conflicts.push({ a: p.code, b: m });
    }
  }
  return { conflicts, autoRemoved: false };
}

/* ── Deferral / Load Balancing / Simulation ─────────────────────────── */
export function buildPriorityDeferralCandidate(i: { code: string; reason: 'capacity_conflict' | 'lower_materiality' | 'lower_urgency' | 'dependency_waiting' | 'evidence_gap'; riskIfDeferred: string | null; financialExposure: number | null; evidence: string[] }): { code: string; reason: string; riskIfDeferred: string; financialExposure: number | null; autoDeferred: false } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Deferral 후보 생성 금지' };
  return {
    code: i.code, reason: i.reason,
    riskIfDeferred: i.riskIfDeferred?.trim() || '미룰 경우 위험 미상(0 아님 — 평가 필요)',
    financialExposure: i.financialExposure,   // null 유지(0 변환 금지)
    autoDeferred: false,
  };
}

export const LOAD_BALANCING_TYPES = ['distribute_review_candidate', 'assign_backup_reference', 'require_joint_review', 'sequence_reviews_candidate', 'reduce_concurrent_priorities', 'create_separate_agenda_candidate', 'request_capacity_data', 'insufficient_data'] as const;

export function buildExecutiveLoadBalancingCandidate(i: { singleRoleOverload: boolean; singleApprover: boolean; missingBackup: boolean; meetingOverload: boolean; capacityDataAvailable: boolean }): { type: (typeof LOAD_BALANCING_TYPES)[number]; workAssigned: false }[] {
  const out: { type: (typeof LOAD_BALANCING_TYPES)[number]; workAssigned: false }[] = [];
  if (!i.capacityDataAvailable) return [{ type: 'request_capacity_data', workAssigned: false }];
  if (i.singleApprover) out.push({ type: 'require_joint_review', workAssigned: false });
  if (i.missingBackup) out.push({ type: 'assign_backup_reference', workAssigned: false });
  if (i.singleRoleOverload) out.push({ type: 'distribute_review_candidate', workAssigned: false });
  if (i.meetingOverload) out.push({ type: 'reduce_concurrent_priorities', workAssigned: false });
  if (!out.length) out.push({ type: 'insufficient_data', workAssigned: false });
  return out;
}

export function simulatePortfolioDecision(i: { scenario: string; totalReviewHours: number | null; availableReviewHours: number | null; capacityReductionPct: number | null; hardRiskCovered: boolean | null; evidenceBased: boolean }): { scenario: string; verdict: SimulationVerdict; autoExecuted: false; counterfactual: true } {
  if (!i.evidenceBased) return { scenario: i.scenario, verdict: 'counterfactual_unverified', autoExecuted: false, counterfactual: true };
  if (i.hardRiskCovered === false) return { scenario: i.scenario, verdict: 'hard_risk_uncovered', autoExecuted: false, counterfactual: true };
  if (i.totalReviewHours == null || i.availableReviewHours == null) return { scenario: i.scenario, verdict: 'insufficient_data', autoExecuted: false, counterfactual: true };
  const reduction = i.capacityReductionPct != null && isFiniteNumber(i.capacityReductionPct) ? Math.min(100, Math.max(0, i.capacityReductionPct)) : 0;
  const effective = i.availableReviewHours * (1 - reduction / 100);
  if (effective <= 0 || i.totalReviewHours > effective * 1.5) return { scenario: i.scenario, verdict: 'infeasible', autoExecuted: false, counterfactual: true };
  if (i.totalReviewHours > effective) return { scenario: i.scenario, verdict: 'capacity_overload_candidate', autoExecuted: false, counterfactual: true };
  if (i.totalReviewHours > effective * 0.8) return { scenario: i.scenario, verdict: 'mixed_candidate', autoExecuted: false, counterfactual: true };
  return { scenario: i.scenario, verdict: 'feasible_candidate', autoExecuted: false, counterfactual: true };
}

/* ── Recommendation(Evidence 필수·사람 승인) ────────────────────────── */
export const CAPACITY_RECOMMENDATION_TYPES = ['request_capacity_data', 'reduce_concurrent_priorities', 'preserve_executive_reserve', 'prioritize_hard_risk_review', 'sequence_priorities_candidate', 'defer_low_materiality_candidate', 'protect_opportunity_window', 'review_financial_exposure', 'review_delay_cost', 'review_overdue_priority', 'resolve_resource_conflict', 'resolve_schedule_conflict', 'add_backup_owner_reference', 'require_joint_review', 'review_confidence_drift', 'choose_balanced_portfolio_candidate', 'create_executive_agenda_reference', 'insufficient_data'] as const;
export type CapacityRecommendationType = (typeof CAPACITY_RECOMMENDATION_TYPES)[number];

export function buildExecutiveCapacityRecommendation(i: { type: string; reason: string; evidence: string[]; severity: 'critical' | 'high' | 'moderate' | 'low'; capacityImpact: string | null; riskIfDeferred: string | null }): { type: CapacityRecommendationType; reason: string; evidence: string[]; severity: string; capacityImpact: string; riskIfDeferred: string; humanApprovalRequired: true; autoExecuted: false } | { rejected: true; why: string } {
  if (!(CAPACITY_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.reason.trim()) return { rejected: true, why: '사유 필수' };
  return {
    type: i.type as CapacityRecommendationType, reason: i.reason, evidence: i.evidence, severity: i.severity,
    capacityImpact: i.capacityImpact?.trim() || '영향 미상(과장 금지)',
    riskIfDeferred: i.riskIfDeferred?.trim() || '미룰 경우 위험 미상(0 아님)',
    humanApprovalRequired: true, autoExecuted: false,
  };
}

/* ── Portfolio Outcome Link(자동 인과 없음) ─────────────────────────── */
export function buildPortfolioOutcomeLink(i: { portfolioCode: string; decisionMemoryRef: string | null; observationClosed: boolean | null; evidence: string[] }): { portfolioCode: string; decisionMemoryRef: string; linkStatus: 'outcome_linked_reference' | 'outcome_pending'; causallyAttributed: false } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Outcome 연결 금지' };
  if (!i.decisionMemoryRef?.trim()) return { insufficient: true, why: 'Decision Memory 참조 없음(자동 생성 금지)' };
  return { portfolioCode: i.portfolioCode, decisionMemoryRef: i.decisionMemoryRef, linkStatus: i.observationClosed === true ? 'outcome_linked_reference' : 'outcome_pending', causallyAttributed: false };
}

/* ── 종합 Capacity Health(참고 점수 — 선택 아님) ────────────────────── */
export function calculateCapacityHealthScore(c: { utilizationScore: number | null; loadScore: number | null; dependencyScore: number | null; agingScore: number | null }): { score: number | null; used: string[]; missing: string[]; selectionOrder: false } {
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'utilization', value: c.utilizationScore, weight: 0.3 },
    { key: 'load', value: c.loadScore, weight: 0.3 },
    { key: 'dependency', value: c.dependencyScore, weight: 0.2 },
    { key: 'aging', value: c.agingScore, weight: 0.2 },
  ]);
  return { score: score == null ? null : clampScore(score), used, missing, selectionOrder: false };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const CAPACITY_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'executive_capacity', label: 'Executive Capacity Snapshot', status: 'partial', note: 'Calendar/Working Hours 없음 — 수동 입력 시에만 판정, 없으면 unknown' },
  { key: 'decision_load', label: 'Decision Load', status: 'supported', note: '0518 priority/agenda/conflict 대기 실측' },
  { key: 'capacity_utilization', label: 'Capacity Utilization', status: 'partial', note: 'Available 자료 있는 경우만 계산(없으면 계산 금지)' },
  { key: 'priority_effort', label: 'Priority Effort', status: 'partial', note: '0518 에 effort 필드 없음 — 수동/Reference 추정만' },
  { key: 'review_vs_execution', label: '검토/실행 시간 분리', status: 'supported', note: '별도 컬럼·별도 합산' },
  { key: 'meeting_load', label: 'Meeting Load', status: 'partial', note: '회의 시스템 없음 — 수동 기록' },
  { key: 'priority_aging', label: 'Priority Aging', status: 'supported', note: 'created_at/reviewed_at/deadline_at(0518) 실측' },
  { key: 'aging_threshold', label: 'Aging Threshold', status: 'partial', note: '운영 기준 미정 — 명시 입력만(aging_threshold_unverified)' },
  { key: 'delay_exposure', label: 'Delay Exposure', status: 'partial', note: 'MRR 실측 대비 비율 — 인과 미확인 시 causality_unverified' },
  { key: 'financial_exposure', label: 'Financial Exposure', status: 'partial', note: '추정 Reference — 실제 회계 손실 아님' },
  { key: 'delay_cost', label: 'Delay Cost', status: 'partial', note: 'Exposure/Factor/Time/인과 전부 있을 때만 계산' },
  { key: 'opportunity_roi', label: 'Opportunity ROI Reference', status: 'partial', note: 'Cost 0/null 계산 금지 — 실제 투자수익률 아님' },
  { key: 'non_financial_value', label: 'Non-Financial Value', status: 'supported', note: 'qualitative_reference 만(금액 환산 없음)' },
  { key: 'confidence_drift', label: 'Confidence Drift', status: 'supported', note: 'Snapshot 기반 — 표본<3 판정 금지' },
  { key: 'confidence_history', label: 'Confidence History', status: 'supported', note: '덮어쓰기 금지 snapshot 누적' },
  { key: 'org_dependency', label: 'Organizational Dependency', status: 'partial', note: '조직도 없음 — users.role admin 실측 + 수동 Reference' },
  { key: 'single_person_dep', label: 'Single Person Dependency', status: 'supported', note: '단일 Admin 실측 감지' },
  { key: 'single_approver_dep', label: 'Single Approver Dependency', status: 'supported', note: '검토 이력 approver 실측' },
  { key: 'missing_owner', label: 'Missing Owner/Backup', status: 'supported', note: 'Owner/Backup Reference 부재 감지' },
  { key: 'priority_portfolio', label: 'Priority Portfolio', status: 'supported', note: '후보 생성만 — 실행 계획 아님' },
  { key: 'portfolio_feasibility', label: 'Portfolio Feasibility', status: 'supported', note: 'Capacity 미상 시 feasible 단정 금지' },
  { key: 'hard_risk_coverage', label: 'Hard Risk Coverage', status: 'supported', note: '조용한 제외 시 feasible 서버 차단' },
  { key: 'capacity_conflict', label: 'Capacity/Resource Conflict', status: 'supported', note: '보존 — 자동 제거 없음' },
  { key: 'schedule_conflict', label: 'Schedule Conflict', status: 'partial', note: '기간 입력 시에만 — Calendar 없음' },
  { key: 'mutual_exclusion', label: 'Mutual Exclusion', status: 'supported', note: '0518 mutually_exclusive_with 재사용' },
  { key: 'priority_deferral', label: 'Priority Deferral Candidate', status: 'supported', note: '후보만 — 자동 상태 변경 없음' },
  { key: 'load_balancing', label: 'Executive Load Balancing', status: 'supported', note: '권고만 — 실제 업무 할당 없음' },
  { key: 'decision_simulation', label: 'Decision Simulation', status: 'supported', note: '입력/Evidence 기반만 — counterfactual 명시' },
  { key: 'capacity_recommendation', label: 'Capacity Recommendation', status: 'supported', note: '18종 whitelist·Evidence 필수·사람 승인' },
  { key: 'portfolio_outcome', label: 'Portfolio Outcome Link', status: 'supported', note: '0514 Decision Memory 연결 — 인과 자동 연결 없음' },
  { key: 'human_review', label: 'Human Review Workflow', status: 'supported', note: 'selected_reference ≠ 실행 확정' },
  { key: 'external_action', label: 'External Capacity Action', status: 'supported', note: '참조 기록만 — Calendar/인력/예산 미변경' },
  { key: 'auto_priority_selection', label: '자동 Priority 선택', status: 'unsupported', note: '전면 금지 — 사람 선택만' },
  { key: 'auto_calendar', label: '자동 캘린더/회의 생성', status: 'unsupported', note: '연동 자체 없음' },
  { key: 'auto_work_assignment', label: '자동 업무/인력 배치', status: 'unsupported', note: 'HR 시스템 없음 + 금지' },
  { key: 'auto_budget', label: '자동 예산 배정/지출', status: 'unsupported', note: 'Budget 시스템 없음 + 금지' },
  { key: 'auto_executive_decision', label: '자동 Executive Decision', status: 'unsupported', note: '전면 금지' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '미지원(의도적)' },
];
