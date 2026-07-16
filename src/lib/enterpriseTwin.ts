/**
 * enterpriseTwin — Enterprise Digital Twin, Scenario Intelligence &
 * Future State Prediction Center 순수 로직 (Phase AI-OPS-37).
 *
 * Current Enterprise State → Digital Twin → Scenario Injection → Multi-Agent Simulation →
 * Future State Prediction → Risk/Opportunity/Capacity Projection → Human Scenario Review →
 * Decision Option Comparison → Executive Recommendation → Knowledge Graph Reference.
 *
 * Twin 정직성(전부 코드로 강제):
 *  - Digital Twin ≠ Production. Prediction ≠ Future Fact. Projection ≠ Observation.
 *  - Scenario ≠ Reality. Confidence ≠ Correctness. Correlation ≠ Causality.
 *  - Simulation ≠ Execution. Recommendation ≠ Decision.
 *  - Unknown 유지(null→0 금지). 데이터 부족 시 insufficient_data.
 *  - 자동 실행/Production 변경/실제 Runtime·Connector·Automation 실행 없음.
 *  - 0499 digitalTwin(음악 도메인)과 별개 모듈 — 이름 충돌 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수(0540 CHECK와 1:1 정렬) ─────────────────────────────────────── */
export const SNAPSHOT_SOURCE_DOMAINS = ['organization', 'runtime', 'connector', 'agent', 'policy', 'decision', 'knowledge', 'capacity', 'cost', 'incident', 'approval'] as const;
export const SNAPSHOT_STATUSES = ['captured_reference', 'partial_reference', 'stale_candidate', 'invalidated', 'insufficient_data'] as const;
export const TWIN_LAYERS = ['runtime_twin', 'governance_twin', 'connector_twin', 'agent_twin', 'decision_twin', 'resource_twin', 'queue_twin', 'policy_twin'] as const;
export const TWIN_SCENARIO_TYPES = ['provider_down', 'connector_timeout', 'queue_explosion', 'approval_delay', 'region_failure', 'resource_shortage', 'human_absence', 'agent_failure', 'policy_conflict', 'cost_spike', 'scale_x2', 'scale_x10', 'new_connector', 'new_enterprise', 'multiple_policy_apply', 'massive_incident', 'recovery_failure', 'custom_scenario'] as const;
export const TWIN_SCENARIO_STATUSES = ['draft', 'pending_evidence', 'pending_review', 'approved_for_twin_reference', 'blocked_reference', 'rejected', 'invalidated', 'insufficient_data'] as const;
export const TWIN_SUPPORT_STATUSES = ['supported_reference', 'partially_supported', 'support_unverified', 'unsupported'] as const;
export const TWIN_RUN_STATUSES = ['draft', 'pending_review', 'running_reference', 'completed_reference', 'completed_with_limitation', 'failed_reference', 'blocked_reference', 'prediction_unverified', 'sample_too_small', 'insufficient_data'] as const;
export const PREDICTION_METRICS = ['incident_count', 'approval_queue', 'runtime_latency', 'resource_usage', 'cost', 'capacity', 'risk', 'human_workload', 'mttr', 'throughput'] as const;
export const COMPARISON_DIMENSIONS = ['risk', 'cost', 'capacity', 'human_workload', 'approval_delay', 'incident_probability', 'recovery_difficulty', 'confidence'] as const;
export const TWIN_RECOMMENDATION_TYPES = ['best_option_candidate', 'lowest_risk_candidate', 'lowest_cost_candidate', 'highest_capacity_candidate', 'human_approval_recommendation', 'insufficient_data'] as const;
export const TWIN_TIMELINE_STAGES = ['snapshot', 'twin_graph', 'scenario', 'injection', 'prediction', 'projection_review', 'comparison', 'recommendation', 'human_review'] as const;

/* ── 1) Snapshot Completeness(Snapshot ≠ Live 상태) ──────────────────── */
export function evaluateSnapshotCompleteness(i: { capturedSources: string[] | null; capturedAt: Date | null; now: Date; staleAfterHours: number }): { result: (typeof SNAPSHOT_STATUSES)[number]; missingDomains: string[]; snapshotIsNotLiveState: true; twinIsNotProduction: true } {
  const flags = { snapshotIsNotLiveState: true as const, twinIsNotProduction: true as const };
  if (i.capturedSources == null) return { result: 'insufficient_data', missingDomains: [], ...flags };
  const missingDomains = (SNAPSHOT_SOURCE_DOMAINS as readonly string[]).filter((d) => !i.capturedSources!.includes(d));
  if (missingDomains.length === SNAPSHOT_SOURCE_DOMAINS.length) return { result: 'insufficient_data', missingDomains, ...flags };
  if (missingDomains.length > 0) return { result: 'partial_reference', missingDomains, ...flags };
  if (i.capturedAt == null) return { result: 'insufficient_data', missingDomains, ...flags };
  const ageHours = (i.now.getTime() - i.capturedAt.getTime()) / 3_600_000;
  if (!isFiniteNumber(ageHours) || ageHours < 0) return { result: 'insufficient_data', missingDomains, ...flags };
  if (ageHours > i.staleAfterHours) return { result: 'stale_candidate', missingDomains, ...flags };
  return { result: 'captured_reference', missingDomains, ...flags };
}

/* ── 2) Twin Layer Coverage(Twin ≠ Production — 원본 있는 계층만 복제 Reference) ── */
export function evaluateTwinCoverage(layers: { layer: string; sourceAvailable: boolean | null; entityCount: number | null }[] | null): { rows: { layer: string; result: 'modeled_reference' | 'modeled_empty_reference' | 'source_missing' | 'layer_invalid' | 'insufficient_data' }[]; modeledCount: number; missingCount: number; twinIsNotProduction: true; twinIsReadOnly: true } {
  const rows = (layers ?? []).slice(0, 20).map((l) => {
    if (!(TWIN_LAYERS as readonly string[]).includes(l.layer)) return { layer: l.layer, result: 'layer_invalid' as const };
    if (l.sourceAvailable == null) return { layer: l.layer, result: 'insufficient_data' as const };
    if (!l.sourceAvailable) return { layer: l.layer, result: 'source_missing' as const };   // 원본 없는 계층은 임의 모델링 금지
    if (l.entityCount == null || !isFiniteNumber(l.entityCount) || l.entityCount < 0) return { layer: l.layer, result: 'insufficient_data' as const };
    return { layer: l.layer, result: l.entityCount === 0 ? 'modeled_empty_reference' as const : 'modeled_reference' as const };
  });
  return {
    rows,
    modeledCount: rows.filter((r) => r.result === 'modeled_reference' || r.result === 'modeled_empty_reference').length,
    missingCount: rows.filter((r) => r.result === 'source_missing').length,
    twinIsNotProduction: true, twinIsReadOnly: true,
  };
}

/* ── 3) Twin Scenario 구성(Scenario ≠ Reality) ───────────────────────── */
export function buildTwinScenario(i: { type: string; title: string; injectionParameters: Record<string, unknown>; horizonDays: number | null; sourceAvailable: boolean | null }):
  | { rejected: true; rejectReason: string }
  | { type: string; title: string; horizonDays: number | null; supportStatus: (typeof TWIN_SUPPORT_STATUSES)[number]; status: 'draft'; scenarioIsNotReality: true; autoExecuted: false; productionChanged: false } {
  if (!(TWIN_SCENARIO_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 scenario_type' };
  if (!i.title.trim()) return { rejected: true, rejectReason: 'title 필수' };
  if (i.horizonDays != null && (!isFiniteNumber(i.horizonDays) || i.horizonDays < 1 || i.horizonDays > 365)) return { rejected: true, rejectReason: 'horizon 1~365일 범위' };
  const supportStatus: (typeof TWIN_SUPPORT_STATUSES)[number] = i.sourceAvailable == null ? 'support_unverified' : i.sourceAvailable ? 'supported_reference' : 'partially_supported';
  return { type: i.type, title: i.title, horizonDays: i.horizonDays, supportStatus, status: 'draft', scenarioIsNotReality: true, autoExecuted: false, productionChanged: false };
}

/* ── 4) Scenario Injection 준비도(Injection 은 Twin 내부 Reference) ──── */
export function evaluateScenarioInjection(i: { scenarioStatus: string; snapshotStatus: string | null; targetLayers: string[]; layerCoverage: Record<string, boolean> }): { result: 'injection_ready_reference' | 'scenario_approval_missing' | 'snapshot_missing' | 'snapshot_invalidated' | 'target_layer_missing' | 'layer_source_missing' | 'insufficient_data'; missingLayers: string[]; injectionIsNotExecution: true; productionChanged: false } {
  const flags = { injectionIsNotExecution: true as const, productionChanged: false as const };
  if (i.scenarioStatus !== 'approved_for_twin_reference') return { result: 'scenario_approval_missing', missingLayers: [], ...flags };
  if (i.snapshotStatus == null) return { result: 'snapshot_missing', missingLayers: [], ...flags };
  if (i.snapshotStatus === 'invalidated') return { result: 'snapshot_invalidated', missingLayers: [], ...flags };
  if (!['captured_reference', 'partial_reference'].includes(i.snapshotStatus)) return { result: 'insufficient_data', missingLayers: [], ...flags };
  if (!i.targetLayers.length) return { result: 'target_layer_missing', missingLayers: [], ...flags };
  const missingLayers = i.targetLayers.filter((l) => i.layerCoverage[l] !== true);
  if (missingLayers.length) return { result: 'layer_source_missing', missingLayers, ...flags };
  return { result: 'injection_ready_reference', missingLayers: [], ...flags };
}

/* ── 5) Future Metric Projection(Prediction ≠ Future Fact — 선형 추정만) ── */
export function projectFutureMetric(i: { metric: string; baseline: number | null; multiplier: number | null; horizonDays: number | null }): { metric: string; projected: number | null; result: 'projected_reference' | 'metric_invalid' | 'baseline_unknown' | 'multiplier_unknown' | 'insufficient_data'; predictionIsNotFutureFact: true; projectionIsNotObservation: true } {
  const flags = { predictionIsNotFutureFact: true as const, projectionIsNotObservation: true as const };
  if (!(PREDICTION_METRICS as readonly string[]).includes(i.metric)) return { metric: i.metric, projected: null, result: 'metric_invalid', ...flags };
  if (i.baseline == null || !isFiniteNumber(i.baseline)) return { metric: i.metric, projected: null, result: 'baseline_unknown', ...flags };   // Unknown 유지 — 0 대체 금지
  if (i.multiplier == null || !isFiniteNumber(i.multiplier) || i.multiplier < 0) return { metric: i.metric, projected: null, result: 'multiplier_unknown', ...flags };
  if (i.horizonDays == null || !isFiniteNumber(i.horizonDays) || i.horizonDays < 1) return { metric: i.metric, projected: null, result: 'insufficient_data', ...flags };
  const projected = Math.round(i.baseline * i.multiplier * 100) / 100;
  if (!isFiniteNumber(projected)) return { metric: i.metric, projected: null, result: 'insufficient_data', ...flags };
  return { metric: i.metric, projected, result: 'projected_reference', ...flags };
}

/* ── 6) Risk Projection(후보 — 사실 아님) ────────────────────────────── */
export function projectRisk(i: { incidentBaseline: number | null; incidentMultiplier: number | null; mitigationsDefined: boolean; recoveryHistoryAvailable: boolean }): { result: 'risk_low_candidate' | 'risk_moderate_candidate' | 'risk_high_candidate' | 'risk_critical_candidate' | 'risk_unverified' | 'insufficient_data'; recoveryUnverified: boolean; riskIsNotFact: true } {
  const flags = { riskIsNotFact: true as const };
  if (i.incidentBaseline == null || !isFiniteNumber(i.incidentBaseline)) return { result: 'insufficient_data', recoveryUnverified: !i.recoveryHistoryAvailable, ...flags };
  if (i.incidentMultiplier == null || !isFiniteNumber(i.incidentMultiplier)) return { result: 'risk_unverified', recoveryUnverified: !i.recoveryHistoryAvailable, ...flags };
  const projected = i.incidentBaseline * i.incidentMultiplier;
  const recoveryUnverified = !i.recoveryHistoryAvailable;
  if (projected <= 0) return { result: 'risk_low_candidate', recoveryUnverified, ...flags };
  if (i.mitigationsDefined && projected <= 5) return { result: 'risk_low_candidate', recoveryUnverified, ...flags };
  if (projected <= 5) return { result: 'risk_moderate_candidate', recoveryUnverified, ...flags };
  if (projected <= 20) return { result: 'risk_high_candidate', recoveryUnverified, ...flags };
  return { result: 'risk_critical_candidate', recoveryUnverified, ...flags };
}

/* ── 7) Cost Projection(Cost 모델 없으면 추정 금지) ──────────────────── */
export function projectCost(i: { costModelAvailable: boolean; costBaseline: number | null; costMultiplier: number | null }): { projected: number | null; result: 'cost_projected_reference' | 'cost_model_missing' | 'cost_baseline_unknown' | 'insufficient_data'; costIsNotBilling: true; billingExecuted: false } {
  const flags = { costIsNotBilling: true as const, billingExecuted: false as const };
  if (!i.costModelAvailable) return { projected: null, result: 'cost_model_missing', ...flags };   // GPU 비용 피드 없음(실측) — 임의 추정 금지
  if (i.costBaseline == null || !isFiniteNumber(i.costBaseline)) return { projected: null, result: 'cost_baseline_unknown', ...flags };
  if (i.costMultiplier == null || !isFiniteNumber(i.costMultiplier) || i.costMultiplier < 0) return { projected: null, result: 'insufficient_data', ...flags };
  return { projected: Math.round(i.costBaseline * i.costMultiplier * 100) / 100, result: 'cost_projected_reference', ...flags };
}

/* ── 8) Capacity Projection ──────────────────────────────────────────── */
export function projectCapacity(i: { capacityBaseline: number | null; demandBaseline: number | null; demandMultiplier: number | null }): { result: 'capacity_sufficient_candidate' | 'capacity_tight_candidate' | 'capacity_exceeded_candidate' | 'capacity_unverified' | 'insufficient_data'; utilizationPct: number | null; estimateIsNotGuarantee: true } {
  const flags = { estimateIsNotGuarantee: true as const };
  if (i.capacityBaseline == null || !isFiniteNumber(i.capacityBaseline) || i.capacityBaseline < 0) return { result: 'capacity_unverified', utilizationPct: null, ...flags };
  if (i.demandBaseline == null || !isFiniteNumber(i.demandBaseline) || i.demandMultiplier == null || !isFiniteNumber(i.demandMultiplier) || i.demandMultiplier < 0) return { result: 'insufficient_data', utilizationPct: null, ...flags };
  if (i.capacityBaseline === 0) return { result: i.demandBaseline * i.demandMultiplier > 0 ? 'capacity_exceeded_candidate' : 'insufficient_data', utilizationPct: null, ...flags };
  const utilization = (i.demandBaseline * i.demandMultiplier) / i.capacityBaseline * 100;
  const utilizationPct = Math.round(utilization * 10) / 10;
  if (utilization > 100) return { result: 'capacity_exceeded_candidate', utilizationPct, ...flags };
  if (utilization > 80) return { result: 'capacity_tight_candidate', utilizationPct, ...flags };
  return { result: 'capacity_sufficient_candidate', utilizationPct, ...flags };
}

/* ── 9) Queue/Approval Queue Projection(범용 Queue 없음 — 승인 대기 counts 기반) ── */
export function projectApprovalQueue(i: { pendingBaseline: number | null; arrivalMultiplier: number | null; reviewersAvailable: number | null; reviewCapacityPerReviewer: number | null }): { result: 'queue_stable_candidate' | 'queue_growing_candidate' | 'queue_unbounded_candidate' | 'reviewer_missing_candidate' | 'queue_unverified' | 'insufficient_data'; projectedBacklog: number | null; queueIsProxyOnly: true } {
  const flags = { queueIsProxyOnly: true as const };   // 범용 Queue/Worker 없음(실측) — 승인 대기 proxy
  if (i.pendingBaseline == null || !isFiniteNumber(i.pendingBaseline) || i.pendingBaseline < 0) return { result: 'queue_unverified', projectedBacklog: null, ...flags };
  if (i.arrivalMultiplier == null || !isFiniteNumber(i.arrivalMultiplier) || i.arrivalMultiplier < 0) return { result: 'insufficient_data', projectedBacklog: null, ...flags };
  if (i.reviewersAvailable == null || !isFiniteNumber(i.reviewersAvailable) || i.reviewersAvailable < 0) return { result: 'insufficient_data', projectedBacklog: null, ...flags };
  const arrivals = i.pendingBaseline * i.arrivalMultiplier;
  if (i.reviewersAvailable === 0) return { result: arrivals > 0 ? 'queue_unbounded_candidate' : 'reviewer_missing_candidate', projectedBacklog: arrivals > 0 ? Math.round(arrivals) : null, ...flags };
  if (i.reviewCapacityPerReviewer == null || !isFiniteNumber(i.reviewCapacityPerReviewer) || i.reviewCapacityPerReviewer < 0) return { result: 'insufficient_data', projectedBacklog: null, ...flags };
  const capacity = i.reviewersAvailable * i.reviewCapacityPerReviewer;
  const backlog = Math.max(0, Math.round(arrivals - capacity));
  if (capacity === 0 && arrivals > 0) return { result: 'queue_unbounded_candidate', projectedBacklog: Math.round(arrivals), ...flags };
  if (backlog > 0) return { result: 'queue_growing_candidate', projectedBacklog: backlog, ...flags };
  return { result: 'queue_stable_candidate', projectedBacklog: 0, ...flags };
}

/* ── 10) Incident Projection ─────────────────────────────────────────── */
export function projectIncidents(i: { incidentBaseline: number | null; sampleSize: number | null; minSample: number; scenarioMultiplier: number | null }): { projected: number | null; result: 'incident_projected_reference' | 'sample_too_small' | 'baseline_unknown' | 'insufficient_data'; projectionIsNotObservation: true; correlationIsNotCausality: true } {
  const flags = { projectionIsNotObservation: true as const, correlationIsNotCausality: true as const };
  if (i.incidentBaseline == null || !isFiniteNumber(i.incidentBaseline)) return { projected: null, result: 'baseline_unknown', ...flags };
  if (i.sampleSize == null || !isFiniteNumber(i.sampleSize) || i.sampleSize < 0) return { projected: null, result: 'insufficient_data', ...flags };
  if (i.sampleSize < i.minSample) return { projected: null, result: 'sample_too_small', ...flags };   // 표본 부족 유지 — 재정규화 없음
  if (i.scenarioMultiplier == null || !isFiniteNumber(i.scenarioMultiplier) || i.scenarioMultiplier < 0) return { projected: null, result: 'insufficient_data', ...flags };
  return { projected: Math.round(i.incidentBaseline * i.scenarioMultiplier * 10) / 10, result: 'incident_projected_reference', ...flags };
}

/* ── 11) Human Workload Projection(자동 인사 판단 없음) ──────────────── */
export function projectHumanWorkload(i: { reviewBaseline: number | null; reviewMultiplier: number | null; reviewers: number | null }): { perReviewer: number | null; result: 'workload_projected_reference' | 'reviewer_unknown' | 'workload_unverified' | 'insufficient_data'; workloadIsNotPerformanceJudgement: true } {
  const flags = { workloadIsNotPerformanceJudgement: true as const };
  if (i.reviewBaseline == null || !isFiniteNumber(i.reviewBaseline) || i.reviewBaseline < 0) return { perReviewer: null, result: 'workload_unverified', ...flags };
  if (i.reviewMultiplier == null || !isFiniteNumber(i.reviewMultiplier) || i.reviewMultiplier < 0) return { perReviewer: null, result: 'insufficient_data', ...flags };
  if (i.reviewers == null || !isFiniteNumber(i.reviewers) || i.reviewers < 0) return { perReviewer: null, result: 'reviewer_unknown', ...flags };
  if (i.reviewers === 0) return { perReviewer: null, result: 'reviewer_unknown', ...flags };
  return { perReviewer: Math.round((i.reviewBaseline * i.reviewMultiplier) / i.reviewers * 10) / 10, result: 'workload_projected_reference', ...flags };
}

/* ── 12) Prediction Confidence(Confidence ≠ Correctness) ─────────────── */
export function calculatePredictionConfidence(i: { sourceCoverageRatio: number | null; sampleSize: number | null; minSample: number; unverifiedAssumptions: number | null; horizonDays: number | null }): { confidence: number | null; result: 'confidence_estimated' | 'insufficient_data'; confidenceIsNotCorrectness: true } {
  const flags = { confidenceIsNotCorrectness: true as const };
  if (i.sourceCoverageRatio == null || !isFiniteNumber(i.sourceCoverageRatio) || i.sampleSize == null || !isFiniteNumber(i.sampleSize) || i.horizonDays == null || !isFiniteNumber(i.horizonDays)) return { confidence: null, result: 'insufficient_data', ...flags };
  let score = clampScore(i.sourceCoverageRatio * 100);
  if (i.sampleSize < i.minSample) score = Math.min(score, 30);                    // 표본 부족은 상한 강제
  if (i.unverifiedAssumptions != null && isFiniteNumber(i.unverifiedAssumptions)) score = Math.max(0, score - i.unverifiedAssumptions * 10);
  if (i.horizonDays > 90) score = Math.min(score, 40);                            // 장기 예측은 상한 강제
  else if (i.horizonDays > 30) score = Math.min(score, 60);
  return { confidence: clampScore(score), result: 'confidence_estimated', ...flags };
}

/* ── 13) Best/Worst Case(둘 다 후보 — 사실 아님) ─────────────────────── */
export function buildBestWorstCase(projections: { metric: string; optimistic: number | null; pessimistic: number | null }[] | null): { best: { metric: string; value: number | null }[]; worst: { metric: string; value: number | null }[]; unknownCount: number; caseIsNotFact: true } {
  const rows = (projections ?? []).slice(0, 20);
  return {
    best: rows.map((p) => ({ metric: p.metric, value: isFiniteNumber(p.optimistic) ? p.optimistic : null })),
    worst: rows.map((p) => ({ metric: p.metric, value: isFiniteNumber(p.pessimistic) ? p.pessimistic : null })),
    unknownCount: rows.filter((p) => !isFiniteNumber(p.optimistic) || !isFiniteNumber(p.pessimistic)).length,
    caseIsNotFact: true,
  };
}

/* ── 14) Scenario Comparison(자동 승자 선택 없음) ────────────────────── */
export function compareTwinScenarios(runs: { runCode: string; dimensions: Record<string, number | null> }[] | null): { rows: { runCode: string; dimension: string; value: number | null; status: 'measured' | 'dimension_unverified' }[]; comparableDimensions: string[]; result: 'comparison_reference' | 'insufficient_runs' | 'insufficient_data'; winnerIsCandidateOnly: true; autoSelected: false } {
  const flags = { winnerIsCandidateOnly: true as const, autoSelected: false as const };
  if (runs == null || runs.length < 2) return { rows: [], comparableDimensions: [], result: 'insufficient_runs', ...flags };
  const rows = runs.slice(0, 10).flatMap((r) => (COMPARISON_DIMENSIONS as readonly string[]).map((d) => ({
    runCode: r.runCode, dimension: d,
    value: isFiniteNumber(r.dimensions[d]) ? r.dimensions[d] as number : null,
    status: isFiniteNumber(r.dimensions[d]) ? 'measured' as const : 'dimension_unverified' as const,   // 결측 차원은 unverified 유지 — 임의 보간 없음
  })));
  const comparableDimensions = (COMPARISON_DIMENSIONS as readonly string[]).filter((d) => runs.every((r) => isFiniteNumber(r.dimensions[d])));
  return { rows, comparableDimensions, result: comparableDimensions.length ? 'comparison_reference' : 'insufficient_data', ...flags };
}

/* ── 15) Executive Twin Recommendation(제안 전용 — 실행 없음) ────────── */
export function buildExecutiveTwinRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; comparedRuns?: string[]; limitations?: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number; comparedRuns: string[]; limitations: string[]; isRecommendationOnly: true; recommendationIsNotDecision: true; autoExecuted: false } {
  if (!(TWIN_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: '허용되지 않는 recommendation type' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'reason 필수' };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 추천 금지' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 20),
    confidence: clampScore(i.confidence ?? 0),
    comparedRuns: (i.comparedRuns ?? []).slice(0, 10), limitations: (i.limitations ?? []).slice(0, 10),
    isRecommendationOnly: true, recommendationIsNotDecision: true, autoExecuted: false,
  };
}

/* ── 16) Human Review 준비도 ─────────────────────────────────────────── */
export function evaluateHumanTwinReview(i: { runCompleted: boolean; unknownFactorsDocumented: boolean; limitationsDocumented: boolean; confidenceRecorded: boolean }): { result: 'review_ready_reference' | 'run_incomplete' | 'unknown_factors_missing' | 'limitations_missing' | 'confidence_missing'; reviewIsHumanOnly: true } {
  const flags = { reviewIsHumanOnly: true as const };
  if (!i.runCompleted) return { result: 'run_incomplete', ...flags };
  if (!i.unknownFactorsDocumented) return { result: 'unknown_factors_missing', ...flags };   // Unknown 미문서화 검토 금지
  if (!i.limitationsDocumented) return { result: 'limitations_missing', ...flags };
  if (!i.confidenceRecorded) return { result: 'confidence_missing', ...flags };
  return { result: 'review_ready_reference', ...flags };
}

/* ── 17) Twin Timeline(측정 카운트 — 완료 주장 아님) ─────────────────── */
export function buildTwinTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const rows = (counts ?? []).filter((c) => (TWIN_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  return {
    stages: rows.map((c) => ({ stage: c.stage, count: isFiniteNumber(c.count) && (c.count as number) >= 0 ? c.count : null, source: c.source, status: isFiniteNumber(c.count) && (c.count as number) >= 0 ? 'measured' as const : 'insufficient_data' as const })),
    invalidStages: (counts ?? []).length - rows.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 실측 구성요소(추측 없음 — 코드/Migration 기준) ──────────────────── */
export const TWIN_COMPONENTS: { key: string; available: boolean | null; note: string }[] = [
  { key: 'organization_0349', available: true, note: 'franchises/franchise_regions/franchise_stores — Region 개념 실존' },
  { key: 'runtime_0536', available: true, note: 'ai_runtime_execution_sessions/events — Runtime Twin 원천' },
  { key: 'connectors_0536', available: true, note: 'ai_connector_definitions/instances — Connector Topology 원천' },
  { key: 'agents_0497', available: true, note: 'ai_agents(8종 시드)+collaboration — Agent Twin 원천' },
  { key: 'policies_0512_0539', available: true, note: 'ai_enterprise_policies/versions + change specifications — Policy Twin 원천' },
  { key: 'decision_memory_0514', available: true, note: 'ai_decision_memory/outcomes — Decision Twin 원천' },
  { key: 'knowledge_graph_0513', available: true, note: 'ai_knowledge_entities/relationships — Knowledge Reference' },
  { key: 'capacity_cost_0508', available: true, note: 'ai_capacity_snapshots/ai_cost_snapshots — Resource Twin 원천' },
  { key: 'incidents_0502_0537', available: true, note: 'ai_incidents + incident candidates — Incident Projection 원천' },
  { key: 'gpu_cost_feed', available: false, note: 'GPU 비용 피드 없음 — cost_model_missing 처리(임의 추정 금지)' },
  { key: 'region_outage_feed', available: false, note: 'Region 장애 피드 없음 — region_failure 는 partially_supported' },
  { key: 'generic_queue_worker', available: false, note: '범용 Queue/Worker 없음 — Queue Projection 은 승인 대기 proxy 만' },
  { key: 'provider_state_feed', available: false, note: 'Provider 상태 피드 없음 — provider_down 은 partially_supported' },
  { key: 'human_absence_calendar', available: false, note: '휴가/캘린더 데이터 없음 — human_absence 는 partially_supported' },
  { key: 'load_test_infrastructure', available: false, note: '부하 테스트 인프라 없음 — Throughput 은 선형 추정 Reference 만' },
];

export const ENTERPRISE_TWIN_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'enterprise_state_snapshot', status: 'supported', note: '실제 테이블 read-only count 집계(원본 미변경)' },
  { key: 'runtime_twin_reference', status: 'supported', note: '0536 세션 counts 복제 Reference — Twin ≠ Production' },
  { key: 'governance_twin_reference', status: 'supported', note: '0496/0534 구조 참조' },
  { key: 'connector_twin_reference', status: 'supported', note: '0536 Topology counts 참조' },
  { key: 'agent_twin_reference', status: 'supported', note: '0497 Agent 레지스트리 참조' },
  { key: 'decision_twin_reference', status: 'supported', note: '0514 Decision Memory 참조' },
  { key: 'resource_twin_reference', status: 'supported', note: '0508 Capacity/Cost 스냅샷 참조' },
  { key: 'queue_twin_proxy', status: 'supported', note: '승인 대기 counts proxy(범용 Queue 없음 명시)' },
  { key: 'policy_twin_reference', status: 'supported', note: '0512/0539 Policy 상태 참조' },
  { key: 'scenario_library_17', status: 'supported', note: '17종 + custom — support 실측 판정(partially/unsupported 명시)' },
  { key: 'scenario_builder', status: 'supported', note: '주입 파라미터 정의만 — Scenario ≠ Reality' },
  { key: 'scenario_human_review', status: 'supported', note: '승인은 사람 + Evidence 필수' },
  { key: 'scenario_injection_reference', status: 'supported', note: 'Twin 내부 Reference — 실제 시스템 미변경' },
  { key: 'future_prediction_reference', status: 'supported', note: '선형 추정 + prediction_unverified/confidence/limitations/assumptions 동반 기록' },
  { key: 'risk_projection', status: 'supported', note: '후보만 — Risk ≠ Fact' },
  { key: 'opportunity_projection', status: 'supported', note: '후보만 — Benefit ≠ 실제 이익' },
  { key: 'cost_projection', status: 'supported', note: '비용 모델 있을 때만 — cost_model_missing 유지' },
  { key: 'capacity_projection', status: 'supported', note: 'Estimate ≠ Guarantee' },
  { key: 'throughput_projection', status: 'supported', note: '선형 추정 Reference(부하 테스트 없음 명시)' },
  { key: 'queue_projection', status: 'supported', note: '승인 대기 proxy — queue_unbounded 후보 검출' },
  { key: 'incident_projection', status: 'supported', note: '표본 부족 시 sample_too_small 유지' },
  { key: 'approval_queue_projection', status: 'supported', note: 'reviewer 0명 → unbounded 후보' },
  { key: 'kpi_projection', status: 'supported', note: 'Projection ≠ Observation' },
  { key: 'human_workload_projection', status: 'supported', note: '자동 인사 판단 없음' },
  { key: 'best_worst_case', status: 'supported', note: '둘 다 후보 — Case ≠ Fact' },
  { key: 'confidence_calculation', status: 'supported', note: 'Confidence ≠ Correctness — 표본/기간 상한 강제' },
  { key: 'unknown_factor_preservation', status: 'supported', note: 'Unknown 유지(null→0 금지)' },
  { key: 'scenario_comparison', status: 'supported', note: '자동 승자 선택 없음 — 결측 차원 unverified 유지' },
  { key: 'executive_recommendation', status: 'supported', note: '후보 제안만(6종) — Recommendation ≠ Decision' },
  { key: 'human_review_request', status: 'supported', note: 'Unknown/Limitations/Confidence 문서화 선행' },
  { key: 'knowledge_graph_reference', status: 'supported', note: '0513 참조 기록만 — 자동 그래프 변형 없음' },
  { key: 'audit_trail', status: 'supported', note: 'ai_enterprise_twin_events 21종' },
  { key: 'secret_payload_rejection', status: 'supported', note: '_runtime_reject_secret_payload(0536) 재사용' },
  { key: 'idempotency_key', status: 'supported', note: 'partial unique index' },
  { key: 'production_change', status: 'unsupported', note: 'Production 변경 없음 — 해당 RPC 자체가 없음' },
  { key: 'real_runtime_change', status: 'unsupported', note: '실제 Runtime 변경 없음' },
  { key: 'real_connector_execution', status: 'unsupported', note: '실제 Connector 실행 없음' },
  { key: 'real_automation_execution', status: 'unsupported', note: '실제 Automation 실행 없음' },
  { key: 'real_rollout', status: 'unsupported', note: '실제 Rollout 없음(0539 도 Reference 만)' },
  { key: 'real_deploy_merge_migration', status: 'unsupported', note: 'Deploy/Merge/Migration 없음' },
  { key: 'real_notification_dispatch', status: 'unsupported', note: 'Slack/Email/Push 발송 없음' },
  { key: 'real_billing', status: 'unsupported', note: '비용 청구 없음 — Cost Projection 은 참고 수치' },
  { key: 'real_infra_change', status: 'unsupported', note: '인프라 변경 없음' },
  { key: 'real_permission_change', status: 'unsupported', note: '권한 변경 없음' },
  { key: 'real_policy_change', status: 'unsupported', note: '정책 변경 없음(0539 Reference 흐름 별도)' },
  { key: 'auto_scenario_execution', status: 'unsupported', note: '자동 Scenario 실행 없음 — 미실행 completed 차단' },
  { key: 'auto_winner_selection', status: 'unsupported', note: '비교 자동 승자 선택 없음' },
  { key: 'auto_knowledge_mutation', status: 'unsupported', note: 'Knowledge Graph 자동 변형 없음' },
];
