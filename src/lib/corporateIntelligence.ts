/**
 * corporateIntelligence — 전사 신호/Executive Priority/충돌/Briefing 순수 로직
 * (Phase AI-OPS-15).
 *
 * Corporate Signal → Materiality/Urgency 검토 → Cross-Domain Conflict →
 * Priority Candidate → Tier(P0~P3) → Executive Attention → Agenda →
 * Daily Briefing → Decision Package → Board Reference → Outcome Link → Timeline.
 *
 * 경영 정직성(전부 코드로 강제):
 *  - Priority Score ≠ 자동 실행 순서. P0 = 즉시 사람 검토(자동 실행 아님).
 *  - Urgent 와 Important 분리. Hard Security/Privacy/Compliance Risk 평균 희석 금지.
 *  - 비금전 Risk 0 평가 금지(금액 미상 → null 유지 + materiality_unverified).
 *  - Corporate Health 점수 단독 표시 금지(status+risks+unknown+coverage 동시).
 *  - Board Reference ≠ 법적 이사회 자료. selected_reference ≠ 실제 실행.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · depth/cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type MaterialityStatus = 'material_candidate' | 'possibly_material' | 'not_material_candidate' | 'materiality_unverified' | 'insufficient_data';
export type UrgencyStatus = 'urgent_candidate' | 'possibly_urgent' | 'not_urgent_candidate' | 'urgency_unverified' | 'insufficient_data';
export type PriorityTier = 'P0_human_review_now' | 'P1_executive_review' | 'P2_planned_review' | 'P3_monitor' | 'insufficient_data';
export type UrgentVsImportant = 'urgent_and_important' | 'important_not_urgent' | 'urgent_not_important' | 'neither_candidate' | 'insufficient_data';
export type ConflictVerdict = 'conflict_candidate' | 'no_known_conflict' | 'insufficient_data';
export type BottleneckVerdict = 'bottleneck_candidate' | 'material_bottleneck' | 'no_known_bottleneck' | 'insufficient_data';
export type CorporateHealthStatus = 'healthy_reference' | 'watch_candidate' | 'degraded_candidate' | 'critical_risk_present' | 'insufficient_data';
export type OpportunityVerdict = 'opportunity_candidate' | 'weak_opportunity_candidate' | 'no_known_opportunity' | 'insufficient_data';
export type RiskVerdict = 'material_risk_candidate' | 'watch_risk_candidate' | 'no_known_material_risk' | 'insufficient_data';

export type HardRiskFlag = 'security' | 'privacy' | 'compliance';

export const MAX_PRIORITY_DEPTH_DEFAULT = 3;
export const MAX_PRIORITY_DEPTH_CLAMP = 5;

/* ── Signal 검증 ──────────────────────────────────────────────────────── */
export const CORP_SIGNAL_TYPES = ['mrr_change', 'revenue_change', 'store_growth_change', 'enterprise_growth_change', 'artist_growth_change', 'churn_risk_change', 'contract_expiry_approaching', 'settlement_anomaly_candidate', 'payout_risk_change', 'cost_change', 'capacity_risk_change', 'incident_change', 'security_risk_change', 'privacy_risk_change', 'compliance_risk_change', 'policy_conflict_reference', 'strategic_scenario_reference', 'portfolio_allocation_reference', 'decision_outcome_reference', 'learning_pattern_reference', 'causal_candidate_reference', 'calibration_reference', 'external_environment_reference', 'manual'] as const;

export function validateCorporateSignal(s: { type?: string; title?: string | null; metricValue?: number | null; monetaryImpact?: number | null; evidence?: unknown[] | null } | null): string[] {
  if (!s) return ['signal 없음'];
  const errors: string[] = [];
  if (!s.type || !(CORP_SIGNAL_TYPES as readonly string[]).includes(s.type)) errors.push('허용되지 않는 signal type');
  if (!s.title?.trim()) errors.push('title 필수');
  if (!s.evidence?.length) errors.push('Evidence 필수');
  if (s.metricValue != null && !isFiniteNumber(s.metricValue)) errors.push('metric NaN/Infinity 금지');
  if (s.monetaryImpact != null && !isFiniteNumber(s.monetaryImpact)) errors.push('monetary impact NaN/Infinity 금지');
  return errors;   // metric/금액 null 은 오류 아님(0 변환 금지 — unverified 처리)
}

/* ── Materiality(비금전 Risk 0 평가 금지·재정규화) ───────────────────── */
export function calculateMateriality(i: {
  monetaryImpactKrw: number | null; mrrKrw: number | null;
  affectedStores: number | null; totalStores: number | null;
  hardRiskFlags: HardRiskFlag[] | null; strategicRelevance: number | null;
}): { score: number | null; status: MaterialityStatus; used: string[]; missing: string[]; note: string } {
  const hardRisks = i.hardRiskFlags ?? [];
  // Hard Risk 는 금액과 무관하게 material — 비금전 Risk 0 평가 금지
  if (hardRisks.length > 0) {
    return { score: null, status: 'material_candidate', used: ['hard_risk_flags'], missing: [], note: `Hard Risk(${hardRisks.join(',')}) — 금액 미상이어도 material(0 평가 금지)` };
  }
  const monetaryPct = isFiniteNumber(i.monetaryImpactKrw) && isFiniteNumber(i.mrrKrw) && i.mrrKrw > 0
    ? Math.min(100, (Math.abs(i.monetaryImpactKrw) / i.mrrKrw) * 100) : null;
  const storePct = isFiniteNumber(i.affectedStores) && isFiniteNumber(i.totalStores) && i.totalStores > 0
    ? Math.min(100, (i.affectedStores / i.totalStores) * 100) : null;
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'monetary', value: monetaryPct, weight: 0.5 },
    { key: 'blast_radius', value: storePct, weight: 0.3 },
    { key: 'strategic', value: i.strategicRelevance, weight: 0.2 },
  ]);
  if (score == null) return { score: null, status: 'materiality_unverified', used, missing, note: '평가 가능한 구성 요소 없음 — 0 변환 금지' };
  const status: MaterialityStatus = score >= 40 ? 'material_candidate' : score >= 15 ? 'possibly_material' : 'not_material_candidate';
  return { score: clampScore(score), status, used, missing, note: missing.length ? `누락 구성 요소(${missing.join(',')}) 제외 후 재정규화` : '전체 구성 요소 평가' };
}

/* ── Urgency(deadline 기반 — 자동 실행 아님) ─────────────────────────── */
export function calculateUrgency(i: { deadlineAt: Date | null; now: Date; escalationVelocity: number | null; alreadyBreaching: boolean | null }): { score: number | null; status: UrgencyStatus; daysToDeadline: number | null; autoExecution: false } {
  if (i.alreadyBreaching === true) return { score: 100, status: 'urgent_candidate', daysToDeadline: 0, autoExecution: false };
  const days = i.deadlineAt ? (i.deadlineAt.getTime() - i.now.getTime()) / 86400000 : null;
  const deadlineScore = days == null ? null : days <= 0 ? 100 : days <= 3 ? 90 : days <= 7 ? 70 : days <= 30 ? 40 : 15;
  const { score } = normalizeAvailableComponents([
    { key: 'deadline', value: deadlineScore, weight: 0.7 },
    { key: 'velocity', value: i.escalationVelocity, weight: 0.3 },
  ]);
  if (score == null) return { score: null, status: 'urgency_unverified', daysToDeadline: days, autoExecution: false };
  const status: UrgencyStatus = score >= 70 ? 'urgent_candidate' : score >= 40 ? 'possibly_urgent' : 'not_urgent_candidate';
  return { score: clampScore(score), status, daysToDeadline: days, autoExecution: false };
}

/* ── Urgent vs Important 분리 ────────────────────────────────────────── */
export function classifyUrgentVsImportant(materiality: MaterialityStatus, urgency: UrgencyStatus): UrgentVsImportant {
  if (materiality === 'materiality_unverified' || materiality === 'insufficient_data' || urgency === 'urgency_unverified' || urgency === 'insufficient_data') return 'insufficient_data';
  const important = materiality === 'material_candidate' || materiality === 'possibly_material';
  const urgent = urgency === 'urgent_candidate' || urgency === 'possibly_urgent';
  if (urgent && important) return 'urgent_and_important';
  if (!urgent && important) return 'important_not_urgent';
  if (urgent && !important) return 'urgent_not_important';
  return 'neither_candidate';
}

/* ── Executive Priority(Hard Risk 희석 금지 — floor override) ────────── */
export function calculateExecutivePriority(i: {
  materialityScore: number | null; urgencyScore: number | null;
  hardRiskFlags: HardRiskFlag[] | null; blastRadiusScore: number | null; confidence: number | null;
}): { score: number | null; hardRiskFloorApplied: boolean; used: string[]; missing: string[]; notExecutionOrder: true } {
  const hardRisks = i.hardRiskFlags ?? [];
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'materiality', value: i.materialityScore, weight: 0.4 },
    { key: 'urgency', value: i.urgencyScore, weight: 0.35 },
    { key: 'blast_radius', value: i.blastRadiusScore, weight: 0.15 },
    { key: 'confidence', value: i.confidence, weight: 0.1 },
  ]);
  // Hard Risk 는 평균으로 희석 금지 — floor 85 강제(가중 평균이 낮아도 상향)
  if (hardRisks.length > 0) {
    const base = score == null ? 85 : Math.max(85, score);
    return { score: clampScore(base), hardRiskFloorApplied: true, used: [...used, 'hard_risk_floor'], missing, notExecutionOrder: true };
  }
  if (score == null) return { score: null, hardRiskFloorApplied: false, used, missing, notExecutionOrder: true };
  return { score: clampScore(score), hardRiskFloorApplied: false, used, missing, notExecutionOrder: true };
}

export function classifyPriorityTier(i: { priorityScore: number | null; hardRiskFlags: HardRiskFlag[] | null; urgencyStatus: UrgencyStatus; materialityStatus: MaterialityStatus }): { tier: PriorityTier; humanReviewRequired: boolean; autoExecution: false; note: string } {
  const hardRisks = i.hardRiskFlags ?? [];
  // Hard Risk + 긴급 → P0 = 즉시 사람 검토(자동 실행 아님)
  if (hardRisks.length > 0 && i.urgencyStatus === 'urgent_candidate') {
    return { tier: 'P0_human_review_now', humanReviewRequired: true, autoExecution: false, note: 'Hard Risk + 긴급 — 즉시 사람 검토(자동 실행 아님)' };
  }
  if (hardRisks.length > 0) return { tier: 'P1_executive_review', humanReviewRequired: true, autoExecution: false, note: 'Hard Risk — P3 강등 금지(희석 금지)' };
  if (i.priorityScore == null || i.materialityStatus === 'materiality_unverified') {
    return { tier: 'insufficient_data', humanReviewRequired: true, autoExecution: false, note: 'Score/Materiality 미검증 — Tier 확정 금지' };
  }
  if (i.priorityScore >= 85 && i.urgencyStatus === 'urgent_candidate') return { tier: 'P0_human_review_now', humanReviewRequired: true, autoExecution: false, note: '고점수 + 긴급 — 즉시 사람 검토' };
  if (i.priorityScore >= 60) return { tier: 'P1_executive_review', humanReviewRequired: true, autoExecution: false, note: '경영진 검토 후보' };
  if (i.priorityScore >= 30) return { tier: 'P2_planned_review', humanReviewRequired: true, autoExecution: false, note: '계획 검토 후보' };
  return { tier: 'P3_monitor', humanReviewRequired: false, autoExecution: false, note: '모니터링 후보(실행 순서 아님)' };
}

/* ── Cross-Domain Conflict(16축·충돌 보존) ───────────────────────────── */
export const CONFLICT_TYPES = ['resource_conflict', 'budget_conflict', 'personnel_capacity_conflict', 'timeline_conflict', 'policy_conflict', 'strategy_conflict', 'priority_conflict', 'dependency_conflict', 'risk_appetite_conflict', 'compliance_vs_speed_conflict', 'cost_vs_reliability_conflict', 'growth_vs_margin_conflict', 'security_vs_convenience_conflict', 'short_term_vs_long_term_conflict', 'data_conflict', 'manual'] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export function detectCorporateConflict(a: { id: string; domain: string; resources: string[] | null; deadlineAt: Date | null; direction: 'expand' | 'reduce' | 'hold' | null } | null, b: { id: string; domain: string; resources: string[] | null; deadlineAt: Date | null; direction: 'expand' | 'reduce' | 'hold' | null } | null): { verdict: ConflictVerdict; conflictTypes: ConflictType[]; preservedSides: string[]; autoResolved: false } {
  if (!a || !b || a.id === b.id) return { verdict: 'insufficient_data', conflictTypes: [], preservedSides: [], autoResolved: false };
  const types: ConflictType[] = [];
  const sharedResources = (a.resources ?? []).filter((r) => (b.resources ?? []).includes(r));
  if (sharedResources.length > 0) types.push('resource_conflict');
  if (sharedResources.length > 0 && a.deadlineAt && b.deadlineAt && Math.abs(a.deadlineAt.getTime() - b.deadlineAt.getTime()) <= 7 * 86400000) types.push('timeline_conflict');
  if (a.domain === b.domain && a.direction && b.direction && a.direction !== b.direction && (a.direction === 'expand' || b.direction === 'expand') && (a.direction === 'reduce' || b.direction === 'reduce')) types.push('strategy_conflict');
  if (types.length === 0) return { verdict: 'no_known_conflict', conflictTypes: [], preservedSides: [a.id, b.id], autoResolved: false };
  return { verdict: 'conflict_candidate', conflictTypes: types, preservedSides: [a.id, b.id], autoResolved: false };
}

/* ── Decision Bottleneck ─────────────────────────────────────────────── */
export function detectDecisionBottleneck(i: { pendingReviewCount: number | null; oldestPendingDays: number | null; p0PendingCount: number | null }): { verdict: BottleneckVerdict; reasons: string[] } {
  if (!isFiniteNumber(i.pendingReviewCount)) return { verdict: 'insufficient_data', reasons: ['대기 건수 미상'] };
  const reasons: string[] = [];
  if (isFiniteNumber(i.p0PendingCount) && i.p0PendingCount > 0) reasons.push(`P0 ${i.p0PendingCount}건 검토 대기 — 즉시 사람 검토 필요`);
  if (isFiniteNumber(i.oldestPendingDays) && i.oldestPendingDays >= 14) reasons.push(`최장 ${i.oldestPendingDays}일 대기`);
  if (i.pendingReviewCount >= 10) reasons.push(`검토 대기 ${i.pendingReviewCount}건 누적`);
  if (reasons.length === 0) return { verdict: 'no_known_bottleneck', reasons: [] };
  const material = (isFiniteNumber(i.p0PendingCount) && i.p0PendingCount > 0) || (isFiniteNumber(i.oldestPendingDays) && i.oldestPendingDays >= 30);
  return { verdict: material ? 'material_bottleneck' : 'bottleneck_candidate', reasons };
}

/* ── Corporate Health(critical risk 희석 금지·점수 단독 표시 금지) ───── */
export function calculateCorporateHealth(c: {
  revenueHealth: number | null; growthHealth: number | null; costHealth: number | null;
  reliabilityHealth: number | null; securityHealth: number | null; settlementHealth: number | null;
  criticalRisks: string[] | null; unknownFactors: string[] | null;
}): { score: number | null; status: CorporateHealthStatus; criticalRisks: string[]; unknownFactors: string[]; coverage: number; missing: string[]; limitations: string[]; standaloneScoreDisplay: false } {
  const criticalRisks = c.criticalRisks ?? [];
  const unknownFactors = c.unknownFactors ?? [];
  const components = [
    { key: 'revenue', value: c.revenueHealth, weight: 0.25 },
    { key: 'growth', value: c.growthHealth, weight: 0.15 },
    { key: 'cost', value: c.costHealth, weight: 0.15 },
    { key: 'reliability', value: c.reliabilityHealth, weight: 0.15 },
    { key: 'security', value: c.securityHealth, weight: 0.15 },
    { key: 'settlement', value: c.settlementHealth, weight: 0.15 },
  ];
  const { score, used, missing } = normalizeAvailableComponents(components);
  const coverage = clampScore((used.length / components.length) * 100);
  const limitations = ['Health 점수 단독 표시 금지 — status/risks/unknown/coverage 동시 제공', 'Critical Risk 는 평균으로 희석되지 않음'];
  // Critical Risk 존재 시 점수와 무관하게 critical 상태(희석 금지)
  if (criticalRisks.length > 0) return { score: score == null ? null : clampScore(score), status: 'critical_risk_present', criticalRisks, unknownFactors, coverage, missing, limitations, standaloneScoreDisplay: false };
  if (score == null) return { score: null, status: 'insufficient_data', criticalRisks, unknownFactors, coverage, missing, limitations, standaloneScoreDisplay: false };
  const status: CorporateHealthStatus = score >= 75 ? 'healthy_reference' : score >= 50 ? 'watch_candidate' : 'degraded_candidate';
  return { score: clampScore(score), status, criticalRisks, unknownFactors, coverage, missing, limitations, standaloneScoreDisplay: false };
}

/* ── Opportunity / Material Risk ─────────────────────────────────────── */
export function detectStrategicOpportunity(i: { growthSignalCount: number | null; positiveOutcomeCount: number | null; capacityHeadroom: number | null; evidence: string[] | null }): { verdict: OpportunityVerdict; evidence: string[]; guaranteed: false } {
  if (!i.evidence?.length) return { verdict: 'insufficient_data', evidence: [], guaranteed: false };
  const growth = isFiniteNumber(i.growthSignalCount) ? i.growthSignalCount : 0;
  const outcomes = isFiniteNumber(i.positiveOutcomeCount) ? i.positiveOutcomeCount : 0;
  if (growth >= 2 && outcomes >= 1 && isFiniteNumber(i.capacityHeadroom) && i.capacityHeadroom > 20) return { verdict: 'opportunity_candidate', evidence: i.evidence, guaranteed: false };
  if (growth >= 1) return { verdict: 'weak_opportunity_candidate', evidence: i.evidence, guaranteed: false };
  return { verdict: 'no_known_opportunity', evidence: i.evidence, guaranteed: false };
}

export function detectMaterialRisk(i: { hardRiskFlags: HardRiskFlag[] | null; monetaryImpactKrw: number | null; mrrKrw: number | null; singlePointDependencies: string[] | null }): { verdict: RiskVerdict; reasons: string[]; nonMonetaryZeroed: false } {
  const reasons: string[] = [];
  const hardRisks = i.hardRiskFlags ?? [];
  // 비금전 Risk 를 0 으로 평가 금지 — Hard Risk 는 금액 미상이어도 material
  if (hardRisks.length > 0) reasons.push(`Hard Risk: ${hardRisks.join(',')} (금액 미상이어도 0 평가 금지)`);
  if (isFiniteNumber(i.monetaryImpactKrw) && isFiniteNumber(i.mrrKrw) && i.mrrKrw > 0 && Math.abs(i.monetaryImpactKrw) >= i.mrrKrw * 0.1) reasons.push('금전 영향 MRR 10% 이상');
  for (const dep of i.singlePointDependencies ?? []) reasons.push(`단일 의존(실측): ${dep}`);
  if (reasons.length === 0) {
    if (!isFiniteNumber(i.monetaryImpactKrw) && hardRisks.length === 0) return { verdict: 'insufficient_data', reasons: ['금액 미상 + Hard Risk 없음 — 판정 불가(0 아님)'], nonMonetaryZeroed: false };
    return { verdict: 'no_known_material_risk', reasons: [], nonMonetaryZeroed: false };
  }
  return { verdict: hardRisks.length > 0 || reasons.length >= 2 ? 'material_risk_candidate' : 'watch_risk_candidate', reasons, nonMonetaryZeroed: false };
}

/* ── Executive Attention / Daily Briefing ────────────────────────────── */
export function buildExecutiveAttentionCandidate(p: { code: string; tier: PriorityTier; urgentVsImportant: UrgentVsImportant; deadlineAt: Date | null; now: Date }): { code: string; attentionRank: number; reason: string; autoExecution: false } | { excluded: true; why: string } {
  if (p.tier === 'insufficient_data') return { excluded: true, why: 'Tier 미확정 — Attention 후보 제외(데이터 부족 명시)' };
  if (p.tier === 'P3_monitor') return { excluded: true, why: 'P3 모니터링 — 즉시 주의 불필요' };
  const rank = p.tier === 'P0_human_review_now' ? 1 : p.tier === 'P1_executive_review' ? 2 : 3;
  const days = p.deadlineAt ? Math.ceil((p.deadlineAt.getTime() - p.now.getTime()) / 86400000) : null;
  return { code: p.code, attentionRank: rank, reason: `${p.tier} / ${p.urgentVsImportant}${days != null ? ` / D${days >= 0 ? '-' + days : '+' + Math.abs(days)}` : ''}`, autoExecution: false };
}

export function buildExecutiveDailyBriefing(i: {
  date: string;
  whatChanged: { title: string; evidence: string[] }[];
  whatMatters: { title: string; tier: PriorityTier }[];
  decisionRequired: { title: string; deadline: string | null }[];
  canWait: string[];
  mustNotDo: string[];
}): { date: string; sections: { whatChanged: { title: string; evidence: string[] }[]; whatMatters: { title: string; tier: PriorityTier }[]; decisionRequired: { title: string; deadline: string | null }[]; canWait: string[]; mustNotDo: string[] }; autoSent: false; limitations: string[] } | { insufficient: true; why: string } {
  const invalid = i.whatChanged.some((w) => !w.evidence.length);
  if (invalid) return { insufficient: true, why: 'What Changed 항목에 Evidence 없음 — Briefing 생성 금지' };
  return {
    date: i.date,
    sections: {
      whatChanged: i.whatChanged.slice(0, 20),
      whatMatters: i.whatMatters.slice(0, 20),
      decisionRequired: i.decisionRequired.slice(0, 20),
      canWait: i.canWait.slice(0, 20),
      mustNotDo: i.mustNotDo.slice(0, 20),
    },
    autoSent: false,
    limitations: ['Briefing 자동 발송 없음', 'Decision Required = 사람 결정 필요(자동 실행 아님)'],
  };
}

/* ── Agenda / Decision Package / Board Reference ─────────────────────── */
export function buildExecutiveAgenda(i: { window: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'ad_hoc'; priorities: { code: string; tier: PriorityTier }[]; conflicts: string[]; risks: string[] }): { window: string; items: { kind: string; ref: string }[]; calendarCreated: false; confirmedIsNotExecution: true } {
  const items: { kind: string; ref: string }[] = [];
  for (const p of i.priorities.filter((x) => x.tier === 'P0_human_review_now')) items.push({ kind: 'p0_immediate_review', ref: p.code });
  for (const p of i.priorities.filter((x) => x.tier === 'P1_executive_review')) items.push({ kind: 'priority_review', ref: p.code });
  for (const c of i.conflicts) items.push({ kind: 'conflict_resolution_review', ref: c });
  for (const r of i.risks) items.push({ kind: 'risk_review', ref: r });
  return { window: i.window, items: items.slice(0, 30), calendarCreated: false, confirmedIsNotExecution: true };
}

export function buildDecisionPackage(i: { title: string; options: { name: string; expectedImpact: string; risks: string[]; evidence: string[] }[]; evidence: string[] }): { title: string; options: { name: string; expectedImpact: string; risks: string[]; evidence: string[] }[]; includesNoActionOption: boolean; humanDecisionRequired: true; autoExecution: false } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Decision Package 생성 금지' };
  if (i.options.some((o) => !o.evidence.length)) return { insufficient: true, why: '옵션별 Evidence 필수' };
  const hasNoAction = i.options.some((o) => /no.?action|아무것도|미실행|현상 유지/i.test(o.name));
  const options = hasNoAction ? i.options : [...i.options, { name: 'no_action(현상 유지)', expectedImpact: '변경 없음 — 기회비용/위험 지속 여부는 사람 판단', risks: ['현상 유지 시 위험 지속 가능'], evidence: i.evidence }];
  return { title: i.title, options: options.slice(0, 10), includesNoActionOption: true, humanDecisionRequired: true, autoExecution: false };
}

export function buildBoardReference(i: { period: string; healthStatus: CorporateHealthStatus; topPriorities: string[]; materialRisks: string[]; openConflicts: string[]; evidence: string[] }): { period: string; summary: { healthStatus: CorporateHealthStatus; topPriorities: string[]; materialRisks: string[]; openConflicts: string[] }; legalBoardDocument: false; autoSent: false; limitations: string[] } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Board Reference 생성 금지' };
  return {
    period: i.period,
    summary: { healthStatus: i.healthStatus, topPriorities: i.topPriorities.slice(0, 10), materialRisks: i.materialRisks.slice(0, 10), openConflicts: i.openConflicts.slice(0, 10) },
    legalBoardDocument: false,
    autoSent: false,
    limitations: ['법적 이사회 자료 아님(참고용)', '자동 발송/안건 확정 없음', 'Material Risk 는 요약에서 생략 금지'],
  };
}

/* ── Priority Dependency Graph(depth 기본 3/clamp 5·cycle 방어) ──────── */
export function buildPriorityDependencyGraph(edges: { from: string; to: string }[], rootCode: string, maxDepth: number = MAX_PRIORITY_DEPTH_DEFAULT): { nodes: { code: string; depth: number }[]; cycles: string[]; truncated: boolean } {
  const depth = Math.min(Math.max(1, Math.floor(isFiniteNumber(maxDepth) ? maxDepth : MAX_PRIORITY_DEPTH_DEFAULT)), MAX_PRIORITY_DEPTH_CLAMP);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e.to);
  }
  const nodes: { code: string; depth: number }[] = [];
  const visited = new Set<string>();
  const cycles: string[] = [];
  let truncated = false;
  const queue: { code: string; d: number; path: string[] }[] = [{ code: rootCode, d: 0, path: [rootCode] }];
  while (queue.length) {
    const { code, d, path } = queue.shift()!;
    if (visited.has(code)) continue;
    visited.add(code);
    nodes.push({ code, depth: d });
    if (d >= depth) { if ((adjacency.get(code) ?? []).length > 0) truncated = true; continue; }
    for (const next of adjacency.get(code) ?? []) {
      if (path.includes(next)) { cycles.push([...path, next].join('→')); continue; }
      if (!visited.has(next)) queue.push({ code: next, d: d + 1, path: [...path, next] });
    }
  }
  return { nodes, cycles, truncated };
}

/* ── Conflict Resolution Candidate(11종·후보만) ──────────────────────── */
export const CONFLICT_RESOLUTION_TYPES = ['sequence_adjustment_candidate', 'scope_reduction_candidate', 'resource_reallocation_review', 'deadline_renegotiation_review', 'escalate_to_executive', 'accept_tradeoff_candidate', 'defer_one_side_candidate', 'split_resources_candidate', 'policy_clarification_review', 'additional_evidence_needed', 'manual'] as const;
export type ConflictResolutionType = (typeof CONFLICT_RESOLUTION_TYPES)[number];

export function buildConflictResolutionCandidate(c: { conflictType: ConflictType | null; severity: 'critical' | 'high' | 'medium' | 'low' | null; bothSidesPreserved: boolean; evidence: string[] }): { type: ConflictResolutionType; rationale: string; autoResolved: false; humanApprovalRequired: true } | { insufficient: true; why: string } {
  if (!c.evidence.length) return { insufficient: true, why: 'Evidence 없음 — 해소 후보 생성 금지' };
  if (!c.bothSidesPreserved) return { insufficient: true, why: '양쪽 입장 미보존 — 평균 숨김 금지 위반' };
  if (!c.conflictType) return { insufficient: true, why: 'conflict type 미상' };
  let type: ConflictResolutionType;
  if (c.severity === 'critical') type = 'escalate_to_executive';
  else if (c.conflictType === 'resource_conflict' || c.conflictType === 'budget_conflict' || c.conflictType === 'personnel_capacity_conflict') type = 'resource_reallocation_review';
  else if (c.conflictType === 'timeline_conflict') type = 'deadline_renegotiation_review';
  else if (c.conflictType === 'policy_conflict') type = 'policy_clarification_review';
  else if (c.conflictType === 'strategy_conflict' || c.conflictType === 'priority_conflict') type = 'sequence_adjustment_candidate';
  else if (c.conflictType === 'data_conflict') type = 'additional_evidence_needed';
  else type = 'accept_tradeoff_candidate';
  return { type, rationale: `${c.conflictType}(${c.severity ?? 'severity_unverified'}) — 후보일 뿐 자동 해소 아님`, autoResolved: false, humanApprovalRequired: true };
}

/* ── Corporate Recommendation(20종·Evidence 필수·사람 승인) ──────────── */
export const CORP_RECOMMENDATION_TYPES = ['review_p0_priority_now', 'schedule_executive_review', 'resolve_decision_bottleneck', 'review_material_risk', 'review_strategic_opportunity', 'resolve_resource_conflict', 'resolve_policy_conflict', 'resolve_strategy_conflict', 'review_contract_expiry', 'review_settlement_anomaly', 'review_security_risk', 'review_privacy_risk', 'review_compliance_risk', 'review_capacity_plan', 'review_cost_change', 'update_daily_briefing_process', 'prepare_board_reference', 'link_priority_outcome', 'collect_missing_evidence', 'no_action_needed'] as const;
export type CorpRecommendationType = (typeof CORP_RECOMMENDATION_TYPES)[number];

export function buildCorporateRecommendation(i: { type: string; rationale: string; evidence: string[]; expectedBenefit: string | null }): { type: CorpRecommendationType; rationale: string; evidence: string[]; expectedBenefit: string; humanApprovalRequired: true; autoExecuted: false } | { rejected: true; why: string } {
  if (!(CORP_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.rationale.trim()) return { rejected: true, why: '근거 설명 필수' };
  return { type: i.type as CorpRecommendationType, rationale: i.rationale, evidence: i.evidence, expectedBenefit: i.expectedBenefit?.trim() || '기대 효과 미상(과장 금지)', humanApprovalRequired: true, autoExecuted: false };
}

/* ── Priority Outcome Link(자동 인과 연결 없음) ──────────────────────── */
export function buildPriorityOutcomeLink(i: { priorityCode: string; outcomeRef: string | null; observationClosed: boolean | null; evidence: string[] }): { priorityCode: string; outcomeRef: string; linkStatus: 'outcome_linked_reference' | 'outcome_pending'; causallyAttributed: false } | { insufficient: true; why: string } {
  if (!i.evidence.length) return { insufficient: true, why: 'Evidence 없음 — Outcome 연결 금지' };
  if (!i.outcomeRef?.trim()) return { insufficient: true, why: 'Outcome 참조 없음 — 연결 불가(자동 생성 금지)' };
  return {
    priorityCode: i.priorityCode,
    outcomeRef: i.outcomeRef,
    linkStatus: i.observationClosed === true ? 'outcome_linked_reference' : 'outcome_pending',
    causallyAttributed: false,   // 연결 ≠ 인과 — 인과는 0517 검토 워크플로만
  };
}

/* ── Corporate Timeline ──────────────────────────────────────────────── */
export function buildCorporateTimeline(events: { at: Date; kind: string; label: string }[] | null, maxItems = 50): { items: { at: string; kind: string; label: string }[]; truncated: boolean } {
  if (!events?.length) return { items: [], truncated: false };
  const limit = Math.min(Math.max(1, Math.floor(isFiniteNumber(maxItems) ? maxItems : 50)), 200);
  const sorted = [...events].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: sorted.slice(0, limit).map((e) => ({ at: e.at.toISOString(), kind: e.kind, label: e.label })), truncated: sorted.length > limit };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ───────────────────────────── */
export const CORP_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'mrr_signal', label: 'MRR 변화 신호', status: 'supported', note: 'subscriptions.current_amount 실측' },
  { key: 'revenue_signal', label: '매출 변화 신호', status: 'supported', note: 'payment_orders(paid) 실측' },
  { key: 'store_growth_signal', label: '매장 성장 신호', status: 'supported', note: 'users(account_type=business) 실측' },
  { key: 'artist_growth_signal', label: '아티스트 성장 신호', status: 'supported', note: 'users(account_type=artist) 실측' },
  { key: 'enterprise_signal', label: 'Enterprise 성장 신호', status: 'supported', note: 'enterprise_accounts/franchises(0349/0378)' },
  { key: 'contract_expiry_signal', label: '계약 만료 접근 신호', status: 'supported', note: 'artist_contracts(0057) 기간 실측' },
  { key: 'settlement_signal', label: '정산 이상 후보 신호', status: 'supported', note: 'artist_settlements/settlement_items(0060)' },
  { key: 'payout_signal', label: '지급 리스크 신호', status: 'supported', note: 'artist_payout_accounts(0025)' },
  { key: 'cost_signal', label: '비용 변화 신호', status: 'partial', note: 'ai_cost_snapshots — 인건비/마케팅비 없음(cost_unknown)' },
  { key: 'capacity_signal', label: '용량 리스크 신호', status: 'supported', note: 'ai_capacity_metrics 실측' },
  { key: 'incident_signal', label: '인시던트 신호', status: 'supported', note: 'ai_incidents 실측' },
  { key: 'security_signal', label: '보안 리스크 신호', status: 'supported', note: 'ai_security_events 실측' },
  { key: 'privacy_signal', label: '프라이버시 리스크 신호', status: 'partial', note: '전용 privacy 이벤트 테이블 없음 — security events 일부 참조' },
  { key: 'compliance_signal', label: '컴플라이언스 신호', status: 'partial', note: '전용 규제 추적 테이블 없음 — 수동 기록' },
  { key: 'policy_conflict_signal', label: '정책 충돌 신호', status: 'supported', note: 'ai_enterprise_policy_versions(0512)' },
  { key: 'strategic_reference', label: '전략 시나리오/포트폴리오 참조', status: 'supported', note: '0516 실측' },
  { key: 'decision_outcome_reference', label: '의사결정 Outcome 참조', status: 'supported', note: 'ai_decision_outcomes(0514)' },
  { key: 'learning_reference', label: '조직 학습 패턴 참조', status: 'supported', note: '0515 실측' },
  { key: 'causal_reference', label: '인과 후보 참조', status: 'supported', note: '0517 — 후보만(확정 아님)' },
  { key: 'calibration_reference', label: 'Calibration 참조', status: 'supported', note: '0517 — 표본<5 확정 차단' },
  { key: 'materiality_review', label: 'Materiality 검토', status: 'supported', note: '0518 — 미검토 시 materiality_unverified' },
  { key: 'urgency_review', label: 'Urgency 검토', status: 'supported', note: '0518 — deadline 기반(자동 실행 아님)' },
  { key: 'priority_tiering', label: 'Priority Tier(P0~P3)', status: 'supported', note: 'Hard Risk P3 강등 서버 차단' },
  { key: 'conflict_detection', label: 'Cross-Domain 충돌 감지', status: 'supported', note: '16축 — 양쪽 입장 보존' },
  { key: 'bottleneck_detection', label: 'Decision Bottleneck 감지', status: 'supported', note: '검토 대기 건수/기간 실측' },
  { key: 'daily_briefing', label: 'Daily Briefing 생성', status: 'supported', note: 'Event 기록 — 자동 발송 없음' },
  { key: 'agenda_records', label: 'Executive Agenda 기록', status: 'supported', note: '캘린더 자동 생성 없음' },
  { key: 'decision_package', label: 'Decision Package(옵션+No Action)', status: 'supported', note: '사람 결정 필요' },
  { key: 'board_reference', label: 'Board Reference', status: 'supported', note: '법적 이사회 자료 아님 · 자동 발송 없음' },
  { key: 'priority_outcome_link', label: 'Priority-Outcome 연결', status: 'supported', note: '연결 ≠ 인과(0517 워크플로만)' },
  { key: 'market_data', label: '시장/경쟁사 데이터', status: 'unsupported', note: 'market_data_unavailable — 소스 없음' },
  { key: 'calendar_integration', label: '캘린더 연동', status: 'unsupported', note: '연동 없음 — Agenda 는 기록만' },
  { key: 'report_delivery', label: '보고서 자동 발송', status: 'unsupported', note: '발송 채널 없음 — 기록만' },
  { key: 'auto_execution', label: '자동 경영 실행', status: 'unsupported', note: '전체 금지 — 모든 결정은 사람' },
  { key: 'org_chart', label: '조직도/인력 데이터', status: 'unsupported', note: '인력 테이블 없음 — personnel 평가 불가(의도적)' },
];
