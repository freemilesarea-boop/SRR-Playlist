import { describe, expect, it } from 'vitest';
import {
  buildBoardReference,
  buildConflictResolutionCandidate,
  buildCorporateRecommendation,
  buildCorporateTimeline,
  buildDecisionPackage,
  buildExecutiveAgenda,
  buildExecutiveAttentionCandidate,
  buildExecutiveDailyBriefing,
  buildPriorityDependencyGraph,
  buildPriorityOutcomeLink,
  calculateCorporateHealth,
  calculateExecutivePriority,
  calculateMateriality,
  calculateUrgency,
  classifyPriorityTier,
  classifyUrgentVsImportant,
  CORP_SUPPORT,
  detectCorporateConflict,
  detectDecisionBottleneck,
  detectMaterialRisk,
  detectStrategicOpportunity,
  validateCorporateSignal,
} from './corporateIntelligence';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('validateCorporateSignal', () => {
  it('type/title/evidence 검증 + 금액 null 은 오류 아님(0 변환 금지)', () => {
    expect(validateCorporateSignal(null)).toEqual(['signal 없음']);
    expect(validateCorporateSignal({ type: 'invalid', title: '', evidence: [] })).toHaveLength(3);
    expect(validateCorporateSignal({ type: 'mrr_change', title: 'MRR 하락', evidence: ['e1'], metricValue: null, monetaryImpact: null })).toEqual([]);
    expect(validateCorporateSignal({ type: 'mrr_change', title: 't', evidence: ['e'], metricValue: Number.NaN })).toContain('metric NaN/Infinity 금지');
  });
});

describe('calculateMateriality', () => {
  it('Hard Risk 는 금액 미상이어도 material(비금전 0 평가 금지)', () => {
    const r = calculateMateriality({ monetaryImpactKrw: null, mrrKrw: null, affectedStores: null, totalStores: null, hardRiskFlags: ['security'], strategicRelevance: null });
    expect(r.status).toBe('material_candidate');
    expect(r.score).toBeNull();
    expect(r.note).toContain('0 평가 금지');
  });
  it('구성 요소 전부 null 이면 materiality_unverified(0 변환 없음)', () => {
    const r = calculateMateriality({ monetaryImpactKrw: null, mrrKrw: null, affectedStores: null, totalStores: null, hardRiskFlags: [], strategicRelevance: null });
    expect(r.status).toBe('materiality_unverified');
    expect(r.score).toBeNull();
  });
  it('누락 구성 요소 제외 후 재정규화', () => {
    const r = calculateMateriality({ monetaryImpactKrw: 500000, mrrKrw: 1000000, affectedStores: null, totalStores: null, hardRiskFlags: [], strategicRelevance: null });
    expect(r.status).toBe('material_candidate');   // 50% MRR 영향
    expect(r.missing).toContain('blast_radius');
    expect(r.score).toBe(50);
  });
});

describe('calculateUrgency / classifyUrgentVsImportant', () => {
  it('deadline 임박 → urgent_candidate, deadline 없음 → urgency_unverified', () => {
    expect(calculateUrgency({ deadlineAt: new Date('2026-07-16T00:00:00Z'), now: NOW, escalationVelocity: null, alreadyBreaching: false }).status).toBe('urgent_candidate');
    const r = calculateUrgency({ deadlineAt: null, now: NOW, escalationVelocity: null, alreadyBreaching: null });
    expect(r.status).toBe('urgency_unverified');
    expect(r.score).toBeNull();
    expect(r.autoExecution).toBe(false);
  });
  it('이미 위반 중이면 100', () => {
    expect(calculateUrgency({ deadlineAt: null, now: NOW, escalationVelocity: null, alreadyBreaching: true }).score).toBe(100);
  });
  it('Urgent 와 Important 분리 — 4분면 + 미검증 insufficient', () => {
    expect(classifyUrgentVsImportant('material_candidate', 'urgent_candidate')).toBe('urgent_and_important');
    expect(classifyUrgentVsImportant('material_candidate', 'not_urgent_candidate')).toBe('important_not_urgent');
    expect(classifyUrgentVsImportant('not_material_candidate', 'urgent_candidate')).toBe('urgent_not_important');
    expect(classifyUrgentVsImportant('materiality_unverified', 'urgent_candidate')).toBe('insufficient_data');
  });
});

describe('calculateExecutivePriority — Hard Risk 희석 금지', () => {
  it('Hard Risk 존재 시 floor 85 강제(평균 희석 금지)', () => {
    const r = calculateExecutivePriority({ materialityScore: 10, urgencyScore: 10, hardRiskFlags: ['compliance'], blastRadiusScore: 10, confidence: 10 });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.hardRiskFloorApplied).toBe(true);
    expect(r.notExecutionOrder).toBe(true);
  });
  it('구성 요소 전부 null + Hard Risk 없음 → null(0 변환 금지)', () => {
    const r = calculateExecutivePriority({ materialityScore: null, urgencyScore: null, hardRiskFlags: [], blastRadiusScore: null, confidence: null });
    expect(r.score).toBeNull();
  });
});

describe('classifyPriorityTier', () => {
  it('Hard Risk + 긴급 → P0(즉시 사람 검토·자동 실행 아님)', () => {
    const r = classifyPriorityTier({ priorityScore: 90, hardRiskFlags: ['security'], urgencyStatus: 'urgent_candidate', materialityStatus: 'material_candidate' });
    expect(r.tier).toBe('P0_human_review_now');
    expect(r.humanReviewRequired).toBe(true);
    expect(r.autoExecution).toBe(false);
  });
  it('Hard Risk 존재 시 P3 강등 금지 — 최소 P1', () => {
    expect(classifyPriorityTier({ priorityScore: 5, hardRiskFlags: ['privacy'], urgencyStatus: 'not_urgent_candidate', materialityStatus: 'material_candidate' }).tier).toBe('P1_executive_review');
  });
  it('Score null 또는 materiality 미검증 → insufficient_data(Tier 확정 금지)', () => {
    expect(classifyPriorityTier({ priorityScore: null, hardRiskFlags: [], urgencyStatus: 'urgent_candidate', materialityStatus: 'material_candidate' }).tier).toBe('insufficient_data');
    expect(classifyPriorityTier({ priorityScore: 90, hardRiskFlags: [], urgencyStatus: 'urgent_candidate', materialityStatus: 'materiality_unverified' }).tier).toBe('insufficient_data');
  });
  it('저점수 무위험 → P3_monitor', () => {
    expect(classifyPriorityTier({ priorityScore: 10, hardRiskFlags: [], urgencyStatus: 'not_urgent_candidate', materialityStatus: 'not_material_candidate' }).tier).toBe('P3_monitor');
  });
});

describe('detectCorporateConflict — 충돌 보존', () => {
  it('공유 자원 + 근접 deadline → resource/timeline 충돌, 양쪽 보존', () => {
    const r = detectCorporateConflict(
      { id: 'a', domain: 'ops', resources: ['budget_x'], deadlineAt: new Date('2026-08-01'), direction: 'expand' },
      { id: 'b', domain: 'growth', resources: ['budget_x'], deadlineAt: new Date('2026-08-03'), direction: 'expand' },
    );
    expect(r.verdict).toBe('conflict_candidate');
    expect(r.conflictTypes).toContain('resource_conflict');
    expect(r.conflictTypes).toContain('timeline_conflict');
    expect(r.preservedSides).toEqual(['a', 'b']);
    expect(r.autoResolved).toBe(false);
  });
  it('동일 도메인 expand vs reduce → strategy_conflict / 무충돌 → no_known_conflict', () => {
    expect(detectCorporateConflict(
      { id: 'a', domain: 'cost', resources: [], deadlineAt: null, direction: 'expand' },
      { id: 'b', domain: 'cost', resources: [], deadlineAt: null, direction: 'reduce' },
    ).conflictTypes).toContain('strategy_conflict');
    expect(detectCorporateConflict(
      { id: 'a', domain: 'x', resources: ['r1'], deadlineAt: null, direction: null },
      { id: 'b', domain: 'y', resources: ['r2'], deadlineAt: null, direction: null },
    ).verdict).toBe('no_known_conflict');
  });
});

describe('detectDecisionBottleneck', () => {
  it('P0 대기/장기 대기 → material, 건수 미상 → insufficient', () => {
    expect(detectDecisionBottleneck({ pendingReviewCount: 3, oldestPendingDays: 40, p0PendingCount: 0 }).verdict).toBe('material_bottleneck');
    expect(detectDecisionBottleneck({ pendingReviewCount: 12, oldestPendingDays: 5, p0PendingCount: 0 }).verdict).toBe('bottleneck_candidate');
    expect(detectDecisionBottleneck({ pendingReviewCount: null, oldestPendingDays: null, p0PendingCount: null }).verdict).toBe('insufficient_data');
    expect(detectDecisionBottleneck({ pendingReviewCount: 1, oldestPendingDays: 2, p0PendingCount: null }).verdict).toBe('no_known_bottleneck');
  });
});

describe('calculateCorporateHealth — 점수 단독 표시 금지·critical 희석 금지', () => {
  it('Critical Risk 존재 시 점수 높아도 critical_risk_present', () => {
    const r = calculateCorporateHealth({ revenueHealth: 95, growthHealth: 95, costHealth: 95, reliabilityHealth: 95, securityHealth: 95, settlementHealth: 95, criticalRisks: ['PayApp 단일 의존'], unknownFactors: [] });
    expect(r.status).toBe('critical_risk_present');
    expect(r.criticalRisks).toHaveLength(1);
    expect(r.standaloneScoreDisplay).toBe(false);
    expect(r.limitations.length).toBeGreaterThan(0);
  });
  it('구성 요소 전부 null → insufficient_data + coverage 0', () => {
    const r = calculateCorporateHealth({ revenueHealth: null, growthHealth: null, costHealth: null, reliabilityHealth: null, securityHealth: null, settlementHealth: null, criticalRisks: [], unknownFactors: ['x'] });
    expect(r.status).toBe('insufficient_data');
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
  it('부분 구성 요소 재정규화 + coverage 반영', () => {
    const r = calculateCorporateHealth({ revenueHealth: 80, growthHealth: null, costHealth: null, reliabilityHealth: 60, securityHealth: null, settlementHealth: null, criticalRisks: [], unknownFactors: [] });
    expect(r.status).toBe('watch_candidate');
    expect(r.coverage).toBeCloseTo(33.3, 0);
    expect(r.missing).toContain('growth');
  });
});

describe('opportunity / material risk', () => {
  it('Evidence 없으면 opportunity insufficient, 충족 시 candidate(보장 아님)', () => {
    expect(detectStrategicOpportunity({ growthSignalCount: 3, positiveOutcomeCount: 2, capacityHeadroom: 50, evidence: null }).verdict).toBe('insufficient_data');
    const r = detectStrategicOpportunity({ growthSignalCount: 3, positiveOutcomeCount: 2, capacityHeadroom: 50, evidence: ['e'] });
    expect(r.verdict).toBe('opportunity_candidate');
    expect(r.guaranteed).toBe(false);
  });
  it('Hard Risk 는 금액 미상이어도 material(0 평가 금지), 금액 미상+무위험 → insufficient', () => {
    const r = detectMaterialRisk({ hardRiskFlags: ['compliance'], monetaryImpactKrw: null, mrrKrw: null, singlePointDependencies: [] });
    expect(r.verdict).toBe('material_risk_candidate');
    expect(r.nonMonetaryZeroed).toBe(false);
    expect(detectMaterialRisk({ hardRiskFlags: [], monetaryImpactKrw: null, mrrKrw: null, singlePointDependencies: [] }).verdict).toBe('insufficient_data');
  });
});

describe('buildExecutiveAttentionCandidate / DailyBriefing', () => {
  it('P0 → rank 1, tier 미확정 → 제외(사유 명시)', () => {
    const r = buildExecutiveAttentionCandidate({ code: 'P-1', tier: 'P0_human_review_now', urgentVsImportant: 'urgent_and_important', deadlineAt: new Date('2026-07-18T00:00:00Z'), now: NOW });
    expect('attentionRank' in r && r.attentionRank).toBe(1);
    const excluded = buildExecutiveAttentionCandidate({ code: 'P-2', tier: 'insufficient_data', urgentVsImportant: 'insufficient_data', deadlineAt: null, now: NOW });
    expect('excluded' in excluded && excluded.excluded).toBe(true);
  });
  it('Briefing: Evidence 없는 What Changed → 생성 금지, 정상 시 autoSent=false', () => {
    const bad = buildExecutiveDailyBriefing({ date: '2026-07-15', whatChanged: [{ title: 'x', evidence: [] }], whatMatters: [], decisionRequired: [], canWait: [], mustNotDo: [] });
    expect('insufficient' in bad && bad.insufficient).toBe(true);
    const ok = buildExecutiveDailyBriefing({ date: '2026-07-15', whatChanged: [{ title: 'MRR 하락', evidence: ['subscriptions 실측'] }], whatMatters: [{ title: 'p', tier: 'P1_executive_review' }], decisionRequired: [{ title: 'd', deadline: null }], canWait: ['w'], mustNotDo: ['자동 가격 변경'] });
    expect('autoSent' in ok && ok.autoSent).toBe(false);
    if ('sections' in ok) expect(ok.sections.mustNotDo).toContain('자동 가격 변경');
  });
});

describe('agenda / decision package / board reference', () => {
  it('Agenda: P0 → p0_immediate_review 우선, calendarCreated=false', () => {
    const r = buildExecutiveAgenda({ window: 'daily', priorities: [{ code: 'a', tier: 'P0_human_review_now' }, { code: 'b', tier: 'P1_executive_review' }], conflicts: ['c1'], risks: ['r1'] });
    expect(r.items[0]).toEqual({ kind: 'p0_immediate_review', ref: 'a' });
    expect(r.calendarCreated).toBe(false);
    expect(r.confirmedIsNotExecution).toBe(true);
  });
  it('Decision Package: no_action 옵션 자동 포함, Evidence 필수', () => {
    const r = buildDecisionPackage({ title: 't', options: [{ name: '옵션 A', expectedImpact: 'i', risks: [], evidence: ['e'] }], evidence: ['e'] });
    expect('includesNoActionOption' in r && r.includesNoActionOption).toBe(true);
    if ('options' in r) expect(r.options.some((o) => o.name.includes('no_action'))).toBe(true);
    const bad = buildDecisionPackage({ title: 't', options: [{ name: 'A', expectedImpact: 'i', risks: [], evidence: [] }], evidence: ['e'] });
    expect('insufficient' in bad).toBe(true);
  });
  it('Board Reference: 법적 자료 아님 + Material Risk 생략 금지', () => {
    const r = buildBoardReference({ period: '2026-Q3', healthStatus: 'critical_risk_present', topPriorities: ['p1'], materialRisks: ['PayApp 단일 의존'], openConflicts: [], evidence: ['e'] });
    expect('legalBoardDocument' in r && r.legalBoardDocument).toBe(false);
    if ('summary' in r) expect(r.summary.materialRisks).toContain('PayApp 단일 의존');
  });
});

describe('buildPriorityDependencyGraph — depth clamp + cycle 방어', () => {
  it('기본 depth 3, clamp 5, cycle 감지', () => {
    const edges = [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' },
      { from: 'd', to: 'e' }, { from: 'e', to: 'f' }, { from: 'f', to: 'g' }, { from: 'c', to: 'a' },
    ];
    const r = buildPriorityDependencyGraph(edges, 'a');
    expect(Math.max(...r.nodes.map((n) => n.depth))).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.cycles.some((c) => c.includes('a→b→c→a'))).toBe(true);
    const deep = buildPriorityDependencyGraph(edges, 'a', 99);
    expect(Math.max(...deep.nodes.map((n) => n.depth))).toBe(5);
  });
});

describe('conflict resolution / recommendation / outcome link / timeline', () => {
  it('Resolution: critical → escalate, 양쪽 미보존 → 거부', () => {
    const r = buildConflictResolutionCandidate({ conflictType: 'resource_conflict', severity: 'critical', bothSidesPreserved: true, evidence: ['e'] });
    expect('type' in r && r.type).toBe('escalate_to_executive');
    if ('humanApprovalRequired' in r) expect(r.humanApprovalRequired).toBe(true);
    const bad = buildConflictResolutionCandidate({ conflictType: 'resource_conflict', severity: 'high', bothSidesPreserved: false, evidence: ['e'] });
    expect('insufficient' in bad).toBe(true);
  });
  it('Recommendation: whitelist + Evidence 필수 + humanApprovalRequired', () => {
    const r = buildCorporateRecommendation({ type: 'review_p0_priority_now', rationale: 'P0 대기', evidence: ['e'], expectedBenefit: null });
    expect('humanApprovalRequired' in r && r.humanApprovalRequired).toBe(true);
    if ('expectedBenefit' in r) expect(r.expectedBenefit).toContain('미상');
    expect('rejected' in buildCorporateRecommendation({ type: 'auto_execute_everything', rationale: 'x', evidence: ['e'], expectedBenefit: null })).toBe(true);
    expect('rejected' in buildCorporateRecommendation({ type: 'review_material_risk', rationale: 'x', evidence: [], expectedBenefit: null })).toBe(true);
  });
  it('Outcome Link: 연결 ≠ 인과, 관찰 미종료 → pending', () => {
    const r = buildPriorityOutcomeLink({ priorityCode: 'p', outcomeRef: 'o-1', observationClosed: false, evidence: ['e'] });
    if ('causallyAttributed' in r) {
      expect(r.causallyAttributed).toBe(false);
      expect(r.linkStatus).toBe('outcome_pending');
    }
    expect('insufficient' in buildPriorityOutcomeLink({ priorityCode: 'p', outcomeRef: null, observationClosed: true, evidence: ['e'] })).toBe(true);
  });
  it('Timeline: 최신순 정렬 + limit/truncated', () => {
    const events = [
      { at: new Date('2026-07-01T00:00:00Z'), kind: 'signal', label: 'a' },
      { at: new Date('2026-07-10T00:00:00Z'), kind: 'priority', label: 'b' },
      { at: new Date('2026-07-05T00:00:00Z'), kind: 'conflict', label: 'c' },
    ];
    const r = buildCorporateTimeline(events, 2);
    expect(r.items.map((i) => i.label)).toEqual(['b', 'c']);
    expect(r.truncated).toBe(true);
    expect(buildCorporateTimeline(null).items).toEqual([]);
  });
});

describe('CORP_SUPPORT — 실측 기반 지원 매트릭스', () => {
  it('35개 항목 + market/calendar/report/auto_execution 은 unsupported 정직 표기', () => {
    expect(CORP_SUPPORT).toHaveLength(35);
    for (const key of ['market_data', 'calendar_integration', 'report_delivery', 'auto_execution']) {
      expect(CORP_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
    expect(CORP_SUPPORT.filter((s) => s.status === 'supported').length).toBeGreaterThan(20);
  });
});
