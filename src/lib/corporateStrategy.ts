/**
 * corporateStrategy — Enterprise Strategy Intelligence/Corporate Objectives/
 * Strategic Roadmap 순수 로직 (Phase AI-OPS-21).
 *
 * Vision → Objectives → Roadmap → Initiatives → Portfolio → Outcome → Evolution.
 * AI는 목표 제안/관계 분석/달성 가능성 평가만 — 목표 자동 생성/전략 자동 승인 없음.
 *
 * Strategy 정직성(전부 코드로 강제):
 *  - Vision ≠ Execution. Objective ≠ Outcome. Roadmap ≠ Commitment. Strategy ≠ Decision.
 *  - Alignment ≠ Success. Capability ≠ Performance(인사 평가 아님). Recommendation ≠ Approval.
 *  - Gap 은 사실로 단정하지 않음. Unknown 유지(null→0 금지).
 *  - 표본<5 sample_too_small. 근거 부족 strategy_unverified.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type StrategyAlignment = 'aligned' | 'partially_aligned' | 'alignment_unverified' | 'insufficient_data';
export type GapVerdict = 'gap_candidate' | 'minor_gap_candidate' | 'no_known_gap' | 'gap_unverified' | 'insufficient_data';
export type AchievabilityVerdict = 'achievable_candidate' | 'at_risk_candidate' | 'unlikely_candidate' | 'sample_too_small' | 'strategy_unverified' | 'insufficient_data';

export const HIERARCHY_STAGES = ['vision', 'objective', 'initiative', 'commitment', 'execution', 'outcome'] as const;

/* ── 1) Vision(사람 입력만) ──────────────────────────────────────────── */
export function validateVisionRecord(v: { kind?: string; statement?: string | null; humanAuthored?: boolean } | null): string[] {
  if (!v) return ['vision 입력 없음'];
  const errors: string[] = [];
  if (!v.kind || !['vision_statement', 'mission_statement', 'corporate_principle', 'long_term_direction'].includes(v.kind)) errors.push('허용되지 않는 kind');
  if (!v.statement?.trim()) errors.push('statement 필수(사람 입력)');
  if (v.humanAuthored === false) errors.push('AI 자동 생성 Vision 금지 — human_authored 필수');
  return errors;
}

/* ── 5) Objective Hierarchy(Vision→…→Outcome, orphan 감지) ───────────── */
export function buildObjectiveHierarchy(nodes: { id: string; stage: string; label: string; parentId: string | null }[] | null): { stages: { stage: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[] } {
  const valid = (nodes ?? []).filter((n) => (HIERARCHY_STAGES as readonly string[]).includes(n.stage));
  const ids = new Set(valid.map((n) => n.id));
  const orphans = valid.filter((n) => n.stage !== 'vision' && (!n.parentId || !ids.has(n.parentId))).map((n) => n.id);
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
    stages: HIERARCHY_STAGES.map((stage) => ({ stage, nodes: valid.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans, cycles: [...new Set(cycles)].slice(0, 10),
  };
}

/* ── 6) Strategic Gap(사실 단정 아님) ────────────────────────────────── */
export function analyzeStrategicGap(i: { area: string; currentValue: number | null; targetValue: number | null; evidence: string[]; unknownFactors: string[] }): { area: string; gap: number | null; verdict: GapVerdict; confidence: number | null; notFactualClaim: true } {
  if (!i.evidence.length) return { area: i.area, gap: null, verdict: 'gap_unverified', confidence: null, notFactualClaim: true };
  if (i.currentValue == null || i.targetValue == null || !isFiniteNumber(i.currentValue) || !isFiniteNumber(i.targetValue)) {
    return { area: i.area, gap: null, verdict: 'insufficient_data', confidence: null, notFactualClaim: true };
  }
  const gap = Math.round((i.targetValue - i.currentValue) * 100) / 100;
  const confidence = clampScore(Math.max(0, 80 - i.unknownFactors.length * 15));
  const relative = i.targetValue !== 0 ? Math.abs(gap) / Math.abs(i.targetValue) : Math.abs(gap);
  const verdict: GapVerdict = gap <= 0 ? 'no_known_gap' : relative >= 0.3 ? 'gap_candidate' : 'minor_gap_candidate';
  return { area: i.area, gap, verdict, confidence, notFactualClaim: true };
}

/* ── 7) Capability(인사 평가 아님) ───────────────────────────────────── */
export function analyzeCapability(i: { current: string[]; required: string[] }): { present: string[]; missing: string[]; growthCandidates: string[]; notPersonnelEvaluation: true } {
  const currentSet = new Set(i.current);
  const missing = i.required.filter((r) => !currentSet.has(r));
  const present = i.required.filter((r) => currentSet.has(r));
  return { present, missing, growthCandidates: missing.slice(0, 10), notPersonnelEvaluation: true };
}

/* ── 8) Strategic Alignment(4상태만) ─────────────────────────────────── */
export function evaluateStrategyAlignment(i: { pair: string; linkedCount: number | null; totalCount: number | null }): { pair: string; alignment: StrategyAlignment; pct: number | null; alignmentIsNotSuccess: true } {
  if (i.linkedCount == null || i.totalCount == null || !isFiniteNumber(i.totalCount)) return { pair: i.pair, alignment: 'alignment_unverified', pct: null, alignmentIsNotSuccess: true };
  if (i.totalCount <= 0) return { pair: i.pair, alignment: 'insufficient_data', pct: null, alignmentIsNotSuccess: true };
  const pct = clampScore((i.linkedCount / i.totalCount) * 100);
  return { pair: i.pair, alignment: pct >= 70 ? 'aligned' : pct >= 30 ? 'partially_aligned' : 'partially_aligned', pct, alignmentIsNotSuccess: true };
}

/* ── 9) Strategic Maturity(점수 단독 반환 금지) ──────────────────────── */
export const MATURITY_DIMENSIONS = ['governance', 'execution', 'analytics', 'learning', 'advisory', 'strategy'] as const;

export function evaluateStrategicMaturity(dimensions: { dimension: string; score: number | null; evidence: string[] }[]): { overall: number | null; byDimension: { dimension: string; score: number | null; evidenceCount: number }[]; supportingEvidence: string[]; missingAreas: string[]; unknownFactors: string[]; scoreOnlyReturn: false } {
  const valid = dimensions.filter((d) => (MATURITY_DIMENSIONS as readonly string[]).includes(d.dimension));
  const { score, missing } = normalizeAvailableComponents(valid.map((d) => ({ key: d.dimension, value: d.evidence.length ? d.score : null, weight: 1 })));
  return {
    overall: score == null ? null : clampScore(score),
    byDimension: valid.map((d) => ({ dimension: d.dimension, score: d.evidence.length ? d.score : null, evidenceCount: d.evidence.length })),
    supportingEvidence: valid.flatMap((d) => d.evidence).slice(0, 20),
    missingAreas: missing,
    unknownFactors: valid.filter((d) => !d.evidence.length).map((d) => `${d.dimension}: Evidence 없음 — 점수 제외`),
    scoreOnlyReturn: false,
  };
}

/* ── 3) Roadmap Timeline(Roadmap ≠ Commitment) ───────────────────────── */
export function buildRoadmapTimeline(items: { year: number; phase: string; title: string }[] | null): { years: { year: number; items: { phase: string; title: string }[] }[]; roadmapIsNotCommitment: true } {
  const byYear = new Map<number, { phase: string; title: string }[]>();
  for (const i of items ?? []) {
    if (!isFiniteNumber(i.year)) continue;
    if (!byYear.has(i.year)) byYear.set(i.year, []);
    byYear.get(i.year)!.push({ phase: i.phase, title: i.title });
  }
  return { years: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, list]) => ({ year, items: list.slice(0, 20) })), roadmapIsNotCommitment: true };
}

/* ── 11) Strategy Evolution(Revision 은 사람 승인) ───────────────────── */
export const EVOLUTION_STAGES = ['vision', 'objective_update', 'initiative', 'execution', 'outcome', 'learning', 'strategy_revision'] as const;

export function buildStrategyEvolution(events: { at: Date; stage: string; label: string }[] | null): { timeline: { at: string; stage: string; label: string; humanApprovalRequired: boolean }[]; revisionRequiresHumanApproval: true } {
  const valid = (events ?? []).filter((e) => (EVOLUTION_STAGES as readonly string[]).includes(e.stage));
  const sorted = [...valid].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50);
  return {
    timeline: sorted.map((e) => ({ at: e.at.toISOString(), stage: e.stage, label: e.label, humanApprovalRequired: e.stage === 'strategy_revision' || e.stage === 'objective_update' })),
    revisionRequiresHumanApproval: true,
  };
}

/* ── Objective 달성 가능성(확정 아님·표본 방어) ──────────────────────── */
export function assessObjectiveAchievability(i: { linkedInitiatives: number; linkedCommitments: number; verifiedProgress: number | null; historicalSuccessRate: number | null; historicalSample: number; unknownFactors: string[] }): { verdict: AchievabilityVerdict; score: number | null; drivers: string[]; notGuarantee: true } {
  const drivers: string[] = [];
  if (i.linkedInitiatives === 0 && i.linkedCommitments === 0) return { verdict: 'strategy_unverified', score: null, drivers: ['연결된 Initiative/Commitment 없음 — 평가 근거 부족'], notGuarantee: true };
  const { score } = normalizeAvailableComponents([
    { key: 'progress', value: i.verifiedProgress, weight: 0.45 },
    { key: 'history', value: i.historicalSample >= 5 ? i.historicalSuccessRate : null, weight: 0.3 },
    { key: 'linkage', value: clampScore((i.linkedInitiatives + i.linkedCommitments) * 20), weight: 0.25 },
  ]);
  if (score == null) return { verdict: 'insufficient_data', score: null, drivers: ['평가 가능한 신호 없음(0 아님)'], notGuarantee: true };
  if (i.historicalSample < 5) drivers.push(`이력 표본 ${i.historicalSample}<5 — 이력 성분 제외`);
  if (i.unknownFactors.length) drivers.push(`Unknown ${i.unknownFactors.length}건`);
  const penalized = clampScore(score - i.unknownFactors.length * 5);
  const verdict: AchievabilityVerdict = i.historicalSample < 5 && i.verifiedProgress == null ? 'sample_too_small' : penalized >= 60 ? 'achievable_candidate' : penalized >= 35 ? 'at_risk_candidate' : 'unlikely_candidate';
  return { verdict, score: penalized, drivers, notGuarantee: true };
}

/* ── 12) Strategy Recommendation(6종·Approval 아님) ─────────────────── */
export const STRATEGY_RECOMMENDATION_TYPES = ['review_objective', 'review_alignment', 'validate_capability', 'review_strategic_gap', 'gather_evidence', 'update_roadmap_candidate', 'insufficient_data'] as const;
export type StrategyRecommendationType = (typeof STRATEGY_RECOMMENDATION_TYPES)[number];

export function buildStrategyRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; assumptions: string[] }): { type: StrategyRecommendationType; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } | { rejected: true; why: string } {
  if (!(STRATEGY_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.reason.trim()) return { rejected: true, why: '사유 필수' };
  return {
    type: i.type as StrategyRecommendationType, reason: i.reason, evidence: i.evidence,
    confidence: i.confidence, alternatives: ['현행 유지(권고 미채택)'], assumptions: i.assumptions,
    limitations: ['Recommendation ≠ Approval', 'Strategy ≠ Decision'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 10) Executive Roadmap Dashboard(9영역) ──────────────────────────── */
export function buildRoadmapDashboard(i: { visionCount: number; objectiveCount: number; roadmapYears: number; initiativeCount: number; alignedPairs: number; totalPairs: number; gapCandidates: number; missingCapabilities: number; maturityOverall: number | null; briefingNote: string }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true } {
  return {
    sections: [
      { key: 'vision', headline: i.visionCount ? `Vision/Mission ${i.visionCount}건(사람 입력)` : 'Vision 미기록', detail: 'AI 자동 생성 없음' },
      { key: 'objectives', headline: `Objectives ${i.objectiveCount}건`, detail: 'Objective ≠ Outcome' },
      { key: 'roadmap', headline: i.roadmapYears ? `Roadmap ${i.roadmapYears}개 연도` : 'Roadmap 미구성', detail: 'Roadmap ≠ Commitment' },
      { key: 'initiatives', headline: `Initiatives ${i.initiativeCount}건(0516 실측)`, detail: '자동 생성 없음' },
      { key: 'alignment', headline: i.totalPairs ? `일치 ${i.alignedPairs}/${i.totalPairs}쌍` : 'alignment_unverified', detail: 'Alignment ≠ Success' },
      { key: 'gaps', headline: `Gap 후보 ${i.gapCandidates}건`, detail: '사실 단정 아님' },
      { key: 'capability', headline: `Missing Capability ${i.missingCapabilities}건`, detail: '인사 평가 아님' },
      { key: 'strategic_health', headline: i.maturityOverall == null ? 'insufficient_data' : `Maturity ${i.maturityOverall}`, detail: '점수 단독 해석 금지' },
      { key: 'executive_summary', headline: i.briefingNote, detail: '최종 결정은 사람' },
    ],
    humanDecisionRequired: true,
  };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const STRATEGY_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'vision', label: 'Corporate Vision Intelligence', status: 'supported', note: '사람 입력 기록만 — human_authored 스키마 강제' },
  { key: 'objectives', label: 'Corporate Objectives(연간/분기/장기/전략)', status: 'supported', note: 'Status/Priority/Evidence/Owner Reference/Review Cycle' },
  { key: 'roadmap', label: 'Strategic Roadmap(2026~)', status: 'supported', note: 'Roadmap ≠ Commitment — Revision 사람 승인' },
  { key: 'initiatives', label: 'Strategic Initiative Intelligence', status: 'supported', note: 'ai_strategic_initiatives(0516) 재사용 — 신규 생성 없음' },
  { key: 'hierarchy', label: 'Objective Hierarchy(6단계)', status: 'supported', note: 'Vision→Objective→Initiative→Commitment→Execution→Outcome, orphan/cycle 감지' },
  { key: 'gap', label: 'Strategic Gap Intelligence', status: 'supported', note: 'Gap ≠ 사실 확정(notFactualClaim) — Evidence 없으면 unverified' },
  { key: 'capability', label: 'Capability Intelligence', status: 'partial', note: '수동 입력 기반 — 인사 평가 아님(notPersonnelEvaluation)' },
  { key: 'alignment', label: 'Strategic Alignment(4쌍)', status: 'supported', note: 'aligned/partially/unverified/insufficient 4상태만 — ≠ Success' },
  { key: 'maturity', label: 'Strategic Maturity(6차원)', status: 'supported', note: 'Evidence 없는 차원 점수 제외 — 점수 단독 반환 금지' },
  { key: 'roadmap_dashboard', label: 'Executive Roadmap Dashboard', status: 'supported', note: '9영역 — humanDecisionRequired' },
  { key: 'evolution', label: 'Strategy Evolution Timeline(7단계)', status: 'supported', note: 'Revision/Objective Update 는 Human Approval Required' },
  { key: 'achievability', label: 'Objective 달성 가능성 평가', status: 'supported', note: '확정 아님(notGuarantee) — 표본<5 방어' },
  { key: 'recommendation', label: 'Executive Strategy Recommendation', status: 'supported', note: '6종 whitelist · 8요소 · Recommendation ≠ Approval' },
  { key: 'auto_vision', label: '자동 Vision/Mission/Objective 생성', status: 'unsupported', note: '전면 금지(스키마+서버 강제)' },
  { key: 'auto_approval', label: '자동 Strategy 승인/Roadmap·Portfolio·Priority 변경', status: 'unsupported', note: '전면 금지' },
  { key: 'production_apply', label: 'Production/Merge/Deploy', status: 'unsupported', note: '미지원(의도적)' },
];
