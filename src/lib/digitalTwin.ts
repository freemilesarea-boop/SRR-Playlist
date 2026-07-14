/**
 * digitalTwin — Store Digital Twin, Counterfactual Simulation & Scenario Laboratory 순수 로직 (Phase AI-MUSIC-11).
 *
 * 읽기 전용 Production Snapshot(Immutable Twin) 위에서 여러 Scenario/Variant 를
 * 결정적(Seeded)으로 비교한다. 결과는 simulated/counterfactual(관찰되지 않은 가상 추정치) —
 * 실제 Outcome 이 아니며 Production Entity 를 생성·수정·실행하지 않는다.
 *
 * 원칙:
 *  - deterministic · pure function · Date/Seed 주입 · Math.random() 금지 · 동일 Input=동일 Output.
 *  - 없는 성분 null 유지 + 재정규화(null→0 금지) · NaN/Infinity 방어 · unsupported 정직 표시.
 *  - Baseline 없는 Simulation 금지 · 반복 횟수만으로 Confidence 상승 금지 · 가짜 ±구간 금지.
 *  - Sandbox(단일 전략 검증) 정의 무변경 — Twin 은 다중 Variant 비교 Evidence Layer.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents, type Component } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const SIMULATION_ENGINE_VERSION = 'twin_sim_v1(0499)';

/* ── 타입 ───────────────────────────────────────────────────────────────── */
export type TwinType = 'store' | 'brand' | 'industry' | 'playlist' | 'context';
export type TwinReadiness = 'ready' | 'partially_ready' | 'stale' | 'unsupported' | 'insufficient_data' | 'blocked';
export type TwinFreshnessStatus = 'current' | 'aging' | 'stale' | 'version_mismatch' | 'superseded';
export type TwinEligibility = 'eligible' | 'partial' | 'stale_source' | 'unsupported' | 'insufficient_data' | 'duplicate' | 'blocked';
export type CompletenessGrade = 'complete' | 'usable' | 'partial' | 'insufficient_data';
export type ComparisonResult = 'clearly_better' | 'potentially_better' | 'neutral' | 'potentially_worse' | 'clearly_worse' | 'mixed' | 'insufficient_data' | 'invalid';
export type TradeoffSeverity = 'low' | 'moderate' | 'high' | 'critical';
export type VariantRank = 'recommended_for_review' | 'promising' | 'neutral' | 'weak' | 'unsafe' | 'insufficient_data';
export type StressRisk = 'low' | 'moderate' | 'high' | 'critical';
export type CalibrationStatus = 'pending_outcome' | 'calibrated' | 'partially_calibrated' | 'invalidated' | 'insufficient_data';

/* ── Scenario Type whitelist(실데이터 기준 — weather/event/energy 데이터 없음) ── */
export type ScenarioSupport = 'supported' | 'partially_supported' | 'unsupported';
export const SCENARIO_TYPES: Array<{ code: string; label: string; support: ScenarioSupport; note: string }> = [
  { code: 'playlist_mix', label: 'Playlist Mix', support: 'supported', note: '실제 Playlist/재생 KPI 기반' },
  { code: 'genre_mix', label: 'Genre Mix', support: 'supported', note: '실제 genre 분포 기반' },
  { code: 'mood_mix', label: 'Mood Mix', support: 'partially_supported', note: 'mood 메타 일부만 존재' },
  { code: 'diversity', label: 'Diversity', support: 'supported', note: 'genre/track 다양성 집계' },
  { code: 'freshness', label: 'Freshness', support: 'partially_supported', note: '신곡 노출 비율 proxy' },
  { code: 'rotation', label: 'Rotation', support: 'supported', note: 'Rotation/Fatigue 집계' },
  { code: 'fatigue', label: 'Fatigue', support: 'supported', note: '반복 노출 위험 집계' },
  { code: 'time_slot', label: 'Time Slot', support: 'supported', note: 'daypart 실데이터' },
  { code: 'weekday', label: 'Weekday', support: 'supported', note: '요일 실데이터' },
  { code: 'season', label: 'Season', support: 'partially_supported', note: '월 기반 4계절만' },
  { code: 'rollout', label: 'Rollout', support: 'partially_supported', note: 'track_rollouts 단계 기반' },
  { code: 'quality_degradation', label: 'Quality Degradation', support: 'partially_supported', note: 'Streaming 지표 일부' },
  { code: 'recovery', label: 'Recovery', support: 'partially_supported', note: 'Recovery proxy' },
  { code: 'policy_change', label: 'Policy Change', support: 'partially_supported', note: 'guardrail snapshot 기반' },
  { code: 'guardrail_change', label: 'Guardrail Change', support: 'supported', note: 'admin_sandbox_constraints 재사용' },
  { code: 'strategy_comparison', label: 'Strategy Comparison', support: 'supported', note: 'strategy_snapshots 기반' },
  { code: 'combined', label: 'Combined', support: 'partially_supported', note: '복합(불확실성 증가)' },
];
export const UNSUPPORTED_SCENARIOS = ['weather', 'event', 'energy_mix', 'track_ranking(개별 bpm/energy 없음)'];

/* ── Metric whitelist(실데이터/Proxy 구분) ──────────────────────────────── */
export interface MetricDef { code: string; label: string; direction: 'min' | 'max'; kind: 'real' | 'proxy'; note: string }
export const TWIN_METRICS: MetricDef[] = [
  { code: 'expected_skip_rate', label: 'Skip Rate', direction: 'min', kind: 'real', note: '실제 skip 집계 기반' },
  { code: 'expected_completion_rate', label: 'Completion Rate', direction: 'max', kind: 'real', note: '실제 completion 집계 기반' },
  { code: 'diversity_score', label: 'Diversity', direction: 'max', kind: 'proxy', note: 'genre_count proxy' },
  { code: 'repetition_rate', label: 'Repetition', direction: 'min', kind: 'proxy', note: '반복 노출 proxy' },
  { code: 'fatigue_risk', label: 'Fatigue Risk', direction: 'min', kind: 'proxy', note: 'Rotation 집계 proxy' },
  { code: 'freshness_score', label: 'Freshness', direction: 'max', kind: 'proxy', note: '신곡 비율 proxy' },
  { code: 'streaming_quality_score', label: 'Streaming Quality', direction: 'max', kind: 'proxy', note: 'Quality 지표 일부' },
  { code: 'guardrail_conflict', label: 'Guardrail Conflict', direction: 'min', kind: 'real', note: 'guardrail snapshot 기반' },
  { code: 'store_satisfaction_proxy', label: 'Store Satisfaction (proxy)', direction: 'max', kind: 'proxy', note: '직접 지표 없음' },
];
export const UNSUPPORTED_METRICS = ['expected_session_duration', 'decoder_error_risk', 'revenue_impact_estimate', 'settlement_impact_estimate', 'operational_cost_estimate', 'time_to_first_audio'];

/* ── Seeded PRNG(mulberry32 — Math.random() 금지, 재현 가능) ────────────── */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSimulationInput(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `sim_${(h >>> 0).toString(16)}`;
}

/* ── Twin Completeness / Freshness / Readiness / Eligibility ────────────── */
export interface TwinCompletenessInput {
  contextPresent?: boolean; policyPresent?: boolean; guardrailPresent?: boolean; playlistPresent?: boolean;
  trackPoolPresent?: boolean; outcomePresent?: boolean; qualityPresent?: boolean;
  memoryRefCount?: number | null; patternRefCount?: number | null; versionPresent?: boolean; evidenceCount?: number | null;
}
export function calculateTwinCompleteness(inp: TwinCompletenessInput): { score: number | null; grade: CompletenessGrade; missing: string[] } {
  const b = (v: boolean | undefined) => (v == null ? null : v ? 100 : 0);
  const components: Component[] = [
    { key: 'context', value: b(inp.contextPresent), weight: 0.2 },
    { key: 'policy', value: b(inp.policyPresent), weight: 0.1 },
    { key: 'guardrail', value: b(inp.guardrailPresent), weight: 0.1 },
    { key: 'playlist', value: b(inp.playlistPresent), weight: 0.1 },
    { key: 'track_pool', value: b(inp.trackPoolPresent), weight: 0.1 },
    { key: 'outcome', value: b(inp.outcomePresent), weight: 0.15 },
    { key: 'quality', value: b(inp.qualityPresent), weight: 0.05 },
    { key: 'memory_coverage', value: isFiniteNumber(inp.memoryRefCount) ? clampScore(inp.memoryRefCount * 20) : null, weight: 0.05 },
    { key: 'pattern_coverage', value: isFiniteNumber(inp.patternRefCount) ? clampScore(inp.patternRefCount * 20) : null, weight: 0.05 },
    { key: 'version', value: b(inp.versionPresent), weight: 0.05 },
    { key: 'evidence', value: isFiniteNumber(inp.evidenceCount) ? clampScore((inp.evidenceCount / 3) * 100) : null, weight: 0.05 },
  ];
  const r = normalizeAvailableComponents(components);
  if (r.score == null) return { score: null, grade: 'insufficient_data', missing: r.missing };
  const grade: CompletenessGrade = r.score >= 80 ? 'complete' : r.score >= 55 ? 'usable' : r.score >= 30 ? 'partial' : 'insufficient_data';
  return { score: r.score, grade, missing: r.missing };
}

export interface TwinFreshnessInput { snapshotAt: string | Date; now: Date; sourceUpdatedAfterSnapshot?: boolean; versionMismatch?: boolean; superseded?: boolean; driftScore?: number | null }
export function calculateTwinFreshness(inp: TwinFreshnessInput): { score: number | null; status: TwinFreshnessStatus } {
  if (inp.superseded) return { score: 0, status: 'superseded' };
  if (inp.versionMismatch) return { score: 0, status: 'version_mismatch' };
  const snap = new Date(inp.snapshotAt).getTime(); const nowMs = inp.now.getTime();
  if (!Number.isFinite(snap) || !Number.isFinite(nowMs)) return { score: null, status: 'stale' };
  const ageDays = Math.max(0, (nowMs - snap) / 86_400_000);
  let score = clampScore(100 * Math.pow(0.5, ageDays / 14)); // 반감기 14일(운영 Snapshot 은 빠르게 늙음)
  if (inp.sourceUpdatedAfterSnapshot) score = Math.min(score, 40);
  if (isFiniteNumber(inp.driftScore) && inp.driftScore >= 35) score = Math.min(score, 45);
  const status: TwinFreshnessStatus = score >= 70 ? 'current' : score >= 40 ? 'aging' : 'stale';
  return { score, status };
}

export function classifyTwinReadiness(inp: { completeness: number | null; freshness: number | null; blocked?: boolean }): TwinReadiness {
  if (inp.blocked) return 'blocked';
  if (inp.completeness == null) return 'insufficient_data';
  if (inp.freshness != null && inp.freshness < 40) return 'stale';
  if (inp.completeness >= 80) return 'ready';
  if (inp.completeness >= 30) return 'partially_ready';
  return 'insufficient_data';
}

export interface TwinEligibilityInput {
  twinType: string; sourceType: string | null; sourceId: string | null; sourceVersion: string | null;
  sourceHash: string | null; snapshotAt: string | null; evidenceCount: number; isDuplicate?: boolean;
  sourceExpired?: boolean; completeness?: number | null;
}
export function validateTwinEligibility(inp: TwinEligibilityInput): { status: TwinEligibility; reasons: string[] } {
  const reasons: string[] = [];
  if (!['store', 'brand', 'industry', 'playlist', 'context'].includes(inp.twinType)) return { status: 'unsupported', reasons: ['unsupported twin_type'] };
  if (inp.isDuplicate) return { status: 'duplicate', reasons: ['duplicate idempotency key'] };
  if (!inp.sourceType || !inp.sourceId) reasons.push('source missing');
  if (!inp.sourceVersion) reasons.push('source_version missing');
  if (!inp.sourceHash) reasons.push('source_hash missing');
  if (!inp.snapshotAt) reasons.push('snapshot_at missing');
  if (inp.evidenceCount <= 0) reasons.push('evidence missing');
  if (reasons.length) return { status: 'blocked', reasons };
  if (inp.sourceExpired) return { status: 'stale_source', reasons: ['source expired'] };
  if (inp.completeness == null) return { status: 'insufficient_data', reasons: ['completeness unknown'] };
  return inp.completeness >= 80 ? { status: 'eligible', reasons: [] } : { status: 'partial', reasons: ['completeness < 80'] };
}

/* ── Scenario / Variant 검증 ────────────────────────────────────────────── */
export interface ScenarioInput { scenarioType: string; title: string; baseline: Record<string, unknown> | null; horizon: number; metrics: string[] }
export function validateScenario(inp: ScenarioInput): string[] {
  const errors: string[] = [];
  if (!SCENARIO_TYPES.some((s) => s.code === inp.scenarioType)) errors.push('unsupported scenario_type');
  if (!inp.title) errors.push('title required');
  if (!inp.baseline) errors.push('baseline required'); // Baseline 없는 Simulation 금지
  if (!Number.isInteger(inp.horizon) || inp.horizon < 1 || inp.horizon > 30) errors.push('horizon must be 1..30');
  if (!inp.metrics.length) errors.push('metrics required');
  if (inp.metrics.length > 12) errors.push('max 12 metrics');
  for (const m of inp.metrics) if (!TWIN_METRICS.some((t) => t.code === m)) errors.push(`unsupported metric: ${m}`);
  return errors;
}
export interface VariantInput { code: string; name: string; adjustments: Record<string, number>; isBaseline: boolean; existingCount: number; existingHashes: string[] }
export function validateVariant(inp: VariantInput): string[] {
  const errors: string[] = [];
  if (!inp.code || !inp.name) errors.push('code/name required');
  if (inp.existingCount >= 20) errors.push('max 20 variants per scenario');
  for (const [metric, adj] of Object.entries(inp.adjustments)) {
    if (!TWIN_METRICS.some((t) => t.code === metric)) errors.push(`unsupported dimension: ${metric}`);
    if (!isFiniteNumber(adj)) errors.push(`non-finite adjustment: ${metric}`);
    else if (Math.abs(adj) > 50) errors.push(`adjustment out of range (±50%): ${metric}`);
  }
  const hash = hashSimulationInput([inp.code, JSON.stringify(inp.adjustments)]);
  if (inp.existingHashes.includes(hash)) errors.push('duplicate variant');
  return errors;
}

/* ── Deterministic Simulation Engine ────────────────────────────────────── */
export interface SimVariant { id: string; code: string; name: string; isBaseline: boolean; adjustments: Record<string, number> }
export interface SimInput {
  baselineMetrics: Record<string, number | null>;   // 실제 Twin Snapshot KPI(없으면 null 유지)
  variants: SimVariant[]; horizonDays: number; seed: number;
  twinCompleteness: number | null; twinFreshness: number | null; contradictionCount?: number;
}
export interface SimResultRow {
  variantId: string; metricCode: string; baselineValue: number | null; simulatedValue: number | null;
  deltaValue: number | null; deltaPercent: number | null; confidence: number | null;
  uncertaintyLow: number | null; uncertaintyHigh: number | null;
  resultStatus: 'available' | 'unsupported' | 'insufficient_data'; kind: 'real' | 'proxy';
}
export function calculateHorizonPenalty(days: number): number {
  if (!isFiniteNumber(days) || days <= 1) return 0;
  return clampScore(Math.min(40, (days / 30) * 40)); // 30일 최대 -40
}
export function calculateSimulationConfidence(inp: {
  twinCompleteness: number | null; twinFreshness: number | null; inputQuality?: number | null;
  memoryQuality?: number | null; versionCompatible?: boolean | null; horizonDays: number; contradictionCount?: number;
}): number | null {
  if (inp.versionCompatible === false) return 0;
  const base = normalizeAvailableComponents([
    { key: 'completeness', value: inp.twinCompleteness, weight: 0.35 },
    { key: 'freshness', value: inp.twinFreshness, weight: 0.25 },
    { key: 'input_quality', value: inp.inputQuality ?? null, weight: 0.2 },
    { key: 'memory_quality', value: inp.memoryQuality ?? null, weight: 0.2 },
  ]);
  if (base.score == null) return null;
  const horizonPenalty = calculateHorizonPenalty(inp.horizonDays);
  const contradictionPenalty = Math.min(30, (inp.contradictionCount ?? 0) * 10);
  return clampScore(base.score - horizonPenalty - contradictionPenalty);
  // 주의: iteration 수는 성분이 아님(반복 횟수만으로 Confidence 상승 금지).
}
export function calculateUncertainty(inp: { simulated: number | null; confidence: number | null; sampleSize: number | null }): { low: number | null; high: number | null } {
  // 계산 근거(sample) 없으면 구간 미제공(임의 ±5% 금지).
  if (!isFiniteNumber(inp.simulated) || !isFiniteNumber(inp.confidence) || !isFiniteNumber(inp.sampleSize) || inp.sampleSize <= 0) return { low: null, high: null };
  const spread = (100 - inp.confidence) / 100 * (inp.simulated === 0 ? 1 : Math.abs(inp.simulated)) / Math.sqrt(inp.sampleSize);
  return { low: Math.round((inp.simulated - spread) * 100) / 100, high: Math.round((inp.simulated + spread) * 100) / 100 };
}

/** 결정적 시뮬레이션: Variant 의 명시적 adjustment(가정 선언)를 Baseline 실측 KPI 에 적용.
 *  Baseline 값이 없는 Metric 은 unsupported(null 유지 — 추정값 채우기 금지). */
export function runDeterministicSimulation(inp: SimInput): { rows: SimResultRow[]; confidence: number | null; limitations: string[] } {
  const limitations: string[] = [];
  const confidence = calculateSimulationConfidence({
    twinCompleteness: inp.twinCompleteness, twinFreshness: inp.twinFreshness,
    horizonDays: inp.horizonDays, contradictionCount: inp.contradictionCount,
  });
  const rows: SimResultRow[] = [];
  // 결정적 정렬: variant code asc → metric code asc.
  const variants = [...inp.variants].sort((a, b) => a.code.localeCompare(b.code));
  const metrics = Object.keys(inp.baselineMetrics).sort();
  for (const v of variants) {
    for (const m of metrics) {
      const def = TWIN_METRICS.find((t) => t.code === m);
      const base = inp.baselineMetrics[m];
      if (!def) { rows.push({ variantId: v.id, metricCode: m, baselineValue: null, simulatedValue: null, deltaValue: null, deltaPercent: null, confidence: null, uncertaintyLow: null, uncertaintyHigh: null, resultStatus: 'unsupported', kind: 'proxy' }); continue; }
      if (!isFiniteNumber(base)) {
        rows.push({ variantId: v.id, metricCode: m, baselineValue: null, simulatedValue: null, deltaValue: null, deltaPercent: null, confidence: null, uncertaintyLow: null, uncertaintyHigh: null, resultStatus: 'unsupported', kind: def.kind });
        if (!limitations.includes(`${m}: baseline 없음(unsupported)`)) limitations.push(`${m}: baseline 없음(unsupported)`);
        continue;
      }
      const adjPct = v.isBaseline ? 0 : (v.adjustments[m] ?? 0);
      const simulated = Math.round(base * (1 + adjPct / 100) * 100) / 100;
      const delta = Math.round((simulated - base) * 100) / 100;
      const deltaPct = base !== 0 ? Math.round((delta / Math.abs(base)) * 10000) / 100 : null;
      const unc = calculateUncertainty({ simulated, confidence, sampleSize: null });
      rows.push({
        variantId: v.id, metricCode: m, baselineValue: base, simulatedValue: simulated,
        deltaValue: delta, deltaPercent: deltaPct, confidence,
        uncertaintyLow: unc.low, uncertaintyHigh: unc.high,
        resultStatus: 'available', kind: def.kind,
      });
    }
  }
  if (inp.horizonDays > 7) limitations.push(`horizon ${inp.horizonDays}일 — 장기일수록 불확실성 증가`);
  limitations.push('결과는 simulated/counterfactual — 실제 Outcome 아님(인과 단정 금지)');
  return { rows, confidence, limitations };
}

/* ── Baseline Comparison / Counterfactual 분류 ──────────────────────────── */
export interface MetricComparison { metricCode: string; baseline: number | null; simulated: number | null; direction: 'min' | 'max'; confidence: number | null }
export function compareVariantToBaseline(items: MetricComparison[]): { result: ComparisonResult; improved: string[]; worsened: string[] } {
  const valid = items.filter((i) => isFiniteNumber(i.baseline) && isFiniteNumber(i.simulated));
  if (!valid.length) return { result: 'insufficient_data', improved: [], worsened: [] };
  if (valid.some((i) => !Number.isFinite(i.baseline as number) || !Number.isFinite(i.simulated as number))) return { result: 'invalid', improved: [], worsened: [] };
  const improved: string[] = []; const worsened: string[] = [];
  for (const i of valid) {
    const delta = (i.simulated as number) - (i.baseline as number);
    const relevant = Math.abs(i.baseline as number) > 0 ? Math.abs(delta / (i.baseline as number)) >= 0.02 : Math.abs(delta) >= 0.5;
    if (!relevant) continue;
    const better = i.direction === 'max' ? delta > 0 : delta < 0;
    (better ? improved : worsened).push(i.metricCode);
  }
  const avgConf = valid.map((i) => i.confidence).filter(isFiniteNumber);
  const conf = avgConf.length ? avgConf.reduce((a, b) => a + b, 0) / avgConf.length : null;
  if (improved.length && worsened.length) return { result: 'mixed', improved, worsened };
  if (improved.length) return { result: conf != null && conf >= 60 && improved.length >= 2 ? 'clearly_better' : 'potentially_better', improved, worsened };
  if (worsened.length) return { result: conf != null && conf >= 60 && worsened.length >= 2 ? 'clearly_worse' : 'potentially_worse', improved, worsened };
  return { result: 'neutral', improved, worsened };
}

/* ── Multi-Metric Trade-off ─────────────────────────────────────────────── */
export interface Tradeoff { a: string; b: string; reason: string; severity: TradeoffSeverity }
const TRADEOFF_PAIRS: Array<{ a: string; b: string; reason: string }> = [
  { a: 'expected_skip_rate', b: 'diversity_score', reason: 'Skip 개선 vs Diversity 악화' },
  { a: 'expected_completion_rate', b: 'repetition_rate', reason: 'Completion 증가 vs Repetition 증가' },
  { a: 'freshness_score', b: 'streaming_quality_score', reason: 'Freshness 증가 vs Quality Risk' },
  { a: 'store_satisfaction_proxy', b: 'fatigue_risk', reason: 'Satisfaction vs Fatigue' },
];
export function detectMetricTradeoffs(items: MetricComparison[]): Tradeoff[] {
  const byCode = new Map(items.map((i) => [i.metricCode, i]));
  const out: Tradeoff[] = [];
  for (const p of TRADEOFF_PAIRS) {
    const a = byCode.get(p.a); const b = byCode.get(p.b);
    if (!a || !b || !isFiniteNumber(a.baseline) || !isFiniteNumber(a.simulated) || !isFiniteNumber(b.baseline) || !isFiniteNumber(b.simulated)) continue;
    const aBetter = a.direction === 'max' ? a.simulated! > a.baseline! : a.simulated! < a.baseline!;
    const bWorse = b.direction === 'max' ? b.simulated! < b.baseline! : b.simulated! > b.baseline!;
    if (aBetter && bWorse) {
      const bRel = Math.abs(b.baseline!) > 0 ? Math.abs((b.simulated! - b.baseline!) / b.baseline!) * 100 : 100;
      out.push({ a: p.a, b: p.b, reason: p.reason, severity: bRel >= 25 ? 'critical' : bRel >= 15 ? 'high' : bRel >= 5 ? 'moderate' : 'low' });
    }
  }
  return out;
}
export function hasCriticalTradeoff(tradeoffs: Tradeoff[]): boolean { return tradeoffs.some((t) => t.severity === 'critical'); }

/* ── Pareto Frontier ────────────────────────────────────────────────────── */
export interface ParetoVariant { id: string; code: string; metrics: Record<string, number | null> }
export interface ParetoObjective { metric: string; direction: 'min' | 'max' }
/** a 가 b 를 지배: 모든 목표에서 같거나 낫고, 하나 이상에서 확실히 나음. 미측정 metric 은 제외. */
export function calculateParetoFrontier(variants: ParetoVariant[], objectives: ParetoObjective[]): Array<ParetoVariant & { dominated: boolean }> {
  const usable = objectives.filter((o) => variants.some((v) => isFiniteNumber(v.metrics[o.metric])));
  const better = (x: number, y: number, dir: 'min' | 'max') => (dir === 'max' ? x > y : x < y);
  const geq = (x: number, y: number, dir: 'min' | 'max') => (dir === 'max' ? x >= y : x <= y);
  const dominates = (a: ParetoVariant, b: ParetoVariant) => {
    let strictly = false;
    for (const o of usable) {
      const av = a.metrics[o.metric]; const bv = b.metrics[o.metric];
      if (!isFiniteNumber(av) || !isFiniteNumber(bv)) return false;
      if (!geq(av, bv, o.direction)) return false;
      if (better(av, bv, o.direction)) strictly = true;
    }
    return strictly;
  };
  return [...variants].sort((a, b) => a.code.localeCompare(b.code)).map((v) => ({
    ...v, dominated: variants.some((o) => o.id !== v.id && dominates(o, v)),
  }));
}

/* ── Scenario Ranking(recommended_for_review ≠ 실행 추천) ───────────────── */
export interface RankInput { comparison: ComparisonResult; confidence: number | null; criticalTradeoff: boolean; constraintViolations: number; governanceRisk: boolean }
export function rankScenarioVariants(inp: RankInput): VariantRank {
  if (inp.comparison === 'insufficient_data' || inp.comparison === 'invalid') return 'insufficient_data';
  if (inp.governanceRisk || inp.constraintViolations > 0 || inp.criticalTradeoff) return 'unsafe';
  if (inp.comparison === 'clearly_better' && (inp.confidence ?? 0) >= 60) return 'recommended_for_review';
  if (inp.comparison === 'potentially_better' || inp.comparison === 'clearly_better') return 'promising';
  if (inp.comparison === 'neutral' || inp.comparison === 'mixed') return 'neutral';
  return 'weak';
}

/* ── Stress / Resilience ────────────────────────────────────────────────── */
export interface StressInput {
  playbackFailureIncreasePct?: number | null; bufferingIncreasePct?: number | null; queueShortage?: boolean;
  trackPoolShortage?: boolean; fatigueIncreasePct?: number | null; policyConflict?: boolean;
  guardrailConflict?: boolean; contextMissing?: boolean; memoryContradiction?: boolean; constitutionViolation?: boolean;
}
export function classifyStressRisk(inp: StressInput): { risk: StressRisk; factors: string[] } {
  const factors: string[] = [];
  if (inp.constitutionViolation) factors.push('Critical Constitution Violation');
  if (inp.guardrailConflict) factors.push('Guardrail Conflict');
  if (inp.policyConflict) factors.push('Policy Conflict');
  if (inp.queueShortage) factors.push('Queue 부족');
  if (inp.trackPoolShortage) factors.push('Track Pool 부족');
  if (inp.contextMissing) factors.push('Context 누락');
  if (inp.memoryContradiction) factors.push('Memory 반례');
  if (isFiniteNumber(inp.playbackFailureIncreasePct) && inp.playbackFailureIncreasePct >= 10) factors.push('Playback Failure 증가');
  if (isFiniteNumber(inp.bufferingIncreasePct) && inp.bufferingIncreasePct >= 10) factors.push('Buffering 증가');
  if (isFiniteNumber(inp.fatigueIncreasePct) && inp.fatigueIncreasePct >= 20) factors.push('Fatigue 증가');
  const risk: StressRisk = inp.constitutionViolation ? 'critical' : factors.length >= 4 ? 'critical' : factors.length >= 3 ? 'high' : factors.length >= 1 ? 'moderate' : 'low';
  return { risk, factors };
}
export interface ResilienceInput {
  trackFallbackCoverage?: number | null; playlistFallbackCoverage?: number | null; qualityTolerance?: number | null;
  queueDepthTolerance?: number | null; contextFallback?: boolean | null; partialAgentAbstention?: boolean | null;
}
export function evaluateResilience(inp: ResilienceInput): { score: number | null; grade: 'resilient' | 'adequate' | 'fragile' | 'insufficient_data' } {
  const b = (v: boolean | null | undefined) => (v == null ? null : v ? 100 : 20);
  const r = normalizeAvailableComponents([
    { key: 'track_fallback', value: inp.trackFallbackCoverage ?? null, weight: 0.25 },
    { key: 'playlist_fallback', value: inp.playlistFallbackCoverage ?? null, weight: 0.25 },
    { key: 'quality_tolerance', value: inp.qualityTolerance ?? null, weight: 0.2 },
    { key: 'queue_tolerance', value: inp.queueDepthTolerance ?? null, weight: 0.1 },
    { key: 'context_fallback', value: b(inp.contextFallback), weight: 0.1 },
    { key: 'agent_abstention', value: b(inp.partialAgentAbstention), weight: 0.1 },
  ]);
  if (r.score == null) return { score: null, grade: 'insufficient_data' };
  return { score: r.score, grade: r.score >= 70 ? 'resilient' : r.score >= 45 ? 'adequate' : 'fragile' };
}

/* ── Calibration ────────────────────────────────────────────────────────── */
export function calculateCalibrationError(inp: { simulated: number | null; observed: number | null }): { absolute: number | null; relative: number | null; status: CalibrationStatus } {
  if (!isFiniteNumber(inp.observed)) return { absolute: null, relative: null, status: 'pending_outcome' };
  if (!isFiniteNumber(inp.simulated)) return { absolute: null, relative: null, status: 'insufficient_data' };
  const absolute = Math.round(Math.abs(inp.simulated - inp.observed) * 100) / 100;
  const relative = inp.observed !== 0 ? Math.round((absolute / Math.abs(inp.observed)) * 10000) / 100 : null;
  return { absolute, relative, status: 'calibrated' };
}

/* ── Multi-Agent Review Adapter(원본 Consensus 정의 무변경 — 입력 변환만) ── */
import type { CollaborationInput } from './multiAgent';
export function twinResultToCollaborationInput(inp: {
  contextKey: string; sample: number; rows: SimResultRow[]; confidence: number | null;
  governanceRisk: boolean; criticalTradeoff: boolean;
}): CollaborationInput {
  const metric = (code: string) => { const r = inp.rows.find((x) => x.metricCode === code && !x.variantId.startsWith('__')); return r?.simulatedValue ?? null; };
  const completion = metric('expected_completion_rate');
  const skip = metric('expected_skip_rate');
  return {
    contextKey: inp.contextKey, sample: inp.sample,
    contextHealth: null, contextDrift: null,
    predictedCompletion: completion, predictedSkip: skip, predictionConfidence: inp.confidence, riskScore: null,
    playlistDiversity: metric('diversity_score'), playlistFreshness: metric('freshness_score'),
    trackCoverage: null, artistExposure: null,
    repeatRisk: metric('repetition_rate'), fatigueRisk: metric('fatigue_risk'),
    streamingQuality: metric('streaming_quality_score'), bufferHealth: null,
    roi: null, storeSatisfaction: metric('store_satisfaction_proxy'),
    governanceHealth: inp.governanceRisk ? 20 : 85, constitutionPass: !inp.governanceRisk && !inp.criticalTradeoff,
  };
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type TwinSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data';
export interface TwinSupport { key: string; label: string; status: TwinSupportStatus; note: string }
export const TWIN_SUPPORT: TwinSupport[] = [
  { key: 'store_twin', label: 'Store Twin', status: 'partially_supported', note: 'store_type 집계 proxy(개별 store 테이블 미연결)' },
  { key: 'brand_twin', label: 'Brand Twin', status: 'insufficient_data', note: 'business_id 미연결' },
  { key: 'industry_twin', label: 'Industry Twin', status: 'partially_supported', note: 'store_type 을 Industry proxy 로 사용' },
  { key: 'playlist_twin', label: 'Playlist Twin', status: 'partially_supported', note: 'Playlist KPI 집계 기반' },
  { key: 'context_twin', label: 'Context Twin', status: 'fully_supported', note: 'Context Intelligence 실데이터' },
  { key: 'immutable_snapshot', label: 'Immutable Snapshot', status: 'fully_supported', note: 'Snapshot 수정 RPC 없음(supersede 만)' },
  { key: 'versioning', label: 'Twin Versioning', status: 'fully_supported', note: 'source_version/hash/snapshot_at 필수' },
  { key: 'completeness', label: 'Twin Completeness', status: 'fully_supported', note: '성분 재정규화(null→0 금지)' },
  { key: 'freshness', label: 'Twin Freshness', status: 'fully_supported', note: '반감기 14일 + drift 반영' },
  { key: 'scenario', label: 'Scenario Model', status: 'partially_supported', note: 'weather/event/energy 미지원' },
  { key: 'baseline', label: 'Baseline', status: 'fully_supported', note: '필수 + 정확히 1개(unique index)' },
  { key: 'variant', label: 'Variant', status: 'fully_supported', note: '최대 20개 · 중복 차단 · ±50% 제한' },
  { key: 'counterfactual', label: 'Counterfactual', status: 'evidence_only', note: 'Not Actual 표기 · 인과 단정 금지' },
  { key: 'deterministic', label: 'Deterministic Simulation', status: 'fully_supported', note: '동일 Input=동일 Output(테스트 검증)' },
  { key: 'seeded', label: 'Seeded Simulation', status: 'fully_supported', note: 'mulberry32 · Math.random() 금지' },
  { key: 'multi_variant', label: 'Multi-Variant Comparison', status: 'fully_supported', note: 'Baseline 대비 Delta/Confidence' },
  { key: 'tradeoff', label: 'Multi-Metric Trade-off', status: 'fully_supported', note: '4 conflict pair · critical → Governance' },
  { key: 'pareto', label: 'Pareto Frontier', status: 'fully_supported', note: 'Dominated/Non-Dominated 결정적 계산' },
  { key: 'stress', label: 'Stress Testing', status: 'evidence_only', note: '가상 평가만(실제 장애 주입 없음)' },
  { key: 'resilience', label: 'Resilience', status: 'partially_supported', note: 'Fallback proxy 성분만' },
  { key: 'confidence', label: 'Simulation Confidence', status: 'fully_supported', note: '재정규화 · iteration 수 미반영' },
  { key: 'uncertainty', label: 'Uncertainty', status: 'partially_supported', note: 'sample 있을 때만(가짜 ±구간 금지)' },
  { key: 'calibration', label: 'Calibration', status: 'insufficient_data', note: '실제 Outcome 축적 전 pending_outcome' },
  { key: 'memory_integration', label: 'Memory Integration', status: 'read_only', note: 'ID Reference 만(복제 없음)' },
  { key: 'pattern_integration', label: 'Pattern Integration', status: 'read_only', note: 'ID Reference 만' },
  { key: 'graph_integration', label: 'Knowledge Graph Integration', status: 'read_only', note: '0498 조회 재사용' },
  { key: 'agent_review', label: 'Multi-Agent Review', status: 'read_only', note: '0497 Consensus 재사용(Adapter, 정의 무변경)' },
  { key: 'governance', label: 'Governance Integration', status: 'partially_supported', note: '기존 Rule 검증 · 신규 Rule 생성 없음' },
  { key: 'sandbox_evidence', label: 'Sandbox Evidence Integration', status: 'evidence_only', note: '참고 Evidence 만(자동 전달/판정 덮어쓰기 없음)' },
  { key: 'large_scale_background', label: 'Large-Scale Background Execution', status: 'unsupported', note: 'Worker 없음 — 동기 소규모만(Variant<=20)' },
  { key: 'monte_carlo', label: 'Monte Carlo', status: 'unsupported', note: '확률 분포 근거 없음 — Deterministic Matrix 사용' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Simulation 은 Evidence 계층' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const READINESS_LABEL: Record<TwinReadiness, string> = { ready: 'Ready', partially_ready: 'Partial', stale: 'Stale', unsupported: '미지원', insufficient_data: '데이터 부족', blocked: '차단' };
export const READINESS_TONE: Record<TwinReadiness, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { ready: 'success', partially_ready: 'warning', stale: 'warning', unsupported: 'danger', insufficient_data: 'neutral', blocked: 'danger' };
export const COMPARISON_LABEL: Record<ComparisonResult, string> = { clearly_better: '명확히 개선', potentially_better: '개선 가능', neutral: '중립', potentially_worse: '악화 가능', clearly_worse: '명확히 악화', mixed: 'Trade-off 혼재', insufficient_data: '데이터 부족', invalid: '무효' };
export const COMPARISON_TONE: Record<ComparisonResult, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = { clearly_better: 'success', potentially_better: 'info', neutral: 'neutral', potentially_worse: 'warning', clearly_worse: 'danger', mixed: 'warning', insufficient_data: 'neutral', invalid: 'danger' };
export const RANK_LABEL: Record<VariantRank, string> = { recommended_for_review: '검토 후보(실행 아님)', promising: '유망', neutral: '중립', weak: '약함', unsafe: 'Unsafe', insufficient_data: '데이터 부족' };
export const RANK_TONE: Record<VariantRank, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = { recommended_for_review: 'success', promising: 'info', neutral: 'neutral', weak: 'warning', unsafe: 'danger', insufficient_data: 'neutral' };
export const TRADEOFF_TONE: Record<TradeoffSeverity, 'neutral' | 'info' | 'warning' | 'danger'> = { low: 'neutral', moderate: 'info', high: 'warning', critical: 'danger' };
export const STRESS_TONE: Record<StressRisk, 'success' | 'info' | 'warning' | 'danger'> = { low: 'success', moderate: 'info', high: 'warning', critical: 'danger' };
