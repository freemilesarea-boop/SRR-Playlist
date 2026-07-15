import { describe, expect, it } from 'vitest';
import {
  analyzeControlEffectiveness,
  buildRiskBriefing,
  buildRiskCockpit,
  buildRiskDependencyGraph,
  buildRiskRecommendation,
  buildRiskTimeline,
  computeRiskHeat,
  evaluateContinuity,
  evaluateRecoveryReadiness,
  evaluateResilience,
  RISK_SUPPORT,
} from './riskResilience';

describe('heatmap — Likelihood ≠ Reality', () => {
  it('null 유지 → risk_unverified, 조합 분류(low/medium/high/critical)', () => {
    expect(computeRiskHeat({ likelihood: null, impact: 3 }).verdict).toBe('risk_unverified');
    expect(computeRiskHeat({ likelihood: 1, impact: 2 }).heat).toBe('low');
    expect(computeRiskHeat({ likelihood: 2, impact: 3 }).heat).toBe('medium');
    expect(computeRiskHeat({ likelihood: 3, impact: 4 }).heat).toBe('high');
    const c = computeRiskHeat({ likelihood: 5, impact: 4 });
    expect(c.heat).toBe('critical');
    expect(c.score).toBe(20);
    expect(c.likelihoodIsNotReality).toBe(true);
    expect(computeRiskHeat({ likelihood: 9, impact: 4 }).verdict).toBe('risk_unverified');
  });
});

describe('dependency — 인과 확정 아님', () => {
  it('edges/isolated/cycle 감지 + notCausalConfirmation', () => {
    const r = buildRiskDependencyGraph([
      { id: 'a', code: 'R-A', linkedRiskIds: ['b'] },
      { id: 'b', code: 'R-B', linkedRiskIds: ['a'] },   // cycle
      { id: 'c', code: 'R-C', linkedRiskIds: [] },      // isolated
    ]);
    expect(r.edges).toHaveLength(2);
    expect(r.isolated).toContain('R-C');
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.notCausalConfirmation).toBe(true);
    expect(buildRiskDependencyGraph(null).edges).toEqual([]);
  });
});

describe('timeline — 5단계 기록(완료 보장 아님)', () => {
  it('stage whitelist + 시간순 정렬 + invalid 집계', () => {
    const r = buildRiskTimeline([
      { stage: 'mitigation', at: new Date('2026-07-02'), note: 'm' },
      { stage: 'detection', at: new Date('2026-07-01'), note: 'd' },
      { stage: 'bogus', at: new Date('2026-07-03'), note: 'x' },
    ]);
    expect(r.stages).toHaveLength(5);
    expect(r.stages.find((s) => s.stage === 'detection')?.entries).toHaveLength(1);
    expect(r.invalidStages).toBe(1);
    expect(r.stageCompletionGuarantee).toBe(false);
  });
});

describe('continuity — Zero Downtime 아님', () => {
  it('proxy 계산 + APM/운영 원본 없는 segment 는 insufficient', () => {
    const r = evaluateContinuity({ playStarts: 1000, playerErrors: 10, incidentsOpen: 2, storesActive: 5 });
    expect(r.availabilityProxyPct).toBe(99);
    expect(r.verdict).toBe('partial_measured');
    expect(r.segments).toHaveLength(5);
    expect(r.segments.find((s) => s.key === 'platform_availability')?.status).toBe('insufficient_data');
    expect(r.continuityIsNotZeroDowntime).toBe(true);
    expect(evaluateContinuity({ playStarts: null, playerErrors: null, incidentsOpen: null, storesActive: null }).verdict).toBe('insufficient_data');
  });
});

describe('resilience — Evidence 없는 컴포넌트 점수 제외', () => {
  it('overall 은 Evidence 있는 컴포넌트 평균, scoreOnlyReturn=false', () => {
    const r = evaluateResilience([
      { component: 'detection_readiness', score: 80, evidence: ['0507 indicators'] },
      { component: 'recovery_readiness', score: 60, evidence: [] },   // 제외
      { component: 'monitoring_coverage', score: 60, evidence: ['snapshots'] },
    ]);
    expect(r.overall).toBe(70);
    expect(r.byComponent.find((c) => c.component === 'recovery_readiness')?.score).toBeNull();
    expect(r.missingComponents).toContain('recovery_readiness');
    expect(r.unknownFactors.some((u) => u.includes('recovery_readiness'))).toBe(true);
    expect(r.scoreOnlyReturn).toBe(false);
    expect(evaluateResilience([]).overall).toBeNull();
  });
});

describe('controls / recovery readiness', () => {
  it('control: Evidence 있는 control 만 coverage 계산 + 제거 보장 아님', () => {
    const r = analyzeControlEffectiveness({
      risks: [{ id: 'a', code: 'R-A' }, { id: 'b', code: 'R-B' }],
      controls: [
        { name: 'C1', coveredRiskIds: ['a'], evidence: ['e'] },
        { name: 'C2', coveredRiskIds: ['b'], evidence: [] },   // 미검증 → coverage 제외
      ],
    });
    expect(r.coveragePct).toBe(50);
    expect(r.uncontrolledRisks).toContain('R-B');
    expect(r.unverifiedControls).toContain('C2');
    expect(r.controlIsNotElimination).toBe(true);
  });
  it('recovery: 검증 Evidence 없으면 validation_unverified + Plan ≠ Success', () => {
    expect(evaluateRecoveryReadiness({ playbooksReference: null, playbooksDraft: null, recoveryCandidates: null, validationEvidence: [] }).verdict).toBe('insufficient_data');
    const unv = evaluateRecoveryReadiness({ playbooksReference: 2, playbooksDraft: 1, recoveryCandidates: 3, validationEvidence: [] });
    expect(unv.verdict).toBe('validation_unverified');
    expect(unv.components.find((c) => c.key === 'backup_readiness')?.value).toBeNull();
    const ok = evaluateRecoveryReadiness({ playbooksReference: 2, playbooksDraft: 1, recoveryCandidates: 3, validationEvidence: ['검증 기록'] });
    expect(ok.verdict).toBe('readiness_candidate');
    expect(ok.recoveryPlanIsNotSuccess).toBe(true);
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음', () => {
    const r = buildRiskBriefing({ periodKind: 'today', newRisks: ['r'], changedRisks: [], recoveryStatus: ['ok'], unknownFactors: ['u'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(buildRiskBriefing({ periodKind: 'hourly', newRisks: [], changedRisks: [], recoveryStatus: [], unknownFactors: [], recommendations: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Operational Decision', () => {
    expect('rejected' in buildRiskRecommendation({ type: 'auto_resolve_risk', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildRiskRecommendation({ type: 'review_risk', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildRiskRecommendation({ type: 'prepare_recovery', reason: 'playbook 검증 없음', evidence: ['recovery'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Operational Decision');
    }
  });
  it('cockpit: 7영역 + riskAutoResolved=false', () => {
    const r = buildRiskCockpit({ registerTotal: 3, heatCritical: 1, dependencyEdges: 2, continuityVerdict: 'partial_measured', resilienceOverall: null, recoveryVerdict: 'validation_unverified', summaryNote: null });
    expect(r.sections).toHaveLength(7);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.riskAutoResolved).toBe(false);
    expect(r.sections.find((s) => s.key === 'resilience')?.headline).toBe('insufficient_data');
  });
  it('RISK_SUPPORT: 16항목 + APM/백업/자동화 unsupported', () => {
    expect(RISK_SUPPORT).toHaveLength(16);
    for (const key of ['platform_availability', 'backup_readiness', 'auto_incident_creation', 'auto_policy_change']) {
      expect(RISK_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
