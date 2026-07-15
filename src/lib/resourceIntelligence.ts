/**
 * resourceIntelligence — Enterprise Resource Intelligence/Capacity Planning/
 * Operational Optimization Center 순수 로직 (Phase AI-OPS-26).
 *
 * Enterprise → Resources → Capacity → Utilization → Optimization →
 * Operational Efficiency → Executive Resource Advisory.
 * AI는 자원/Capacity/병목 분석만 — 자동 서버 증설/축소/인프라·모델·Capacity·비용 변경 없음.
 *
 * Resource 정직성(전부 코드로 강제):
 *  - Capacity ≠ Demand. Utilization ≠ Efficiency. Bottleneck ≠ Root Cause.
 *  - Forecast ≠ Actual. Recommendation ≠ Operational Decision.
 *  - Unknown 유지(null→0 금지). 표본 부족 sample_too_small.
 *  - 데이터 부족 insufficient_data. 근거 부족 resource_unverified. 원본 없음 resource_unavailable.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';
import { classifyTrend } from './performanceIntelligence';

export { classifyTrend };   // Capacity Trend 는 0525 4분류 재사용

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const RESOURCE_KINDS = ['compute', 'storage', 'database', 'network', 'ai_model', 'cloud_service', 'external_service'] as const;
export const RESOURCE_STATUSES = ['active', 'maintenance', 'deprecated', 'unknown'] as const;
export const BOTTLENECK_KINDS = ['cpu_bottleneck', 'memory_bottleneck', 'storage_bottleneck', 'network_bottleneck', 'queue_bottleneck'] as const;
export const RESOURCE_RECOMMENDATION_TYPES = ['review_capacity', 'validate_usage', 'reduce_waste', 'review_bottleneck', 'improve_monitoring', 'gather_more_evidence'] as const;
export const FORECAST_HORIZONS = ['next_week', 'next_month', 'quarter', 'annual'] as const;

/* ── 2) Capacity 평가(실측 기반만 — Capacity ≠ Demand) ───────────────── */
export function assessCapacity(i: { current: number | null; used: number | null }): { remaining: number | null; pressurePct: number | null; verdict: 'measured' | 'insufficient_data'; capacityIsNotDemand: true } {
  if (i.current == null || i.used == null || !isFiniteNumber(i.current) || !isFiniteNumber(i.used) || i.current <= 0) {
    return { remaining: null, pressurePct: null, verdict: 'insufficient_data', capacityIsNotDemand: true };
  }
  return {
    remaining: Math.round((i.current - i.used) * 100) / 100,
    pressurePct: clampScore((i.used / i.current) * 100),
    verdict: 'measured', capacityIsNotDemand: true,
  };
}

/* ── 3) Utilization(없는 데이터는 resource_unavailable 유지) ─────────── */
export function analyzeUtilization(resources: { key: string; usagePct: number | null }[] | null): { rows: { key: string; usagePct: number | null; status: 'measured' | 'resource_unavailable' }[]; measuredCount: number; unavailableCount: number; utilizationIsNotEfficiency: true } {
  const rows = (resources ?? []).slice(0, 20).map((r) => ({
    key: r.key,
    usagePct: r.usagePct != null && isFiniteNumber(r.usagePct) ? clampScore(r.usagePct) : null,
    status: r.usagePct != null && isFiniteNumber(r.usagePct) ? ('measured' as const) : ('resource_unavailable' as const),
  }));
  return {
    rows,
    measuredCount: rows.filter((r) => r.status === 'measured').length,
    unavailableCount: rows.filter((r) => r.status === 'resource_unavailable').length,
    utilizationIsNotEfficiency: true,
  };
}

/* ── 4) AI Resource(원본 없으면 unavailable — 자동 증설 없음) ────────── */
export function analyzeAiResource(i: { tokenConsumption: number | null; inferenceRequests: number | null; queueLength: number | null; processingTimeMs: number | null; modelAvailabilityPct: number | null }): { components: { key: string; value: number | null; status: 'measured' | 'resource_unavailable' }[]; verdict: 'partial_measured' | 'resource_unavailable'; noAutoScaling: true } {
  const comp = (key: string, value: number | null) => ({ key, value: value != null && isFiniteNumber(value) ? value : null, status: value != null && isFiniteNumber(value) ? ('measured' as const) : ('resource_unavailable' as const) });
  const components = [
    comp('ai_token_consumption', i.tokenConsumption),
    comp('inference_requests', i.inferenceRequests),
    comp('queue_length', i.queueLength),
    comp('processing_time_ms', i.processingTimeMs),
    comp('model_availability_pct', i.modelAvailabilityPct),
  ];
  return { components, verdict: components.some((c) => c.status === 'measured') ? 'partial_measured' : 'resource_unavailable', noAutoScaling: true };
}

/* ── 5) Infrastructure Efficiency(실측만 — 추정 금지) ────────────────── */
export function evaluateInfraEfficiency(i: { metrics: { key: string; utilizationPct: number | null; sample: number }[] }): { wasteCandidates: string[]; saturationCandidates: string[]; balance: 'balanced_candidate' | 'imbalanced_candidate' | 'insufficient_data'; excluded: string[]; efficiencyIsMeasuredOnly: true } {
  const measured = i.metrics.filter((m) => m.utilizationPct != null && isFiniteNumber(m.utilizationPct) && m.sample >= 5);
  const excluded = i.metrics.filter((m) => !(m.utilizationPct != null && isFiniteNumber(m.utilizationPct) && m.sample >= 5)).map((m) => `${m.key}: ${m.utilizationPct == null ? 'resource_unavailable' : 'sample_too_small'}`);
  if (!measured.length) return { wasteCandidates: [], saturationCandidates: [], balance: 'insufficient_data', excluded, efficiencyIsMeasuredOnly: true };
  const wasteCandidates = measured.filter((m) => (m.utilizationPct as number) < 10).map((m) => `${m.key}(저활용 후보 — Waste 단정 아님)`);
  const saturationCandidates = measured.filter((m) => (m.utilizationPct as number) >= 90).map((m) => `${m.key}(포화 후보)`);
  const values = measured.map((m) => m.utilizationPct as number);
  const spread = Math.max(...values) - Math.min(...values);
  return { wasteCandidates, saturationCandidates, balance: spread > 60 ? 'imbalanced_candidate' : 'balanced_candidate', excluded, efficiencyIsMeasuredOnly: true };
}

/* ── 6) Capacity Forecast(Prediction — Forecast ≠ Actual) ────────────── */
export function forecastCapacity(points: { value: number | null }[] | null, horizon: string): { horizon: string; projected: number | null; basis: string | null; verdict: 'forecast_candidate' | 'sample_too_small' | 'insufficient_data' | 'invalid_horizon'; forecastIsNotActual: true } {
  if (!(FORECAST_HORIZONS as readonly string[]).includes(horizon)) return { horizon, projected: null, basis: null, verdict: 'invalid_horizon', forecastIsNotActual: true };
  const values = (points ?? []).map((p) => p.value).filter((v): v is number => v != null && isFiniteNumber(v));
  if (!values.length) return { horizon, projected: null, basis: null, verdict: 'insufficient_data', forecastIsNotActual: true };
  if (values.length < 7) return { horizon, projected: null, basis: null, verdict: 'sample_too_small', forecastIsNotActual: true };
  const t = classifyTrend(values.map((v) => ({ value: v })));
  const last = values[values.length - 1];
  const periods = horizon === 'next_week' ? 1 : horizon === 'next_month' ? 4 : horizon === 'quarter' ? 12 : 52;
  const weeklyRate = t.changePct != null ? (t.changePct / 100) / Math.max(1, Math.floor(values.length / 7)) : 0;
  const projected = Math.round(last * (1 + weeklyRate * periods) * 100) / 100;
  return { horizon, projected: projected >= 0 ? projected : 0, basis: `최근 ${values.length}일 실측 추세(${t.trend ?? '—'} ${t.changePct ?? '—'}%)`, verdict: 'forecast_candidate', forecastIsNotActual: true };
}

/* ── 7) Bottleneck(후보만 — Root Cause 단정 아님) ────────────────────── */
export function detectBottlenecks(signals: { kind: string; signal: number | null; threshold: number; evidence: string[] }[] | null): { candidates: { kind: string; verdict: 'bottleneck_candidate' | 'no_known_bottleneck' | 'resource_unavailable' | 'resource_unverified' }[]; bottleneckIsNotRootCause: true } {
  const candidates = (signals ?? []).filter((s) => (BOTTLENECK_KINDS as readonly string[]).includes(s.kind)).map((s) => {
    if (!s.evidence.length) return { kind: s.kind, verdict: 'resource_unverified' as const };
    if (s.signal == null || !isFiniteNumber(s.signal)) return { kind: s.kind, verdict: 'resource_unavailable' as const };
    return { kind: s.kind, verdict: s.signal >= s.threshold ? ('bottleneck_candidate' as const) : ('no_known_bottleneck' as const) };
  });
  return { candidates, bottleneckIsNotRootCause: true };
}

/* ── 8) Operational Efficiency(Evidence 없는 컴포넌트 점수 제외) ─────── */
export const OP_EFFICIENCY_COMPONENTS = ['infrastructure_efficiency', 'ai_efficiency', 'database_efficiency', 'network_efficiency', 'resource_balance'] as const;

export function evaluateOperationalEfficiency(components: { component: string; score: number | null; evidence: string[] }[]): { overall: number | null; byComponent: { component: string; score: number | null; evidenceCount: number }[]; missingComponents: string[]; unknownFactors: string[]; scoreOnlyReturn: false } {
  const valid = components.filter((c) => (OP_EFFICIENCY_COMPONENTS as readonly string[]).includes(c.component));
  const { score, missing } = normalizeAvailableComponents(valid.map((c) => ({ key: c.component, value: c.evidence.length ? c.score : null, weight: 1 })));
  return {
    overall: score,
    byComponent: valid.map((c) => ({ component: c.component, score: c.evidence.length && c.score != null && isFiniteNumber(c.score) ? clampScore(c.score) : null, evidenceCount: c.evidence.length })),
    missingComponents: missing,
    unknownFactors: valid.filter((c) => !c.evidence.length).map((c) => `${c.component}: Evidence 없음 — 점수 제외`),
    scoreOnlyReturn: false,
  };
}

/* ── 11) Executive Resource Briefing(자동 발송 없음) ─────────────────── */
export const RESOURCE_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildResourceBriefing(i: { periodKind: string; capacityChanges: string[]; resourcePressure: string[]; bottlenecks: string[]; unknownFactors: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; capacityIsNotDemand: true } {
  return {
    periodKind: i.periodKind,
    valid: (RESOURCE_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'capacity_changes', items: i.capacityChanges.slice(0, 10) },
      { key: 'resource_pressure', items: i.resourcePressure.slice(0, 10) },
      { key: 'bottlenecks', items: i.bottlenecks.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, capacityIsNotDemand: true,
  };
}

/* ── 10) Resource Recommendation(6종 whitelist·Evidence 필수) ────────── */
export function buildResourceRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(RESOURCE_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(resource_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Operational Decision', 'Capacity ≠ Demand', 'Bottleneck ≠ Root Cause'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Resource & Capacity Cockpit(8영역) ──────────────────────────── */
export function buildResourceCockpit(i: { registryTotal: number; capacityMeasured: number; utilizationMeasured: number; aiResourceVerdict: string; infraBalance: string; bottleneckCandidates: number; opEfficiencyOverall: number | null; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; autoScaled: false } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'resource_registry', headline: n(i.registryTotal), detail: '사람 등록 자원 — 자동 증설/축소 없음' },
      { key: 'capacity', headline: n(i.capacityMeasured), detail: '실측 Capacity 스냅샷 — Capacity ≠ Demand' },
      { key: 'utilization', headline: n(i.utilizationMeasured), detail: 'Utilization ≠ Efficiency' },
      { key: 'ai_resources', headline: i.aiResourceVerdict, detail: '모델 사용 로그 원본 기준 — 자동 증설 없음' },
      { key: 'infrastructure', headline: i.infraBalance, detail: '실측만 사용(추정 금지)' },
      { key: 'bottlenecks', headline: n(i.bottleneckCandidates), detail: '후보 — Bottleneck ≠ Root Cause' },
      { key: 'operational_efficiency', headline: i.opEfficiencyOverall == null ? 'insufficient_data' : String(i.opEfficiencyOverall), detail: 'Evidence 없는 컴포넌트 점수 제외' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, autoScaled: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const RESOURCE_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'resource_registry', status: 'supported', note: '7 kind·4상태(active/maintenance/deprecated/unknown) 사람 등록' },
  { key: 'capacity_metrics', status: 'supported', note: 'ai_capacity_metrics/snapshots(0508) 실측 참조' },
  { key: 'capacity_pressure', status: 'supported', note: '실측 usage/limit 기반만 — Capacity ≠ Demand' },
  { key: 'capacity_trend', status: 'supported', note: '0525 4분류 재사용 + sample 방어' },
  { key: 'capacity_forecast', status: 'supported', note: '4 horizon Prediction — Forecast ≠ Actual' },
  { key: 'db_row_usage', status: 'supported', note: 'tracks/playlists/users 행 수 실측' },
  { key: 'playback_volume', status: 'supported', note: 'playback_events_v2 일별 볼륨 실측' },
  { key: 'cpu_memory_gpu_usage', status: 'unsupported', note: 'APM 원본 없음 — resource_unavailable' },
  { key: 'network_usage', status: 'unsupported', note: '네트워크 측정 원본 없음 — resource_unavailable' },
  { key: 'ai_token_inference', status: 'unsupported', note: '모델 사용 로그 원본 없음 — resource_unavailable' },
  { key: 'waste_detection', status: 'partial', note: '실측 저활용 후보만 — Waste 단정 아님' },
  { key: 'bottleneck_candidates', status: 'partial', note: '실측 신호 있는 병목만 후보 — Root Cause 단정 아님' },
  { key: 'operational_efficiency', status: 'partial', note: 'Evidence 있는 컴포넌트만 점수 산정' },
  { key: 'resource_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'auto_scaling', status: 'unsupported', note: '자동 서버 증설/축소/인프라·모델 변경 금지' },
  { key: 'auto_cost_change', status: 'unsupported', note: '자동 비용/계약/Capacity 변경 금지' },
];
