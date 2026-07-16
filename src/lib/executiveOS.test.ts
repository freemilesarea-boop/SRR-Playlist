import { describe, expect, it } from 'vitest';
import {
  buildExecutiveAdvisory,
  buildExecutiveCockpitOS,
  buildExecutiveGraph,
  buildOperatingScorecard,
  buildUnifiedBriefing,
  buildUnifiedIntelligence,
  buildUnifiedTimeline,
  correlateCrossDomain,
  ENTERPRISE_DOMAINS,
  evaluateEnterpriseHealth,
  EXECUTIVE_OS_SUPPORT,
} from './executiveOS';

describe('unified intelligence — Complete Knowledge 아님', () => {
  it('10 도메인 whitelist + null 유지(insufficient_data)', () => {
    const r = buildUnifiedIntelligence([
      { domain: 'strategy', itemCount: 3, note: '0524' },
      { domain: 'finance', itemCount: null, note: '0526' },
      { domain: 'bogus', itemCount: 5, note: 'x' },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.measuredDomains).toBe(1);
    expect(r.rows[1].status).toBe('insufficient_data');
    expect(r.unifiedIsNotCompleteKnowledge).toBe(true);
  });
});

describe('enterprise health — 단일 합산 없음', () => {
  it('영역별 독립 판정 + overall 없음 + Evidence 게이트', () => {
    const r = evaluateEnterpriseHealth([
      { domain: 'strategy', signal: 70, evidence: ['0524 실측'] },
      { domain: 'risk', signal: 30, evidence: ['0528 실측'] },
      { domain: 'market', signal: null, evidence: ['0527'] },
      { domain: 'finance', signal: 80, evidence: [] },
    ]);
    expect(r.rows[0].verdict).toBe('healthy_candidate');
    expect(r.rows[1].verdict).toBe('watch_candidate');
    expect(r.rows[2].verdict).toBe('unknown');
    expect(r.rows[3].verdict).toBe('executive_unverified');
    expect(r.noAggregateScore).toBe(true);
    expect(r.healthIsNotBusinessSuccess).toBe(true);
    expect('overall' in r).toBe(false);   // 전체 점수 단일 합산 금지
  });
});

describe('unified timeline — 7단계 실측 집계', () => {
  it('stage whitelist + 원본 없는 단계 insufficient + 완료 주장 아님', () => {
    const r = buildUnifiedTimeline([
      { stage: 'decision', count: 5, source: '0514' },
      { stage: 'commitment', count: 3, source: '0520' },
      { stage: 'bogus', count: 1, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(7);
    expect(r.stages.find((s) => s.stage === 'decision')?.count).toBe(5);
    expect(r.stages.find((s) => s.stage === 'outcome')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
});

describe('executive graph — 9단계·인과 주장 없음', () => {
  it('orphan/cycle 감지 + causalityClaimed=false', () => {
    const r = buildExecutiveGraph([
      { id: 'v', stage: 'vision', label: 'V', parentId: null },
      { id: 's', stage: 'strategy', label: 'S', parentId: 'v' },
      { id: 'c', stage: 'commitment', label: 'C', parentId: null },   // orphan
    ]);
    expect(r.stages).toHaveLength(9);
    expect(r.orphans).toContain('c');
    expect(r.orphans).not.toContain('s');
    const cyclic = buildExecutiveGraph([
      { id: 'a', stage: 'decision', label: 'A', parentId: 'b' },
      { id: 'b', stage: 'decision', label: 'B', parentId: 'a' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
    expect(cyclic.causalityClaimed).toBe(false);
  });
});

describe('scorecard — Evidence 동반 강제', () => {
  it('Evidence 없으면 값 제외(executive_unverified) + Success 아님', () => {
    const r = buildOperatingScorecard([
      { indicator: 'strategic_progress', value: 40, evidence: ['0524 objectives'], missingAreas: [], unknownFactors: ['외부 요인'] },
      { indicator: 'financial_stability', value: 70, evidence: [], missingAreas: ['원장 없음'], unknownFactors: [] },
      { indicator: 'bogus_indicator', value: 1, evidence: ['e'], missingAreas: [], unknownFactors: [] },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].verdict).toBe('referenced');
    expect(r.rows[1].verdict).toBe('executive_unverified');
    expect(r.rows[1].value).toBeNull();
    expect(r.scorecardIsNotSuccess).toBe(true);
    expect(r.scoreOnlyReturn).toBe(false);
  });
});

describe('cross-domain / briefing / advisory / cockpit / support', () => {
  it('cross-domain: 0525 재사용 + Correlation ≠ Causation', () => {
    const r = correlateCrossDomain([
      { label: 'Strategy ↔ Execution', strategySignal: 25, kpiSignal: 30, sample: 10 },
      { label: 'Finance ↔ Market', strategySignal: null, kpiSignal: null, sample: 0 },
    ]);
    expect(r.pairs[0].verdict).toBe('correlation_candidate');
    expect(r.pairs[1].verdict).toBe('insufficient_data');
    expect(r.correlationIsNotCausation).toBe(true);
  });
  it('briefing: 6섹션 + 자동 발송 없음 + View ≠ Decision', () => {
    const r = buildUnifiedBriefing({ periodKind: 'weekly', keyChanges: ['c'], keyResults: [], keyRisks: ['r'], keyOpportunities: [], unknownFactors: ['u'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(6);
    expect(r.autoSendDisabled).toBe(true);
    expect(r.executiveViewIsNotDecision).toBe(true);
    expect(buildUnifiedBriefing({ periodKind: 'hourly', keyChanges: [], keyResults: [], keyRisks: [], keyOpportunities: [], unknownFactors: [], recommendations: [] }).valid).toBe(false);
  });
  it('advisory: whitelist + Evidence 필수 + Recommendation ≠ Approval', () => {
    expect('rejected' in buildExecutiveAdvisory({ type: 'approve_strategy', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildExecutiveAdvisory({ type: 'review_strategic_priority', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildExecutiveAdvisory({ type: 'validate_cross_domain_impact', reason: '도메인 간 상관 후보 존재(인과 아님)', evidence: ['correlation'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Approval');
    }
  });
  it('cockpit OS: 12영역(overview+10도메인+summary) + executiveDecisionMade=false', () => {
    const counts: Record<string, number | null> = {};
    for (const d of ENTERPRISE_DOMAINS) counts[d] = d === 'finance' ? null : 2;
    const r = buildExecutiveCockpitOS({ domainCounts: counts, healthUnknowns: 1, advisoriesOpen: 2, summaryNote: null });
    expect(r.sections).toHaveLength(12);
    expect(r.sections[0].headline).toBe('9/10');
    expect(r.sections.find((s) => s.key === 'finance')?.headline).toBe('insufficient_data');
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.executiveDecisionMade).toBe(false);
  });
  it('EXECUTIVE_OS_SUPPORT: 16항목 + 실시간/외부 ERP/자동 결정 unsupported', () => {
    expect(EXECUTIVE_OS_SUPPORT).toHaveLength(16);
    for (const key of ['realtime_streaming', 'external_erp_bi', 'auto_executive_decision', 'auto_strategy_budget_policy', 'auto_production_change']) {
      expect(EXECUTIVE_OS_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
