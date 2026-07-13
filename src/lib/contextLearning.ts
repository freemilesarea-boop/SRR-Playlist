/**
 * contextLearning — Context Evolution & Adaptive Learning 순수 로직 (Phase AI-MUSIC-3).
 *
 * Context Intelligence(0490)가 "현재"를 분석했다면, 이 레이어는 **시간에 따른 진화**와
 * **Recommendation 품질 향상(Learning)**을 다룬다:
 *  Drift · Stability · Decay · Similar Context · Smart Fallback · Recommendation Outcome ·
 *  Confidence Calibration · Context Memory · Learning Timeline.
 *
 * 원칙:
 *  - 기존 Context Intelligence KPI/점수 정의 재사용(변경 금지). 여기서는 진화/학습만 계산.
 *  - Sample 부족이면 Drift/Success/Learning 생성 금지(insufficient 표기).
 *  - Drift/Stability/Confidence/Calibration 0~100 clamp · NaN/Infinity 금지.
 *  - Decay Curve 는 설정 가능(하드코딩 금지). Fallback 이유는 Evidence 로 반환.
 *  - Recommendation Confidence = "추천 신뢰도"(성공률 기반)이며 AI 자신감이 아님.
 */
import { MIN_EVENTS } from './playlistIntel';
import { sampleConfidence } from './contextIntel';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/* ── 1) Context Drift Detection ─────────────────────────────────────────── */
export interface GenreShare { key: string; share: number | null; events?: number }
export interface DriftWindow { events: number; completion_rate: number | null; skip_rate: number | null; genres: GenreShare[] }
export type DriftStatus = 'stable' | 'changing' | 'drifting' | 'insufficient_data';
export interface DriftShift { key: string; prior: number; recent: number; delta: number }
export interface DriftResult {
  score: number | null; status: DriftStatus; genreDistance: number | null;
  completionDelta: number | null; skipDelta: number | null; topShifts: DriftShift[];
  priorEvents: number; recentEvents: number;
}
export const MIN_DRIFT_SAMPLE = MIN_EVENTS; // 두 기간 각각 최소 표본
export const DRIFT_THRESHOLDS = { stable: 15, changing: 35 } as const;

/** 장르 분포 배열 → {key: share(0~1)} 맵(합 1 정규화, share 누락/합 0 방어). */
function shareMap(genres: GenreShare[]): Record<string, number> {
  const raw: Record<string, number> = {};
  let total = 0;
  for (const g of genres) {
    const s = isNum(g.share) ? Math.max(0, g.share) : 0;
    raw[g.key] = (raw[g.key] ?? 0) + s; total += s;
  }
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw)) out[k] = raw[k] / total;
  return out;
}

/** 두 기간의 분포/ KPI 로 Drift Score(0~100)와 상태 산출. 표본 부족이면 insufficient. */
export function computeDrift(prior: DriftWindow, recent: DriftWindow): DriftResult {
  const base: DriftResult = {
    score: null, status: 'insufficient_data', genreDistance: null,
    completionDelta: null, skipDelta: null, topShifts: [], priorEvents: prior.events, recentEvents: recent.events,
  };
  if (prior.events < MIN_DRIFT_SAMPLE || recent.events < MIN_DRIFT_SAMPLE) return base;

  const pm = shareMap(prior.genres); const rm = shareMap(recent.genres);
  const keys = new Set([...Object.keys(pm), ...Object.keys(rm)]);
  let tvd = 0; // total variation distance ∈ [0,1]
  const shifts: DriftShift[] = [];
  for (const k of keys) {
    const p = pm[k] ?? 0; const r = rm[k] ?? 0;
    tvd += Math.abs(r - p);
    shifts.push({ key: k, prior: Math.round(p * 1000) / 10, recent: Math.round(r * 1000) / 10, delta: Math.round((r - p) * 1000) / 10 });
  }
  tvd = clamp01(tvd / 2);
  const genreDistance = clamp100(tvd * 100);

  const cp = isNum(prior.completion_rate) && isNum(recent.completion_rate) ? Math.abs(recent.completion_rate - prior.completion_rate) : null;
  const sp = isNum(prior.skip_rate) && isNum(recent.skip_rate) ? Math.abs(recent.skip_rate - prior.skip_rate) : null;
  // KPI drift: 완주율/Skip 변화(그대로 0~100 범위) 평균(존재 성분만).
  const kpiParts = [cp, sp].filter(isNum);
  const kpiDrift = kpiParts.length ? clamp100(kpiParts.reduce((a, b) => a + b, 0) / kpiParts.length) : null;

  const parts: Array<{ v: number; w: number }> = [{ v: genreDistance, w: 0.7 }];
  if (kpiDrift != null) parts.push({ v: kpiDrift, w: 0.3 });
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = clamp100(parts.reduce((a, p) => a + p.v * p.w, 0) / wsum);

  const status: DriftStatus = score < DRIFT_THRESHOLDS.stable ? 'stable' : score < DRIFT_THRESHOLDS.changing ? 'changing' : 'drifting';
  const topShifts = shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  return {
    score, status, genreDistance,
    completionDelta: isNum(recent.completion_rate) && isNum(prior.completion_rate) ? Math.round((recent.completion_rate - prior.completion_rate) * 10) / 10 : null,
    skipDelta: isNum(recent.skip_rate) && isNum(prior.skip_rate) ? Math.round((recent.skip_rate - prior.skip_rate) * 10) / 10 : null,
    topShifts, priorEvents: prior.events, recentEvents: recent.events,
  };
}

/* ── 2) Context Stability ───────────────────────────────────────────────── */
export type StabilityLevel = 'stable' | 'variable' | 'volatile';
export interface StabilityResult { cv: number | null; factor: number; level: StabilityLevel }

/** 값 시계열의 변동계수(CV)로 안정도. factor∈[0,1](1=안정). 포인트<2 이면 factor=0.5(중립·미상). */
export function computeStability(values: Array<number | null | undefined>): StabilityResult {
  const vals = values.filter(isNum);
  if (vals.length < 2) return { cv: null, factor: 0.5, level: 'variable' };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean === 0) return { cv: 0, factor: 1, level: 'stable' };
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const cv = Math.sqrt(variance) / Math.abs(mean);
  const factor = clamp01(1 - cv); // CV 0 → 1(안정), CV≥1 → 0(불안정)
  const level: StabilityLevel = cv < 0.15 ? 'stable' : cv < 0.4 ? 'variable' : 'volatile';
  return { cv: Math.round(cv * 1000) / 1000, factor: Math.round(factor * 1000) / 1000, level };
}

/** 기존 Confidence 정의를 유지하되 Stability Factor 를 곱해 보정(변동 심하면 하향). */
export function applyStability(confidence: number, stabilityFactor: number): number {
  const f = isNum(stabilityFactor) ? clamp01(stabilityFactor) : 0.5;
  return clamp100((isNum(confidence) ? confidence : 0) * (0.5 + 0.5 * f));
}

/* ── 3) Context Decay(설정 가능 Curve) ──────────────────────────────────── */
export interface DecayPoint { days: number; weight: number }
export const DEFAULT_DECAY_CURVE: DecayPoint[] = [
  { days: 1, weight: 1.0 }, { days: 7, weight: 0.95 }, { days: 30, weight: 0.8 },
  { days: 90, weight: 0.5 }, { days: 180, weight: 0.25 },
];

/** 나이(일)에 대한 감쇠 가중(Curve 선형보간). Curve 밖은 양끝 clamp. 음수 나이→1. */
export function decayWeight(ageDays: number, curve: DecayPoint[] = DEFAULT_DECAY_CURVE): number {
  if (!isNum(ageDays) || ageDays <= 0) return 1;
  const pts = [...curve].filter((p) => isNum(p.days) && isNum(p.weight)).sort((a, b) => a.days - b.days);
  if (!pts.length) return 1;
  if (ageDays <= pts[0].days) return clamp01(pts[0].weight);
  if (ageDays >= pts[pts.length - 1].days) return clamp01(pts[pts.length - 1].weight);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]; const b = pts[i + 1];
    if (ageDays >= a.days && ageDays <= b.days) {
      const t = (ageDays - a.days) / (b.days - a.days);
      return clamp01(a.weight + (b.weight - a.weight) * t);
    }
  }
  return clamp01(pts[pts.length - 1].weight);
}

/** 값에 감쇠 적용(오래된 데이터 영향 축소). */
export function applyDecay(value: number, ageDays: number, curve: DecayPoint[] = DEFAULT_DECAY_CURVE): number {
  return (isNum(value) ? value : 0) * decayWeight(ageDays, curve);
}

/* ── 4) Similar Context Discovery ───────────────────────────────────────── */
export interface ContextFeature { store_type: string; events: number; completion_rate: number | null; skip_rate: number | null; genres: GenreShare[] }
export interface SimilarContext { store_type: string; similarity: number; genreCosine: number; kpiCloseness: number; events: number }

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0; let na = 0; let nb = 0;
  for (const k of keys) { const x = a[k] ?? 0; const y = b[k] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  if (na === 0 || nb === 0) return 0;
  return clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

/** 두 Context 유사도: 장르 분포 cosine(0.7) + KPI 근접도(0.3). 0~1. */
export function contextSimilarity(a: ContextFeature, b: ContextFeature): { similarity: number; genreCosine: number; kpiCloseness: number } {
  const gc = cosine(shareMap(a.genres), shareMap(b.genres));
  const parts: number[] = [];
  if (isNum(a.completion_rate) && isNum(b.completion_rate)) parts.push(1 - clamp01(Math.abs(a.completion_rate - b.completion_rate) / 100));
  if (isNum(a.skip_rate) && isNum(b.skip_rate)) parts.push(1 - clamp01(Math.abs(a.skip_rate - b.skip_rate) / 100));
  const kpi = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 0.5;
  const similarity = clamp01(gc * 0.7 + kpi * 0.3);
  return { similarity: Math.round(similarity * 100) / 100, genreCosine: Math.round(gc * 100) / 100, kpiCloseness: Math.round(kpi * 100) / 100 };
}

/** 대상과 나머지 Context 유사도 정렬(표본 부족 후보 제외). */
export function rankSimilar(target: ContextFeature, candidates: ContextFeature[], minSample: number = MIN_EVENTS): SimilarContext[] {
  return candidates
    .filter((c) => c.store_type !== target.store_type && c.events >= minSample)
    .map((c) => { const s = contextSimilarity(target, c); return { store_type: c.store_type, similarity: s.similarity, genreCosine: s.genreCosine, kpiCloseness: s.kpiCloseness, events: c.events }; })
    .sort((a, b) => b.similarity - a.similarity);
}

/* ── 5) Smart Context Fallback(유사도 + Grain) ──────────────────────────── */
export interface FallbackStep { context_key: string; type: 'self' | 'similar' | 'grain'; similarity?: number; reason: string }
export const SIMILAR_FALLBACK_MIN = 0.75;

/**
 * Fallback 체인: 자기 자신 → 유사 Context(임계 이상, 유사도 desc) → Grain 상위(store_type).
 * 각 단계에 이유(Evidence)를 포함. 유사 후보가 없으면 Grain 만.
 */
export function smartFallbackChain(
  selfKey: string, targetStoreType: string, similars: SimilarContext[], grainParentKey: string,
): FallbackStep[] {
  const chain: FallbackStep[] = [{ context_key: selfKey, type: 'self', reason: '요청 Context' }];
  for (const s of similars.filter((x) => x.similarity >= SIMILAR_FALLBACK_MIN).slice(0, 3)) {
    chain.push({ context_key: `store_type=${s.store_type}`, type: 'similar', similarity: s.similarity, reason: `유사도 ${s.similarity} (장르분포·KPI 근접)` });
  }
  if (grainParentKey && grainParentKey !== selfKey) {
    chain.push({ context_key: grainParentKey, type: 'grain', reason: '상위 Grain(Store Type) fallback' });
  }
  return chain;
}

/* ── 6~7) Recommendation Outcome Tracking & Success Analysis ────────────── */
export type RecoStatus = 'active' | 'applied' | 'dismissed' | 'resolved';
export type RecoOutcome = 'improved' | 'neutral' | 'degraded';
export interface OutcomeKpi { completion_rate?: number | null; skip_rate?: number | null }
export interface RecoOutcomeRow {
  id: string; context_key: string; reco_type: string; title?: string | null;
  status: RecoStatus; before_kpi?: OutcomeKpi | null; after_kpi?: OutcomeKpi | null; outcome?: RecoOutcome | null;
}
export const OUTCOME_MIN_DELTA = 2; // 완주율/Skip 개선 판정 최소 변화(pp)

/** 적용 전/후 KPI 로 Outcome 판정. 완주율↑ 또는 Skip↓ 이면 improved, 반대면 degraded. */
export function outcomeFromDelta(before: OutcomeKpi | null | undefined, after: OutcomeKpi | null | undefined): RecoOutcome | null {
  if (!before || !after) return null;
  const dc = isNum(before.completion_rate) && isNum(after.completion_rate) ? after.completion_rate - before.completion_rate : null;
  const ds = isNum(before.skip_rate) && isNum(after.skip_rate) ? after.skip_rate - before.skip_rate : null;
  if (dc == null && ds == null) return null;
  // 개선 신호: 완주율 상승 + Skip 감소. 상충하면 net 으로 판정.
  const net = (dc ?? 0) - (ds ?? 0); // 완주↑ 좋음, Skip↑ 나쁨
  if (net >= OUTCOME_MIN_DELTA) return 'improved';
  if (net <= -OUTCOME_MIN_DELTA) return 'degraded';
  return 'neutral';
}

export interface SuccessStats { total: number; applied: number; dismissed: number; improved: number; neutral: number; degraded: number; resolvedOutcomes: number; successRate: number | null }
/** 성공률 = improved / (outcome 판정된 건). outcome 없으면 null(계산 금지). */
export function computeSuccessRate(rows: RecoOutcomeRow[]): SuccessStats {
  const total = rows.length;
  const applied = rows.filter((r) => r.status === 'applied' || r.status === 'resolved').length;
  const dismissed = rows.filter((r) => r.status === 'dismissed').length;
  const improved = rows.filter((r) => r.outcome === 'improved').length;
  const neutral = rows.filter((r) => r.outcome === 'neutral').length;
  const degraded = rows.filter((r) => r.outcome === 'degraded').length;
  const resolvedOutcomes = improved + neutral + degraded;
  const successRate = resolvedOutcomes > 0 ? clamp100((improved / resolvedOutcomes) * 100) : null;
  return { total, applied, dismissed, improved, neutral, degraded, resolvedOutcomes, successRate };
}

/* ── 8) Recommendation Confidence Calibration ───────────────────────────── */
export const CALIBRATION_MAX_WEIGHT = 0.5;
export const CALIBRATION_SAT = 10; // outcome 표본 포화

/**
 * Recommendation 신뢰도 보정: 기본 Confidence 를 과거 성공률로 blend. 가중치는 outcome 표본에
 * 비례(최대 CALIBRATION_MAX_WEIGHT). outcome 없으면 base 유지(추측 금지). AI 자신감 아님.
 */
export function calibrateConfidence(baseConfidence: number, stats: SuccessStats): { calibrated: number; weight: number; basis: string } {
  const base = isNum(baseConfidence) ? clamp100(baseConfidence) : 0;
  if (stats.successRate == null || stats.resolvedOutcomes <= 0) {
    return { calibrated: base, weight: 0, basis: 'outcome 이력 없음 — base 유지' };
  }
  const weight = clamp01(stats.resolvedOutcomes / CALIBRATION_SAT) * CALIBRATION_MAX_WEIGHT;
  const calibrated = clamp100(base * (1 - weight) + stats.successRate * weight);
  return { calibrated, weight: Math.round(weight * 100) / 100, basis: `성공률 ${stats.successRate}% · outcome ${stats.resolvedOutcomes}건` };
}

/* ── 9~10) Context Memory & Evolution / Learning Timeline ───────────────── */
export interface Snapshot {
  id?: string; context_key: string; created_at: string; sample_size?: number | null;
  health_score?: number | null; score?: number | null; confidence?: number | null;
  drift_score?: number | null; reco_count?: number | null; success_rate?: number | null;
}
export interface EvolutionPoint extends Snapshot { healthDelta: number | null; driftDelta: number | null }
export interface EvolutionResult { points: EvolutionPoint[]; healthTrend: 'rising' | 'falling' | 'stable' | 'insufficient_data'; latest: Snapshot | null }

/** Snapshot 시계열(오래된→최신 정렬) + 직전 대비 Health/Drift 변화 + Health 추세. */
export function buildEvolution(snapshots: Snapshot[]): EvolutionResult {
  const pts = [...snapshots].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const out: EvolutionPoint[] = pts.map((s, i) => {
    const prev = i > 0 ? pts[i - 1] : null;
    return {
      ...s,
      healthDelta: prev && isNum(s.health_score) && isNum(prev.health_score) ? s.health_score - prev.health_score : null,
      driftDelta: prev && isNum(s.drift_score) && isNum(prev.drift_score) ? s.drift_score - prev.drift_score : null,
    };
  });
  const healths = pts.map((s) => s.health_score).filter(isNum);
  let healthTrend: EvolutionResult['healthTrend'] = 'insufficient_data';
  if (healths.length >= 3) {
    const mid = Math.floor(healths.length / 2);
    const f = healths.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
    const l = healths.slice(healths.length - mid).reduce((a, b) => a + b, 0) / mid;
    const diff = l - f;
    healthTrend = Math.abs(diff) < 3 ? 'stable' : diff > 0 ? 'rising' : 'falling';
  }
  return { points: out, healthTrend, latest: pts.length ? pts[pts.length - 1] : null };
}

export type TimelineKind = 'recommendation' | 'experiment' | 'rollout' | 'health' | 'drift' | 'snapshot';
export interface TimelineEntry { at: string; kind: TimelineKind; title: string; detail?: string; tone?: string }
/** 여러 소스 이벤트를 시간 역순 Timeline 으로 병합(파싱 실패 항목 제외). */
export function mergeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/* ── Data Sufficiency 게이트(공통) ──────────────────────────────────────── */
export function learningAllowed(sample: number): boolean {
  return isNum(sample) && sample >= MIN_EVENTS;
}
/** Sample 기반 학습 신뢰도(0~100) — 기존 sampleConfidence 재사용. */
export function learningConfidence(sample: number): number {
  return sampleConfidence(isNum(sample) ? sample : 0);
}

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const DRIFT_STATUS_LABEL: Record<DriftStatus, string> = { stable: '안정', changing: '변화중', drifting: 'Drift', insufficient_data: '데이터 부족' };
export const DRIFT_STATUS_TONE: Record<DriftStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { stable: 'success', changing: 'warning', drifting: 'danger', insufficient_data: 'neutral' };
export const STABILITY_LABEL: Record<StabilityLevel, string> = { stable: '안정', variable: '변동', volatile: '불안정' };
export const STABILITY_TONE: Record<StabilityLevel, 'success' | 'warning' | 'danger'> = { stable: 'success', variable: 'warning', volatile: 'danger' };
export const OUTCOME_LABEL: Record<RecoOutcome, string> = { improved: '개선', neutral: '중립', degraded: '악화' };
export const OUTCOME_TONE: Record<RecoOutcome, 'success' | 'neutral' | 'danger'> = { improved: 'success', neutral: 'neutral', degraded: 'danger' };
export const RECO_STATUS_LABEL: Record<RecoStatus, string> = { active: '대기', applied: '적용', dismissed: '기각', resolved: '완료' };
export const RECO_STATUS_TONE: Record<RecoStatus, 'info' | 'success' | 'danger' | 'neutral'> = { active: 'info', applied: 'success', dismissed: 'danger', resolved: 'neutral' };
export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = { recommendation: '추천', experiment: '실험', rollout: 'Rollout', health: 'Health', drift: 'Drift', snapshot: 'Snapshot' };
