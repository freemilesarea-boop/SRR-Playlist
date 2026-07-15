/**
 * riskResilience — Enterprise Risk Intelligence/Business Resilience/
 * Continuity Center 순수 로직 (Phase AI-OPS-25).
 *
 * Enterprise → Risk → Business Continuity → Operational Resilience →
 * Recovery Readiness → Executive Risk Advisory.
 * AI는 리스크 분석/관계 설명/복원력 평가/대응 후보 제안만 —
 * 자동 해결/운영 정책 자동 변경/서비스 자동 중단/위기 의사결정 대행 없음.
 *
 * Risk 정직성(전부 코드로 강제):
 *  - Risk ≠ Incident. Likelihood ≠ Reality. Recovery Plan ≠ Recovery Success.
 *  - Continuity ≠ Zero Downtime. Correlation ≠ Causation(의존 관계 인과 확정 아님).
 *  - Recommendation ≠ Operational Decision. Unknown 유지(null→0 금지).
 *  - 표본 부족 sample_too_small. 데이터 부족 insufficient_data. 근거 부족 risk_unverified.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입/상수 ────────────────────────────────────────────────────────── */
export type RiskHeat = 'low' | 'medium' | 'high' | 'critical';

export const RISK_CATEGORIES = ['strategic', 'operational', 'financial', 'market', 'technology', 'compliance', 'security'] as const;
export const RISK_STATUSES = ['open', 'monitoring', 'mitigated', 'closed'] as const;
export const RISK_TIMELINE_STAGES = ['detection', 'investigation', 'mitigation', 'recovery', 'review'] as const;
export const RESILIENCE_COMPONENTS = ['detection_readiness', 'recovery_readiness', 'monitoring_coverage', 'failover_readiness', 'recovery_confidence'] as const;
export const RISK_RECOMMENDATION_TYPES = ['review_risk', 'validate_evidence', 'review_controls', 'improve_monitoring', 'prepare_recovery', 'gather_more_evidence'] as const;

/* ── 5) Risk Heatmap(Likelihood ≠ Reality) ───────────────────────────── */
export function computeRiskHeat(i: { likelihood: number | null; impact: number | null }): { heat: RiskHeat | null; score: number | null; verdict: 'rated' | 'risk_unverified'; likelihoodIsNotReality: true } {
  if (i.likelihood == null || i.impact == null || !isFiniteNumber(i.likelihood) || !isFiniteNumber(i.impact)
    || i.likelihood < 1 || i.likelihood > 5 || i.impact < 1 || i.impact > 5) {
    return { heat: null, score: null, verdict: 'risk_unverified', likelihoodIsNotReality: true };
  }
  const score = i.likelihood * i.impact;
  const heat: RiskHeat = score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 6 ? 'medium' : 'low';
  return { heat, score, verdict: 'rated', likelihoodIsNotReality: true };
}

/* ── 2) Risk Dependency(인과 확정 아님) ──────────────────────────────── */
export function buildRiskDependencyGraph(risks: { id: string; code: string; linkedRiskIds: string[] }[] | null): { edges: { from: string; to: string }[]; isolated: string[]; cycles: string[]; notCausalConfirmation: true } {
  const list = (risks ?? []).slice(0, 100);
  const ids = new Set(list.map((r) => r.id));
  const edges: { from: string; to: string }[] = [];
  for (const r of list) for (const t of r.linkedRiskIds.slice(0, 20)) if (ids.has(t) && t !== r.id) edges.push({ from: r.id, to: t });
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const isolated = list.filter((r) => !linked.has(r.id)).map((r) => r.code);
  const cycles: string[] = [];
  const adj = new Map<string, string[]>();
  for (const e of edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); }
  for (const r of list) {
    const path = new Set<string>([r.id]);
    const stack = [...(adj.get(r.id) ?? [])];
    let depth = 0;
    while (stack.length && depth < 200) {
      depth += 1;
      const cur = stack.pop()!;
      if (path.has(cur)) { cycles.push(`${r.code}→…(순환)`); break; }
      path.add(cur);
      stack.push(...(adj.get(cur) ?? []));
    }
  }
  return { edges: edges.slice(0, 100), isolated: isolated.slice(0, 20), cycles: [...new Set(cycles)].slice(0, 10), notCausalConfirmation: true };
}

/* ── 6) Risk Timeline(5단계 — 완료 보장 아님) ────────────────────────── */
export function buildRiskTimeline(events: { stage: string; at: Date; note: string }[] | null): { stages: { stage: string; entries: { at: string; note: string }[] }[]; invalidStages: number; stageCompletionGuarantee: false } {
  const valid = (events ?? []).filter((e) => (RISK_TIMELINE_STAGES as readonly string[]).includes(e.stage) && e.at instanceof Date && !Number.isNaN(e.at.getTime()));
  return {
    stages: RISK_TIMELINE_STAGES.map((stage) => ({
      stage,
      entries: valid.filter((e) => e.stage === stage).sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 20).map((e) => ({ at: e.at.toISOString(), note: e.note })),
    })),
    invalidStages: (events ?? []).length - valid.length,
    stageCompletionGuarantee: false,
  };
}

/* ── 3) Business Continuity(부분 실측 — Zero Downtime 아님) ──────────── */
export function evaluateContinuity(i: { playStarts: number | null; playerErrors: number | null; incidentsOpen: number | null; storesActive: number | null }): { availabilityProxyPct: number | null; segments: { key: string; value: number | null; status: 'measured_proxy' | 'insufficient_data' }[]; verdict: 'partial_measured' | 'insufficient_data'; continuityIsNotZeroDowntime: true } {
  const proxy = i.playStarts != null && i.playerErrors != null && isFiniteNumber(i.playStarts) && i.playStarts > 0
    ? Math.round((1 - (i.playerErrors as number) / i.playStarts) * 10000) / 100 : null;
  const seg = (key: string, value: number | null) => ({ key, value, status: value != null ? ('measured_proxy' as const) : ('insufficient_data' as const) });
  const segments = [
    seg('playback_continuity_proxy', proxy),
    seg('store_continuity(active stores)', i.storesActive),
    seg('service_continuity(open incidents)', i.incidentsOpen),
    seg('platform_availability', null),   // APM/uptime 원본 없음 — null 유지
    seg('operational_continuity', null),  // 운영 시프트/온콜 원본 없음
  ];
  return { availabilityProxyPct: proxy, segments, verdict: proxy != null ? 'partial_measured' : 'insufficient_data', continuityIsNotZeroDowntime: true };
}

/* ── 4) Operational Resilience(Evidence 없는 컴포넌트 점수 제외) ─────── */
export function evaluateResilience(components: { component: string; score: number | null; evidence: string[] }[]): { overall: number | null; byComponent: { component: string; score: number | null; evidenceCount: number }[]; missingComponents: string[]; unknownFactors: string[]; scoreOnlyReturn: false } {
  const valid = components.filter((c) => (RESILIENCE_COMPONENTS as readonly string[]).includes(c.component));
  const { score, missing } = normalizeAvailableComponents(valid.map((c) => ({ key: c.component, value: c.evidence.length ? c.score : null, weight: 1 })));
  return {
    overall: score,
    byComponent: valid.map((c) => ({ component: c.component, score: c.evidence.length && c.score != null && isFiniteNumber(c.score) ? clampScore(c.score) : null, evidenceCount: c.evidence.length })),
    missingComponents: missing,
    unknownFactors: valid.filter((c) => !c.evidence.length).map((c) => `${c.component}: Evidence 없음 — 점수 제외`),
    scoreOnlyReturn: false,
  };
}

/* ── 7) Control Effectiveness(Control ≠ 제거 보장) ───────────────────── */
export function analyzeControlEffectiveness(i: { risks: { id: string; code: string }[]; controls: { name: string; coveredRiskIds: string[]; evidence: string[] }[] }): { coveragePct: number | null; uncontrolledRisks: string[]; unverifiedControls: string[]; controlIsNotElimination: true } {
  if (!i.risks.length) return { coveragePct: null, uncontrolledRisks: [], unverifiedControls: i.controls.filter((c) => !c.evidence.length).map((c) => c.name), controlIsNotElimination: true };
  const covered = new Set(i.controls.filter((c) => c.evidence.length).flatMap((c) => c.coveredRiskIds));
  const uncontrolled = i.risks.filter((r) => !covered.has(r.id)).map((r) => r.code);
  return {
    coveragePct: clampScore(((i.risks.length - uncontrolled.length) / i.risks.length) * 100),
    uncontrolledRisks: uncontrolled.slice(0, 20),
    unverifiedControls: i.controls.filter((c) => !c.evidence.length).map((c) => c.name).slice(0, 10),
    controlIsNotElimination: true,
  };
}

/* ── 8) Recovery Readiness(Recovery Plan ≠ Recovery Success) ─────────── */
export function evaluateRecoveryReadiness(i: { playbooksReference: number | null; playbooksDraft: number | null; recoveryCandidates: number | null; validationEvidence: string[] }): { verdict: 'readiness_candidate' | 'validation_unverified' | 'insufficient_data'; components: { key: string; value: number | null }[]; recoveryPlanIsNotSuccess: true } {
  const components = [
    { key: 'backup_readiness', value: null as number | null },   // 백업 검증 원본 없음 — null 유지
    { key: 'recovery_playbooks_reference', value: i.playbooksReference },
    { key: 'recovery_playbooks_draft', value: i.playbooksDraft },
    { key: 'recovery_candidates', value: i.recoveryCandidates },
  ];
  if (i.playbooksReference == null && i.recoveryCandidates == null) return { verdict: 'insufficient_data', components, recoveryPlanIsNotSuccess: true };
  if (!i.validationEvidence.length) return { verdict: 'validation_unverified', components, recoveryPlanIsNotSuccess: true };
  return { verdict: 'readiness_candidate', components, recoveryPlanIsNotSuccess: true };
}

/* ── 11) Executive Risk Briefing(자동 발송 없음) ─────────────────────── */
export const RISK_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildRiskBriefing(i: { periodKind: string; newRisks: string[]; changedRisks: string[]; recoveryStatus: string[]; unknownFactors: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; riskIsNotIncident: true } {
  return {
    periodKind: i.periodKind,
    valid: (RISK_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'new_risks', items: i.newRisks.slice(0, 10) },
      { key: 'changed_risks', items: i.changedRisks.slice(0, 10) },
      { key: 'recovery_status', items: i.recoveryStatus.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, riskIsNotIncident: true,
  };
}

/* ── 10) Risk Recommendation(6종 whitelist·Evidence 필수) ────────────── */
export function buildRiskRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(RISK_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(risk_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Operational Decision', 'Risk ≠ Incident', 'Recovery Plan ≠ Recovery Success'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Risk & Resilience Cockpit(7영역) ────────────────────────────── */
export function buildRiskCockpit(i: { registerTotal: number; heatCritical: number; dependencyEdges: number; continuityVerdict: string; resilienceOverall: number | null; recoveryVerdict: string; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; riskAutoResolved: false } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'risk_register', headline: n(i.registerTotal), detail: '사람 등록 Risk — Risk ≠ Incident' },
      { key: 'risk_heatmap', headline: n(i.heatCritical), detail: 'critical 건수 — Likelihood ≠ Reality' },
      { key: 'dependency_graph', headline: n(i.dependencyEdges), detail: '의존 edge — 인과 확정 아님' },
      { key: 'continuity', headline: i.continuityVerdict, detail: 'Continuity ≠ Zero Downtime' },
      { key: 'resilience', headline: i.resilienceOverall == null ? 'insufficient_data' : String(i.resilienceOverall), detail: 'Evidence 없는 컴포넌트 점수 제외' },
      { key: 'recovery', headline: i.recoveryVerdict, detail: 'Recovery Plan ≠ Recovery Success' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, riskAutoResolved: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const RISK_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'risk_register', status: 'supported', note: '7 category·4상태(open/monitoring/mitigated/closed)·closed 는 Evidence 필수' },
  { key: 'risk_dependency', status: 'supported', note: '연결 관계 분석 — 인과 확정 아님' },
  { key: 'risk_heatmap', status: 'supported', note: 'Likelihood×Impact — Likelihood ≠ Reality' },
  { key: 'risk_timeline', status: 'supported', note: 'Detection→Investigation→Mitigation→Recovery→Review 기록' },
  { key: 'playback_continuity_proxy', status: 'partial', note: 'player_error/play_start 실측 Proxy — Zero Downtime 아님' },
  { key: 'platform_availability', status: 'unsupported', note: 'APM/uptime 원본 없음 — insufficient_data 유지' },
  { key: 'incident_reference', status: 'supported', note: 'ai_incidents(0502) 실측 참조 — Risk ≠ Incident' },
  { key: 'monitoring_coverage', status: 'partial', note: 'ai_reliability(0507) indicator 참조 — 전체 커버리지 아님' },
  { key: 'control_effectiveness', status: 'supported', note: 'Evidence 있는 Control 만 — 제거 보장 아님' },
  { key: 'recovery_playbooks', status: 'supported', note: 'ai_playbooks(0502) 실측 — 자동 실행 없음' },
  { key: 'backup_readiness', status: 'unsupported', note: '백업 검증 로그 원본 없음 — null 유지' },
  { key: 'recovery_validation', status: 'partial', note: '검증 Evidence 없으면 validation_unverified' },
  { key: 'risk_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'risk_recommendation', status: 'supported', note: '6종 whitelist·8요소·Human Approval Required' },
  { key: 'auto_incident_creation', status: 'unsupported', note: '자동 Incident 생성/Risk 종료/서비스 중단 금지' },
  { key: 'auto_policy_change', status: 'unsupported', note: '운영 정책/계약/KPI/Production 자동 변경 금지' },
];
