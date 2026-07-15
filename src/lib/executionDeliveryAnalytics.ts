/**
 * executionDeliveryAnalytics — Execution Intelligence/Delivery Analytics/
 * Organizational Performance 순수 로직 (Phase AI-OPS-18).
 *
 * Commitment → Execution → Outcome → Business Impact → Executive Analytics.
 * "약속을 지켰는가"(0520)가 아니라 "실행력이 어떤 결과를 만들었는가"를 분석.
 *
 * Analytics 정직성(전부 코드로 강제):
 *  - 표본<5 → Success Rate/패턴 확정 금지. KPI 상관 ≠ 인과(0517 원칙).
 *  - Delivery Score/패턴 ≠ 인사 평가. 지연 전파 = 후보(확정 영향 아님).
 *  - 완료율 단독 ≠ Delivery Quality(Evidence/Verification/독립성/Accountability 종합).
 *  - Health 점수 단독 표시 금지. Hard Risk 평균 희석 금지. 자동 실행/KPI 변경 없음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · depth/cycle 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type RateStatus = 'measured_reference' | 'sample_too_small' | 'insufficient_data';
export type TrendVerdict = 'improving_candidate' | 'stable_reference' | 'declining_candidate' | 'volatile_candidate' | 'sample_too_small' | 'insufficient_data';
export type BottleneckVerdict = 'no_known_bottleneck' | 'bottleneck_candidate' | 'recurring_bottleneck_candidate' | 'critical_bottleneck_candidate' | 'insufficient_data';
export type PatternVerdict = 'no_known_pattern' | 'isolated_occurrence' | 'repeated_pattern_candidate' | 'persistent_pattern_candidate' | 'sample_too_small' | 'insufficient_data';
export type CorrelationVerdict = 'positive_candidate' | 'negative_candidate' | 'no_known_correlation' | 'mixed' | 'sample_too_small' | 'kpi_unavailable' | 'insufficient_data';
export type HealthStatus = 'healthy_reference' | 'watch_candidate' | 'degraded_candidate' | 'critical_risk_present' | 'insufficient_data';

export const MIN_SAMPLE = 5;

/* ── Commitment Success Rate(표본<5 확정 금지) ──────────────────────── */
export function calculateCommitmentSuccessRate(i: { verifiedComplete: number | null; totalClosed: number | null }): { rate: number | null; status: RateStatus; sampleSize: number; note: string } {
  if (!isFiniteNumber(i.verifiedComplete) || !isFiniteNumber(i.totalClosed) || i.totalClosed <= 0) return { rate: null, status: 'insufficient_data', sampleSize: 0, note: '종결 표본 없음(0 변환 없음)' };
  const rate = clampScore((i.verifiedComplete / i.totalClosed) * 100);
  if (i.totalClosed < MIN_SAMPLE) return { rate, status: 'sample_too_small', sampleSize: i.totalClosed, note: `표본 ${i.totalClosed}<${MIN_SAMPLE} — 확정 금지(참고만)` };
  return { rate, status: 'measured_reference', sampleSize: i.totalClosed, note: 'verified_complete 기반(보고 완료 아님)' };
}

/* ── Delivery Trend ──────────────────────────────────────────────────── */
export function calculateDeliveryTrend(periods: { label: string; rate: number | null }[] | null): { verdict: TrendVerdict; delta: number | null; series: { label: string; rate: number | null }[] } {
  const series = periods ?? [];
  const valid = series.filter((p): p is { label: string; rate: number } => p.rate != null && isFiniteNumber(p.rate));
  if (valid.length < 2) return { verdict: valid.length === 0 ? 'insufficient_data' : 'sample_too_small', delta: null, series };
  const first = valid[0].rate; const last = valid[valid.length - 1].rate;
  const diffs = valid.slice(1).map((p, idx) => Math.abs(p.rate - valid[idx].rate));
  const volatility = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const delta = Math.round((last - first) * 100) / 100;
  if (volatility >= 25) return { verdict: 'volatile_candidate', delta, series };
  if (delta >= 10) return { verdict: 'improving_candidate', delta, series };
  if (delta <= -10) return { verdict: 'declining_candidate', delta, series };
  return { verdict: 'stable_reference', delta, series };
}

/* ── Domain(부서 대체)/Initiative/Portfolio/Priority Delivery ────────── */
export function calculateDomainDelivery(commitments: { domain: string; verified: boolean; closed: boolean }[] | null): { domain: string; rate: number | null; status: RateStatus; total: number }[] {
  if (!commitments?.length) return [];
  const byDomain = new Map<string, { verified: number; closed: number; total: number }>();
  for (const c of commitments) {
    if (!byDomain.has(c.domain)) byDomain.set(c.domain, { verified: 0, closed: 0, total: 0 });
    const d = byDomain.get(c.domain)!;
    d.total += 1;
    if (c.closed) { d.closed += 1; if (c.verified) d.verified += 1; }
  }
  return [...byDomain.entries()].map(([domain, d]) => {
    const r = calculateCommitmentSuccessRate({ verifiedComplete: d.verified, totalClosed: d.closed });
    return { domain, rate: r.rate, status: r.status, total: d.total };
  }).sort((a, b) => b.total - a.total);
}

/* ── Executive Delivery Score(인사 평가 아님·점수 단독 금지) ─────────── */
export function calculateExecutiveDeliveryScore(c: { successRate: number | null; verifiedProgressAvg: number | null; onScheduleRate: number | null; qualityScore: number | null }): { score: number | null; used: string[]; missing: string[]; notPersonnelEvaluation: true; limitations: string[] } {
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'success_rate', value: c.successRate, weight: 0.35 },
    { key: 'verified_progress', value: c.verifiedProgressAvg, weight: 0.25 },
    { key: 'on_schedule', value: c.onScheduleRate, weight: 0.2 },
    { key: 'quality', value: c.qualityScore, weight: 0.2 },
  ]);
  return { score: score == null ? null : clampScore(score), used, missing, notPersonnelEvaluation: true, limitations: ['점수 단독 해석 금지 — 구성 요소/누락 동시 확인', '인사 평가 아님'] };
}

/* ── Execution Bottleneck(반복 단계/Blocker/Dependency/Drift/Delay) ──── */
export function detectExecutionBottleneck(occurrences: { stage: string; commitmentCode: string }[] | null): { verdict: BottleneckVerdict; stages: { stage: string; count: number }[]; personBlamed: false } {
  if (occurrences == null) return { verdict: 'insufficient_data', stages: [], personBlamed: false };
  if (!occurrences.length) return { verdict: 'no_known_bottleneck', stages: [], personBlamed: false };
  const byStage = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (!byStage.has(o.stage)) byStage.set(o.stage, new Set());
    byStage.get(o.stage)!.add(o.commitmentCode);
  }
  const stages = [...byStage.entries()].map(([stage, codes]) => ({ stage, count: codes.size })).sort((a, b) => b.count - a.count);
  const max = stages[0]?.count ?? 0;
  if (max >= 5) return { verdict: 'critical_bottleneck_candidate', stages, personBlamed: false };
  if (max >= 3) return { verdict: 'recurring_bottleneck_candidate', stages, personBlamed: false };
  return { verdict: 'bottleneck_candidate', stages, personBlamed: false };
}

/* ── Cross Commitment Impact(전파 후보 — 확정 영향 아님) ─────────────── */
export function analyzeCrossCommitmentImpact(chain: { code: string; delayDays: number | null; dependsOn: string | null }[] | null): { impacted: { code: string; upstreamDelay: number; note: string }[]; confirmedImpact: false; causallyAttributed: false } {
  if (!chain?.length) return { impacted: [], confirmedImpact: false, causallyAttributed: false };
  const byCode = new Map(chain.map((c) => [c.code, c]));
  const impacted: { code: string; upstreamDelay: number; note: string }[] = [];
  for (const c of chain) {
    let upstreamDelay = 0;
    let cursor = c.dependsOn;
    const visited = new Set<string>([c.code]);
    while (cursor && byCode.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      const up = byCode.get(cursor)!;
      if (up.delayDays != null && isFiniteNumber(up.delayDays) && up.delayDays > 0) upstreamDelay += up.delayDays;
      cursor = up.dependsOn;
    }
    if (upstreamDelay > 0) impacted.push({ code: c.code, upstreamDelay, note: `선행 지연 누적 ${upstreamDelay}일 — 영향 후보(확정 아님)` });
  }
  return { impacted, confirmedImpact: false, causallyAttributed: false };
}

/* ── Strategic Execution Graph(depth/cycle 방어) ─────────────────────── */
export const EXECUTION_GRAPH_STAGES = ['decision', 'commitment', 'milestone', 'evidence', 'completion', 'outcome', 'learning'] as const;

export function buildStrategicExecutionGraph(nodes: { id: string; stage: string; label: string; ref: string | null }[] | null, edges: { from: string; to: string }[] | null): { stages: { stage: string; nodes: { id: string; label: string }[] }[]; orphanEdges: string[]; cycles: string[] } {
  const validNodes = (nodes ?? []).filter((n) => (EXECUTION_GRAPH_STAGES as readonly string[]).includes(n.stage));
  const nodeIds = new Set(validNodes.map((n) => n.id));
  const orphanEdges = (edges ?? []).filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to)).map((e) => `${e.from}→${e.to}`);
  const adjacency = new Map<string, string[]>();
  for (const e of edges ?? []) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e.to);
  }
  const cycles: string[] = [];
  const visit = (id: string, path: string[]) => {
    if (path.length > 10) return;   // depth 방어
    for (const next of adjacency.get(id) ?? []) {
      if (path.includes(next)) { cycles.push([...path, next].join('→')); continue; }
      visit(next, [...path, next]);
    }
  };
  for (const n of validNodes) visit(n.id, [n.id]);
  return {
    stages: EXECUTION_GRAPH_STAGES.map((stage) => ({ stage, nodes: validNodes.filter((n) => n.stage === stage).slice(0, 30).map((n) => ({ id: n.id, label: n.label })) })),
    orphanEdges, cycles: [...new Set(cycles)].slice(0, 10),
  };
}

/* ── Executive Timeline(오늘/주/월/분기/연) ──────────────────────────── */
export function buildExecutiveTimeline(items: { at: Date; kind: string; label: string }[] | null, now: Date): { today: number; thisWeek: number; thisMonth: number; thisQuarter: number; thisYear: number; buckets: Record<'today' | 'week' | 'month' | 'quarter' | 'year', { kind: string; label: string }[]> } {
  const buckets: Record<'today' | 'week' | 'month' | 'quarter' | 'year', { kind: string; label: string }[]> = { today: [], week: [], month: [], quarter: [], year: [] };
  for (const i of items ?? []) {
    const ageDays = (now.getTime() - i.at.getTime()) / 86400000;
    if (ageDays < 0 || ageDays > 366) continue;
    const entry = { kind: i.kind, label: i.label };
    if (ageDays <= 1) buckets.today.push(entry);
    if (ageDays <= 7) buckets.week.push(entry);
    if (ageDays <= 31) buckets.month.push(entry);
    if (ageDays <= 92) buckets.quarter.push(entry);
    buckets.year.push(entry);
  }
  for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[k] = buckets[k].slice(0, 50);
  return { today: buckets.today.length, thisWeek: buckets.week.length, thisMonth: buckets.month.length, thisQuarter: buckets.quarter.length, thisYear: buckets.year.length, buckets };
}

/* ── Organizational Delivery Pattern(개인 단정 금지·표본 방어) ───────── */
export function detectDeliveryPattern(occurrences: { patternKind: string; commitmentCode: string }[] | null): { verdict: PatternVerdict; patterns: { kind: string; count: number }[]; personBlamed: false } {
  if (occurrences == null) return { verdict: 'insufficient_data', patterns: [], personBlamed: false };
  if (!occurrences.length) return { verdict: 'no_known_pattern', patterns: [], personBlamed: false };
  const byKind = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (!byKind.has(o.patternKind)) byKind.set(o.patternKind, new Set());
    byKind.get(o.patternKind)!.add(o.commitmentCode);
  }
  const patterns = [...byKind.entries()].map(([kind, codes]) => ({ kind, count: codes.size })).sort((a, b) => b.count - a.count);
  const max = patterns[0]?.count ?? 0;
  const distinct = new Set(occurrences.map((o) => o.commitmentCode)).size;
  if (distinct < 3) return { verdict: 'sample_too_small', patterns, personBlamed: false };
  if (max >= 4) return { verdict: 'persistent_pattern_candidate', patterns, personBlamed: false };
  if (max >= 2) return { verdict: 'repeated_pattern_candidate', patterns, personBlamed: false };
  return { verdict: 'isolated_occurrence', patterns, personBlamed: false };
}

/* ── Delivery Quality(완료율 단독 아님) ─────────────────────────────── */
export function calculateDeliveryQuality(c: { evidenceCoverage: number | null; verificationCoverage: number | null; reviewerIndependence: number | null; accountabilityCoverage: number | null }): { score: number | null; used: string[]; missing: string[]; completionRateOnly: false; limitations: string[] } {
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'evidence', value: c.evidenceCoverage, weight: 0.3 },
    { key: 'verification', value: c.verificationCoverage, weight: 0.3 },
    { key: 'independence', value: c.reviewerIndependence, weight: 0.2 },
    { key: 'accountability', value: c.accountabilityCoverage, weight: 0.2 },
  ]);
  return { score: score == null ? null : clampScore(score), used, missing, completionRateOnly: false, limitations: ['단순 완료율 아님 — Evidence/Verification/독립성/Accountability 종합', '점수 단독 해석 금지'] };
}

/* ── Strategic KPI Correlation(상관 ≠ 인과) ─────────────────────────── */
export function correlateKpi(i: { deliverySeries: (number | null)[]; kpiSeries: (number | null)[]; kpiAvailable: boolean }): { verdict: CorrelationVerdict; pairs: number; causallyAttributed: false; note: string } {
  if (!i.kpiAvailable) return { verdict: 'kpi_unavailable', pairs: 0, causallyAttributed: false, note: 'KPI 원본 없음(실측) — 임의 생성 금지' };
  const pairs = i.deliverySeries.map((d, idx) => [d, i.kpiSeries[idx]] as const).filter(([d, k]) => d != null && k != null && isFiniteNumber(d) && isFiniteNumber(k)) as [number, number][];
  if (pairs.length === 0) return { verdict: 'insufficient_data', pairs: 0, causallyAttributed: false, note: '대응 표본 없음' };
  if (pairs.length < MIN_SAMPLE) return { verdict: 'sample_too_small', pairs: pairs.length, causallyAttributed: false, note: `표본 ${pairs.length}<${MIN_SAMPLE} — 상관 확정 금지` };
  let up = 0; let down = 0;
  for (let idx = 1; idx < pairs.length; idx += 1) {
    const dDelta = pairs[idx][0] - pairs[idx - 1][0];
    const kDelta = pairs[idx][1] - pairs[idx - 1][1];
    if (dDelta === 0 || kDelta === 0) continue;
    if (dDelta * kDelta > 0) up += 1; else down += 1;
  }
  if (up === 0 && down === 0) return { verdict: 'no_known_correlation', pairs: pairs.length, causallyAttributed: false, note: '방향 신호 없음' };
  if (up > 0 && down > 0 && Math.min(up, down) / (up + down) >= 0.34) return { verdict: 'mixed', pairs: pairs.length, causallyAttributed: false, note: '혼재 — 상관 ≠ 인과' };
  return { verdict: up >= down ? 'positive_candidate' : 'negative_candidate', pairs: pairs.length, causallyAttributed: false, note: '상관 후보 — 인과 검토는 0517 워크플로만' };
}

/* ── Organizational Execution Health(희석 금지·점수 단독 금지) ───────── */
export function calculateExecutionHealth(c: {
  deliveryHealth: number | null; executionStability: number | null; throughput: number | null;
  reviewLatency: number | null; evidenceCoverage: number | null; completionQuality: number | null;
  accountabilityCoverage: number | null; deliveryConfidence: number | null; strategicProgress: number | null;
  criticalRisks: string[] | null;
}): { score: number | null; status: HealthStatus; criticalRisks: string[]; coverage: number; missing: string[]; limitations: string[]; standaloneScoreDisplay: false } {
  const criticalRisks = c.criticalRisks ?? [];
  const components = [
    { key: 'delivery', value: c.deliveryHealth, weight: 0.15 },
    { key: 'stability', value: c.executionStability, weight: 0.12 },
    { key: 'throughput', value: c.throughput, weight: 0.1 },
    { key: 'review_latency', value: c.reviewLatency, weight: 0.1 },
    { key: 'evidence', value: c.evidenceCoverage, weight: 0.13 },
    { key: 'completion_quality', value: c.completionQuality, weight: 0.13 },
    { key: 'accountability', value: c.accountabilityCoverage, weight: 0.1 },
    { key: 'confidence', value: c.deliveryConfidence, weight: 0.07 },
    { key: 'strategic', value: c.strategicProgress, weight: 0.1 },
  ];
  const { score, used, missing } = normalizeAvailableComponents(components);
  const coverage = clampScore((used.length / components.length) * 100);
  const limitations = ['Health 점수 단독 표시 금지', 'Critical Risk 평균 희석 금지', '인사 평가 아님'];
  if (criticalRisks.length > 0) return { score: score == null ? null : clampScore(score), status: 'critical_risk_present', criticalRisks, coverage, missing, limitations, standaloneScoreDisplay: false };
  if (score == null) return { score: null, status: 'insufficient_data', criticalRisks, coverage, missing, limitations, standaloneScoreDisplay: false };
  const s = clampScore(score);
  return { score: s, status: s >= 75 ? 'healthy_reference' : s >= 50 ? 'watch_candidate' : 'degraded_candidate', criticalRisks, coverage, missing, limitations, standaloneScoreDisplay: false };
}

/* ── Executive Cockpit(8 영역·자동 실행 없음) ───────────────────────── */
export function buildExecutiveCockpit(i: {
  strategy: { openPriorities: number; selectedPortfolios: number };
  commitments: { total: number; active: number; blocked: number };
  delivery: { rate: number | null; rateStatus: RateStatus };
  businessImpact: { outcomesObserved: number; kpiCorrelations: number };
  health: { score: number | null; status: HealthStatus };
  risks: string[];
}): { sections: { key: string; headline: string; detail: string }[]; autoExecution: false; limitations: string[] } {
  const sections = [
    { key: 'strategy', headline: `Priority ${i.strategy.openPriorities}건 · Portfolio ${i.strategy.selectedPortfolios}건`, detail: '전략 선택 현황(실행 아님)' },
    { key: 'portfolio', headline: `선택 Portfolio ${i.strategy.selectedPortfolios}건`, detail: 'selected_reference — 실행 계획 아님' },
    { key: 'commitment', headline: `Commitment ${i.commitments.total}건(활성 ${i.commitments.active})`, detail: `blocked ${i.commitments.blocked}건` },
    { key: 'delivery', headline: i.delivery.rate == null ? 'Success Rate 산출 불가' : `Success Rate ${Math.round(i.delivery.rate)}% (${i.delivery.rateStatus})`, detail: 'verified_complete 기반 — 보고 완료 아님' },
    { key: 'business_impact', headline: `Outcome 관측 ${i.businessImpact.outcomesObserved}건 · KPI 상관 ${i.businessImpact.kpiCorrelations}건`, detail: '상관 ≠ 인과' },
    { key: 'organizational_health', headline: i.health.score == null ? i.health.status : `${i.health.score} (${i.health.status})`, detail: '점수 단독 해석 금지' },
    { key: 'risk', headline: i.risks.length ? `Risk ${i.risks.length}건` : '알려진 Critical Risk 없음', detail: i.risks.slice(0, 3).join(' · ') || '—' },
    { key: 'executive_summary', headline: '사람 검토용 요약', detail: '자동 결정/실행/평가 없음' },
  ];
  return { sections, autoExecution: false, limitations: ['Cockpit 은 검토 화면 — 자동 업무/일정/KPI/Outcome 변경 없음'] };
}

/* ── Delivery Recommendation(Evidence 필수·사람 승인) ───────────────── */
export const DELIVERY_RECOMMENDATION_TYPES = ['review_recurring_bottleneck', 'review_delivery_decline', 'review_cross_commitment_delay', 'improve_evidence_coverage', 'improve_verification_coverage', 'review_reviewer_independence', 'review_accountability_coverage', 'prepare_kpi_correlation_review', 'request_causal_review_reference', 'review_execution_health', 'insufficient_data'] as const;
export type DeliveryRecommendationType = (typeof DELIVERY_RECOMMENDATION_TYPES)[number];

export function buildDeliveryRecommendation(i: { type: string; reason: string; evidence: string[]; severity: 'critical' | 'high' | 'moderate' | 'low' }): { type: DeliveryRecommendationType; reason: string; evidence: string[]; severity: string; humanApprovalRequired: true; autoExecuted: false } | { rejected: true; why: string } {
  if (!(DELIVERY_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 권고 유형: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 권고 금지' };
  if (!i.reason.trim()) return { rejected: true, why: '사유 필수' };
  return { type: i.type as DeliveryRecommendationType, reason: i.reason, evidence: i.evidence, severity: i.severity, humanApprovalRequired: true, autoExecuted: false };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const DELIVERY_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'success_rate', label: 'Commitment Success Rate', status: 'supported', note: 'verified_complete(0520) 기반 — 표본<5 확정 금지' },
  { key: 'delivery_trend', label: 'Delivery Trend', status: 'supported', note: '기간별 rate — 표본 부족 시 sample_too_small' },
  { key: 'department_delivery', label: 'Department Delivery', status: 'partial', note: '부서 구조 없음(실측) — Domain 단위 대체 분석' },
  { key: 'initiative_delivery', label: 'Strategic Initiative Delivery', status: 'partial', note: '0516 initiative 참조 — commitment 연결 시에만' },
  { key: 'portfolio_delivery', label: 'Portfolio Delivery', status: 'supported', note: '0519 portfolio FK 실측' },
  { key: 'priority_delivery', label: 'Priority Delivery', status: 'supported', note: '0518 priority FK 실측' },
  { key: 'executive_delivery_score', label: 'Executive Delivery Score', status: 'supported', note: '재정규화 — 인사 평가 아님·점수 단독 금지' },
  { key: 'bottleneck', label: 'Execution Bottleneck', status: 'supported', note: '반복 단계/Blocker/Dependency/Drift/Delay — 개인 단정 금지' },
  { key: 'cross_commitment', label: 'Cross Commitment Analytics', status: 'supported', note: '지연 전파 후보 — 확정 영향/인과 아님' },
  { key: 'execution_graph', label: 'Strategic Execution Graph', status: 'supported', note: 'Decision→…→Learning 7단계 — cycle/depth 방어' },
  { key: 'executive_timeline', label: 'Executive Timeline', status: 'supported', note: '오늘/주/월/분기/연 버킷 — 이벤트 실측' },
  { key: 'delivery_pattern', label: 'Organizational Delivery Pattern', status: 'supported', note: '표본<3 판정 금지 — 개인 능력 단정 금지' },
  { key: 'delivery_quality', label: 'Delivery Quality', status: 'supported', note: '완료율 단독 아님 — Evidence/Verification/독립성/Accountability' },
  { key: 'kpi_revenue', label: 'KPI: Revenue/MRR', status: 'supported', note: 'subscriptions/payment_orders 실측' },
  { key: 'kpi_growth', label: 'KPI: Growth/Store/Artist', status: 'supported', note: 'users 실측' },
  { key: 'kpi_playlist_quality', label: 'KPI: Playlist Quality', status: 'partial', note: '전용 품질 지표 없음 — playback 참조만' },
  { key: 'kpi_csat', label: 'KPI: Customer Satisfaction', status: 'unsupported', note: 'kpi_unavailable — 지표 원본 없음(실측)' },
  { key: 'kpi_correlation', label: 'Strategic KPI Correlation', status: 'supported', note: '상관 후보만 — 인과 검토는 0517 워크플로' },
  { key: 'execution_health', label: 'Organizational Execution Health', status: 'supported', note: '9 성분 재정규화 — Critical Risk 희석 금지' },
  { key: 'executive_cockpit', label: 'Executive Cockpit', status: 'supported', note: '8영역 검토 화면 — 자동 실행 없음' },
  { key: 'delivery_recommendation', label: 'Delivery Recommendation', status: 'supported', note: '11종 whitelist · Evidence 필수 · 사람 승인' },
  { key: 'snapshot', label: 'Delivery Snapshot', status: 'supported', note: '덮어쓰기 금지 · 표본<5 서버 강제' },
  { key: 'auto_work_assignment', label: '자동 업무 배정/일정 변경', status: 'unsupported', note: '전면 금지(AI-OPS-17 원칙 유지)' },
  { key: 'auto_kpi_change', label: '자동 KPI/Outcome/Budget 변경', status: 'unsupported', note: '전면 금지' },
  { key: 'auto_owner_change', label: '자동 Owner/Commitment 변경', status: 'unsupported', note: '전면 금지' },
  { key: 'production_apply', label: 'Production/Merge/Deploy', status: 'unsupported', note: '미지원(의도적)' },
];
