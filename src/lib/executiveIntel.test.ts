// Phase AI-MUSIC-16 — Executive Intelligence 순수 로직 단위 테스트.
// KPI(unsupported 정직) · OS Health(재정규화) · Risk(실측 신호만) · Opportunity(근거 필수) ·
// Orchestrator(0497 재사용, abstain 유지) · Strategic Plan(Horizon penalty) ·
// Recommendation 4요소 검증 · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  buildExecutiveKpis, computeAiOsHealth, detectStrategicRisks, detectExecOpportunities,
  orchestrateExecutiveReview, buildStrategicPlan, validateRecommendation, execInputHash,
  HORIZON_PENALTY, EXEC_SUPPORT,
  type PlanItem,
} from './executiveIntel';

describe('Executive KPI', () => {
  it('실측 KPI available · Retention/Discovery unsupported · 없는 값 insufficient', () => {
    const kpis = buildExecutiveKpis({ completionRate: 75, revenueMonth: 1000000, likeRate: 2 });
    expect(kpis.find((k) => k.key === 'completion')!.status).toBe('available');
    expect(kpis.find((k) => k.key === 'satisfaction')!.status).toBe('proxy');
    expect(kpis.find((k) => k.key === 'retention')!.status).toBe('unsupported');
    expect(kpis.find((k) => k.key === 'discovery')!.status).toBe('unsupported');
    expect(kpis.find((k) => k.key === 'growth')!.status).toBe('insufficient_data');
    expect(kpis.find((k) => k.key === 'growth')!.value).toBeNull();
  });
});

describe('AI OS Health', () => {
  it('성분 재정규화 · 전 성분 누락 insufficient_data', () => {
    const r = computeAiOsHealth({ agentTrust: 70, fleetHealth: 80, streamingStability: 95 });
    expect(r.score).not.toBeNull(); expect(r.grade).toBe('healthy'); expect(r.missing).toContain('self_healing');
    expect(computeAiOsHealth({}).grade).toBe('insufficient_data');
  });
});

describe('Strategic Risk Engine', () => {
  it('실측 신호 기반 위험 감지 · Region/Enterprise/Capacity 는 판정 안 함(정직)', () => {
    const { risks, unsupported } = detectStrategicRisks({ replayRate: 7, errorRate: 5.5, revenueTrendPct: -30, governanceViolations: 6, activeIncidents: 4 });
    expect(risks.find((r) => r.type === 'playlist_fatigue')!.severity).toBe('high');
    expect(risks.find((r) => r.type === 'quality_risk' && r.severity === 'critical')).toBeTruthy();
    expect(risks.find((r) => r.type === 'revenue_risk')!.severity).toBe('high');
    expect(unsupported).toEqual(['region_risk', 'enterprise_risk', 'capacity_risk']);
  });
  it('신호 정상/null → 위험 없음(가짜 위험 생성 없음)', () => {
    expect(detectStrategicRisks({}).risks).toEqual([]);
    expect(detectStrategicRisks({ replayRate: 1, errorRate: 0.2, revenueTrendPct: 5 }).risks).toEqual([]);
  });
});

describe('Opportunity Engine', () => {
  it('실측 근거 있는 기회만 생성 · 근거 없으면 빈 배열', () => {
    const opps = detectExecOpportunities({
      topIndustry: { storeType: 'cafe', completionRate: 82, deltaVsMedian: 7 },
      currentSeason: '여름', activeRollouts: 2, bestPracticeCount: 3,
    });
    expect(opps.map((o) => o.type)).toEqual(expect.arrayContaining(['industry_optimization', 'seasonal_playlist', 'new_track_testing', 'best_practice_adoption']));
    expect(opps.every((o) => o.evidence.length > 0)).toBe(true);
    expect(detectExecOpportunities({})).toEqual([]);
  });
  it('median 우위 3pp 미만 industry 는 기회 아님', () => {
    expect(detectExecOpportunities({ topIndustry: { storeType: 'cafe', completionRate: 76, deltaVsMedian: 1 } })).toEqual([]);
  });
});

describe('Cross-Agent Orchestrator (0497 재사용)', () => {
  it('플랫폼 신호 → 8 Agent 평가 · 신호 없는 Agent abstain 유지(기존 정의 무변경)', () => {
    const r = orchestrateExecutiveReview({
      completionRate: 78, skipRate: 6, likeRate: 2, diversityProxy: 70, errorRate: 0.5, replayRate: 1,
      revenueTrendPct: 5, governanceHealth: 90, governanceViolations: 0, sample: 500,
    });
    expect(r.opinions.length).toBe(8);
    expect(r.opinions.find((o) => o.agent === 'ranking')!.stance).toBe('abstain');   // 신호 없음
    expect(r.finalDecision).toBe('proceed_to_governance');
  });
  it('Governance 위반 → governance_review(기존 oppose 우선 유지)', () => {
    const r = orchestrateExecutiveReview({
      completionRate: 78, skipRate: 6, likeRate: 2, diversityProxy: 70, errorRate: 0.5, replayRate: 1,
      revenueTrendPct: 5, governanceHealth: 90, governanceViolations: 3, sample: 500,
    });
    expect(r.governanceRequired).toBe(true);
  });
});

describe('Strategic Planning', () => {
  const risks = detectStrategicRisks({ errorRate: 3 }).risks;
  const opps = detectExecOpportunities({ currentSeason: '여름' });
  it('Horizon penalty — 장기일수록 Confidence 감소', () => {
    const d7 = buildStrategicPlan('7d', risks, opps, 70);
    const season = buildStrategicPlan('season', risks, opps, 70);
    expect(d7[0].confidence).toBe(70); expect(season[0].confidence).toBe(70 - HORIZON_PENALTY.season);
  });
  it('base confidence 없으면 계획 생성 안 함 · 결정적 정렬', () => {
    expect(buildStrategicPlan('7d', risks, opps, null)).toEqual([]);
    expect(buildStrategicPlan('7d', risks, opps, 70)).toEqual(buildStrategicPlan('7d', risks, opps, 70));
  });
  it('모든 PlanItem 은 4요소 검증 통과', () => {
    for (const item of buildStrategicPlan('30d', risks, opps, 70)) expect(validateRecommendation(item)).toEqual([]);
  });
});

describe('Recommendation 검증 / Hash / Support', () => {
  it('4요소 누락 시 오류', () => {
    const bad: PlanItem = { horizon: '7d', category: 'strategy', title: '', summary: '', confidence: NaN, riskTier: 'low', expectedOutcome: {}, evidence: [], limitations: [] };
    const errors = validateRecommendation(bad);
    expect(errors).toContain('recommendation text required');
    expect(errors).toContain('evidence required');
    expect(errors).toContain('confidence required');
    expect(errors).toContain('expected_outcome required');
  });
  it('hash 결정적', () => { expect(execInputHash(['a', 1])).toBe(execInputHash(['a', 1])); });
  it('Executive Policy/Production Apply = unsupported · Orchestrator/Simulation = read_only · Governance = fully', () => {
    expect(EXEC_SUPPORT.find((s) => s.key === 'executive_policy')!.status).toBe('unsupported');
    expect(EXEC_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(EXEC_SUPPORT.find((s) => s.key === 'orchestrator')!.status).toBe('read_only');
    expect(EXEC_SUPPORT.find((s) => s.key === 'governance')!.status).toBe('fully_supported');
  });
});
