// Phase AI-OPS-4 — Reliability Governance 순수 로직 단위 테스트.
// SLI(0 나눗셈/null→0 없음) · Coverage · SLO Compliance(소급 금지) · Error Budget(허용 0 방어) ·
// Burn Rate/Multi-Window(단기 spike 단독 Freeze 없음) · Change Correlation(인과 단정 없음) ·
// Release Risk(재정규화/자동 차단 없음) · Freeze 권고(실행 없음) · Velocity(DORA 주장 없음) ·
// Reliability Certification(자동 인증 없음) · Policy Versioning · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  validateSliDefinition, calculateSli, calculateDataCoverage, evaluateSloCompliance,
  calculateErrorBudget, calculateBurnRate, classifyBurnRate, evaluateMultiWindowBurn,
  correlateChangeWithReliability, calculateReleaseRisk, classifyReleaseRisk,
  assessFreezeRecommendation, validateFreezeReference, isFreezeReferenceExpired,
  calculateChangeVelocity, evaluateReliabilityCertification, validatePolicyVersion,
  buildReliabilityPackage, RELIABILITY_DOMAINS, REL_SUPPORT, COMPLIANCE_WINDOWS, UNSUPPORTED_WINDOWS,
  type SloComplianceInput, type FreezeInput, type ReliabilityCertInput, type ReleaseRiskComponents,
} from './reliabilityGovernance';

describe('SLI 정의/계산', () => {
  it('실측 metric whitelist — telemetry 없는 SLI 생성 금지', () => {
    expect(validateSliDefinition({ indicator_code: 'x', domain: 'playback', metric_code: 'player_error_free_ratio', good_event_definition: 'g', total_event_definition: 't', source_type: 's' })).toEqual([]);
    expect(validateSliDefinition({ indicator_code: 'x', domain: 'queue', metric_code: 'queue_stall_free_ratio', good_event_definition: 'g', total_event_definition: 't', source_type: 's' }).some((e) => e.includes('Telemetry'))).toBe(true);
    expect(validateSliDefinition(null)).toEqual(['SLI 정의 없음']);
  });
  it('Good/Total 계산 · Total 0 나눗셈 방어 · null→0 없음 · NaN 방어', () => {
    expect(calculateSli(99, 100)).toBe(99);
    expect(calculateSli(0, 100)).toBe(0);
    expect(calculateSli(50, 0)).toBeNull();
    expect(calculateSli(null, 100)).toBeNull();
    expect(calculateSli(NaN, 100)).toBeNull();
    expect(calculateSli(Infinity, 100)).toBeNull();
  });
});

describe('Data Coverage(공백을 정상으로 계산 안 함)', () => {
  it('complete/sufficient/partial/data_gap/insufficient', () => {
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: 24 }).result).toBe('complete');
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: 20 }).result).toBe('sufficient');
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: 14 }).result).toBe('partial');
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: 5 }).result).toBe('data_gap');
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: null }).result).toBe('insufficient_data');
  });
  it('telemetry 지연 시 complete 로 판정하지 않음', () => {
    expect(calculateDataCoverage({ expectedIntervals: 24, observedIntervals: 24, telemetryDelayed: true }).result).toBe('partial');
  });
});

describe('SLO Compliance', () => {
  const IN = (over: Partial<SloComplianceInput> = {}): SloComplianceInput => ({
    targetPct: 99, actualSliPct: 99.5, sampleSize: 500, minSample: 50, coveragePct: 95, minCoveragePct: 50,
    window: 'rolling_24h', windowDataAvailable: true, ...over,
  });
  it('Meeting / Breached / At-Risk(budget 75%+)', () => {
    expect(evaluateSloCompliance(IN()).compliance).toBe('meeting');
    expect(evaluateSloCompliance(IN({ actualSliPct: 98.5 })).compliance).toBe('breached');
    expect(evaluateSloCompliance(IN({ actualSliPct: 99.2 })).compliance).toBe('at_risk'); // budget 1% 중 0.8% 소진
  });
  it('Data Gap / Insufficient(sample·SLI null) / Unsupported window / Invalid target', () => {
    expect(evaluateSloCompliance(IN({ coveragePct: 30 })).compliance).toBe('data_gap');
    expect(evaluateSloCompliance(IN({ sampleSize: 10 })).compliance).toBe('insufficient_data');
    expect(evaluateSloCompliance(IN({ actualSliPct: null })).compliance).toBe('insufficient_data');
    expect(evaluateSloCompliance(IN({ window: 'calendar_month' })).compliance).toBe('unsupported');
    expect(evaluateSloCompliance(IN({ targetPct: 120 })).compliance).toBe('invalid');
  });
  it('장기 데이터 없으면 장기 달성으로 해석하지 않음(28d)', () => {
    const r = evaluateSloCompliance(IN({ window: 'rolling_28d', windowDataAvailable: false }));
    expect(r.compliance).toBe('insufficient_data');
    expect(r.reasons[0]).toContain('장기');
  });
});

describe('Error Budget(실행 권한 아님)', () => {
  it('정상 계산 · healthy/caution/low/exhausted', () => {
    const b = calculateErrorBudget({ targetPct: 99, actualSliPct: 99.6 });
    expect(b.budgetTotalPct).toBe(1); expect(b.consumedPct).toBe(0.4); expect(b.consumptionPct).toBe(40); expect(b.status).toBe('healthy');
    expect(calculateErrorBudget({ targetPct: 99, actualSliPct: 99.4 }).status).toBe('caution');
    expect(calculateErrorBudget({ targetPct: 99, actualSliPct: 99.2 }).status).toBe('low');
    expect(calculateErrorBudget({ targetPct: 99, actualSliPct: 98.5 }).status).toBe('exhausted');
  });
  it('Allowed Error 0(target 100%) → 나눗셈하지 않음 · coverage 부족 → data_gap · invalid target', () => {
    const b = calculateErrorBudget({ targetPct: 100, actualSliPct: 99.9 });
    expect(b.consumptionPct).toBeNull(); expect(b.status).toBe('exhausted'); // 오류 존재 시
    expect(calculateErrorBudget({ targetPct: 100, actualSliPct: 100 }).status).toBe('healthy');
    expect(calculateErrorBudget({ targetPct: 99, actualSliPct: 99.5, coverageOk: false }).status).toBe('data_gap');
    expect(calculateErrorBudget({ targetPct: NaN, actualSliPct: 99 }).status).toBe('insufficient_data');
  });
  it('Error Budget 은 실행 권한이 아님(상수)', () => {
    expect(calculateErrorBudget({ targetPct: 99, actualSliPct: 100 }).notExecutionAuthority).toBe(true);
  });
});

describe('Burn Rate', () => {
  it('계산 · Baseline(허용 오류) 0 방어 · null 안전', () => {
    expect(calculateBurnRate(2, 1)).toBe(2);
    expect(calculateBurnRate(2, 0)).toBeNull();
    expect(calculateBurnRate(null, 1)).toBeNull();
    expect(calculateBurnRate(NaN, 1)).toBeNull();
  });
  it('Normal/Elevated/Fast/Severe/Exhausted/insufficient/invalid', () => {
    expect(classifyBurnRate(0.5)).toBe('normal');
    expect(classifyBurnRate(1.5)).toBe('elevated');
    expect(classifyBurnRate(5)).toBe('fast_burn');
    expect(classifyBurnRate(12)).toBe('severe_burn');
    expect(classifyBurnRate(0.5, { budgetExhausted: true })).toBe('exhausted');
    expect(classifyBurnRate(null)).toBe('insufficient_data');
    expect(classifyBurnRate(-1)).toBe('invalid');
  });
  it('Multi-Window — 단기 Spike 단독은 transient(전체 Freeze 권고 아님) · 동시 초과 critical', () => {
    expect(evaluateMultiWindowBurn({ shortBurn: 'severe_burn', longBurn: 'normal' }).result).toBe('transient_spike');
    expect(evaluateMultiWindowBurn({ shortBurn: 'elevated', longBurn: 'elevated' }).result).toBe('sustained_burn');
    expect(evaluateMultiWindowBurn({ shortBurn: 'severe_burn', longBurn: 'fast_burn' }).result).toBe('critical_burn');
    expect(evaluateMultiWindowBurn({ shortBurn: 'normal', longBurn: 'normal' }).result).toBe('stable');
    expect(evaluateMultiWindowBurn({ shortBurn: 'insufficient_data', longBurn: 'normal' }).result).toBe('insufficient_data');
    expect(evaluateMultiWindowBurn({ shortBurn: 'normal', longBurn: 'normal', dataDelayed: true }).result).toBe('insufficient_data');
  });
});

describe('Change Correlation(인과 단정 없음)', () => {
  const CHANGE = { executedAt: '2026-07-14T00:00:00Z', scopeKeys: ['store:a'], version: 'v1' };
  it('Time/Scope/Release/Possible/Unrelated/Insufficient', () => {
    expect(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-14T03:00:00Z', scopeKeys: ['store:z'], version: null }).correlation).toBe('temporally_correlated');
    expect(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-20T00:00:00Z', scopeKeys: ['store:a'], version: null }).correlation).toBe('scope_correlated');
    expect(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-20T00:00:00Z', scopeKeys: ['store:z'], version: 'v1' }).correlation).toBe('release_correlated');
    expect(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-14T03:00:00Z', scopeKeys: ['store:a'], version: null }).correlation).toBe('possibly_related');
    expect(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-20T00:00:00Z', scopeKeys: ['store:z'], version: 'v2' }).correlation).toBe('unrelated');
    expect(correlateChangeWithReliability({ ...CHANGE, executedAt: null }, { startedAt: 't', scopeKeys: [], version: null }).correlation).toBe('insufficient_data');
  });
  it('결과에 인과 단정 문자열 없음', () => {
    expect(JSON.stringify(correlateChangeWithReliability(CHANGE, { startedAt: '2026-07-14T01:00:00Z', scopeKeys: ['store:a'], version: 'v1' }))).not.toMatch(/caused|causation|인과/);
  });
});

describe('Release Risk', () => {
  const FULL: ReleaseRiskComponents = {
    sloComplianceRisk: 10, errorBudgetRisk: 10, shortBurnRisk: 10, longBurnRisk: 10, incidentRisk: 10, regressionRisk: 10,
    certificationRisk: 10, changeFrequencyRisk: 10, uncertifiedChangeRisk: 10, monitoringCoverageRisk: 10, rollbackReadinessRisk: 10, governanceRisk: 10,
  };
  const CTX = { criticalSloBreached: false, budgetExhausted: false, sustainedSevereBurn: false, activeCriticalIncident: false, recentNotCertified: false, monitoringGapWithHighRiskChange: false };
  it('Low/Moderate/High/Critical 밴드 · 없는 성분 재정규화', () => {
    expect(classifyReleaseRisk(calculateReleaseRisk(FULL).score, CTX).status).toBe('low');
    const partial = calculateReleaseRisk({ ...FULL, shortBurnRisk: null, longBurnRisk: null });
    expect(partial.availableComponents).toBe(10);
    expect(partial.score).toBe(10); // 남은 성분 전부 10 → 재정규화해도 10
    const high: ReleaseRiskComponents = { ...FULL, sloComplianceRisk: 90, errorBudgetRisk: 90, incidentRisk: 90, regressionRisk: 90, longBurnRisk: 90 };
    expect(classifyReleaseRisk(calculateReleaseRisk(high).score, CTX).status).toBe('high'); // 가중 60점대
  });
  it('전 성분 null → insufficient_data', () => {
    const empty = Object.fromEntries(Object.keys(FULL).map((k) => [k, null])) as unknown as ReleaseRiskComponents;
    expect(calculateReleaseRisk(empty).score).toBeNull();
    expect(classifyReleaseRisk(null, CTX).status).toBe('insufficient_data');
  });
  it('Critical 조건 우선(incident/not_certified/monitoring gap) · 자동 차단 없음', () => {
    const r = classifyReleaseRisk(5, { ...CTX, activeCriticalIncident: true });
    expect(r.status).toBe('critical'); expect(r.noAutoBlock).toBe(true);
    expect(classifyReleaseRisk(5, { ...CTX, recentNotCertified: true }).status).toBe('critical');
    expect(classifyReleaseRisk(5, { ...CTX, monitoringGapWithHighRiskChange: true }).status).toBe('critical');
  });
});

describe('Freeze Recommendation(자동 Freeze 없음)', () => {
  const IN = (over: Partial<FreezeInput> = {}): FreezeInput => ({
    dataSufficient: true, sloBreached: false, criticalSloBreached: false, budgetExhausted: false, budgetLow: false,
    multiWindowBurn: 'stable', activeCriticalIncident: false, recentCertificationFailed: false, monitoringGap: false, rollbackIncomplete: false, governanceWarning: false, ...over,
  });
  it('No Freeze / Monitor / Recommended / Critical / Manual Review / Insufficient', () => {
    expect(assessFreezeRecommendation(IN()).recommendation).toBe('no_freeze_needed');
    expect(assessFreezeRecommendation(IN({ budgetLow: true })).recommendation).toBe('monitor_before_change');
    expect(assessFreezeRecommendation(IN({ multiWindowBurn: 'transient_spike' })).recommendation).toBe('monitor_before_change'); // 단기 spike 단독 → Freeze 아님
    expect(assessFreezeRecommendation(IN({ sloBreached: true })).recommendation).toBe('freeze_recommended');
    expect(assessFreezeRecommendation(IN({ budgetExhausted: true })).recommendation).toBe('critical_freeze_recommended');
    expect(assessFreezeRecommendation(IN({ monitoringGap: true })).recommendation).toBe('manual_review_required');
    expect(assessFreezeRecommendation(IN({ dataSufficient: false })).recommendation).toBe('insufficient_data');
  });
  it('항상 executionBlocked + 사람 결정 필요 명시', () => {
    const r = assessFreezeRecommendation(IN({ criticalSloBreached: true }));
    expect(r.executionBlocked).toBe(true);
    expect(r.reasons.some((x) => x.includes('실행하지 않는다'))).toBe(true);
  });
  it('External Freeze Reference — 필수 필드 · 동작 자동 단정 없음 · Expiration', () => {
    expect(validateFreezeReference(null).errors.length).toBeGreaterThan(0);
    const ok = validateFreezeReference({ external_freeze_id: 'FRZ-1', freeze_scope: 'all', freeze_started_at: 't', applied_by: 'ops', external_system: 'github' });
    expect(ok.errors).toEqual([]); expect(ok.appliedNotVerified).toBe(true);
    const now = new Date('2026-07-14T12:00:00Z');
    expect(isFreezeReferenceExpired({ freeze_expires_at: '2026-07-13T00:00:00Z' }, now)).toBe(true);
    expect(isFreezeReferenceExpired({ freeze_expires_at: '2026-07-20T00:00:00Z' }, now)).toBe(false);
    expect(isFreezeReferenceExpired({ freeze_expires_at: null }, now)).toBeNull();
  });
});

describe('Change Velocity(DORA 주장 없음)', () => {
  it('count/ratio/평균 관측·인증 시간', () => {
    const v = calculateChangeVelocity({ totalChanges: 10, highRiskChanges: 2, certified: 6, failed: 2, rollbackRequested: 1, observationHours: [24, 48], certificationHours: [72] });
    expect(v.certifiedRatioPct).toBe(60); expect(v.failedRatioPct).toBe(20); expect(v.rollbackRatioPct).toBe(10);
    expect(v.meanObservationHours).toBe(36); expect(v.meanCertificationHours).toBe(72);
    expect(v.status).toBe('available'); expect(v.doraClaim).toBe(false);
  });
  it('표본 부족 → insufficient_data · 0건 → ratio null(0 조작 없음)', () => {
    const v = calculateChangeVelocity({ totalChanges: 0, highRiskChanges: 0, certified: 0, failed: 0, rollbackRequested: 0, observationHours: [], certificationHours: [] });
    expect(v.status).toBe('insufficient_data');
    expect(v.certifiedRatioPct).toBeNull(); expect(v.meanObservationHours).toBeNull();
  });
});

describe('Reliability Certification(자동 인증 없음)', () => {
  const IN = (over: Partial<ReliabilityCertInput> = {}): ReliabilityCertInput => ({
    dataSufficient: true, requiredSlosMeeting: true, criticalSloBreached: false, budgetExhausted: false,
    sustainedCriticalBurn: false, activeCriticalIncident: false, uncertifiedHighRiskChanges: 0,
    coverageSufficient: true, humanReviewed: true, evidenceComplete: true, warningSignals: 0, ...over,
  });
  it('Certified / with Conditions / At Risk / Not Certified / Insufficient / Invalidated', () => {
    expect(evaluateReliabilityCertification(IN()).result).toBe('reliability_certified');
    expect(evaluateReliabilityCertification(IN({ warningSignals: 2 })).result).toBe('reliability_certified_with_conditions');
    expect(evaluateReliabilityCertification(IN({ requiredSlosMeeting: false })).result).toBe('reliability_at_risk');
    expect(evaluateReliabilityCertification(IN({ humanReviewed: false })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ dataSufficient: false })).result).toBe('insufficient_data');
    expect(evaluateReliabilityCertification(IN({ invalidated: true })).result).toBe('invalidated');
  });
  it('Critical SLO/Budget/Burn/Incident/미인증 High Risk/Coverage 차단', () => {
    expect(evaluateReliabilityCertification(IN({ criticalSloBreached: true })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ budgetExhausted: true })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ sustainedCriticalBurn: true })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ activeCriticalIncident: true })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ uncertifiedHighRiskChanges: 1 })).result).toBe('reliability_not_certified');
    expect(evaluateReliabilityCertification(IN({ coverageSufficient: false })).result).toBe('insufficient_data');
    expect(evaluateReliabilityCertification(IN({ evidenceComplete: false })).result).toBe('reliability_not_certified');
  });
  it('모든 판정에 사람 확정 필요(자동 Certification 없음)', () => {
    const r = evaluateReliabilityCertification(IN());
    expect(r.requiresHumanApproval).toBe(true);
    expect(r.reasons.some((x) => x.includes('자동 인증 없음'))).toBe(true);
  });
});

describe('Policy Versioning(소급 금지) / Package / Support Matrix', () => {
  it('version/change_reason/checksum 필수 · 과거 기간 소급 적용 차단', () => {
    const p = { version: 2, effective_from: '2026-07-10T00:00:00Z', effective_to: null, change_reason: 'r', approved_by: 'a', checksum: 'c' };
    expect(validatePolicyVersion(p)).toEqual([]);
    expect(validatePolicyVersion({ ...p, change_reason: null }).some((e) => e.includes('change_reason'))).toBe(true);
    const retro = validatePolicyVersion(p, { start: '2026-07-01T00:00:00Z', end: '2026-07-05T00:00:00Z' });
    expect(retro.some((e) => e.includes('소급'))).toBe(true);
    expect(validatePolicyVersion(p, { start: '2026-07-11T00:00:00Z', end: '2026-07-12T00:00:00Z' })).toEqual([]);
  });
  it('Reliability Package 필수 섹션', () => {
    const pkg = buildReliabilityPackage({ domain: 'playback', indicator: 'x', window: 'rolling_24h', target: 99, actual: null, budget: null, burn: null, risk: null, freeze: 'freeze_recommended', certification: null, limitations: ['l'] });
    const sections = pkg.map((p) => p.section);
    for (const s of ['SLO Target', 'Actual SLI (실측)', 'Error Budget', 'Burn Rate', 'Release Risk', 'Freeze Recommendation', 'Certification', 'Limitations']) expect(sections).toContain(s);
    expect(String(pkg.find((p) => p.section === 'Freeze Recommendation')!.content)).toContain('실행 아님');
    expect(pkg.find((p) => p.section === 'Actual SLI (실측)')!.content).toBe('insufficient_data'); // null → 0 조작 없음
  });
  it('Domain/Support Matrix — Streaming/Queue/Scheduler/API/DB unsupported · 자동 Freeze/Rollback/Apply unsupported', () => {
    for (const d of ['streaming_quality', 'queue', 'scheduler', 'api', 'database']) {
      expect(RELIABILITY_DOMAINS.find((x) => x.domain === d)!.status).toBe('unsupported');
    }
    expect(RELIABILITY_DOMAINS.find((x) => x.domain === 'availability')!.status).toBe('provisional'); // 기간형 uptime 미지원
    expect(REL_SUPPORT.find((s) => s.key === 'automatic_freeze')!.status).toBe('unsupported');
    expect(REL_SUPPORT.find((s) => s.key === 'automatic_rollback')!.status).toBe('unsupported');
    expect(REL_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(REL_SUPPORT.find((s) => s.key === 'freeze_reference')!.status).toBe('evidence_only');
    expect(COMPLIANCE_WINDOWS).toContain('rolling_24h');
    expect(UNSUPPORTED_WINDOWS).toContain('calendar_month'); // 지원 주장 안 함
  });
});
