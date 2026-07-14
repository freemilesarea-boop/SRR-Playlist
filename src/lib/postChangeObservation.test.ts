// Phase AI-OPS-3 — Post-Change Observation 순수 로직 단위 테스트.
// Eligibility(completed_reference/manual reference/baseline 필수) · Baseline/Target ·
// Window/Minimum Policy · Metric Delta(0 나눗셈 방어) · Metric 판정 · Regression ·
// Trade-off · Incident Correlation(인과 단정 없음) · Rollback(권고 전용/재검증 필수) ·
// Certification(자동 인증 없음) · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  validateObservationEligibility, OBSERVATION_STATUSES, FORBIDDEN_OBSERVATION_STATUSES,
  validateObservationWindow, MIN_OBSERVATION_POLICY, validateBaseline, validateTarget,
  calculateMetricDelta, validateObservedMetric, classifyMetricResult, detectRegression,
  detectCrossMetricTradeoff, correlateIncident, assessRollbackNeed, evaluateCertification,
  buildCertificationPackage, validateRollbackReference, calculateObservationProgress,
  detectDataDelay, pcoHash, SUPPORTED_METRICS, UNSUPPORTED_METRICS, PCO_SUPPORT,
  type ObsEligibilityInput, type MetricRow, type RollbackNeedInput, type CertificationInput,
  type ObservedMetricInput, type ObservationLike,
} from './postChangeObservation';

const ELIG = (over: Partial<ObsEligibilityInput> = {}): ObsEligibilityInput => ({
  planStatus: 'completed_reference',
  manualReference: { external_change_id: 'CHG-1', executed_by: 'ops', executed_at: '2026-07-14', execution_result: 'succeeded' },
  observationPlan: { kpis: ['completion_rate', 'skip_rate'], monitoring_source: 'playback_events_v2', owner: 'o', success: 's', failure: 'f' },
  baselinePresent: true, sourceVersionMatch: true, inputHashMatch: true,
  duplicateObservation: false, planExpired: false, hasIdempotencyKey: true, ...over,
});

describe('Observation Eligibility', () => {
  it('completed_reference + 완전한 reference → eligible', () => { expect(validateObservationEligibility(ELIG()).status).toBe('eligible'); });
  it('ready_for_manual_execution → pending_execution_reference(실행 대기)', () => {
    expect(validateObservationEligibility(ELIG({ planStatus: 'ready_for_manual_execution' })).status).toBe('pending_execution_reference');
  });
  it('Manual Reference 누락/External Change ID 누락 → pending_execution_reference', () => {
    expect(validateObservationEligibility(ELIG({ manualReference: null })).status).toBe('pending_execution_reference');
    expect(validateObservationEligibility(ELIG({ manualReference: { executed_by: 'x', executed_at: 't', execution_result: 'ok' } })).status).toBe('pending_execution_reference');
  });
  it('Observation Plan/KPI 누락 · Baseline 누락 · Monitoring Source 누락', () => {
    expect(validateObservationEligibility(ELIG({ observationPlan: null })).status).toBe('missing_observation_plan');
    expect(validateObservationEligibility(ELIG({ observationPlan: { kpis: [], monitoring_source: 'm' } })).status).toBe('missing_observation_plan');
    expect(validateObservationEligibility(ELIG({ baselinePresent: false })).status).toBe('missing_baseline');
    expect(validateObservationEligibility(ELIG({ observationPlan: { kpis: ['skip_rate'] } })).status).toBe('missing_monitoring_source');
  });
  it('Duplicate/Version·Hash mismatch/Expired/Unsupported KPI/Idempotency 없음', () => {
    expect(validateObservationEligibility(ELIG({ duplicateObservation: true })).status).toBe('duplicate');
    expect(validateObservationEligibility(ELIG({ sourceVersionMatch: false })).status).toBe('version_mismatch');
    expect(validateObservationEligibility(ELIG({ inputHashMatch: false })).status).toBe('version_mismatch');
    expect(validateObservationEligibility(ELIG({ planExpired: true })).status).toBe('expired');
    expect(validateObservationEligibility(ELIG({ observationPlan: { kpis: ['revenue_impact'], monitoring_source: 'm' } })).status).toBe('unsupported');
    expect(validateObservationEligibility(ELIG({ hasIdempotencyKey: false })).status).toBe('blocked');
  });
});

describe('Observation Status', () => {
  it('Production 작업 상태(executing/deploying/rolling_back 등) 미포함', () => {
    for (const f of FORBIDDEN_OBSERVATION_STATUSES) expect(OBSERVATION_STATUSES).not.toContain(f);
    expect(OBSERVATION_STATUSES).toContain('rollback_review');
    expect(OBSERVATION_STATUSES).toContain('data_delayed');
  });
});

describe('Window / Minimum Observation Policy', () => {
  it('지원 window 정상 · 미지원 window 거부', () => {
    expect(validateObservationWindow(24, 'medium').valid).toBe(true);
    expect(validateObservationWindow(2, 'low').valid).toBe(false);
  });
  it('risk tier 별 최소 기간 — high 는 15분 관측으로 인증 불가', () => {
    expect(validateObservationWindow(0.25, 'high').errors.some((e) => e.includes('최소 관측'))).toBe(true);
    expect(validateObservationWindow(24, 'high').valid).toBe(true);
    expect(MIN_OBSERVATION_POLICY.low.minEvents).toBe(50);
    expect(MIN_OBSERVATION_POLICY.high.extraReview).toBe(true);
  });
  it('critical risk → 인증 불가', () => {
    expect(MIN_OBSERVATION_POLICY.critical.certifiable).toBe(false);
    expect(validateObservationWindow(24, 'critical').errors.some((e) => e.includes('인증 불가'))).toBe(true);
  });
});

describe('Baseline / Target', () => {
  it('Baseline 정상 · 없으면 필수 오류', () => {
    expect(validateBaseline({ metric_code: 'skip_rate', value: 12.5, sample_size: 300, source: 'playback_events_v2' })).toEqual([]);
    expect(validateBaseline(null)[0]).toContain('필수');
  });
  it('Baseline sample 부족 · null→0 변환 없음 · NaN 방어', () => {
    expect(validateBaseline({ metric_code: 'skip_rate', value: 1, sample_size: 0, source: 's' }).some((e) => e.includes('sample'))).toBe(true);
    expect(validateBaseline({ metric_code: 'skip_rate', value: null, sample_size: 10, source: 's' }).some((e) => e.includes('null→0'))).toBe(true);
    expect(validateBaseline({ metric_code: 'skip_rate', value: NaN, sample_size: 10, source: 's' }).some((e) => e.includes('NaN'))).toBe(true);
  });
  it('Target 정상 · Target 없는 KPI 는 참고 관측 전용 · threshold NaN 방어', () => {
    expect(validateTarget({ expected_direction: 'decrease', warning_threshold: 10, failure_threshold: 25 }).errors).toEqual([]);
    expect(validateTarget(null).informationalOnly).toBe(true);
    expect(validateTarget({ expected_direction: 'increase', target_value: Infinity }).errors.some((e) => e.includes('NaN/Infinity'))).toBe(true);
    expect(validateTarget({ expected_direction: 'up' }).errors.length).toBe(1);
  });
});

describe('Metric Delta', () => {
  it('절대/상대 delta 계산', () => {
    expect(calculateMetricDelta(10, 12)).toEqual({ absolute: 2, relativePct: 20 });
    expect(calculateMetricDelta(10, 8).relativePct).toBe(-20);
  });
  it('Baseline 0 → 나눗셈하지 않음(relative null, 절대만)', () => {
    const d = calculateMetricDelta(0, 5);
    expect(d.absolute).toBe(5); expect(d.relativePct).toBeNull();
  });
  it('null/NaN 입력 → null 유지(0 변환 없음)', () => {
    expect(calculateMetricDelta(null, 5)).toEqual({ absolute: null, relativePct: null });
    expect(calculateMetricDelta(NaN, 5).absolute).toBeNull();
  });
});

describe('Metric Validation / Classification', () => {
  const M = (over: Partial<ObservedMetricInput> = {}): ObservedMetricInput => ({
    metricCode: 'skip_rate', metricType: 'actual', baseline: 20, observed: 20, sampleSize: 500, minSample: 50, ...over,
  });
  it('Improved / Stable / Degraded / Failed (lower_is_better)', () => {
    expect(classifyMetricResult(M({ observed: 15 }))).toBe('improved');
    expect(classifyMetricResult(M({ observed: 20.5 }))).toBe('stable');
    expect(classifyMetricResult(M({ observed: 23 }))).toBe('degraded');
    expect(classifyMetricResult(M({ observed: 26 }))).toBe('failed');
  });
  it('higher_is_better 방향 반전 · neutral(events) 은 판정 없음(stable)', () => {
    expect(classifyMetricResult(M({ metricCode: 'completion_rate', baseline: 60, observed: 40 }))).toBe('failed');
    expect(classifyMetricResult(M({ metricCode: 'events', baseline: 100, observed: 10 }))).toBe('stable');
  });
  it('Unsupported / Pending / Insufficient(baseline 없음·sample 부족) / Invalid', () => {
    expect(classifyMetricResult(M({ metricCode: 'buffering_rate' }))).toBe('unsupported');
    expect(classifyMetricResult(M({ observed: null }))).toBe('pending');
    expect(classifyMetricResult(M({ baseline: null }))).toBe('insufficient_data');
    expect(classifyMetricResult(M({ sampleSize: 10 }))).toBe('insufficient_data');
    expect(classifyMetricResult(M({ observed: Infinity }))).toBe('invalid');
  });
  it('simulated/predicted metric_type 저장 금지', () => {
    expect(validateObservedMetric(M({ metricType: 'simulated' })).some((e) => e.includes('금지'))).toBe(true);
    expect(classifyMetricResult(M({ metricType: 'simulated' }))).toBe('invalid');
    expect(validateObservedMetric(M())).toEqual([]);
  });
});

describe('Regression Detection', () => {
  const CTX = { versionMatch: true, monitoringGap: false, dataDelayed: false, minSample: 50 };
  const row = (over: Partial<MetricRow>): MetricRow => ({ metricCode: 'skip_rate', metricRole: 'primary', validationStatus: 'stable', sampleSize: 500, ...over });
  it('Primary failed → critical absolute regression · degraded → warning relative regression', () => {
    expect(detectRegression([row({ validationStatus: 'failed' })], CTX)[0]).toMatchObject({ type: 'absolute_regression', severity: 'critical' });
    expect(detectRegression([row({ validationStatus: 'degraded' })], CTX)[0]).toMatchObject({ type: 'relative_regression', severity: 'warning' });
  });
  it('Guardrail 위반 · Error Spike', () => {
    expect(detectRegression([row({ metricRole: 'guardrail', validationStatus: 'failed' })], CTX)[0]).toMatchObject({ type: 'guardrail_violation', severity: 'critical' });
    expect(detectRegression([row({ metricCode: 'player_error_rate', metricRole: 'diagnostic', validationStatus: 'degraded' })], CTX)[0]).toMatchObject({ type: 'error_spike', severity: 'high' });
  });
  it('Sample Instability / Version Mismatch / Monitoring Gap / Data Delay', () => {
    expect(detectRegression([row({ sampleSize: 10 })], CTX).some((r) => r.type === 'sample_instability')).toBe(true);
    const types = detectRegression([], { ...CTX, versionMatch: false, monitoringGap: true, dataDelayed: true }).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['version_mismatch', 'monitoring_gap', 'data_delay']));
  });
  it('No Regression — 전부 stable/improved', () => {
    expect(detectRegression([row({}), row({ metricCode: 'completion_rate', validationStatus: 'improved' })], CTX)).toEqual([]);
  });
});

describe('Cross-Metric Trade-off', () => {
  const row = (code: string, status: MetricRow['validationStatus'], role: MetricRow['metricRole'] = 'primary'): MetricRow => ({ metricCode: code, metricRole: role, validationStatus: status });
  it('일관 개선 → consistent_improvement · 전부 stable → acceptable', () => {
    expect(detectCrossMetricTradeoff([row('skip_rate', 'improved'), row('completion_rate', 'stable')]).result).toBe('consistent_improvement');
    expect(detectCrossMetricTradeoff([row('skip_rate', 'stable')]).result).toBe('acceptable_tradeoff');
  });
  it('Completion 개선 / Error(guardrail) 악화 → critical_tradeoff', () => {
    const r = detectCrossMetricTradeoff([row('completion_rate', 'improved'), row('player_error_rate', 'degraded', 'guardrail')]);
    expect(r.result).toBe('critical_tradeoff');
    expect(r.pairs[0]).toContain('completion_rate 개선 / player_error_rate 악화');
  });
  it('개선 + diagnostic 악화 → acceptable_tradeoff · 개선 + primary 악화 → mixed', () => {
    expect(detectCrossMetricTradeoff([row('skip_rate', 'improved'), row('like_rate', 'degraded', 'diagnostic')]).result).toBe('acceptable_tradeoff');
    expect(detectCrossMetricTradeoff([row('skip_rate', 'improved'), row('completion_rate', 'degraded')]).result).toBe('mixed');
  });
  it('개선 없는 악화 → degraded · failed 동반 개선 → critical · Missing → insufficient_data', () => {
    expect(detectCrossMetricTradeoff([row('skip_rate', 'degraded')]).result).toBe('degraded');
    expect(detectCrossMetricTradeoff([row('skip_rate', 'improved'), row('player_error_rate', 'failed', 'guardrail')]).result).toBe('critical_tradeoff');
    expect(detectCrossMetricTradeoff([row('skip_rate', 'pending')]).result).toBe('insufficient_data');
  });
});

describe('Incident Correlation(인과 단정 없음)', () => {
  const OBS = { start: '2026-07-14T00:00:00Z', end: '2026-07-14T12:00:00Z', scopeKeys: ['store:a'] };
  it('시간+scope 일치 → possibly_related · 시간만 → temporally_correlated', () => {
    expect(correlateIncident({ occurredAt: '2026-07-14T03:00:00Z', scopeKeys: ['store:a'] }, OBS).correlation).toBe('possibly_related');
    expect(correlateIncident({ occurredAt: '2026-07-14T03:00:00Z', scopeKeys: ['store:z'] }, OBS).correlation).toBe('temporally_correlated');
  });
  it('scope 만 → scope_correlated · 불일치 → unrelated · 데이터 없음 → insufficient_data', () => {
    expect(correlateIncident({ occurredAt: '2026-07-15T03:00:00Z', scopeKeys: ['store:a'] }, OBS).correlation).toBe('scope_correlated');
    expect(correlateIncident({ occurredAt: '2026-07-15T03:00:00Z', scopeKeys: ['store:z'] }, OBS).correlation).toBe('unrelated');
    expect(correlateIncident({ occurredAt: null, scopeKeys: [] }, OBS).correlation).toBe('insufficient_data');
  });
  it('결과에 인과 단정 문자열 없음(상관 표기만)', () => {
    const r = correlateIncident({ occurredAt: '2026-07-14T03:00:00Z', scopeKeys: ['store:a'] }, OBS);
    expect(JSON.stringify(r)).not.toMatch(/caused|causation|인과/);
  });
});

describe('Rollback Assessment(권고 전용)', () => {
  const IN = (over: Partial<RollbackNeedInput> = {}): RollbackNeedInput => ({
    dataSufficient: true, criticalRegressions: 0, primaryFailed: false, guardrailViolated: false,
    failureThresholdExceeded: false, incidentIncrease: false, errorSpike: false,
    versionMismatch: false, monitoringGap: false, rollbackPlanExists: true, rollbackOwnerExists: true, irreversible: false, ...over,
  });
  it('정상 → not required · 경계 신호 → monitor_closely', () => {
    expect(assessRollbackNeed(IN()).assessment).toBe('rollback_not_required');
    expect(assessRollbackNeed(IN({ errorSpike: true })).assessment).toBe('monitor_closely');
  });
  it('Primary 실패/guardrail 위반 → recommended · critical → urgently recommended', () => {
    expect(assessRollbackNeed(IN({ primaryFailed: true })).assessment).toBe('rollback_recommended');
    expect(assessRollbackNeed(IN({ guardrailViolated: true })).assessment).toBe('rollback_recommended');
    expect(assessRollbackNeed(IN({ criticalRegressions: 2 })).assessment).toBe('rollback_urgently_recommended');
  });
  it('version mismatch/irreversible+실패/plan 불완전 → manual_review_required · 데이터 부족 → insufficient', () => {
    expect(assessRollbackNeed(IN({ versionMismatch: true })).assessment).toBe('manual_review_required');
    expect(assessRollbackNeed(IN({ irreversible: true, primaryFailed: true })).assessment).toBe('manual_review_required');
    expect(assessRollbackNeed(IN({ primaryFailed: true, rollbackPlanExists: false })).assessment).toBe('manual_review_required');
    expect(assessRollbackNeed(IN({ dataSufficient: false })).assessment).toBe('insufficient_data');
  });
  it('Rollback 실행 경로 없음 — 항상 executionBlocked + 권고 명시', () => {
    const r = assessRollbackNeed(IN({ criticalRegressions: 1 }));
    expect(r.executionBlocked).toBe(true);
    expect(r.reasons.some((x) => x.includes('실행하지 않는다'))).toBe(true);
  });
});

describe('Rollback Reference(재검증 필수)', () => {
  it('필수 필드 검증 · 기록 후 재검증 필요', () => {
    expect(validateRollbackReference(null).errors.length).toBeGreaterThan(0);
    expect(validateRollbackReference({ external_rollback_id: 'RB-1' }).errors.length).toBe(3);
    const ok = validateRollbackReference({ external_rollback_id: 'RB-1', rollback_executed_by: 'ops', rollback_executed_at: 't', rollback_result: 'succeeded' });
    expect(ok.errors).toEqual([]);
    expect(ok.requiresRevalidation).toBe(true); // 실측 재검증 없이 성공 인증 금지
  });
});

describe('Operational Certification(자동 인증 없음)', () => {
  const C = (over: Partial<CertificationInput> = {}): CertificationInput => ({
    dataSufficient: true, primaryPassed: true, guardrailFailed: false, warningRegressions: 0,
    criticalRegressions: 0, criticalIncidents: 0, windowMet: true, sampleMet: true,
    versionMatch: true, monitoringGap: false, humanReviewed: true, evidenceComplete: true,
    rollbackAssessment: 'rollback_not_required', rollbackDecision: null, riskTier: 'medium', ...over,
  });
  it('전 조건 충족 → certified(사람 확정 필요)', () => {
    const r = evaluateCertification(C());
    expect(r.result).toBe('certified');
    expect(r.requiresHumanApproval).toBe(true);
  });
  it('warning regression → certified_with_conditions', () => {
    expect(evaluateCertification(C({ warningRegressions: 1 })).result).toBe('certified_with_conditions');
  });
  it('Primary 실패/Critical Regression/Critical Incident/Sample/Window/Version/Evidence/사람 Review 차단', () => {
    expect(evaluateCertification(C({ primaryPassed: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ criticalRegressions: 1 })).result).toBe('not_certified');
    expect(evaluateCertification(C({ criticalIncidents: 1 })).result).toBe('not_certified');
    expect(evaluateCertification(C({ sampleMet: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ windowMet: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ versionMatch: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ evidenceComplete: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ humanReviewed: false })).result).toBe('not_certified');
    expect(evaluateCertification(C({ guardrailFailed: true })).result).toBe('not_certified');
  });
  it('rollback 권고 → rollback_recommended · reference 기록 → pending_validation · 무효화/부족', () => {
    expect(evaluateCertification(C({ rollbackAssessment: 'rollback_recommended' })).result).toBe('rollback_recommended');
    expect(evaluateCertification(C({ rollbackDecision: 'rollback_completed_reference' })).result).toBe('rollback_completed_pending_validation');
    expect(evaluateCertification(C({ rollbackDecision: 'invalidated' })).result).toBe('invalidated');
    expect(evaluateCertification(C({ dataSufficient: false })).result).toBe('insufficient_data');
    expect(evaluateCertification(C({ riskTier: 'critical' })).result).toBe('not_certified');
  });
  it('모든 판정에 사람 확정 필요 명시(자동 Certification 없음)', () => {
    expect(evaluateCertification(C()).reasons.some((x) => x.includes('자동 인증 없음'))).toBe(true);
  });
});

describe('Certification Package / Progress / Data Delay / Hash', () => {
  it('필수 섹션 포함 · Actual 에 simulation 미포함 표기', () => {
    const obs: ObservationLike = {
      observation_code: 'OBS-1', external_change_id: 'CHG-1', observation_scope: { store: 'a' },
      baseline_start: 'b1', baseline_end: 'b2', observation_start: 'o1', observation_end: 'o2',
      source_version: 'v1', deployed_version: 'v1', baseline_snapshot: {}, target_snapshot: {}, observed_snapshot: {},
      regression_summary: null, incident_summary: null, rollback_assessment: null, rollback_decision: null,
      certification_result: null, evidence: [], limitations: [],
    };
    const pkg = buildCertificationPackage(obs, []);
    const sections = pkg.map((p) => p.section);
    for (const s of ['Change Summary', 'Execution Reference', 'Baseline', 'Target', 'Actual Outcome', 'Primary KPI', 'Guardrail KPI', 'Rollback Assessment', 'Human Decision', 'Certification Result', 'Source Version', 'Deployed Version', 'Audit Timeline']) expect(sections).toContain(s);
    const actual = pkg.find((p) => p.section === 'Actual Outcome')!.content as { metric_type: string };
    expect(actual.metric_type).toContain('simulation/prediction 미포함');
  });
  it('Observation Progress — Date 주입 · clamp 0~100 · null 안전', () => {
    const now = new Date('2026-07-14T12:00:00Z');
    expect(calculateObservationProgress('2026-07-14T06:00:00Z', 12, now).progressPct).toBe(50);
    expect(calculateObservationProgress('2026-07-01T00:00:00Z', 1, now).progressPct).toBe(100);
    expect(calculateObservationProgress(null, 12, now).progressPct).toBeNull();
  });
  it('Data Delay 감지', () => {
    const now = new Date('2026-07-14T12:00:00Z');
    expect(detectDataDelay('2026-07-14T11:30:00Z', now, 60)).toBe(false);
    expect(detectDataDelay('2026-07-14T09:00:00Z', now, 60)).toBe(true);
    expect(detectDataDelay(null, now)).toBe(true);
  });
  it('hash 결정적', () => { expect(pcoHash(['a', 1])).toBe(pcoHash(['a', 1])); });
});

describe('Support Matrix / KPI Catalog', () => {
  it('실측 KPI 6개 · 미지원 KPI 정직 표기', () => {
    expect(SUPPORTED_METRICS.length).toBe(6);
    expect(UNSUPPORTED_METRICS.some((m) => m.code === 'time_to_first_audio')).toBe(true);
    expect(UNSUPPORTED_METRICS.some((m) => m.code === 'revenue_impact')).toBe(true);
  });
  it('Automatic Certification/Rollback/Production Apply → unsupported', () => {
    expect(PCO_SUPPORT.find((s) => s.key === 'automatic_certification')!.status).toBe('unsupported');
    expect(PCO_SUPPORT.find((s) => s.key === 'automatic_rollback')!.status).toBe('unsupported');
    expect(PCO_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(PCO_SUPPORT.find((s) => s.key === 'rollback_reference')!.status).toBe('evidence_only');
    expect(PCO_SUPPORT.find((s) => s.key === 'streaming_quality_metrics')!.status).toBe('unsupported');
  });
});
