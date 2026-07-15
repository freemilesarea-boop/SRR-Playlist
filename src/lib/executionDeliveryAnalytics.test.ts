import { describe, expect, it } from 'vitest';
import {
  analyzeCrossCommitmentImpact,
  buildDeliveryRecommendation,
  buildExecutiveCockpit,
  buildExecutiveTimeline,
  buildStrategicExecutionGraph,
  calculateCommitmentSuccessRate,
  calculateDeliveryQuality,
  calculateDeliveryTrend,
  calculateDomainDelivery,
  calculateExecutionHealth,
  calculateExecutiveDeliveryScore,
  correlateKpi,
  DELIVERY_SUPPORT,
  detectDeliveryPattern,
  detectExecutionBottleneck,
} from './executionDeliveryAnalytics';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('success rate — 표본<5 확정 금지', () => {
  it('표본 없음 → insufficient(0 변환 없음), 표본<5 → sample_too_small', () => {
    expect(calculateCommitmentSuccessRate({ verifiedComplete: null, totalClosed: null }).rate).toBeNull();
    expect(calculateCommitmentSuccessRate({ verifiedComplete: 0, totalClosed: 0 }).status).toBe('insufficient_data');
    const small = calculateCommitmentSuccessRate({ verifiedComplete: 2, totalClosed: 3 });
    expect(small.status).toBe('sample_too_small');
    expect(small.rate).toBe(67);
    const ok = calculateCommitmentSuccessRate({ verifiedComplete: 4, totalClosed: 8 });
    expect(ok.status).toBe('measured_reference');
    expect(ok.rate).toBe(50);
    expect(ok.note).toContain('보고 완료 아님');
  });
});

describe('delivery trend', () => {
  it('구간<2 → sample_too_small/insufficient, 개선/악화/변동 분기', () => {
    expect(calculateDeliveryTrend(null).verdict).toBe('insufficient_data');
    expect(calculateDeliveryTrend([{ label: 'w1', rate: 50 }]).verdict).toBe('sample_too_small');
    expect(calculateDeliveryTrend([{ label: 'w1', rate: 40 }, { label: 'w2', rate: 60 }]).verdict).toBe('improving_candidate');
    expect(calculateDeliveryTrend([{ label: 'w1', rate: 60 }, { label: 'w2', rate: 40 }]).verdict).toBe('declining_candidate');
    expect(calculateDeliveryTrend([{ label: 'w1', rate: 20 }, { label: 'w2', rate: 80 }, { label: 'w3', rate: 25 }]).verdict).toBe('volatile_candidate');
    expect(calculateDeliveryTrend([{ label: 'w1', rate: 50 }, { label: 'w2', rate: 52 }]).verdict).toBe('stable_reference');
  });
});

describe('domain delivery / executive score', () => {
  it('domain별 rate — 종결 표본 없으면 null', () => {
    const r = calculateDomainDelivery([
      { domain: 'executive', verified: true, closed: true }, { domain: 'executive', verified: false, closed: true },
      { domain: 'security', verified: false, closed: false },
    ]);
    expect(r.find((d) => d.domain === 'executive')?.rate).toBe(50);
    expect(r.find((d) => d.domain === 'executive')?.status).toBe('sample_too_small');
    expect(r.find((d) => d.domain === 'security')?.rate).toBeNull();
    expect(calculateDomainDelivery(null)).toEqual([]);
  });
  it('executive score: 재정규화 + 인사 평가 아님 + 전부 null → null', () => {
    const r = calculateExecutiveDeliveryScore({ successRate: 80, verifiedProgressAvg: null, onScheduleRate: null, qualityScore: null });
    expect(r.score).toBe(80);
    expect(r.missing).toContain('verified_progress');
    expect(r.notPersonnelEvaluation).toBe(true);
    expect(calculateExecutiveDeliveryScore({ successRate: null, verifiedProgressAvg: null, onScheduleRate: null, qualityScore: null }).score).toBeNull();
  });
});

describe('bottleneck / pattern — 개인 단정 금지', () => {
  it('반복 단계 감지: 3+ → recurring, 5+ → critical, personBlamed=false', () => {
    expect(detectExecutionBottleneck(null).verdict).toBe('insufficient_data');
    expect(detectExecutionBottleneck([]).verdict).toBe('no_known_bottleneck');
    const r = detectExecutionBottleneck(Array.from({ length: 3 }, (_, i) => ({ stage: 'approval', commitmentCode: `c${i}` })));
    expect(r.verdict).toBe('recurring_bottleneck_candidate');
    expect(r.personBlamed).toBe(false);
    expect(detectExecutionBottleneck(Array.from({ length: 5 }, (_, i) => ({ stage: 'evidence', commitmentCode: `c${i}` }))).verdict).toBe('critical_bottleneck_candidate');
  });
  it('패턴: 표본<3 → sample_too_small, 반복 분기', () => {
    expect(detectDeliveryPattern([{ patternKind: 'delay', commitmentCode: 'c1' }, { patternKind: 'delay', commitmentCode: 'c2' }]).verdict).toBe('sample_too_small');
    const r = detectDeliveryPattern([
      { patternKind: 'delay', commitmentCode: 'c1' }, { patternKind: 'delay', commitmentCode: 'c2' }, { patternKind: 'blocker', commitmentCode: 'c3' },
    ]);
    expect(r.verdict).toBe('repeated_pattern_candidate');
    expect(r.personBlamed).toBe(false);
  });
});

describe('cross commitment — 전파 후보(확정 아님)', () => {
  it('A 지연 → B,C 누적 전파, cycle 방어, confirmedImpact=false', () => {
    const r = analyzeCrossCommitmentImpact([
      { code: 'A', delayDays: 5, dependsOn: null },
      { code: 'B', delayDays: 2, dependsOn: 'A' },
      { code: 'C', delayDays: null, dependsOn: 'B' },
    ]);
    expect(r.impacted.find((x) => x.code === 'B')?.upstreamDelay).toBe(5);
    expect(r.impacted.find((x) => x.code === 'C')?.upstreamDelay).toBe(7);
    expect(r.confirmedImpact).toBe(false);
    expect(r.causallyAttributed).toBe(false);
    const cyclic = analyzeCrossCommitmentImpact([{ code: 'A', delayDays: 3, dependsOn: 'B' }, { code: 'B', delayDays: 2, dependsOn: 'A' }]);
    expect(cyclic.impacted.length).toBe(2);   // 무한 루프 없이 종료
  });
});

describe('execution graph / timeline', () => {
  it('7단계 그룹 + orphan edge + cycle 감지', () => {
    const r = buildStrategicExecutionGraph(
      [{ id: 'd1', stage: 'decision', label: 'D', ref: null }, { id: 'c1', stage: 'commitment', label: 'C', ref: null }, { id: 'x', stage: 'bogus', label: 'X', ref: null }],
      [{ from: 'd1', to: 'c1' }, { from: 'c1', to: 'd1' }, { from: 'd1', to: 'ghost' }],
    );
    expect(r.stages.find((s) => s.stage === 'decision')?.nodes).toHaveLength(1);
    expect(r.stages.find((s) => s.stage === 'commitment')?.nodes).toHaveLength(1);
    expect(r.orphanEdges).toContain('d1→ghost');
    expect(r.cycles.length).toBeGreaterThan(0);
  });
  it('timeline: 오늘/주/월/분기/연 버킷', () => {
    const r = buildExecutiveTimeline([
      { at: new Date('2026-07-14T20:00:00Z'), kind: 'a', label: '오늘' },
      { at: new Date('2026-07-10T00:00:00Z'), kind: 'b', label: '이번주' },
      { at: new Date('2026-06-20T00:00:00Z'), kind: 'c', label: '이번달' },
      { at: new Date('2026-05-01T00:00:00Z'), kind: 'd', label: '분기' },
      { at: new Date('2025-09-01T00:00:00Z'), kind: 'e', label: '연간' },
    ], NOW);
    expect(r.today).toBe(1);
    expect(r.thisWeek).toBe(2);
    expect(r.thisMonth).toBe(3);
    expect(r.thisQuarter).toBe(4);
    expect(r.thisYear).toBe(5);
  });
});

describe('delivery quality / KPI correlation', () => {
  it('quality: 완료율 단독 아님 — 4성분 재정규화, 전부 null → null', () => {
    const r = calculateDeliveryQuality({ evidenceCoverage: 80, verificationCoverage: null, reviewerIndependence: null, accountabilityCoverage: null });
    expect(r.score).toBe(80);
    expect(r.completionRateOnly).toBe(false);
    expect(calculateDeliveryQuality({ evidenceCoverage: null, verificationCoverage: null, reviewerIndependence: null, accountabilityCoverage: null }).score).toBeNull();
  });
  it('KPI 없음 → kpi_unavailable, 표본<5 → sample_too_small, 상관 ≠ 인과', () => {
    expect(correlateKpi({ deliverySeries: [1, 2], kpiSeries: [1, 2], kpiAvailable: false }).verdict).toBe('kpi_unavailable');
    expect(correlateKpi({ deliverySeries: [1, 2, 3], kpiSeries: [1, 2, 3], kpiAvailable: true }).verdict).toBe('sample_too_small');
    const pos = correlateKpi({ deliverySeries: [10, 20, 30, 40, 50, 60], kpiSeries: [1, 2, 3, 4, 5, 6], kpiAvailable: true });
    expect(pos.verdict).toBe('positive_candidate');
    expect(pos.causallyAttributed).toBe(false);
    expect(pos.note).toContain('0517');
    const neg = correlateKpi({ deliverySeries: [60, 50, 40, 30, 20, 10], kpiSeries: [1, 2, 3, 4, 5, 6], kpiAvailable: true });
    expect(neg.verdict).toBe('negative_candidate');
  });
});

describe('execution health — Critical Risk 희석 금지·점수 단독 금지', () => {
  it('Critical Risk 존재 시 점수 높아도 critical_risk_present', () => {
    const r = calculateExecutionHealth({ deliveryHealth: 95, executionStability: 95, throughput: 95, reviewLatency: 95, evidenceCoverage: 95, completionQuality: 95, accountabilityCoverage: 95, deliveryConfidence: 95, strategicProgress: 95, criticalRisks: ['Hard Security Blocker 미해결'] });
    expect(r.status).toBe('critical_risk_present');
    expect(r.standaloneScoreDisplay).toBe(false);
  });
  it('전부 null → insufficient + coverage 0, 부분 재정규화', () => {
    const empty = calculateExecutionHealth({ deliveryHealth: null, executionStability: null, throughput: null, reviewLatency: null, evidenceCoverage: null, completionQuality: null, accountabilityCoverage: null, deliveryConfidence: null, strategicProgress: null, criticalRisks: [] });
    expect(empty.status).toBe('insufficient_data');
    expect(empty.coverage).toBe(0);
    const partial = calculateExecutionHealth({ deliveryHealth: 80, executionStability: null, throughput: null, reviewLatency: null, evidenceCoverage: 60, completionQuality: null, accountabilityCoverage: null, deliveryConfidence: null, strategicProgress: null, criticalRisks: [] });
    expect(partial.status).toBe('watch_candidate');
    expect(partial.missing).toContain('throughput');
  });
});

describe('cockpit / recommendation / support', () => {
  it('cockpit: 8영역 + autoExecution=false + 정직 문구', () => {
    const r = buildExecutiveCockpit({
      strategy: { openPriorities: 3, selectedPortfolios: 1 },
      commitments: { total: 5, active: 2, blocked: 1 },
      delivery: { rate: 60, rateStatus: 'sample_too_small' },
      businessImpact: { outcomesObserved: 0, kpiCorrelations: 0 },
      health: { score: null, status: 'insufficient_data' },
      risks: ['단일 Admin'],
    });
    expect(r.sections).toHaveLength(8);
    expect(r.autoExecution).toBe(false);
    expect(r.sections.find((s) => s.key === 'delivery')?.headline).toContain('sample_too_small');
    expect(r.sections.find((s) => s.key === 'business_impact')?.detail).toContain('상관 ≠ 인과');
  });
  it('recommendation: whitelist + Evidence 필수 + 사람 승인', () => {
    expect('rejected' in buildDeliveryRecommendation({ type: 'auto_fix_delivery', reason: 'x', evidence: ['e'], severity: 'high' })).toBe(true);
    expect('rejected' in buildDeliveryRecommendation({ type: 'review_recurring_bottleneck', reason: 'x', evidence: [], severity: 'high' })).toBe(true);
    const r = buildDeliveryRecommendation({ type: 'review_recurring_bottleneck', reason: 'approval 단계 반복', evidence: ['e'], severity: 'high' });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
    }
  });
  it('DELIVERY_SUPPORT: 26항목 + CSAT/자동 실행류 unsupported 정직 표기', () => {
    expect(DELIVERY_SUPPORT).toHaveLength(26);
    for (const key of ['kpi_csat', 'auto_work_assignment', 'auto_kpi_change', 'auto_owner_change', 'production_apply']) {
      expect(DELIVERY_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
    expect(DELIVERY_SUPPORT.filter((s) => s.status === 'supported').length).toBeGreaterThan(15);
  });
});
