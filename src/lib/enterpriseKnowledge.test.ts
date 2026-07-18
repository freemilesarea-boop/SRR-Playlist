import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUSES, KNOWLEDGE_QUALITY_RESULTS,
  EVIDENCE_COVERAGE_DIMENSIONS, EVIDENCE_COVERAGE_RESULTS,
  KNOWLEDGE_RELATIONSHIP_TYPES, KNOWLEDGE_RELATIONSHIP_RESULTS,
  KNOWLEDGE_VALIDATION_RESULTS, EXPERIENCE_PATTERN_RESULTS, KNOWLEDGE_FRESHNESS_RESULTS,
  KNOWLEDGE_REVIEW_TYPES, KNOWLEDGE_REVIEW_STATUSES,
  KNOWLEDGE_RECOMMENDATION_TYPES, KNOWLEDGE_SCORECARD_FIELDS, KNOWLEDGE_FLOW_STAGES,
  evaluateEvidenceCoverage, evaluateKnowledgeFreshness, evaluateKnowledgeQuality,
  analyzeKnowledgeRelationships, detectExperiencePatterns, findSimilarCases,
  buildExecutiveKnowledgeScorecard, validateKnowledgeReview, buildKnowledgeTimeline,
  ENTERPRISE_KNOWLEDGE_COMPONENTS, ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX,
} from './enterpriseKnowledge';

describe('enterpriseKnowledge 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Knowledge Category 16종·Status 5종', () => {
    expect(KNOWLEDGE_CATEGORIES).toHaveLength(16);
    expect(KNOWLEDGE_STATUSES).toHaveLength(5);
    expect(KNOWLEDGE_STATUSES).toContain('insufficient_data');
  });
  it('Quality/Coverage/Relationship/Validation/Pattern/Freshness 결과 5종 + insufficient_data 포함', () => {
    for (const list of [KNOWLEDGE_QUALITY_RESULTS, EVIDENCE_COVERAGE_RESULTS, KNOWLEDGE_RELATIONSHIP_RESULTS, KNOWLEDGE_VALIDATION_RESULTS, EXPERIENCE_PATTERN_RESULTS, KNOWLEDGE_FRESHNESS_RESULTS]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(EVIDENCE_COVERAGE_DIMENSIONS).toHaveLength(5);
    expect(KNOWLEDGE_RELATIONSHIP_TYPES).toHaveLength(6);
  });
  it('Review 3종/5종·권고 23종·Scorecard 8필드·Flow 12단계·컴포넌트 10종', () => {
    expect(KNOWLEDGE_REVIEW_TYPES).toHaveLength(3);
    expect(KNOWLEDGE_REVIEW_STATUSES).toHaveLength(5);
    expect(KNOWLEDGE_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(KNOWLEDGE_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(KNOWLEDGE_SCORECARD_FIELDS).toHaveLength(8);
    expect(KNOWLEDGE_FLOW_STAGES).toHaveLength(12);
    expect(ENTERPRISE_KNOWLEDGE_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateEvidenceCoverage(§6 — Evidence ≠ Absolute Truth)', () => {
  it('전 차원 강함 → strongly_supported_candidate', () => {
    const r = evaluateEvidenceCoverage({ sourceCount: 5, evidenceStrength: 90, freshnessDays: 30, validationPassed: true, consistencyScore: 85 });
    expect(r.result).toBe('strongly_supported_candidate');
    expect(r.assessedDimensions).toBe(5);
    expect(r.evidenceIsNotAbsoluteTruth).toBe(true);
  });
  it('약한 근거 → weakly/unsupported', () => {
    expect(evaluateEvidenceCoverage({ sourceCount: 2, evidenceStrength: 40, freshnessDays: 300, validationPassed: null, consistencyScore: 50 }).result).toBe('weakly_supported_candidate');
    expect(evaluateEvidenceCoverage({ sourceCount: 0, evidenceStrength: 10, freshnessDays: 800, validationPassed: false, consistencyScore: 5 }).result).toBe('unsupported_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateEvidenceCoverage({ sourceCount: 3, evidenceStrength: null, freshnessDays: null, validationPassed: null, consistencyScore: 70 });
    expect(r.result).toBe('insufficient_data');
    expect(r.coverageScore).toBeNull();
    expect(r.assessedDimensions).toBe(2);
  });
});

describe('evaluateKnowledgeFreshness / evaluateKnowledgeQuality(§5)', () => {
  it('연식별 fresh/aging/stale, null → insufficient_data', () => {
    expect(evaluateKnowledgeFreshness(30).result).toBe('fresh_candidate');
    expect(evaluateKnowledgeFreshness(200).result).toBe('aging_candidate');
    expect(evaluateKnowledgeFreshness(400).result).toBe('stale_candidate');
    expect(evaluateKnowledgeFreshness(null).result).toBe('insufficient_data');
  });
  it('강한 근거+신선+검증+재사용 → excellent_candidate', () => {
    const r = evaluateKnowledgeQuality({ evidenceCoverage: 'strongly_supported_candidate', freshness: 'fresh_candidate', validation: 'validated_candidate', reuseCount: 10 });
    expect(r.result).toBe('excellent_candidate');
    expect(r.assessedComponents).toBe(4);
    expect(r.qualityIsNotVerifiedTruth).toBe(true);
  });
  it('무근거+오래됨 → low_quality_candidate', () => {
    expect(evaluateKnowledgeQuality({ evidenceCoverage: 'unsupported_candidate', freshness: 'stale_candidate', validation: 'validation_failed_candidate', reuseCount: 0 }).result).toBe('low_quality_candidate');
  });
  it('구성요소 2개 미만 평가 → insufficient_data(미검증 점수화 금지)', () => {
    const r = evaluateKnowledgeQuality({ evidenceCoverage: 'insufficient_data', freshness: 'freshness_unverified', validation: null, reuseCount: 3 });
    expect(r.result).toBe('insufficient_data');
    expect(r.qualityScore).toBeNull();
    expect(r.assessedComponents).toBe(1);
  });
});

describe('analyzeKnowledgeRelationships(§7 — Graph ≠ Proven Relationship)', () => {
  it('유효 관계 5건 이상 → highly_connected + contradicts 목록 공개', () => {
    const r = analyzeKnowledgeRelationships([
      { type: 'related', targetCode: 'K-1' }, { type: 'depends_on', targetCode: 'K-2' },
      { type: 'derived_from', targetCode: 'K-3' }, { type: 'similar_to', targetCode: 'K-4' },
      { type: 'contradicts', targetCode: 'K-5' },
    ]);
    expect(r.result).toBe('highly_connected_candidate');
    expect(r.contradictions).toEqual(['K-5']);
    expect(r.graphIsNotProvenRelationship).toBe(true);
  });
  it('3건 → moderately, 1건 → weakly', () => {
    expect(analyzeKnowledgeRelationships([
      { type: 'related', targetCode: 'a' }, { type: 'reinforces', targetCode: 'b' }, { type: 'similar_to', targetCode: 'c' },
    ]).result).toBe('moderately_connected_candidate');
    expect(analyzeKnowledgeRelationships([{ type: 'related', targetCode: 'a' }]).result).toBe('weakly_connected_candidate');
  });
  it('허용되지 않은 type 전부 → relationship_unverified, 없음 → insufficient_data', () => {
    const r = analyzeKnowledgeRelationships([{ type: 'proves', targetCode: 'x' }]);
    expect(r.result).toBe('relationship_unverified');
    expect(r.invalidCount).toBe(1);
    expect(analyzeKnowledgeRelationships(null).result).toBe('insufficient_data');
  });
});

describe('detectExperiencePatterns(Pattern ≠ Causality)', () => {
  it('반복 태그 검출 → recurring_pattern_candidate + 반복 실패 태그 공개', () => {
    const r = detectExperiencePatterns([
      { caseCode: 'C-1', tags: ['deploy_delay', 'handoff'], failed: true },
      { caseCode: 'C-2', tags: ['deploy_delay'], failed: true },
      { caseCode: 'C-3', tags: ['pricing'] },
    ]);
    expect(r.result).toBe('recurring_pattern_candidate');
    expect(r.recurringTags).toEqual(['deploy_delay']);
    expect(r.repeatedFailureTags).toEqual(['deploy_delay']);
    expect(r.patternIsNotCausality).toBe(true);
  });
  it('반복 없음 → no_material_pattern_candidate', () => {
    expect(detectExperiencePatterns([
      { caseCode: 'C-1', tags: ['a'] }, { caseCode: 'C-2', tags: ['b'] },
    ]).result).toBe('no_material_pattern_candidate');
  });
  it('표본 2건 미만 → insufficient_data(sample_too_small)', () => {
    expect(detectExperiencePatterns([{ caseCode: 'C-1', tags: ['a'] }]).result).toBe('insufficient_data');
    expect(detectExperiencePatterns(null).result).toBe('insufficient_data');
  });
});

describe('findSimilarCases(Similar Case ≠ Same Outcome)', () => {
  it('Jaccard 유사도 정렬 + 임계 미달 제외', () => {
    const r = findSimilarCases(['incident', 'deploy'], [
      { caseCode: 'C-1', tags: ['incident', 'deploy'], outcomeReference: 'resolved' },
      { caseCode: 'C-2', tags: ['incident', 'pricing'], outcomeReference: null },
      { caseCode: 'C-3', tags: ['marketing'], outcomeReference: null },
    ]);
    expect(r.similar.map((c) => c.caseCode)).toEqual(['C-1']);
    expect(r.similar[0].similarity).toBe(1);
    expect(r.similarCaseIsNotSameOutcome).toBe(true);
  });
  it('태그/과거 사례 없음 → insufficientData', () => {
    expect(findSimilarCases(null, null).insufficientData).toBe(true);
    expect(findSimilarCases(['a'], []).insufficientData).toBe(true);
  });
});

describe('buildExecutiveKnowledgeScorecard(§8 — 결정적 정렬)', () => {
  const base = {
    category: 'engineering', freshness: null, contradictionCount: 0,
    recommendation: null, executiveReviewPresent: false,
  };
  it('low quality/unsupported 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveKnowledgeScorecard([
      { ...base, knowledgeCode: 'K-C', quality: 'high_quality_candidate' as const, coverage: 'strongly_supported_candidate' as const },
      { ...base, knowledgeCode: 'K-A', quality: 'low_quality_candidate' as const, coverage: 'unsupported_candidate' as const },
      { ...base, knowledgeCode: 'K-B', quality: 'low_quality_candidate' as const, coverage: 'unsupported_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.knowledgeCode)).toEqual(['K-A', 'K-B', 'K-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotFactConfirmation).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveKnowledgeScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateKnowledgeReview(§9 — Review ≠ Approval)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단(record_review_reference/record_verified_reference)', () => {
    for (const action of ['record_review_reference', 'record_verified_reference']) {
      const r = validateKnowledgeReview({ action, evidenceCount: 0, isSelfReview: true });
      expect(r.allowed).toBe(false);
      expect(r.blockedReasons).toHaveLength(2);
      expect(r.reviewIsNotApproval).toBe(true);
      expect(r.adoptionIsHuman).toBe(true);
    }
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateKnowledgeReview({ action: 'record_review_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
    expect(validateKnowledgeReview({ action: 'mark_in_review', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildKnowledgeTimeline / Honest Boundary(Support Matrix)', () => {
  it('12단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildKnowledgeTimeline({ present: { enterprise_vision: true, continuous_learning: true } });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 51항목 — unavailable 12종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX).toHaveLength(51);
    const unavailable = ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(12);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_fact_confirmation', 'automatic_policy_promotion', 'automatic_legal_judgment', 'automatic_compliance_confirmation', 'automatic_merge', 'automatic_deploy', 'automatic_production_change']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(Wiki/문서 관리/외부 지식 베이스 등)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_KNOWLEDGE_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['wiki_system_feed', 'document_management_system', 'external_knowledge_base_feed', 'search_index_feed', 'meeting_notes_feed', 'customer_feedback_feed']) {
      expect(missing).toContain(feed);
    }
  });
});
