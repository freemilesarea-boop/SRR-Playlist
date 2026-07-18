/**
 * enterpriseMission — Enterprise Mission Intelligence, Objective Alignment &
 * Strategic Outcome 순수 로직 (Phase AI-OPS-51).
 *
 * Enterprise Vision→Enterprise Mission→Strategic Objectives→Enterprise OKRs→
 * Cross-Organization Alignment→Initiative Alignment→Execution Alignment→
 * Performance Alignment→Business Outcome Alignment→Mission Drift Detection→
 * Strategic Outcome→Executive Mission Review→Mission Learning→Audit.
 *
 * 정직성: Mission Alignment ≠ Mission Success · Objective Alignment ≠
 * Objective Achievement · Strategic Outcome ≠ Business Success · Mission
 * Drift ≠ Organizational Failure · Recommendation ≠ Decision · Alignment
 * Score ≠ Executive Judgment · Pattern ≠ Causality · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 Mission/Vision/
 * OKR/KPI 변경 없음 — 사람이 Mission 과 Strategy 를 변경하고 책임진다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const MISSION_CATEGORIES = [
  'enterprise', 'strategic', 'financial', 'customer', 'product', 'engineering', 'operations',
  'ai', 'security', 'compliance', 'esg', 'innovation', 'executive', 'custom',
] as const;

export const MISSION_STATUSES = [
  'draft', 'candidate', 'active_reference', 'archived_reference', 'insufficient_data',
] as const;

export const MISSION_ALIGNMENT_DIMENSIONS = [
  'strategy_alignment', 'portfolio_alignment', 'execution_alignment',
  'kpi_alignment', 'organization_alignment', 'business_value_alignment',
] as const;
export const MISSION_ALIGNMENT_RESULTS = [
  'highly_aligned_candidate', 'aligned_candidate', 'partially_aligned_candidate',
  'misaligned_candidate', 'insufficient_data',
] as const;
export type MissionAlignmentResult = (typeof MISSION_ALIGNMENT_RESULTS)[number];

export const MISSION_DRIFT_DIMENSIONS = [
  'objective_drift', 'kpi_drift', 'portfolio_drift', 'execution_drift', 'organizational_drift',
] as const;
export const MISSION_DRIFT_RESULTS = [
  'stable_candidate', 'watch_candidate', 'drifting_candidate',
  'critical_drift_candidate', 'insufficient_data',
] as const;
export type MissionDriftResult = (typeof MISSION_DRIFT_RESULTS)[number];

export const STRATEGIC_OUTCOME_DIMENSIONS = [
  'mission_coverage', 'outcome_coverage', 'kpi_contribution', 'initiative_contribution', 'value_contribution',
] as const;
export const STRATEGIC_OUTCOME_RESULTS = [
  'strongly_supported_candidate', 'adequately_supported_candidate', 'weakly_supported_candidate',
  'unsupported_candidate', 'insufficient_data',
] as const;
export type StrategicOutcomeResult = (typeof STRATEGIC_OUTCOME_RESULTS)[number];

export const ALIGNMENT_TREND_RESULTS = ['improving_alignment_candidate', 'stable_alignment_candidate', 'declining_alignment_candidate', 'trend_unverified', 'insufficient_data'] as const;
export type AlignmentTrendResult = (typeof ALIGNMENT_TREND_RESULTS)[number];
export const OBJECTIVE_COVERAGE_RESULTS = ['full_coverage_candidate', 'partial_coverage_candidate', 'uncovered_objectives_candidate', 'coverage_unverified', 'insufficient_data'] as const;
export type ObjectiveCoverageResult = (typeof OBJECTIVE_COVERAGE_RESULTS)[number];

export const MISSION_REVIEW_TYPES = ['mission_review', 'executive_review', 'strategic_review'] as const;
export const OBJECTIVE_ALIGNMENT_STATUSES = ['recorded', 'under_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const MISSION_RECOMMENDATION_TYPES = [
  'create_mission_model', 'map_strategic_objective', 'map_okr',
  'review_initiative_alignment', 'review_kpi_alignment', 'review_portfolio_alignment',
  'review_organization_alignment', 'review_value_alignment', 'review_execution_alignment',
  'review_mission_alignment', 'review_mission_drift', 'review_strategic_outcome',
  'review_alignment_trend', 'review_objective_coverage', 'create_objective_alignment',
  'build_executive_mission_summary', 'build_executive_mission_scorecard',
  'request_mission_review', 'request_executive_review', 'request_strategic_review',
  'record_mission_learning', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Mission Scorecard 포함 필드 */
export const MISSION_SCORECARD_FIELDS = [
  'mission_alignment', 'strategic_outcome', 'mission_drift', 'objective_coverage',
  'kpi_alignment', 'recommendation', 'executive_summary', 'human_review',
] as const;

/* ── Mission Alignment(§5 — 6차원, Alignment ≠ Mission Success) ─────────── */
export function evaluateMissionAlignment(dimensions: { dimension: string; score: number | null }[] | null): {
  result: MissionAlignmentResult; alignmentScore: number | null; assessedDimensions: number;
  missingDimensions: string[]; alignmentIsNotMissionSuccess: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (MISSION_ALIGNMENT_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  const missingDimensions = MISSION_ALIGNMENT_DIMENSIONS.filter((dim) => !valid.some((d) => d.dimension === dim));
  // 6차원 중 3차원 미만 평가 → insufficient_data(Null → 0 변환 금지).
  if (valid.length < 3) {
    return { result: 'insufficient_data', alignmentScore: null, assessedDimensions: valid.length, missingDimensions: [...missingDimensions], alignmentIsNotMissionSuccess: true };
  }
  const score = clampScore(valid.reduce((s, d) => s + (d.score as number), 0) / valid.length);
  const result: MissionAlignmentResult = score >= 80 ? 'highly_aligned_candidate'
    : score >= 60 ? 'aligned_candidate'
    : score >= 40 ? 'partially_aligned_candidate'
    : 'misaligned_candidate';
  return { result, alignmentScore: score, assessedDimensions: valid.length, missingDimensions: [...missingDimensions], alignmentIsNotMissionSuccess: true };
}

/* ── Mission Drift(§6 — 5차원 worst-of, Drift ≠ Organizational Failure) ── */
export function evaluateMissionDrift(dimensions: { dimension: string; driftScore: number | null }[] | null): {
  result: MissionDriftResult; worstDimension: string | null; worstDriftScore: number | null;
  assessedDimensions: number; driftIsNotOrganizationalFailure: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (MISSION_DRIFT_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.driftScore));
  // 5차원 중 2차원 미만 평가 → insufficient_data.
  if (valid.length < 2) {
    return { result: 'insufficient_data', worstDimension: null, worstDriftScore: null, assessedDimensions: valid.length, driftIsNotOrganizationalFailure: true };
  }
  let worst = valid[0];
  for (const d of valid) { if ((d.driftScore as number) > (worst.driftScore as number)) worst = d; }
  const s = clampScore(worst.driftScore as number);
  const result: MissionDriftResult = s <= 20 ? 'stable_candidate'
    : s <= 40 ? 'watch_candidate'
    : s <= 70 ? 'drifting_candidate'
    : 'critical_drift_candidate';
  return { result, worstDimension: worst.dimension, worstDriftScore: s, assessedDimensions: valid.length, driftIsNotOrganizationalFailure: true };
}

/* ── Strategic Outcome(§7 — 5분석, Outcome ≠ Business Success) ──────────── */
export function evaluateStrategicOutcome(dimensions: { dimension: string; score: number | null }[] | null): {
  result: StrategicOutcomeResult; outcomeScore: number | null; assessedDimensions: number; outcomeIsNotBusinessSuccess: true;
} {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const valid = list.filter((d) => (STRATEGIC_OUTCOME_DIMENSIONS as readonly string[]).includes(d.dimension) && isFiniteNumber(d.score));
  // 5분석 중 3개 미만 → insufficient_data.
  if (valid.length < 3) {
    return { result: 'insufficient_data', outcomeScore: null, assessedDimensions: valid.length, outcomeIsNotBusinessSuccess: true };
  }
  const score = clampScore(valid.reduce((s, d) => s + (d.score as number), 0) / valid.length);
  const result: StrategicOutcomeResult = score >= 80 ? 'strongly_supported_candidate'
    : score >= 60 ? 'adequately_supported_candidate'
    : score >= 40 ? 'weakly_supported_candidate'
    : 'unsupported_candidate';
  return { result, outcomeScore: score, assessedDimensions: valid.length, outcomeIsNotBusinessSuccess: true };
}

/* ── KPI Alignment(연결 비율 — Alignment Score ≠ Executive Judgment) ────── */
export function evaluateKpiAlignment(kpis: { kpiCode: string; linkedObjectives: number | null }[] | null): {
  result: MissionAlignmentResult; unlinkedKpis: string[]; assessedKpis: number;
  unverifiedKpis: number; alignmentScoreIsNotExecutiveJudgment: true;
} {
  const list = Array.isArray(kpis) ? kpis : [];
  const measured = list.filter((k) => isFiniteNumber(k.linkedObjectives));
  const unverifiedKpis = list.length - measured.length;
  if (!measured.length) {
    return { result: 'insufficient_data', unlinkedKpis: [], assessedKpis: 0, unverifiedKpis, alignmentScoreIsNotExecutiveJudgment: true };
  }
  const unlinkedKpis = measured.filter((k) => k.linkedObjectives === 0).map((k) => k.kpiCode).sort((a, b) => a.localeCompare(b));
  const ratio = ((measured.length - unlinkedKpis.length) / measured.length) * 100;
  const result: MissionAlignmentResult = ratio >= 80 ? 'highly_aligned_candidate'
    : ratio >= 60 ? 'aligned_candidate'
    : ratio >= 40 ? 'partially_aligned_candidate'
    : 'misaligned_candidate';
  return { result, unlinkedKpis, assessedKpis: measured.length, unverifiedKpis, alignmentScoreIsNotExecutiveJudgment: true };
}

/* ── Objective Coverage(Initiative 없는 Objective 검출) ─────────────────── */
export function detectUncoveredObjectives(objectives: { objectiveCode: string; initiativeCount: number | null }[] | null): {
  result: ObjectiveCoverageResult; uncoveredObjectives: string[]; unverifiedObjectives: number;
  assessedObjectives: number; coverageIsNotAchievement: true;
} {
  const list = Array.isArray(objectives) ? objectives : [];
  if (!list.length) {
    return { result: 'insufficient_data', uncoveredObjectives: [], unverifiedObjectives: 0, assessedObjectives: 0, coverageIsNotAchievement: true };
  }
  const measured = list.filter((o) => isFiniteNumber(o.initiativeCount));
  const unverifiedObjectives = list.length - measured.length;
  if (!measured.length) {
    return { result: 'coverage_unverified', uncoveredObjectives: [], unverifiedObjectives, assessedObjectives: 0, coverageIsNotAchievement: true };
  }
  const uncoveredObjectives = measured.filter((o) => o.initiativeCount === 0).map((o) => o.objectiveCode).sort((a, b) => a.localeCompare(b));
  const result: ObjectiveCoverageResult = uncoveredObjectives.length > 0 ? 'uncovered_objectives_candidate'
    : unverifiedObjectives > 0 ? 'partial_coverage_candidate'
    : 'full_coverage_candidate';
  return { result, uncoveredObjectives, unverifiedObjectives, assessedObjectives: measured.length, coverageIsNotAchievement: true };
}

/* ── Alignment Trend(이력 비교 — Trend ≠ Forecast 확정) ─────────────────── */
export function analyzeAlignmentTrend(history: { periodLabel: string; alignmentScore: number | null }[] | null): {
  result: AlignmentTrendResult; delta: number | null; sampleCount: number; trendIsNotForecast: true;
} {
  const valid = (Array.isArray(history) ? history : []).filter((h) => isFiniteNumber(h.alignmentScore));
  // 표본 3기간 미만 → sample_too_small(insufficient_data 유지).
  if (valid.length < 3) {
    return { result: 'insufficient_data', delta: null, sampleCount: valid.length, trendIsNotForecast: true };
  }
  const delta = Math.round(((valid[valid.length - 1].alignmentScore as number) - (valid[0].alignmentScore as number)) * 100) / 100;
  const result: AlignmentTrendResult = delta >= 5 ? 'improving_alignment_candidate'
    : delta <= -5 ? 'declining_alignment_candidate'
    : 'stable_alignment_candidate';
  return { result, delta, sampleCount: valid.length, trendIsNotForecast: true };
}

/* ── Executive Mission Scorecard(§8 — 결정적 우선순위 정렬) ─────────────── */
export interface MissionScorecardEntryInput {
  missionCode: string; category: string; alignment: MissionAlignmentResult;
  drift: MissionDriftResult; outcome: StrategicOutcomeResult;
  uncoveredObjectiveCount: number | null; recommendation: string | null; humanReviewPresent: boolean;
}
export function buildExecutiveMissionScorecard(entries: MissionScorecardEntryInput[] | null, topN = 5): {
  priorityRows: MissionScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotExecutiveJudgment: true; orderingIsDeterministic: true;
} {
  const severity = (e: MissionScorecardEntryInput): number => {
    const a = e.alignment === 'misaligned_candidate' ? 3 : e.alignment === 'partially_aligned_candidate' ? 1 : 0;
    const d = e.drift === 'critical_drift_candidate' ? 3 : e.drift === 'drifting_candidate' ? 2 : 0;
    const o = e.outcome === 'unsupported_candidate' ? 3 : e.outcome === 'weakly_supported_candidate' ? 2 : 0;
    const u = isFiniteNumber(e.uncoveredObjectiveCount) && e.uncoveredObjectiveCount > 0 ? 1 : 0;
    return a * 10 + d * 5 + o * 3 + u;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.missionCode.localeCompare(b.missionCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: MISSION_SCORECARD_FIELDS, scorecardIsNotExecutiveJudgment: true, orderingIsDeterministic: true };
}

/* ── Mission Review 검증(§9 — Self 차단·Evidence 필수) ──────────────────── */
export function validateMissionReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; missionChangeIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Mission Review Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, missionChangeIsHuman: true };
}

/* ── Mission 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ─────────────── */
export const MISSION_FLOW_STAGES = [
  'enterprise_vision', 'enterprise_mission', 'strategic_objectives', 'enterprise_okrs',
  'cross_organization_alignment', 'initiative_alignment', 'execution_alignment', 'performance_alignment',
  'business_outcome_alignment', 'mission_drift_detection', 'strategic_outcome', 'executive_mission_review',
  'mission_learning',
] as const;
export function buildMissionTimeline(input: { present: Partial<Record<(typeof MISSION_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof MISSION_FLOW_STAGES)[number]; present: boolean;
}[] {
  return MISSION_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_MISSION_COMPONENTS = [
  'mission_model_registry', 'objective_alignment_registry', 'okr_mapping_ledger',
  'mission_alignment_analysis', 'mission_drift_detection', 'strategic_outcome_analysis',
  'alignment_trend_analysis', 'objective_coverage_analysis', 'executive_mission_scorecard',
  'mission_event_audit',
] as const;

export type MissionSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_MISSION_SUPPORT_MATRIX: { capability: string; support: MissionSupportLevel }[] = [
  { capability: 'mission_model_structuring', support: 'fully_supported' },
  { capability: 'mission_category_14_domains', support: 'fully_supported' },
  { capability: 'strategic_objective_mapping', support: 'fully_supported' },
  { capability: 'okr_mapping_existing_only', support: 'fully_supported' },
  { capability: 'objective_alignment_6_dimensions', support: 'fully_supported' },
  { capability: 'initiative_alignment_candidate', support: 'advisory_only' },
  { capability: 'kpi_alignment_candidate', support: 'fully_supported' },
  { capability: 'portfolio_alignment_candidate', support: 'advisory_only' },
  { capability: 'organization_alignment_candidate', support: 'advisory_only' },
  { capability: 'value_alignment_candidate', support: 'advisory_only' },
  { capability: 'execution_alignment_candidate', support: 'advisory_only' },
  { capability: 'mission_alignment_candidate', support: 'fully_supported' },
  { capability: 'mission_drift_5_dimensions', support: 'fully_supported' },
  { capability: 'strategic_outcome_5_dimensions', support: 'fully_supported' },
  { capability: 'alignment_trend_candidate', support: 'fully_supported' },
  { capability: 'objective_coverage_candidate', support: 'fully_supported' },
  { capability: 'executive_mission_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_mission_scorecard_candidate', support: 'advisory_only' },
  { capability: 'mission_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'mission_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'strategic_review_request', support: 'human_review_only' },
  { capability: 'mission_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'mission_change_human_only', support: 'human_review_only' },
  { capability: 'mission_learning_recording', support: 'fully_supported' },
  { capability: 'vision_record_link_0524', support: 'partially_supported' },
  { capability: 'strategy_portfolio_link_0545', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'kpi_reference_link_0548', support: 'partially_supported' },
  { capability: 'value_reference_link_0549', support: 'partially_supported' },
  { capability: 'investment_portfolio_link_0550', support: 'partially_supported' },
  { capability: 'organization_reference_link_0552', support: 'partially_supported' },
  { capability: 'mission_event_audit_trail', support: 'fully_supported' },
  { capability: 'okr_system_feed', support: 'insufficient_data' },
  { capability: 'official_mission_charter_ledger', support: 'insufficient_data' },
  { capability: 'board_mission_minutes', support: 'insufficient_data' },
  { capability: 'employee_survey_feed', support: 'insufficient_data' },
  { capability: 'market_research_feed', support: 'insufficient_data' },
  { capability: 'esg_reporting_feed', support: 'insufficient_data' },
  { capability: 'automatic_mission_change', support: 'unavailable' },
  { capability: 'automatic_vision_change', support: 'unavailable' },
  { capability: 'automatic_okr_generation', support: 'unavailable' },
  { capability: 'automatic_kpi_change', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_governance_change', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_organization_change', support: 'unavailable' },
  { capability: 'automatic_portfolio_change', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_rollback', support: 'unavailable' },
];
