/**
 * businessCausalIntelligence — 사업 인과 후보/Digital Twin/Confidence Calibration 순수 로직
 * (Phase AI-OPS-14).
 *
 * Signal → Causal Candidate → Temporal/Mechanism/Confounder/Counter-Evidence →
 * Causal Confidence → Path/Propagation/Feedback → Counterfactual → Corporate Twin →
 * Vulnerability/Resilience → Confidence Record → Calibration → 권고.
 *
 * 인과 정직성(전부 코드로 강제):
 *  - 시간 선행/상관/KG 관계를 인과로 자동 승격하지 않음. causal_confirmed 없음.
 *  - 효과 선행 → direct 승격 금지. 교란 미검토 → causal 표시 금지. 교란/반증 보존.
 *  - 실험 근거 없으면 strong 상한 제한. Counterfactual = 가상(실제 아님).
 *  - Twin ≠ 실제 회사/미래. Calibration 표본<5 확정 금지·자동 Confidence 수정 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · depth/cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type TemporalOrder = 'cause_precedes_effect' | 'effect_precedes_cause' | 'simultaneous' | 'time_order_unclear' | 'insufficient_data';
export type MechanismStatus = 'mechanism_supported' | 'partially_supported' | 'mechanism_hypothesis_only' | 'mechanism_missing' | 'insufficient_data';
export type ConfounderStatus = 'reviewed_no_material_confounder' | 'possible_confounder' | 'material_confounder' | 'confounders_unreviewed' | 'insufficient_data';
export type CounterEvidenceStatus = 'no_known_counter_evidence' | 'limited_counter_evidence' | 'material_counter_evidence' | 'dominant_counter_evidence' | 'conflicting_evidence' | 'insufficient_data';
export type CausalEvidenceStrength = 'strong_reference' | 'moderate_reference' | 'weak_reference' | 'correlational_only' | 'conflicting' | 'insufficient_data';
export type CausalStatus = 'draft' | 'correlational_only' | 'temporally_supported' | 'mechanism_supported' | 'plausible_contribution' | 'experimentally_supported_reference' | 'conflicting_evidence' | 'causality_unverified' | 'rejected' | 'invalidated' | 'insufficient_data';
export type PropagationVerdict = 'contained_candidate' | 'limited_propagation' | 'moderate_propagation' | 'wide_propagation_candidate' | 'critical_propagation_candidate' | 'insufficient_data';
export type FeedbackVerdict = 'no_known_loop' | 'reinforcing_loop_candidate' | 'balancing_loop_candidate' | 'harmful_loop_candidate' | 'circular_dependency' | 'insufficient_data';
export type TwinInputValidation = 'complete_reference' | 'partially_complete' | 'twin_input_incomplete' | 'stale_input_candidate' | 'scope_unverified' | 'insufficient_data';
export type VulnerabilityVerdict = 'resilient_reference' | 'vulnerability_candidate' | 'material_vulnerability' | 'critical_vulnerability_chain' | 'insufficient_data';
export type ResilienceStatus = 'resilient_reference' | 'moderately_resilient' | 'vulnerable_candidate' | 'high_vulnerability' | 'critical_vulnerability' | 'insufficient_data';
export type CalibrationStatus = 'well_calibrated_reference' | 'overconfident_candidate' | 'underconfident_candidate' | 'mixed_calibration' | 'calibration_sample_too_small' | 'causality_unverified' | 'insufficient_data';

export const MAX_CAUSAL_DEPTH_DEFAULT = 4;
export const MAX_CAUSAL_DEPTH_CLAMP = 6;

/* ── Signal / Candidate 검증 ─────────────────────────────────────────── */
export const SIGNAL_TYPES = ['revenue_change', 'mrr_change', 'store_growth', 'enterprise_growth', 'artist_growth', 'track_growth', 'contract_change', 'renewal_change', 'churn_change', 'streaming_change', 'playback_quality_change', 'playlist_performance_change', 'settlement_change', 'payout_change', 'cost_change', 'capacity_change', 'incident_change', 'recovery_change', 'security_risk_change', 'operational_risk_change', 'policy_change_reference', 'strategic_decision_reference', 'external_event_reference', 'manual'] as const;

export function validateBusinessSignal(s: { type?: string; metricName?: string | null; metricValue?: number | null; sampleSize?: number | null; evidence?: unknown[] | null } | null): string[] {
  if (!s) return ['signal 없음'];
  const errors: string[] = [];
  if (!s.type || !(SIGNAL_TYPES as readonly string[]).includes(s.type)) errors.push('허용되지 않는 signal type');
  if (!s.metricName?.trim()) errors.push('metric_name 필수');
  if (!s.evidence?.length) errors.push('Evidence 필수');
  if (s.metricValue != null && !isFiniteNumber(s.metricValue)) errors.push('metric NaN/Infinity 금지');
  if (s.sampleSize != null && (!isFiniteNumber(s.sampleSize) || s.sampleSize < 0)) errors.push('sample_size 음수 금지');
  return errors;   // metric null 은 오류 아님(0 변환 금지 — insufficient 처리)
}

/* ── Temporal Order(효과 선행 → direct 승격 금지) ────────────────────── */
export function evaluateTemporalOrder(causeAt: Date | null, effectAt: Date | null): { order: TemporalOrder; directCandidateAllowed: boolean } {
  if (!causeAt || !effectAt) return { order: 'insufficient_data', directCandidateAllowed: false };
  if (causeAt.getTime() < effectAt.getTime()) return { order: 'cause_precedes_effect', directCandidateAllowed: true };
  if (causeAt.getTime() > effectAt.getTime()) return { order: 'effect_precedes_cause', directCandidateAllowed: false };
  return { order: 'simultaneous', directCandidateAllowed: false };
}

/* ── Mechanism(가설과 지지 분리) ─────────────────────────────────────── */
export function evaluateCausalMechanism(i: { hypothesis: string | null; supportedPaths: number | null; totalPaths: number | null }): MechanismStatus {
  if (!i.hypothesis?.trim()) return 'mechanism_missing';
  if (!isFiniteNumber(i.supportedPaths) || !isFiniteNumber(i.totalPaths) || i.totalPaths <= 0) return 'mechanism_hypothesis_only';
  if (i.supportedPaths === i.totalPaths) return 'mechanism_supported';
  if (i.supportedPaths > 0) return 'partially_supported';
  return 'mechanism_hypothesis_only';
}

/* ── Confounder / Counter-Evidence(보존 — 제거 금지) ─────────────────── */
export function evaluateConfounders(confounders: { name: string; material: boolean | null }[] | null): { status: ConfounderStatus; preserved: string[] } {
  if (confounders == null) return { status: 'confounders_unreviewed', preserved: [] };
  const preserved = confounders.map((c) => c.name);
  if (!confounders.length) return { status: 'reviewed_no_material_confounder', preserved };
  if (confounders.some((c) => c.material === true)) return { status: 'material_confounder', preserved };
  return { status: 'possible_confounder', preserved };
}

export function evaluateCounterEvidence(i: { counterCount: number | null; supportingCount: number | null }): CounterEvidenceStatus {
  if (!isFiniteNumber(i.counterCount)) return 'insufficient_data';
  if (i.counterCount === 0) return 'no_known_counter_evidence';
  if (!isFiniteNumber(i.supportingCount) || i.supportingCount === 0) return 'dominant_counter_evidence';
  const ratio = i.counterCount / (i.counterCount + i.supportingCount);
  if (ratio >= 0.5) return 'conflicting_evidence';
  if (ratio >= 0.25) return 'material_counter_evidence';
  return 'limited_counter_evidence';
}

/* ── Evidence Strength / Causal Confidence ───────────────────────────── */
export function calculateCausalEvidenceStrength(c: {
  temporalOrder: TemporalOrder; mechanism: MechanismStatus; scopeMatch: boolean | null;
  baselineQuality: number | null; sampleSize: number | null; repeatability: number | null;
  hasExperimentalEvidence: boolean; confounderStatus: ConfounderStatus; counterStatus: CounterEvidenceStatus;
}): { strength: CausalEvidenceStrength; note: string } {
  if (c.counterStatus === 'conflicting_evidence' || c.counterStatus === 'dominant_counter_evidence') return { strength: 'conflicting', note: '반증 우세/충돌 — 보존(평균 제거 없음)' };
  if (c.confounderStatus === 'confounders_unreviewed') return { strength: 'correlational_only', note: '교란 요인 미검토 — causal 표시 금지' };
  if (c.temporalOrder !== 'cause_precedes_effect') return { strength: 'correlational_only', note: '시간 순서 미지지' };
  const { score } = normalizeAvailableComponents([
    { key: 'mechanism', value: c.mechanism === 'mechanism_supported' ? 100 : c.mechanism === 'partially_supported' ? 60 : c.mechanism === 'mechanism_hypothesis_only' ? 30 : 0, weight: 0.25 },
    { key: 'scope', value: c.scopeMatch == null ? null : c.scopeMatch ? 100 : 0, weight: 0.15 },
    { key: 'baseline', value: c.baselineQuality, weight: 0.15 },
    { key: 'sample', value: isFiniteNumber(c.sampleSize) ? Math.min(100, c.sampleSize * 10) : null, weight: 0.2 },
    { key: 'repeatability', value: c.repeatability, weight: 0.25 },
  ]);
  if (score == null) return { strength: 'insufficient_data', note: '성분 없음' };
  let strength: CausalEvidenceStrength = score >= 75 ? 'strong_reference' : score >= 50 ? 'moderate_reference' : 'weak_reference';
  if (strength === 'strong_reference' && !c.hasExperimentalEvidence) {
    strength = 'moderate_reference';   // 실험 Evidence 없으면 strong 상한 제한
    return { strength, note: '실험 근거 없음 — strong 상한 제한(관찰 데이터 기반)' };
  }
  return { strength, note: strength === 'strong_reference' ? 'strong_reference — 절대 확정 아님' : '관찰 기반 참고' };
}

export function calculateCausalConfidence(c: {
  evidenceStrength: CausalEvidenceStrength; temporalOrder: TemporalOrder; mechanism: MechanismStatus;
  confounderStatus: ConfounderStatus; counterStatus: CounterEvidenceStatus;
  repeatability: number | null; dataQuality: number | null; inputFreshness: number | null;
}): { confidence: number | null; status: CausalStatus; limitations: string[] } {
  const limitations = ['후보 — 절대적 인과 확정 아님'];
  if (c.confounderStatus === 'confounders_unreviewed') return { confidence: null, status: 'causality_unverified', limitations: [...limitations, 'confounders_unreviewed'] };
  if (c.counterStatus === 'conflicting_evidence') return { confidence: null, status: 'conflicting_evidence', limitations: [...limitations, '반증 충돌'] };
  const strengthScore = c.evidenceStrength === 'strong_reference' ? 90 : c.evidenceStrength === 'moderate_reference' ? 65 : c.evidenceStrength === 'weak_reference' ? 40 : c.evidenceStrength === 'correlational_only' ? 20 : null;
  const { score } = normalizeAvailableComponents([
    { key: 'strength', value: strengthScore, weight: 0.3 },
    { key: 'temporal', value: c.temporalOrder === 'cause_precedes_effect' ? 100 : 0, weight: 0.15 },
    { key: 'mechanism', value: c.mechanism === 'mechanism_supported' ? 100 : c.mechanism === 'partially_supported' ? 60 : 20, weight: 0.2 },
    { key: 'repeatability', value: c.repeatability, weight: 0.15 },
    { key: 'data_quality', value: c.dataQuality, weight: 0.1 },
    { key: 'freshness', value: c.inputFreshness, weight: 0.1 },
  ]);
  if (score == null) return { confidence: null, status: 'insufficient_data', limitations };
  let penalized = score;
  if (c.confounderStatus === 'material_confounder') { penalized -= 25; limitations.push('material confounder 감점'); }
  if (c.counterStatus === 'material_counter_evidence') { penalized -= 20; limitations.push('반증 감점(보존)'); }
  const confidence = clampScore(penalized);
  const status: CausalStatus = c.evidenceStrength === 'correlational_only' ? 'correlational_only'
    : confidence >= 60 && c.mechanism === 'mechanism_supported' ? 'plausible_contribution'
    : c.temporalOrder === 'cause_precedes_effect' ? 'temporally_supported' : 'correlational_only';
  return { confidence, status, limitations };
}

/* ── Causal Path / Propagation / Feedback(depth·cycle 방어) ──────────── */
export interface CausalEdge { from: string; to: string; status: CausalStatus; confidence: number | null }

export function buildCausalPath(edges: CausalEdge[], startId: string, maxDepth = MAX_CAUSAL_DEPTH_DEFAULT): { paths: { nodes: string[]; weakestStatus: CausalStatus }[]; note: string } {
  const depth = Math.max(1, Math.min(MAX_CAUSAL_DEPTH_CLAMP, maxDepth));
  const adj = new Map<string, CausalEdge[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e]);
  const order: CausalStatus[] = ['insufficient_data', 'causality_unverified', 'correlational_only', 'draft', 'conflicting_evidence', 'temporally_supported', 'mechanism_supported', 'plausible_contribution', 'experimentally_supported_reference', 'rejected', 'invalidated'];
  const paths: { nodes: string[]; weakestStatus: CausalStatus }[] = [];
  const dfs = (node: string, trail: string[], weakest: CausalStatus) => {
    if (paths.length >= 100) return;
    if (trail.length > 1) paths.push({ nodes: [...trail], weakestStatus: weakest });
    if (trail.length - 1 >= depth) return;
    for (const e of adj.get(node) ?? []) {
      if (trail.includes(e.to)) continue;   // cycle 방어
      const w = order.indexOf(e.status) < order.indexOf(weakest) ? e.status : weakest;
      dfs(e.to, [...trail, e.to], w);
    }
  };
  dfs(startId, [startId], 'experimentally_supported_reference');
  return { paths, note: '경로 = 후보 연결 — 인과 확정 아님(최약 status 표시)' };
}

export function calculatePropagation(i: { directCount: number | null; indirectCount: number | null; domainsAffected: number | null; hasFeedbackLoop: boolean }): PropagationVerdict {
  if (!isFiniteNumber(i.directCount)) return 'insufficient_data';
  const total = i.directCount + (isFiniteNumber(i.indirectCount) ? i.indirectCount : 0);
  if (i.hasFeedbackLoop || (isFiniteNumber(i.domainsAffected) && i.domainsAffected >= 5)) return 'critical_propagation_candidate';
  if (total === 0) return 'contained_candidate';
  if (total <= 2) return 'limited_propagation';
  if (total <= 5) return 'moderate_propagation';
  return 'wide_propagation_candidate';
}

export function detectFeedbackLoop(edges: CausalEdge[], reinforcing: boolean | null = null): { verdict: FeedbackVerdict; loops: string[][] } {
  if (!edges.length) return { verdict: 'insufficient_data', loops: [] };
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const loops: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); const stack: string[] = [];
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].slice(0, 200);
  const dfs = (n: string) => {
    state.set(n, 1); stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 0) dfs(m);
      else if (s === 1) { const idx = stack.indexOf(m); if (idx >= 0) loops.push([...stack.slice(idx), m]); }
    }
    stack.pop(); state.set(n, 2);
  };
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) { stack.length = 0; dfs(n); }
  if (!loops.length) return { verdict: 'no_known_loop', loops: [] };
  if (reinforcing == null) return { verdict: 'circular_dependency', loops };
  return { verdict: reinforcing ? 'reinforcing_loop_candidate' : 'balancing_loop_candidate', loops };
}

/* ── Counterfactual(가상 — 실제 아님) ────────────────────────────────── */
export function simulateCounterfactual(i: { baseline: number | null; causeEffectPct: number | null; interventionScalePct: number | null }): { expected: number | null; low: number | null; high: number | null; verified: false; note: string } {
  if (!isFiniteNumber(i.baseline) || !isFiniteNumber(i.causeEffectPct) || !isFiniteNumber(i.interventionScalePct)) {
    return { expected: null, low: null, high: null, verified: false, note: 'baseline/효과 추정 없음 — counterfactual_unverified' };
  }
  const delta = i.baseline * (i.causeEffectPct / 100) * (i.interventionScalePct / 100);
  const expected = Math.round(i.baseline + delta);
  return {
    expected, low: Math.round(i.baseline + delta * 0.5), high: Math.round(i.baseline + delta * 1.5),
    verified: false, note: '실제 일어나지 않은 가상 결과 — 검증 불가(counterfactual_unverified)',
  };
}

/* ── Corporate Digital Twin ──────────────────────────────────────────── */
export function evaluateTwinInputCoverage(inputs: { name: string; present: boolean; ageDays: number | null }[], staleDays = 90): { validation: TwinInputValidation; coverage: number | null; missing: string[] } {
  if (!inputs.length) return { validation: 'insufficient_data', coverage: null, missing: [] };
  const missing = inputs.filter((i) => !i.present).map((i) => i.name);
  const coverage = Math.round(((inputs.length - missing.length) / inputs.length) * 100);
  if (inputs.some((i) => i.present && isFiniteNumber(i.ageDays) && i.ageDays > staleDays)) return { validation: 'stale_input_candidate', coverage, missing };
  if (coverage === 100) return { validation: 'complete_reference', coverage, missing };
  if (coverage >= 60) return { validation: 'partially_complete', coverage, missing };
  return { validation: 'twin_input_incomplete', coverage, missing };
}

export interface TwinSimResult {
  name: string; effects: { domain: string; direction: 'increase' | 'decrease' | 'unknown'; magnitudeNote: string }[];
  constraintViolations: string[]; notActualFuture: true; productionIdentical: false;
}

/** 결정적 Twin 시뮬레이션 — 집계 상태 기반 방향/제약 위반 표시(단일 종합점수 없음). */
export function simulateCorporateTwin(i: { name: string; storeGrowthPct: number | null; state: { stores: number | null; mrr: number | null; capacityLimit: number | null } }): TwinSimResult {
  const effects: TwinSimResult['effects'] = [];
  const violations: string[] = [];
  if (isFiniteNumber(i.storeGrowthPct) && isFiniteNumber(i.state.stores)) {
    const projected = i.state.stores * (1 + i.storeGrowthPct / 100);
    effects.push({ domain: 'store', direction: i.storeGrowthPct >= 0 ? 'increase' : 'decrease', magnitudeNote: `매장 ${i.state.stores} → ~${Math.round(projected)}(투영)` });
    effects.push({ domain: 'revenue', direction: i.storeGrowthPct >= 0 ? 'increase' : 'decrease', magnitudeNote: 'MRR 방향 후보 — 크기 미확정(탄력성 미지)' });
    effects.push({ domain: 'cost', direction: i.storeGrowthPct >= 0 ? 'increase' : 'decrease', magnitudeNote: '단가 없음 — cost_unknown' });
    effects.push({ domain: 'capacity', direction: i.storeGrowthPct >= 0 ? 'increase' : 'decrease', magnitudeNote: isFiniteNumber(i.state.capacityLimit) ? `limit ${i.state.capacityLimit} 대비 검토` : 'limit 미상 — capacity_unknown' });
    if (isFiniteNumber(i.state.capacityLimit) && projected > i.state.capacityLimit) violations.push(`capacity limit(${i.state.capacityLimit}) 초과 투영`);
  } else {
    effects.push({ domain: 'store', direction: 'unknown', magnitudeNote: '입력 부족 — twin_input_incomplete' });
  }
  return { name: i.name, effects, constraintViolations: violations, notActualFuture: true, productionIdentical: false };
}

export type InterventionVerdict = 'beneficial_candidate' | 'mixed_effect_candidate' | 'neutral_candidate' | 'harmful_candidate' | 'infeasible' | 'counterfactual_unverified' | 'insufficient_data';
export function simulateIntervention(i: { positives: number | null; negatives: number | null; constraintViolated: boolean; hasBaseline: boolean }): InterventionVerdict {
  if (!i.hasBaseline) return 'counterfactual_unverified';
  if (i.constraintViolated) return 'infeasible';
  if (!isFiniteNumber(i.positives) || !isFiniteNumber(i.negatives)) return 'insufficient_data';
  if (i.positives > 0 && i.negatives === 0) return 'beneficial_candidate';
  if (i.positives > 0 && i.negatives > 0) return 'mixed_effect_candidate';
  if (i.positives === 0 && i.negatives > 0) return 'harmful_candidate';
  return 'neutral_candidate';
}

/* ── Vulnerability / Resilience ──────────────────────────────────────── */
export function detectVulnerabilityChain(i: { axis: string; singlePoint: boolean | null; hasBackup: boolean | null; chainLength: number | null }): { axis: string; verdict: VulnerabilityVerdict } {
  if (i.singlePoint == null) return { axis: i.axis, verdict: 'insufficient_data' };
  if (!i.singlePoint) return { axis: i.axis, verdict: 'resilient_reference' };
  if (i.hasBackup === true) return { axis: i.axis, verdict: 'vulnerability_candidate' };
  if (isFiniteNumber(i.chainLength) && i.chainLength >= 3) return { axis: i.axis, verdict: 'critical_vulnerability_chain' };
  return { axis: i.axis, verdict: 'material_vulnerability' };
}

export function calculateBusinessResilience(c: {
  revenueDiversification: number | null; customerDiversification: number | null; providerRedundancy: number | null;
  operationalRedundancy: number | null; capacityHeadroom: number | null; recoveryCapability: number | null;
  securityReadiness: number | null; auditCoverage: number | null; ownerBackup: number | null;
}): { score: number | null; status: ResilienceStatus; missing: string[]; notForPersonnelEvaluation: true } {
  const { score, missing } = normalizeAvailableComponents([
    { key: 'revenue_div', value: c.revenueDiversification, weight: 0.15 },
    { key: 'customer_div', value: c.customerDiversification, weight: 0.12 },
    { key: 'provider_redundancy', value: c.providerRedundancy, weight: 0.15 },
    { key: 'operational_redundancy', value: c.operationalRedundancy, weight: 0.1 },
    { key: 'capacity_headroom', value: c.capacityHeadroom, weight: 0.12 },
    { key: 'recovery', value: c.recoveryCapability, weight: 0.12 },
    { key: 'security', value: c.securityReadiness, weight: 0.1 },
    { key: 'audit', value: c.auditCoverage, weight: 0.07 },
    { key: 'owner_backup', value: c.ownerBackup, weight: 0.07 },
  ]);
  if (score == null) return { score: null, status: 'insufficient_data', missing, notForPersonnelEvaluation: true };
  const status: ResilienceStatus = score >= 75 ? 'resilient_reference' : score >= 55 ? 'moderately_resilient' : score >= 35 ? 'vulnerable_candidate' : score >= 20 ? 'high_vulnerability' : 'critical_vulnerability';
  return { score, status, missing, notForPersonnelEvaluation: true };
}

/* ── Calibration Eligibility / Calibration ───────────────────────────── */
export function evaluateCalibrationEligibility(i: {
  hasPrediction: boolean; hasConfidence: boolean; executed: boolean | null;
  outcomeObserved: boolean; metricDefinitionChanged: boolean; scopeMismatch: boolean; horizonEnded: boolean;
}): { eligible: boolean; exclusionReason: string | null } {
  if (!i.hasPrediction || !i.hasConfidence) return { eligible: false, exclusionReason: 'prediction/confidence 없음' };
  if (i.executed === false) return { eligible: false, exclusionReason: 'not_executed' };
  if (i.executed == null) return { eligible: false, exclusionReason: 'execution_unverified' };
  if (!i.horizonEnded) return { eligible: false, exclusionReason: 'prediction horizon 미종료' };
  if (!i.outcomeObserved) return { eligible: false, exclusionReason: 'outcome_pending' };
  if (i.metricDefinitionChanged) return { eligible: false, exclusionReason: 'metric_definition_changed' };
  if (i.scopeMismatch) return { eligible: false, exclusionReason: 'scope_mismatch' };
  return { eligible: true, exclusionReason: null };
}

export interface CalibrationSample { predictedConfidence: number | null; directionCorrect: boolean | null; withinRange: boolean | null }

export function calculateConfidenceCalibrationV2(samples: CalibrationSample[], minSample = 5): {
  status: CalibrationStatus; sampleSize: number; avgConfidence: number | null; directionAccuracy: number | null; rangeCoverage: number | null; confidenceGap: number | null;
  autoAdjusted: false; note: string;
} {
  const evaluable = samples.filter((s) => isFiniteNumber(s.predictedConfidence) && s.directionCorrect != null);
  const base = { autoAdjusted: false as const, note: '모델 전체 성능 일반화 금지 · 자동 Confidence 수정 없음' };
  if (!samples.length) return { status: 'insufficient_data', sampleSize: 0, avgConfidence: null, directionAccuracy: null, rangeCoverage: null, confidenceGap: null, ...base };
  if (evaluable.length < minSample) return { status: 'calibration_sample_too_small', sampleSize: evaluable.length, avgConfidence: null, directionAccuracy: null, rangeCoverage: null, confidenceGap: null, ...base };
  const avgConf = evaluable.reduce((a, s) => a + (s.predictedConfidence as number), 0) / evaluable.length;
  const accuracy = (evaluable.filter((s) => s.directionCorrect).length / evaluable.length) * 100;
  const rangeSamples = evaluable.filter((s) => s.withinRange != null);
  const rangeCoverage = rangeSamples.length ? Math.round((rangeSamples.filter((s) => s.withinRange).length / rangeSamples.length) * 100) : null;
  const gap = Math.round(avgConf - accuracy);
  const status: CalibrationStatus = Math.abs(gap) <= 15 ? 'well_calibrated_reference' : gap > 15 ? 'overconfident_candidate' : 'underconfident_candidate';
  return { status, sampleSize: evaluable.length, avgConfidence: Math.round(avgConf), directionAccuracy: Math.round(accuracy), rangeCoverage, confidenceGap: gap, ...base };
}

export function calculateCalibrationMetrics(pairs: { predicted: number | null; actual: number | null }[]): { mae: number | null; pctError: number | null; note: string } {
  const valid = pairs.filter((p) => isFiniteNumber(p.predicted) && isFiniteNumber(p.actual));
  if (!valid.length) return { mae: null, pctError: null, note: '유효 표본 없음 — 계산 금지(0 나눗셈/0 대체 없음)' };
  const mae = valid.reduce((a, p) => a + Math.abs((p.predicted as number) - (p.actual as number)), 0) / valid.length;
  const pctValid = valid.filter((p) => (p.actual as number) !== 0);
  const pctError = pctValid.length ? pctValid.reduce((a, p) => a + Math.abs(((p.predicted as number) - (p.actual as number)) / Math.abs(p.actual as number)) * 100, 0) / pctValid.length : null;
  return { mae: Math.round(mae * 10) / 10, pctError: pctError == null ? null : Math.round(pctError * 10) / 10, note: pctError == null ? 'actual 0 표본 — % 오차 미계산' : '오차 추정' };
}

export const CONFIDENCE_ADJUSTMENT_TYPES = ['retain_confidence_method', 'reduce_confidence_candidate', 'increase_confidence_candidate', 'widen_prediction_range', 'require_more_observation', 'require_domain_specific_calibration', 'require_scenario_specific_calibration', 'require_forecast_method_review', 'exclude_low_quality_outcomes', 'review_overconfidence_pattern', 'review_underconfidence_pattern', 'insufficient_data'] as const;

export function buildConfidenceAdjustmentRecommendation(status: CalibrationStatus): { adjustmentType: (typeof CONFIDENCE_ADJUSTMENT_TYPES)[number]; autoApplied: false } {
  const adjustmentType = status === 'overconfident_candidate' ? 'review_overconfidence_pattern'
    : status === 'underconfident_candidate' ? 'review_underconfidence_pattern'
    : status === 'well_calibrated_reference' ? 'retain_confidence_method'
    : status === 'calibration_sample_too_small' ? 'require_more_observation'
    : 'insufficient_data';
  return { adjustmentType, autoApplied: false };
}

/* ── Causal Risk / Recommendation ────────────────────────────────────── */
export function calculateCausalRisk(c: {
  unsupportedClaimRisk: number | null; confounderRisk: number | null; counterEvidenceRisk: number | null;
  staleInputRisk: number | null; experimentalGapRisk: number | null; calibrationGapRisk: number | null;
  twinInputGapRisk: number | null; propagationRisk: number | null; vulnerabilityRisk: number | null;
}): { score: number | null; level: 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data' } {
  const { score } = normalizeAvailableComponents([
    { key: 'unsupported_claim', value: c.unsupportedClaimRisk, weight: 0.15 },
    { key: 'confounder', value: c.confounderRisk, weight: 0.12 },
    { key: 'counter_evidence', value: c.counterEvidenceRisk, weight: 0.12 },
    { key: 'stale', value: c.staleInputRisk, weight: 0.08 },
    { key: 'experimental_gap', value: c.experimentalGapRisk, weight: 0.13 },
    { key: 'calibration_gap', value: c.calibrationGapRisk, weight: 0.12 },
    { key: 'twin_gap', value: c.twinInputGapRisk, weight: 0.08 },
    { key: 'propagation', value: c.propagationRisk, weight: 0.1 },
    { key: 'vulnerability', value: c.vulnerabilityRisk, weight: 0.1 },
  ]);
  if (score == null) return { score: null, level: 'insufficient_data' };
  return { score, level: score < 25 ? 'low' : score < 50 ? 'moderate' : score < 75 ? 'high' : 'critical' };
}

export const CAUSAL_REC_TYPES = ['request_more_evidence', 'review_confounders', 'review_counter_evidence', 'run_controlled_experiment_candidate', 'extend_observation_window', 'validate_mechanism', 'validate_scope_match', 'reject_spurious_correlation_candidate', 'review_reverse_causality', 'build_counterfactual', 'refresh_digital_twin', 'reduce_vulnerability_chain', 'add_backup_dependency', 'recalibrate_confidence_candidate', 'widen_forecast_range', 'create_executive_decision_reference', 'insufficient_data'] as const;
export type CausalRecType = (typeof CAUSAL_REC_TYPES)[number];

export interface CausalRecommendation {
  code: string; recType: CausalRecType; recommendation: string; reason: string;
  evidence: { label: string; value: number | string | null }[]; confidence: number;
  severity: 'low' | 'moderate' | 'high' | 'critical'; mechanismNote: string;
  preconditions: string[]; limitations: string[]; humanApprovalRequired: true; noAutoExecution: true;
}

export function buildCausalRecommendation(i: { code: string; recType: CausalRecType; finding: string; evidenceCount: number | null; severity?: 'low' | 'moderate' | 'high' | 'critical' }): CausalRecommendation | { insufficient: true; why: string } {
  if (!(CAUSAL_REC_TYPES as readonly string[]).includes(i.recType)) return { insufficient: true, why: '허용되지 않는 유형' };
  if (!i.finding?.trim()) return { insufficient: true, why: '관찰 없음' };
  if (!isFiniteNumber(i.evidenceCount) || i.evidenceCount < 1) return { insufficient: true, why: 'Evidence 없음 — 생성 금지' };
  return {
    code: i.code, recType: i.recType,
    recommendation: `[${i.recType}] ${i.finding} — 검토 후보(인과 확정/자동 실행 아님)`,
    reason: `인과 근거 관찰: ${i.finding} (evidence ${i.evidenceCount}건)`,
    evidence: [{ label: 'evidence_count', value: i.evidenceCount }],
    confidence: clampScore(30 + Math.min(40, i.evidenceCount * 10)),
    severity: i.severity ?? 'moderate',
    mechanismNote: 'Mechanism 은 가설과 지지 분리 — 확정 아님',
    preconditions: ['Human Approval', '교란/반증 검토', 'Counterfactual 은 가상임을 명시'],
    limitations: ['권고만 — 자동 Intervention/Confidence 수정/모델 학습 없음'],
    humanApprovalRequired: true, noAutoExecution: true,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export interface CausalSupportItem { key: string; label: string; status: 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'correlational_only' | 'causality_unverified' | 'experimental_evidence_unavailable' | 'counterfactual_unverified' | 'twin_input_incomplete' | 'external_reference_only' | 'unsupported' | 'insufficient_data'; note: string }

export const CAUSAL_SUPPORT: CausalSupportItem[] = [
  { key: 'business_signal', label: 'Business Signal', status: 'fully_supported', note: '24 type — 관측 신호(원인 단정 아님·원본 복제 없음)' },
  { key: 'causal_candidate', label: 'Causal Candidate', status: 'fully_supported', note: 'causal_confirmed 상태 없음 — 최대 experimentally_supported_reference' },
  { key: 'temporal_order', label: 'Temporal Order', status: 'fully_supported', note: '효과 선행 → direct 승격 금지(서버+로직 이중)' },
  { key: 'mechanism_review', label: 'Mechanism Review', status: 'partially_supported', note: '가설과 지지 분리 — 확정 아님' },
  { key: 'confounder_review', label: 'Confounder Review', status: 'fully_supported', note: '미검토 → causal 표시 금지 · 목록 보존(자동 제거 없음)' },
  { key: 'counter_evidence', label: 'Counter-Evidence', status: 'fully_supported', note: '평균 제거 금지 — 보존 · 우세 시 conflicting' },
  { key: 'causal_evidence_strength', label: 'Causal Evidence Strength', status: 'partially_supported', note: '실험 근거 없으면 strong 상한 제한' },
  { key: 'causal_confidence', label: 'Causal Confidence', status: 'partially_supported', note: '재정규화 + 교란/반증 감점 — Status/Limitations 동시 표시' },
  { key: 'causal_path', label: 'Causal Path', status: 'partially_supported', note: 'depth 기본 4·clamp 6·cycle 방어·최약 status 표시' },
  { key: 'propagation', label: 'Propagation Analysis', status: 'partially_supported', note: '실제 피해 규모 확정 없음' },
  { key: 'feedback_loop', label: 'Feedback Loop', status: 'partially_supported', note: '후보 분석 — 자동 개입 없음' },
  { key: 'counterfactual', label: 'Counterfactual', status: 'counterfactual_unverified', note: '가상 결과 — 실제 Outcome 아님(검증 불가)' },
  { key: 'corporate_twin', label: 'Corporate Digital Twin', status: 'twin_input_incomplete', note: '제한된 집계 모델 — 실제 회사/미래 아님 · 비용/인력 입력 부족' },
  { key: 'twin_simulation', label: 'Twin/Intervention Simulation', status: 'partially_supported', note: '방향+제약 위반 표시 — 단일 종합점수 없음 · 자동 실행 없음' },
  { key: 'vulnerability_chain', label: 'Vulnerability Chain', status: 'partially_supported', note: 'Provider/Admin/Payment 단일 의존 실측 — 확률 미계산' },
  { key: 'business_resilience', label: 'Business Resilience', status: 'partially_supported', note: '9성분 재정규화 — 인사 평가 아님' },
  { key: 'confidence_record', label: 'Confidence Record', status: 'fully_supported', note: '제외 사유 보존 · Confidence ≠ 성공 확률' },
  { key: 'calibration_eligibility', label: 'Calibration Eligibility', status: 'fully_supported', note: 'not_executed/pending/metric 변경/scope 불일치 제외' },
  { key: 'confidence_calibration', label: 'Confidence Calibration', status: 'partially_supported', note: '표본<5 확정 금지 · candidate 표현 · 자동 수정 없음' },
  { key: 'calibration_metrics', label: 'Calibration Metrics', status: 'partially_supported', note: 'MAE/%오차 — actual 0/null 미계산' },
  { key: 'calibration_snapshot', label: 'Calibration Snapshot', status: 'fully_supported', note: '덮어쓰기 금지 — 버전 축적' },
  { key: 'confidence_adjustment', label: 'Confidence Adjustment Recommendation', status: 'fully_supported', note: '권고만 — 실제 Confidence/Weight 미변경' },
  { key: 'causal_risk', label: 'Causal Risk', status: 'partially_supported', note: '9성분 재정규화' },
  { key: 'causal_recommendation', label: 'Causal Recommendation', status: 'fully_supported', note: '17 유형 — Evidence 필수·Human Approval' },
  { key: 'human_review', label: 'Human Review', status: 'fully_supported', note: 'Causal/Twin/Calibration 3중 — 종결 재결정 차단' },
  { key: 'external_evidence', label: 'External Evidence Reference', status: 'external_reference_only', note: '진위 자동 보장 없음' },
  { key: 'experimental_design', label: 'Random Assignment/Control Group', status: 'experimental_evidence_unavailable', note: '실험군·대조군 구조 미존재(0485/0486 은 pre/post 만)' },
  { key: 'causal_ml', label: 'Causal ML/동적 시스템 모델', status: 'unsupported', note: '미도입 — 결정적 규칙 기반(정직 표기)' },
  { key: 'auto_causality', label: '자동 인과 확정', status: 'unsupported', note: '금지 — causal_confirmed 상태 자체가 없음' },
  { key: 'auto_intervention', label: '자동 Intervention/사업 실행', status: 'unsupported', note: '금지' },
  { key: 'auto_confidence', label: '자동 Confidence/Weight/Prompt 수정·모델 학습', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: 'Production Apply/Merge/Deploy/Migration', status: 'unsupported', note: '금지' },
];
