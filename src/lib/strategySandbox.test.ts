// Phase AI-MUSIC-6 — Autonomous Strategy Sandbox & Validation 순수 로직 단위 테스트.
// Constraint(실제 Guardrail hard/soft/미지원) · Scenario · Regression · Safety/Benefit · Decision ·
// Candidate Snapshot · Baseline fallback · Portfolio · Pareto · Comparison · Expiration · Replay ·
// Sample gate · 0~100 clamp · NaN 금지 · Evidence.
import { describe, it, expect } from 'vitest';
import {
  evaluateConstraints, evaluateTargetGuardrails, summarizeConstraints,
  regressionValidation, regressionSafe, safetyScore, benefitScore, validationDecision,
  candidatePlaylistSnapshot, candidateRotationSnapshot, candidateRolloutSnapshot,
  selectBaseline, runSandboxScenario, buildPortfolio, paretoFrontier, compareRuns,
  isExpired, inputHash, sufficiencyTier, sandboxAllowed, strategySupport,
  SCENARIO_PRESETS, CONSTRAINT_SUPPORT, SANDBOX_STRATEGY_SUPPORT, DECISION_LABEL,
  type GuardrailSource, type KpiSet, type SandboxRunInput, type BaselineChoice, type CompareRunInput,
} from './strategySandbox';
import type { ContextSummary, GenreMoodRow } from './contextIntel';
import { generateStrategies, computeStrategyRisk, COST_MODEL, type Strategy, type StrategyType, STRATEGY_LABEL } from './optimizationStrategy';
import type { ItemKpi } from './predictiveIntel';

const summary = (over: Partial<ContextSummary> = {}): ContextSummary => ({
  events: 300, track_count: 15, playlist_count: 2, genre_count: 6, mood_count: 5,
  unknown_genre_events: 0, completion_rate: 72, skip_rate: 10, avg_listen_seconds: 100,
  likes: 2, replays: 3, last_event_at: '2026-07-10T00:00:00Z', days_since_last: 20, ...over,
});
const genres: GenreMoodRow[] = [
  { key: 'Lo-fi', is_unknown: false, events: 80, completion_rate: 88, skip_rate: 3 },
  { key: 'Rock', is_unknown: false, events: 40, completion_rate: 60, skip_rate: 12 },
];
const moods: GenreMoodRow[] = [{ key: '차분한', is_unknown: false, events: 70, completion_rate: 85, skip_rate: 4 }];
const guardrails: GuardrailSource = {
  store_type: 'cafe',
  genre_guardrails: [{ genre: 'Metal', severity: 'hard' }, { genre: 'Jazz', severity: 'bonus', score_delta: 10 }],
  store_guardrails: [
    { rule_type: 'genre', rule_key: 'banned_genre', value: 'rock', severity: 'soft' },
    { rule_type: 'genre', rule_key: 'banned_genre', value: 'edm', severity: 'hard' },
    { rule_type: 'numeric', rule_key: 'max_bpm', value: '150', severity: 'hard' },
  ],
};

function mkStrategy(type: StrategyType, over: Partial<Strategy> = {}): Strategy {
  return {
    id: `${type}:x`, type, target: 'X', label: STRATEGY_LABEL[type],
    expected: { completion: 3, skip: -2, listening: 5, health: 2 }, confidence: 70, sample: 300,
    cost: COST_MODEL[type], risk: computeStrategyRisk({ confidence: 70, sample: 300 }), roi: 55,
    evidence: [{ label: 'x', value: 1 }], ...over,
  };
}
const strategies = (): Strategy[] => generateStrategies({
  summary: summary(), tracks: [
    { key: 't1', label: 'Best', events: 50, completion_rate: 92, skip_rate: 2 },
    { key: 't2', label: 'Worst', events: 40, completion_rate: 38, skip_rate: 35 },
  ] as ItemKpi[],
  playlists: [{ key: 'p1', label: 'Weak', events: 60, completion_rate: 58, skip_rate: 15 }] as ItemKpi[],
  genres, moods, confidence: 70, driftScore: 20, metadataCoverage: 90, historicalFailureRate: 20, daysSinceLast: 20,
});

describe('Constraint Engine — 실제 Guardrail hard/soft/미지원', () => {
  it('Sample/Confidence/Drift/Conflict/Dependency + numeric 미지원', () => {
    const checks = evaluateConstraints(summary(), guardrails, { confidence: 70, driftScore: 20, conflicts: 0, missingDependency: false });
    expect(checks.find((c) => c.constraint_code === 'sample_min')!.result).toBe('pass');
    expect(checks.find((c) => c.constraint_code === 'numeric_guardrail')!.result).toBe('unsupported');
  });
  it('표본 부족 → sample_min fail', () => {
    expect(evaluateConstraints(summary({ events: 10 }), guardrails, { confidence: 70 }).find((c) => c.constraint_code === 'sample_min')!.result).toBe('fail');
  });
  it('Conflict 있으면 hard fail', () => {
    expect(evaluateConstraints(summary(), guardrails, { confidence: 70, conflicts: 2 }).find((c) => c.constraint_code === 'strategy_conflict')!.result).toBe('fail');
  });
  it('대상 Guardrail: hard-block genre → fail, soft → warning', () => {
    // genre_ratio 대상은 완주율>=50 장르(Lo-fi, Rock). Rock 은 soft_block(store_guardrails).
    const st = mkStrategy('genre_ratio', { target: null });
    const g2: GenreMoodRow[] = [{ key: 'Metal', is_unknown: false, events: 40, completion_rate: 60, skip_rate: 10 }, ...genres];
    const checks = evaluateTargetGuardrails(st, g2, moods, guardrails);
    expect(checks.some((c) => c.severity === 'hard' && c.result === 'fail')).toBe(true); // Metal
    expect(checks.some((c) => c.severity === 'soft' && c.result === 'warning')).toBe(true); // Rock
  });
  it('summarizeConstraints hardPass 판정', () => {
    const s = summarizeConstraints([
      { constraint_code: 'a', label: '', severity: 'hard', result: 'pass', current_value: null, allowed_value: null, source: '', explanation: '' },
      { constraint_code: 'b', label: '', severity: 'soft', result: 'warning', current_value: null, allowed_value: null, source: '', explanation: '' },
    ]);
    expect(s.hardPass).toBe(true); expect(s.softWarnings).toBe(1);
  });
});

describe('Regression Validation — Threshold 설정 가능', () => {
  const before: KpiSet = { completion: 80, skip: 6, listening: 100, health: 70, diversity: 50 };
  it('완주율 급락 → fail', () => {
    const after: KpiSet = { completion: 74, skip: 6, listening: 100, health: 70, diversity: 50 };
    expect(regressionSafe(regressionValidation(before, after))).toBe(false);
  });
  it('개선 → pass', () => {
    const after: KpiSet = { completion: 85, skip: 4, listening: 105, health: 74, diversity: 55 };
    expect(regressionSafe(regressionValidation(before, after))).toBe(true);
  });
  it('KPI 없음 → insufficient_data', () => {
    const after: KpiSet = { completion: null, skip: null, listening: null, health: null, diversity: null };
    expect(regressionValidation(before, after).every((c) => c.result === 'insufficient_data')).toBe(true);
  });
  it('커스텀 Threshold 반영', () => {
    const after: KpiSet = { completion: 79, skip: 6, listening: 100, health: 70, diversity: 50 };
    expect(regressionSafe(regressionValidation(before, after, { completion: -0.5, skip: 2, listening: -5, health: -3, diversity: -5 }))).toBe(false);
  });
});

describe('Safety / Benefit Score — 0~100·보수적 할인', () => {
  it('Hard Pass + 안전 → 높은 Safety', () => {
    expect(safetyScore({ hardPass: true, softWarnings: 0, softTotal: 2, regressionSafe: true, confidence: 80, metadataCoverage: 90, sample: 300 })).toBeGreaterThan(70);
  });
  it('Hard Fail → 낮은 Safety', () => {
    expect(safetyScore({ hardPass: false, softWarnings: 3, softTotal: 4, regressionSafe: false, confidence: 30, sample: 20 })).toBeLessThan(45);
  });
  it('Benefit: 낮은 confidence → 할인', () => {
    const g = { completion: 6, skip: -4, listening: 10, health: 4 };
    expect(benefitScore(g, 2, 60, 30)).toBeLessThan(benefitScore(g, 2, 60, 90));
  });
  it('Safety 0~100·NaN 없음', () => {
    const s = safetyScore({ hardPass: true, softWarnings: 0, softTotal: 0, regressionSafe: true, confidence: 50, sample: 100 });
    expect(Number.isFinite(s)).toBe(true); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(100);
  });
});

describe('Validation Decision', () => {
  const base = { sample: 300, baselineAvailable: true, hardPass: true, hardFails: 0, softWarnings: 0, regressionSafe: true, safety: 80, benefit: 50, conflicts: 0, missingDependency: false, evidenceComplete: true };
  it('go', () => { expect(validationDecision(base).decision).toBe('go'); });
  it('sample 부족 → insufficient_data', () => { expect(validationDecision({ ...base, sample: 10 }).decision).toBe('insufficient_data'); });
  it('hard fail → reject', () => { expect(validationDecision({ ...base, hardPass: false, hardFails: 1 }).decision).toBe('reject'); });
  it('conflict → reject', () => { expect(validationDecision({ ...base, conflicts: 1 }).decision).toBe('reject'); });
  it('regression 위험 → review_required', () => { expect(validationDecision({ ...base, regressionSafe: false }).decision).toBe('review_required'); });
  it('soft warning → review_required', () => { expect(validationDecision({ ...base, softWarnings: 2 }).decision).toBe('review_required'); });
  it('evidence 불완전 → reject', () => { expect(validationDecision({ ...base, evidenceComplete: false }).decision).toBe('reject'); });
});

describe('Candidate Snapshots — 구조 diff', () => {
  it('Playlist Candidate add/remove', () => {
    const c1 = candidatePlaylistSnapshot(mkStrategy('track_promotion', { target: 'SongA' }), summary(), genres, false);
    expect(c1.add).toContain('SongA'); expect(c1.track_count_after).toBe(summary().track_count + 1);
  });
  it('Rotation Candidate 최소간격 위반', () => {
    expect(candidateRotationSnapshot(10, 2, 3).min_interval_violation).toBe(true);
    expect(candidateRotationSnapshot(10, 5, 3).min_interval_violation).toBe(false);
  });
  it('Rollout Candidate 승격/축소 Stage', () => {
    expect(candidateRolloutSnapshot(mkStrategy('test_pool_expand'), 'pilot', 100).proposed_stage).toBe('limited');
    expect(candidateRolloutSnapshot(mkStrategy('test_pool_reduce'), 'limited', 100).proposed_stage).toBe('pilot');
  });
});

describe('Baseline 선택 — fallback 체인', () => {
  it('현재 우선', () => {
    const cur: KpiSet = { completion: 80, skip: 6, listening: 100, health: 70, diversity: 50 };
    expect(selectBaseline(cur, null, null).kind).toBe('current');
  });
  it('현재 없음 → prior fallback', () => {
    const prior: KpiSet = { completion: 75, skip: 8, listening: 90, health: 65, diversity: 45 };
    const b = selectBaseline(null, prior, null);
    expect(b.kind).toBe('prior_period'); expect(b.fallbackUsed).toBe(true);
  });
});

describe('runSandboxScenario — 통합 파이프라인', () => {
  const baseline: BaselineChoice = { kind: 'current', kpis: { completion: 72, skip: 10, listening: 100, health: 65, diversity: 50 }, fallbackUsed: false, note: '' };
  const mkInput = (over: Partial<SandboxRunInput> = {}): SandboxRunInput => ({
    strategies: strategies(), summary: summary(), genres, moods, guardrails, confidence: 70, driftScore: 20,
    metadataCoverage: 90, historicalSuccessRate: 60, baseline, scenario: SCENARIO_PRESETS.balanced,
    contextKey: 'store_type=cafe', objective: 'balanced', ...over,
  });
  it('정상 → decision + Evidence + 0~100 점수', () => {
    const r = runSandboxScenario(mkInput());
    expect(['go', 'review_required', 'reject']).toContain(r.decision);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const s of [r.safety_score, r.benefit_score, r.roi_score, r.risk_score, r.cost_score, r.confidence]) {
      expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(100);
    }
  });
  it('표본 부족 → insufficient_data', () => {
    const r = runSandboxScenario(mkInput({ summary: summary({ events: 10 }), strategies: [mkStrategy('genre_ratio')] }));
    expect(r.decision).toBe('insufficient_data');
  });
  it('Baseline 없음 → insufficient_data', () => {
    const noBase: BaselineChoice = { kind: 'global', kpis: { completion: null, skip: null, listening: null, health: null, diversity: null }, fallbackUsed: true, note: '' };
    expect(runSandboxScenario(mkInput({ baseline: noBase })).decision).toBe('insufficient_data');
  });
});

describe('Portfolio / Pareto / Comparison / Expiration', () => {
  it('Portfolio Budget 준수·초과 제외', () => {
    const st = [mkStrategy('genre_ratio', { id: 'a', roi: 90, cost: COST_MODEL.genre_ratio }), mkStrategy('playlist_refresh', { id: 'b', roi: 50, cost: COST_MODEL.playlist_refresh })];
    const p = buildPortfolio(st, { costBudget: 40, riskBudget: 100 });
    expect(p.selected.some((s) => s.id === 'a')).toBe(true);
    expect(p.excluded.some((e) => e.strategy.id === 'b')).toBe(true);
    expect(p.total_cost).toBeLessThanOrEqual(100);
  });
  it('Pareto 지배 판정', () => {
    const pts = paretoFrontier([
      { id: 'a', label: 'A', gain: 10, risk: 20, cost: 20, confidence: 80 },
      { id: 'b', label: 'B', gain: 5, risk: 30, cost: 30, confidence: 60 }, // dominated by a
    ]);
    expect(pts.find((p) => p.id === 'b')!.dominated).toBe(true);
    expect(pts.find((p) => p.id === 'a')!.dominated).toBe(false);
  });
  it('compareRuns Winner 단정 없음·항목별', () => {
    const r = (id: string, comp: number): CompareRunInput => ({ id, label: id, result: { delta_kpis: { completion: comp, skip: -2, listening: 5, health: 3, diversity: null }, risk_score: 30, cost_score: 40, roi_score: 55, safety_score: 70, benefit_score: 40, confidence: 70, soft_constraint_warnings: 0, decision: 'go' } });
    const c = compareRuns([r('A', 5), r('B', 8)]);
    expect(c.rows.find((x) => x.metric === '완주율 Gain')!.note).toContain('B');
  });
  it('Expiration: Input/버전 변경·경과', () => {
    expect(isExpired({ inputHash: 'h1', currentHash: 'h2', modelVersion: 'v1', currentVersion: 'v1', ageDays: 1 }).expired).toBe(true);
    expect(isExpired({ inputHash: 'h1', currentHash: 'h1', modelVersion: 'v1', currentVersion: 'v1', ageDays: 30 }).expired).toBe(true);
    expect(isExpired({ inputHash: 'h1', currentHash: 'h1', modelVersion: 'v1', currentVersion: 'v1', ageDays: 1 }).expired).toBe(false);
  });
  it('inputHash 결정적·순서 안정', () => {
    const a = inputHash({ contextKey: 'c', strategyIds: ['x', 'y'], scenario: 'balanced', objective: 'balanced', sample: 300 });
    const b = inputHash({ contextKey: 'c', strategyIds: ['y', 'x'], scenario: 'balanced', objective: 'balanced', sample: 300 });
    expect(a).toBe(b);
  });
});

describe('Support Matrix / 게이트', () => {
  it('Scenario 프리셋 명시적 Parameter', () => {
    expect(SCENARIO_PRESETS.conservative.maxChangeRatio).toBeLessThan(SCENARIO_PRESETS.aggressive.maxChangeRatio);
    expect(SCENARIO_PRESETS.conservative.minConfidence).toBeGreaterThan(SCENARIO_PRESETS.aggressive.minConfidence);
  });
  it('Constraint 미지원(numeric/vocal/brand)', () => {
    for (const k of ['numeric', 'vocal', 'brand_policy']) expect(CONSTRAINT_SUPPORT.find((c) => c.key === k)!.status).toBe('unsupported');
  });
  it('Strategy Support 10종', () => {
    expect(SANDBOX_STRATEGY_SUPPORT.length).toBe(10);
    expect(strategySupport('genre_ratio')!.policy).toBe(true);
  });
  it('sufficiencyTier 경계', () => {
    expect(sufficiencyTier(10)).toBe('insufficient'); expect(sufficiencyTier(30)).toBe('review');
    expect(sufficiencyTier(100)).toBe('medium'); expect(sufficiencyTier(300)).toBe('ok');
  });
  it('sandboxAllowed·라벨', () => {
    expect(sandboxAllowed(10)).toBe(false); expect(sandboxAllowed(20)).toBe(true);
    expect(DECISION_LABEL.go).toBe('Go');
  });
});
