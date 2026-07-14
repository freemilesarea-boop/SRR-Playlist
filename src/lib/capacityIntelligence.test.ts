// Phase AI-OPS-5 — Capacity Intelligence 순수 로직 단위 테스트.
// Metric whitelist/음수·NaN 차단 · Baseline(7일 미만 30d 없음) · Trend(단일 Spike 방어) ·
// Forecast(deterministic·Actual 분리·limit 없는 Exhaustion 금지) · Headroom(limit_unknown) ·
// Saturation(재정규화) · Exhaustion(성장 0/음수 방어) · Cost(단가 없으면 cost_unknown·
// Actual/Estimated 분리) · Recommendation/Plan(실행 없음) · SPOF · Continuity · Scenario.
import { describe, it, expect } from 'vitest';
import {
  validateCapacityMetric, calculateUsageBaseline, calculateDemandTrend, forecastDemand,
  calculateHeadroom, calculateUtilization, estimateTimeToExhaustion, calculateSaturationRisk,
  validateCostModel, calculateEstimatedCost, forecastCost, calculateUnitEconomics, detectCostAnomaly,
  buildCapacityRecommendation, validateScalingPlan, detectSinglePointOfFailure,
  evaluateContinuityReadiness, evaluateCapacityStressScenario, evaluateContinuityScenario,
  buildCapacityPackage, CAPACITY_DOMAINS, CAP_SUPPORT, PLAN_STATUSES, FORBIDDEN_PLAN_STATUSES,
  type DailyUsagePoint, type SaturationComponents, type DependencyLike,
} from './capacityIntelligence';

const SERIES = (values: number[]): DailyUsagePoint[] => values.map((v, i) => ({ day: `2026-06-${String(i + 1).padStart(2, '0')}`, value: v }));

describe('Capacity Metric 검증', () => {
  it('whitelist · unsupported domain · 음수/NaN/null→0 차단', () => {
    expect(validateCapacityMetric({ metric_code: 'daily_playback_events', domain: 'playback_events', unit: 'events_per_day' })).toEqual([]);
    expect(validateCapacityMetric({ metric_code: 'cpu_usage', domain: 'playback_events', unit: 'count' }).some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateCapacityMetric({ metric_code: 'tracks_total', domain: 'invalid_domain', unit: 'count' }).some((e) => e.includes('domain'))).toBe(true);
    expect(validateCapacityMetric({ metric_code: 'tracks_total', domain: 'database_rows', unit: 'count', hard_limit: -1 }).some((e) => e.includes('음수'))).toBe(true);
    expect(validateCapacityMetric({ metric_code: 'tracks_total', domain: 'database_rows', unit: 'count', usage: NaN }).some((e) => e.includes('NaN'))).toBe(true);
    expect(validateCapacityMetric({ metric_code: 'tracks_total', domain: 'database_rows', unit: 'liters' }).some((e) => e.includes('unit'))).toBe(true);
    expect(validateCapacityMetric(null)).toEqual(['metric 없음']);
  });
});

describe('Usage Baseline', () => {
  it('일 평균/피크/7일 평균', () => {
    const b = calculateUsageBaseline(SERIES([100, 120, 110, 130, 90, 140, 150]));
    expect(b.dailyAverage).toBeCloseTo(120, 0);
    expect(b.peak).toBe(150);
    expect(b.avg7d).not.toBeNull();
    expect(b.status).toBe('available');
  });
  it('7일 미만 → 7d/30d baseline 생성 안 함 · 빈 데이터 insufficient', () => {
    const b = calculateUsageBaseline(SERIES([100, 120, 110]));
    expect(b.avg7d).toBeNull(); expect(b.avg30d).toBeNull(); expect(b.status).toBe('partial');
    expect(calculateUsageBaseline([]).status).toBe('insufficient_data');
    expect(calculateUsageBaseline([]).dailyAverage).toBeNull(); // null→0 없음
  });
});

describe('Demand Trend(단일 Spike 방어)', () => {
  it('Increasing / Stable / Decreasing', () => {
    expect(calculateDemandTrend(SERIES([100, 100, 100, 150, 160, 170])).trend).toBe('increasing');
    expect(calculateDemandTrend(SERIES([100, 102, 99, 101, 100, 100])).trend).toBe('stable');
    expect(calculateDemandTrend(SERIES([170, 160, 150, 100, 100, 100])).trend).toBe('decreasing');
  });
  it('한 번의 Spike 만으로 increasing 판정 안 함', () => {
    const r = calculateDemandTrend(SERIES([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 5000]));
    expect(r.trend).not.toBe('increasing');
    expect(r.outliers).toBeGreaterThan(0);
  });
  it('변동성 과다 → volatile · 표본 부족 → insufficient_data', () => {
    expect(calculateDemandTrend(SERIES([10, 500, 20, 700, 5, 900, 15, 800])).trend).toBe('volatile');
    expect(calculateDemandTrend(SERIES([100, 100])).trend).toBe('insufficient_data');
  });
});

describe('Demand Forecast(Deterministic · Actual 분리)', () => {
  const GROWING = SERIES([100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165]);
  it('동일 Input 동일 Output(deterministic)', () => {
    expect(forecastDemand(GROWING, 7)).toEqual(forecastDemand(GROWING, 7));
  });
  it('Linear Trend / Moving Average 선택 · Forecast≠Actual 표시', () => {
    const lin = forecastDemand(GROWING, 7);
    expect(lin.modelType).toBe('linear_trend');
    expect(lin.pointForecast).toBeGreaterThan(165);
    expect(lin.isForecastNotActual).toBe(true);
    expect(lin.limitations.some((l) => l.includes('Actual 아님'))).toBe(true);
    const flat = forecastDemand(SERIES([100, 100, 100, 100, 100, 100, 100, 100]), 7);
    expect(flat.modelType).toBe('moving_average');
    expect(flat.pointForecast).toBe(100);
  });
  it('Insufficient(7일 미만/30d horizon 데이터 부족/미지원 horizon)', () => {
    expect(forecastDemand(SERIES([1, 2, 3]), 7).modelType).toBe('insufficient_data');
    expect(forecastDemand(SERIES([1, 2, 3, 4, 5, 6, 7, 8]), 30).modelType).toBe('insufficient_data');
    expect(forecastDemand(GROWING, 90).modelType).toBe('insufficient_data'); // 90d 미지원
  });
  it('Horizon/Outlier Penalty — 긴 horizon 일수록 confidence 낮음', () => {
    const c7 = forecastDemand(GROWING, 7).confidence!;
    const c30 = forecastDemand(SERIES(Array.from({ length: 28 }, (_, i) => 100 + i * 5)), 30).confidence!;
    expect(forecastDemand(GROWING, 1).confidence!).toBeGreaterThan(c7);
    expect(c7).toBeGreaterThan(c30 - 20); // 30d 는 데이터가 더 많아도 horizon penalty 큼
    const withOutlier = forecastDemand(SERIES([100, 105, 110, 115, 120, 125, 130, 5000, 140, 145, 150, 155, 160, 165]), 7);
    expect(withOutlier.confidence!).toBeLessThan(c7);
  });
});

describe('Headroom / Utilization(Limit 없으면 null)', () => {
  it('정상 계산 · soft/hard', () => {
    const h = calculateHeadroom(80, 90, 100);
    expect(h.softHeadroom).toBe(10); expect(h.hardHeadroom).toBe(20); expect(h.utilizationPct).toBe(80); expect(h.status).toBe('ok');
  });
  it('Limit Unknown → headroom/utilization null · Usage>Limit · 음수/0 나눗셈 방어', () => {
    const h = calculateHeadroom(80, null, null);
    expect(h.hardHeadroom).toBeNull(); expect(h.utilizationPct).toBeNull(); expect(h.status).toBe('limit_unknown');
    expect(calculateHeadroom(150, null, 100).hardHeadroom).toBe(-50);
    expect(calculateHeadroom(-1, null, 100).status).toBe('invalid');
    expect(calculateHeadroom(null, null, 100).status).toBe('insufficient_data');
    expect(calculateUtilization(50, 0)).toBeNull();
    expect(calculateUtilization(NaN, 100)).toBeNull();
  });
});

describe('Time to Exhaustion', () => {
  const now = new Date('2026-07-14T00:00:00Z');
  it('정상 추정 + range + 단정 아님 표기', () => {
    const r = estimateTimeToExhaustion({ usage: 100, hardLimit: 200, growthPerDay: 10, confidence: 50, now });
    expect(r.status).toBe('estimated'); expect(r.days).toBe(10);
    expect(r.estimatedDate).toBe('2026-07-24'); expect(r.range).not.toBeNull();
    expect(r.limitations[0]).toContain('단정');
  });
  it('Growth 0/음수 → 날짜 생성 안 함 · Limit Unknown → 계산 금지 · Already Exhausted', () => {
    expect(estimateTimeToExhaustion({ usage: 100, hardLimit: 200, growthPerDay: 0, confidence: null, now }).status).toBe('no_positive_growth');
    expect(estimateTimeToExhaustion({ usage: 100, hardLimit: 200, growthPerDay: -5, confidence: null, now }).status).toBe('no_positive_growth');
    expect(estimateTimeToExhaustion({ usage: 100, hardLimit: null, growthPerDay: 10, confidence: null, now }).status).toBe('limit_unknown');
    expect(estimateTimeToExhaustion({ usage: 250, hardLimit: 200, growthPerDay: 10, confidence: null, now }).status).toBe('already_exhausted');
    expect(estimateTimeToExhaustion({ usage: null, hardLimit: 200, growthPerDay: 10, confidence: null, now }).status).toBe('insufficient_data');
  });
});

describe('Saturation Risk', () => {
  const C = (v: number | null): SaturationComponents => ({
    utilizationRisk: v, forecastUtilizationRisk: v, growthRisk: v, volatilityRisk: v,
    exhaustionProximityRisk: v, sloRisk: v, incidentRisk: v, monitoringRisk: v,
  });
  it('Low/Moderate/High/Critical', () => {
    expect(calculateSaturationRisk(C(10), true).risk).toBe('low');
    expect(calculateSaturationRisk(C(40), true).risk).toBe('moderate');
    expect(calculateSaturationRisk(C(60), true).risk).toBe('high');
    expect(calculateSaturationRisk(C(90), true).risk).toBe('critical');
  });
  it('Limit Unknown → 판정 안 함(추정 Limit 로 Saturation 보고 금지)', () => {
    expect(calculateSaturationRisk(C(90), false).risk).toBe('limit_unknown');
  });
  it('Missing Component 재정규화 · 전부 null → insufficient', () => {
    const partial = calculateSaturationRisk({ ...C(50), sloRisk: null, incidentRisk: null }, true);
    expect(partial.score).toBe(50); expect(partial.missing.length).toBe(2);
    expect(calculateSaturationRisk(C(null), true).risk).toBe('insufficient_data');
  });
});

describe('Cost(단가 없으면 cost_unknown · Actual/Estimated 분리)', () => {
  it('Cost Model 검증 — provider/currency/단가/근거', () => {
    expect(validateCostModel({ cost_code: 'c', provider: 'supabase', unit_price: 10, currency: 'KRW', source: 'invoice' })).toEqual([]);
    expect(validateCostModel({ cost_code: 'c', provider: 'aws', unit_price: 10, currency: 'KRW', source: 's' }).some((e) => e.includes('provider'))).toBe(true);
    expect(validateCostModel({ cost_code: 'c', provider: 'supabase', unit_price: -1, currency: 'KRW', source: 's' }).some((e) => e.includes('음수'))).toBe(true);
    expect(validateCostModel({ cost_code: 'c', provider: 'supabase', unit_price: 10, currency: 'EUR', source: 's' }).some((e) => e.includes('currency'))).toBe(true);
    expect(validateCostModel({ cost_code: 'c', provider: 'supabase', unit_price: 10, currency: 'KRW' }).some((e) => e.includes('근거'))).toBe(true);
  });
  it('Estimated — included/overage 반영 · 단가 없으면 cost_unknown · 음수 차단', () => {
    expect(calculateEstimatedCost({ usage: 150, unitPrice: 10, includedAmount: 100, overagePrice: 5 })).toEqual({ estimatedCost: 250, billableUsage: 50, status: 'estimated' });
    expect(calculateEstimatedCost({ usage: 80, unitPrice: 10, includedAmount: 100 }).estimatedCost).toBe(0);
    expect(calculateEstimatedCost({ usage: 100, unitPrice: null }).status).toBe('cost_unknown');
    expect(calculateEstimatedCost({ usage: null, unitPrice: 10 }).status).toBe('insufficient_data');
    expect(calculateEstimatedCost({ usage: -5, unitPrice: 10 }).status).toBe('invalid');
  });
  it('Cost Forecast — Forecast≠Actual 표시 · 단가 없으면 cost_unknown', () => {
    const f = forecastCost({ currentUsage: 100, forecastUsage: 200, unitPrice: 10, confidence: 40 });
    expect(f.status).toBe('estimated'); expect(f.forecastCost).toBe(2000); expect(f.isForecastNotActual).toBe(true);
    expect(forecastCost({ currentUsage: 100, forecastUsage: 200, unitPrice: null, confidence: null }).status).toBe('cost_unknown');
  });
  it('Unit Economics — 분모 0/null 나눗셈 방어', () => {
    expect(calculateUnitEconomics(1000, 10)).toBe(100);
    expect(calculateUnitEconomics(1000, 0)).toBeNull();
    expect(calculateUnitEconomics(null, 10)).toBeNull();
    expect(calculateUnitEconomics(-5, 10)).toBeNull();
  });
  it('Cost Anomaly — 청구 데이터 부족 시 미지원 · 급증 탐지 · Fraud 단정 없음', () => {
    expect(detectCostAnomaly([{ period_end: '2026-06-30', actual_cost: 100, estimated_cost: null, usage_amount: 10 }]).status).toBe('unsupported');
    const r = detectCostAnomaly([
      { period_end: '2026-05-31', actual_cost: 100, estimated_cost: null, usage_amount: 100 },
      { period_end: '2026-06-30', actual_cost: 200, estimated_cost: null, usage_amount: 101 },
    ]);
    expect(r.status).toBe('available');
    expect(r.anomalies.some((a) => a.type === 'sudden_cost_increase')).toBe(true);
    expect(JSON.stringify(r.anomalies)).toContain('단정 아님'); // Fraud 단정 없음 문구 명시
  });
});

describe('Recommendation / Scaling Plan(실행 없음)', () => {
  it('Monitor / Scale Plan / Storage / Limit Review / Insufficient', () => {
    const base = { metricCode: 'daily_playback_events', status: 'healthy', utilizationPct: 30, trend: 'stable' as const, exhaustionDays: null, limitKnown: true, costKnown: false };
    expect(buildCapacityRecommendation(base).type).toBe('monitor_usage');
    expect(buildCapacityRecommendation({ ...base, status: 'exhausted' }).type).toBe('prepare_scale_plan');
    expect(buildCapacityRecommendation({ ...base, exhaustionDays: 7 }).type).toBe('prepare_scale_plan');
    expect(buildCapacityRecommendation({ ...base, metricCode: 'audio_storage_bytes', status: 'constrained' }).type).toBe('optimize_storage');
    expect(buildCapacityRecommendation({ ...base, limitKnown: false }).type).toBe('review_hard_limit');
    expect(buildCapacityRecommendation({ ...base, status: 'insufficient_data' }).type).toBe('insufficient_data');
  });
  it('권고에 Evidence/실행 없음 표시 · costImpact cost_unknown', () => {
    const r = buildCapacityRecommendation({ metricCode: 'x', status: 'healthy', utilizationPct: null, trend: 'stable', exhaustionDays: null, limitKnown: true, costKnown: false });
    expect(r.noExecution).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.costImpact).toBe('cost_unknown');
    expect(r.limitations[0]).toContain('자동 Scale 없음');
  });
  it('Scaling Plan — 필수 필드/Idempotency · 실행 상태 없음', () => {
    expect(validateScalingPlan({ plan_code: 'p', plan_type: 'scale_up_review', trigger_condition: 't', evidence: [1], idempotency_key: 'k' })).toEqual([]);
    expect(validateScalingPlan({ plan_code: 'p', plan_type: 'auto_scale', trigger_condition: 't', evidence: [1], idempotency_key: 'k' }).some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateScalingPlan({}).length).toBeGreaterThan(3);
    for (const f of FORBIDDEN_PLAN_STATUSES) expect(PLAN_STATUSES).not.toContain(f);
  });
});

describe('SPOF / Continuity', () => {
  const DEP = (over: Partial<DependencyLike> = {}): DependencyLike => ({
    criticality: 'critical', fallback_available: false, monitoring_source: 'store_monitoring', owner: 'admin',
    rto_target: '4h', rpo_target: '1h', failure_impact: 'x', ...over,
  });
  it('Confirmed SPOF(critical+fallback 없음) · Potential · No Known · Insufficient', () => {
    expect(detectSinglePointOfFailure(DEP()).status).toBe('confirmed_spof');
    expect(detectSinglePointOfFailure(DEP({ criticality: 'medium', monitoring_source: null })).status).toBe('potential_spof');
    expect(detectSinglePointOfFailure(DEP({ criticality: 'low', fallback_available: true })).status).toBe('no_known_spof');
    expect(detectSinglePointOfFailure(DEP({ criticality: 'low', fallback_available: null, monitoring_source: 'm' })).status).toBe('insufficient_data');
    expect(detectSinglePointOfFailure(null).status).toBe('insufficient_data');
  });
  it('no_known_spof 는 부재 보장 아님(문구 고정)', () => {
    expect(detectSinglePointOfFailure(DEP({ fallback_available: true, criticality: 'low' })).note).toContain('미확인');
  });
  it('Continuity Readiness — ready/partial/weak/critical/insufficient', () => {
    const base = { dependencyCount: 7, confirmedSpofs: 0, potentialSpofs: 0, backupConfigured: true, restoreTested: true, failoverAvailable: true, monitoringCoverage: 90, playbookCount: 3, rtoDefinedCount: 5, lastValidationAt: '2026-07-01' };
    expect(evaluateContinuityReadiness(base).readiness).toBe('ready');
    expect(evaluateContinuityReadiness({ ...base, restoreTested: false }).readiness).toBe('partially_ready');
    expect(evaluateContinuityReadiness({ ...base, restoreTested: false, failoverAvailable: false, playbookCount: 0, rtoDefinedCount: 0 }).readiness).toBe('weak');
    expect(evaluateContinuityReadiness({ ...base, confirmedSpofs: 2, failoverAvailable: false, restoreTested: false }).readiness).toBe('critical');
    expect(evaluateContinuityReadiness({ ...base, dependencyCount: 0 }).readiness).toBe('insufficient_data');
  });
});

describe('Stress / Continuity Scenario(Evidence-only)', () => {
  it('Playback 2배 — limit 대비 판정 · limit 없으면 unsupported · 부하 주입 없음', () => {
    const r = evaluateCapacityStressScenario({ scenario: 'playback_2x', multiplier: 2, usage: 40, hardLimit: 100 });
    expect(r.result).toBe('tolerable'); expect(r.projectedUsage).toBe(80); expect(r.evidenceOnly).toBe(true);
    expect(evaluateCapacityStressScenario({ scenario: 'store_2x', multiplier: 2, usage: 60, hardLimit: 100 }).result).toBe('critical');
    expect(evaluateCapacityStressScenario({ scenario: 'x', multiplier: 2, usage: 40, hardLimit: null }).result).toBe('unsupported');
    expect(evaluateCapacityStressScenario({ scenario: 'x', multiplier: 2, usage: null, hardLimit: 100 }).result).toBe('insufficient_data');
    expect(r.note).toContain('부하 주입 없음');
  });
  it('Continuity Scenario — SPOF 기반 판정 · 실제 장애 없음 · RTO 미정의 표기', () => {
    const dep: DependencyLike = { criticality: 'critical', fallback_available: false, monitoring_source: null, owner: null, rto_target: 'not_defined', rpo_target: 'not_defined', failure_impact: '전체 중단' };
    const r = evaluateContinuityScenario({ scenario: 'supabase_db_unavailable', dependency: dep, blastRadius: '전체 서비스' });
    expect(r.result).toBe('critical'); expect(r.evidenceOnly).toBe(true);
    expect(r.estimatedRecovery).toContain('not_defined');
    expect(r.limitations[0]).toContain('장애를 발생시키지 않음');
    expect(evaluateContinuityScenario({ scenario: 'x', dependency: null, blastRadius: 'y' }).result).toBe('insufficient_data');
  });
});

describe('Package / Domain / Support Matrix', () => {
  it('Capacity Package 필수 섹션 + Forecast≠Actual', () => {
    const pkg = buildCapacityPackage({ metricCode: 'daily_playback_events', usage: 100, baseline: null, trend: 'stable', forecast: null, headroom: null, saturation: 'limit_unknown', cost: 'cost_unknown', recommendation: 'monitor_usage', limitations: ['l'] });
    const sections = pkg.map((p) => p.section);
    for (const s of ['Current Usage (실측)', 'Demand Trend', 'Forecast', 'Headroom', 'Saturation Risk', 'Cost', 'Recommendation', 'Limitations']) expect(sections).toContain(s);
    expect(String(pkg.find((p) => p.section === 'Recommendation')!.content)).toContain('실행 아님');
    expect(pkg.find((p) => p.section === 'Headroom')!.content).toBe('limit_unknown');
  });
  it('Domain — concurrent/bandwidth/edge/api/build unsupported · Support Matrix 금지 항목', () => {
    for (const d of ['concurrent_players', 'bandwidth', 'edge_functions', 'api_requests', 'build_minutes', 'deployment_count']) {
      expect(CAPACITY_DOMAINS.find((x) => x.domain === d)!.status).toBe('unsupported');
    }
    expect(CAP_SUPPORT.find((s) => s.key === 'automatic_scaling')!.status).toBe('unsupported');
    expect(CAP_SUPPORT.find((s) => s.key === 'automatic_backup')!.status).toBe('unsupported');
    expect(CAP_SUPPORT.find((s) => s.key === 'infrastructure_apply')!.status).toBe('unsupported');
    expect(CAP_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(CAP_SUPPORT.find((s) => s.key === 'cost_model')!.status).toBe('cost_unknown');
    expect(CAP_SUPPORT.find((s) => s.key === 'demand_forecast')!.note).toContain('90d');
  });
});
