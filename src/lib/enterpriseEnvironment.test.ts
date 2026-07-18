import { describe, it, expect } from 'vitest';
import {
  ENVIRONMENT_CATEGORIES, ENVIRONMENT_STATUSES,
  MARKET_SIGNAL_DIMENSIONS, MARKET_SIGNAL_RESULTS,
  ENVIRONMENT_IMPACT_DIMENSIONS, ENVIRONMENT_IMPACT_RESULTS,
  EXTERNAL_RISK_DIMENSIONS, EXTERNAL_RISK_RESULTS,
  ENVIRONMENT_REVIEW_TYPES, ENVIRONMENT_REVIEW_STATUSES,
  ENVIRONMENT_RECOMMENDATION_TYPES, ENVIRONMENT_SCORECARD_FIELDS, ENVIRONMENT_FLOW_STAGES,
  evaluateMarketSignal, evaluateEnvironmentImpact, detectExternalRiskSignals,
  validateEnvironmentRecommendation, buildExecutiveEnvironmentScorecard,
  validateEnvironmentReview, buildEnvironmentTimeline,
  ENTERPRISE_ENVIRONMENT_COMPONENTS, ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX,
} from './enterpriseEnvironment';

describe('enterpriseEnvironment 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Environment Category 15종·Status 5종', () => {
    expect(ENVIRONMENT_CATEGORIES).toHaveLength(15);
    expect(ENVIRONMENT_STATUSES).toHaveLength(5);
    expect(ENVIRONMENT_STATUSES).toContain('insufficient_data');
  });
  it('Signal/Impact/Risk 결과 5종 + insufficient_data 포함', () => {
    for (const list of [MARKET_SIGNAL_RESULTS, ENVIRONMENT_IMPACT_RESULTS, EXTERNAL_RISK_RESULTS, ENVIRONMENT_REVIEW_STATUSES]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(MARKET_SIGNAL_DIMENSIONS).toHaveLength(5);
    expect(ENVIRONMENT_IMPACT_DIMENSIONS).toHaveLength(5);
    expect(EXTERNAL_RISK_DIMENSIONS).toHaveLength(6);
  });
  it('Review 3종·권고 23종·Scorecard 8필드·Flow 15단계·컴포넌트 10종', () => {
    expect(ENVIRONMENT_REVIEW_TYPES).toHaveLength(3);
    expect(ENVIRONMENT_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(ENVIRONMENT_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(ENVIRONMENT_SCORECARD_FIELDS).toHaveLength(8);
    expect(ENVIRONMENT_FLOW_STAGES).toHaveLength(15);
    expect(ENTERPRISE_ENVIRONMENT_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateMarketSignal(§5 — Market Trend ≠ Future Market)', () => {
  it('전 차원 강함 → strong_signal_candidate', () => {
    const r = evaluateMarketSignal({ trendStrength: 90, signalConsistency: 85, evidenceQuality: 88, freshnessDays: 10, coverage: 82 });
    expect(r.result).toBe('strong_signal_candidate');
    expect(r.assessedDimensions).toBe(5);
    expect(r.marketTrendIsNotFutureMarket).toBe(true);
  });
  it('약한 신호 → weak/unsupported', () => {
    expect(evaluateMarketSignal({ trendStrength: 45, signalConsistency: 50, evidenceQuality: 40, freshnessDays: null, coverage: null }).result).toBe('weak_signal_candidate');
    expect(evaluateMarketSignal({ trendStrength: 10, signalConsistency: 20, evidenceQuality: 15, freshnessDays: 400, coverage: 5 }).result).toBe('unsupported_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지)', () => {
    const r = evaluateMarketSignal({ trendStrength: 90, signalConsistency: null, evidenceQuality: null, freshnessDays: null, coverage: 80 });
    expect(r.result).toBe('insufficient_data');
    expect(r.signalScore).toBeNull();
    expect(r.assessedDimensions).toBe(2);
  });
});

describe('evaluateEnvironmentImpact(§6 — worst-of, Impact ≠ 전략 변경)', () => {
  it('가장 큰 Impact 차원이 결과를 결정(worst-of)', () => {
    const r = evaluateEnvironmentImpact([
      { dimension: 'mission_impact', impactScore: 30 }, { dimension: 'financial_impact', impactScore: 85 },
    ]);
    expect(r.result).toBe('high_impact_candidate');
    expect(r.worstDimension).toBe('financial_impact');
    expect(r.impactIsNotStrategyChange).toBe(true);
  });
  it('경계값: 40 → medium, 39 → low', () => {
    expect(evaluateEnvironmentImpact([
      { dimension: 'strategy_impact', impactScore: 40 }, { dimension: 'mission_impact', impactScore: 10 },
    ]).result).toBe('medium_impact_candidate');
    expect(evaluateEnvironmentImpact([
      { dimension: 'strategy_impact', impactScore: 39 }, { dimension: 'mission_impact', impactScore: 10 },
    ]).result).toBe('low_impact_candidate');
  });
  it('미지 차원이 평가 차원보다 많으면 → impact_unknown(Null → 0 금지)', () => {
    const r = evaluateEnvironmentImpact([
      { dimension: 'mission_impact', impactScore: 80 }, { dimension: 'strategy_impact', impactScore: 70 },
      { dimension: 'portfolio_impact', impactScore: null }, { dimension: 'financial_impact', impactScore: null },
      { dimension: 'operational_impact', impactScore: null },
    ]);
    expect(r.result).toBe('impact_unknown');
    expect(r.unknownDimensions).toBe(3);
  });
  it('입력 없음/전부 무효 → insufficient_data', () => {
    expect(evaluateEnvironmentImpact(null).result).toBe('insufficient_data');
    expect(evaluateEnvironmentImpact([{ dimension: 'not_a_dim', impactScore: 90 }]).result).toBe('insufficient_data');
  });
});

describe('detectExternalRiskSignals(§7 — Risk Signal ≠ Actual Risk)', () => {
  it('가장 높은 severity 차원이 결과를 결정(worst-of)', () => {
    const r = detectExternalRiskSignals([
      { dimension: 'regulatory', severity: 20 }, { dimension: 'supply_chain', severity: 85 },
    ]);
    expect(r.result).toBe('critical_candidate');
    expect(r.worstDimension).toBe('supply_chain');
    expect(r.riskSignalIsNotActualRisk).toBe(true);
  });
  it('중간 → elevated, 낮음 → normal', () => {
    expect(detectExternalRiskSignals([{ dimension: 'financial', severity: 50 }]).result).toBe('elevated_candidate');
    expect(detectExternalRiskSignals([{ dimension: 'reputation', severity: 10 }]).result).toBe('normal_candidate');
  });
  it('전부 미계측 → unverified_candidate, 없음 → insufficient_data', () => {
    const r = detectExternalRiskSignals([{ dimension: 'technology', severity: null }]);
    expect(r.result).toBe('unverified_candidate');
    expect(r.unverifiedDimensions).toBe(1);
    expect(detectExternalRiskSignals(null).result).toBe('insufficient_data');
    expect(detectExternalRiskSignals([{ dimension: 'unknown_dim', severity: 90 }]).result).toBe('insufficient_data');
  });
});

describe('validateEnvironmentRecommendation(Recommendation ≠ Decision)', () => {
  it('whitelist 외 type + Evidence 없음 → 이중 차단', () => {
    const r = validateEnvironmentRecommendation({ recommendationType: 'change_strategy_now', evidenceCount: 0 });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.recommendationIsNotDecision).toBe(true);
  });
  it('whitelist type + Evidence 존재 → 허용', () => {
    expect(validateEnvironmentRecommendation({ recommendationType: 'review_market_trend', evidenceCount: 2 }).allowed).toBe(true);
    expect(validateEnvironmentRecommendation({ recommendationType: 'gather_more_evidence_candidate', evidenceCount: 1 }).allowed).toBe(true);
  });
});

describe('buildExecutiveEnvironmentScorecard(§8 — 결정적 정렬)', () => {
  const base = { category: 'market', humanReviewPresent: false };
  it('critical risk/high impact 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveEnvironmentScorecard([
      { ...base, observationCode: 'EO-C', signal: 'moderate_signal_candidate' as const, impact: 'low_impact_candidate' as const, risk: 'normal_candidate' as const },
      { ...base, observationCode: 'EO-A', signal: 'strong_signal_candidate' as const, impact: 'high_impact_candidate' as const, risk: 'critical_candidate' as const },
      { ...base, observationCode: 'EO-B', signal: 'strong_signal_candidate' as const, impact: 'high_impact_candidate' as const, risk: 'critical_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.observationCode)).toEqual(['EO-A', 'EO-B', 'EO-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotStrategyChange).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveEnvironmentScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateEnvironmentReview(§9 — 전략·계약 변경은 사람)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateEnvironmentReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.reviewIsNotApproval).toBe(true);
    expect(r.strategyChangeIsHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateEnvironmentReview({ action: 'record_review_reference', evidenceCount: 1, isSelfReview: false }).allowed).toBe(true);
    expect(validateEnvironmentReview({ action: 'mark_in_review', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildEnvironmentTimeline / Honest Boundary(Support Matrix)', () => {
  it('15단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildEnvironmentTimeline({ present: { enterprise_vision: true, environment_learning: true } });
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 50항목 — unavailable 13종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX).toHaveLength(50);
    const unavailable = ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(13);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_strategy_change', 'automatic_mission_change', 'automatic_contract_signing', 'automatic_contract_termination', 'automatic_partner_approval', 'automatic_pricing_change', 'automatic_merge', 'automatic_deploy', 'automatic_rollback']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(시장 데이터/경쟁사/뉴스/규제/거시경제/고객 서베이)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['market_data_feed', 'competitor_intelligence_feed', 'news_media_feed', 'regulatory_bulletin_feed', 'macroeconomic_data_feed', 'customer_survey_feed']) {
      expect(missing).toContain(feed);
    }
  });
});
