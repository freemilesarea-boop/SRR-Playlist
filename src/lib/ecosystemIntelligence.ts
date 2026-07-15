/**
 * ecosystemIntelligence — Enterprise Ecosystem Intelligence/Partner Network/
 * External Dependency Center 순수 로직 (Phase AI-OPS-27).
 *
 * Enterprise → Partners → External Services → Dependencies →
 * Ecosystem Health → Executive Ecosystem Advisory.
 * AI는 파트너/의존성/공급망 분석만 — 자동 파트너 등록/계약·API·공급사·Provider 변경 없음.
 *
 * Ecosystem 정직성(전부 코드로 강제):
 *  - Dependency ≠ Failure. Availability ≠ SLA Guarantee. Partner ≠ Trust.
 *  - Integration ≠ Compatibility Guarantee. Risk ≠ Incident.
 *  - Recommendation ≠ Business Decision. Unknown 유지(null→0 금지).
 *  - 표본 부족 sample_too_small. 데이터 부족 insufficient_data.
 *  - 외부 데이터 부족 ecosystem_unavailable. 근거 부족 ecosystem_unverified.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · cycle 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const PARTNER_KINDS = ['strategic', 'technology', 'infrastructure', 'payment', 'content', 'ai_provider', 'external_vendor'] as const;
export const PARTNER_STATUSES = ['active', 'monitoring', 'suspended', 'unknown'] as const;
export const DEPENDENCY_GRAPH_LEVELS = ['enterprise', 'platform', 'partner', 'api', 'infrastructure'] as const;
export const ECOSYSTEM_RISK_KINDS = ['partner_risk', 'api_risk', 'infrastructure_risk', 'vendor_risk', 'supply_chain_risk'] as const;
export const ECOSYSTEM_RECOMMENDATION_TYPES = ['review_dependency', 'validate_partner', 'improve_integration', 'gather_external_evidence', 'monitor_ecosystem', 'review_vendor_risk'] as const;

/* ── 2) External Dependency(읽기 전용 분석 — Dependency ≠ Failure) ───── */
export function analyzeDependencies(deps: { code: string; domain: string; criticality: string; fallbackAvailable: boolean | null }[] | null): { total: number; byCriticality: Record<string, number>; noFallback: string[]; fallbackUnknown: string[]; dependencyIsNotFailure: true; readOnlyAnalysis: true } {
  const list = (deps ?? []).slice(0, 200);
  const byCriticality: Record<string, number> = {};
  for (const d of list) byCriticality[d.criticality] = (byCriticality[d.criticality] ?? 0) + 1;
  return {
    total: list.length,
    byCriticality,
    noFallback: list.filter((d) => d.fallbackAvailable === false).map((d) => d.code).slice(0, 20),
    fallbackUnknown: list.filter((d) => d.fallbackAvailable == null).map((d) => d.code).slice(0, 20),   // null 유지(false 아님)
    dependencyIsNotFailure: true, readOnlyAnalysis: true,
  };
}

/* ── 3) Ecosystem Health(실측 없으면 ecosystem_unavailable) ──────────── */
export function evaluateEcosystemHealth(i: { availabilityProxyPct: number | null; reliabilitySample: number | null; latencyMs: number | null; slaStatus: string | null; integrationSignal: number | null }): { components: { key: string; value: number | string | null; status: 'measured_proxy' | 'ecosystem_unavailable' }[]; verdict: 'partial_measured' | 'ecosystem_unavailable'; availabilityIsNotSlaGuarantee: true } {
  const comp = (key: string, value: number | string | null) => ({ key, value, status: value != null ? ('measured_proxy' as const) : ('ecosystem_unavailable' as const) });
  const components = [
    comp('availability_proxy', i.availabilityProxyPct),
    comp('reliability_sample', i.reliabilitySample),
    comp('latency_ms', i.latencyMs),
    comp('sla_status', i.slaStatus),
    comp('integration_signal', i.integrationSignal),
  ];
  return { components, verdict: components.some((c) => c.status === 'measured_proxy') ? 'partial_measured' : 'ecosystem_unavailable', availabilityIsNotSlaGuarantee: true };
}

/* ── 4) Partner Performance(Evidence 없으면 ecosystem_unverified) ────── */
export function analyzePartnerPerformance(i: { partner: string; incidentCount: number | null; failureRatePct: number | null; sample: number; evidence: string[] }): { partner: string; verdict: 'performance_observed' | 'sample_too_small' | 'ecosystem_unverified' | 'insufficient_data'; partnerIsNotTrust: true } {
  if (!i.evidence.length) return { partner: i.partner, verdict: 'ecosystem_unverified', partnerIsNotTrust: true };
  if (i.incidentCount == null && i.failureRatePct == null) return { partner: i.partner, verdict: 'insufficient_data', partnerIsNotTrust: true };
  if (i.sample < 5) return { partner: i.partner, verdict: 'sample_too_small', partnerIsNotTrust: true };
  return { partner: i.partner, verdict: 'performance_observed', partnerIsNotTrust: true };
}

/* ── 5) Integration(호환 보장 아님) ──────────────────────────────────── */
export function analyzeIntegration(integrations: { name: string; lifecycleStatus: string | null; deprecated: boolean | null }[] | null): { total: number; active: number; deprecatedCount: number; lifecycleUnknown: string[]; coveragePct: number | null; integrationIsNotCompatibilityGuarantee: true } {
  const list = (integrations ?? []).slice(0, 100);
  const active = list.filter((x) => x.lifecycleStatus === 'active').length;
  return {
    total: list.length,
    active,
    deprecatedCount: list.filter((x) => x.deprecated === true || x.lifecycleStatus === 'deprecated').length,
    lifecycleUnknown: list.filter((x) => x.lifecycleStatus == null).map((x) => x.name).slice(0, 10),
    coveragePct: list.length ? clampScore((active / list.length) * 100) : null,
    integrationIsNotCompatibilityGuarantee: true,
  };
}

/* ── 6) Dependency Graph(5단계 — cycle 은 감지만, 원인 단정 아님) ────── */
export function buildDependencyGraph(nodes: { id: string; level: string; label: string; parentId: string | null }[] | null): { levels: { level: string; nodes: { id: string; label: string; linked: boolean }[] }[]; orphans: string[]; cycles: string[]; cycleIsNotCauseClaim: true } {
  const valid = (nodes ?? []).filter((n) => (DEPENDENCY_GRAPH_LEVELS as readonly string[]).includes(n.level));
  const ids = new Set(valid.map((n) => n.id));
  const orphans = valid.filter((n) => n.level !== 'enterprise' && (!n.parentId || !ids.has(n.parentId))).map((n) => n.id);
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
    levels: DEPENDENCY_GRAPH_LEVELS.map((level) => ({ level, nodes: valid.filter((n) => n.level === level).slice(0, 30).map((n) => ({ id: n.id, label: n.label, linked: !orphans.includes(n.id) })) })),
    orphans: orphans.slice(0, 20), cycles: [...new Set(cycles)].slice(0, 10), cycleIsNotCauseClaim: true,
  };
}

/* ── 7) Supply Chain(실측/미존재 구분) ───────────────────────────────── */
export function analyzeSupplyChain(segments: { key: string; measuredValue: number | null; note: string }[] | null): { segments: { key: string; value: number | null; status: 'measured' | 'ecosystem_unavailable'; note: string }[]; measuredCount: number; verdict: 'partial_measured' | 'ecosystem_unavailable' } {
  const rows = (segments ?? []).slice(0, 10).map((s) => ({
    key: s.key, value: s.measuredValue != null && isFiniteNumber(s.measuredValue) ? s.measuredValue : null,
    status: s.measuredValue != null && isFiniteNumber(s.measuredValue) ? ('measured' as const) : ('ecosystem_unavailable' as const),
    note: s.note,
  }));
  const measuredCount = rows.filter((r) => r.status === 'measured').length;
  return { segments: rows, measuredCount, verdict: measuredCount > 0 ? 'partial_measured' : 'ecosystem_unavailable' };
}

/* ── 8) Ecosystem Risk(Low/Medium/High/Unknown 만 — Risk ≠ Incident) ─── */
export function assessEcosystemRisk(i: { kind: string; signal: number | null; highThreshold: number; mediumThreshold: number; evidence: string[] }): { kind: string; level: 'low' | 'medium' | 'high' | 'unknown'; verdict: 'ok' | 'ecosystem_unverified'; riskIsNotIncident: true } {
  if (!(ECOSYSTEM_RISK_KINDS as readonly string[]).includes(i.kind)) return { kind: i.kind, level: 'unknown', verdict: 'ecosystem_unverified', riskIsNotIncident: true };
  if (!i.evidence.length) return { kind: i.kind, level: 'unknown', verdict: 'ecosystem_unverified', riskIsNotIncident: true };
  if (i.signal == null || !isFiniteNumber(i.signal)) return { kind: i.kind, level: 'unknown', verdict: 'ok', riskIsNotIncident: true };
  return { kind: i.kind, level: i.signal >= i.highThreshold ? 'high' : i.signal >= i.mediumThreshold ? 'medium' : 'low', verdict: 'ok', riskIsNotIncident: true };
}

/* ── 11) Executive Ecosystem Briefing(자동 발송 없음) ────────────────── */
export const ECOSYSTEM_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildEcosystemBriefing(i: { periodKind: string; partnerChanges: string[]; dependencyChanges: string[]; integrationStatus: string[]; unknownFactors: string[]; recommendations: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; partnerIsNotTrust: true } {
  return {
    periodKind: i.periodKind,
    valid: (ECOSYSTEM_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'partner_changes', items: i.partnerChanges.slice(0, 10) },
      { key: 'dependency_changes', items: i.dependencyChanges.slice(0, 10) },
      { key: 'integration_status', items: i.integrationStatus.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
      { key: 'recommendations', items: i.recommendations.slice(0, 10) },
    ],
    autoSendDisabled: true, partnerIsNotTrust: true,
  };
}

/* ── 10) Ecosystem Recommendation(6종 whitelist·Evidence 필수) ───────── */
export function buildEcosystemRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(ECOSYSTEM_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(ecosystem_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Business Decision', 'Partner ≠ Trust', 'Dependency ≠ Failure'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Ecosystem Cockpit(7영역) ────────────────────────────────────── */
export function buildEcosystemCockpit(i: { partnersTotal: number; dependencyTotal: number; healthVerdict: string; integrationCoverage: number | null; supplyChainVerdict: string; risksHigh: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; contractChanged: false } {
  const n = (x: number) => (isFiniteNumber(x) ? String(x) : 'insufficient_data');
  return {
    sections: [
      { key: 'partner_registry', headline: n(i.partnersTotal), detail: '사람 등록 파트너 — Partner ≠ Trust' },
      { key: 'dependency_graph', headline: n(i.dependencyTotal), detail: '0508 실측 의존성 — Dependency ≠ Failure' },
      { key: 'ecosystem_health', headline: i.healthVerdict, detail: 'Availability ≠ SLA Guarantee' },
      { key: 'integration', headline: i.integrationCoverage == null ? 'insufficient_data' : `${i.integrationCoverage}%`, detail: 'Integration ≠ Compatibility Guarantee' },
      { key: 'supply_chain', headline: i.supplyChainVerdict, detail: '실측/미존재 구분 표기' },
      { key: 'risks', headline: n(i.risksHigh), detail: 'high risk 건수 — Risk ≠ Incident' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, contractChanged: false,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const ECOSYSTEM_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'partner_registry', status: 'supported', note: '7 kind·4상태(active/monitoring/suspended/unknown) 사람 등록' },
  { key: 'dependency_registry', status: 'supported', note: 'ai_operational_dependencies(0508) 실측 — 읽기 전용 분석' },
  { key: 'dependency_criticality', status: 'supported', note: 'criticality/fallback 실측 — Dependency ≠ Failure' },
  { key: 'dependency_graph', status: 'supported', note: '5단계 + cycle 감지(원인 단정 아님)' },
  { key: 'provider_usage', status: 'supported', note: 'ai_cost_snapshots(0508) provider 실측' },
  { key: 'payment_flow', status: 'supported', note: 'payment_orders(payapp) 실측' },
  { key: 'content_supply', status: 'supported', note: 'tracks/artist 실측' },
  { key: 'incident_reference', status: 'supported', note: 'ai_incidents(0502) api_failure 실측 참조' },
  { key: 'availability_sla', status: 'unsupported', note: '외부 SLA/uptime 원본 없음 — ecosystem_unavailable' },
  { key: 'latency_measurement', status: 'unsupported', note: 'latency 측정 원본 없음 — ecosystem_unavailable' },
  { key: 'api_version_lifecycle', status: 'partial', note: '0508 lifecycle_status 만 — 버전 레지스트리 없음' },
  { key: 'partner_performance', status: 'partial', note: '내부 incident/결제 실패 실측만 — 파트너 리포트 없음' },
  { key: 'ecosystem_risk', status: 'supported', note: 'Low/Medium/High/Unknown — Evidence 필수' },
  { key: 'ecosystem_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'auto_partner_registration', status: 'unsupported', note: '자동 파트너 등록/계약 변경 금지' },
  { key: 'auto_provider_change', status: 'unsupported', note: '자동 API/공급사/클라우드/AI Provider 변경 금지' },
];
