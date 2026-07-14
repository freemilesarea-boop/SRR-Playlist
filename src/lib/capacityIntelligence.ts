/**
 * capacityIntelligence — Capacity Intelligence, Demand Forecasting, Cost Governance &
 * Operational Continuity Planning 순수 로직 (Phase AI-OPS-5).
 *
 * Usage(실측) → Baseline → Trend → Deterministic Forecast → Headroom → Saturation →
 * Cost Projection → Continuity → 권고 Evidence 만. Infrastructure Provisioning /
 * Billing 실행 엔진이 아님.
 *
 * 원칙: Limit 모르면 utilization/headroom/exhaustion 계산 안 함(limit_unknown) ·
 *       단가 없으면 cost_unknown · null→0 변환 없음 · 음수 차단 · 단일 Spike 를
 *       성장률로 사용 안 함 · Forecast 는 Actual 과 분리(예측값 표시 필수) ·
 *       Forecast Accuracy 는 실제 Outcome 없이 생성 안 함 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const CAPACITY_SOURCE_VERSION = 'capacity_v1(0508)';

/* ── Capacity Domain(실측 Usage + Limit 확인 기준) ──────────────────────── */
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'observation_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data' | 'limit_unknown' | 'cost_unknown';
export const CAPACITY_DOMAINS: Array<{ domain: string; label: string; status: SupportStatus; note: string }> = [
  { domain: 'playback_events', label: 'Playback Events', status: 'limit_unknown', note: 'usage 실측 가능 · Plan Limit 자동 조회 불가(관리자 입력 전 limit_unknown)' },
  { domain: 'active_stores', label: 'Active Stores', status: 'limit_unknown', note: '일별 distinct business_id 실측 · Limit 미정의' },
  { domain: 'active_players', label: 'Active Players', status: 'limit_unknown', note: '일별 distinct user_id 실측 · 동시 접속 아님' },
  { domain: 'concurrent_players', label: 'Concurrent Players', status: 'unsupported', note: '세션/heartbeat 시계열 없음 — 동시 접속 실측 불가' },
  { domain: 'database_rows', label: 'Database Rows', status: 'limit_unknown', note: 'pg_stat 추정치 실측 · row limit 없음' },
  { domain: 'database_storage', label: 'Database Storage', status: 'limit_unknown', note: 'pg_total_relation_size 실측 · Plan limit 관리자 입력 필요' },
  { domain: 'database_connections', label: 'DB Connections', status: 'provisional', note: 'pg_stat_activity point-in-time 만 — 기간형 아님' },
  { domain: 'storage_audio', label: 'Audio Storage', status: 'limit_unknown', note: 'storage.objects(audio) size 실측 · Plan limit 미조회' },
  { domain: 'storage_images', label: 'Image Storage', status: 'limit_unknown', note: 'storage.objects(covers/brand-assets) 실측' },
  { domain: 'bandwidth', label: 'Bandwidth', status: 'unsupported', note: 'Provider Usage API 미연동' },
  { domain: 'edge_functions', label: 'Edge Functions', status: 'unsupported', note: '호출 수 telemetry 미수집' },
  { domain: 'api_requests', label: 'API Requests', status: 'unsupported', note: 'request 수 telemetry 미수집' },
  { domain: 'background_jobs', label: 'Background Jobs', status: 'unsupported', note: 'job 실행 telemetry 미수집' },
  { domain: 'build_minutes', label: 'Build Minutes', status: 'unsupported', note: 'Vercel usage API 미연동' },
  { domain: 'deployment_count', label: 'Deployments', status: 'unsupported', note: 'Vercel usage API 미연동' },
  { domain: 'notification_volume', label: 'Notifications', status: 'insufficient_data', note: '발송 로그 집계 미연결' },
  { domain: 'email_volume', label: 'Email', status: 'insufficient_data', note: 'Resend 발송 로그 미집계' },
  { domain: 'settlement_volume', label: 'Settlement', status: 'insufficient_data', note: '정산 volume 집계 미연결' },
  { domain: 'audit_volume', label: 'Audit Volume', status: 'limit_unknown', note: '이벤트 행 수 실측' },
];

/* ── Metric 검증 ────────────────────────────────────────────────────────── */
export const CAPACITY_METRIC_CODES = ['daily_playback_events', 'hourly_peak_playback_events', 'active_stores_daily', 'active_players_daily', 'tracks_total', 'playlists_total', 'playlist_tracks_total', 'audit_event_count', 'database_row_estimate', 'database_storage_bytes', 'database_connections', 'audio_storage_bytes', 'image_storage_bytes'] as const;
export const CAPACITY_UNITS = ['count', 'bytes', 'connections', 'events_per_day', 'events_per_hour'] as const;
export interface CapacityMetricLike { metric_code?: unknown; domain?: unknown; unit?: unknown; hard_limit?: unknown; soft_limit?: unknown; usage?: unknown }
export function validateCapacityMetric(m: CapacityMetricLike | null): string[] {
  if (!m) return ['metric 없음'];
  const errors: string[] = [];
  if (!CAPACITY_METRIC_CODES.includes(m.metric_code as (typeof CAPACITY_METRIC_CODES)[number])) errors.push('metric whitelist 위반 — 실측 불가 metric 생성 금지');
  if (!CAPACITY_DOMAINS.some((d) => d.domain === m.domain)) errors.push('domain whitelist 위반');
  if (!CAPACITY_UNITS.includes(m.unit as (typeof CAPACITY_UNITS)[number])) errors.push('unit whitelist 위반');
  for (const k of ['hard_limit', 'soft_limit', 'usage'] as const) {
    const v = m[k];
    if (v !== null && v !== undefined && (!isFiniteNumber(v) || v < 0)) errors.push(`${k} 음수/NaN 금지(null→0 변환 없음)`);
  }
  return errors;
}

/* ── Usage Baseline(지원되는 기간만) ────────────────────────────────────── */
export interface DailyUsagePoint { day: string; value: number }
export function calculateUsageBaseline(series: DailyUsagePoint[]): {
  dailyAverage: number | null; peak: number | null; avg7d: number | null; avg30d: number | null;
  coverageDays: number; status: 'available' | 'partial' | 'insufficient_data';
} {
  const valid = series.filter((p) => isFiniteNumber(p.value) && p.value >= 0);
  if (!valid.length) return { dailyAverage: null, peak: null, avg7d: null, avg30d: null, coverageDays: 0, status: 'insufficient_data' };
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
  const values = valid.map((p) => p.value);
  const last7 = values.slice(-7);
  return {
    dailyAverage: avg(values),
    peak: Math.max(...values),
    avg7d: valid.length >= 7 ? avg(last7) : null,                    // 7일 미만 → 7d baseline 없음
    avg30d: valid.length >= 30 ? avg(values.slice(-30)) : null,      // 30일 미만 → 30d baseline 생성 안 함
    coverageDays: valid.length,
    status: valid.length >= 7 ? 'available' : 'partial',
  };
}

/* ── Demand Trend(단일 Spike 방어) ──────────────────────────────────────── */
export type DemandTrend = 'increasing' | 'stable' | 'decreasing' | 'volatile' | 'insufficient_data';
export function calculateDemandTrend(series: DailyUsagePoint[]): {
  trend: DemandTrend; recentAvg: number | null; previousAvg: number | null; relativeChangePct: number | null;
  volatility: number | null; outliers: number; sampleDays: number;
} {
  const valid = series.filter((p) => isFiniteNumber(p.value) && p.value >= 0).map((p) => p.value);
  const none = { recentAvg: null, previousAvg: null, relativeChangePct: null, volatility: null, outliers: 0, sampleDays: valid.length };
  if (valid.length < 6) return { trend: 'insufficient_data', ...none };
  const half = Math.floor(valid.length / 2);
  const prev = valid.slice(0, half); const recent = valid.slice(-half);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const prevAvg = avg(prev); const recentAvg = avg(recent);
  const mean = avg(valid);
  const std = Math.sqrt(avg(valid.map((v) => (v - mean) ** 2)));
  const volatility = mean > 0 ? Math.round((std / mean) * 1000) / 10 : null; // 변동계수 %
  const outliers = mean > 0 ? valid.filter((v) => Math.abs(v - mean) > 3 * std && std > 0).length : 0;
  const relativeChangePct = prevAvg > 0 ? Math.round(((recentAvg - prevAvg) / prevAvg) * 1000) / 10 : null;
  // 단일 Spike 방어: outlier 제거 후에도 증가가 유지되는지 확인.
  const trimmed = std > 0 ? valid.filter((v) => Math.abs(v - mean) <= 3 * std) : valid;
  const tHalf = Math.floor(trimmed.length / 2);
  const tPrev = tHalf > 0 ? avg(trimmed.slice(0, tHalf)) : prevAvg;
  const tRecent = tHalf > 0 ? avg(trimmed.slice(-tHalf)) : recentAvg;
  const tChange = tPrev > 0 ? ((tRecent - tPrev) / tPrev) * 100 : null;
  let trend: DemandTrend;
  if (volatility !== null && volatility > 80) trend = 'volatile';
  else if (tChange === null) trend = 'insufficient_data';
  else if (tChange > 15) trend = 'increasing';
  else if (tChange < -15) trend = 'decreasing';
  else trend = 'stable';
  return {
    trend, recentAvg: Math.round(recentAvg * 100) / 100, previousAvg: Math.round(prevAvg * 100) / 100,
    relativeChangePct, volatility, outliers, sampleDays: valid.length,
  };
}

/* ── Demand Forecast(Deterministic — 외부 ML 없음) ──────────────────────── */
export type ForecastModel = 'moving_average' | 'linear_trend' | 'seasonal_naive' | 'insufficient_data';
export const FORECAST_HORIZONS = [1, 7, 30] as const; // 90d 는 데이터 축적 전 미지원(Support Matrix 명시)
export interface DemandForecast {
  pointForecast: number | null; lowerBound: number | null; upperBound: number | null;
  confidence: number | null; horizonDays: number; modelType: ForecastModel; trainingDays: number;
  isForecastNotActual: true; limitations: string[];
}
export function forecastDemand(series: DailyUsagePoint[], horizonDays: number): DemandForecast {
  const valid = series.filter((p) => isFiniteNumber(p.value) && p.value >= 0).map((p) => p.value);
  const limitations: string[] = ['예측값 — Actual 아님', 'Deterministic Trend Forecast(외부 ML 없음)'];
  const none = (model: ForecastModel): DemandForecast => ({ pointForecast: null, lowerBound: null, upperBound: null, confidence: null, horizonDays, modelType: model, trainingDays: valid.length, isForecastNotActual: true, limitations });
  if (!FORECAST_HORIZONS.includes(horizonDays as (typeof FORECAST_HORIZONS)[number])) { limitations.push(`horizon ${horizonDays}d 미지원(1/7/30 만)`); return none('insufficient_data'); }
  if (valid.length < 7) { limitations.push('학습 데이터 7일 미만'); return none('insufficient_data'); }
  if (horizonDays === 30 && valid.length < 21) { limitations.push('30d horizon 은 최소 21일 데이터 필요'); return none('insufficient_data'); }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mean = avg(valid);
  const std = Math.sqrt(avg(valid.map((v) => (v - mean) ** 2)));
  const outliers = std > 0 ? valid.filter((v) => Math.abs(v - mean) > 3 * std).length : 0;

  // linear trend(최소제곱) — 기울기 유의미하면 linear, 아니면 moving average.
  const n = valid.length;
  const xMean = (n - 1) / 2;
  let num = 0; let den = 0;
  valid.forEach((v, i) => { num += (i - xMean) * (v - mean); den += (i - xMean) ** 2; });
  const slope = den > 0 ? num / den : 0;
  const usesTrend = Math.abs(slope) * n > std * 0.5 && std > 0;
  const modelType: ForecastModel = usesTrend ? 'linear_trend' : 'moving_average';
  const point = usesTrend ? mean + slope * ((n - 1 + horizonDays) - xMean) : avg(valid.slice(-7));
  const pointForecast = Math.max(0, Math.round(point * 100) / 100);
  const band = Math.max(std, mean * 0.1);

  // Confidence: 데이터 양 기반 시작점 − 장기 Horizon/Outlier/Gap penalty. 예측 횟수와 무관.
  let confidence = clampScore(30 + Math.min(40, valid.length));
  confidence = clampScore(confidence - horizonDays * 1.2);           // Horizon penalty
  confidence = clampScore(confidence - outliers * 5);                // Outlier penalty
  const expectedDays = Math.max(valid.length, series.length);
  if (series.length > valid.length || expectedDays < 14) confidence = clampScore(confidence - 10); // Data gap penalty
  if (outliers > 0) limitations.push(`outlier ${outliers}건 — 신뢰도 감점`);

  return {
    pointForecast,
    lowerBound: Math.max(0, Math.round((point - band) * 100) / 100),
    upperBound: Math.round((point + band) * 100) / 100,
    confidence, horizonDays, modelType, trainingDays: valid.length, isForecastNotActual: true, limitations,
  };
}

/* ── Headroom / Utilization(Limit 없으면 null) ──────────────────────────── */
export function calculateUtilization(usage: number | null, hardLimit: number | null): number | null {
  if (!isFiniteNumber(usage) || !isFiniteNumber(hardLimit) || hardLimit <= 0 || usage < 0) return null;
  return Math.round((usage / hardLimit) * 10000) / 100;
}
export function calculateHeadroom(usage: number | null, softLimit: number | null, hardLimit: number | null): {
  softHeadroom: number | null; hardHeadroom: number | null; utilizationPct: number | null; status: 'ok' | 'limit_unknown' | 'insufficient_data' | 'invalid';
} {
  if (!isFiniteNumber(usage)) return { softHeadroom: null, hardHeadroom: null, utilizationPct: null, status: 'insufficient_data' };
  if (usage < 0) return { softHeadroom: null, hardHeadroom: null, utilizationPct: null, status: 'invalid' };
  if (!isFiniteNumber(hardLimit)) return { softHeadroom: isFiniteNumber(softLimit) ? softLimit - usage : null, hardHeadroom: null, utilizationPct: null, status: 'limit_unknown' };
  if (hardLimit < 0 || (isFiniteNumber(softLimit) && softLimit < 0)) return { softHeadroom: null, hardHeadroom: null, utilizationPct: null, status: 'invalid' };
  return {
    softHeadroom: isFiniteNumber(softLimit) ? softLimit - usage : null,
    hardHeadroom: hardLimit - usage,
    utilizationPct: calculateUtilization(usage, hardLimit),
    status: 'ok',
  };
}

/* ── Time to Exhaustion(Limit + 양의 성장률에서만) ──────────────────────── */
export function estimateTimeToExhaustion(inp: { usage: number | null; hardLimit: number | null; growthPerDay: number | null; confidence: number | null; now: Date }): {
  estimatedDate: string | null; days: number | null; range: [string, string] | null; status: 'estimated' | 'already_exhausted' | 'no_positive_growth' | 'limit_unknown' | 'insufficient_data';
  assumptions: string[]; limitations: string[];
} {
  const base = { estimatedDate: null, days: null, range: null, assumptions: [] as string[], limitations: ['정확한 날짜 단정 아님 — 평균 성장률 가정 추정치'] };
  if (!isFiniteNumber(inp.usage)) return { ...base, status: 'insufficient_data' };
  if (!isFiniteNumber(inp.hardLimit)) return { ...base, status: 'limit_unknown', limitations: ['limit 미확인 — exhaustion date 계산 금지'] };
  if (inp.usage >= inp.hardLimit) return { ...base, status: 'already_exhausted' };
  if (!isFiniteNumber(inp.growthPerDay) || inp.growthPerDay <= 0) return { ...base, status: 'no_positive_growth', limitations: ['성장률 0/음수 — 날짜 생성 안 함'] };
  const days = Math.floor((inp.hardLimit - inp.usage) / inp.growthPerDay);
  const at = (d: number) => new Date(inp.now.getTime() + d * 86400000).toISOString().slice(0, 10);
  return {
    estimatedDate: at(days), days,
    range: [at(Math.floor(days * 0.7)), at(Math.ceil(days * 1.5))],
    status: 'estimated',
    assumptions: [`일 평균 성장 ${inp.growthPerDay}/day 유지 가정`, `confidence ${inp.confidence ?? 'insufficient_data'}`],
    limitations: base.limitations,
  };
}

/* ── Saturation Risk(재정규화 · limit unknown 분리) ─────────────────────── */
export type SaturationRisk = 'low' | 'moderate' | 'high' | 'critical' | 'limit_unknown' | 'insufficient_data';
export interface SaturationComponents {
  utilizationRisk: number | null; forecastUtilizationRisk: number | null; growthRisk: number | null; volatilityRisk: number | null;
  exhaustionProximityRisk: number | null; sloRisk: number | null; incidentRisk: number | null; monitoringRisk: number | null;
}
export function calculateSaturationRisk(c: SaturationComponents, limitKnown: boolean): { risk: SaturationRisk; score: number | null; missing: string[] } {
  if (!limitKnown) return { risk: 'limit_unknown', score: null, missing: [] }; // Limit 추정으로 Saturation 보고 금지
  const weights: Record<keyof SaturationComponents, number> = {
    utilizationRisk: 25, forecastUtilizationRisk: 20, growthRisk: 15, volatilityRisk: 8,
    exhaustionProximityRisk: 15, sloRisk: 7, incidentRisk: 6, monitoringRisk: 4,
  };
  const comps = (Object.keys(weights) as Array<keyof SaturationComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (base.score === null) return { risk: 'insufficient_data', score: null, missing: base.missing };
  const risk: SaturationRisk = base.score >= 75 ? 'critical' : base.score >= 50 ? 'high' : base.score >= 25 ? 'moderate' : 'low';
  return { risk, score: base.score, missing: base.missing };
}

/* ── Cost Model / Estimated Cost(단가 없으면 cost_unknown) ──────────────── */
export interface CostModelLike { cost_code?: unknown; provider?: unknown; unit_price?: unknown; currency?: unknown; included_amount?: unknown; overage_price?: unknown; source?: unknown }
export const COST_PROVIDERS = ['supabase', 'vercel', 'resend', 'payapp', 'kakao', 'storage', 'other'];
export const CURRENCIES = ['KRW', 'USD'];
export function validateCostModel(m: CostModelLike | null): string[] {
  if (!m) return ['cost model 없음'];
  const errors: string[] = [];
  if (!m.cost_code) errors.push('cost_code 필수');
  if (!COST_PROVIDERS.includes(m.provider as string)) errors.push('provider whitelist 위반');
  if (!isFiniteNumber(m.unit_price) || (m.unit_price as number) < 0) errors.push('unit_price 음수/NaN 금지');
  if (!CURRENCIES.includes(m.currency as string)) errors.push('currency whitelist 위반');
  if (!m.source) errors.push('source(청구서/요금표 근거) 필수 — 근거 없는 단가 생성 금지');
  for (const k of ['included_amount', 'overage_price'] as const) {
    if (m[k] !== null && m[k] !== undefined && (!isFiniteNumber(m[k]) || (m[k] as number) < 0)) errors.push(`${k} 음수/NaN 금지`);
  }
  return errors;
}
export function calculateEstimatedCost(inp: { usage: number | null; unitPrice: number | null; includedAmount?: number | null; overagePrice?: number | null }): {
  estimatedCost: number | null; billableUsage: number | null; status: 'estimated' | 'cost_unknown' | 'insufficient_data' | 'invalid';
} {
  if (!isFiniteNumber(inp.unitPrice)) return { estimatedCost: null, billableUsage: null, status: 'cost_unknown' }; // 단가 없으면 계산 안 함
  if (!isFiniteNumber(inp.usage)) return { estimatedCost: null, billableUsage: null, status: 'insufficient_data' };
  if (inp.usage < 0 || inp.unitPrice < 0) return { estimatedCost: null, billableUsage: null, status: 'invalid' };
  const included = isFiniteNumber(inp.includedAmount) ? inp.includedAmount : 0;
  const billable = Math.max(0, inp.usage - included);
  const price = billable > 0 && isFiniteNumber(inp.overagePrice) ? inp.overagePrice : inp.unitPrice;
  return { estimatedCost: Math.round(billable * price * 100) / 100, billableUsage: billable, status: 'estimated' };
}
export function forecastCost(inp: { currentUsage: number | null; forecastUsage: number | null; unitPrice: number | null; includedAmount?: number | null; overagePrice?: number | null; confidence: number | null }): {
  currentCost: number | null; forecastCost: number | null; confidence: number | null; status: 'estimated' | 'cost_unknown' | 'insufficient_data'; isForecastNotActual: true;
} {
  const current = calculateEstimatedCost({ usage: inp.currentUsage, unitPrice: inp.unitPrice, includedAmount: inp.includedAmount, overagePrice: inp.overagePrice });
  const fut = calculateEstimatedCost({ usage: inp.forecastUsage, unitPrice: inp.unitPrice, includedAmount: inp.includedAmount, overagePrice: inp.overagePrice });
  if (current.status === 'cost_unknown') return { currentCost: null, forecastCost: null, confidence: null, status: 'cost_unknown', isForecastNotActual: true };
  if (fut.status !== 'estimated') return { currentCost: current.estimatedCost, forecastCost: null, confidence: null, status: 'insufficient_data', isForecastNotActual: true };
  return { currentCost: current.estimatedCost, forecastCost: fut.estimatedCost, confidence: inp.confidence, status: 'estimated', isForecastNotActual: true };
}

/* ── Unit Economics(분모/비용 없으면 null) ──────────────────────────────── */
export function calculateUnitEconomics(cost: number | null, denominator: number | null): number | null {
  if (!isFiniteNumber(cost) || !isFiniteNumber(denominator) || denominator <= 0 || cost < 0) return null;
  return Math.round((cost / denominator) * 100) / 100;
}

/* ── Cost Anomaly(청구 데이터 없으면 미지원 · Fraud 단정 없음) ──────────── */
export type CostAnomaly = { type: string; severity: 'info' | 'warning' | 'high'; note: string };
export function detectCostAnomaly(snapshots: Array<{ period_end: string; actual_cost: number | null; estimated_cost: number | null; usage_amount: number | null }>): { anomalies: CostAnomaly[]; status: 'available' | 'unsupported' } {
  const actuals = snapshots.filter((s) => isFiniteNumber(s.actual_cost));
  if (actuals.length < 2) return { anomalies: [], status: 'unsupported' }; // 청구 데이터 부족 — 미지원
  const anomalies: CostAnomaly[] = [];
  const sorted = [...actuals].sort((a, b) => a.period_end.localeCompare(b.period_end));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].actual_cost as number; const cur = sorted[i].actual_cost as number;
    if (prev > 0 && cur / prev >= 1.5) anomalies.push({ type: 'sudden_cost_increase', severity: 'high', note: `${sorted[i].period_end.slice(0, 10)} 비용 ${Math.round((cur / prev - 1) * 100)}% 증가` });
    const pu = sorted[i - 1].usage_amount; const cu = sorted[i].usage_amount;
    if (isFiniteNumber(pu) && isFiniteNumber(cu) && pu > 0 && prev > 0 && cu / pu < 1.05 && cur / prev >= 1.3) {
      anomalies.push({ type: 'usage_cost_divergence', severity: 'warning', note: '사용량 대비 비용 급증 — 원인 검토 필요(Fraud 단정 아님)' });
    }
  }
  return { anomalies, status: 'available' };
}

/* ── Capacity Recommendation(실행 명령 없음) ────────────────────────────── */
export type RecommendationType = 'monitor_usage' | 'increase_soft_limit' | 'review_hard_limit' | 'prepare_scale_plan' | 'optimize_storage' | 'optimize_query' | 'archive_cold_data' | 'reduce_polling' | 'review_background_jobs' | 'review_provider_plan' | 'continuity_review' | 'insufficient_data';
export interface CapacityRecommendation {
  type: RecommendationType; reason: string; evidence: Array<{ label: string; value: unknown }>;
  confidence: number | null; risk: string; expectedBenefit: string; costImpact: string; preconditions: string[]; limitations: string[]; noExecution: true;
}
export function buildCapacityRecommendation(inp: { metricCode: string; status: string; utilizationPct: number | null; trend: DemandTrend; exhaustionDays: number | null; limitKnown: boolean; costKnown: boolean }): CapacityRecommendation {
  const base = {
    evidence: [{ label: 'metric', value: inp.metricCode }, { label: 'status', value: inp.status }, { label: 'trend', value: inp.trend }],
    confidence: inp.limitKnown ? 60 : null, costImpact: inp.costKnown ? '단가 기반 산정 가능' : 'cost_unknown',
    preconditions: ['관리자 검토', 'Governance Review'], limitations: ['권고만 — 실행 명령/자동 Scale 없음'], noExecution: true as const,
  };
  if (inp.status === 'insufficient_data') return { ...base, type: 'insufficient_data', reason: '실측 usage 부족', risk: 'unknown', expectedBenefit: '—' };
  if (!inp.limitKnown) return { ...base, type: 'review_hard_limit', reason: 'limit 미확인 — Provider Plan 한도 확인 및 관리자 입력 필요', risk: 'limit_unknown', expectedBenefit: 'utilization/exhaustion 계산 가능' };
  if (inp.status === 'exhausted' || (inp.exhaustionDays !== null && inp.exhaustionDays <= 14)) return { ...base, type: 'prepare_scale_plan', reason: '한도 소진/임박 — Scale 검토 계획 필요(자동 증설 아님)', risk: 'critical', expectedBenefit: '서비스 연속성 확보' };
  if (inp.status === 'saturation_risk') return { ...base, type: 'review_provider_plan', reason: 'critical threshold 초과', risk: 'high', expectedBenefit: '한도 여유 확보' };
  if (inp.metricCode.includes('storage') && inp.status === 'constrained') return { ...base, type: 'optimize_storage', reason: 'storage 사용률 상승', risk: 'moderate', expectedBenefit: '저장 비용/한도 여유' };
  if (inp.trend === 'increasing') return { ...base, type: 'monitor_usage', reason: '증가 추세 — 관측 지속', risk: 'moderate', expectedBenefit: '조기 대응' };
  return { ...base, type: 'monitor_usage', reason: '정상 범위', risk: 'low', expectedBenefit: '—' };
}

/* ── Scaling Plan 검증 ──────────────────────────────────────────────────── */
export const PLAN_TYPES = ['scale_up_review', 'soft_limit_increase', 'storage_optimization', 'query_optimization', 'cold_data_archive', 'provider_plan_review', 'continuity_improvement', 'monitor_only'];
export const PLAN_STATUSES = ['draft', 'pending_review', 'approved_reference', 'rejected', 'cancelled', 'expired'];
export const FORBIDDEN_PLAN_STATUSES = ['executing', 'scaling', 'applied', 'provisioned', 'live'];
export interface ScalingPlanLike { plan_code?: unknown; plan_type?: unknown; trigger_condition?: unknown; evidence?: unknown; idempotency_key?: unknown }
export function validateScalingPlan(p: ScalingPlanLike | null): string[] {
  if (!p) return ['plan 없음'];
  const errors: string[] = [];
  if (!p.plan_code) errors.push('plan_code 필수');
  if (!PLAN_TYPES.includes(p.plan_type as string)) errors.push('plan_type whitelist 위반');
  if (!p.trigger_condition) errors.push('trigger_condition 필수');
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) errors.push('evidence 필수');
  if (!p.idempotency_key) errors.push('idempotency_key 필수');
  return errors;
}

/* ── SPOF Detection ─────────────────────────────────────────────────────── */
export type SpofStatus = 'no_known_spof' | 'potential_spof' | 'confirmed_spof' | 'insufficient_data' | 'unsupported';
export interface DependencyLike {
  criticality: string; fallback_available: boolean | null; monitoring_source: string | null; owner: string | null;
  rto_target: string; rpo_target: string; failure_impact: string | null;
}
export function detectSinglePointOfFailure(dep: DependencyLike | null): { status: SpofStatus; gaps: string[]; note: string } {
  if (!dep) return { status: 'insufficient_data', gaps: [], note: 'dependency 정보 없음' };
  const gaps: string[] = [];
  if (dep.fallback_available === false) gaps.push('fallback 없음');
  if (dep.fallback_available === null) gaps.push('fallback 여부 미확인');
  if (!dep.monitoring_source) gaps.push('monitoring 없음');
  if (!dep.owner) gaps.push('owner 없음');
  if (dep.rto_target === 'not_defined') gaps.push('RTO 미정의');
  if (dep.rpo_target === 'not_defined') gaps.push('RPO 미정의');
  const note = '"no_known_spof" 는 SPOF 부재 보장이 아니라 현재 Evidence 에서 미확인이라는 뜻';
  if (dep.criticality === 'critical' && dep.fallback_available === false) return { status: 'confirmed_spof', gaps, note };
  if (gaps.length >= 2) return { status: 'potential_spof', gaps, note };
  if (dep.fallback_available === null) return { status: 'insufficient_data', gaps, note };
  return { status: 'no_known_spof', gaps, note };
}

/* ── Continuity Readiness ───────────────────────────────────────────────── */
export type ContinuityReadiness = 'ready' | 'partially_ready' | 'weak' | 'critical' | 'insufficient_data';
export interface ContinuityInput {
  dependencyCount: number; confirmedSpofs: number; potentialSpofs: number;
  backupConfigured: boolean | null; restoreTested: boolean | null; failoverAvailable: boolean | null;
  monitoringCoverage: number | null; playbookCount: number; rtoDefinedCount: number; lastValidationAt: string | null;
}
export function evaluateContinuityReadiness(inp: ContinuityInput): { readiness: ContinuityReadiness; reasons: string[] } {
  if (inp.dependencyCount === 0) return { readiness: 'insufficient_data', reasons: ['dependency inventory 없음'] };
  const reasons: string[] = [];
  if (inp.confirmedSpofs > 0) reasons.push(`confirmed SPOF ${inp.confirmedSpofs}건`);
  if (inp.backupConfigured === null) reasons.push('backup 구성 미확인');
  if (inp.restoreTested !== true) reasons.push('restore 검증 없음');
  if (inp.failoverAvailable !== true) reasons.push('failover 없음');
  if (inp.rtoDefinedCount === 0) reasons.push('RTO/RPO 미정의');
  if (inp.playbookCount === 0) reasons.push('incident playbook 없음');
  if (!inp.lastValidationAt) reasons.push('최근 검증 이력 없음');
  if (inp.confirmedSpofs > 0 && inp.failoverAvailable !== true && inp.restoreTested !== true) return { readiness: 'critical', reasons };
  if (reasons.length >= 4) return { readiness: 'weak', reasons };
  if (reasons.length >= 1) return { readiness: 'partially_ready', reasons };
  return { readiness: 'ready', reasons };
}

/* ── Stress / Continuity Scenario(Evidence-only — 실제 부하/장애 없음) ───── */
export type ScenarioResult = 'resilient' | 'tolerable' | 'degraded' | 'critical' | 'unsupported' | 'insufficient_data';
export function evaluateCapacityStressScenario(inp: { scenario: string; multiplier: number; usage: number | null; hardLimit: number | null }): {
  result: ScenarioResult; projectedUsage: number | null; projectedUtilizationPct: number | null; note: string; evidenceOnly: true;
} {
  const note = 'Evidence-only Simulation — 실제 부하 주입 없음';
  if (!isFiniteNumber(inp.usage)) return { result: 'insufficient_data', projectedUsage: null, projectedUtilizationPct: null, note, evidenceOnly: true };
  const projected = Math.round(inp.usage * inp.multiplier * 100) / 100;
  if (!isFiniteNumber(inp.hardLimit) || inp.hardLimit <= 0) return { result: 'unsupported', projectedUsage: projected, projectedUtilizationPct: null, note: `${note} · limit_unknown — 판정 불가`, evidenceOnly: true };
  const util = Math.round((projected / inp.hardLimit) * 10000) / 100;
  const result: ScenarioResult = util >= 100 ? 'critical' : util >= 90 ? 'degraded' : util >= 70 ? 'tolerable' : 'resilient';
  return { result, projectedUsage: projected, projectedUtilizationPct: util, note, evidenceOnly: true };
}
export function evaluateContinuityScenario(inp: { scenario: string; dependency: DependencyLike | null; blastRadius: string }): {
  result: ScenarioResult; affected: string; fallback: string; estimatedRecovery: string; evidenceOnly: true; limitations: string[];
} {
  const limitations = ['실제 장애를 발생시키지 않음 — Evidence-only'];
  if (!inp.dependency) return { result: 'insufficient_data', affected: inp.blastRadius, fallback: '미확인', estimatedRecovery: 'insufficient_data', evidenceOnly: true, limitations };
  const spof = detectSinglePointOfFailure(inp.dependency);
  const fallback = inp.dependency.fallback_available === true ? (inp.dependency as { fallback_description?: string }).fallback_description ?? '있음' : '없음';
  const result: ScenarioResult =
    spof.status === 'confirmed_spof' ? 'critical'
    : spof.status === 'potential_spof' ? 'degraded'
    : inp.dependency.criticality === 'critical' ? 'tolerable'
    : 'resilient';
  const estimatedRecovery = inp.dependency.rto_target !== 'not_defined' ? inp.dependency.rto_target : 'not_defined(RTO 미정의)';
  return { result, affected: inp.blastRadius, fallback, estimatedRecovery, evidenceOnly: true, limitations };
}

/* ── Capacity Package ───────────────────────────────────────────────────── */
export function buildCapacityPackage(inp: {
  metricCode: string; usage: number | null; baseline: ReturnType<typeof calculateUsageBaseline> | null;
  trend: DemandTrend; forecast: DemandForecast | null; headroom: ReturnType<typeof calculateHeadroom> | null;
  saturation: SaturationRisk; cost: string; recommendation: RecommendationType; limitations: string[];
}): Array<{ section: string; content: unknown }> {
  return [
    { section: 'Metric', content: inp.metricCode },
    { section: 'Current Usage (실측)', content: inp.usage ?? 'insufficient_data' },
    { section: 'Baseline', content: inp.baseline ?? 'insufficient_data' },
    { section: 'Demand Trend', content: inp.trend },
    { section: 'Forecast', content: inp.forecast ? { ...inp.forecast, note: '예측값 — Actual 아님' } : 'insufficient_data' },
    { section: 'Headroom', content: inp.headroom ?? 'limit_unknown' },
    { section: 'Saturation Risk', content: inp.saturation },
    { section: 'Cost', content: inp.cost },
    { section: 'Recommendation', content: `${inp.recommendation} (권고 — 실행 아님)` },
    { section: 'Limitations', content: inp.limitations },
  ];
}

/* ── UI 톤 ──────────────────────────────────────────────────────────────── */
export const CAP_STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  healthy: 'success', watch: 'info', constrained: 'warning', saturation_risk: 'danger', exhausted: 'danger',
  limit_unknown: 'neutral', insufficient_data: 'neutral', unsupported: 'neutral', invalid: 'danger',
};
export const READINESS_TONE: Record<ContinuityReadiness, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  ready: 'success', partially_ready: 'info', weak: 'warning', critical: 'danger', insufficient_data: 'neutral',
};
export const SCENARIO_TONE: Record<ScenarioResult, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  resilient: 'success', tolerable: 'info', degraded: 'warning', critical: 'danger', unsupported: 'neutral', insufficient_data: 'neutral',
};

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export const CAP_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'playback_event_capacity', label: 'Playback Event Capacity', status: 'limit_unknown', note: 'usage 실측 · limit 관리자 입력 전' },
  { key: 'active_store_capacity', label: 'Active Store Capacity', status: 'limit_unknown', note: 'usage 실측 · limit 미정의' },
  { key: 'active_player_capacity', label: 'Active Player Capacity', status: 'limit_unknown', note: '일별 distinct 실측' },
  { key: 'concurrent_player_capacity', label: 'Concurrent Player Capacity', status: 'unsupported', note: '세션 telemetry 없음' },
  { key: 'database_row_capacity', label: 'Database Row Capacity', status: 'limit_unknown', note: 'pg_stat 추정 실측' },
  { key: 'database_storage_capacity', label: 'Database Storage Capacity', status: 'limit_unknown', note: 'pg_total_relation_size 실측' },
  { key: 'database_connection_capacity', label: 'DB Connection Capacity', status: 'provisional', note: 'point-in-time 실측만' },
  { key: 'audio_storage_capacity', label: 'Audio Storage Capacity', status: 'limit_unknown', note: 'storage.objects 실측' },
  { key: 'image_storage_capacity', label: 'Image Storage Capacity', status: 'limit_unknown', note: 'storage.objects 실측' },
  { key: 'bandwidth_capacity', label: 'Bandwidth Capacity', status: 'unsupported', note: 'Provider API 미연동' },
  { key: 'edge_function_capacity', label: 'Edge Function Capacity', status: 'unsupported', note: '호출 telemetry 없음' },
  { key: 'api_capacity', label: 'API Capacity', status: 'unsupported', note: 'request telemetry 없음' },
  { key: 'build_capacity', label: 'Build Capacity', status: 'unsupported', note: 'Vercel usage API 미연동' },
  { key: 'deployment_capacity', label: 'Deployment Capacity', status: 'unsupported', note: 'Vercel usage API 미연동' },
  { key: 'usage_baseline', label: 'Usage Baseline', status: 'partially_supported', note: '7일 미만 시 30d baseline 생성 안 함' },
  { key: 'demand_trend', label: 'Demand Trend', status: 'fully_supported', note: '단일 Spike 방어(outlier trim)' },
  { key: 'demand_forecast', label: 'Demand Forecast', status: 'partially_supported', note: 'deterministic 1/7/30d — 90d 는 데이터 축적 전 미지원' },
  { key: 'capacity_headroom', label: 'Capacity Headroom', status: 'partially_supported', note: 'limit 입력된 metric 한정' },
  { key: 'saturation_risk', label: 'Saturation Risk', status: 'partially_supported', note: 'limit_unknown 이면 판정 안 함' },
  { key: 'time_to_exhaustion', label: 'Time to Exhaustion', status: 'partially_supported', note: 'limit+양의 성장률에서만' },
  { key: 'capacity_budget', label: 'Capacity Budget', status: 'evidence_only', note: '관리 기준 문서 — 실행 권한 아님' },
  { key: 'cost_model', label: 'Cost Model', status: 'cost_unknown', note: '관리자 단가 입력 전 — 청구서 연동 없음' },
  { key: 'cost_actual', label: 'Cost Actual', status: 'cost_unknown', note: '청구 기록 수동 입력만' },
  { key: 'cost_forecast', label: 'Cost Forecast', status: 'cost_unknown', note: '단가 입력 후 estimated 만' },
  { key: 'unit_economics', label: 'Unit Economics', status: 'cost_unknown', note: '비용+분모 존재 시에만' },
  { key: 'cost_anomaly', label: 'Cost Anomaly', status: 'unsupported', note: '청구 데이터 2건 미만 — 미지원' },
  { key: 'scaling_plan', label: 'Scaling Plan', status: 'evidence_only', note: '계획 문서만 — 실행 상태 없음' },
  { key: 'dependency_inventory', label: 'Dependency Inventory', status: 'partially_supported', note: '코드 확인 7종 seed(draft) — 관리자 확정 필요' },
  { key: 'spof_detection', label: 'SPOF Detection', status: 'partially_supported', note: 'Evidence 기반 — 부재 보장 아님' },
  { key: 'rto_rpo', label: 'RTO / RPO', status: 'insufficient_data', note: '승인된 목표 없음 — not_defined' },
  { key: 'continuity_readiness', label: 'Continuity Readiness', status: 'partially_supported', note: 'restore 검증/failover 미확인' },
  { key: 'capacity_stress_scenario', label: 'Capacity Stress Scenario', status: 'evidence_only', note: '실제 부하 주입 없음' },
  { key: 'continuity_scenario', label: 'Continuity Scenario', status: 'evidence_only', note: '실제 장애 발생 없음' },
  { key: 'automatic_scaling', label: 'Automatic Scaling', status: 'unsupported', note: '금지' },
  { key: 'automatic_backup', label: 'Automatic Backup', status: 'unsupported', note: '금지 — 실행 없음' },
  { key: 'infrastructure_apply', label: 'Infrastructure Apply', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];
