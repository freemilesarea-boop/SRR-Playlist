/**
 * optimizationStrategy — Autonomous Optimization Strategy 순수 로직 (Phase AI-MUSIC-5).
 *
 * Prediction 결과를 기반으로 Context 별 최적화 전략 후보를 생성·평가한다. 전략 제안·시뮬레이션 전용 —
 * 자동 Playlist/Scheduler/Queue/Playback/Recommendation/Weight/Rollout/Experiment 변경 없음.
 * 운영자 승인 후에만 이후 Phase 에서 사용 가능.
 *
 * 구성: Strategy Generator · Ranking · ROI · Cost · Risk · Multi-Strategy Simulation · Conflict ·
 *  Dependency Graph · Optimization Plan · Explainable Strategy.
 *
 * 원칙:
 *  - 기존 Context/Predictive KPI 정의 재사용(변경 금지). 미존재 KPI 생성 금지.
 *  - Sample 부족이면 Strategy/ROI/Simulation 생성 금지(gate).
 *  - ROI/Risk/Cost/Confidence 0~100 clamp · NaN/Infinity 금지.
 *  - 모든 전략에 Evidence 포함(Explainable). 자동 적용/실행 없음.
 */
import { clampPct, MIN_EVENTS } from './playlistIntel';
import { computeContextHealth, type ContextSummary, type GenreMoodRow } from './contextIntel';
import {
  simulateItemChange, simulateMix, predictRecoImpact, type ItemKpi, type MixTarget,
} from './predictiveIntel';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const round1 = (n: number) => Math.round(n * 10) / 10;

export type StrategyType =
  | 'playlist_refresh' | 'track_replacement' | 'track_promotion' | 'track_demotion'
  | 'genre_ratio' | 'mood_ratio' | 'rotation_interval' | 'rediscovery'
  | 'test_pool_expand' | 'test_pool_reduce';

export const STRATEGY_LABEL: Record<StrategyType, string> = {
  playlist_refresh: 'Playlist Refresh', track_replacement: 'Track Replacement', track_promotion: 'Track Promotion',
  track_demotion: 'Track Demotion', genre_ratio: 'Genre 비율 조정', mood_ratio: 'Mood 비율 조정',
  rotation_interval: 'Rotation 간격 조정', rediscovery: 'Rediscovery Campaign',
  test_pool_expand: 'Test Pool 확대', test_pool_reduce: 'Test Pool 축소',
};

export interface EvidenceItem { label: string; value: string | number | null }
export interface ExpectedGain { completion: number; skip: number; listening: number; health: number }

/* ── 4) Cost Model(실제 작업량 기준) ────────────────────────────────────── */
export type CostLevel = 'low' | 'medium' | 'high';
export const COST_MODEL: Record<StrategyType, { level: CostLevel; score: number }> = {
  genre_ratio: { level: 'low', score: 25 }, mood_ratio: { level: 'low', score: 25 },
  rotation_interval: { level: 'low', score: 30 }, rediscovery: { level: 'medium', score: 45 },
  track_promotion: { level: 'medium', score: 45 }, track_demotion: { level: 'medium', score: 45 },
  test_pool_expand: { level: 'medium', score: 55 }, test_pool_reduce: { level: 'medium', score: 50 },
  track_replacement: { level: 'high', score: 70 }, playlist_refresh: { level: 'high', score: 80 },
};
export const COST_LABEL: Record<CostLevel, string> = { low: '낮음', medium: '보통', high: '높음' };

/* ── 5) Risk Model ──────────────────────────────────────────────────────── */
export interface RiskInput {
  confidence: number; sample: number; driftScore?: number | null; metadataCoverage?: number | null; historicalFailureRate?: number | null;
}
export interface StrategyRisk { score: number; components: Array<{ key: string; label: string; value: number }> }
/** Prediction Uncertainty·Low Sample·High Drift·Metadata Coverage·Historical Failure → 0~100. */
export function computeStrategyRisk(inp: RiskInput): StrategyRisk {
  const uncertainty = clamp100(100 - (isNum(inp.confidence) ? inp.confidence : 0));
  const lowSample = clamp100(100 - clamp01((isNum(inp.sample) ? inp.sample : 0) / 200) * 100);
  const drift = clamp100(isNum(inp.driftScore) ? inp.driftScore : 30);
  const metaGap = clamp100(100 - (isNum(inp.metadataCoverage) ? inp.metadataCoverage : 80));
  const histFail = clamp100(isNum(inp.historicalFailureRate) ? inp.historicalFailureRate : 25);
  const components = [
    { key: 'uncertainty', label: '예측 불확실성', value: uncertainty, w: 0.3 },
    { key: 'sample', label: '표본 부족', value: lowSample, w: 0.25 },
    { key: 'drift', label: 'Drift', value: drift, w: 0.2 },
    { key: 'metadata', label: '메타 부족', value: metaGap, w: 0.1 },
    { key: 'history', label: '과거 실패', value: histFail, w: 0.15 },
  ];
  const score = clamp100(components.reduce((a, c) => a + c.value * c.w, 0));
  return { score, components: components.map((c) => ({ key: c.key, label: c.label, value: c.value })) };
}

/* ── 3) ROI Score ───────────────────────────────────────────────────────── */
export const ROI_WEIGHTS = { gain: 0.4, confidence: 0.25, costInv: 0.15, riskInv: 0.2 };
/** Expected Gain(정규화) · Confidence · Cost 역 · Risk 역 → 0~100. 존재 값만 사용. */
export function roiScore(gain: ExpectedGain, confidence: number, costScore: number, riskScore: number): number {
  // Gain 정규화: 완주율/청취 상승 + Skip 감소 + Health 상승 종합(pp 기준, 20pp 포화).
  const gainRaw = Math.max(0, gain.completion) + Math.max(0, -gain.skip) + Math.max(0, gain.health) + Math.max(0, gain.listening) * 0.1;
  const gainNorm = clamp100(clamp01(gainRaw / 20) * 100);
  const conf = clamp100(confidence);
  const costInv = clamp100(100 - clamp100(costScore));
  const riskInv = clamp100(100 - clamp100(riskScore));
  return clamp100(gainNorm * ROI_WEIGHTS.gain + conf * ROI_WEIGHTS.confidence + costInv * ROI_WEIGHTS.costInv + riskInv * ROI_WEIGHTS.riskInv);
}

/* ── Strategy 객체 ──────────────────────────────────────────────────────── */
export interface Strategy {
  id: string; type: StrategyType; target: string | null; label: string;
  expected: ExpectedGain; confidence: number; sample: number;
  cost: { level: CostLevel; score: number }; risk: StrategyRisk; roi: number;
  evidence: EvidenceItem[];
}

/* ── 1) Strategy Generator ──────────────────────────────────────────────────
 * ContextDetail(summary + tracks/playlists/genres/moods) + 예측 신호로 전략 후보 생성.
 * 예상 효과는 predictiveIntel 시뮬레이션 재사용. Sample 부족이면 전략 없음(gate).
 * ------------------------------------------------------------------------- */
export interface GenerateInput {
  summary: ContextSummary; tracks: ItemKpi[]; playlists: ItemKpi[]; genres: GenreMoodRow[]; moods: GenreMoodRow[];
  confidence: number; driftScore?: number | null; metadataCoverage?: number | null; historicalFailureRate?: number | null;
  daysSinceLast?: number | null; rolloutStages?: Record<string, number>;
}

function mkGain(completion = 0, skip = 0, listening = 0, health = 0): ExpectedGain {
  return { completion: round1(completion), skip: round1(skip), listening: round1(listening), health: round1(health) };
}
function recommendedMix(groups: GenreMoodRow[]): MixTarget[] {
  const known = groups.filter((g) => !g.is_unknown && g.events >= 5 && g.completion_rate != null);
  const weights = known.map((g) => ({ key: g.key, w: Math.max(1, (g.completion_rate ?? 0) - 50) }));
  const tot = weights.reduce((a, x) => a + x.w, 0) || 1;
  return weights.map((x) => ({ key: x.key, share: x.w / tot }));
}

export function generateStrategies(inp: GenerateInput): Strategy[] {
  const s = inp.summary;
  if (s.events < MIN_EVENTS) return [];
  const out: Strategy[] = [];
  const riskInp: RiskInput = { confidence: inp.confidence, sample: s.events, driftScore: inp.driftScore, metadataCoverage: inp.metadataCoverage, historicalFailureRate: inp.historicalFailureRate };
  const baseHealth = computeContextHealth(s).score;
  const push = (type: StrategyType, target: string | null, gain: ExpectedGain, extraEv: EvidenceItem[] = []) => {
    const cost = COST_MODEL[type]; const risk = computeStrategyRisk(riskInp);
    const roi = roiScore(gain, inp.confidence, cost.score, risk.score);
    out.push({
      id: `${type}:${target ?? '*'}`, type, target, label: STRATEGY_LABEL[type], expected: gain,
      confidence: clamp100(inp.confidence), sample: s.events, cost, risk, roi,
      evidence: [
        { label: 'Context 표본', value: s.events }, { label: 'Context 완주율', value: clampPct(s.completion_rate) },
        { label: 'Confidence', value: clamp100(inp.confidence) }, { label: 'Drift', value: inp.driftScore ?? null },
        { label: 'Cost', value: `${COST_LABEL[cost.level]}(${cost.score})` }, { label: 'Risk', value: risk.score },
        { label: 'Expected 완주율', value: gain.completion }, ...extraEv,
      ],
    });
  };

  // Track Promotion / Demotion / Replacement — 상/하위 Track 기준.
  const scoredTracks = [...inp.tracks].filter((t) => t.events >= 5 && t.completion_rate != null);
  const best = [...scoredTracks].sort((a, b) => (b.completion_rate ?? 0) - (a.completion_rate ?? 0))[0];
  const worst = [...scoredTracks].sort((a, b) => (a.completion_rate ?? 0) - (b.completion_rate ?? 0))[0];
  if (best && (clampPct(best.completion_rate) ?? 0) >= 75) {
    const sim = simulateItemChange(s, 'add', best);
    if (!sim.insufficient) push('track_promotion', best.label, mkGain(sim.delta.completion ?? 0, sim.delta.skip ?? 0), [{ label: '대상 Track', value: best.label }]);
  }
  if (worst && (clampPct(worst.completion_rate) ?? 100) < 50) {
    const sim = simulateItemChange(s, 'remove', worst);
    if (!sim.insufficient) push('track_demotion', worst.label, mkGain(sim.delta.completion ?? 0, sim.delta.skip ?? 0), [{ label: '대상 Track', value: worst.label }]);
    if (best) { const sw = simulateItemChange(s, 'swap', worst, best); if (!sw.insufficient) push('track_replacement', `${worst.label}↔${best.label}`, mkGain(sw.delta.completion ?? 0, sw.delta.skip ?? 0), [{ label: '교체', value: `${worst.label}→${best.label}` }]); }
  }

  // Genre / Mood Ratio — 고성과 가중 Mix.
  const gMix = recommendedMix(inp.genres);
  if (gMix.length >= 2) { const sim = simulateMix(s, inp.genres, gMix); if (!sim.insufficient && sim.delta.completion > 0.5) push('genre_ratio', null, mkGain(sim.delta.completion, sim.delta.skip, 0, sim.after.health - baseHealth)); }
  const mMix = recommendedMix(inp.moods);
  if (mMix.length >= 2) { const sim = simulateMix(s, inp.moods, mMix); if (!sim.insufficient && sim.delta.completion > 0.5) push('mood_ratio', null, mkGain(sim.delta.completion, sim.delta.skip, 0, sim.after.health - baseHealth)); }

  // Playlist Refresh — 저성과 Playlist 존재 시.
  const weakPlaylist = [...inp.playlists].filter((p) => p.events >= 5 && p.completion_rate != null).sort((a, b) => (a.completion_rate ?? 0) - (b.completion_rate ?? 0))[0];
  if (weakPlaylist && (clampPct(weakPlaylist.completion_rate) ?? 100) < 65) {
    const imp = predictRecoImpact('top_playlist', s, inp.confidence);
    if (!imp.insufficient) push('playlist_refresh', weakPlaylist.label, mkGain(imp.completion, imp.skip, 0, imp.health), [{ label: '저성과 Playlist', value: weakPlaylist.label }]);
  }

  // Rediscovery — 장기 미노출 + 과거 양호.
  if (isNum(inp.daysSinceLast) && inp.daysSinceLast >= 14 && (clampPct(s.completion_rate) ?? 0) >= 70) {
    const imp = predictRecoImpact('rediscovery', s, inp.confidence);
    if (!imp.insufficient) push('rediscovery', null, mkGain(imp.completion, imp.skip, 0, imp.health), [{ label: '미노출(일)', value: inp.daysSinceLast }]);
  }

  // Rotation Interval — Skip 높을 때 순서/간격 재조정 권장.
  if ((clampPct(s.skip_rate) ?? 0) >= 8) {
    const imp = predictRecoImpact('playlist_experiment', s, inp.confidence);
    if (!imp.insufficient) push('rotation_interval', null, mkGain(imp.completion, imp.skip), [{ label: '현재 Skip', value: clampPct(s.skip_rate) }]);
  }

  // Test Pool Expand/Reduce — 커버리지(Track 수) 기준.
  if (s.track_count < 20) push('test_pool_expand', null, mkGain(0.5, -0.3), [{ label: 'Track 수', value: s.track_count }]);
  if (s.track_count > 120 && (clampPct(s.skip_rate) ?? 0) >= 6) push('test_pool_reduce', null, mkGain(0.3, -0.4), [{ label: 'Track 수', value: s.track_count }]);

  return out.sort((a, b) => b.roi - a.roi);
}

/* ── 2) Ranking ─────────────────────────────────────────────────────────── */
export function rankStrategies(strategies: Strategy[]): Strategy[] {
  return [...strategies].sort((a, b) => b.roi - a.roi || b.expected.completion - a.expected.completion);
}

/* ── 6) Multi-Strategy Simulation(충돌 인지·수확체감) ───────────────────── */
export interface MultiSimResult {
  combined: ExpectedGain; strategies: string[]; conflicts: Conflict[];
  netCompletion: number; netSkip: number; note: string;
}
/** 복수 전략 동시 적용 가정 예상 KPI(수확체감 적용). 충돌 전략은 상쇄 경고. */
export function multiStrategySimulation(strategies: Strategy[]): MultiSimResult {
  const conflicts = detectConflicts(strategies);
  // 수확체감: 정렬 후 i번째 gain × 0.8^i.
  const sorted = rankStrategies(strategies);
  let comp = 0; let skip = 0; let listen = 0; let health = 0;
  sorted.forEach((s, i) => {
    const decay = Math.pow(0.8, i);
    comp += s.expected.completion * decay; skip += s.expected.skip * decay;
    listen += s.expected.listening * decay; health += s.expected.health * decay;
  });
  const combined = mkGain(comp, skip, listen, health);
  return {
    combined, strategies: sorted.map((s) => s.id), conflicts,
    netCompletion: combined.completion, netSkip: combined.skip,
    note: conflicts.length ? `충돌 ${conflicts.length}건 — 상쇄 가능성. 수확체감 반영.` : '수확체감 반영(중복 효과 축소).',
  };
}

/* ── 7) Conflict Detection ──────────────────────────────────────────────── */
export interface Conflict { a: string; b: string; reason: string }
const OPPOSITE: Array<[StrategyType, StrategyType]> = [
  ['track_promotion', 'track_demotion'], ['test_pool_expand', 'test_pool_reduce'],
];
/** 동일 대상 상반 전략 + 상호 배타 전략쌍 → 충돌. */
export function detectConflicts(strategies: Strategy[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const a = strategies[i]; const b = strategies[j];
      const opp = OPPOSITE.some(([x, y]) => (a.type === x && b.type === y) || (a.type === y && b.type === x));
      if (opp) out.push({ a: a.id, b: b.id, reason: `상반 전략(${STRATEGY_LABEL[a.type]} ↔ ${STRATEGY_LABEL[b.type]})` });
      else if (a.target && b.target && a.target === b.target && a.type !== b.type) out.push({ a: a.id, b: b.id, reason: `동일 대상(${a.target}) 상이 전략` });
    }
  }
  return out;
}

/* ── 8) Dependency Graph ────────────────────────────────────────────────── */
export interface Dependency { from: StrategyType; to: StrategyType; reason: string }
export const STRATEGY_DEPENDENCIES: Dependency[] = [
  { from: 'track_promotion', to: 'playlist_refresh', reason: 'Track 승격 후 Playlist 반영 필요' },
  { from: 'track_replacement', to: 'playlist_refresh', reason: 'Track 교체 후 Playlist 반영 필요' },
  { from: 'rediscovery', to: 'rotation_interval', reason: 'Rediscovery 후 Rotation 간격 조정 권장' },
  { from: 'test_pool_expand', to: 'rediscovery', reason: 'Test Pool 확대 후 Rediscovery 가능' },
];
/** 현재 전략 집합에서 실제로 존재하는 선행/후행 쌍만 반환. */
export function dependencyGraph(strategies: Strategy[]): Array<Dependency & { present: boolean }> {
  const types = new Set(strategies.map((s) => s.type));
  return STRATEGY_DEPENDENCIES.filter((d) => types.has(d.from) || types.has(d.to)).map((d) => ({ ...d, present: types.has(d.from) && types.has(d.to) }));
}

/* ── 9) Optimization Plan(의존성 존중 위상 정렬 + ROI) ───────────────────── */
export interface PlanStep { order: number; strategy: Strategy; reason: string }
/** 의존성(from→to)을 존중하면서 ROI 높은 순으로 실행 순서 정렬. 순환 없으면 위상 우선. */
export function optimizationPlan(strategies: Strategy[]): PlanStep[] {
  const ranked = rankStrategies(strategies);
  const deps = dependencyGraph(strategies).filter((d) => d.present);
  const beforeOf = new Map<StrategyType, Set<StrategyType>>(); // to → {from...}
  for (const d of deps) { if (!beforeOf.has(d.to)) beforeOf.set(d.to, new Set()); beforeOf.get(d.to)!.add(d.from); }
  const placed: Strategy[] = []; const remaining = [...ranked];
  let guard = 0;
  while (remaining.length && guard++ < 1000) {
    const idx = remaining.findIndex((s) => {
      const need = beforeOf.get(s.type); if (!need) return true;
      return [...need].every((f) => !remaining.some((r) => r.type === f) || placed.some((p) => p.type === f));
    });
    const pick = idx >= 0 ? remaining.splice(idx, 1)[0] : remaining.shift()!;
    placed.push(pick);
  }
  return placed.map((strategy, i) => {
    const need = beforeOf.get(strategy.type);
    const reason = need && placed.slice(0, i).some((p) => need.has(p.type)) ? `선행(${[...need].map((t) => STRATEGY_LABEL[t]).join(', ')}) 이후` : 'ROI 우선';
    return { order: i + 1, strategy, reason };
  });
}

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export function roiTone(score: number): 'success' | 'warning' | 'danger' { return score >= 60 ? 'success' : score >= 35 ? 'warning' : 'danger'; }
export function riskToneS(score: number): 'success' | 'warning' | 'danger' { return score >= 60 ? 'danger' : score >= 35 ? 'warning' : 'success'; }
export function costTone(level: CostLevel): 'success' | 'warning' | 'danger' { return level === 'low' ? 'success' : level === 'medium' ? 'warning' : 'danger'; }
export function strategyAllowed(sample: number): boolean { return isNum(sample) && sample >= MIN_EVENTS; }
export const STRATEGY_STATUS_LABEL: Record<string, string> = { active: '후보', approved: '승인', dismissed: '기각', resolved: '완료' };
export const STRATEGY_STATUS_TONE: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = { active: 'info', approved: 'success', dismissed: 'danger', resolved: 'neutral' };
