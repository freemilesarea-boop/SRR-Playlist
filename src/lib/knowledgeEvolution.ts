/**
 * knowledgeEvolution — Enterprise Knowledge Evolution/Organizational Memory/
 * Continuous Intelligence Center 순수 로직 (Phase AI-OPS-28).
 *
 * Enterprise → Experience → Knowledge → Learning → Organizational Memory →
 * Knowledge Evolution → Executive Knowledge Advisory.
 * AI는 지식 연결/패턴 분석/Best Practice 후보 제안/노후 지식 식별만 —
 * 자동 등록/자동 삭제/정책·전략·조직 규칙 자동 변경 없음.
 *
 * Knowledge 정직성(전부 코드로 강제):
 *  - Knowledge ≠ Truth. Learning ≠ Correctness. Best Practice ≠ Universal Rule.
 *  - Decision Memory ≠ Decision Approval. Recommendation ≠ Organizational Decision.
 *  - Pattern 은 사실로 단정하지 않음. Cycle 은 감지하되 인과 주장 없음.
 *  - Unknown 유지(null→0 금지). 표본 부족 sample_too_small.
 *  - 데이터 부족 insufficient_data. 근거 부족 knowledge_unverified.
 *  - deterministic · pure · null 안전 · Date 주입 · cycle 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const MEMORY_KINDS = ['decision', 'experience', 'lesson_learned', 'retrospective', 'knowledge_reference', 'historical_context', 'best_practice_candidate'] as const;
export const MEMORY_STATUSES = ['active', 'candidate', 'archived', 'unknown'] as const;
export const KNOWLEDGE_CONFIDENCE = ['verified', 'candidate', 'unknown', 'knowledge_unverified'] as const;
export const BEST_PRACTICE_DOMAINS = ['operational', 'engineering', 'business', 'ai'] as const;
export const LEARNING_PATTERN_KINDS = ['repeated_success', 'repeated_failure', 'repeated_delay', 'repeated_recovery', 'repeated_optimization'] as const;
export const KNOWLEDGE_GRAPH_STAGES = ['experience', 'evidence', 'knowledge', 'decision', 'outcome', 'learning'] as const;
export const KNOWLEDGE_RECOMMENDATION_TYPES = ['review_knowledge', 'validate_evidence', 'promote_best_practice_candidate', 'review_aging_knowledge', 'gather_more_evidence', 'review_learning_pattern'] as const;

/* ── 5) Knowledge Confidence(정답 의미 아님) ─────────────────────────── */
export function evaluateKnowledgeConfidence(i: { evidenceCount: number; humanVerified: boolean }): { confidence: (typeof KNOWLEDGE_CONFIDENCE)[number]; confidenceIsNotCorrectness: true } {
  if (i.evidenceCount === 0) return { confidence: 'knowledge_unverified', confidenceIsNotCorrectness: true };
  if (i.humanVerified) return { confidence: 'verified', confidenceIsNotCorrectness: true };
  return { confidence: 'candidate', confidenceIsNotCorrectness: true };
}

/* ── 6) Knowledge Aging(오래됐다고 삭제하지 않음) ────────────────────── */
export function analyzeKnowledgeAging(items: { code: string; updatedAt: Date; status: string }[] | null, now: Date): { rows: { code: string; ageDays: number; aging: 'fresh' | 'stable' | 'needs_review' | 'candidate_archive' }[]; agingCounts: Record<string, number>; deletionPerformed: false } {
  const rows = (items ?? []).filter((x) => x.updatedAt instanceof Date && !Number.isNaN(x.updatedAt.getTime()) && x.status !== 'archived').slice(0, 100).map((x) => {
    const ageDays = Math.max(0, Math.floor((now.getTime() - x.updatedAt.getTime()) / 86400000));
    const aging = ageDays <= 30 ? ('fresh' as const) : ageDays <= 90 ? ('stable' as const) : ageDays <= 180 ? ('needs_review' as const) : ('candidate_archive' as const);
    return { code: x.code, ageDays, aging };
  });
  const agingCounts: Record<string, number> = {};
  for (const r of rows) agingCounts[r.aging] = (agingCounts[r.aging] ?? 0) + 1;
  return { rows, agingCounts, deletionPerformed: false };
}

/* ── 3) Best Practice(후보만 — 자동 등록 없음) ───────────────────────── */
export function assessBestPracticeCandidates(candidates: { code: string; domain: string; evidenceCount: number; status: string }[] | null): { rows: { code: string; domain: string; verdict: 'promotable_candidate' | 'knowledge_unverified' | 'invalid_domain' }[]; autoRegistered: false; bestPracticeIsNotUniversalRule: true } {
  const rows = (candidates ?? []).slice(0, 50).map((c) => ({
    code: c.code, domain: c.domain,
    verdict: !(BEST_PRACTICE_DOMAINS as readonly string[]).includes(c.domain) ? ('invalid_domain' as const)
      : c.evidenceCount === 0 ? ('knowledge_unverified' as const) : ('promotable_candidate' as const),
  }));
  return { rows, autoRegistered: false, bestPracticeIsNotUniversalRule: true };
}

/* ── 4) Decision Memory(이유 추적 — 승인 아님) ───────────────────────── */
export function traceDecisionMemory(links: { decision: string; hasReason: boolean; hasEvidence: boolean; hasOutcome: boolean; hasLearning: boolean }[] | null): { rows: { decision: string; chainComplete: boolean; missing: string[] }[]; completeCount: number; decisionMemoryIsNotApproval: true } {
  const rows = (links ?? []).slice(0, 50).map((l) => {
    const missing: string[] = [];
    if (!l.hasReason) missing.push('reason');
    if (!l.hasEvidence) missing.push('evidence');
    if (!l.hasOutcome) missing.push('outcome');
    if (!l.hasLearning) missing.push('learning');
    return { decision: l.decision, chainComplete: missing.length === 0, missing };
  });
  return { rows, completeCount: rows.filter((r) => r.chainComplete).length, decisionMemoryIsNotApproval: true };
}

/* ── 7) Learning Pattern(사실 단정 아님·표본 방어) ───────────────────── */
export function analyzeLearningPatterns(observations: { kind: string; occurrences: number; evidence: string[] }[] | null): { patterns: { kind: string; verdict: 'pattern_candidate' | 'sample_too_small' | 'knowledge_unverified' | 'invalid_kind' }[]; patternIsNotFact: true } {
  const patterns = (observations ?? []).slice(0, 20).map((o) => ({
    kind: o.kind,
    verdict: !(LEARNING_PATTERN_KINDS as readonly string[]).includes(o.kind) ? ('invalid_kind' as const)
      : !o.evidence.length ? ('knowledge_unverified' as const)
      : o.occurrences < 3 ? ('sample_too_small' as const) : ('pattern_candidate' as const),
  }));
  return { patterns, patternIsNotFact: true };
}

/* ── 8) Knowledge Relationship Graph(6단계 — 인과 주장 없음) ─────────── */
export function buildKnowledgeGraph(nodes: { id: string; stage: string; label: string; parentId: string | null }[] | null): { stages: { stage: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[]; causalityClaimed: false } {
  const valid = (nodes ?? []).filter((n) => (KNOWLEDGE_GRAPH_STAGES as readonly string[]).includes(n.stage));
  const ids = new Set(valid.map((n) => n.id));
  const orphans = valid.filter((n) => n.stage !== 'experience' && (!n.parentId || !ids.has(n.parentId))).map((n) => n.id);
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
    stages: KNOWLEDGE_GRAPH_STAGES.map((stage) => ({ stage, nodes: valid.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans: orphans.slice(0, 20), cycles: [...new Set(cycles)].slice(0, 10), causalityClaimed: false,
  };
}

/* ── 11) Executive Knowledge Briefing(자동 발송 없음) ────────────────── */
export const KNOWLEDGE_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildKnowledgeBriefing(i: { periodKind: string; newKnowledge: string[]; changedKnowledge: string[]; bestPracticeCandidates: string[]; agingKnowledge: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; knowledgeIsNotTruth: true } {
  return {
    periodKind: i.periodKind,
    valid: (KNOWLEDGE_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'new_knowledge', items: i.newKnowledge.slice(0, 10) },
      { key: 'changed_knowledge', items: i.changedKnowledge.slice(0, 10) },
      { key: 'best_practice_candidates', items: i.bestPracticeCandidates.slice(0, 10) },
      { key: 'aging_knowledge', items: i.agingKnowledge.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, knowledgeIsNotTruth: true,
  };
}

/* ── 10) Knowledge Recommendation(6종 whitelist·Evidence 필수) ───────── */
export function buildKnowledgeRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(KNOWLEDGE_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(knowledge_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Organizational Decision', 'Knowledge ≠ Truth', 'Best Practice ≠ Universal Rule'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Knowledge Cockpit(7영역) ────────────────────────────────────── */
export function buildKnowledgeCockpit(i: { memoryTotal: number; knowledgeNodes: number; decisionChainsComplete: number; learningPatternCandidates: number; bestPracticeCandidates: number; graphOrphans: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; knowledgeAutoDecided: false } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'memory', headline: n(i.memoryTotal), detail: '사람 기록 Memory — 삭제 없음' },
      { key: 'knowledge', headline: n(i.knowledgeNodes), detail: '0498 실측 노드 — Knowledge ≠ Truth' },
      { key: 'decision_memory', headline: n(i.decisionChainsComplete), detail: '완결 체인 — Decision Memory ≠ Approval' },
      { key: 'learning', headline: n(i.learningPatternCandidates), detail: 'Pattern 후보 — 사실 단정 아님' },
      { key: 'best_practice', headline: n(i.bestPracticeCandidates), detail: '후보만 — 자동 등록 없음' },
      { key: 'knowledge_graph', headline: n(i.graphOrphans), detail: '미연결 노드 — 인과 주장 없음' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, knowledgeAutoDecided: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const KNOWLEDGE_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'organizational_memory', status: 'supported', note: '7 kind·4상태 — candidate 강제 시작·삭제 없음' },
  { key: 'knowledge_evolution', status: 'supported', note: 'Revision 은 사람 승인 RPC 경유(revision_count 기록)' },
  { key: 'best_practice_candidate', status: 'supported', note: '후보만 — 자동 등록 금지(0500 참조)' },
  { key: 'decision_memory', status: 'supported', note: 'ai_decision_memory/outcomes(0514) 실측 — Approval 아님' },
  { key: 'knowledge_confidence', status: 'supported', note: 'verified/candidate/unknown/knowledge_unverified — 정답 아님' },
  { key: 'knowledge_aging', status: 'supported', note: 'Fresh/Stable/Needs Review/Candidate Archive — 삭제 없음' },
  { key: 'learning_patterns', status: 'supported', note: '5종 whitelist·발생<3 sample_too_small — 사실 단정 아님' },
  { key: 'knowledge_graph', status: 'supported', note: 'Experience→Evidence→Knowledge→Decision→Outcome→Learning(0498 확장)' },
  { key: 'memory_records_0498', status: 'supported', note: 'ai_memory_records/nodes/edges 실측 참조' },
  { key: 'org_learning_0515', status: 'supported', note: 'ai_organizational_learnings/patterns 실측 참조' },
  { key: 'knowledge_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'external_wiki', status: 'unsupported', note: '외부 위키/문서 시스템 원본 없음 — knowledge_unverified' },
  { key: 'training_records', status: 'unsupported', note: '교육 기록 원본 없음' },
  { key: 'auto_best_practice_registration', status: 'unsupported', note: '자동 Best Practice 등록 금지' },
  { key: 'auto_knowledge_deletion', status: 'unsupported', note: '자동 Knowledge 삭제 금지(archive candidate 만)' },
  { key: 'auto_policy_change', status: 'unsupported', note: '정책/전략/조직 규칙 자동 변경 금지' },
];
