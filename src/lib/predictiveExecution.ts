/**
 * predictiveExecution — Predictive Execution Intelligence/Strategic Forecasting/
 * Executive Simulation 순수 로직 (Phase AI-OPS-19).
 *
 * Current Execution → Predictive Modeling → Scenario Simulation → Forecast →
 * Executive Decision Support. 0521이 현재를 분석했다면 0522는 가능한 미래를 시뮬레이션.
 *
 * 예측 정직성(전부 코드로 강제):
 *  - Forecast = Prediction ≠ Outcome. Projection ≠ Commitment. 상관 ≠ 인과.
 *  - Confidence 100 ≠ 성공 보장. Delay Forecast ≠ 실제 지연. Simulation ≠ Executive Decision.
 *  - Missing Data = Unknown 유지(null→0 금지). 표본<5 확정 금지. 근거 부족 → forecast_unverified.
 *  - 자동 배정/일정/KPI/Outcome 변경 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type ForecastStatus = 'forecast_reference' | 'sample_too_small' | 'projection_unavailable' | 'forecast_unverified' | 'insufficient_data';
export type ForecastHorizon = 'next_week' | 'next_month' | 'next_quarter' | 'half_year' | 'annual';
export type RiskForecastKind = 'future_delivery_risk' | 'future_schedule_risk' | 'future_dependency_risk' | 'future_scope_risk' | 'future_confidence_risk';

export const MIN_FORECAST_SAMPLE = 5;

export interface ForecastConfidence {
  confidence: number | null;
  evidenceCoverage: number | null;
  unknownComponents: string[];
  missingSignals: string[];
  freshness: 'fresh' | 'stale_input_candidate' | 'unknown';
  limitations: string[];
  successGuarantee: false;
}

export function buildForecastConfidence(i: { componentValues: (number | null)[]; unknownComponents: string[]; missingSignals: string[]; inputAgeDays: number | null }): ForecastConfidence {
  const known = i.componentValues.filter((v): v is number => v != null && isFiniteNumber(v));
  const coverage = i.componentValues.length ? clampScore((known.length / i.componentValues.length) * 100) : null;
  const confidence = known.length ? clampScore(known.reduce((s, v) => s + v, 0) / known.length) : null;
  const freshness = i.inputAgeDays == null ? 'unknown' : i.inputAgeDays > 30 ? 'stale_input_candidate' : 'fresh';
  return {
    confidence, evidenceCoverage: coverage,
    unknownComponents: i.unknownComponents, missingSignals: i.missingSignals, freshness,
    limitations: ['Forecast = Prediction ≠ Outcome', 'Confidence 100 ≠ 성공 보장'],
    successGuarantee: false,
  };
}

/* ── 1) Predictive Delivery — Completion Probability(확정 아님) ──────── */
export function calculateCompletionProbability(i: {
  verifiedProgress: number | null; activeBlockers: number; dependencyClear: boolean | null;
  historicalSuccessRate: number | null; historicalSample: number; daysToTarget: number | null;
}): { probability: number | null; status: ForecastStatus; drivers: string[]; predictionNotOutcome: true } {
  const drivers: string[] = [];
  if (i.historicalSample < MIN_FORECAST_SAMPLE && i.verifiedProgress == null) {
    return { probability: null, status: i.historicalSample === 0 ? 'insufficient_data' : 'sample_too_small', drivers: ['이력 표본 부족 — 확률 확정 금지'], predictionNotOutcome: true };
  }
  const { score } = normalizeAvailableComponents([
    { key: 'progress', value: i.verifiedProgress, weight: 0.4 },
    { key: 'history', value: i.historicalSample >= MIN_FORECAST_SAMPLE ? i.historicalSuccessRate : null, weight: 0.3 },
    { key: 'blockers', value: Math.max(0, 100 - i.activeBlockers * 30), weight: 0.2 },
    { key: 'dependency', value: i.dependencyClear == null ? null : i.dependencyClear ? 90 : 30, weight: 0.1 },
  ]);
  if (score == null) return { probability: null, status: 'forecast_unverified', drivers: ['평가 가능한 신호 없음'], predictionNotOutcome: true };
  if (i.activeBlockers > 0) drivers.push(`Active Blocker ${i.activeBlockers}건`);
  if (i.daysToTarget != null && isFiniteNumber(i.daysToTarget) && i.daysToTarget < 0) drivers.push('target 이미 경과(실패 확정 아님)');
  if (i.historicalSample < MIN_FORECAST_SAMPLE) drivers.push(`이력 표본 ${i.historicalSample}<${MIN_FORECAST_SAMPLE} — 이력 성분 제외`);
  const penalized = i.daysToTarget != null && i.daysToTarget < 0 ? Math.max(0, score - 20) : score;
  return { probability: clampScore(penalized), status: i.historicalSample < MIN_FORECAST_SAMPLE ? 'sample_too_small' : 'forecast_reference', drivers, predictionNotOutcome: true };
}

/* ── Delivery Delay Forecast(실제 지연 아님) ─────────────────────────── */
export function forecastDeliveryDelay(i: { historicalDelays: number[] | null; activeBlockers: number; dependencyWaitDays: number | null }): { expectedDelayDays: number | null; low: number | null; high: number | null; status: ForecastStatus; notActualDelay: true } {
  const delays = (i.historicalDelays ?? []).filter((d) => isFiniteNumber(d) && d >= 0);
  if (!delays.length && i.dependencyWaitDays == null) return { expectedDelayDays: null, low: null, high: null, status: 'insufficient_data', notActualDelay: true };
  const base = delays.length ? delays.reduce((s, d) => s + d, 0) / delays.length : 0;
  const blockerPenalty = i.activeBlockers * 3;
  const depWait = i.dependencyWaitDays != null && isFiniteNumber(i.dependencyWaitDays) ? i.dependencyWaitDays : 0;
  const expected = Math.round((base + blockerPenalty + depWait) * 10) / 10;
  const spread = delays.length ? Math.max(...delays) - Math.min(...delays) : expected;
  return {
    expectedDelayDays: expected,
    low: Math.max(0, Math.round((expected - spread / 2) * 10) / 10),
    high: Math.round((expected + spread / 2) * 10) / 10,
    status: delays.length < MIN_FORECAST_SAMPLE ? 'sample_too_small' : 'forecast_reference',
    notActualDelay: true,
  };
}

/* ── Verification Readiness / Outcome Observation Forecast ───────────── */
export function forecastVerificationReadiness(i: { evidenceProvided: number; evidenceRequired: number; criteriaDefined: boolean; reviewerExists: boolean }): { readinessPct: number | null; status: ForecastStatus; gaps: string[] } {
  const gaps: string[] = [];
  if (!i.criteriaDefined) gaps.push('Success Criteria 없음');
  if (!i.reviewerExists) gaps.push('Reviewer 없음');
  if (i.evidenceRequired > 0 && i.evidenceProvided < i.evidenceRequired) gaps.push(`Evidence ${i.evidenceProvided}/${i.evidenceRequired}`);
  if (!i.criteriaDefined && i.evidenceProvided === 0) return { readinessPct: null, status: 'forecast_unverified', gaps };
  const pct = clampScore(((i.criteriaDefined ? 40 : 0) + (i.reviewerExists ? 20 : 0) + (i.evidenceRequired > 0 ? Math.min(40, (i.evidenceProvided / i.evidenceRequired) * 40) : i.evidenceProvided > 0 ? 40 : 0)));
  return { readinessPct: pct, status: 'forecast_reference', gaps };
}

/* ── 2) Strategic Forecasting — Portfolio/Priority/조직 단위 ─────────── */
export function forecastPortfolioCompletion(items: { code: string; probability: number | null }[] | null): { portfolioProbability: number | null; status: ForecastStatus; weakest: string | null; notCommitment: true } {
  const valid = (items ?? []).filter((x): x is { code: string; probability: number } => x.probability != null && isFiniteNumber(x.probability));
  if (!valid.length) return { portfolioProbability: null, status: 'insufficient_data', weakest: null, notCommitment: true };
  // 최약 항목이 전체를 제약(평균 낙관 금지) — 평균과 최솟값 중 보수적으로
  const avg = valid.reduce((s, x) => s + x.probability, 0) / valid.length;
  const min = Math.min(...valid.map((x) => x.probability));
  const weakest = valid.find((x) => x.probability === min)?.code ?? null;
  return {
    portfolioProbability: clampScore(Math.min(avg, (avg + min) / 2)),
    status: valid.length < MIN_FORECAST_SAMPLE ? 'sample_too_small' : 'forecast_reference',
    weakest, notCommitment: true,
  };
}

/* ── 3) Executive What-if Simulation(≠ Executive Decision) ──────────── */
export function simulateWhatIf(i: {
  scenario: string;
  baseline: { totalReviewHours: number | null; riskCount: number; deliveryProbability: number | null };
  change: { kind: 'remove_priority' | 'add_priority' | 'remove_blocker' | 'change_deadline'; reviewHoursDelta: number | null; riskDelta: number; probabilityDelta: number | null };
}): { scenario: string; projected: { reviewHours: number | null; riskCount: number; deliveryProbability: number | null }; effects: string[]; executiveDecision: false; counterfactual: true } {
  const hours = i.baseline.totalReviewHours != null && i.change.reviewHoursDelta != null ? Math.max(0, i.baseline.totalReviewHours + i.change.reviewHoursDelta) : i.baseline.totalReviewHours;
  const prob = i.baseline.deliveryProbability != null && i.change.probabilityDelta != null ? clampScore(i.baseline.deliveryProbability + i.change.probabilityDelta) : i.baseline.deliveryProbability;
  const risk = Math.max(0, i.baseline.riskCount + i.change.riskDelta);
  const effects: string[] = [];
  if (hours !== i.baseline.totalReviewHours) effects.push(`검토 시간 ${i.baseline.totalReviewHours}h → ${hours}h (예상)`);
  if (risk !== i.baseline.riskCount) effects.push(`Risk ${i.baseline.riskCount} → ${risk} (예상)`);
  if (prob !== i.baseline.deliveryProbability) effects.push(`Delivery 확률 ${i.baseline.deliveryProbability} → ${prob} (예상 — 보장 아님)`);
  return { scenario: i.scenario, projected: { reviewHours: hours, riskCount: risk, deliveryProbability: prob }, effects, executiveDecision: false, counterfactual: true };
}

/* ── 4) Resource Impact Simulation(실제 배정 절대 없음) ──────────────── */
export function simulateResourceImpact(i: { currentReviewers: number | null; addedReviewers: number; currentLatencyDays: number | null }): { projectedLatencyDays: number | null; confidenceChange: 'increase_expected' | 'unknown'; resourcesAssigned: false; note: string } {
  if (i.currentReviewers == null || !isFiniteNumber(i.currentReviewers) || i.currentReviewers <= 0 || i.currentLatencyDays == null || !isFiniteNumber(i.currentLatencyDays)) {
    return { projectedLatencyDays: null, confidenceChange: 'unknown', resourcesAssigned: false, note: 'Reviewer/Latency 실측 없음 — 예상 계산 금지' };
  }
  const total = i.currentReviewers + Math.max(0, i.addedReviewers);
  const projected = Math.round((i.currentLatencyDays * (i.currentReviewers / total)) * 10) / 10;
  return { projectedLatencyDays: projected, confidenceChange: 'increase_expected', resourcesAssigned: false, note: '예상일 뿐 — 실제 배정/채용은 수행하지 않음' };
}

/* ── 5) Dependency Propagation Forecast(가능 영향만 — 확정 아님) ─────── */
export function forecastDependencyPropagation(chain: { code: string; dependsOn: string | null }[] | null, delayed: { code: string; delayDays: number } | null): { possible: { code: string; possibleDelayDays: number }[]; confirmed: false } {
  if (!chain?.length || !delayed || !isFiniteNumber(delayed.delayDays) || delayed.delayDays <= 0) return { possible: [], confirmed: false };
  const byDep = new Map<string, string[]>();
  for (const c of chain) {
    if (!c.dependsOn) continue;
    if (!byDep.has(c.dependsOn)) byDep.set(c.dependsOn, []);
    byDep.get(c.dependsOn)!.push(c.code);
  }
  const possible: { code: string; possibleDelayDays: number }[] = [];
  const queue = [delayed.code];
  const visited = new Set<string>([delayed.code]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of byDep.get(cur) ?? []) {
      if (visited.has(next)) continue;   // cycle 방어
      visited.add(next);
      possible.push({ code: next, possibleDelayDays: delayed.delayDays });
      queue.push(next);
    }
  }
  return { possible, confirmed: false };
}

/* ── 6) Executive Risk Forecast(5축) ─────────────────────────────────── */
export function forecastExecutiveRisk(i: { deliveryProbability: number | null; scheduleVarianceDays: number | null; blockingDependencies: number; unapprovedScopeChanges: number; confidenceDrift: number | null }): { kind: RiskForecastKind; level: 'low' | 'moderate' | 'high' | 'insufficient_data'; note: string }[] {
  const out: { kind: RiskForecastKind; level: 'low' | 'moderate' | 'high' | 'insufficient_data'; note: string }[] = [];
  out.push({ kind: 'future_delivery_risk', level: i.deliveryProbability == null ? 'insufficient_data' : i.deliveryProbability < 40 ? 'high' : i.deliveryProbability < 70 ? 'moderate' : 'low', note: '완료 확률 기반 예상(확정 아님)' });
  out.push({ kind: 'future_schedule_risk', level: i.scheduleVarianceDays == null ? 'insufficient_data' : Math.abs(i.scheduleVarianceDays) > 14 ? 'high' : Math.abs(i.scheduleVarianceDays) > 3 ? 'moderate' : 'low', note: '현재 variance 기반 예상' });
  out.push({ kind: 'future_dependency_risk', level: i.blockingDependencies >= 2 ? 'high' : i.blockingDependencies === 1 ? 'moderate' : 'low', note: 'Blocking 의존 수 기반' });
  out.push({ kind: 'future_scope_risk', level: i.unapprovedScopeChanges >= 2 ? 'high' : i.unapprovedScopeChanges === 1 ? 'moderate' : 'low', note: '무단 Scope 변경 이력 기반' });
  out.push({ kind: 'future_confidence_risk', level: i.confidenceDrift == null ? 'insufficient_data' : i.confidenceDrift <= -15 ? 'high' : i.confidenceDrift < 0 ? 'moderate' : 'low', note: 'Confidence Drift 기반' });
  return out;
}

/* ── 8) Business Impact Projection(원본 없으면 unavailable) ──────────── */
export function projectBusinessImpact(i: { kpiKey: string; kpiAvailable: boolean; currentValue: number | null; historicalDeltas: number[] | null; horizonPeriods: number }): { kpiKey: string; projected: number | null; low: number | null; high: number | null; status: ForecastStatus; notBusinessResult: true } {
  if (!i.kpiAvailable) return { kpiKey: i.kpiKey, projected: null, low: null, high: null, status: 'projection_unavailable', notBusinessResult: true };
  if (i.currentValue == null || !isFiniteNumber(i.currentValue)) return { kpiKey: i.kpiKey, projected: null, low: null, high: null, status: 'insufficient_data', notBusinessResult: true };
  const deltas = (i.historicalDeltas ?? []).filter((d) => isFiniteNumber(d));
  if (!deltas.length) return { kpiKey: i.kpiKey, projected: null, low: null, high: null, status: 'forecast_unverified', notBusinessResult: true };
  const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const periods = Math.max(1, Math.floor(i.horizonPeriods));
  const projected = Math.round(i.currentValue + avgDelta * periods);
  const spread = deltas.length > 1 ? (Math.max(...deltas) - Math.min(...deltas)) * periods : Math.abs(avgDelta) * periods;
  return {
    kpiKey: i.kpiKey, projected,
    low: Math.round(projected - spread / 2), high: Math.round(projected + spread / 2),
    status: deltas.length < MIN_FORECAST_SAMPLE ? 'sample_too_small' : 'forecast_reference',
    notBusinessResult: true,
  };
}

/* ── 9) Executive Simulation Graph(6단계) ────────────────────────────── */
export const SIMULATION_GRAPH_STAGES = ['decision', 'commitment', 'execution', 'forecast', 'projected_outcome', 'business_impact'] as const;

export function buildSimulationGraph(nodes: { id: string; stage: string; label: string }[] | null): { stages: { stage: string; nodes: { id: string; label: string }[]; projectedOnly: boolean }[] } {
  const valid = (nodes ?? []).filter((n) => (SIMULATION_GRAPH_STAGES as readonly string[]).includes(n.stage));
  return {
    stages: SIMULATION_GRAPH_STAGES.map((stage) => ({
      stage,
      nodes: valid.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label })),
      projectedOnly: stage === 'forecast' || stage === 'projected_outcome' || stage === 'business_impact',   // 예측 구간 명시
    })),
  };
}

/* ── 10) Forecast Timeline(다음 주/월/분기/반기/연간) ────────────────── */
export function buildForecastTimeline(forecasts: { horizon: ForecastHorizon | string; kind: string; label: string }[] | null): { buckets: { horizon: ForecastHorizon; items: { kind: string; label: string }[] }[]; predictionNotOutcome: true } {
  const horizons: ForecastHorizon[] = ['next_week', 'next_month', 'next_quarter', 'half_year', 'annual'];
  return {
    buckets: horizons.map((h) => ({ horizon: h, items: (forecasts ?? []).filter((f) => f.horizon === h).slice(0, 30).map((f) => ({ kind: f.kind, label: f.label })) })),
    predictionNotOutcome: true,
  };
}

/* ── 11) Predictive Organizational Health(7성분·재정규화) ────────────── */
export function forecastOrganizationalHealth(c: { deliveryTrendDelta: number | null; currentHealth: number | null; stabilityScore: number | null; reviewLatencyScore: number | null; evidenceCoverage: number | null; completionQuality: number | null; accountabilityScore: number | null }): { projectedScore: number | null; direction: 'improving_expected' | 'stable_expected' | 'declining_expected' | 'insufficient_data'; missing: string[]; predictionNotOutcome: true } {
  const { score, missing } = normalizeAvailableComponents([
    { key: 'current_health', value: c.currentHealth, weight: 0.3 },
    { key: 'stability', value: c.stabilityScore, weight: 0.15 },
    { key: 'review_latency', value: c.reviewLatencyScore, weight: 0.1 },
    { key: 'evidence', value: c.evidenceCoverage, weight: 0.15 },
    { key: 'completion_quality', value: c.completionQuality, weight: 0.15 },
    { key: 'accountability', value: c.accountabilityScore, weight: 0.15 },
  ]);
  if (score == null) return { projectedScore: null, direction: 'insufficient_data', missing, predictionNotOutcome: true };
  const delta = c.deliveryTrendDelta != null && isFiniteNumber(c.deliveryTrendDelta) ? c.deliveryTrendDelta : 0;
  const projected = clampScore(score + delta / 2);
  const direction = delta >= 5 ? 'improving_expected' : delta <= -5 ? 'declining_expected' : 'stable_expected';
  return { projectedScore: projected, direction, missing, predictionNotOutcome: true };
}

/* ── 12) Forecast Recommendation(6종·자동 실행 없음) ─────────────────── */
export const FORECAST_RECOMMENDATION_TYPES = ['review_forecast', 'validate_dependency', 'prepare_evidence', 'observe_kpi', 'review_delivery_pattern', 'update_forecast', 'insufficient_data'] as const;
export type ForecastRecommendationType = (typeof FORECAST_RECOMMENDATION_TYPES)[number];

export function buildForecastRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; assumptions: string[]; unknownFactors: string[] }): { type: ForecastRecommendationType; reason: string; evidence: string[]; confidence: number | null; assumptions: string[]; unknownFactors: string[]; alternatives: string[]; limitations: string[]; humanApprovalRequired: true; autoExecuted: false } | { rejected: true; why: string } {
  if (!(FORECAST_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.reason.trim()) return { rejected: true, why: '사유 필수' };
  return {
    type: i.type as ForecastRecommendationType, reason: i.reason, evidence: i.evidence,
    confidence: i.confidence, assumptions: i.assumptions, unknownFactors: i.unknownFactors,
    alternatives: ['현행 유지(예측 미채택)'],
    limitations: ['Forecast 기반 권고 — 사실 확정 아님'],
    humanApprovalRequired: true, autoExecuted: false,
  };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const FORECAST_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'completion_probability', label: 'Commitment Completion Probability', status: 'supported', note: 'verified progress/blocker/이력 기반 — Prediction ≠ Outcome' },
  { key: 'milestone_forecast', label: 'Milestone Completion Forecast', status: 'supported', note: 'Evidence/Criteria/Reviewer 기반 readiness' },
  { key: 'delay_forecast', label: 'Delivery Delay Forecast', status: 'partial', note: '지연 이력 표본 초기 부족 — sample_too_small' },
  { key: 'success_forecast', label: 'Delivery Success Forecast', status: 'supported', note: '표본<5 확정 금지' },
  { key: 'verification_forecast', label: 'Verification Readiness Forecast', status: 'supported', note: 'Criteria/Evidence/Reviewer 게이트 기반' },
  { key: 'outcome_forecast', label: 'Outcome Observation Forecast', status: 'partial', note: 'Observation Plan 미정의(실측) — 제한적' },
  { key: 'portfolio_forecast', label: 'Portfolio Completion Forecast', status: 'supported', note: '최약 항목 보수 반영(평균 낙관 금지)' },
  { key: 'priority_forecast', label: 'Executive Priority Forecast', status: 'supported', note: '0518 연결 Commitment 기반' },
  { key: 'org_delivery_forecast', label: 'Organizational Delivery Forecast', status: 'partial', note: 'Delivery Snapshot(0521) 누적 필요' },
  { key: 'whatif', label: 'Executive What-if Simulation', status: 'supported', note: 'Simulation ≠ Executive Decision(counterfactual 명시)' },
  { key: 'resource_simulation', label: 'Resource Impact Simulation', status: 'supported', note: '예측만 — 실제 배정 절대 없음' },
  { key: 'dependency_propagation', label: 'Dependency Propagation Forecast', status: 'supported', note: '가능 영향만 계산(확정 아님·cycle 방어)' },
  { key: 'risk_forecast', label: 'Executive Risk Forecast', status: 'supported', note: '5축(Delivery/Schedule/Dependency/Scope/Confidence)' },
  { key: 'forecast_confidence', label: 'Forecast Confidence', status: 'supported', note: 'Confidence+Coverage+Unknown+Missing+Freshness+Limitations 동시 제공' },
  { key: 'revenue_projection', label: 'Revenue/MRR Projection', status: 'supported', note: 'subscriptions 실측 기반 — Projection ≠ Business Result' },
  { key: 'growth_projection', label: 'Growth/Store Projection', status: 'supported', note: 'users 실측 기반' },
  { key: 'playlist_projection', label: 'Playlist Quality Projection', status: 'partial', note: '전용 품질 지표 없음 — 제한적' },
  { key: 'csat_projection', label: 'Customer Satisfaction Projection', status: 'unsupported', note: 'projection_unavailable — 지표 원본 없음(실측)' },
  { key: 'simulation_graph', label: 'Executive Simulation Graph', status: 'supported', note: 'Decision→…→Business Impact 6단계, 예측 구간 명시' },
  { key: 'forecast_timeline', label: 'Forecast Timeline', status: 'supported', note: '다음 주/월/분기/반기/연간 — Prediction ≠ Outcome' },
  { key: 'health_forecast', label: 'Predictive Organizational Health', status: 'supported', note: '7성분 재정규화 — 방향 expected 표기' },
  { key: 'forecast_recommendation', label: 'Forecast Recommendation', status: 'supported', note: '6종 whitelist · Evidence 필수 · 사람 승인' },
  { key: 'forecast_actual_compare', label: 'Forecast vs Actual 대조', status: 'supported', note: '사후 수동 기록만(자동 기록 없음)' },
  { key: 'auto_forecast_confirmation', label: '자동 Forecast 사실 확정', status: 'unsupported', note: '전면 금지' },
  { key: 'auto_assignment', label: '자동 배정/일정/Owner/KPI/Outcome 변경', status: 'unsupported', note: '전면 금지(AI-OPS-17·18 원칙 유지)' },
  { key: 'production_apply', label: 'Production/Merge/Deploy', status: 'unsupported', note: '미지원(의도적)' },
];
