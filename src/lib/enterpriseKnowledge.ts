/**
 * enterpriseKnowledge — Enterprise Knowledge Intelligence, Organizational
 * Memory & Continuous Learning 순수 로직 (Phase AI-OPS-49).
 *
 * Enterprise Vision→Enterprise Knowledge→Knowledge Source→Knowledge
 * Validation→Evidence→Knowledge Relationship→Organizational Memory→
 * Experience Pattern→Lesson Learned→Knowledge Quality→Continuous Learning→
 * Executive Knowledge Review→Knowledge Audit.
 *
 * 정직성: Knowledge Candidate ≠ Verified Knowledge · Lesson Learned ≠
 * Universal Truth · Best Practice ≠ Mandatory Practice · Similar Case ≠
 * Same Outcome · Pattern ≠ Causality · Knowledge Graph ≠ Proven
 * Relationship · Recommendation ≠ Decision · Review ≠ Approval ·
 * Evidence ≠ Absolute Truth · Null → 0 변환 금지.
 * 전 함수 결정적(Deterministic)·순수(Pure)·Null-safe. 자동 사실 확정 없음.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(SQL CHECK 1:1) ────────────────────────────────────────────────── */
export const KNOWLEDGE_CATEGORIES = [
  'strategy', 'product', 'engineering', 'operations', 'customer', 'finance', 'ai', 'security',
  'compliance', 'incident', 'best_practice', 'lesson_learned', 'organizational_memory', 'executive', 'enterprise', 'custom',
] as const;

export const KNOWLEDGE_STATUSES = [
  'draft', 'candidate', 'verified_reference', 'archived_reference', 'insufficient_data',
] as const;

export const KNOWLEDGE_QUALITY_RESULTS = [
  'excellent_candidate', 'high_quality_candidate', 'acceptable_candidate',
  'low_quality_candidate', 'insufficient_data',
] as const;
export type KnowledgeQualityResult = (typeof KNOWLEDGE_QUALITY_RESULTS)[number];

export const EVIDENCE_COVERAGE_DIMENSIONS = [
  'source_count', 'evidence_strength', 'freshness', 'validation', 'consistency',
] as const;
export const EVIDENCE_COVERAGE_RESULTS = [
  'strongly_supported_candidate', 'adequately_supported_candidate', 'weakly_supported_candidate',
  'unsupported_candidate', 'insufficient_data',
] as const;
export type EvidenceCoverageResult = (typeof EVIDENCE_COVERAGE_RESULTS)[number];

export const KNOWLEDGE_RELATIONSHIP_TYPES = [
  'related', 'depends_on', 'derived_from', 'similar_to', 'contradicts', 'reinforces',
] as const;
export const KNOWLEDGE_RELATIONSHIP_RESULTS = [
  'highly_connected_candidate', 'moderately_connected_candidate', 'weakly_connected_candidate',
  'relationship_unverified', 'insufficient_data',
] as const;
export type KnowledgeRelationshipResult = (typeof KNOWLEDGE_RELATIONSHIP_RESULTS)[number];

export const KNOWLEDGE_VALIDATION_RESULTS = ['validated_candidate', 'partially_validated_candidate', 'validation_failed_candidate', 'validation_unverified', 'insufficient_data'] as const;
export type KnowledgeValidationResult = (typeof KNOWLEDGE_VALIDATION_RESULTS)[number];
export const EXPERIENCE_PATTERN_RESULTS = ['recurring_pattern_candidate', 'emerging_pattern_candidate', 'no_material_pattern_candidate', 'pattern_unverified', 'insufficient_data'] as const;
export type ExperiencePatternResult = (typeof EXPERIENCE_PATTERN_RESULTS)[number];
export const KNOWLEDGE_FRESHNESS_RESULTS = ['fresh_candidate', 'aging_candidate', 'stale_candidate', 'freshness_unverified', 'insufficient_data'] as const;
export type KnowledgeFreshnessResult = (typeof KNOWLEDGE_FRESHNESS_RESULTS)[number];

export const KNOWLEDGE_REVIEW_TYPES = ['knowledge_review', 'executive_review', 'evidence_review'] as const;
export const KNOWLEDGE_REVIEW_STATUSES = ['requested', 'in_review', 'review_reference_recorded', 'revision_requested', 'insufficient_data'] as const;

export const KNOWLEDGE_RECOMMENDATION_TYPES = [
  'create_knowledge_memory', 'record_knowledge_source', 'record_evidence',
  'review_knowledge_validation', 'review_evidence_coverage', 'record_knowledge_relationship',
  'review_knowledge_graph', 'record_organizational_memory', 'review_experience_pattern',
  'record_lesson_learned', 'record_best_practice_candidate', 'search_similar_cases',
  'review_knowledge_quality', 'review_knowledge_freshness', 'record_continuous_learning',
  'build_executive_knowledge_summary', 'build_executive_knowledge_scorecard',
  'request_knowledge_review', 'request_executive_review', 'request_evidence_review',
  'record_learning_reference', 'gather_more_evidence_candidate', 'insufficient_data',
] as const;

/* §8 Executive Knowledge Scorecard 포함 필드 */
export const KNOWLEDGE_SCORECARD_FIELDS = [
  'knowledge_quality', 'evidence_coverage', 'freshness', 'relationship',
  'pattern', 'recommendation', 'review', 'executive_summary',
] as const;

/* ── Evidence Coverage(§6 — 5평가, Evidence ≠ Absolute Truth) ──────────── */
export function evaluateEvidenceCoverage(input: {
  sourceCount: number | null; evidenceStrength: number | null; freshnessDays: number | null;
  validationPassed: boolean | null; consistencyScore: number | null;
}): { result: EvidenceCoverageResult; coverageScore: number | null; assessedDimensions: number; evidenceIsNotAbsoluteTruth: true } {
  const parts: number[] = [];
  if (isFiniteNumber(input.sourceCount) && input.sourceCount >= 0) parts.push(clampScore((Math.min(input.sourceCount, 5) / 5) * 100));
  if (isFiniteNumber(input.evidenceStrength)) parts.push(clampScore(input.evidenceStrength));
  if (isFiniteNumber(input.freshnessDays) && input.freshnessDays >= 0) {
    parts.push(input.freshnessDays <= 90 ? 100 : input.freshnessDays <= 180 ? 70 : input.freshnessDays <= 365 ? 40 : 10);
  }
  if (input.validationPassed != null) parts.push(input.validationPassed ? 100 : 0);
  if (isFiniteNumber(input.consistencyScore)) parts.push(clampScore(input.consistencyScore));
  // 5평가 중 3개 미만 → insufficient_data(Null → 0 변환 금지).
  if (parts.length < 3) {
    return { result: 'insufficient_data', coverageScore: null, assessedDimensions: parts.length, evidenceIsNotAbsoluteTruth: true };
  }
  const score = clampScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  const result: EvidenceCoverageResult = score >= 80 ? 'strongly_supported_candidate'
    : score >= 60 ? 'adequately_supported_candidate'
    : score >= 40 ? 'weakly_supported_candidate'
    : 'unsupported_candidate';
  return { result, coverageScore: score, assessedDimensions: parts.length, evidenceIsNotAbsoluteTruth: true };
}

/* ── Knowledge Freshness(연식 — Freshness ≠ 정확성 판단) ────────────────── */
export function evaluateKnowledgeFreshness(ageDays: number | null): {
  result: KnowledgeFreshnessResult; ageDays: number | null; freshnessIsNotValidity: true;
} {
  if (!isFiniteNumber(ageDays) || ageDays < 0) {
    return { result: 'insufficient_data', ageDays: null, freshnessIsNotValidity: true };
  }
  const result: KnowledgeFreshnessResult = ageDays <= 90 ? 'fresh_candidate'
    : ageDays <= 365 ? 'aging_candidate'
    : 'stale_candidate';
  return { result, ageDays, freshnessIsNotValidity: true };
}

/* ── Knowledge Quality(§5 — 구성요소 종합, Quality ≠ Verified Truth) ────── */
export function evaluateKnowledgeQuality(input: {
  evidenceCoverage: EvidenceCoverageResult | null; freshness: KnowledgeFreshnessResult | null;
  validation: KnowledgeValidationResult | null; reuseCount: number | null;
}): { result: KnowledgeQualityResult; qualityScore: number | null; assessedComponents: number; qualityIsNotVerifiedTruth: true } {
  const coverageScore: Record<string, number | null> = { strongly_supported_candidate: 100, adequately_supported_candidate: 75, weakly_supported_candidate: 45, unsupported_candidate: 10, insufficient_data: null };
  const freshScore: Record<string, number | null> = { fresh_candidate: 100, aging_candidate: 60, stale_candidate: 20, freshness_unverified: null, insufficient_data: null };
  const validationScore: Record<string, number | null> = { validated_candidate: 100, partially_validated_candidate: 60, validation_failed_candidate: 10, validation_unverified: null, insufficient_data: null };
  const parts = [
    input.evidenceCoverage == null ? null : coverageScore[input.evidenceCoverage] ?? null,
    input.freshness == null ? null : freshScore[input.freshness] ?? null,
    input.validation == null ? null : validationScore[input.validation] ?? null,
    isFiniteNumber(input.reuseCount) && input.reuseCount >= 0 ? clampScore((Math.min(input.reuseCount, 10) / 10) * 100) : null,
  ].filter((s): s is number => isFiniteNumber(s));
  // 4개 구성요소 중 2개 미만 평가 → insufficient_data(미검증은 점수화하지 않음).
  if (parts.length < 2) {
    return { result: 'insufficient_data', qualityScore: null, assessedComponents: parts.length, qualityIsNotVerifiedTruth: true };
  }
  const score = clampScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  const result: KnowledgeQualityResult = score >= 80 ? 'excellent_candidate'
    : score >= 60 ? 'high_quality_candidate'
    : score >= 40 ? 'acceptable_candidate'
    : 'low_quality_candidate';
  return { result, qualityScore: score, assessedComponents: parts.length, qualityIsNotVerifiedTruth: true };
}

/* ── Knowledge Relationship(§7 — Graph ≠ Proven Relationship) ──────────── */
export function analyzeKnowledgeRelationships(relationships: { type: string; targetCode: string }[] | null): {
  result: KnowledgeRelationshipResult; validCount: number; invalidCount: number;
  contradictions: string[]; graphIsNotProvenRelationship: true;
} {
  const list = Array.isArray(relationships) ? relationships : [];
  if (!list.length) {
    return { result: 'insufficient_data', validCount: 0, invalidCount: 0, contradictions: [], graphIsNotProvenRelationship: true };
  }
  const valid = list.filter((r) => (KNOWLEDGE_RELATIONSHIP_TYPES as readonly string[]).includes(r.type));
  const invalidCount = list.length - valid.length;
  if (!valid.length) {
    return { result: 'relationship_unverified', validCount: 0, invalidCount, contradictions: [], graphIsNotProvenRelationship: true };
  }
  const contradictions = valid.filter((r) => r.type === 'contradicts').map((r) => r.targetCode).sort((a, b) => a.localeCompare(b));
  const result: KnowledgeRelationshipResult = valid.length >= 5 ? 'highly_connected_candidate'
    : valid.length >= 3 ? 'moderately_connected_candidate'
    : 'weakly_connected_candidate';
  return { result, validCount: valid.length, invalidCount, contradictions, graphIsNotProvenRelationship: true };
}

/* ── Experience Pattern(태그 빈도 — Pattern ≠ Causality) ────────────────── */
export function detectExperiencePatterns(cases: { caseCode: string; tags: string[]; failed?: boolean }[] | null, minOccurrence = 2): {
  result: ExperiencePatternResult; recurringTags: string[]; repeatedFailureTags: string[];
  caseCount: number; patternIsNotCausality: true;
} {
  const list = Array.isArray(cases) ? cases : [];
  // 표본 2건 미만 → sample_too_small(insufficient_data 유지).
  if (list.length < 2) {
    return { result: 'insufficient_data', recurringTags: [], repeatedFailureTags: [], caseCount: list.length, patternIsNotCausality: true };
  }
  const freq = new Map<string, number>();
  const failFreq = new Map<string, number>();
  for (const c of list) {
    const tags = Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string' && t.length > 0) : [];
    for (const t of new Set(tags)) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
      if (c.failed === true) failFreq.set(t, (failFreq.get(t) ?? 0) + 1);
    }
  }
  const recurringTags = [...freq.entries()].filter(([, n]) => n >= minOccurrence).map(([t]) => t).sort((a, b) => a.localeCompare(b));
  const repeatedFailureTags = [...failFreq.entries()].filter(([, n]) => n >= minOccurrence).map(([t]) => t).sort((a, b) => a.localeCompare(b));
  const result: ExperiencePatternResult = recurringTags.length > 0 ? 'recurring_pattern_candidate' : 'no_material_pattern_candidate';
  return { result, recurringTags, repeatedFailureTags, caseCount: list.length, patternIsNotCausality: true };
}

/* ── Similar Case 검색(Jaccard — Similar Case ≠ Same Outcome) ───────────── */
export function findSimilarCases(currentTags: string[] | null, pastCases: { caseCode: string; tags: string[]; outcomeReference: string | null }[] | null, minSimilarity = 0.5): {
  similar: { caseCode: string; similarity: number; outcomeReference: string | null }[]; similarCaseIsNotSameOutcome: true; insufficientData: boolean;
} {
  const tags = (Array.isArray(currentTags) ? currentTags : []).filter((t) => typeof t === 'string' && t.length > 0);
  const past = Array.isArray(pastCases) ? pastCases : [];
  if (!tags.length || !past.length) {
    return { similar: [], similarCaseIsNotSameOutcome: true, insufficientData: true };
  }
  const similar = past
    .map((c) => {
      const cTags = Array.isArray(c.tags) ? c.tags : [];
      const intersection = cTags.filter((t) => tags.includes(t)).length;
      const union = new Set([...tags, ...cTags]).size;
      const similarity = union > 0 ? Math.round((intersection / union) * 1000) / 1000 : 0;
      return { caseCode: c.caseCode, similarity, outcomeReference: c.outcomeReference };
    })
    .filter((c) => c.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity || a.caseCode.localeCompare(b.caseCode));
  return { similar, similarCaseIsNotSameOutcome: true, insufficientData: false };
}

/* ── Executive Knowledge Scorecard(§8 — 결정적 우선순위 정렬) ───────────── */
export interface KnowledgeScorecardEntryInput {
  knowledgeCode: string; category: string; quality: KnowledgeQualityResult;
  coverage: EvidenceCoverageResult; freshness: KnowledgeFreshnessResult | null;
  contradictionCount: number | null; recommendation: string | null; executiveReviewPresent: boolean;
}
export function buildExecutiveKnowledgeScorecard(entries: KnowledgeScorecardEntryInput[] | null, topN = 5): {
  priorityRows: KnowledgeScorecardEntryInput[]; fields: readonly string[]; scorecardIsNotFactConfirmation: true; orderingIsDeterministic: true;
} {
  const severity = (e: KnowledgeScorecardEntryInput): number => {
    const q = e.quality === 'low_quality_candidate' ? 3 : e.quality === 'acceptable_candidate' ? 1 : 0;
    const c = e.coverage === 'unsupported_candidate' ? 3 : e.coverage === 'weakly_supported_candidate' ? 2 : 0;
    const f = e.freshness === 'stale_candidate' ? 2 : e.freshness === 'aging_candidate' ? 1 : 0;
    const x = isFiniteNumber(e.contradictionCount) && e.contradictionCount > 0 ? 2 : 0;
    return q * 10 + c * 5 + f * 2 + x * 2;
  };
  const sorted = (Array.isArray(entries) ? [...entries] : [])
    .sort((a, b) => severity(b) - severity(a) || a.knowledgeCode.localeCompare(b.knowledgeCode));
  return { priorityRows: sorted.slice(0, Math.max(0, topN)), fields: KNOWLEDGE_SCORECARD_FIELDS, scorecardIsNotFactConfirmation: true, orderingIsDeterministic: true };
}

/* ── Knowledge Review 검증(§9 — Self 차단·Evidence 필수) ────────────────── */
export function validateKnowledgeReview(input: { action: string; evidenceCount: number | null; isSelfReview: boolean }): {
  allowed: boolean; blockedReasons: string[]; reviewIsNotApproval: true; adoptionIsHuman: true;
} {
  const blockedReasons: string[] = [];
  if (input.action === 'record_review_reference' || input.action === 'record_verified_reference') {
    if (input.isSelfReview) blockedReasons.push('Self-Review 차단(작성자 ≠ 평가자)');
    if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount <= 0) blockedReasons.push('Evidence 없는 Review/Verified Reference 금지');
  }
  return { allowed: blockedReasons.length === 0, blockedReasons, reviewIsNotApproval: true, adoptionIsHuman: true };
}

/* ── Knowledge 흐름 타임라인(관측 여부 표시 — 자동 진행 아님) ───────────── */
export const KNOWLEDGE_FLOW_STAGES = [
  'enterprise_vision', 'enterprise_knowledge', 'knowledge_source', 'knowledge_validation',
  'evidence', 'knowledge_relationship', 'organizational_memory', 'experience_pattern',
  'lesson_learned', 'knowledge_quality', 'continuous_learning', 'executive_knowledge_review',
] as const;
export function buildKnowledgeTimeline(input: { present: Partial<Record<(typeof KNOWLEDGE_FLOW_STAGES)[number], boolean>> }): {
  stage: (typeof KNOWLEDGE_FLOW_STAGES)[number]; present: boolean;
}[] {
  return KNOWLEDGE_FLOW_STAGES.map((stage) => ({ stage, present: input.present[stage] === true }));
}

/* ── 컴포넌트/Support Matrix ────────────────────────────────────────────── */
export const ENTERPRISE_KNOWLEDGE_COMPONENTS = [
  'knowledge_memory_registry', 'knowledge_review_registry', 'knowledge_source_ledger',
  'evidence_coverage_analysis', 'knowledge_graph_analysis', 'organizational_memory',
  'experience_pattern_detection', 'knowledge_quality_analysis', 'executive_knowledge_scorecard',
  'knowledge_event_audit',
] as const;

export type KnowledgeSupportLevel = 'fully_supported' | 'partially_supported' | 'advisory_only' | 'human_review_only' | 'unavailable' | 'insufficient_data';
export const ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX: { capability: string; support: KnowledgeSupportLevel }[] = [
  { capability: 'knowledge_memory_structuring', support: 'fully_supported' },
  { capability: 'knowledge_category_16_domains', support: 'fully_supported' },
  { capability: 'knowledge_source_recording', support: 'fully_supported' },
  { capability: 'knowledge_validation_candidate', support: 'advisory_only' },
  { capability: 'evidence_chain_recording', support: 'fully_supported' },
  { capability: 'evidence_coverage_5_dimensions', support: 'fully_supported' },
  { capability: 'knowledge_relationship_6_types', support: 'fully_supported' },
  { capability: 'knowledge_graph_candidate', support: 'fully_supported' },
  { capability: 'organizational_memory_recording', support: 'fully_supported' },
  { capability: 'experience_pattern_detection', support: 'advisory_only' },
  { capability: 'lesson_learned_with_evidence', support: 'advisory_only' },
  { capability: 'best_practice_candidate_with_evidence', support: 'advisory_only' },
  { capability: 'similar_case_search_jaccard', support: 'fully_supported' },
  { capability: 'knowledge_quality_candidate', support: 'fully_supported' },
  { capability: 'knowledge_freshness_candidate', support: 'fully_supported' },
  { capability: 'continuous_learning_recording', support: 'fully_supported' },
  { capability: 'executive_knowledge_summary_candidate', support: 'advisory_only' },
  { capability: 'executive_knowledge_scorecard_candidate', support: 'advisory_only' },
  { capability: 'knowledge_recommendation_with_evidence', support: 'advisory_only' },
  { capability: 'knowledge_review_request', support: 'human_review_only' },
  { capability: 'executive_review_request', support: 'human_review_only' },
  { capability: 'evidence_review_request', support: 'human_review_only' },
  { capability: 'knowledge_review_reference_no_self_review', support: 'human_review_only' },
  { capability: 'verified_reference_human_only', support: 'human_review_only' },
  { capability: 'knowledge_adoption_human_only', support: 'human_review_only' },
  { capability: 'knowledge_entities_link_0513', support: 'partially_supported' },
  { capability: 'org_memory_link_0531', support: 'partially_supported' },
  { capability: 'organizational_learning_link_0515', support: 'partially_supported' },
  { capability: 'governance_reference_link_0551', support: 'partially_supported' },
  { capability: 'value_reference_link_0549', support: 'partially_supported' },
  { capability: 'program_reference_link_0547', support: 'partially_supported' },
  { capability: 'organization_reference_link_0552', support: 'partially_supported' },
  { capability: 'knowledge_event_audit_trail', support: 'fully_supported' },
  { capability: 'wiki_system_feed', support: 'insufficient_data' },
  { capability: 'document_management_system', support: 'insufficient_data' },
  { capability: 'external_knowledge_base_feed', support: 'insufficient_data' },
  { capability: 'search_index_feed', support: 'insufficient_data' },
  { capability: 'meeting_notes_feed', support: 'insufficient_data' },
  { capability: 'customer_feedback_feed', support: 'insufficient_data' },
  { capability: 'automatic_fact_confirmation', support: 'unavailable' },
  { capability: 'automatic_policy_promotion', support: 'unavailable' },
  { capability: 'automatic_legal_judgment', support: 'unavailable' },
  { capability: 'automatic_compliance_confirmation', support: 'unavailable' },
  { capability: 'automatic_strategy_change', support: 'unavailable' },
  { capability: 'automatic_governance_change', support: 'unavailable' },
  { capability: 'automatic_organization_change', support: 'unavailable' },
  { capability: 'automatic_kpi_change', support: 'unavailable' },
  { capability: 'automatic_budget_change', support: 'unavailable' },
  { capability: 'automatic_merge', support: 'unavailable' },
  { capability: 'automatic_deploy', support: 'unavailable' },
  { capability: 'automatic_production_change', support: 'unavailable' },
];
