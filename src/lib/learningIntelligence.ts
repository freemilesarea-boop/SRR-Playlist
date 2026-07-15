/**
 * learningIntelligence — Enterprise Learning Intelligence/Continuous Improvement/
 * Organizational Optimization Center 순수 로직 (Phase AI-OPS-29).
 *
 * Enterprise → Knowledge → Learning → Continuous Improvement → Optimization →
 * Organizational Intelligence → Executive Learning Advisory.
 * AI는 개선 후보 제안/패턴 분석/학습 효과 측정/성숙도 평가만 —
 * 개선안 자동 적용/정책·운영 절차 자동 변경/조직 자동 최적화 없음.
 *
 * Learning 정직성(전부 코드로 강제):
 *  - Learning ≠ Correctness. Improvement ≠ Adoption. Optimization ≠ Better Outcome.
 *  - Maturity ≠ Organizational Success. Recommendation ≠ Organizational Decision.
 *  - Evolution 은 사실 단정 아님. Cycle 은 감지하되 인과 주장 없음.
 *  - Coverage 는 실측만 사용. Unknown 유지(null→0 금지).
 *  - 표본 부족 sample_too_small. 데이터 부족 insufficient_data. 근거 부족 learning_unverified.
 *  - deterministic · pure · null 안전 · cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const LEARNING_KINDS = ['learning_record', 'improvement_candidate', 'optimization_candidate', 'retrospective', 'lesson_learned', 'organizational_insight'] as const;
export const LEARNING_STATUSES = ['candidate', 'approved', 'archived', 'unknown'] as const;
export const OPTIMIZATION_DOMAINS = ['process', 'operational', 'strategy', 'ai'] as const;
export const EVOLUTION_KINDS = ['success_evolution', 'failure_evolution', 'recovery_evolution', 'quality_evolution', 'efficiency_evolution'] as const;
export const IMPROVEMENT_TIMELINE_STAGES = ['issue', 'learning', 'improvement', 'validation', 'approval', 'adoption', 'outcome'] as const;
export const MATURITY_DIMENSIONS_29 = ['process', 'governance', 'learning', 'optimization', 'collaboration', 'knowledge'] as const;
export const LEARNING_GRAPH_STAGES = ['knowledge', 'learning', 'improvement', 'optimization', 'outcome'] as const;
export const LEARNING_RECOMMENDATION_TYPES = ['review_learning', 'validate_improvement', 'review_optimization', 'gather_more_evidence', 'review_maturity', 'review_adoption'] as const;

/* ── 3) Optimization(후보만 — 자동 적용 없음) ────────────────────────── */
export function assessOptimizationCandidates(candidates: { code: string; domain: string | null; evidenceCount: number }[] | null): { rows: { code: string; domain: string | null; verdict: 'reviewable_candidate' | 'learning_unverified' | 'invalid_domain' }[]; autoApplied: false; optimizationIsNotBetterOutcome: true } {
  const rows = (candidates ?? []).slice(0, 50).map((c) => ({
    code: c.code, domain: c.domain,
    verdict: !c.domain || !(OPTIMIZATION_DOMAINS as readonly string[]).includes(c.domain) ? ('invalid_domain' as const)
      : c.evidenceCount === 0 ? ('learning_unverified' as const) : ('reviewable_candidate' as const),
  }));
  return { rows, autoApplied: false, optimizationIsNotBetterOutcome: true };
}

/* ── 4) Organizational Evolution(사실 단정 아님·표본 방어) ───────────── */
export function analyzeOrganizationalEvolution(observations: { kind: string; observations: number; evidence: string[] }[] | null): { rows: { kind: string; verdict: 'evolution_candidate' | 'sample_too_small' | 'learning_unverified' | 'invalid_kind' }[]; evolutionIsNotFact: true } {
  const rows = (observations ?? []).slice(0, 10).map((o) => ({
    kind: o.kind,
    verdict: !(EVOLUTION_KINDS as readonly string[]).includes(o.kind) ? ('invalid_kind' as const)
      : !o.evidence.length ? ('learning_unverified' as const)
      : o.observations < 3 ? ('sample_too_small' as const) : ('evolution_candidate' as const),
  }));
  return { rows, evolutionIsNotFact: true };
}

/* ── 5) Learning Effectiveness(Coverage 실측만) ──────────────────────── */
export function measureLearningEffectiveness(i: { learningsTotal: number | null; learningsApproved: number | null; improvementsTotal: number | null; improvementsApproved: number | null; optimizationsTotal: number | null; adoptionsRecorded: number | null }): { coverages: { key: string; pct: number | null; status: 'measured' | 'insufficient_data' }[]; measuredOnly: true; adoptionIsNotOutcome: true } {
  const cov = (key: string, num: number | null, den: number | null) => {
    const ok = num != null && den != null && isFiniteNumber(num) && isFiniteNumber(den) && den > 0;
    return { key, pct: ok ? clampScore((num! / den!) * 100) : null, status: ok ? ('measured' as const) : ('insufficient_data' as const) };
  };
  return {
    coverages: [
      cov('learning_coverage(approved/total)', i.learningsApproved, i.learningsTotal),
      cov('improvement_coverage(approved/total)', i.improvementsApproved, i.improvementsTotal),
      cov('optimization_coverage(candidates/total)', i.optimizationsTotal, i.learningsTotal),
      cov('adoption_coverage(adopted/approved)', i.adoptionsRecorded, i.learningsApproved),
    ],
    measuredOnly: true, adoptionIsNotOutcome: true,
  };
}

/* ── 6) Improvement Timeline(7단계 — Approval 은 Human Required) ─────── */
export function buildImprovementTimeline(events: { stage: string; at: Date; note: string }[] | null): { stages: { stage: string; humanRequired: boolean; entries: { at: string; note: string }[] }[]; invalidStages: number; stageCompletionGuarantee: false } {
  const valid = (events ?? []).filter((e) => (IMPROVEMENT_TIMELINE_STAGES as readonly string[]).includes(e.stage) && e.at instanceof Date && !Number.isNaN(e.at.getTime()));
  return {
    stages: IMPROVEMENT_TIMELINE_STAGES.map((stage) => ({
      stage,
      humanRequired: stage === 'approval' || stage === 'adoption',
      entries: valid.filter((e) => e.stage === stage).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 20).map((e) => ({ at: e.at.toISOString(), note: e.note })),
    })),
    invalidStages: (events ?? []).length - valid.length,
    stageCompletionGuarantee: false,
  };
}

/* ── 7) Organizational Maturity(Evidence 없는 차원 점수 제외) ────────── */
export function evaluateOrganizationalMaturity(dimensions: { dimension: string; score: number | null; evidence: string[] }[]): { overall: number | null; byDimension: { dimension: string; score: number | null; evidenceCount: number }[]; supportingEvidence: string[]; missingAreas: string[]; unknownFactors: string[]; maturityIsNotSuccess: true; scoreOnlyReturn: false } {
  const valid = dimensions.filter((d) => (MATURITY_DIMENSIONS_29 as readonly string[]).includes(d.dimension));
  const { score, missing } = normalizeAvailableComponents(valid.map((d) => ({ key: d.dimension, value: d.evidence.length ? d.score : null, weight: 1 })));
  return {
    overall: score,
    byDimension: valid.map((d) => ({ dimension: d.dimension, score: d.evidence.length && d.score != null && isFiniteNumber(d.score) ? clampScore(d.score) : null, evidenceCount: d.evidence.length })),
    supportingEvidence: valid.flatMap((d) => d.evidence).slice(0, 20),
    missingAreas: missing,
    unknownFactors: valid.filter((d) => !d.evidence.length).map((d) => `${d.dimension}: Evidence 없음 — 점수 제외`),
    maturityIsNotSuccess: true, scoreOnlyReturn: false,
  };
}

/* ── 8) Learning Relationship Graph(5단계 — 인과 주장 없음) ──────────── */
export function buildLearningGraph(nodes: { id: string; stage: string; label: string; parentId: string | null }[] | null): { stages: { stage: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[]; causalityClaimed: false } {
  const valid = (nodes ?? []).filter((n) => (LEARNING_GRAPH_STAGES as readonly string[]).includes(n.stage));
  const ids = new Set(valid.map((n) => n.id));
  const orphans = valid.filter((n) => n.stage !== 'knowledge' && (!n.parentId || !ids.has(n.parentId))).map((n) => n.id);
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
    stages: LEARNING_GRAPH_STAGES.map((stage) => ({ stage, nodes: valid.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans: orphans.slice(0, 20), cycles: [...new Set(cycles)].slice(0, 10), causalityClaimed: false,
  };
}

/* ── 11) Executive Learning Briefing(자동 발송 없음) ─────────────────── */
export const LEARNING_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildLearningBriefing(i: { periodKind: string; newLearnings: string[]; improvementCandidates: string[]; optimizationCandidates: string[]; maturityNote: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; learningIsNotCorrectness: true } {
  return {
    periodKind: i.periodKind,
    valid: (LEARNING_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'new_learnings', items: i.newLearnings.slice(0, 10) },
      { key: 'improvement_candidates', items: i.improvementCandidates.slice(0, 10) },
      { key: 'optimization_candidates', items: i.optimizationCandidates.slice(0, 10) },
      { key: 'organizational_maturity', items: i.maturityNote.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, learningIsNotCorrectness: true,
  };
}

/* ── 10) Learning Recommendation(6종 whitelist·Evidence 필수) ────────── */
export function buildLearningRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(LEARNING_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(learning_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Organizational Decision', 'Learning ≠ Correctness', 'Improvement ≠ Adoption'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Learning & Improvement Cockpit(7영역) ───────────────────────── */
export function buildLearningCockpit(i: { registryTotal: number; improvementCandidates: number; optimizationCandidates: number; evolutionCandidates: number; maturityOverall: number | null; graphOrphans: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; organizationAutoOptimized: false } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'learning_registry', headline: n(i.registryTotal), detail: '사람 기록 Learning — candidate 시작' },
      { key: 'continuous_improvement', headline: n(i.improvementCandidates), detail: 'Improvement ≠ Adoption' },
      { key: 'optimization', headline: n(i.optimizationCandidates), detail: '후보만 — Optimization ≠ Better Outcome' },
      { key: 'organizational_intelligence', headline: n(i.evolutionCandidates), detail: 'Evolution 후보 — 사실 단정 아님' },
      { key: 'maturity', headline: i.maturityOverall == null ? 'insufficient_data' : String(i.maturityOverall), detail: 'Maturity ≠ Organizational Success' },
      { key: 'learning_graph', headline: n(i.graphOrphans), detail: '미연결 노드 — 인과 주장 없음' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, organizationAutoOptimized: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const LEARNING_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'learning_registry', status: 'supported', note: '6 kind·4상태 — candidate 강제 시작·삭제 없음' },
  { key: 'improvement_lifecycle', status: 'supported', note: 'Proposal→Validation→Adoption — Adoption 은 approved 후 사람 기록' },
  { key: 'optimization_candidates', status: 'supported', note: 'Process/Operational/Strategy/AI 4 도메인 — 자동 적용 금지' },
  { key: 'organizational_evolution', status: 'supported', note: '5종 whitelist·관찰<3 sample_too_small — 사실 단정 아님' },
  { key: 'learning_effectiveness', status: 'supported', note: 'Coverage 4종 — 실측만(추정 금지)' },
  { key: 'improvement_timeline', status: 'supported', note: '7단계 — Approval/Adoption 은 Human Required' },
  { key: 'organizational_maturity', status: 'supported', note: '6차원 — Evidence 없는 차원 점수 제외·Success 아님' },
  { key: 'learning_graph', status: 'supported', note: 'Knowledge→Learning→Improvement→Optimization→Outcome 5단계' },
  { key: 'org_learnings_0515', status: 'supported', note: 'ai_organizational_learnings/patterns 실측 참조(읽기 전용)' },
  { key: 'org_memory_0531', status: 'supported', note: 'ai_org_memory lesson/retrospective 실측 참조' },
  { key: 'learning_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'training_platform', status: 'unsupported', note: '교육 플랫폼/HR 학습 기록 원본 없음 — learning_unverified' },
  { key: 'collaboration_analytics', status: 'unsupported', note: '협업 도구 분석 원본 없음' },
  { key: 'auto_improvement_apply', status: 'unsupported', note: 'Improvement/Optimization 자동 적용 금지' },
  { key: 'auto_policy_change', status: 'unsupported', note: '정책/조직 규칙/전략 자동 변경 금지' },
  { key: 'auto_org_optimization', status: 'unsupported', note: '사람 대신 조직 최적화 금지' },
];
