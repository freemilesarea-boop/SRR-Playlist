// Phase AI-OPS-14 — Business Causal/Twin/Calibration 순수 로직 단위 테스트.
// Signal(미존재 type 차단) · Temporal(효과 선행 승격 금지) · Mechanism(가설 분리) ·
// Confounder(미검토 causal 금지·보존) · Counter-Evidence(평균 제거 금지) ·
// Strength(실험 없음 strong 상한) · Confidence(감점·재정규화) · Path(depth/cycle) ·
// Propagation(피해 확정 금지) · Feedback · Counterfactual(가상) · Twin(회사 동일성 금지) ·
// Intervention · Vulnerability · Resilience(인사 평가 아님) · Eligibility(제외 보존) ·
// Calibration(표본<5·자동 수정 없음) · Metrics(0 나눗셈) · 권고 · Support.
import { describe, it, expect } from 'vitest';
import {
  validateBusinessSignal, evaluateTemporalOrder, evaluateCausalMechanism, evaluateConfounders,
  evaluateCounterEvidence, calculateCausalEvidenceStrength, calculateCausalConfidence,
  buildCausalPath, calculatePropagation, detectFeedbackLoop, simulateCounterfactual,
  evaluateTwinInputCoverage, simulateCorporateTwin, simulateIntervention,
  detectVulnerabilityChain, calculateBusinessResilience, evaluateCalibrationEligibility,
  calculateConfidenceCalibrationV2, calculateCalibrationMetrics, buildConfidenceAdjustmentRecommendation,
  calculateCausalRisk, buildCausalRecommendation, CAUSAL_SUPPORT,
  type CausalEdge, type CalibrationSample,
} from './businessCausalIntelligence';

const D = (s: string) => new Date(s);

describe('Signal / Temporal Order', () => {
  it('signal 검증 — type whitelist·metric null 허용(0 변환 없음)·음수 표본 차단', () => {
    expect(validateBusinessSignal({ type: 'mrr_change', metricName: 'mrr', metricValue: 100, evidence: [1] })).toEqual([]);
    expect(validateBusinessSignal({ type: 'auto_execute', metricName: 'x', evidence: [1] }).some((e) => e.includes('type'))).toBe(true);
    expect(validateBusinessSignal({ type: 'manual', metricName: 'x', metricValue: null, evidence: [1] })).toEqual([]);
    expect(validateBusinessSignal({ type: 'manual', metricName: 'x', metricValue: NaN, evidence: [1] }).some((e) => e.includes('NaN'))).toBe(true);
    expect(validateBusinessSignal({ type: 'manual', metricName: 'x', sampleSize: -3, evidence: [1] }).some((e) => e.includes('음수'))).toBe(true);
    expect(validateBusinessSignal(null)).toEqual(['signal 없음']);
  });
  it('시간 순서 — 효과 선행이면 direct 승격 금지', () => {
    expect(evaluateTemporalOrder(D('2026-01-01'), D('2026-02-01'))).toEqual({ order: 'cause_precedes_effect', directCandidateAllowed: true });
    expect(evaluateTemporalOrder(D('2026-02-01'), D('2026-01-01')).directCandidateAllowed).toBe(false);
    expect(evaluateTemporalOrder(D('2026-02-01'), D('2026-01-01')).order).toBe('effect_precedes_cause');
    expect(evaluateTemporalOrder(D('2026-01-01'), D('2026-01-01')).order).toBe('simultaneous');
    expect(evaluateTemporalOrder(null, D('2026-01-01')).order).toBe('insufficient_data');
  });
});

describe('Mechanism / Confounder / Counter-Evidence', () => {
  it('mechanism — supported/partial/hypothesis/missing', () => {
    expect(evaluateCausalMechanism({ hypothesis: 'h', supportedPaths: 3, totalPaths: 3 })).toBe('mechanism_supported');
    expect(evaluateCausalMechanism({ hypothesis: 'h', supportedPaths: 1, totalPaths: 3 })).toBe('partially_supported');
    expect(evaluateCausalMechanism({ hypothesis: 'h', supportedPaths: null, totalPaths: null })).toBe('mechanism_hypothesis_only');
    expect(evaluateCausalMechanism({ hypothesis: ' ', supportedPaths: 3, totalPaths: 3 })).toBe('mechanism_missing');
  });
  it('confounder — 미검토/possible/material · 목록 보존(자동 제거 없음)', () => {
    expect(evaluateConfounders(null).status).toBe('confounders_unreviewed');
    expect(evaluateConfounders([]).status).toBe('reviewed_no_material_confounder');
    const r = evaluateConfounders([{ name: 'season', material: false }, { name: 'price_change', material: true }]);
    expect(r.status).toBe('material_confounder');
    expect(r.preserved).toEqual(['season', 'price_change']);
    expect(evaluateConfounders([{ name: 'release', material: null }]).status).toBe('possible_confounder');
  });
  it('counter-evidence — none/limited/material/dominant/conflicting', () => {
    expect(evaluateCounterEvidence({ counterCount: 0, supportingCount: 5 })).toBe('no_known_counter_evidence');
    expect(evaluateCounterEvidence({ counterCount: 1, supportingCount: 9 })).toBe('limited_counter_evidence');
    expect(evaluateCounterEvidence({ counterCount: 3, supportingCount: 7 })).toBe('material_counter_evidence');
    expect(evaluateCounterEvidence({ counterCount: 5, supportingCount: 5 })).toBe('conflicting_evidence');
    expect(evaluateCounterEvidence({ counterCount: 3, supportingCount: 0 })).toBe('dominant_counter_evidence');
    expect(evaluateCounterEvidence({ counterCount: null, supportingCount: 5 })).toBe('insufficient_data');
  });
});

describe('Evidence Strength / Causal Confidence', () => {
  const base = { temporalOrder: 'cause_precedes_effect' as const, mechanism: 'mechanism_supported' as const, scopeMatch: true, baselineQuality: 90, sampleSize: 10, repeatability: 90, hasExperimentalEvidence: true, confounderStatus: 'reviewed_no_material_confounder' as const, counterStatus: 'no_known_counter_evidence' as const };
  it('실험 근거 없으면 strong 상한 · 교란 미검토/시간 미지지 → correlational · 반증 우세 → conflicting', () => {
    expect(calculateCausalEvidenceStrength(base).strength).toBe('strong_reference');
    expect(calculateCausalEvidenceStrength(base).note).toContain('확정 아님');
    const noExp = calculateCausalEvidenceStrength({ ...base, hasExperimentalEvidence: false });
    expect(noExp.strength).toBe('moderate_reference');
    expect(noExp.note).toContain('상한 제한');
    expect(calculateCausalEvidenceStrength({ ...base, confounderStatus: 'confounders_unreviewed' }).strength).toBe('correlational_only');
    expect(calculateCausalEvidenceStrength({ ...base, temporalOrder: 'simultaneous' }).strength).toBe('correlational_only');
    expect(calculateCausalEvidenceStrength({ ...base, counterStatus: 'dominant_counter_evidence' }).strength).toBe('conflicting');
  });
  it('confidence — 교란/반증 감점·재정규화·미검토 → causality_unverified(null)', () => {
    const full = calculateCausalConfidence({ evidenceStrength: 'strong_reference', temporalOrder: 'cause_precedes_effect', mechanism: 'mechanism_supported', confounderStatus: 'reviewed_no_material_confounder', counterStatus: 'no_known_counter_evidence', repeatability: 90, dataQuality: 90, inputFreshness: 90 });
    expect(full.status).toBe('plausible_contribution');
    expect(full.confidence).not.toBeNull();
    const penalized = calculateCausalConfidence({ evidenceStrength: 'strong_reference', temporalOrder: 'cause_precedes_effect', mechanism: 'mechanism_supported', confounderStatus: 'material_confounder', counterStatus: 'material_counter_evidence', repeatability: 90, dataQuality: 90, inputFreshness: 90 });
    expect(penalized.confidence!).toBeLessThan(full.confidence!);
    expect(penalized.limitations.join(' ')).toContain('감점');
    expect(calculateCausalConfidence({ evidenceStrength: 'strong_reference', temporalOrder: 'cause_precedes_effect', mechanism: 'mechanism_supported', confounderStatus: 'confounders_unreviewed', counterStatus: 'no_known_counter_evidence', repeatability: null, dataQuality: null, inputFreshness: null }).status).toBe('causality_unverified');
    expect(calculateCausalConfidence({ evidenceStrength: 'correlational_only', temporalOrder: 'cause_precedes_effect', mechanism: 'mechanism_hypothesis_only', confounderStatus: 'possible_confounder', counterStatus: 'no_known_counter_evidence', repeatability: 50, dataQuality: 50, inputFreshness: 50 }).status).toBe('correlational_only');
  });
});

describe('Path / Propagation / Feedback', () => {
  const E = (from: string, to: string, status: CausalEdge['status'] = 'plausible_contribution'): CausalEdge => ({ from, to, status, confidence: 60 });
  it('경로 — multi-hop·depth clamp·cycle 방어·최약 status·인과 확정 문구 없음', () => {
    const r = buildCausalPath([E('enterprise', 'store'), E('store', 'streaming'), E('streaming', 'cost', 'correlational_only')], 'enterprise');
    expect(r.paths.some((p) => p.nodes.join('→') === 'enterprise→store→streaming→cost')).toBe(true);
    const long = r.paths.find((p) => p.nodes.length === 4)!;
    expect(long.weakestStatus).toBe('correlational_only');
    expect(r.note).toContain('확정 아님');
    const cyc = buildCausalPath([E('a', 'b'), E('b', 'a')], 'a', 99);
    expect(cyc.paths.every((p) => p.nodes.length <= 7)).toBe(true);
  });
  it('propagation — contained~critical·피해 확정 없음', () => {
    expect(calculatePropagation({ directCount: 0, indirectCount: 0, domainsAffected: 0, hasFeedbackLoop: false })).toBe('contained_candidate');
    expect(calculatePropagation({ directCount: 1, indirectCount: 1, domainsAffected: 2, hasFeedbackLoop: false })).toBe('limited_propagation');
    expect(calculatePropagation({ directCount: 3, indirectCount: 2, domainsAffected: 3, hasFeedbackLoop: false })).toBe('moderate_propagation');
    expect(calculatePropagation({ directCount: 5, indirectCount: 5, domainsAffected: 4, hasFeedbackLoop: false })).toBe('wide_propagation_candidate');
    expect(calculatePropagation({ directCount: 1, indirectCount: 0, domainsAffected: 1, hasFeedbackLoop: true })).toBe('critical_propagation_candidate');
    expect(calculatePropagation({ directCount: null, indirectCount: null, domainsAffected: null, hasFeedbackLoop: false })).toBe('insufficient_data');
  });
  it('feedback loop — no/reinforcing/balancing/circular', () => {
    expect(detectFeedbackLoop([E('a', 'b')]).verdict).toBe('no_known_loop');
    expect(detectFeedbackLoop([E('a', 'b'), E('b', 'a')], true).verdict).toBe('reinforcing_loop_candidate');
    expect(detectFeedbackLoop([E('a', 'b'), E('b', 'a')], false).verdict).toBe('balancing_loop_candidate');
    expect(detectFeedbackLoop([E('a', 'b'), E('b', 'a')], null).verdict).toBe('circular_dependency');
    expect(detectFeedbackLoop([]).verdict).toBe('insufficient_data');
  });
});

describe('Counterfactual / Twin / Intervention', () => {
  it('counterfactual — 가상 결과·baseline 없으면 unverified', () => {
    const r = simulateCounterfactual({ baseline: 1000, causeEffectPct: 10, interventionScalePct: -100 });
    expect(r.expected).toBe(900); expect(r.low! < r.expected! === false || r.low! <= 1000).toBe(true);
    expect(r.verified).toBe(false); expect(r.note).toContain('가상');
    expect(simulateCounterfactual({ baseline: null, causeEffectPct: 10, interventionScalePct: -100 }).note).toContain('unverified');
  });
  it('twin 입력 — complete/partial/incomplete/stale', () => {
    expect(evaluateTwinInputCoverage([{ name: 'revenue', present: true, ageDays: 1 }, { name: 'cost', present: true, ageDays: 5 }]).validation).toBe('complete_reference');
    expect(evaluateTwinInputCoverage([{ name: 'revenue', present: true, ageDays: 1 }, { name: 'cost', present: false, ageDays: null }, { name: 'capacity', present: true, ageDays: 1 }]).validation).toBe('partially_complete');
    expect(evaluateTwinInputCoverage([{ name: 'revenue', present: true, ageDays: 1 }, { name: 'cost', present: false, ageDays: null }, { name: 'x', present: false, ageDays: null }]).validation).toBe('twin_input_incomplete');
    expect(evaluateTwinInputCoverage([{ name: 'revenue', present: true, ageDays: 200 }]).validation).toBe('stale_input_candidate');
    expect(evaluateTwinInputCoverage([]).validation).toBe('insufficient_data');
  });
  it('twin 시뮬레이션 — 방향+제약 표시·회사 동일성/실제 미래 주장 금지·단일 점수 없음', () => {
    const r = simulateCorporateTwin({ name: 'store+50%', storeGrowthPct: 50, state: { stores: 100, mrr: 1000, capacityLimit: 120 } });
    expect(r.effects.find((e) => e.domain === 'store')!.direction).toBe('increase');
    expect(r.effects.find((e) => e.domain === 'cost')!.magnitudeNote).toContain('cost_unknown');
    expect(r.constraintViolations.length).toBe(1);
    expect(r.notActualFuture).toBe(true); expect(r.productionIdentical).toBe(false);
    expect(simulateCorporateTwin({ name: 'x', storeGrowthPct: null, state: { stores: null, mrr: null, capacityLimit: null } }).effects[0].magnitudeNote).toContain('twin_input_incomplete');
  });
  it('intervention — beneficial/mixed/harmful/infeasible/unverified', () => {
    expect(simulateIntervention({ positives: 2, negatives: 0, constraintViolated: false, hasBaseline: true })).toBe('beneficial_candidate');
    expect(simulateIntervention({ positives: 1, negatives: 1, constraintViolated: false, hasBaseline: true })).toBe('mixed_effect_candidate');
    expect(simulateIntervention({ positives: 0, negatives: 2, constraintViolated: false, hasBaseline: true })).toBe('harmful_candidate');
    expect(simulateIntervention({ positives: 2, negatives: 0, constraintViolated: true, hasBaseline: true })).toBe('infeasible');
    expect(simulateIntervention({ positives: 2, negatives: 0, constraintViolated: false, hasBaseline: false })).toBe('counterfactual_unverified');
  });
});

describe('Vulnerability / Resilience', () => {
  it('취약 체인 — 단일+백업 없음+체인 3+ → critical · 백업 있으면 candidate', () => {
    expect(detectVulnerabilityChain({ axis: 'provider', singlePoint: true, hasBackup: false, chainLength: 4 }).verdict).toBe('critical_vulnerability_chain');
    expect(detectVulnerabilityChain({ axis: 'admin', singlePoint: true, hasBackup: false, chainLength: 1 }).verdict).toBe('material_vulnerability');
    expect(detectVulnerabilityChain({ axis: 'payment', singlePoint: true, hasBackup: true, chainLength: 4 }).verdict).toBe('vulnerability_candidate');
    expect(detectVulnerabilityChain({ axis: 'x', singlePoint: false, hasBackup: null, chainLength: null }).verdict).toBe('resilient_reference');
    expect(detectVulnerabilityChain({ axis: 'x', singlePoint: null, hasBackup: null, chainLength: null }).verdict).toBe('insufficient_data');
  });
  it('resilience — 재정규화·인사 평가 아님·전부 null insufficient', () => {
    const hi = calculateBusinessResilience({ revenueDiversification: 90, customerDiversification: 90, providerRedundancy: 90, operationalRedundancy: 90, capacityHeadroom: 90, recoveryCapability: 90, securityReadiness: 90, auditCoverage: 90, ownerBackup: 90 });
    expect(hi.status).toBe('resilient_reference'); expect(hi.notForPersonnelEvaluation).toBe(true);
    const lo = calculateBusinessResilience({ revenueDiversification: 10, customerDiversification: 10, providerRedundancy: 0, operationalRedundancy: 10, capacityHeadroom: 10, recoveryCapability: 10, securityReadiness: 10, auditCoverage: 10, ownerBackup: 0 });
    expect(['high_vulnerability', 'critical_vulnerability']).toContain(lo.status);
    const partial = calculateBusinessResilience({ revenueDiversification: 50, customerDiversification: null, providerRedundancy: 0, operationalRedundancy: null, capacityHeadroom: null, recoveryCapability: null, securityReadiness: null, auditCoverage: null, ownerBackup: null });
    expect(partial.missing.length).toBe(7);
    expect(calculateBusinessResilience({ revenueDiversification: null, customerDiversification: null, providerRedundancy: null, operationalRedundancy: null, capacityHeadroom: null, recoveryCapability: null, securityReadiness: null, auditCoverage: null, ownerBackup: null }).status).toBe('insufficient_data');
  });
});

describe('Calibration', () => {
  it('eligibility — not_executed/pending/metric 변경/scope 불일치 제외 + 사유 보존', () => {
    const ok = { hasPrediction: true, hasConfidence: true, executed: true, outcomeObserved: true, metricDefinitionChanged: false, scopeMismatch: false, horizonEnded: true };
    expect(evaluateCalibrationEligibility(ok).eligible).toBe(true);
    expect(evaluateCalibrationEligibility({ ...ok, executed: false }).exclusionReason).toBe('not_executed');
    expect(evaluateCalibrationEligibility({ ...ok, executed: null }).exclusionReason).toBe('execution_unverified');
    expect(evaluateCalibrationEligibility({ ...ok, outcomeObserved: false }).exclusionReason).toBe('outcome_pending');
    expect(evaluateCalibrationEligibility({ ...ok, metricDefinitionChanged: true }).exclusionReason).toBe('metric_definition_changed');
    expect(evaluateCalibrationEligibility({ ...ok, scopeMismatch: true }).exclusionReason).toBe('scope_mismatch');
    expect(evaluateCalibrationEligibility({ ...ok, horizonEnded: false }).exclusionReason).toContain('미종료');
  });
  it('calibration — 표본<5 확정 금지·over/under candidate·자동 수정 없음', () => {
    const S = (c: number, correct: boolean): CalibrationSample => ({ predictedConfidence: c, directionCorrect: correct, withinRange: true });
    expect(calculateConfidenceCalibrationV2([]).status).toBe('insufficient_data');
    expect(calculateConfidenceCalibrationV2([S(90, true)]).status).toBe('calibration_sample_too_small');
    const over = calculateConfidenceCalibrationV2(Array.from({ length: 6 }, () => S(90, false)));
    expect(over.status).toBe('overconfident_candidate'); expect(over.autoAdjusted).toBe(false);
    expect(calculateConfidenceCalibrationV2(Array.from({ length: 6 }, () => S(92, true))).status).toBe('well_calibrated_reference');
    expect(calculateConfidenceCalibrationV2(Array.from({ length: 6 }, () => S(30, true))).status).toBe('underconfident_candidate');
    expect(over.note).toContain('일반화 금지');
  });
  it('metrics — MAE/%오차·actual 0/null 미계산(0 나눗셈 방어)', () => {
    const r = calculateCalibrationMetrics([{ predicted: 100, actual: 90 }, { predicted: 80, actual: 100 }]);
    expect(r.mae).toBe(15);
    expect(r.pctError).not.toBeNull();
    expect(calculateCalibrationMetrics([{ predicted: 100, actual: 0 }]).pctError).toBeNull();
    expect(calculateCalibrationMetrics([{ predicted: null, actual: null }]).mae).toBeNull();
    expect(buildConfidenceAdjustmentRecommendation('overconfident_candidate').adjustmentType).toBe('review_overconfidence_pattern');
    expect(buildConfidenceAdjustmentRecommendation('calibration_sample_too_small').adjustmentType).toBe('require_more_observation');
    expect(buildConfidenceAdjustmentRecommendation('well_calibrated_reference').autoApplied).toBe(false);
  });
});

describe('Risk / Recommendation / Support', () => {
  it('causal risk — 재정규화·전부 null insufficient', () => {
    expect(calculateCausalRisk({ unsupportedClaimRisk: null, confounderRisk: null, counterEvidenceRisk: null, staleInputRisk: null, experimentalGapRisk: null, calibrationGapRisk: null, twinInputGapRisk: null, propagationRisk: null, vulnerabilityRisk: null }).level).toBe('insufficient_data');
    expect(calculateCausalRisk({ unsupportedClaimRisk: 80, confounderRisk: 80, counterEvidenceRisk: 80, staleInputRisk: 80, experimentalGapRisk: 80, calibrationGapRisk: 80, twinInputGapRisk: 80, propagationRisk: 80, vulnerabilityRisk: 80 }).level).toBe('critical');
    expect(calculateCausalRisk({ unsupportedClaimRisk: 10, confounderRisk: 10, counterEvidenceRisk: null, staleInputRisk: null, experimentalGapRisk: null, calibrationGapRisk: null, twinInputGapRisk: null, propagationRisk: null, vulnerabilityRisk: null }).level).toBe('low');
  });
  it('권고 — Evidence 필수·Human Approval·결정적·유형 whitelist', () => {
    const ok = buildCausalRecommendation({ code: 'c1', recType: 'review_confounders', finding: '교란 미검토 후보 3건', evidenceCount: 3, severity: 'high' });
    if ('insufficient' in ok) throw new Error('unexpected');
    expect(ok.humanApprovalRequired).toBe(true); expect(ok.noAutoExecution).toBe(true);
    expect(ok.recommendation).toContain('확정');
    expect('insufficient' in buildCausalRecommendation({ code: 'c2', recType: 'review_confounders', finding: 'x', evidenceCount: 0 })).toBe(true);
    expect('insufficient' in buildCausalRecommendation({ code: 'c3', recType: 'confirm_causality' as never, finding: 'x', evidenceCount: 3 })).toBe(true);
    expect(ok).toEqual(buildCausalRecommendation({ code: 'c1', recType: 'review_confounders', finding: '교란 미검토 후보 3건', evidenceCount: 3, severity: 'high' }));
  });
  it('Support Matrix — 실험 설계 unavailable·자동 인과/개입/Confidence 전부 unsupported', () => {
    expect(CAUSAL_SUPPORT.find((s) => s.key === 'experimental_design')!.status).toBe('experimental_evidence_unavailable');
    expect(CAUSAL_SUPPORT.find((s) => s.key === 'counterfactual')!.status).toBe('counterfactual_unverified');
    expect(CAUSAL_SUPPORT.find((s) => s.key === 'corporate_twin')!.status).toBe('twin_input_incomplete');
    expect(CAUSAL_SUPPORT.find((s) => s.key === 'causal_ml')!.status).toBe('unsupported');
    for (const k of ['auto_causality', 'auto_intervention', 'auto_confidence', 'production_apply']) {
      expect(CAUSAL_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
