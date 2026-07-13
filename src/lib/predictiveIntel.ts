/**
 * predictiveIntel — Predictive Music Intelligence & AI Simulation 순수 로직 (Phase AI-MUSIC-4).
 *
 * 과거·현재 분석을 넘어 **미래 KPI 예측 + 변경 전 시뮬레이션**을 계산한다. 예측/시뮬레이션 전용 —
 * 실제 Playlist/Scheduler/Queue/Playback/Recommendation/Weight 변경 없음.
 *
 * 구성: Forecast(회귀) · Playlist/Track/Genre/Mood Simulation · Recommendation Impact ·
 *  Counterfactual · Forecast Trend · Risk Prediction · Opportunity Detection · Prediction Confidence.
 *
 * 원칙:
 *  - 기존 Context KPI/Learning 정의 재사용(변경 금지). 여기서는 예측/시뮬레이션만.
 *  - Sample 부족이면 Prediction/Simulation/Forecast/Risk 생성 금지(insufficient 표기).
 *  - 모든 점수/예측 0~100 clamp(완주율·Skip·Health·Confidence·Risk) · NaN/Infinity 금지.
 *  - 모든 Prediction 에 Evidence 포함(Explainable). 예측은 추정이며 보장 아님(Confidence 동반).
 */
import { clampPct, MIN_EVENTS } from './playlistIntel';
import { computeContextHealth, computeContextScore, type ContextSummary, type GenreMoodRow } from './contextIntel';
import { sampleConfidence } from './contextIntel';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const round1 = (n: number) => Math.round(n * 10) / 10;

export type Horizon = 7 | 30 | 90;
export const HORIZONS: Horizon[] = [7, 30, 90];
export const MIN_FORECAST_POINTS = 3;

export interface EvidenceItem { label: string; value: string | number | null }

/* ── 11) Prediction Confidence ──────────────────────────────────────────────
 * Sample Size · Stability · Drift · Data Freshness · Prediction Horizon 결합(0~100).
 * 표본 많고/안정/Drift 낮고/최신/짧은 horizon 일수록 높다. AI 자신감 아님(데이터 충족도).
 * ------------------------------------------------------------------------- */
export interface ConfidenceInput { sample: number; stabilityFactor?: number | null; driftScore?: number | null; freshnessDays?: number | null; horizonDays?: number }
export function predictionConfidence(inp: ConfidenceInput): number {
  const sampleF = clamp01((isNum(inp.sample) ? inp.sample : 0) / 200);
  const stabilityF = isNum(inp.stabilityFactor) ? clamp01(inp.stabilityFactor) : 0.6;
  const driftF = isNum(inp.driftScore) ? clamp01(1 - inp.driftScore / 100) : 0.7;
  const freshF = isNum(inp.freshnessDays) ? clamp01(1 - inp.freshnessDays / 30) : 0.7;
  const horizonF = clamp01(1 - ((inp.horizonDays ?? 7) - 7) / 120); // 7d→1, 90d 이상 하향
  const score = sampleF * 0.35 + stabilityF * 0.2 + driftF * 0.15 + freshF * 0.15 + horizonF * 0.15;
  return clamp100(score * 100);
}

/* ── 1/2) Forecast(선형 회귀) ───────────────────────────────────────────────
 * 버킷 시계열의 metric 에 최소제곱 회귀 → horizon(일) 시점 예측. 포인트<3 이면 insufficient.
 * ------------------------------------------------------------------------- */
export interface SeriesPoint { bucket_start: string; events: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null }
export type ForecastMetric = 'completion_rate' | 'skip_rate' | 'avg_listen_seconds';
export interface ForecastResult { predicted: number | null; slopePerDay: number | null; current: number | null; points: number; horizonDays: number; insufficient: boolean }

/** x=버킷 순번(등간격 가정), y=metric. 회귀 후 (마지막+horizon/step) 예측. metric 별 clamp. */
export function forecastKpi(series: SeriesPoint[], metric: ForecastMetric, horizonDays: Horizon): ForecastResult {
  const pts = series
    .map((p, i) => ({ i, y: p[metric] }))
    .filter((p): p is { i: number; y: number } => isNum(p.y));
  if (pts.length < MIN_FORECAST_POINTS) {
    return { predicted: null, slopePerDay: null, current: pts.length ? pts[pts.length - 1].y : null, points: pts.length, horizonDays, insufficient: true };
  }
  const n = pts.length;
  const meanX = pts.reduce((a, p) => a + p.i, 0) / n;
  const meanY = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0; let den = 0;
  for (const p of pts) { num += (p.i - meanX) * (p.y - meanY); den += (p.i - meanX) ** 2; }
  const slopePerStep = den === 0 ? 0 : num / den;
  // step(일) 추정: 균등 버킷 → (기간/포인트). 알 수 없으면 7일 가정.
  const stepDays = estimateStepDays(series);
  const lastIdx = pts[pts.length - 1].i;
  const stepsAhead = horizonDays / stepDays;
  const rawPred = meanY + slopePerStep * (lastIdx + stepsAhead - meanX);
  const isPct = metric !== 'avg_listen_seconds';
  const predicted = isPct ? clamp100(rawPred) : Math.max(0, round1(rawPred));
  return {
    predicted, slopePerDay: round1(slopePerStep / stepDays), current: round1(pts[pts.length - 1].y),
    points: n, horizonDays, insufficient: false,
  };
}

function estimateStepDays(series: SeriesPoint[]): number {
  const times = series.map((p) => Date.parse(p.bucket_start)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return 7;
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) diffs.push((times[i] - times[i - 1]) / 86400000);
  const med = diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  return med > 0 ? med : 7;
}

export interface ContextForecast {
  horizon: Horizon; completion: number | null; skip: number | null; listen: number | null;
  health: number | null; confidence: number; insufficient: boolean;
}
/** Context 시계열로 7/30/90d 예측 + 예측 KPI 로 Health 재계산 + Confidence. */
export function forecastContext(series: SeriesPoint[], base: ContextSummary, conf: Omit<ConfidenceInput, 'horizonDays'>): ContextForecast[] {
  return HORIZONS.map((h) => {
    const comp = forecastKpi(series, 'completion_rate', h);
    const skip = forecastKpi(series, 'skip_rate', h);
    const listen = forecastKpi(series, 'avg_listen_seconds', h);
    const insufficient = comp.insufficient && skip.insufficient;
    let health: number | null = null;
    if (!insufficient) {
      const projected: ContextSummary = { ...base, completion_rate: comp.predicted ?? base.completion_rate, skip_rate: skip.predicted ?? base.skip_rate, avg_listen_seconds: listen.predicted ?? base.avg_listen_seconds };
      health = computeContextHealth(projected).score;
    }
    return { horizon: h, completion: comp.predicted, skip: skip.predicted, listen: listen.predicted, health, confidence: predictionConfidence({ ...conf, horizonDays: h }), insufficient };
  });
}

/* ── 8) Forecast Trend 상태 ─────────────────────────────────────────────── */
export type ForecastStatus = 'improving' | 'stable' | 'declining' | 'insufficient_data';
/** metric slope 방향/크기로 상태. skip 은 상승이 나쁨(방향 반전). 임계 ±0.2/일. */
export function classifyForecast(f: ForecastResult, metric: ForecastMetric): ForecastStatus {
  if (f.insufficient || f.slopePerDay == null) return 'insufficient_data';
  const higherBetter = metric !== 'skip_rate';
  const s = f.slopePerDay;
  if (Math.abs(s) < 0.2) return 'stable';
  const good = higherBetter ? s > 0 : s < 0;
  return good ? 'improving' : 'declining';
}

/* ── 2/3) Playlist / Track Impact Simulation ────────────────────────────────
 * 현재 Context KPI 를 항목(Playlist/Track)의 KPI 와 이벤트 비중으로 가중 혼합하여 예상 KPI 산출.
 * add: 비중만큼 편입 / remove: 비중 제거(잔여 재정규화) / swap: remove(out)+add(in).
 * ------------------------------------------------------------------------- */
export interface ItemKpi { key: string; label: string; events: number; completion_rate: number | null; skip_rate: number | null }
export type SimAction = 'add' | 'remove' | 'swap';
export interface SimResult {
  before: { completion: number | null; skip: number | null };
  after: { completion: number | null; skip: number | null };
  delta: { completion: number | null; skip: number | null };
  evidence: EvidenceItem[]; insufficient: boolean;
}

function blendRemove(ctxVal: number, ctxEvents: number, itemVal: number, itemEvents: number): number {
  const rest = ctxEvents - itemEvents;
  if (rest <= 0) return ctxVal;
  // ctx = (rest*restVal + itemEvents*itemVal)/ctxEvents → restVal
  return clamp100((ctxVal * ctxEvents - itemVal * itemEvents) / rest);
}
function blendAdd(ctxVal: number, ctxEvents: number, itemVal: number, itemEvents: number): number {
  const tot = ctxEvents + itemEvents;
  if (tot <= 0) return ctxVal;
  return clamp100((ctxVal * ctxEvents + itemVal * itemEvents) / tot);
}

/** Playlist/Track 공통 Impact 시뮬레이션(가중 혼합). Sample 부족 시 insufficient. */
export function simulateItemChange(ctx: ContextSummary, action: SimAction, item: ItemKpi, itemIn?: ItemKpi): SimResult {
  const bc = clampPct(ctx.completion_rate); const bs = clampPct(ctx.skip_rate);
  const ev: EvidenceItem[] = [
    { label: 'Action', value: action }, { label: '대상', value: item.label }, { label: '대상 표본', value: item.events },
    { label: 'Context 표본', value: ctx.events }, { label: 'Context 완주율', value: bc }, { label: 'Context Skip', value: bs },
  ];
  if (ctx.events < MIN_EVENTS || item.events <= 0 || bc == null || bs == null) {
    return { before: { completion: bc, skip: bs }, after: { completion: null, skip: null }, delta: { completion: null, skip: null }, evidence: ev, insufficient: true };
  }
  const ic = clampPct(item.completion_rate) ?? bc; const is = clampPct(item.skip_rate) ?? bs;
  let ac = bc; let as_ = bs;
  if (action === 'add') { ac = blendAdd(bc, ctx.events, ic, item.events); as_ = blendAdd(bs, ctx.events, is, item.events); }
  else if (action === 'remove') { ac = blendRemove(bc, ctx.events, ic, item.events); as_ = blendRemove(bs, ctx.events, is, item.events); }
  else if (action === 'swap' && itemIn) {
    const rc = blendRemove(bc, ctx.events, ic, item.events); const rs = blendRemove(bs, ctx.events, is, item.events);
    const restEvents = Math.max(1, ctx.events - item.events);
    const inc = clampPct(itemIn.completion_rate) ?? rc; const ins = clampPct(itemIn.skip_rate) ?? rs;
    ac = blendAdd(rc, restEvents, inc, itemIn.events); as_ = blendAdd(rs, restEvents, ins, itemIn.events);
    ev.push({ label: '교체 투입', value: itemIn.label });
  }
  return {
    before: { completion: bc, skip: bs }, after: { completion: clamp100(ac), skip: clamp100(as_) },
    delta: { completion: round1(clamp100(ac) - bc), skip: round1(clamp100(as_) - bs) },
    evidence: ev, insufficient: false,
  };
}

/* ── 4/5) Genre / Mood Mix Simulation ───────────────────────────────────────
 * 대상 비율(mix)로 각 그룹 KPI 를 가중하여 예상 Completion/Skip 산출 + Diversity/Health.
 * ------------------------------------------------------------------------- */
export interface MixTarget { key: string; share: number } // share 0~1 (합≈1)
export interface MixResult {
  before: { completion: number | null; skip: number | null; diversity: number };
  after: { completion: number; skip: number; diversity: number; health: number };
  delta: { completion: number; skip: number; diversity: number };
  evidence: EvidenceItem[]; insufficient: boolean;
}

function mixDiversity(mix: MixTarget[]): number {
  const shares = mix.map((m) => clamp01(m.share)).filter((s) => s > 0);
  const tot = shares.reduce((a, b) => a + b, 0);
  if (tot <= 0 || shares.length <= 1) return shares.length <= 1 ? 0 : 0;
  // 정규화 엔트로피(0~1) → 0~100
  const norm = shares.map((s) => s / tot);
  const ent = -norm.reduce((a, s) => a + (s > 0 ? s * Math.log(s) : 0), 0);
  return clamp100((ent / Math.log(norm.length)) * 100);
}

/** groups(그룹별 KPI) + 목표 mix(비율) → 예상 KPI. base 는 Context 요약(Health 재계산용). */
export function simulateMix(base: ContextSummary, groups: GenreMoodRow[], mix: MixTarget[]): MixResult {
  const bc = clampPct(base.completion_rate); const bs = clampPct(base.skip_rate);
  const known = groups.filter((g) => !g.is_unknown);
  const kpiOf = new Map(known.map((g) => [g.key, { c: clampPct(g.completion_rate), s: clampPct(g.skip_rate), events: g.events }]));
  const curDiversity = mixDiversity(known.map((g) => ({ key: g.key, share: g.events })));
  const ev: EvidenceItem[] = [
    { label: 'Context 표본', value: base.events }, { label: 'Context 완주율', value: bc }, { label: 'Context Skip', value: bs },
    { label: '대상 그룹수', value: mix.length },
  ];
  const usable = mix.filter((m) => kpiOf.has(m.key) && isNum(kpiOf.get(m.key)!.c) && kpiOf.get(m.key)!.events >= 5);
  if (base.events < MIN_EVENTS || usable.length === 0 || bc == null || bs == null) {
    return { before: { completion: bc, skip: bs, diversity: curDiversity }, after: { completion: 0, skip: 0, diversity: 0, health: 0 }, delta: { completion: 0, skip: 0, diversity: 0 }, evidence: ev, insufficient: true };
  }
  const totShare = usable.reduce((a, m) => a + clamp01(m.share), 0) || 1;
  let ac = 0; let as_ = 0;
  for (const m of usable) { const k = kpiOf.get(m.key)!; const w = clamp01(m.share) / totShare; ac += (k.c ?? bc) * w; as_ += (k.s ?? bs) * w; }
  const afterDiv = mixDiversity(usable);
  const projected: ContextSummary = { ...base, completion_rate: clamp100(ac), skip_rate: clamp100(as_) };
  const health = computeContextHealth(projected).score;
  return {
    before: { completion: bc, skip: bs, diversity: curDiversity },
    after: { completion: clamp100(ac), skip: clamp100(as_), diversity: afterDiv, health },
    delta: { completion: round1(clamp100(ac) - bc), skip: round1(clamp100(as_) - bs), diversity: round1(afterDiv - curDiversity) },
    evidence: ev, insufficient: false,
  };
}

/* ── 6) Recommendation Impact ───────────────────────────────────────────────
 * 추천을 적용한다고 가정한 예상 개선(보수적·상한 clamp). 실제 개선 보장 아님(Confidence 동반).
 * ------------------------------------------------------------------------- */
export interface RecoImpact { completion: number; skip: number; listen: number; health: number; confidence: number; evidence: EvidenceItem[]; insufficient: boolean }
const RECO_UPLIFT: Record<string, { comp: number; skip: number }> = {
  top_track_expand: { comp: 0.4, skip: -0.3 }, low_track_reduce: { comp: 0.3, skip: -0.5 },
  top_playlist: { comp: 0.35, skip: -0.25 }, playlist_experiment: { comp: 0.2, skip: -0.2 },
  genre_ratio: { comp: 0.25, skip: -0.2 }, mood_ratio: { comp: 0.2, skip: -0.15 },
  rediscovery: { comp: 0.15, skip: -0.1 }, collect_sample: { comp: 0, skip: 0 },
};
/** 추천 type 별 계수 × 현재 KPI headroom → 예상 개선. headroom 없으면 개선폭 축소(추측 금지). */
export function predictRecoImpact(recoType: string, base: ContextSummary, confidence: number): RecoImpact {
  const bc = clampPct(base.completion_rate); const bs = clampPct(base.skip_rate);
  const ev: EvidenceItem[] = [{ label: '추천', value: recoType }, { label: 'Context 완주율', value: bc }, { label: 'Context Skip', value: bs }, { label: 'Context 표본', value: base.events }];
  if (base.events < MIN_EVENTS || bc == null || bs == null) {
    return { completion: 0, skip: 0, listen: 0, health: 0, confidence: 0, evidence: ev, insufficient: true };
  }
  const k = RECO_UPLIFT[recoType] ?? { comp: 0.15, skip: -0.1 };
  const compHead = 100 - bc; const skipHead = bs;
  const dComp = round1(clamp01(k.comp) * compHead * (confidence / 100));
  const dSkip = round1(-clamp01(-k.skip) * skipHead * (confidence / 100));
  const projected: ContextSummary = { ...base, completion_rate: clamp100(bc + dComp), skip_rate: clamp100(bs + dSkip) };
  const health = computeContextHealth(projected).score;
  const curHealth = computeContextHealth(base).score;
  return { completion: dComp, skip: dSkip, listen: 0, health: round1(health - curHealth), confidence, evidence: ev, insufficient: false };
}

/* ── 7) Counterfactual Analysis(승자 단정 없음) ─────────────────────────── */
export interface CfSide { label: string; completion: number | null; skip: number | null; diversity?: number | null; health?: number | null }
export interface CfRow { kpi: string; a: number | null; b: number | null; delta: number | null; note: string }
export function counterfactual(a: CfSide, b: CfSide): { rows: CfRow[] } {
  const mk = (kpi: string, av: number | null, bv: number | null, higherBetter: boolean): CfRow => {
    const delta = isNum(av) && isNum(bv) ? round1(bv - av) : null;
    let note = '동등/판정 불가';
    if (isNum(delta) && Math.abs(delta) >= 0.5) {
      const bBetter = higherBetter ? delta > 0 : delta < 0;
      note = bBetter ? `${b.label} 우세` : `${a.label} 우세`;
    }
    return { kpi, a: av, b: bv, delta, note };
  };
  return { rows: [
    mk('완주율', a.completion, b.completion, true),
    mk('Skip율', a.skip, b.skip, false),
    ...(isNum(a.diversity) || isNum(b.diversity) ? [mk('Diversity', a.diversity ?? null, b.diversity ?? null, true)] : []),
    ...(isNum(a.health) || isNum(b.health) ? [mk('Health', a.health ?? null, b.health ?? null, true)] : []),
  ] };
}

/* ── 9) Risk Prediction ─────────────────────────────────────────────────── */
export interface RiskInput { completionSlopePerDay: number | null; skipSlopePerDay: number | null; diversitySlopePerDay?: number | null; driftScore?: number | null; sample: number }
export interface RiskResult { overall: number; risks: Array<{ key: string; label: string; score: number }>; insufficient: boolean; evidence: EvidenceItem[] }
/** 하락/증가 기울기 + Drift → 위험 0~100(높을수록 위험). Sample 부족 시 insufficient. */
export function predictRisk(inp: RiskInput): RiskResult {
  const ev: EvidenceItem[] = [
    { label: '완주율 기울기/일', value: inp.completionSlopePerDay }, { label: 'Skip 기울기/일', value: inp.skipSlopePerDay },
    { label: 'Drift', value: inp.driftScore ?? null }, { label: '표본', value: inp.sample },
  ];
  if (inp.sample < MIN_EVENTS || (!isNum(inp.completionSlopePerDay) && !isNum(inp.skipSlopePerDay))) {
    return { overall: 0, risks: [], insufficient: true, evidence: ev };
  }
  const compRisk = clamp100((isNum(inp.completionSlopePerDay) && inp.completionSlopePerDay < 0 ? -inp.completionSlopePerDay : 0) * 50);
  const skipRisk = clamp100((isNum(inp.skipSlopePerDay) && inp.skipSlopePerDay > 0 ? inp.skipSlopePerDay : 0) * 50);
  const divRisk = clamp100((isNum(inp.diversitySlopePerDay) && inp.diversitySlopePerDay < 0 ? -inp.diversitySlopePerDay : 0) * 30);
  const driftRisk = clamp100(isNum(inp.driftScore) ? inp.driftScore : 0);
  const risks = [
    { key: 'completion', label: '완주율 하락', score: compRisk },
    { key: 'skip', label: 'Skip 증가', score: skipRisk },
    { key: 'diversity', label: 'Diversity 감소', score: divRisk },
    { key: 'drift', label: 'Drift', score: driftRisk },
  ];
  const overall = clamp100(risks.reduce((a, r) => a + r.score, 0) / risks.length);
  return { overall, risks: risks.sort((a, b) => b.score - a.score), insufficient: false, evidence: ev };
}

/* ── 10) Opportunity Detection ──────────────────────────────────────────── */
export interface ScanRow {
  store_type: string; events: number; completion_rate: number | null; skip_rate: number | null; avg_listen_seconds: number | null;
  track_count: number; playlist_count: number;
  prior_events: number; prior_completion: number | null; prior_skip: number | null;
  recent_events: number; recent_completion: number | null; recent_skip: number | null;
}
export interface Opportunity { store_type: string; expectedImprovement: number; basis: string; confidence: number; events: number; evidence: EvidenceItem[] }
/**
 * 개선 잠재력이 큰 Context 탐지: 최근 상승 추세 + 완주율 headroom + 충분 표본. 예상 개선폭 산출.
 * 표본 부족/데이터 결측 Context 는 제외(추측 금지).
 */
export function detectOpportunities(rows: ScanRow[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const r of rows) {
    if (r.events < MIN_EVENTS || r.recent_events < MIN_EVENTS || r.prior_events < MIN_EVENTS) continue;
    const rc = clampPct(r.recent_completion); const pc = clampPct(r.prior_completion);
    if (rc == null || pc == null) continue;
    const slope = rc - pc; // 최근 상승폭
    const headroom = 100 - rc;
    // 상승 추세 + headroom 이 큰 곳 = 기회. 예상 개선 = 상승분과 headroom 의 보수적 결합.
    const expected = round1(clamp100(Math.max(0, slope) * 0.5 + headroom * 0.1));
    if (expected <= 1) continue;
    const confidence = predictionConfidence({ sample: r.recent_events, horizonDays: 30 });
    out.push({
      store_type: r.store_type, expectedImprovement: expected,
      basis: `최근 완주율 ${pc}→${rc}(${slope >= 0 ? '+' : ''}${round1(slope)}) · headroom ${round1(headroom)}`,
      confidence, events: r.events,
      evidence: [
        { label: 'Context', value: `store_type=${r.store_type}` }, { label: '이전 완주율', value: pc }, { label: '최근 완주율', value: rc },
        { label: 'headroom', value: round1(headroom) }, { label: '표본(recent)', value: r.recent_events }, { label: 'Confidence', value: confidence },
      ],
    });
  }
  return out.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
}

/** ScanRow → 완주율/Skip 일별 기울기(두 기간 중심 간격 = half). Risk/Forecast 방향용. */
export function scanSlopes(r: ScanRow, halfDays: number): { completionSlopePerDay: number | null; skipSlopePerDay: number | null } {
  const rc = clampPct(r.recent_completion); const pc = clampPct(r.prior_completion);
  const rs = clampPct(r.recent_skip); const ps = clampPct(r.prior_skip);
  const span = Math.max(1, halfDays);
  return {
    completionSlopePerDay: rc != null && pc != null ? round1((rc - pc) / span) : null,
    skipSlopePerDay: rs != null && ps != null ? round1((rs - ps) / span) : null,
  };
}

/* ── 공통 게이트 / 헬퍼 ─────────────────────────────────────────────────── */
export function predictionAllowed(sample: number): boolean { return isNum(sample) && sample >= MIN_EVENTS; }
export function sampleConf(sample: number): number { return sampleConfidence(isNum(sample) ? sample : 0); }
export { computeContextScore }; // 재노출(스냅샷 저장 편의)

export const FORECAST_STATUS_LABEL: Record<ForecastStatus, string> = { improving: '개선', stable: '유지', declining: '하락', insufficient_data: '데이터 부족' };
export const FORECAST_STATUS_TONE: Record<ForecastStatus, 'success' | 'neutral' | 'danger' | 'warning'> = { improving: 'success', stable: 'neutral', declining: 'danger', insufficient_data: 'warning' };
export function riskTone(score: number): 'success' | 'warning' | 'danger' { return score >= 60 ? 'danger' : score >= 30 ? 'warning' : 'success'; }
export function deltaTone(delta: number | null, higherBetter = true): 'success' | 'danger' | 'neutral' {
  if (!isNum(delta) || Math.abs(delta) < 0.5) return 'neutral';
  return (higherBetter ? delta > 0 : delta < 0) ? 'success' : 'danger';
}
