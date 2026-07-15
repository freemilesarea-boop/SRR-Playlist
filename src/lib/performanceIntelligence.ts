/**
 * performanceIntelligence — Enterprise Performance Intelligence/KPI Intelligence/
 * Executive Performance Center 순수 로직 (Phase AI-OPS-22).
 *
 * Outcome → Business Performance → KPI Intelligence → Executive Performance → Strategic Learning.
 * AI는 KPI 분석/관계 설명/변화 원인 제시만 — KPI 자동 생성/수정/목표 변경 없음.
 *
 * KPI 정직성(전부 코드로 강제):
 *  - KPI ≠ Business Success. Trend ≠ Guarantee. Correlation ≠ Causation.
 *  - Forecast ≠ Actual. Variance ≠ Failure. Health ≠ Business Quality. Recommendation ≠ Decision.
 *  - Unknown 유지(null→0 금지). 표본 부족 sample_too_small. 데이터 부족 insufficient_data.
 *  - 근거 부족 kpi_unverified. 외부 벤치마크는 실제 데이터 없으면 수행 안 함.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type VarianceVerdict = 'positive' | 'neutral' | 'negative' | 'variance_unknown';
export type TrendVerdict = 'improving' | 'stable' | 'declining' | 'volatile';
export type KpiHealth = 'healthy' | 'watch' | 'at_risk' | 'unknown';

export const KPI_HIERARCHY_LEVELS = ['corporate_goal', 'strategic_objective', 'business_kpi', 'operational_kpi', 'execution_metric'] as const;
export const PERF_RECOMMENDATION_TYPES = ['review_kpi', 'validate_evidence', 'investigate_variance', 'review_trend', 'review_strategy_link', 'gather_more_data'] as const;

/* ── 2) KPI Hierarchy(Goal→…→Execution Metrics, orphan/cycle 감지) ───── */
export function buildKpiHierarchy(nodes: { id: string; level: string; label: string; parentId: string | null }[] | null): { levels: { level: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[] } {
  const valid = (nodes ?? []).filter((n) => (KPI_HIERARCHY_LEVELS as readonly string[]).includes(n.level));
  const ids = new Set(valid.map((n) => n.id));
  const orphans = valid.filter((n) => n.level !== 'corporate_goal' && (!n.parentId || !ids.has(n.parentId))).map((n) => n.id);
  const cycles: string[] = [];
  for (const n of valid) {
    const path = new Set<string>([n.id]);
    let cursor = n.parentId;
    while (cursor && ids.has(cursor)) {
      if (path.has(cursor)) { cycles.push(`${n.id}→…→${cursor}`); break; }
      path.add(cursor);
      cursor = valid.find((x) => x.id === cursor)?.parentId ?? null;
      if (path.size > 20) break;   // depth 방어
    }
  }
  return {
    levels: KPI_HIERARCHY_LEVELS.map((level) => ({ level, nodes: valid.filter((n) => n.level === level).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans, cycles: [...new Set(cycles)].slice(0, 10),
  };
}

/* ── 3) KPI Attribution(원인 후보 — 인과 확정 아님) ──────────────────── */
export function analyzeKpiAttribution(i: { kpiKey: string; direction: 'up' | 'down' | 'flat' | 'unknown'; candidateFactors: string[]; evidence: string[]; unknownFactors: string[] }): { kpiKey: string; verdict: 'attribution_candidate' | 'attribution_unverified' | 'insufficient_data'; candidates: string[]; confidence: number | null; notCausalConfirmation: true } {
  if (!i.evidence.length) return { kpiKey: i.kpiKey, verdict: 'attribution_unverified', candidates: [], confidence: null, notCausalConfirmation: true };
  if (!i.candidateFactors.length || i.direction === 'unknown') return { kpiKey: i.kpiKey, verdict: 'insufficient_data', candidates: [], confidence: null, notCausalConfirmation: true };
  const confidence = clampScore(Math.max(0, 70 - i.unknownFactors.length * 15));
  return { kpiKey: i.kpiKey, verdict: 'attribution_candidate', candidates: i.candidateFactors.slice(0, 10), confidence, notCausalConfirmation: true };
}

/* ── 4) KPI Variance(Positive/Neutral/Negative/Unknown 만) ───────────── */
export function classifyVariance(i: { actual: number | null; target: number | null; direction?: 'higher_is_better' | 'lower_is_better' | 'unspecified'; tolerancePct?: number }): { verdict: VarianceVerdict; variance: number | null; variancePct: number | null; varianceIsNotFailure: true; forecastIsNotActual: true } {
  if (i.actual == null || i.target == null || !isFiniteNumber(i.actual) || !isFiniteNumber(i.target)) {
    return { verdict: 'variance_unknown', variance: null, variancePct: null, varianceIsNotFailure: true, forecastIsNotActual: true };
  }
  const variance = Math.round((i.actual - i.target) * 100) / 100;
  const variancePct = i.target !== 0 ? Math.round((variance / Math.abs(i.target)) * 10000) / 100 : null;
  const tol = isFiniteNumber(i.tolerancePct ?? NaN) ? Math.abs(i.tolerancePct as number) : 5;
  const withinTol = variancePct != null ? Math.abs(variancePct) <= tol : variance === 0;
  const better = (i.direction ?? 'higher_is_better') === 'lower_is_better' ? variance < 0 : variance > 0;
  const verdict: VarianceVerdict = withinTol ? 'neutral' : better ? 'positive' : 'negative';
  return { verdict, variance, variancePct, varianceIsNotFailure: true, forecastIsNotActual: true };
}

/* ── 5) KPI Trend(Improving/Stable/Declining/Volatile 만 + 표본 방어) ── */
export function classifyTrend(points: { value: number | null }[] | null, opts?: { minSample?: number }): { trend: TrendVerdict | null; dataStatus: 'ok' | 'sample_too_small' | 'insufficient_data'; changePct: number | null; trendIsNotGuarantee: true } {
  const values = (points ?? []).map((p) => p.value).filter((v): v is number => v != null && isFiniteNumber(v));
  if (!values.length) return { trend: null, dataStatus: 'insufficient_data', changePct: null, trendIsNotGuarantee: true };
  const minSample = opts?.minSample ?? 4;
  if (values.length < minSample) return { trend: null, dataStatus: 'sample_too_small', changePct: null, trendIsNotGuarantee: true };
  const half = Math.floor(values.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = avg(values.slice(0, half));
  const second = avg(values.slice(half));
  const changePct = first !== 0 ? Math.round(((second - first) / Math.abs(first)) * 10000) / 100 : null;
  const mean = avg(values);
  const cv = mean !== 0 ? Math.sqrt(avg(values.map((v) => (v - mean) ** 2))) / Math.abs(mean) : 0;
  let trend: TrendVerdict;
  if (cv > 0.6) trend = 'volatile';
  else if (changePct != null && changePct > 10) trend = 'improving';
  else if (changePct != null && changePct < -10) trend = 'declining';
  else trend = 'stable';
  return { trend, dataStatus: 'ok', changePct, trendIsNotGuarantee: true };
}

/* ── 8) KPI Health(Evidence 필수 — Health ≠ Business Quality) ────────── */
export function assessKpiHealth(i: { variance: VarianceVerdict; trend: TrendVerdict | null; evidence: string[] }): { health: KpiHealth; verdict: 'ok' | 'kpi_unverified'; reasons: string[]; healthIsNotBusinessQuality: true } {
  if (!i.evidence.length) return { health: 'unknown', verdict: 'kpi_unverified', reasons: ['Evidence 없음 — health 판정 보류'], healthIsNotBusinessQuality: true };
  if (i.variance === 'variance_unknown' && i.trend == null) return { health: 'unknown', verdict: 'ok', reasons: ['variance/trend 자료 없음 — unknown 유지'], healthIsNotBusinessQuality: true };
  const reasons: string[] = [];
  let health: KpiHealth = 'healthy';
  if (i.variance === 'negative') { health = 'at_risk'; reasons.push('variance negative(Variance ≠ Failure)'); }
  else if (i.trend === 'declining' || i.trend === 'volatile') { health = 'watch'; reasons.push(`trend ${i.trend}(Trend ≠ Guarantee)`); }
  else reasons.push('variance/trend 이상 신호 없음');
  return { health, verdict: 'ok', reasons, healthIsNotBusinessQuality: true };
}

/* ── 7) Benchmark(내부 기간 비교만 — 외부 비교는 실데이터 없으면 안 함) ── */
export function compareBenchmark(i: { metric: string; current: number | null; previous: number | null; previousLabel: string; external?: { value: number | null; source: string | null } }): { metric: string; verdict: 'compared' | 'benchmark_unavailable'; delta: number | null; deltaPct: number | null; externalComparison: { performed: false; reason: string } | { performed: true; source: string; delta: number }; previousLabel: string } {
  const externalComparison = i.external && i.external.value != null && isFiniteNumber(i.external.value) && i.external.source && i.current != null && isFiniteNumber(i.current)
    ? { performed: true as const, source: i.external.source, delta: Math.round((i.current - i.external.value) * 100) / 100 }
    : { performed: false as const, reason: '외부 실데이터 없음 — 외부 비교 수행 안 함' };
  if (i.current == null || i.previous == null || !isFiniteNumber(i.current) || !isFiniteNumber(i.previous)) {
    return { metric: i.metric, verdict: 'benchmark_unavailable', delta: null, deltaPct: null, externalComparison, previousLabel: i.previousLabel };
  }
  const delta = Math.round((i.current - i.previous) * 100) / 100;
  const deltaPct = i.previous !== 0 ? Math.round((delta / Math.abs(i.previous)) * 10000) / 100 : null;
  return { metric: i.metric, verdict: 'compared', delta, deltaPct, externalComparison, previousLabel: i.previousLabel };
}

/* ── 9) Strategy↔Performance Correlation(Correlation ≠ Causation) ────── */
export function correlateStrategyPerformance(pairs: { label: string; strategySignal: number | null; kpiSignal: number | null; sample: number }[] | null): { pairs: { label: string; verdict: 'correlation_candidate' | 'no_known_correlation' | 'sample_too_small' | 'insufficient_data'; strength: 'strong_candidate' | 'weak_candidate' | null }[]; correlationIsNotCausation: true } {
  const out = (pairs ?? []).slice(0, 20).map((p) => {
    if (p.strategySignal == null || p.kpiSignal == null || !isFiniteNumber(p.strategySignal) || !isFiniteNumber(p.kpiSignal)) {
      return { label: p.label, verdict: 'insufficient_data' as const, strength: null };
    }
    if (p.sample < 5) return { label: p.label, verdict: 'sample_too_small' as const, strength: null };
    const sameDirection = (p.strategySignal > 0 && p.kpiSignal > 0) || (p.strategySignal < 0 && p.kpiSignal < 0);
    if (!sameDirection || p.strategySignal === 0 || p.kpiSignal === 0) return { label: p.label, verdict: 'no_known_correlation' as const, strength: null };
    const strength = Math.min(Math.abs(p.strategySignal), Math.abs(p.kpiSignal)) >= 20 ? ('strong_candidate' as const) : ('weak_candidate' as const);
    return { label: p.label, verdict: 'correlation_candidate' as const, strength };
  });
  return { pairs: out, correlationIsNotCausation: true };
}

/* ── 10) Executive Briefing(자동 발송 없음) ──────────────────────────── */
export const BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildExecutiveBriefing(i: { periodKind: string; kpiChanges: { kpi: string; note: string }[]; risks: string[]; opportunities: string[]; unknownFactors: string[]; executiveNotes: string | null }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; kpiIsNotBusinessSuccess: true } {
  const valid = (BRIEFING_PERIODS as readonly string[]).includes(i.periodKind);
  return {
    periodKind: i.periodKind,
    valid,
    sections: [
      { key: 'kpi_changes', items: i.kpiChanges.slice(0, 20).map((c) => `${c.kpi}: ${c.note}`) },
      { key: 'risks', items: i.risks.slice(0, 10) },
      { key: 'opportunities', items: i.opportunities.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
      { key: 'executive_notes', items: i.executiveNotes ? [i.executiveNotes] : [] },
    ],
    autoSendDisabled: true, kpiIsNotBusinessSuccess: true,
  };
}

/* ── 11) Performance Recommendation(6종 whitelist·Evidence 필수) ─────── */
export function buildPerformanceRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(PERF_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(kpi_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Decision', 'KPI ≠ Business Success', 'Confidence ≠ Correctness'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Executive Performance Cockpit(8영역) ────────────────────────── */
export function buildPerformanceCockpit(i: { kpiTotal: number; kpiUnavailable: number; hierarchyOrphans: number; trendsAnalyzed: number; varianceNegative: number; healthAtRisk: number; benchmarksCompared: number; recommendationsOpen: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; kpiIsNotBusinessSuccess: true } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'kpi_overview', headline: n(i.kpiTotal), detail: `KPI ${n(i.kpiTotal)}개 · unavailable ${n(i.kpiUnavailable)} (KPI ≠ Business Success)` },
      { key: 'kpi_hierarchy', headline: n(i.hierarchyOrphans), detail: `미연결 노드 ${n(i.hierarchyOrphans)}` },
      { key: 'kpi_trends', headline: n(i.trendsAnalyzed), detail: 'Trend ≠ Guarantee' },
      { key: 'kpi_variance', headline: n(i.varianceNegative), detail: 'Variance ≠ Failure' },
      { key: 'kpi_health', headline: n(i.healthAtRisk), detail: 'Health ≠ Business Quality' },
      { key: 'performance_benchmark', headline: n(i.benchmarksCompared), detail: '내부 기간 비교만(외부 실데이터 없음)' },
      { key: 'performance_recommendation', headline: n(i.recommendationsOpen), detail: 'Recommendation ≠ Decision' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, kpiIsNotBusinessSuccess: true,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const PERFORMANCE_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'mrr_actual', status: 'supported', note: 'subscriptions.current_amount 실측' },
  { key: 'arr_derived', status: 'supported', note: 'ARR = MRR×12 파생(계약 확정 아님)' },
  { key: 'member_growth', status: 'supported', note: 'users.created_at 실측' },
  { key: 'active_stores', status: 'supported', note: 'playback_events_v2.business_id 실측(등록 매장 아님)' },
  { key: 'active_artists', status: 'partial', note: '등록 아티스트 수만 실측(활동 지표 원본 없음)' },
  { key: 'listening_hours', status: 'supported', note: 'playback_events_v2.listened_seconds 실측' },
  { key: 'playlist_quality_proxy', status: 'partial', note: 'fit_score 평균 Proxy — 품질 단정 아님' },
  { key: 'system_stability_proxy', status: 'partial', note: 'player_error/play_start 비율 Proxy — APM 아님' },
  { key: 'kpi_hierarchy', status: 'supported', note: '5단계 계층 + orphan/cycle 감지' },
  { key: 'kpi_variance', status: 'supported', note: 'Forecast/Target/Actual 비교(4상태만)' },
  { key: 'kpi_trend', status: 'supported', note: '4분류 + sample_too_small 방어' },
  { key: 'kpi_health', status: 'supported', note: 'Evidence 필수 — Health ≠ Business Quality' },
  { key: 'internal_benchmark', status: 'supported', note: '이전 기간/분기/연도 비교' },
  { key: 'external_benchmark', status: 'unsupported', note: '외부 기업 실데이터 없음 — 비교 수행 안 함' },
  { key: 'auto_kpi_creation', status: 'unsupported', note: 'KPI 자동 생성/수정/목표 변경 금지' },
  { key: 'auto_briefing_send', status: 'unsupported', note: 'Briefing 자동 발송 금지' },
];
