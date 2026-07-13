/**
 * strategySandbox — Autonomous Strategy Sandbox & Validation 순수 로직 (Phase AI-MUSIC-6).
 *
 * AI-MUSIC-5 의 Optimization Strategy 를 **실제 운영에 반영하지 않고** 격리된 Sandbox 안에서
 * 입력 검증 · 정책/제약 검증(실제 Guardrail) · 시나리오 시뮬레이션 · 회귀 검증 · Risk/Benefit ·
 * 승인 가능 여부(Go/Review/Reject)까지 판정한다.
 *
 * 원칙:
 *  - Production Entity 무변경(계산·Snapshot 만). 자동 승인/실행/Draft 생성 없음.
 *  - 실제 존재하는 Constraint(genre_store_guardrails · store_guardrails)만 사용. 미존재 정책 추정 금지.
 *  - Sample 부족이면 Sandbox 실행 불가(insufficient_data). Hard Constraint Fail 이면 go 금지.
 *  - 모든 점수 0~100 clamp · NaN/Infinity 금지 · 미지원 KPI null 유지 · Evidence 없는 결과 금지.
 *  - Threshold/Scenario/Objective/Budget Parameter 는 명시적 설정값(숨은 하드코딩 금지).
 */
import { clampPct, MIN_EVENTS } from './playlistIntel';
import { computeContextHealth, type ContextSummary, type GenreMoodRow } from './contextIntel';
import {
  type Strategy, type StrategyType, type ExpectedGain,
  multiStrategySimulation, detectConflicts, dependencyGraph, STRATEGY_LABEL,
} from './optimizationStrategy';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const round1 = (n: number) => Math.round(n * 10) / 10;
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export const MODEL_VERSION = 'sandbox-1.0';
export interface EvidenceItem { label: string; value: string | number | boolean | null }

/* ── 4) Strategy Support Matrix ─────────────────────────────────────────── */
export interface StrategySupport {
  type: StrategyType; simulation: boolean; policy: boolean; dependency: boolean; conflict: boolean; regression: boolean; outcome: boolean; note: string;
}
export const SANDBOX_STRATEGY_SUPPORT: StrategySupport[] = [
  { type: 'playlist_refresh', simulation: true, policy: true, dependency: true, conflict: true, regression: true, outcome: true, note: 'Playlist Candidate Snapshot' },
  { type: 'track_replacement', simulation: true, policy: true, dependency: true, conflict: true, regression: true, outcome: true, note: 'Track Candidate Snapshot' },
  { type: 'track_promotion', simulation: true, policy: true, dependency: true, conflict: true, regression: true, outcome: true, note: '' },
  { type: 'track_demotion', simulation: true, policy: true, dependency: true, conflict: true, regression: true, outcome: true, note: '' },
  { type: 'genre_ratio', simulation: true, policy: true, dependency: false, conflict: true, regression: true, outcome: true, note: 'Genre Guardrail 검증' },
  { type: 'mood_ratio', simulation: true, policy: true, dependency: false, conflict: true, regression: true, outcome: true, note: 'Mood Guardrail 검증' },
  { type: 'rotation_interval', simulation: true, policy: false, dependency: true, conflict: false, regression: true, outcome: true, note: 'Rotation Candidate(최소간격만)' },
  { type: 'rediscovery', simulation: true, policy: false, dependency: true, conflict: false, regression: true, outcome: true, note: '' },
  { type: 'test_pool_expand', simulation: true, policy: false, dependency: true, conflict: true, regression: true, outcome: true, note: 'Rollout Candidate Snapshot' },
  { type: 'test_pool_reduce', simulation: true, policy: false, dependency: false, conflict: true, regression: true, outcome: true, note: 'Rollout Candidate Snapshot' },
];
export function strategySupport(type: StrategyType): StrategySupport | undefined { return SANDBOX_STRATEGY_SUPPORT.find((s) => s.type === type); }

/* ── Constraint Support Matrix(실제 DB 기준) ────────────────────────────── */
export type ConstraintSupportStatus = 'supported' | 'validation_only' | 'unsupported' | 'insufficient_data';
export interface ConstraintSupport { key: string; label: string; status: ConstraintSupportStatus; note: string }
export const CONSTRAINT_SUPPORT: ConstraintSupport[] = [
  { key: 'genre_guardrail', label: 'Genre Guardrail', status: 'supported', note: 'genre_store_guardrails + store_guardrails(genre) · tracks.main_genre' },
  { key: 'mood_guardrail', label: 'Mood Guardrail', status: 'supported', note: 'store_guardrails(mood) · tracks.mood' },
  { key: 'explicit', label: 'Explicit 정책', status: 'supported', note: 'store_guardrails(banned_explicit) · tracks.explicit_content' },
  { key: 'rollout_stage', label: 'Rollout Stage', status: 'supported', note: 'track_rollouts.stage' },
  { key: 'sample', label: 'Sample Requirement', status: 'supported', note: 'Context 이벤트 수' },
  { key: 'confidence', label: 'Confidence Requirement', status: 'supported', note: 'Prediction Confidence' },
  { key: 'drift', label: 'Drift Limit', status: 'supported', note: 'Context Drift' },
  { key: 'conflict', label: 'Strategy Conflict', status: 'supported', note: 'AI-M5 Conflict' },
  { key: 'dependency', label: 'Strategy Dependency', status: 'supported', note: 'AI-M5 Dependency' },
  { key: 'numeric', label: 'BPM/Energy 제한', status: 'unsupported', note: 'store_guardrails(numeric) 존재하나 tracks.bpm/energy NULL → 평가 불가' },
  { key: 'vocal', label: 'Vocal 제한', status: 'unsupported', note: 'tracks.vocal_presence NULL' },
  { key: 'brand_policy', label: 'Brand Policy', status: 'unsupported', note: '재생-브랜드 연결 없음(business_id NULL)' },
];

/* ── 5/6) Constraint Engine ─────────────────────────────────────────────── */
export interface GenreGuardrail { genre: string; severity: 'hard' | 'soft' | 'bonus'; score_delta?: number | null; source?: string }
export interface StoreGuardrail { rule_type: string; rule_key: string; value: string | null; severity: 'hard' | 'soft'; source?: string }
export interface GuardrailSource { store_type: string; genre_guardrails: GenreGuardrail[]; store_guardrails: StoreGuardrail[] }

export type ConstraintResult = 'pass' | 'warning' | 'fail' | 'unsupported' | 'insufficient_data';
export interface ConstraintCheck {
  constraint_code: string; label: string; severity: 'hard' | 'soft'; result: ConstraintResult;
  current_value: string | number | null; allowed_value: string | number | null; source: string; explanation: string;
}

/** 전략이 도입/증대하려는 대상 장르 집합(전략별). 실제 대상만(추정 금지). */
function targetGenres(strategy: Strategy, genres: GenreMoodRow[]): string[] {
  if (strategy.type === 'genre_ratio') {
    // 고성과 가중 → 상위 성과 장르 비중 증대 대상.
    return genres.filter((g) => !g.is_unknown && g.events >= 5 && (g.completion_rate ?? 0) >= 50).map((g) => g.key);
  }
  return [];
}
function targetMoods(strategy: Strategy, moods: GenreMoodRow[]): string[] {
  if (strategy.type === 'mood_ratio') return moods.filter((m) => !m.is_unknown && m.events >= 5 && (m.completion_rate ?? 0) >= 50).map((m) => m.key);
  return [];
}

/**
 * 전략 + Context + 실제 Guardrail 로 Constraint 검증. Hard 위반 → fail, Soft 위반 → warning.
 * numeric/vocal 은 track 메타 부재로 unsupported(정직). Sample/Confidence/Drift/Conflict 도 포함.
 */
export function evaluateConstraints(
  summary: ContextSummary, guardrails: GuardrailSource,
  ctx: { confidence: number; driftScore?: number | null; conflicts?: number; missingDependency?: boolean },
): ConstraintCheck[] {
  const out: ConstraintCheck[] = [];
  // (대상 장르/무드 Guardrail 위반은 evaluateTargetGuardrails 에서 별도 검증)

  // Sample Requirement (Hard)
  out.push({
    constraint_code: 'sample_min', label: 'Sample 충족', severity: 'hard',
    result: summary.events >= MIN_EVENTS ? 'pass' : 'fail',
    current_value: summary.events, allowed_value: `>= ${MIN_EVENTS}`, source: 'context', explanation: `Context 이벤트 ${summary.events}`,
  });
  // Confidence Requirement (Soft)
  out.push({
    constraint_code: 'confidence_min', label: 'Confidence', severity: 'soft',
    result: ctx.confidence >= 40 ? 'pass' : 'warning',
    current_value: ctx.confidence, allowed_value: '>= 40', source: 'prediction', explanation: `Prediction Confidence ${ctx.confidence}`,
  });
  // Drift Limit (Soft)
  if (isNum(ctx.driftScore)) out.push({
    constraint_code: 'drift_limit', label: 'Drift 한계', severity: 'soft',
    result: ctx.driftScore <= 45 ? 'pass' : 'warning',
    current_value: ctx.driftScore, allowed_value: '<= 45', source: 'context', explanation: `Context Drift ${ctx.driftScore}`,
  });
  // Strategy Conflict (Hard)
  if (isNum(ctx.conflicts)) out.push({
    constraint_code: 'strategy_conflict', label: 'Strategy Conflict', severity: 'hard',
    result: ctx.conflicts === 0 ? 'pass' : 'fail',
    current_value: ctx.conflicts, allowed_value: '0', source: 'strategy_engine', explanation: `미해결 충돌 ${ctx.conflicts}건`,
  });
  // Strategy Dependency (Hard)
  if (ctx.missingDependency != null) out.push({
    constraint_code: 'strategy_dependency', label: 'Dependency', severity: 'hard',
    result: ctx.missingDependency ? 'fail' : 'pass',
    current_value: ctx.missingDependency ? '누락' : '충족', allowed_value: '충족', source: 'strategy_engine', explanation: '필수 선행 전략',
  });
  // numeric / vocal — 미지원(정직).
  if (guardrails.store_guardrails.some((s) => s.rule_type === 'numeric')) out.push({
    constraint_code: 'numeric_guardrail', label: 'BPM/Energy 제한', severity: 'soft', result: 'unsupported',
    current_value: null, allowed_value: null, source: 'store_guardrails', explanation: 'tracks.bpm/energy NULL → 평가 불가',
  });

  return out;
}

/** 대상 장르/무드가 Guardrail 을 위반하는지 별도 검증(전략 대상 목록 사용). */
export function evaluateTargetGuardrails(strategy: Strategy, genres: GenreMoodRow[], moods: GenreMoodRow[], guardrails: GuardrailSource): ConstraintCheck[] {
  const out: ConstraintCheck[] = [];
  const bannedG = new Set<string>(); const softG = new Set<string>();
  for (const g of guardrails.genre_guardrails) { if (g.severity === 'hard') bannedG.add(norm(g.genre)); else if (g.severity === 'soft') softG.add(norm(g.genre)); }
  for (const s of guardrails.store_guardrails) if (s.rule_type === 'genre' && s.value) (s.severity === 'hard' ? bannedG : softG).add(norm(s.value));
  const bannedM = new Set<string>(); const softM = new Set<string>();
  for (const s of guardrails.store_guardrails) if (s.rule_type === 'mood' && s.value) (s.severity === 'hard' ? bannedM : softM).add(norm(s.value));

  for (const gk of targetGenres(strategy, genres)) {
    if (bannedG.has(norm(gk))) out.push({ constraint_code: 'genre_hard_block', label: `금지 Genre(${gk})`, severity: 'hard', result: 'fail', current_value: gk, allowed_value: '금지', source: 'guardrails', explanation: `${gk} 는 이 업종 hard_block` });
    else if (softG.has(norm(gk))) out.push({ constraint_code: 'genre_soft_block', label: `주의 Genre(${gk})`, severity: 'soft', result: 'warning', current_value: gk, allowed_value: '주의', source: 'guardrails', explanation: `${gk} 는 soft_block` });
  }
  for (const mk of targetMoods(strategy, moods)) {
    if (bannedM.has(norm(mk))) out.push({ constraint_code: 'mood_hard_block', label: `금지 Mood(${mk})`, severity: 'hard', result: 'fail', current_value: mk, allowed_value: '금지', source: 'guardrails', explanation: `${mk} 는 hard_block` });
    else if (softM.has(norm(mk))) out.push({ constraint_code: 'mood_soft_block', label: `주의 Mood(${mk})`, severity: 'soft', result: 'warning', current_value: mk, allowed_value: '주의', source: 'guardrails', explanation: `${mk} 는 soft_block` });
  }
  return out;
}

export function summarizeConstraints(checks: ConstraintCheck[]): { hardPass: boolean; hardFails: number; softWarnings: number; unsupported: number } {
  let hardFails = 0; let softWarnings = 0; let unsupported = 0;
  for (const c of checks) {
    if (c.result === 'fail' && c.severity === 'hard') hardFails++;
    else if (c.result === 'warning') softWarnings++;
    else if (c.result === 'unsupported' || c.result === 'insufficient_data') unsupported++;
  }
  return { hardPass: hardFails === 0, hardFails, softWarnings, unsupported };
}

/* ── 7) Scenario 프리셋(명시적 Parameter) ──────────────────────────────── */
export type ScenarioKind = 'conservative' | 'balanced' | 'aggressive' | 'custom';
export interface ScenarioParams {
  kind: ScenarioKind; maxChangeRatio: number; minConfidence: number; maxRisk: number; gainWeight: number; riskWeight: number;
}
export const SCENARIO_PRESETS: Record<Exclude<ScenarioKind, 'custom'>, ScenarioParams> = {
  conservative: { kind: 'conservative', maxChangeRatio: 0.15, minConfidence: 60, maxRisk: 35, gainWeight: 0.4, riskWeight: 0.6 },
  balanced: { kind: 'balanced', maxChangeRatio: 0.35, minConfidence: 40, maxRisk: 55, gainWeight: 0.5, riskWeight: 0.5 },
  aggressive: { kind: 'aggressive', maxChangeRatio: 0.6, minConfidence: 25, maxRisk: 75, gainWeight: 0.7, riskWeight: 0.3 },
};

/* ── 25) Business Objective ─────────────────────────────────────────────── */
export type Objective = 'maximize_completion' | 'minimize_skip' | 'maximize_listening' | 'maximize_health' | 'maximize_diversity' | 'maximize_new_track_exposure' | 'balanced';
export const OBJECTIVE_WEIGHTS: Record<Objective, Partial<Record<keyof ExpectedGain | 'diversity' | 'exposure', number>>> = {
  maximize_completion: { completion: 1 }, minimize_skip: { skip: 1 }, maximize_listening: { listening: 1 },
  maximize_health: { health: 1 }, maximize_diversity: { diversity: 1 }, maximize_new_track_exposure: { exposure: 1 },
  balanced: { completion: 0.4, skip: 0.3, health: 0.2, listening: 0.1 },
};

/* ── 26) Resource Budget ────────────────────────────────────────────────── */
export interface ResourceBudget {
  maxChangedTracks?: number | null; maxChangedPlaylists?: number | null; maxCost?: number | null; maxRisk?: number | null;
  maxPlaylistChangeRatio?: number | null; maxGenreRatioChange?: number | null; maxMoodRatioChange?: number | null;
}
export function withinBudget(strategy: Strategy, budget: ResourceBudget): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  if (isNum(budget.maxCost) && strategy.cost.score > budget.maxCost) v.push(`Cost ${strategy.cost.score} > ${budget.maxCost}`);
  if (isNum(budget.maxRisk) && strategy.risk.score > budget.maxRisk) v.push(`Risk ${strategy.risk.score} > ${budget.maxRisk}`);
  return { ok: v.length === 0, violations: v };
}

/* ── 14) Regression Validation(Threshold 설정 가능) ─────────────────────── */
export interface RegressionThresholds { completion: number; skip: number; listening: number; health: number; diversity: number }
export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholds = { completion: -2, skip: 2, listening: -5, health: -3, diversity: -5 };
export interface RegressionCheck { key: string; label: string; delta: number | null; threshold: number; result: 'pass' | 'fail' | 'insufficient_data' }
export interface KpiSet { completion: number | null; skip: number | null; listening: number | null; health: number | null; diversity: number | null }

/** delta(after-before)가 Threshold 를 넘어 악화되면 fail. skip 은 상승이 악화. */
export function regressionValidation(before: KpiSet, after: KpiSet, th: RegressionThresholds = DEFAULT_REGRESSION_THRESHOLDS): RegressionCheck[] {
  const mk = (key: keyof KpiSet, label: string, threshold: number, higherBetter: boolean): RegressionCheck => {
    const b = before[key]; const a = after[key];
    if (!isNum(b) || !isNum(a)) return { key, label, delta: null, threshold, result: 'insufficient_data' };
    const delta = round1(a - b);
    // higherBetter: delta < threshold(음수) → fail. skip(!higherBetter): delta > threshold(양수) → fail.
    const fail = higherBetter ? delta < threshold : delta > threshold;
    return { key, label, delta, threshold, result: fail ? 'fail' : 'pass' };
  };
  return [
    mk('completion', '완주율 회귀', th.completion, true),
    mk('skip', 'Skip 회귀', th.skip, false),
    mk('listening', '청취 회귀', th.listening, true),
    mk('health', 'Health 회귀', th.health, true),
    mk('diversity', 'Diversity 회귀', th.diversity, true),
  ];
}
export function regressionSafe(checks: RegressionCheck[]): boolean { return !checks.some((c) => c.result === 'fail'); }

/* ── 15) Safety Score ───────────────────────────────────────────────────── */
export interface SafetyInput {
  hardPass: boolean; softWarnings: number; softTotal: number; regressionSafe: boolean; confidence: number;
  metadataCoverage?: number | null; sample: number; driftScore?: number | null; historicalSuccessRate?: number | null;
}
export function safetyScore(inp: SafetyInput): number {
  const comps: Array<{ v: number; w: number; present: boolean }> = [
    { v: inp.hardPass ? 100 : 0, w: 0.25, present: true },
    { v: inp.softTotal > 0 ? clamp100((1 - inp.softWarnings / inp.softTotal) * 100) : 100, w: 0.15, present: true },
    { v: inp.regressionSafe ? 100 : 0, w: 0.2, present: true },
    { v: clamp100(inp.confidence), w: 0.15, present: isNum(inp.confidence) },
    { v: clamp100(inp.metadataCoverage ?? 0), w: 0.1, present: isNum(inp.metadataCoverage) },
    { v: clamp100(clamp01(inp.sample / 200) * 100), w: 0.1, present: true },
    { v: isNum(inp.driftScore) ? clamp100(100 - inp.driftScore) : 70, w: 0.05, present: true },
    { v: clamp100(inp.historicalSuccessRate ?? 60), w: 0.05, present: isNum(inp.historicalSuccessRate) },
  ];
  const present = comps.filter((c) => c.present);
  const wsum = present.reduce((a, c) => a + c.w, 0);
  return wsum > 0 ? clamp100(present.reduce((a, c) => a + c.v * c.w, 0) / wsum) : 0;
}

/* ── 16) Benefit Score(Confidence 낮으면 보수적 할인) ───────────────────── */
export function benefitScore(gain: ExpectedGain, diversityGain: number, roi: number, confidence: number): number {
  const raw = Math.max(0, gain.completion) + Math.max(0, -gain.skip) + Math.max(0, gain.health) + Math.max(0, gain.listening) * 0.1 + Math.max(0, diversityGain) * 0.3;
  const gainNorm = clamp100(clamp01(raw / 20) * 100);
  const base = clamp100(gainNorm * 0.6 + clamp100(roi) * 0.4);
  const discount = 0.5 + 0.5 * clamp01(confidence / 100); // confidence 낮으면 최대 50% 할인
  return clamp100(base * discount);
}

/* ── 17) Validation Decision ────────────────────────────────────────────── */
export type Decision = 'go' | 'review_required' | 'reject' | 'insufficient_data' | 'failed';
export interface DecisionInput {
  sample: number; baselineAvailable: boolean; hardPass: boolean; hardFails: number; softWarnings: number;
  regressionSafe: boolean; safety: number; benefit: number; conflicts: number; missingDependency: boolean; evidenceComplete: boolean;
}
export function validationDecision(inp: DecisionInput): { decision: Decision; reasons: string[] } {
  const reasons: string[] = [];
  if (inp.sample < MIN_EVENTS || !inp.baselineAvailable) { reasons.push('Sample/Baseline 부족'); return { decision: 'insufficient_data', reasons }; }
  if (!inp.evidenceComplete) { reasons.push('Evidence 불완전'); return { decision: 'reject', reasons }; }
  if (!inp.hardPass || inp.hardFails > 0) { reasons.push(`Hard Constraint ${inp.hardFails}건 위반`); return { decision: 'reject', reasons }; }
  if (inp.conflicts > 0) { reasons.push('미해결 Conflict'); return { decision: 'reject', reasons }; }
  if (inp.missingDependency) { reasons.push('필수 Dependency 누락'); return { decision: 'reject', reasons }; }
  if (!inp.regressionSafe) { reasons.push('심각한 Regression 예상'); return { decision: 'review_required', reasons }; }
  if (inp.softWarnings > 0 || inp.safety < 60 || inp.benefit < 20) {
    if (inp.softWarnings > 0) reasons.push(`Soft Warning ${inp.softWarnings}건`);
    if (inp.safety < 60) reasons.push(`Safety ${inp.safety}`);
    if (inp.benefit < 20) reasons.push('예상 Benefit 미미');
    return { decision: 'review_required', reasons };
  }
  reasons.push('Hard Pass · Regression 안전 · Safety/Benefit 충족');
  return { decision: 'go', reasons };
}

/* ── 9/10/11) Candidate Snapshots(구조 diff — 실제 변경 없음) ───────────── */
export interface PlaylistCandidate {
  base_playlist: string | null; add: string[]; remove: string[]; replace: Array<{ out: string; in: string }>;
  before_genre_mix: Array<{ key: string; share: number }>; after_genre_mix: Array<{ key: string; share: number }>;
  track_count_before: number; track_count_after: number; policy_violation: boolean;
}
export function candidatePlaylistSnapshot(strategy: Strategy, base: ContextSummary, genres: GenreMoodRow[], hardFail: boolean): PlaylistCandidate {
  const known = genres.filter((g) => !g.is_unknown);
  const tot = known.reduce((a, g) => a + g.events, 0) || 1;
  const beforeMix = known.map((g) => ({ key: g.key, share: round1((g.events / tot) * 100) }));
  const add = strategy.type === 'track_promotion' && strategy.target ? [strategy.target] : [];
  const remove = strategy.type === 'track_demotion' && strategy.target ? [strategy.target] : [];
  const replace = strategy.type === 'track_replacement' && strategy.target?.includes('↔') ? [{ out: strategy.target.split('↔')[0], in: strategy.target.split('↔')[1] }] : [];
  return {
    base_playlist: strategy.target, add, remove, replace,
    before_genre_mix: beforeMix, after_genre_mix: beforeMix, // genre_ratio 는 별도 mix 시뮬에서
    track_count_before: base.track_count, track_count_after: base.track_count + add.length - remove.length,
    policy_violation: hardFail,
  };
}
export interface RotationCandidate { current_interval: number | null; proposed_interval: number | null; expected_repeat_freq: number | null; expected_unique_ratio: number | null; min_interval_violation: boolean }
export function candidateRotationSnapshot(currentInterval: number | null, proposed: number | null, minInterval = 3): RotationCandidate {
  return {
    current_interval: currentInterval, proposed_interval: proposed,
    expected_repeat_freq: isNum(proposed) && proposed > 0 ? round1(1 / proposed) : null,
    expected_unique_ratio: isNum(proposed) ? clamp01(proposed / 20) : null,
    min_interval_violation: isNum(proposed) ? proposed < minInterval : false,
  };
}
export interface RolloutCandidate { current_stage: string | null; proposed_stage: string | null; current_sample: number; expected_added_sample: number | null; policy_violation: boolean }
const STAGE_ORDER = ['draft', 'test_pool', 'pilot', 'limited', 'expanded', 'global', 'archived'];
export function candidateRolloutSnapshot(strategy: Strategy, currentStage: string | null, sample: number): RolloutCandidate {
  const idx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;
  const proposed = strategy.type === 'test_pool_expand' ? STAGE_ORDER[Math.min(STAGE_ORDER.length - 2, idx + 1)] ?? null
    : strategy.type === 'test_pool_reduce' ? STAGE_ORDER[Math.max(0, idx - 1)] ?? null : currentStage;
  return { current_stage: currentStage, proposed_stage: proposed, current_sample: sample, expected_added_sample: strategy.type === 'test_pool_expand' ? Math.round(sample * 0.3) : null, policy_violation: false };
}

/* ── 12) Baseline 선택(Fallback 체인) ───────────────────────────────────── */
export type BaselineKind = 'current' | 'prior_period' | 'parent_context' | 'similar_context' | 'global';
export interface BaselineChoice { kind: BaselineKind; kpis: KpiSet; fallbackUsed: boolean; note: string }
export function selectBaseline(current: KpiSet | null, priorPeriod: KpiSet | null, global: KpiSet | null): BaselineChoice {
  if (current && isNum(current.completion)) return { kind: 'current', kpis: current, fallbackUsed: false, note: '현재 Context' };
  if (priorPeriod && isNum(priorPeriod.completion)) return { kind: 'prior_period', kpis: priorPeriod, fallbackUsed: true, note: '이전 기간 fallback' };
  if (global && isNum(global.completion)) return { kind: 'global', kpis: global, fallbackUsed: true, note: '전체 평균 fallback' };
  return { kind: 'global', kpis: { completion: null, skip: null, listening: null, health: null, diversity: null }, fallbackUsed: true, note: 'Baseline 없음' };
}

/* ── 8/13) Sandbox Scenario Run(핵심) ───────────────────────────────────── */
export interface SandboxScenarioResult {
  scenario: ScenarioKind; baseline_kpis: KpiSet; predicted_kpis: KpiSet; delta_kpis: KpiSet;
  confidence: number; safety_score: number; benefit_score: number; roi_score: number; risk_score: number; cost_score: number;
  hard_constraint_pass: boolean; soft_constraint_warnings: number; conflict_count: number; dependency_count: number;
  changed_track_count: number; changed_playlist_count: number; fallback_used: boolean;
  regression: RegressionCheck[]; constraints: ConstraintCheck[]; decision: Decision; decisionReasons: string[]; evidence: EvidenceItem[];
}

export interface SandboxRunInput {
  strategies: Strategy[]; summary: ContextSummary; genres: GenreMoodRow[]; moods: GenreMoodRow[];
  guardrails: GuardrailSource; confidence: number; driftScore?: number | null; metadataCoverage?: number | null;
  historicalSuccessRate?: number | null; baseline: BaselineChoice; scenario: ScenarioParams;
  contextKey: string; objective: Objective; thresholds?: RegressionThresholds; budget?: ResourceBudget;
}

/** 한 Scenario 에 대해 전체 Sandbox 파이프라인 실행(Constraint→Sim→Regression→Safety/Benefit→Decision). */
export function runSandboxScenario(inp: SandboxRunInput): SandboxScenarioResult {
  const { strategies, summary, genres, moods, guardrails, scenario } = inp;
  const conflicts = detectConflicts(strategies);
  const deps = dependencyGraph(strategies).filter((d) => d.present);
  const missingDependency = dependencyGraph(strategies).some((d) => d.present === false && strategies.some((s) => s.type === d.to));

  // 제약 검증(대표 전략 + 각 전략 대상 Guardrail).
  const allConstraints: ConstraintCheck[] = evaluateConstraints(summary, guardrails, { confidence: inp.confidence, driftScore: inp.driftScore, conflicts: conflicts.length, missingDependency });
  for (const st of strategies) {
    allConstraints.push(...evaluateTargetGuardrails(st, genres, moods, guardrails));
  }
  // 중복 constraint_code 제거(최악 결과 우선).
  const dedup = dedupeConstraints(allConstraints);
  const cs = summarizeConstraints(dedup);

  // Multi-Strategy 예상 효과(수확체감 재사용).
  const multi = multiStrategySimulation(strategies);
  const bc = clampPct(summary.completion_rate); const bs = clampPct(summary.skip_rate);
  const baseHealth = computeContextHealth(summary).score;
  const predicted: KpiSet = {
    completion: isNum(bc) ? clamp100(bc + multi.combined.completion) : null,
    skip: isNum(bs) ? clamp100(bs + multi.combined.skip) : null,
    listening: isNum(summary.avg_listen_seconds) ? Math.max(0, round1(summary.avg_listen_seconds + multi.combined.listening)) : null,
    health: clamp100(baseHealth + multi.combined.health),
    diversity: inp.baseline.kpis.diversity,
  };
  const baseline = inp.baseline.kpis;
  const delta: KpiSet = {
    completion: isNum(predicted.completion) && isNum(baseline.completion) ? round1(predicted.completion - baseline.completion) : null,
    skip: isNum(predicted.skip) && isNum(baseline.skip) ? round1(predicted.skip - baseline.skip) : null,
    listening: isNum(predicted.listening) && isNum(baseline.listening) ? round1(predicted.listening - baseline.listening) : null,
    health: isNum(predicted.health) && isNum(baseline.health) ? round1(predicted.health - baseline.health) : null,
    diversity: null,
  };
  const regression = regressionValidation(baseline, predicted, inp.thresholds);
  const regSafe = regressionSafe(regression);

  const roi = strategies.length ? clamp100(strategies.reduce((a, s) => a + s.roi, 0) / strategies.length) : 0;
  const cost = strategies.length ? clamp100(strategies.reduce((a, s) => a + s.cost.score, 0) / strategies.length) : 0;
  const risk = strategies.length ? clamp100(strategies.reduce((a, s) => a + s.risk.score, 0) / strategies.length) : 0;
  const safety = safetyScore({ hardPass: cs.hardPass, softWarnings: cs.softWarnings, softTotal: dedup.filter((c) => c.severity === 'soft').length, regressionSafe: regSafe, confidence: inp.confidence, metadataCoverage: inp.metadataCoverage, sample: summary.events, driftScore: inp.driftScore, historicalSuccessRate: inp.historicalSuccessRate });
  const benefit = benefitScore(multi.combined, 0, roi, inp.confidence);
  const evidenceComplete = strategies.every((s) => s.evidence.length > 0) && !!inp.contextKey;
  const decision = validationDecision({
    sample: summary.events, baselineAvailable: isNum(baseline.completion), hardPass: cs.hardPass, hardFails: cs.hardFails,
    softWarnings: cs.softWarnings, regressionSafe: regSafe, safety, benefit, conflicts: conflicts.length, missingDependency, evidenceComplete,
  });

  const changedTracks = strategies.filter((s) => ['track_promotion', 'track_demotion', 'track_replacement'].includes(s.type)).length;
  const changedPlaylists = strategies.filter((s) => s.type === 'playlist_refresh').length;

  return {
    scenario: scenario.kind, baseline_kpis: baseline, predicted_kpis: predicted, delta_kpis: delta,
    confidence: clamp100(inp.confidence), safety_score: safety, benefit_score: benefit, roi_score: roi, risk_score: risk, cost_score: cost,
    hard_constraint_pass: cs.hardPass, soft_constraint_warnings: cs.softWarnings, conflict_count: conflicts.length, dependency_count: deps.length,
    changed_track_count: changedTracks, changed_playlist_count: changedPlaylists, fallback_used: inp.baseline.fallbackUsed,
    regression, constraints: dedup, decision: decision.decision, decisionReasons: decision.reasons,
    evidence: buildEvidenceChain(inp, { safety, benefit, roi, risk, cost, decision: decision.decision, hardPass: cs.hardPass }),
  };
}

function dedupeConstraints(checks: ConstraintCheck[]): ConstraintCheck[] {
  const rank: Record<ConstraintResult, number> = { fail: 4, warning: 3, insufficient_data: 2, unsupported: 1, pass: 0 };
  const map = new Map<string, ConstraintCheck>();
  for (const c of checks) {
    const prev = map.get(c.constraint_code);
    if (!prev || rank[c.result] > rank[prev.result]) map.set(c.constraint_code, c);
  }
  return [...map.values()];
}

/* ── 18) Evidence Chain ─────────────────────────────────────────────────── */
export function buildEvidenceChain(inp: SandboxRunInput, res: { safety: number; benefit: number; roi: number; risk: number; cost: number; decision: Decision; hardPass: boolean }): EvidenceItem[] {
  return [
    { label: 'Context', value: inp.contextKey }, { label: 'Strategy 수', value: inp.strategies.length },
    { label: 'Strategy Types', value: inp.strategies.map((s) => STRATEGY_LABEL[s.type]).join(', ') },
    { label: 'Objective', value: inp.objective }, { label: 'Scenario', value: inp.scenario.kind },
    { label: 'Baseline', value: `${inp.baseline.kind}${inp.baseline.fallbackUsed ? '(fallback)' : ''}` },
    { label: 'Sample', value: inp.summary.events }, { label: 'Confidence', value: clamp100(inp.confidence) },
    { label: 'Drift', value: inp.driftScore ?? null }, { label: 'Safety', value: res.safety }, { label: 'Benefit', value: res.benefit },
    { label: 'ROI', value: res.roi }, { label: 'Risk', value: res.risk }, { label: 'Cost', value: res.cost },
    { label: 'Hard Pass', value: res.hardPass }, { label: 'Decision', value: res.decision },
    { label: 'Source', value: 'admin_sandbox_create' }, { label: 'Version', value: MODEL_VERSION },
  ];
}

/* ── 27) Strategy Portfolio ─────────────────────────────────────────────── */
export interface PortfolioResult {
  selected: Strategy[]; excluded: Array<{ strategy: Strategy; reason: string }>;
  total_cost: number; total_risk: number; expected_gain: number; portfolio_confidence: number;
}
export function buildPortfolio(strategies: Strategy[], budget: { costBudget: number; riskBudget: number; maxPerType?: number }): PortfolioResult {
  const ranked = [...strategies].sort((a, b) => b.roi - a.roi);
  const selected: Strategy[] = []; const excluded: PortfolioResult['excluded'] = [];
  let cost = 0; let risk = 0; const typeCount: Record<string, number> = {}; const targets = new Set<string>();
  for (const s of ranked) {
    const reason: string[] = [];
    if (cost + s.cost.score > budget.costBudget) reason.push('Cost Budget 초과');
    if (risk + s.risk.score > budget.riskBudget) reason.push('Risk Budget 초과');
    if (budget.maxPerType && (typeCount[s.type] ?? 0) >= budget.maxPerType) reason.push('Type 편중 제한');
    if (s.target && targets.has(s.target)) reason.push('대상 중복');
    if (reason.length) { excluded.push({ strategy: s, reason: reason.join(', ') }); continue; }
    selected.push(s); cost += s.cost.score; risk += s.risk.score; typeCount[s.type] = (typeCount[s.type] ?? 0) + 1; if (s.target) targets.add(s.target);
  }
  const gain = selected.reduce((a, s) => a + Math.max(0, s.expected.completion), 0);
  const conf = selected.length ? clamp100(selected.reduce((a, s) => a + s.confidence, 0) / selected.length) : 0;
  return { selected, excluded, total_cost: clamp100(cost), total_risk: clamp100(risk), expected_gain: round1(gain), portfolio_confidence: conf };
}

/* ── 28) Pareto Frontier(Gain↑ Risk↓ Cost↓ Confidence↑) ─────────────────── */
export interface ParetoPoint { id: string; label: string; gain: number; risk: number; cost: number; confidence: number; dominated: boolean }
export function paretoFrontier(points: Array<{ id: string; label: string; gain: number; risk: number; cost: number; confidence: number }>): ParetoPoint[] {
  const dominates = (a: typeof points[0], b: typeof points[0]) =>
    a.gain >= b.gain && a.risk <= b.risk && a.cost <= b.cost && a.confidence >= b.confidence &&
    (a.gain > b.gain || a.risk < b.risk || a.cost < b.cost || a.confidence > b.confidence);
  return points.map((p) => ({ ...p, dominated: points.some((q) => q !== p && dominates(q, p)) }));
}

/* ── 20) Sandbox Comparison(최대 3개, Winner 단정 없음) ─────────────────── */
export interface CompareRunInput { id: string; label: string; result: Pick<SandboxScenarioResult, 'delta_kpis' | 'risk_score' | 'cost_score' | 'roi_score' | 'safety_score' | 'benefit_score' | 'confidence' | 'soft_constraint_warnings' | 'decision'> }
export interface CompareRow { metric: string; values: Array<number | string | null>; note: string }
export function compareRuns(runs: CompareRunInput[]): { runs: string[]; rows: CompareRow[] } {
  const labels = runs.map((r) => r.label);
  const num = (fn: (r: CompareRunInput) => number | null, higherBetter: boolean, metric: string): CompareRow => {
    const vals = runs.map(fn);
    const nums = vals.filter(isNum);
    let note = '동등/판정 불가';
    if (nums.length >= 2) { const best = higherBetter ? Math.max(...nums) : Math.min(...nums); const idx = vals.findIndex((v) => v === best); if (idx >= 0) note = `${labels[idx]} ${higherBetter ? '우세' : '유리'}`; }
    return { metric, values: vals, note };
  };
  return { runs: labels, rows: [
    num((r) => r.result.delta_kpis.completion, true, '완주율 Gain'),
    num((r) => r.result.delta_kpis.skip, false, 'Skip 변화'),
    num((r) => r.result.roi_score, true, 'ROI'),
    num((r) => r.result.risk_score, false, 'Risk'),
    num((r) => r.result.cost_score, false, 'Cost'),
    num((r) => r.result.safety_score, true, 'Safety'),
    num((r) => r.result.benefit_score, true, 'Benefit'),
    num((r) => r.result.confidence, true, 'Confidence'),
    { metric: 'Decision', values: runs.map((r) => r.result.decision), note: '항목별 비교(단정 없음)' },
  ] };
}

/* ── 21) Expiration ─────────────────────────────────────────────────────── */
export interface ExpirationInput { inputHash: string; currentHash: string; modelVersion: string; currentVersion: string; ageDays: number; maxAgeDays?: number }
export function isExpired(inp: ExpirationInput): { expired: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (inp.inputHash !== inp.currentHash) reasons.push('Input Context/정책 변경');
  if (inp.modelVersion !== inp.currentVersion) reasons.push('계산 버전 변경');
  if (isNum(inp.ageDays) && inp.ageDays > (inp.maxAgeDays ?? 14)) reasons.push(`경과 ${inp.ageDays}일`);
  return { expired: reasons.length > 0, reasons };
}

/** Input Snapshot 해시(결정적 · 재현/Replay 비교용). 순서 안정. */
export function inputHash(parts: { contextKey: string; strategyIds: string[]; scenario: string; objective: string; sample: number }): string {
  const s = `${parts.contextKey}|${[...parts.strategyIds].sort().join(',')}|${parts.scenario}|${parts.objective}|${parts.sample}`;
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return `h${(h >>> 0).toString(16)}`;
}

/* ── 38) Data Sufficiency ───────────────────────────────────────────────── */
export type SufficiencyTier = 'insufficient' | 'review' | 'medium' | 'ok';
export function sufficiencyTier(sample: number): SufficiencyTier {
  if (!isNum(sample) || sample < 20) return 'insufficient';
  if (sample < 50) return 'review';
  if (sample < 200) return 'medium';
  return 'ok';
}

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const DECISION_LABEL: Record<Decision, string> = { go: 'Go', review_required: 'Review 필요', reject: 'Reject', insufficient_data: '데이터 부족', failed: '실패' };
export const DECISION_TONE: Record<Decision, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { go: 'success', review_required: 'warning', reject: 'danger', insufficient_data: 'neutral', failed: 'danger' };
export const CONSTRAINT_RESULT_TONE: Record<ConstraintResult, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { pass: 'success', warning: 'warning', fail: 'danger', unsupported: 'neutral', insufficient_data: 'info' };
export const REVIEW_STATUS_LABEL: Record<string, string> = { not_reviewed: '미검토', reviewing: '검토중', approval_candidate: '승인 후보', rejected: '기각' };
export const REVIEW_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = { not_reviewed: 'neutral', reviewing: 'info', approval_candidate: 'success', rejected: 'danger' };
export const CONSTRAINT_SUPPORT_TONE: Record<ConstraintSupportStatus, 'success' | 'warning' | 'danger' | 'info'> = { supported: 'success', validation_only: 'info', unsupported: 'danger', insufficient_data: 'warning' };
export function safetyTone(score: number): 'success' | 'warning' | 'danger' { return score >= 70 ? 'success' : score >= 45 ? 'warning' : 'danger'; }
export function benefitTone(score: number): 'success' | 'warning' | 'neutral' { return score >= 50 ? 'success' : score >= 20 ? 'warning' : 'neutral'; }
export function sandboxAllowed(sample: number): boolean { return isNum(sample) && sample >= MIN_EVENTS; }
