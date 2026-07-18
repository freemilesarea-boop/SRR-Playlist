import { describe, it, expect } from 'vitest';
import {
  MISSION_CATEGORIES, MISSION_STATUSES,
  MISSION_ALIGNMENT_DIMENSIONS, MISSION_ALIGNMENT_RESULTS,
  MISSION_DRIFT_DIMENSIONS, MISSION_DRIFT_RESULTS,
  STRATEGIC_OUTCOME_DIMENSIONS, STRATEGIC_OUTCOME_RESULTS,
  ALIGNMENT_TREND_RESULTS, OBJECTIVE_COVERAGE_RESULTS,
  MISSION_REVIEW_TYPES, OBJECTIVE_ALIGNMENT_STATUSES,
  MISSION_RECOMMENDATION_TYPES, MISSION_SCORECARD_FIELDS, MISSION_FLOW_STAGES,
  evaluateMissionAlignment, evaluateMissionDrift, evaluateStrategicOutcome,
  evaluateKpiAlignment, detectUncoveredObjectives, analyzeAlignmentTrend,
  buildExecutiveMissionScorecard, validateMissionReview, buildMissionTimeline,
  ENTERPRISE_MISSION_COMPONENTS, ENTERPRISE_MISSION_SUPPORT_MATRIX,
} from './enterpriseMission';

describe('enterpriseMission 상수(§3~§10 — SQL CHECK 1:1)', () => {
  it('Mission Category 14종·Status 5종', () => {
    expect(MISSION_CATEGORIES).toHaveLength(14);
    expect(MISSION_STATUSES).toHaveLength(5);
    expect(MISSION_STATUSES).toContain('insufficient_data');
  });
  it('Alignment/Drift/Outcome/Trend/Coverage 결과 5종 + insufficient_data 포함', () => {
    for (const list of [MISSION_ALIGNMENT_RESULTS, MISSION_DRIFT_RESULTS, STRATEGIC_OUTCOME_RESULTS, ALIGNMENT_TREND_RESULTS, OBJECTIVE_COVERAGE_RESULTS, OBJECTIVE_ALIGNMENT_STATUSES]) {
      expect(list).toHaveLength(5);
      expect(list).toContain('insufficient_data');
    }
    expect(MISSION_ALIGNMENT_DIMENSIONS).toHaveLength(6);
    expect(MISSION_DRIFT_DIMENSIONS).toHaveLength(5);
    expect(STRATEGIC_OUTCOME_DIMENSIONS).toHaveLength(5);
  });
  it('Review 3종·권고 23종·Scorecard 8필드·Flow 13단계·컴포넌트 10종', () => {
    expect(MISSION_REVIEW_TYPES).toHaveLength(3);
    expect(MISSION_RECOMMENDATION_TYPES).toHaveLength(23);
    expect(MISSION_RECOMMENDATION_TYPES).toContain('insufficient_data');
    expect(MISSION_SCORECARD_FIELDS).toHaveLength(8);
    expect(MISSION_FLOW_STAGES).toHaveLength(13);
    expect(ENTERPRISE_MISSION_COMPONENTS).toHaveLength(10);
  });
});

describe('evaluateMissionAlignment(§5 — Alignment ≠ Mission Success)', () => {
  it('6차원 고득점 → highly_aligned_candidate', () => {
    const r = evaluateMissionAlignment(MISSION_ALIGNMENT_DIMENSIONS.map((dimension) => ({ dimension, score: 85 })));
    expect(r.result).toBe('highly_aligned_candidate');
    expect(r.alignmentScore).toBe(85);
    expect(r.assessedDimensions).toBe(6);
    expect(r.alignmentIsNotMissionSuccess).toBe(true);
  });
  it('중간/저득점 → partially/misaligned', () => {
    expect(evaluateMissionAlignment([
      { dimension: 'strategy_alignment', score: 45 }, { dimension: 'kpi_alignment', score: 50 }, { dimension: 'execution_alignment', score: 40 },
    ]).result).toBe('partially_aligned_candidate');
    expect(evaluateMissionAlignment([
      { dimension: 'strategy_alignment', score: 20 }, { dimension: 'kpi_alignment', score: 25 }, { dimension: 'execution_alignment', score: 30 },
    ]).result).toBe('misaligned_candidate');
  });
  it('3차원 미만 평가 → insufficient_data(Null → 0 금지) + 미평가 차원 공개', () => {
    const r = evaluateMissionAlignment([
      { dimension: 'strategy_alignment', score: 90 }, { dimension: 'kpi_alignment', score: null },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.alignmentScore).toBeNull();
    expect(r.missingDimensions).toContain('kpi_alignment');
    expect(evaluateMissionAlignment(null).result).toBe('insufficient_data');
  });
});

describe('evaluateMissionDrift(§6 — worst-of, Drift ≠ Organizational Failure)', () => {
  it('가장 큰 Drift 차원이 결과를 결정(worst-of)', () => {
    const r = evaluateMissionDrift([
      { dimension: 'objective_drift', driftScore: 10 }, { dimension: 'portfolio_drift', driftScore: 80 },
    ]);
    expect(r.result).toBe('critical_drift_candidate');
    expect(r.worstDimension).toBe('portfolio_drift');
    expect(r.driftIsNotOrganizationalFailure).toBe(true);
  });
  it('경계값: 20 → stable, 40 → watch, 70 → drifting', () => {
    expect(evaluateMissionDrift([{ dimension: 'kpi_drift', driftScore: 20 }, { dimension: 'objective_drift', driftScore: 10 }]).result).toBe('stable_candidate');
    expect(evaluateMissionDrift([{ dimension: 'kpi_drift', driftScore: 40 }, { dimension: 'objective_drift', driftScore: 10 }]).result).toBe('watch_candidate');
    expect(evaluateMissionDrift([{ dimension: 'kpi_drift', driftScore: 70 }, { dimension: 'objective_drift', driftScore: 10 }]).result).toBe('drifting_candidate');
  });
  it('2차원 미만 평가 → insufficient_data', () => {
    expect(evaluateMissionDrift([{ dimension: 'objective_drift', driftScore: 50 }]).result).toBe('insufficient_data');
    expect(evaluateMissionDrift(null).result).toBe('insufficient_data');
  });
});

describe('evaluateStrategicOutcome(§7 — Outcome ≠ Business Success)', () => {
  it('5분석 고득점 → strongly_supported_candidate', () => {
    const r = evaluateStrategicOutcome(STRATEGIC_OUTCOME_DIMENSIONS.map((dimension) => ({ dimension, score: 88 })));
    expect(r.result).toBe('strongly_supported_candidate');
    expect(r.assessedDimensions).toBe(5);
    expect(r.outcomeIsNotBusinessSuccess).toBe(true);
  });
  it('저득점 → weakly/unsupported, 3개 미만 → insufficient_data', () => {
    expect(evaluateStrategicOutcome([
      { dimension: 'mission_coverage', score: 45 }, { dimension: 'kpi_contribution', score: 50 }, { dimension: 'value_contribution', score: 40 },
    ]).result).toBe('weakly_supported_candidate');
    expect(evaluateStrategicOutcome([
      { dimension: 'mission_coverage', score: 10 }, { dimension: 'kpi_contribution', score: 20 }, { dimension: 'value_contribution', score: 25 },
    ]).result).toBe('unsupported_candidate');
    expect(evaluateStrategicOutcome([{ dimension: 'mission_coverage', score: 90 }]).result).toBe('insufficient_data');
  });
});

describe('evaluateKpiAlignment(연결 비율 — Score ≠ Executive Judgment)', () => {
  it('미연결 KPI 목록 공개 + 비율로 결과 결정', () => {
    const r = evaluateKpiAlignment([
      { kpiCode: 'K-1', linkedObjectives: 2 }, { kpiCode: 'K-2', linkedObjectives: 0 },
      { kpiCode: 'K-3', linkedObjectives: 1 }, { kpiCode: 'K-4', linkedObjectives: 3 },
      { kpiCode: 'K-5', linkedObjectives: 1 },
    ]);
    expect(r.result).toBe('highly_aligned_candidate');
    expect(r.unlinkedKpis).toEqual(['K-2']);
    expect(r.alignmentScoreIsNotExecutiveJudgment).toBe(true);
  });
  it('절반 미연결 → partially, 전부 미계측 → insufficient_data', () => {
    expect(evaluateKpiAlignment([
      { kpiCode: 'K-1', linkedObjectives: 0 }, { kpiCode: 'K-2', linkedObjectives: 1 },
    ]).result).toBe('partially_aligned_candidate');
    const r = evaluateKpiAlignment([{ kpiCode: 'K-1', linkedObjectives: null }]);
    expect(r.result).toBe('insufficient_data');
    expect(r.unverifiedKpis).toBe(1);
  });
});

describe('detectUncoveredObjectives(Initiative 없는 Objective)', () => {
  it('Initiative 0건 Objective → uncovered_objectives_candidate + 목록 공개', () => {
    const r = detectUncoveredObjectives([
      { objectiveCode: 'O-2', initiativeCount: 0 }, { objectiveCode: 'O-1', initiativeCount: 3 },
    ]);
    expect(r.result).toBe('uncovered_objectives_candidate');
    expect(r.uncoveredObjectives).toEqual(['O-2']);
    expect(r.coverageIsNotAchievement).toBe(true);
  });
  it('전부 커버 → full, 미계측 섞임 → partial, 전부 미계측 → unverified', () => {
    expect(detectUncoveredObjectives([{ objectiveCode: 'O-1', initiativeCount: 2 }]).result).toBe('full_coverage_candidate');
    expect(detectUncoveredObjectives([
      { objectiveCode: 'O-1', initiativeCount: 2 }, { objectiveCode: 'O-2', initiativeCount: null },
    ]).result).toBe('partial_coverage_candidate');
    expect(detectUncoveredObjectives([{ objectiveCode: 'O-1', initiativeCount: null }]).result).toBe('coverage_unverified');
    expect(detectUncoveredObjectives(null).result).toBe('insufficient_data');
  });
});

describe('analyzeAlignmentTrend(Trend ≠ Forecast 확정)', () => {
  it('상승 → improving, 하락 → declining, 유지 → stable', () => {
    expect(analyzeAlignmentTrend([
      { periodLabel: 'Q1', alignmentScore: 50 }, { periodLabel: 'Q2', alignmentScore: 55 }, { periodLabel: 'Q3', alignmentScore: 62 },
    ]).result).toBe('improving_alignment_candidate');
    expect(analyzeAlignmentTrend([
      { periodLabel: 'Q1', alignmentScore: 70 }, { periodLabel: 'Q2', alignmentScore: 60 }, { periodLabel: 'Q3', alignmentScore: 55 },
    ]).result).toBe('declining_alignment_candidate');
    expect(analyzeAlignmentTrend([
      { periodLabel: 'Q1', alignmentScore: 60 }, { periodLabel: 'Q2', alignmentScore: 62 }, { periodLabel: 'Q3', alignmentScore: 61 },
    ]).result).toBe('stable_alignment_candidate');
  });
  it('표본 3기간 미만 → insufficient_data(sample_too_small — null 제외)', () => {
    const r = analyzeAlignmentTrend([
      { periodLabel: 'Q1', alignmentScore: 60 }, { periodLabel: 'Q2', alignmentScore: null }, { periodLabel: 'Q3', alignmentScore: 70 },
    ]);
    expect(r.result).toBe('insufficient_data');
    expect(r.sampleCount).toBe(2);
    expect(analyzeAlignmentTrend(null).result).toBe('insufficient_data');
  });
});

describe('buildExecutiveMissionScorecard(§8 — 결정적 정렬)', () => {
  const base = {
    category: 'strategic', uncoveredObjectiveCount: 0, recommendation: null, humanReviewPresent: false,
  };
  it('misaligned/critical drift 우선 + 동순위는 코드순', () => {
    const r = buildExecutiveMissionScorecard([
      { ...base, missionCode: 'M-C', alignment: 'aligned_candidate' as const, drift: 'stable_candidate' as const, outcome: 'strongly_supported_candidate' as const },
      { ...base, missionCode: 'M-A', alignment: 'misaligned_candidate' as const, drift: 'critical_drift_candidate' as const, outcome: 'unsupported_candidate' as const },
      { ...base, missionCode: 'M-B', alignment: 'misaligned_candidate' as const, drift: 'critical_drift_candidate' as const, outcome: 'unsupported_candidate' as const },
    ], 3);
    expect(r.priorityRows.map((e) => e.missionCode)).toEqual(['M-A', 'M-B', 'M-C']);
    expect(r.fields).toHaveLength(8);
    expect(r.scorecardIsNotExecutiveJudgment).toBe(true);
    expect(r.orderingIsDeterministic).toBe(true);
  });
  it('null 입력 → 빈 행(오류 없음)', () => {
    expect(buildExecutiveMissionScorecard(null).priorityRows).toEqual([]);
  });
});

describe('validateMissionReview(§9 — Mission 변경은 사람)', () => {
  it('Self-Review + Evidence 없음 → 이중 차단', () => {
    const r = validateMissionReview({ action: 'record_review_reference', evidenceCount: 0, isSelfReview: true });
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons).toHaveLength(2);
    expect(r.reviewIsNotApproval).toBe(true);
    expect(r.missionChangeIsHuman).toBe(true);
  });
  it('타인 Review + Evidence 존재 → 허용, 그 외 액션은 게이트 미적용', () => {
    expect(validateMissionReview({ action: 'record_review_reference', evidenceCount: 2, isSelfReview: false }).allowed).toBe(true);
    expect(validateMissionReview({ action: 'activate_reference', evidenceCount: null, isSelfReview: true }).allowed).toBe(true);
  });
});

describe('buildMissionTimeline / Honest Boundary(Support Matrix)', () => {
  it('13단계 관측 표시(자동 진행 아님)', () => {
    const rows = buildMissionTimeline({ present: { enterprise_vision: true, mission_learning: true } });
    expect(rows).toHaveLength(13);
    expect(rows[0]).toEqual({ stage: 'enterprise_vision', present: true });
    expect(rows.filter((r) => r.present)).toHaveLength(2);
  });
  it('Support Matrix 52항목 — unavailable 13종은 전부 automatic_*(절대 금지 1:1)', () => {
    expect(ENTERPRISE_MISSION_SUPPORT_MATRIX).toHaveLength(52);
    const unavailable = ENTERPRISE_MISSION_SUPPORT_MATRIX.filter((e) => e.support === 'unavailable');
    expect(unavailable).toHaveLength(13);
    expect(unavailable.every((e) => e.capability.startsWith('automatic_'))).toBe(true);
    for (const cap of ['automatic_mission_change', 'automatic_vision_change', 'automatic_okr_generation', 'automatic_kpi_change', 'automatic_portfolio_change', 'automatic_merge', 'automatic_deploy', 'automatic_rollback']) {
      expect(unavailable.some((e) => e.capability === cap)).toBe(true);
    }
  });
  it('실측 부재 피드(OKR 시스템/Mission 헌장 원장 등)는 insufficient_data 로 정직 표기', () => {
    const missing = ENTERPRISE_MISSION_SUPPORT_MATRIX.filter((e) => e.support === 'insufficient_data').map((e) => e.capability);
    expect(missing).toHaveLength(6);
    for (const feed of ['okr_system_feed', 'official_mission_charter_ledger', 'board_mission_minutes', 'employee_survey_feed', 'market_research_feed', 'esg_reporting_feed']) {
      expect(missing).toContain(feed);
    }
  });
});
