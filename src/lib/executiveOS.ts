/**
 * executiveOS — Enterprise Executive AI Operating System/Unified Intelligence/
 * Autonomous Advisory Center 순수 로직 (Phase AI-OPS-30 — 최종 통합 레이어).
 *
 * Enterprise → Unified Intelligence → Executive Operating System →
 * Cross-Domain Reasoning → Executive Advisory → Human Decision.
 * AI-OPS-1~29 데이터를 읽기 전용으로 통합 — 기존 모듈 대체 없음, 관제/지원 계층만.
 *
 * Executive AI 정직성(전부 코드로 강제):
 *  - Executive View ≠ Executive Decision. Enterprise Health ≠ Business Success.
 *  - Cross-domain Correlation ≠ Causation. Recommendation ≠ Approval.
 *  - Confidence ≠ Correctness. Unified Intelligence ≠ Complete Knowledge.
 *  - Health 는 영역별 독립 평가 — 전체 점수 단일 합산 없음(noAggregateScore).
 *  - Unknown 유지(null→0 금지). 근거 부족 executive_unverified.
 *  - deterministic · pure · null 안전 · cycle 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';
import { correlateStrategyPerformance } from './performanceIntelligence';

export const correlateCrossDomain = correlateStrategyPerformance;   // Correlation ≠ Causation(0525 재사용)

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const ENTERPRISE_DOMAINS = ['strategy', 'execution', 'performance', 'finance', 'market', 'risk', 'resources', 'ecosystem', 'knowledge', 'learning'] as const;
export const UNIFIED_TIMELINE_STAGES = ['decision', 'commitment', 'execution', 'outcome', 'learning', 'improvement', 'current_status'] as const;
export const EXECUTIVE_GRAPH_STAGES = ['vision', 'strategy', 'decision', 'commitment', 'execution', 'outcome', 'knowledge', 'learning', 'improvement'] as const;
export const SCORECARD_INDICATORS = ['strategic_progress', 'execution_readiness', 'financial_stability', 'resource_readiness', 'organizational_learning', 'enterprise_resilience'] as const;
export const EXECUTIVE_ADVISORY_TYPES = ['review_strategic_priority', 'validate_cross_domain_impact', 'review_financial_exposure', 'review_operational_readiness', 'gather_additional_evidence', 'review_organizational_learning'] as const;

/* ── 1) Unified Enterprise Intelligence(하나의 View — 완전 지식 아님) ── */
export function buildUnifiedIntelligence(domains: { domain: string; itemCount: number | null; note: string }[] | null): { rows: { domain: string; itemCount: number | null; status: 'measured' | 'insufficient_data'; note: string }[]; measuredDomains: number; unifiedIsNotCompleteKnowledge: true } {
  const valid = (domains ?? []).filter((d) => (ENTERPRISE_DOMAINS as readonly string[]).includes(d.domain));
  const rows = valid.map((d) => ({
    domain: d.domain,
    itemCount: d.itemCount != null && isFiniteNumber(d.itemCount) ? d.itemCount : null,
    status: d.itemCount != null && isFiniteNumber(d.itemCount) ? ('measured' as const) : ('insufficient_data' as const),
    note: d.note,
  }));
  return { rows, measuredDomains: rows.filter((r) => r.status === 'measured').length, unifiedIsNotCompleteKnowledge: true };
}

/* ── 4) Enterprise Health(영역별 독립 — 단일 합산 없음) ──────────────── */
export function evaluateEnterpriseHealth(domains: { domain: string; signal: number | null; evidence: string[] }[] | null): { rows: { domain: string; verdict: 'healthy_candidate' | 'watch_candidate' | 'unknown' | 'executive_unverified' }[]; noAggregateScore: true; healthIsNotBusinessSuccess: true } {
  const rows = (domains ?? []).filter((d) => (ENTERPRISE_DOMAINS as readonly string[]).includes(d.domain)).map((d) => {
    if (!d.evidence.length) return { domain: d.domain, verdict: 'executive_unverified' as const };
    if (d.signal == null || !isFiniteNumber(d.signal)) return { domain: d.domain, verdict: 'unknown' as const };
    return { domain: d.domain, verdict: d.signal >= 50 ? ('healthy_candidate' as const) : ('watch_candidate' as const) };
  });
  // 의도적으로 overall 점수를 반환하지 않음 — 전체 점수 단일 합산 금지(스펙 강제)
  return { rows, noAggregateScore: true, healthIsNotBusinessSuccess: true };
}

/* ── 6) Unified Executive Timeline(7단계 실측 집계) ──────────────────── */
export function buildUnifiedTimeline(counts: { stage: string; count: number | null; source: string }[] | null): { stages: { stage: string; count: number | null; source: string; status: 'measured' | 'insufficient_data' }[]; invalidStages: number; timelineIsNotCompletionClaim: true } {
  const valid = (counts ?? []).filter((c) => (UNIFIED_TIMELINE_STAGES as readonly string[]).includes(c.stage));
  const byStage = new Map(valid.map((c) => [c.stage, c]));
  return {
    stages: UNIFIED_TIMELINE_STAGES.map((stage) => {
      const c = byStage.get(stage);
      const count = c && c.count != null && isFiniteNumber(c.count) ? c.count : null;
      return { stage, count, source: c?.source ?? '원본 없음', status: count != null ? ('measured' as const) : ('insufficient_data' as const) };
    }),
    invalidStages: (counts ?? []).length - valid.length,
    timelineIsNotCompletionClaim: true,
  };
}

/* ── 8) Executive Intelligence Graph(9단계 — 인과 주장 없음) ─────────── */
export function buildExecutiveGraph(nodes: { id: string; stage: string; label: string; parentId: string | null }[] | null): { stages: { stage: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[]; causalityClaimed: false } {
  const valid = (nodes ?? []).filter((n) => (EXECUTIVE_GRAPH_STAGES as readonly string[]).includes(n.stage));
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
    stages: EXECUTIVE_GRAPH_STAGES.map((stage) => ({ stage, nodes: valid.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans: orphans.slice(0, 20), cycles: [...new Set(cycles)].slice(0, 10), causalityClaimed: false,
  };
}

/* ── 11) Executive Operating Scorecard(참고 지표 — Evidence 동반 강제) ── */
export function buildOperatingScorecard(indicators: { indicator: string; value: number | string | null; evidence: string[]; missingAreas: string[]; unknownFactors: string[] }[] | null): { rows: { indicator: string; value: number | string | null; verdict: 'referenced' | 'executive_unverified'; evidence: string[]; missingAreas: string[]; unknownFactors: string[] }[]; scorecardIsNotSuccess: true; scoreOnlyReturn: false } {
  const rows = (indicators ?? []).filter((i) => (SCORECARD_INDICATORS as readonly string[]).includes(i.indicator)).map((i) => ({
    indicator: i.indicator,
    value: i.evidence.length ? i.value : null,   // Evidence 없으면 값 제외(null 유지)
    verdict: i.evidence.length ? ('referenced' as const) : ('executive_unverified' as const),
    evidence: i.evidence.slice(0, 5),
    missingAreas: i.missingAreas.slice(0, 5),
    unknownFactors: i.unknownFactors.slice(0, 5),
  }));
  return { rows, scorecardIsNotSuccess: true, scoreOnlyReturn: false };
}

/* ── 10) Unified Executive Briefing(자동 발송 없음) ──────────────────── */
export const EXECUTIVE_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildUnifiedBriefing(i: { periodKind: string; keyChanges: string[]; keyResults: string[]; keyRisks: string[]; keyOpportunities: string[]; unknownFactors: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; executiveViewIsNotDecision: true } {
  return {
    periodKind: i.periodKind,
    valid: (EXECUTIVE_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'key_changes', items: i.keyChanges.slice(0, 10) },
      { key: 'key_results', items: i.keyResults.slice(0, 10) },
      { key: 'key_risks', items: i.keyRisks.slice(0, 10) },
      { key: 'key_opportunities', items: i.keyOpportunities.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, executiveViewIsNotDecision: true,
  };
}

/* ── 7) Executive Advisory(6종 whitelist·Evidence 필수) ──────────────── */
export function buildExecutiveAdvisory(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(EXECUTIVE_ADVISORY_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 advisory type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(executive_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Approval', 'Executive View ≠ Executive Decision', 'Confidence ≠ Correctness'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 9/12) Executive Cockpit OS(12영역 — 최종 통합 화면) ─────────────── */
export function buildExecutiveCockpitOS(i: { domainCounts: Record<string, number | null>; healthUnknowns: number; advisoriesOpen: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; executiveDecisionMade: false } {
  const n = (x: number | null | undefined) => (x != null && isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'enterprise_overview', headline: `${Object.values(i.domainCounts).filter((v) => v != null).length}/10`, detail: '실측 도메인 수 — Unified ≠ Complete Knowledge' },
      ...ENTERPRISE_DOMAINS.map((d) => ({ key: d, headline: n(i.domainCounts[d]), detail: '읽기 전용 실측 — Executive View ≠ Decision' })),
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : `unknown ${i.healthUnknowns}·advisory ${i.advisoriesOpen}`, detail: i.summaryNote ?? 'Health ≠ Business Success · Recommendation ≠ Approval' },
    ],
    humanDecisionRequired: true, executiveDecisionMade: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const EXECUTIVE_OS_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'unified_intelligence', status: 'supported', note: '10 도메인 실측 통합 조회(전부 읽기 전용)' },
  { key: 'executive_operating_system', status: 'supported', note: '기존 모듈 대체 없음 — 관제/지원 계층' },
  { key: 'cross_domain_correlation', status: 'supported', note: '0525 재사용 — Correlation ≠ Causation' },
  { key: 'enterprise_health', status: 'supported', note: '영역별 독립 평가 — 단일 합산 점수 없음' },
  { key: 'situation_room', status: 'supported', note: '10 status 실측 — 실시간 스트림 원본 없음(조회 시점 기준)' },
  { key: 'unified_timeline', status: 'supported', note: 'Decision→…→Current Status 7단계 실측 집계' },
  { key: 'executive_advisory', status: 'supported', note: '6종 whitelist·8요소 — Recommendation ≠ Approval' },
  { key: 'executive_graph', status: 'supported', note: 'Vision→…→Improvement 9단계 — cycle 감지·인과 주장 없음' },
  { key: 'operating_scorecard', status: 'supported', note: '6 지표 — Evidence/Missing/Unknown 동반 강제' },
  { key: 'unified_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'executive_cockpit_os', status: 'supported', note: '12영역 최종 통합 화면' },
  { key: 'realtime_streaming', status: 'unsupported', note: '실시간 스트림 원본 없음 — 조회 시점 실측만' },
  { key: 'external_erp_bi', status: 'unsupported', note: '외부 ERP/BI/이사회 시스템 원본 없음' },
  { key: 'auto_executive_decision', status: 'unsupported', note: '자동 Executive Decision 금지 — Human Decision 필수' },
  { key: 'auto_strategy_budget_policy', status: 'unsupported', note: '자동 Strategy/KPI/Budget/Policy/계약 변경 금지' },
  { key: 'auto_production_change', status: 'unsupported', note: '자동 Production/Merge/Deploy 금지' },
];
