/**
 * aiGovernance — AI Constitution, Trust Governance & Controlled Production Gateway 순수 로직
 * (Phase AI-MUSIC-8).
 *
 * Context→Learning→Prediction→Strategy→Sandbox→Draft Promotion 전체 흐름의 헌법/신뢰/평판/거버넌스
 * 건전성을 계산하고, Production Change Request Candidate 자격을 판정한다.
 *
 *   AI Constitution → Policy/Trust Validation → Decision Reputation → Governance Health
 *   → Human Approval → Production Change Request Candidate → 별도 운영 승인 대기
 *
 * 원칙:
 *  - AI 는 Constitution 을 수정할 수 없고, 자신의 Trust 를 직접 수정할 수 없다(계산은 실제 Outcome/Audit).
 *  - Trust/Reputation/Health 0~100 clamp · NaN 금지 · Outcome 없으면 provisional/insufficient_data.
 *  - Governance Trust 가 Critical 수준이면 Overall Trust 상한(cap). Trust ≠ AI 자신감.
 *  - Constitution 위반/Critical Risk 상태에서 Change Candidate 자격 없음. Evidence 없는 판정 금지.
 *  - 실제 Production Apply/Deploy/Publish/Run 없음(Candidate 까지만).
 */
import { MIN_EVENTS } from './playlistIntel';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export const CONSTITUTION_VERSION = 1;
export interface EvidenceItem { label: string; value: string | number | boolean | null }

/* ── 2/3) AI Constitution 규칙 카탈로그(마이그레이션 시드와 동일) ────────── */
export type Severity = 'informational' | 'warning' | 'high' | 'critical';
export type Enforcement = 'audit' | 'warn' | 'block' | 'immutable_block';
export interface ConstitutionRule { rule_code: string; category: string; title: string; severity: Severity; enforcement_type: Enforcement; immutable: boolean }
export const CONSTITUTION_RULES: ConstitutionRule[] = [
  { rule_code: 'HUMAN_APPROVAL_REQUIRED', category: 'production_safety', title: '사람 승인 필수', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_PRODUCTION_APPLY', category: 'production_safety', title: '자동 Production Apply 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_PLAYLIST_PUBLISH', category: 'production_safety', title: '자동 Playlist Publish 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_SCHEDULER_CHANGE', category: 'production_safety', title: '자동 Scheduler 변경 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_QUEUE_CHANGE', category: 'production_safety', title: '자동 Queue 변경 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_PLAYBACK_CHANGE', category: 'production_safety', title: '자동 Playback 변경 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_ROLLOUT_PROMOTION', category: 'production_safety', title: '자동 Rollout 승격 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_EXPERIMENT_START', category: 'production_safety', title: '자동 Experiment 시작 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'NO_AUTOMATIC_CANARY_START', category: 'production_safety', title: '자동 Canary 시작 금지', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'EVIDENCE_REQUIRED', category: 'evidence', title: 'Evidence 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'BASELINE_REQUIRED', category: 'evidence', title: 'Baseline 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'INPUT_SNAPSHOT_REQUIRED', category: 'evidence', title: 'Input Snapshot 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'SOURCE_VERSION_REQUIRED', category: 'evidence', title: 'Source Version 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'CONFIDENCE_REQUIRED', category: 'evidence', title: 'Confidence 필수', severity: 'warning', enforcement_type: 'warn', immutable: false },
  { rule_code: 'SAMPLE_SUFFICIENCY_REQUIRED', category: 'evidence', title: 'Sample 충족 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'NO_SYNTHETIC_OPERATIONAL_DATA', category: 'data_integrity', title: '합성 운영 데이터 금지', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'NO_UNSUPPORTED_DIMENSION_INFERENCE', category: 'data_integrity', title: '미지원 Dimension 추론 금지', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'NO_NULL_TO_ZERO_PERFORMANCE_CONVERSION', category: 'data_integrity', title: 'null→0 성과 변환 금지', severity: 'warning', enforcement_type: 'warn', immutable: false },
  { rule_code: 'NO_NAN_OR_INFINITY', category: 'data_integrity', title: 'NaN/Infinity 금지', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'NO_EXPIRED_INPUT_PROMOTION', category: 'data_integrity', title: 'Expired Input 승격 금지', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'CRITICAL_RISK_BLOCK', category: 'governance', title: 'Critical Risk 차단', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'CONSTITUTION_VIOLATION_BLOCK', category: 'governance', title: 'Constitution 위반 승격 차단', severity: 'critical', enforcement_type: 'immutable_block', immutable: true },
  { rule_code: 'UNRESOLVED_CONFLICT_BLOCK', category: 'governance', title: '미해결 Conflict 차단', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'MISSING_DEPENDENCY_BLOCK', category: 'governance', title: '필수 Dependency 누락 차단', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'AUDIT_REQUIRED', category: 'governance', title: 'Audit 필수', severity: 'high', enforcement_type: 'block', immutable: false },
  { rule_code: 'HUMAN_OVERRIDE_RECORDED', category: 'governance', title: 'Human Override 기록', severity: 'warning', enforcement_type: 'audit', immutable: false },
  { rule_code: 'IDEMPOTENCY_REQUIRED', category: 'governance', title: 'Idempotency 필수', severity: 'warning', enforcement_type: 'warn', immutable: false },
];
export function immutableRules(): ConstitutionRule[] { return CONSTITUTION_RULES.filter((r) => r.immutable); }

/* ── 5) Constitution Enforcement Engine ─────────────────────────────────── */
export type CheckResult = 'pass' | 'warning' | 'violation' | 'blocked' | 'unsupported' | 'insufficient_data';
export interface RuleResult { rule_code: string; severity: Severity; enforcement_type: Enforcement; result: CheckResult; current_value: string | number | boolean | null; required_value: string | number | boolean | null; detail: string }
export interface ConstitutionContext {
  humanApproved: boolean; evidenceComplete: boolean; baselinePresent: boolean; inputSnapshotPresent: boolean;
  sourceVersionPresent: boolean; confidencePresent: boolean; sample: number; syntheticData: boolean;
  unsupportedInference: boolean; nullToZero: boolean; nanPresent: boolean; expiredInput: boolean;
  riskTier: RiskTier; unresolvedConflict: boolean; missingDependency: boolean; auditPresent: boolean; idempotencyPresent: boolean;
  autoProductionApply?: boolean;
}
export interface ConstitutionCheckResult { pass: boolean; blocked: boolean; results: RuleResult[]; violations: number; warnings: number; criticalViolations: number }

/** 주요 단계 입력으로 Constitution 규칙 검증. immutable_block/block 위반 → blocked. */
export function constitutionCheck(ctx: ConstitutionContext): ConstitutionCheckResult {
  const results: RuleResult[] = [];
  const R = (code: string, ok: boolean, current: RuleResult['current_value'], required: RuleResult['required_value'], detail: string, supported = true) => {
    const rule = CONSTITUTION_RULES.find((r) => r.rule_code === code)!;
    let result: CheckResult;
    if (!supported) result = 'unsupported';
    else if (ok) result = 'pass';
    else result = rule.enforcement_type === 'audit' ? 'warning' : rule.enforcement_type === 'warn' ? 'warning' : rule.enforcement_type === 'immutable_block' ? 'blocked' : 'violation';
    results.push({ rule_code: code, severity: rule.severity, enforcement_type: rule.enforcement_type, result, current_value: current, required_value: required, detail });
  };
  R('HUMAN_APPROVAL_REQUIRED', ctx.humanApproved, ctx.humanApproved, true, '사람 승인');
  R('NO_AUTOMATIC_PRODUCTION_APPLY', ctx.autoProductionApply !== true, ctx.autoProductionApply ?? false, false, '자동 Apply 금지');
  R('EVIDENCE_REQUIRED', ctx.evidenceComplete, ctx.evidenceComplete, true, 'Evidence');
  R('BASELINE_REQUIRED', ctx.baselinePresent, ctx.baselinePresent, true, 'Baseline');
  R('INPUT_SNAPSHOT_REQUIRED', ctx.inputSnapshotPresent, ctx.inputSnapshotPresent, true, 'Input Snapshot');
  R('SOURCE_VERSION_REQUIRED', ctx.sourceVersionPresent, ctx.sourceVersionPresent, true, 'Source Version');
  R('CONFIDENCE_REQUIRED', ctx.confidencePresent, ctx.confidencePresent, true, 'Confidence');
  R('SAMPLE_SUFFICIENCY_REQUIRED', ctx.sample >= MIN_EVENTS, ctx.sample, `>= ${MIN_EVENTS}`, 'Sample');
  R('NO_SYNTHETIC_OPERATIONAL_DATA', !ctx.syntheticData, ctx.syntheticData, false, '합성 데이터 금지');
  R('NO_UNSUPPORTED_DIMENSION_INFERENCE', !ctx.unsupportedInference, ctx.unsupportedInference, false, '미지원 추론 금지');
  R('NO_NULL_TO_ZERO_PERFORMANCE_CONVERSION', !ctx.nullToZero, ctx.nullToZero, false, 'null→0 금지');
  R('NO_NAN_OR_INFINITY', !ctx.nanPresent, ctx.nanPresent, false, 'NaN/Infinity 금지');
  R('NO_EXPIRED_INPUT_PROMOTION', !ctx.expiredInput, ctx.expiredInput, false, 'Expired 승격 금지');
  R('CRITICAL_RISK_BLOCK', ctx.riskTier !== 'critical', ctx.riskTier, '≠ critical', 'Critical 차단');
  R('CONSTITUTION_VIOLATION_BLOCK', true, 'ok', true, '위반 승격 차단(메타)');
  R('UNRESOLVED_CONFLICT_BLOCK', !ctx.unresolvedConflict, ctx.unresolvedConflict, false, 'Conflict 차단');
  R('MISSING_DEPENDENCY_BLOCK', !ctx.missingDependency, ctx.missingDependency, false, 'Dependency 차단');
  R('AUDIT_REQUIRED', ctx.auditPresent, ctx.auditPresent, true, 'Audit');
  R('IDEMPOTENCY_REQUIRED', ctx.idempotencyPresent, ctx.idempotencyPresent, true, 'Idempotency');

  const violations = results.filter((r) => r.result === 'violation' || r.result === 'blocked').length;
  const warnings = results.filter((r) => r.result === 'warning').length;
  const criticalViolations = results.filter((r) => (r.result === 'violation' || r.result === 'blocked') && r.severity === 'critical').length;
  const blocked = results.some((r) => r.result === 'blocked');
  return { pass: violations === 0, blocked, results, violations, warnings, criticalViolations };
}

/* ── 8~14) Trust Engine(계층별 · AI 직접 수정 불가 · 실제 Outcome 기반) ──── */
export type TrustLayer = 'prediction' | 'strategy' | 'sandbox' | 'draft' | 'governance' | 'overall';
export type TrustState = 'trusted' | 'monitored' | 'restricted' | 'suspended' | 'insufficient_data';
export interface TrustScore { layer: TrustLayer; score: number | null; provisional: boolean; sample: number; components: Array<{ key: string; value: number | null }> }

function blend(components: Array<{ key: string; value: number | null; w: number }>): { score: number | null; present: number } {
  const present = components.filter((c) => isNum(c.value));
  if (!present.length) return { score: null, present: 0 };
  const wsum = present.reduce((a, c) => a + c.w, 0);
  return { score: clamp100(present.reduce((a, c) => a + (c.value as number) * c.w, 0) / wsum), present: present.length };
}

export interface PredictionTrustInput { accuracy?: number | null; calibrationError?: number | null; confidenceReliability?: number | null; sampleSufficiency: number; driftStability?: number | null; dataFreshness?: number | null; outcomeSample: number }
export function predictionTrust(inp: PredictionTrustInput): TrustScore {
  const b = blend([
    { key: 'accuracy', value: inp.accuracy ?? null, w: 0.3 },
    { key: 'calibration', value: isNum(inp.calibrationError) ? clamp100(100 - inp.calibrationError) : null, w: 0.15 },
    { key: 'confidence_reliability', value: inp.confidenceReliability ?? null, w: 0.15 },
    { key: 'sample', value: clamp100(clamp01(inp.sampleSufficiency / 200) * 100), w: 0.15 },
    { key: 'drift_stability', value: inp.driftStability ?? null, w: 0.15 },
    { key: 'freshness', value: inp.dataFreshness ?? null, w: 0.1 },
  ]);
  return { layer: 'prediction', score: inp.outcomeSample <= 0 ? provisionalScore(b.score) : b.score, provisional: inp.outcomeSample <= 0, sample: inp.outcomeSample, components: [{ key: 'accuracy', value: inp.accuracy ?? null }] };
}
/** Outcome 없으면 provisional(품질 기반, 상한 70으로 보수적). */
function provisionalScore(s: number | null): number | null { return s == null ? null : clamp100(Math.min(70, s)); }

export interface StrategyTrustInput { approvalRate?: number | null; sandboxPassRate?: number | null; outcomeSuccessRate?: number | null; rejectionRate?: number | null; conflictRate?: number | null; dependencyFailureRate?: number | null; regressionRate?: number | null; evidenceCompleteness: number; outcomeSample: number }
export function strategyTrust(inp: StrategyTrustInput): TrustScore {
  // 실제 Outcome 우선(승인율만으로 높이지 않음): outcomeSuccessRate 가중 최상.
  const b = blend([
    { key: 'outcome', value: inp.outcomeSuccessRate ?? null, w: 0.35 },
    { key: 'sandbox_pass', value: inp.sandboxPassRate ?? null, w: 0.15 },
    { key: 'approval', value: inp.approvalRate ?? null, w: 0.1 },
    { key: 'rejection_inv', value: isNum(inp.rejectionRate) ? clamp100(100 - inp.rejectionRate) : null, w: 0.1 },
    { key: 'conflict_inv', value: isNum(inp.conflictRate) ? clamp100(100 - inp.conflictRate) : null, w: 0.1 },
    { key: 'dependency_inv', value: isNum(inp.dependencyFailureRate) ? clamp100(100 - inp.dependencyFailureRate) : null, w: 0.05 },
    { key: 'regression_inv', value: isNum(inp.regressionRate) ? clamp100(100 - inp.regressionRate) : null, w: 0.05 },
    { key: 'evidence', value: inp.evidenceCompleteness, w: 0.1 },
  ]);
  const noOutcome = !isNum(inp.outcomeSuccessRate) || inp.outcomeSample <= 0;
  return { layer: 'strategy', score: noOutcome ? provisionalScore(b.score) : b.score, provisional: noOutcome, sample: inp.outcomeSample, components: [{ key: 'outcome', value: inp.outcomeSuccessRate ?? null }] };
}

export interface SandboxTrustInput { kpiError?: number | null; goSuccessRate?: number | null; reviewHitRate?: number | null; rejectAccuracy?: number | null; constraintMissRate?: number | null; regressionDetection?: number | null; expiredBlockRate?: number | null; evidenceCompleteness: number; outcomeSample: number; snapshotQuality: number }
export function sandboxTrust(inp: SandboxTrustInput): TrustScore {
  const b = blend([
    { key: 'kpi_error_inv', value: isNum(inp.kpiError) ? clamp100(100 - inp.kpiError) : null, w: 0.2 },
    { key: 'go_success', value: inp.goSuccessRate ?? null, w: 0.15 },
    { key: 'review_hit', value: inp.reviewHitRate ?? null, w: 0.1 },
    { key: 'reject_accuracy', value: inp.rejectAccuracy ?? null, w: 0.1 },
    { key: 'constraint_miss_inv', value: isNum(inp.constraintMissRate) ? clamp100(100 - inp.constraintMissRate) : null, w: 0.1 },
    { key: 'regression_detection', value: inp.regressionDetection ?? null, w: 0.1 },
    { key: 'expired_block', value: inp.expiredBlockRate ?? null, w: 0.05 },
    { key: 'evidence', value: inp.evidenceCompleteness, w: 0.1 },
    { key: 'snapshot_quality', value: inp.snapshotQuality, w: 0.1 },
  ]);
  const noOutcome = inp.outcomeSample <= 0;
  return { layer: 'sandbox', score: noOutcome ? provisionalScore(b.score) : b.score, provisional: noOutcome, sample: inp.outcomeSample, components: [{ key: 'snapshot_quality', value: inp.snapshotQuality }] };
}

export interface DraftTrustInput { validationAccuracy?: number | null; rejectionRate?: number | null; duplicatePrevention: number; idempotencySuccess: number; stalenessDetection?: number | null; policyCompliance: number; canarySuccessRate?: number | null; rollbackReadiness: number; outcomeSample: number }
export function draftTrust(inp: DraftTrustInput): TrustScore {
  const b = blend([
    { key: 'validation_accuracy', value: inp.validationAccuracy ?? null, w: 0.2 },
    { key: 'rejection_inv', value: isNum(inp.rejectionRate) ? clamp100(100 - inp.rejectionRate) : null, w: 0.1 },
    { key: 'duplicate_prevention', value: inp.duplicatePrevention, w: 0.15 },
    { key: 'idempotency', value: inp.idempotencySuccess, w: 0.15 },
    { key: 'staleness', value: inp.stalenessDetection ?? null, w: 0.1 },
    { key: 'policy', value: inp.policyCompliance, w: 0.1 },
    { key: 'canary_success', value: inp.canarySuccessRate ?? null, w: 0.1 },
    { key: 'rollback', value: inp.rollbackReadiness, w: 0.1 },
  ]);
  const noOutcome = inp.outcomeSample <= 0;
  return { layer: 'draft', score: noOutcome ? provisionalScore(b.score) : b.score, provisional: noOutcome, sample: inp.outcomeSample, components: [{ key: 'policy', value: inp.policyCompliance }] };
}

export interface GovernanceTrustInput { violationBlockRate: number; auditCompleteness: number; approvalCompliance: number; criticalBlockRate: number; humanApprovalMissing: number; productionBypass: number; expiredBlockRate: number; unauthorizedBlockRate: number; criticalViolationActive: boolean }
export function governanceTrust(inp: GovernanceTrustInput): TrustScore {
  const b = blend([
    { key: 'violation_block', value: inp.violationBlockRate, w: 0.2 },
    { key: 'audit', value: inp.auditCompleteness, w: 0.15 },
    { key: 'approval_compliance', value: inp.approvalCompliance, w: 0.15 },
    { key: 'critical_block', value: inp.criticalBlockRate, w: 0.15 },
    { key: 'human_missing_inv', value: clamp100(100 - inp.humanApprovalMissing), w: 0.1 },
    { key: 'bypass_inv', value: clamp100(100 - inp.productionBypass), w: 0.1 },
    { key: 'expired_block', value: inp.expiredBlockRate, w: 0.075 },
    { key: 'unauthorized_block', value: inp.unauthorizedBlockRate, w: 0.075 },
  ]);
  // Critical 위반 활성 시 상한 40.
  const score = b.score == null ? null : inp.criticalViolationActive ? clamp100(Math.min(40, b.score)) : b.score;
  return { layer: 'governance', score, provisional: false, sample: 1, components: [{ key: 'critical_violation', value: inp.criticalViolationActive ? 1 : 0 }] };
}

export const GOVERNANCE_CRITICAL_CAP = 50;
/** Overall = 존재 계층 가중 평균. Governance 가 Critical 수준(<임계)이면 Overall 상한. */
export function overallTrust(layers: TrustScore[]): TrustScore {
  const w: Record<string, number> = { prediction: 0.2, strategy: 0.25, sandbox: 0.2, draft: 0.15, governance: 0.2 };
  const present = layers.filter((l) => l.layer !== 'overall' && isNum(l.score));
  if (!present.length) return { layer: 'overall', score: null, provisional: true, sample: 0, components: [] };
  const wsum = present.reduce((a, l) => a + (w[l.layer] ?? 0), 0) || 1;
  let score = clamp100(present.reduce((a, l) => a + (l.score as number) * (w[l.layer] ?? 0), 0) / wsum);
  const gov = layers.find((l) => l.layer === 'governance');
  if (gov && isNum(gov.score) && gov.score < GOVERNANCE_CRITICAL_CAP) score = Math.min(score, gov.score + 10);
  const provisional = present.some((l) => l.provisional);
  return { layer: 'overall', score, provisional, sample: present.reduce((a, l) => a + l.sample, 0), components: present.map((l) => ({ key: l.layer, value: l.score })) };
}

/* ── 15) Trust Status ───────────────────────────────────────────────────── */
export function trustStatus(overall: TrustScore, governance: TrustScore, criticalViolationActive: boolean): TrustState {
  if (criticalViolationActive) return 'suspended';
  if (overall.score == null) return 'insufficient_data';
  if (isNum(governance.score) && governance.score < 35) return 'restricted';
  if (overall.provisional) return 'monitored';
  if (overall.score >= 70) return 'trusted';
  if (overall.score >= 50) return 'monitored';
  return 'restricted';
}

/* ── 16/17) Trust Budget(추천/후보 생성 제한 · 실행 권한 아님) ──────────── */
export interface TrustBudget { dailyStrategyCandidates: number; dailyHighRiskCandidates: number; dailyPromotionRecs: number; dailyCanaryRecs: number; sameContextRepeat: number; sameStrategyRepeat: number; note: string }
export const BUDGET_POLICY: Record<TrustState, TrustBudget> = {
  trusted: { dailyStrategyCandidates: 50, dailyHighRiskCandidates: 10, dailyPromotionRecs: 20, dailyCanaryRecs: 10, sameContextRepeat: 5, sameStrategyRepeat: 5, note: '기본 100%' },
  monitored: { dailyStrategyCandidates: 30, dailyHighRiskCandidates: 5, dailyPromotionRecs: 10, dailyCanaryRecs: 5, sameContextRepeat: 3, sameStrategyRepeat: 3, note: 'High Risk 50% · Context 반복 제한 강화' },
  restricted: { dailyStrategyCandidates: 10, dailyHighRiskCandidates: 0, dailyPromotionRecs: 3, dailyCanaryRecs: 1, sameContextRepeat: 2, sameStrategyRepeat: 2, note: 'Low/Medium 만 · High Risk 생성 금지' },
  suspended: { dailyStrategyCandidates: 0, dailyHighRiskCandidates: 0, dailyPromotionRecs: 0, dailyCanaryRecs: 0, sameContextRepeat: 0, sameStrategyRepeat: 0, note: '신규 생성 금지 · 조회/Audit 만' },
  insufficient_data: { dailyStrategyCandidates: 10, dailyHighRiskCandidates: 0, dailyPromotionRecs: 3, dailyCanaryRecs: 1, sameContextRepeat: 2, sameStrategyRepeat: 2, note: 'Outcome 부족 — 보수적' },
};
export function trustBudget(state: TrustState): TrustBudget { return BUDGET_POLICY[state]; }
export function budgetExceeded(used: number, limit: number): boolean { return isNum(used) && isNum(limit) && used >= limit; }

/* ── 20) Decision Quality / 21) Reputation ──────────────────────────────── */
export interface DecisionQualityInput { predictionError?: number | null; strategySuccess?: number | null; sandboxAccuracy?: number | null; draftValidationAccuracy?: number | null; canarySuccess?: number | null; humanOverrideRate?: number | null; regressionDetection?: number | null; riskCalibration?: number | null; evidenceCompleteness: number }
export function decisionQuality(inp: DecisionQualityInput): { score: number | null; components: Array<{ key: string; value: number | null }> } {
  const comps = [
    { key: 'prediction', value: isNum(inp.predictionError) ? clamp100(100 - inp.predictionError) : null, w: 0.15 },
    { key: 'strategy_success', value: inp.strategySuccess ?? null, w: 0.15 },
    { key: 'sandbox_accuracy', value: inp.sandboxAccuracy ?? null, w: 0.15 },
    { key: 'draft_accuracy', value: inp.draftValidationAccuracy ?? null, w: 0.1 },
    { key: 'canary_success', value: inp.canarySuccess ?? null, w: 0.1 },
    { key: 'override_inv', value: isNum(inp.humanOverrideRate) ? clamp100(100 - inp.humanOverrideRate) : null, w: 0.1 },
    { key: 'regression_detection', value: inp.regressionDetection ?? null, w: 0.1 },
    { key: 'risk_calibration', value: inp.riskCalibration ?? null, w: 0.05 },
    { key: 'evidence', value: inp.evidenceCompleteness, w: 0.1 },
  ];
  const b = blend(comps);
  return { score: b.score, components: comps.map((c) => ({ key: c.key, value: c.value })) };
}

export interface ReputationInput { decisionQuality: number | null; overallTrust: number | null; governanceTrust: number | null; predictionAccuracy?: number | null; strategySuccess?: number | null; sandboxAccuracy?: number | null; constitutionCompliance: number; sample: number; previous?: number | null }
/** 장기 누적 — 이전값과 blend(단기 변동 완화). */
export function reputation(inp: ReputationInput): { score: number | null; provisional: boolean } {
  const b = blend([
    { key: 'decision_quality', value: inp.decisionQuality, w: 0.25 },
    { key: 'overall_trust', value: inp.overallTrust, w: 0.2 },
    { key: 'governance_trust', value: inp.governanceTrust, w: 0.15 },
    { key: 'prediction', value: inp.predictionAccuracy ?? null, w: 0.1 },
    { key: 'strategy', value: inp.strategySuccess ?? null, w: 0.1 },
    { key: 'sandbox', value: inp.sandboxAccuracy ?? null, w: 0.05 },
    { key: 'constitution', value: inp.constitutionCompliance, w: 0.15 },
  ]);
  if (b.score == null) return { score: null, provisional: true };
  const smoothed = isNum(inp.previous) ? clamp100(inp.previous * 0.6 + b.score * 0.4) : b.score;
  return { score: smoothed, provisional: inp.sample < MIN_EVENTS };
}

/* ── 23) Governance Health ──────────────────────────────────────────────── */
export type HealthStatus = 'healthy' | 'watch' | 'weak' | 'critical' | 'insufficient_data';
export interface GovernanceHealthInput { constitutionCompliance: number; auditCompleteness: number; unauthorizedBlock: number; approvalCompliance: number; expirationEnforcement: number; duplicatePrevention: number; idempotencySuccess: number; criticalBlockRate: number; evidenceCompleteness: number; productionSafety: number; criticalViolationActive: boolean }
export function governanceHealth(inp: GovernanceHealthInput): { score: number; status: HealthStatus } {
  const b = blend([
    { key: 'constitution', value: inp.constitutionCompliance, w: 0.15 },
    { key: 'audit', value: inp.auditCompleteness, w: 0.1 },
    { key: 'unauthorized', value: inp.unauthorizedBlock, w: 0.1 },
    { key: 'approval', value: inp.approvalCompliance, w: 0.1 },
    { key: 'expiration', value: inp.expirationEnforcement, w: 0.1 },
    { key: 'duplicate', value: inp.duplicatePrevention, w: 0.08 },
    { key: 'idempotency', value: inp.idempotencySuccess, w: 0.07 },
    { key: 'critical_block', value: inp.criticalBlockRate, w: 0.1 },
    { key: 'evidence', value: inp.evidenceCompleteness, w: 0.1 },
    { key: 'production_safety', value: inp.productionSafety, w: 0.1 },
  ]);
  const score = b.score == null ? 0 : inp.criticalViolationActive ? clamp100(Math.min(35, b.score)) : b.score;
  const status: HealthStatus = inp.criticalViolationActive ? 'critical' : b.score == null ? 'insufficient_data' : score >= 75 ? 'healthy' : score >= 55 ? 'watch' : score >= 35 ? 'weak' : 'critical';
  return { score, status };
}

/* ── 25) Violation Response ─────────────────────────────────────────────── */
export interface ViolationResponse { level: 'warning' | 'high' | 'critical'; blockCandidate: boolean; reviewRequired: boolean; trustAction: 'none' | 'restrict' | 'suspend'; note: string }
export function violationResponse(severity: Severity, blocked: boolean): ViolationResponse {
  if (severity === 'critical' || blocked) return { level: 'critical', blockCandidate: true, reviewRequired: true, trustAction: 'suspend', note: '해당 Source 승격 차단 · 명시 해제 전까지 차단' };
  if (severity === 'high') return { level: 'high', blockCandidate: true, reviewRequired: true, trustAction: 'restrict', note: 'Candidate 생성 차단 · 관리자 Review' };
  return { level: 'warning', blockCandidate: false, reviewRequired: true, trustAction: 'none', note: '기록 · UI 경고 · Review Required' };
}

/* ── 27~32) Change Candidate Eligibility / Go-NoGo / Preconditions ──────── */
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export interface ChangeEligibilityInput {
  draftReady: boolean; canaryCandidate: boolean; promotionApproved: boolean; sandboxValid: boolean;
  constitutionPass: boolean; criticalViolation: boolean; riskTier: RiskTier; trustState: TrustState;
  rollbackPlan: boolean; observationPlan: boolean; evidenceComplete: boolean; inputHashMatch: boolean;
  modelVersionMatch: boolean; policyVersionMatch: boolean; expired: boolean; humanApproved: boolean;
}
export interface ChangeEligibilityResult { eligible: boolean; blockers: string[]; noGo: string[] }
export function changeCandidateEligibility(inp: ChangeEligibilityInput): ChangeEligibilityResult {
  const noGo: string[] = [];
  if (!inp.draftReady) noGo.push('Draft ready 아님');
  if (!inp.canaryCandidate) noGo.push('Canary Candidate 아님');
  if (!inp.promotionApproved) noGo.push('Promotion 승인 미완료');
  if (!inp.sandboxValid) noGo.push('Sandbox Source 무효');
  if (!inp.constitutionPass) noGo.push('Constitution 미Pass');
  if (inp.criticalViolation) noGo.push('Critical Violation');
  if (inp.riskTier === 'critical') noGo.push('Critical Risk');
  if (inp.trustState === 'restricted' || inp.trustState === 'suspended') noGo.push(`Trust ${inp.trustState}`);
  if (!inp.rollbackPlan) noGo.push('Rollback Plan 없음');
  if (!inp.observationPlan) noGo.push('Observation Plan 없음');
  if (!inp.evidenceComplete) noGo.push('Evidence 불완전');
  if (!inp.inputHashMatch) noGo.push('Input Hash 불일치');
  if (!inp.modelVersionMatch) noGo.push('Model Version 불일치');
  if (!inp.policyVersionMatch) noGo.push('Policy Version 불일치');
  if (inp.expired) noGo.push('Expired');
  if (!inp.humanApproved) noGo.push('사람 승인 없음');
  return { eligible: noGo.length === 0, blockers: noGo, noGo };
}

export interface ExecutionPreconditions { separate_operational_approval: boolean; change_window_confirmed: boolean; snapshot_complete: boolean; rollback_owner_assigned: boolean; observation_owner_assigned: boolean; canary_scope_confirmed: boolean; production_migration_checked: boolean; ci_passed: boolean; preview_verified: boolean; monitoring_ready: boolean; incident_ready: boolean }
export function defaultExecutionPreconditions(): ExecutionPreconditions {
  return { separate_operational_approval: false, change_window_confirmed: false, snapshot_complete: false, rollback_owner_assigned: false, observation_owner_assigned: false, canary_scope_confirmed: false, production_migration_checked: false, ci_passed: false, preview_verified: false, monitoring_ready: false, incident_ready: false };
}

/* ── 33) Change Candidate Expiration ────────────────────────────────────── */
export interface ChangeExpireInput { sourceDraftChanged: boolean; canaryReleased: boolean; constitutionVersionChanged: boolean; policyVersionChanged: boolean; modelVersionChanged: boolean; inputHashChanged: boolean; riskRaisedToCritical: boolean; ageDays: number; maxAgeDays?: number }
export function changeCandidateExpired(inp: ChangeExpireInput): { expired: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (inp.sourceDraftChanged) reasons.push('Source Draft 변경');
  if (inp.canaryReleased) reasons.push('Canary Candidate 해제');
  if (inp.constitutionVersionChanged) reasons.push('Constitution Version 변경');
  if (inp.policyVersionChanged) reasons.push('Policy Version 변경');
  if (inp.modelVersionChanged) reasons.push('Model Version 변경');
  if (inp.inputHashChanged) reasons.push('Input Hash 변경');
  if (inp.riskRaisedToCritical) reasons.push('Risk Critical 상승');
  if (isNum(inp.ageDays) && inp.ageDays > (inp.maxAgeDays ?? 7)) reasons.push(`경과 ${inp.ageDays}일`);
  return { expired: reasons.length > 0, reasons };
}
export function changeIdempotencyKey(parts: { draftId: string; contextKey: string; changeType: string; inputHash: string | null }): string {
  const s = `${parts.draftId}|${parts.contextKey}|${parts.changeType}|${parts.inputHash ?? ''}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `cc_${(h >>> 0).toString(16)}`;
}

/* ── 34) Change Management Boundary(문서) ───────────────────────────────── */
export const CHANGE_MANAGEMENT_BOUNDARY = [
  'AI-MUSIC-8 은 Production Apply 엔진이 아니다.',
  'Deployment 엔진이 아니다.', 'Migration Apply 엔진이 아니다.',
  'Playlist Publish 엔진이 아니다.', 'Scheduler 변경 엔진이 아니다.', 'Rollout 실행 엔진이 아니다.',
  'Production 실행은 별도 Change Management Phase 에서만 수행한다.',
];

/* ── 지원 매트릭스 ──────────────────────────────────────────────────────── */
export type GovSupportStatus = 'fully_supported' | 'partially_supported' | 'audit_only' | 'policy_only' | 'unsupported' | 'insufficient_data';
export interface GovSupport { key: string; label: string; status: GovSupportStatus; note: string }
export const GOVERNANCE_SUPPORT: GovSupport[] = [
  { key: 'constitution', label: 'AI Constitution', status: 'fully_supported', note: 'ai_constitution_rules 시드 + Enforcement' },
  { key: 'constitution_check', label: 'Constitution Check', status: 'fully_supported', note: 'governance_events 기록' },
  { key: 'governance_trust', label: 'Governance Trust', status: 'fully_supported', note: 'Audit/차단율 집계' },
  { key: 'prediction_trust', label: 'Prediction Trust', status: 'partially_supported', note: '실제 Outcome 부족 → provisional' },
  { key: 'strategy_trust', label: 'Strategy Trust', status: 'partially_supported', note: 'strategy_learning outcome' },
  { key: 'sandbox_trust', label: 'Sandbox Trust', status: 'partially_supported', note: 'Canary/Production 결과 전 provisional' },
  { key: 'draft_trust', label: 'Draft Trust', status: 'partially_supported', note: 'Draft validation/idempotency' },
  { key: 'reputation', label: 'AI Reputation', status: 'partially_supported', note: '장기 Outcome 축적 필요' },
  { key: 'human_override', label: 'Human Override', status: 'audit_only', note: '기록만 · 자동 Weight 변경 없음' },
  { key: 'change_candidate', label: 'Change Candidate', status: 'fully_supported', note: 'Governance Ready 까지' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '별도 Change Management Phase' },
  { key: 'role_separation', label: 'Role Separation', status: 'unsupported', note: 'admin_users super_admin 단일 role' },
];

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const TRUST_STATE_LABEL: Record<TrustState, string> = { trusted: 'Trusted', monitored: 'Monitored', restricted: 'Restricted', suspended: 'Suspended', insufficient_data: '데이터 부족' };
export const TRUST_STATE_TONE: Record<TrustState, 'success' | 'warning' | 'danger' | 'neutral'> = { trusted: 'success', monitored: 'warning', restricted: 'danger', suspended: 'danger', insufficient_data: 'neutral' };
export const HEALTH_STATUS_LABEL: Record<HealthStatus, string> = { healthy: 'Healthy', watch: 'Watch', weak: 'Weak', critical: 'Critical', insufficient_data: '데이터 부족' };
export const HEALTH_STATUS_TONE: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { healthy: 'success', watch: 'warning', weak: 'danger', critical: 'danger', insufficient_data: 'neutral' };
export const CHECK_RESULT_TONE: Record<CheckResult, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { pass: 'success', warning: 'warning', violation: 'danger', blocked: 'danger', unsupported: 'neutral', insufficient_data: 'info' };
export const SEVERITY_TONE: Record<Severity, 'neutral' | 'info' | 'warning' | 'danger'> = { informational: 'neutral', warning: 'warning', high: 'danger', critical: 'danger' };
export const CANDIDATE_STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_governance_review: 'Governance 검토 대기', governance_ready: 'Governance Ready', review_required: 'Review 필요', rejected: '기각', expired: 'Expired', cancelled: '취소' };
export const CANDIDATE_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = { draft: 'neutral', pending_governance_review: 'info', governance_ready: 'success', review_required: 'warning', rejected: 'danger', expired: 'warning', cancelled: 'neutral' };
export function trustTone(score: number | null): 'success' | 'warning' | 'danger' | 'neutral' { return score == null ? 'neutral' : score >= 70 ? 'success' : score >= 50 ? 'warning' : 'danger'; }
