/**
 * fleetIntel — Enterprise Fleet Intelligence & Cross-Enterprise Benchmarking 순수 로직 (Phase AI-MUSIC-13).
 *
 * Store → Fleet → Region → Enterprise → Industry → Global 계층을 읽기 전용 집계로 분석한다.
 * Cross-Enterprise 는 익명화된 집계만 사용(원본 franchise 이름/ID 미노출).
 * Best Practice/Opportunity/Recommendation 은 검토 후보(Evidence)일 뿐 —
 * 자동 Apply/Publish/Rollout/Scheduler/Queue/Playback 변경 없음.
 *
 * 원칙: deterministic · 없는 성분 null 유지 + 재정규화(null→0 금지) · NaN/Infinity 방어 ·
 *       상관≠인과 · 단일 Store 결과의 Fleet 일반화 금지.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents, type Component } from './aiMemory';

export { isFiniteNumber, clampScore };

export const FLEET_SOURCE_VERSION = 'fleet_v1(0500)';

/* ── Scope ──────────────────────────────────────────────────────────────── */
export type FleetScope = 'store' | 'brand' | 'enterprise' | 'region' | 'industry' | 'global';
export const FLEET_SCOPES: Array<{ scope: FleetScope; label: string; support: 'supported' | 'partially_supported' | 'insufficient_data'; note: string }> = [
  { scope: 'store', label: 'Store', support: 'partially_supported', note: '익명 store 코드 집계(개별 원본 미노출)' },
  { scope: 'brand', label: 'Brand', support: 'insufficient_data', note: '별도 Brand 계층 데이터 없음(franchise=Enterprise/HQ 만)' },
  { scope: 'enterprise', label: 'Enterprise', support: 'partially_supported', note: 'franchises(0349) 익명 집계 · 데이터 축적 제한' },
  { scope: 'region', label: 'Region', support: 'partially_supported', note: 'franchise_regions 실존 라벨만(임의 지역 생성 없음)' },
  { scope: 'industry', label: 'Industry', support: 'supported', note: 'store_type_slug 실데이터(카페/병원/헬스장 등)' },
  { scope: 'global', label: 'Global', support: 'supported', note: '전체 playback_events_v2 집계' },
];

/* ── Fleet Health(8성분 재정규화 — 미지원 성분 null 유지) ───────────────── */
export interface FleetHealthInput {
  playbackHealth?: number | null; streamingQuality?: number | null; queueStability?: number | null;
  rotationQuality?: number | null; playlistDiversity?: number | null; satisfaction?: number | null;
  aiTrust?: number | null; governanceHealth?: number | null;
}
export type FleetHealthGrade = 'healthy' | 'adequate' | 'at_risk' | 'critical' | 'insufficient_data';
export function calculateFleetHealth(inp: FleetHealthInput): { score: number | null; grade: FleetHealthGrade; components: Component[]; missing: string[] } {
  const components: Component[] = [
    { key: 'playback_health', value: inp.playbackHealth ?? null, weight: 0.2 },
    { key: 'streaming_quality', value: inp.streamingQuality ?? null, weight: 0.15 },
    { key: 'queue_stability', value: inp.queueStability ?? null, weight: 0.1 },
    { key: 'rotation_quality', value: inp.rotationQuality ?? null, weight: 0.1 },
    { key: 'playlist_diversity', value: inp.playlistDiversity ?? null, weight: 0.1 },
    { key: 'satisfaction', value: inp.satisfaction ?? null, weight: 0.15 },
    { key: 'ai_trust', value: inp.aiTrust ?? null, weight: 0.1 },
    { key: 'governance_health', value: inp.governanceHealth ?? null, weight: 0.1 },
  ];
  const r = normalizeAvailableComponents(components);
  if (r.score == null) return { score: null, grade: 'insufficient_data', components, missing: r.missing };
  const grade: FleetHealthGrade = r.score >= 75 ? 'healthy' : r.score >= 55 ? 'adequate' : r.score >= 35 ? 'at_risk' : 'critical';
  return { score: r.score, grade, components, missing: r.missing };
}

/* ── Benchmark 통계(결정적 median/quartile) ─────────────────────────────── */
export interface BenchmarkStats { median: number; p25: number; p75: number; mean: number; n: number }
export function benchmarkStats(values: Array<number | null | undefined>): BenchmarkStats | null {
  const v = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (v.length < 2) return null;   // 표본 1개로 Benchmark 생성 금지
  const q = (p: number) => { const i = (v.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { median: Math.round(q(0.5) * 100) / 100, p25: Math.round(q(0.25) * 100) / 100, p75: Math.round(q(0.75) * 100) / 100, mean: Math.round(mean * 100) / 100, n: v.length };
}
export type BenchmarkPosition = 'top_quartile' | 'above_median' | 'below_median' | 'bottom_quartile' | 'insufficient_data';
export function compareToBenchmark(value: number | null | undefined, stats: BenchmarkStats | null, direction: 'min' | 'max' = 'max'): BenchmarkPosition {
  if (!isFiniteNumber(value) || !stats) return 'insufficient_data';
  const flip = direction === 'min';
  if (flip ? value <= stats.p25 : value >= stats.p75) return 'top_quartile';
  if (flip ? value <= stats.median : value >= stats.median) return 'above_median';
  if (flip ? value <= stats.p75 : value >= stats.p25) return 'below_median';
  return 'bottom_quartile';
}

/* ── 익명 Ranking(원본 이름/ID 미노출 — 결정적 코드) ────────────────────── */
export interface AnonymousRankRow { anonCode: string; rank: number; value: number | null }
export function anonymizeRanking(items: Array<{ key: string; value: number | null }>, prefix = 'ENT'): AnonymousRankRow[] {
  return [...items]
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.key.localeCompare(b.key))
    .map((it, i) => ({ anonCode: `${prefix}-${String(i + 1).padStart(2, '0')}`, rank: i + 1, value: it.value }));
}

/* ── Best Practice Discovery(관찰 상관 — 인과 아님) ─────────────────────── */
export interface IndustryRow { storeType: string; events: number; completionRate: number | null; skipRate: number | null }
export interface BestPracticeCandidate {
  scope: 'industry'; scopeKey: string; title: string; metric: string; segmentValue: number; baselineValue: number;
  deltaPct: number; sampleEvents: number; status: 'candidate' | 'insufficient_data';
  evidence: Array<{ label: string; value: string | number }>; limitations: string[];
}
export function discoverBestPractices(rows: IndustryRow[], minEvents = 100): BestPracticeCandidate[] {
  const stats = benchmarkStats(rows.map((r) => r.completionRate));
  if (!stats) return [];
  const out: BestPracticeCandidate[] = [];
  for (const r of [...rows].sort((a, b) => a.storeType.localeCompare(b.storeType))) {
    if (!isFiniteNumber(r.completionRate)) continue;
    const delta = r.completionRate - stats.median;
    if (delta < 3) continue;   // 3pp 이상 우위만 후보(우연 패턴 양산 금지)
    out.push({
      scope: 'industry', scopeKey: r.storeType,
      title: `${r.storeType} — Completion ${stats.median} 대비 +${Math.round(delta * 10) / 10}pp`,
      metric: 'completion_rate', segmentValue: r.completionRate, baselineValue: stats.median,
      deltaPct: Math.round((delta / Math.max(1, stats.median)) * 1000) / 10,
      sampleEvents: r.events,
      status: r.events >= minEvents ? 'candidate' : 'insufficient_data',
      evidence: [
        { label: 'segment_completion', value: r.completionRate }, { label: 'fleet_median', value: stats.median },
        { label: 'sample_events', value: r.events }, { label: 'benchmark_n', value: stats.n },
      ],
      limitations: ['관찰 상관관계 — 인과 아님', '자동 적용 없음(Review 후보)'],
    });
  }
  return out;
}

/* ── Opportunity Detection(Store 익명 KPI vs Global Baseline) ───────────── */
export type OpportunityType = 'high_skip' | 'high_repeat' | 'quality_degradation' | 'low_completion' | 'low_diversity';
export type OpportunitySeverity = 'low' | 'moderate' | 'high' | 'critical';
export interface StoreKpiRow { anonCode: string; storeType: string | null; events: number; skipRate: number | null; completionRate: number | null; errorRate: number | null; replayRate: number | null; trackCount: number | null }
export interface GlobalBaseline { skipRate: number | null; completionRate: number | null; errorRate: number | null; replayRate: number | null }
export interface FleetOpportunity {
  anonCode: string; type: OpportunityType; severity: OpportunitySeverity; kpi: number; baseline: number | null;
  reason: string; evidence: Array<{ label: string; value: string | number | null }>;
}
export function detectOpportunities(rows: StoreKpiRow[], baseline: GlobalBaseline, minEvents = 50): FleetOpportunity[] {
  const out: FleetOpportunity[] = [];
  const sev = (ratio: number): OpportunitySeverity => (ratio >= 2 ? 'critical' : ratio >= 1.5 ? 'high' : ratio >= 1.2 ? 'moderate' : 'low');
  for (const r of [...rows].sort((a, b) => a.anonCode.localeCompare(b.anonCode))) {
    if (r.events < minEvents) continue;   // 표본 부족 store 는 판정하지 않음
    const ev = (kpi: number, base: number | null): Array<{ label: string; value: string | number | null }> => [
      { label: 'store', value: r.anonCode }, { label: 'kpi', value: kpi }, { label: 'global_baseline', value: base }, { label: 'events', value: r.events },
    ];
    if (isFiniteNumber(r.skipRate) && isFiniteNumber(baseline.skipRate) && baseline.skipRate > 0 && r.skipRate > baseline.skipRate * 1.2) {
      out.push({ anonCode: r.anonCode, type: 'high_skip', severity: sev(r.skipRate / baseline.skipRate), kpi: r.skipRate, baseline: baseline.skipRate, reason: `Skip ${r.skipRate}% (global ${baseline.skipRate}%)`, evidence: ev(r.skipRate, baseline.skipRate) });
    }
    if (isFiniteNumber(r.completionRate) && isFiniteNumber(baseline.completionRate) && r.completionRate < baseline.completionRate - 10) {
      out.push({ anonCode: r.anonCode, type: 'low_completion', severity: r.completionRate < baseline.completionRate - 25 ? 'high' : 'moderate', kpi: r.completionRate, baseline: baseline.completionRate, reason: `Completion ${r.completionRate}% (global ${baseline.completionRate}%)`, evidence: ev(r.completionRate, baseline.completionRate) });
    }
    if (isFiniteNumber(r.errorRate) && isFiniteNumber(baseline.errorRate) && r.errorRate > Math.max(1, baseline.errorRate * 1.5)) {
      out.push({ anonCode: r.anonCode, type: 'quality_degradation', severity: sev(r.errorRate / Math.max(0.1, baseline.errorRate)), kpi: r.errorRate, baseline: baseline.errorRate, reason: `Player Error ${r.errorRate}% (global ${baseline.errorRate}%)`, evidence: ev(r.errorRate, baseline.errorRate) });
    }
    if (isFiniteNumber(r.replayRate) && isFiniteNumber(baseline.replayRate) && baseline.replayRate >= 0 && r.replayRate > Math.max(2, baseline.replayRate * 1.5)) {
      out.push({ anonCode: r.anonCode, type: 'high_repeat', severity: sev(r.replayRate / Math.max(0.1, baseline.replayRate)), kpi: r.replayRate, baseline: baseline.replayRate, reason: `Replay ${r.replayRate}% (global ${baseline.replayRate}%)`, evidence: ev(r.replayRate, baseline.replayRate) });
    }
    if (isFiniteNumber(r.trackCount) && r.trackCount > 0 && r.trackCount < 10 && r.events >= 100) {
      out.push({ anonCode: r.anonCode, type: 'low_diversity', severity: r.trackCount < 5 ? 'high' : 'moderate', kpi: r.trackCount, baseline: null, reason: `Track ${r.trackCount}종만 반복 노출`, evidence: ev(r.trackCount, null) });
    }
  }
  return out;
}

/* ── Growth 분류(이전 없으면 0 비교 금지 → insufficient) ────────────────── */
export type GrowthResult = 'growing' | 'stable' | 'declining' | 'insufficient_data';
export function classifyGrowth(prev: number | null | undefined, curr: number | null | undefined): { result: GrowthResult; deltaPct: number | null } {
  if (!isFiniteNumber(prev) || !isFiniteNumber(curr) || prev <= 0) return { result: 'insufficient_data', deltaPct: null };
  const deltaPct = Math.round(((curr - prev) / prev) * 1000) / 10;
  return { result: deltaPct >= 10 ? 'growing' : deltaPct <= -10 ? 'declining' : 'stable', deltaPct };
}

/* ── Fleet Recommendation(검토 후보 — 자동 적용 금지) ───────────────────── */
export interface FleetRecommendation {
  scopeKey: string; title: string; basis: 'best_practice' | 'opportunity'; expected: string;
  status: 'review_candidate' | 'insufficient_data'; evidence: Array<{ label: string; value: string | number | null }>; limitations: string[];
}
export function buildFleetRecommendations(practices: BestPracticeCandidate[], opportunities: FleetOpportunity[]): FleetRecommendation[] {
  const out: FleetRecommendation[] = [];
  for (const p of practices.filter((x) => x.status === 'candidate')) {
    out.push({
      scopeKey: p.scopeKey, title: `${p.scopeKey} Fleet — ${p.metric} 우위 패턴 검토`, basis: 'best_practice',
      expected: `Fleet median 대비 +${p.deltaPct}% (관찰 상관 — 보장 아님)`, status: 'review_candidate',
      evidence: p.evidence, limitations: [...p.limitations, 'Governance Review 후 사람 승인 필요'],
    });
  }
  for (const o of opportunities.filter((x) => x.severity === 'high' || x.severity === 'critical')) {
    out.push({
      scopeKey: o.anonCode, title: `${o.anonCode} — ${o.type} 개선 검토`, basis: 'opportunity',
      expected: o.reason, status: 'review_candidate', evidence: o.evidence,
      limitations: ['자동 적용 없음(Review 후보)', '개별 Store 원본 미노출(익명 코드)'],
    });
  }
  return out;
}

export function fleetInputHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `fleet_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type FleetSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface FleetSupport { key: string; label: string; status: FleetSupportStatus; note: string }
export const FLEET_SUPPORT: FleetSupport[] = [
  { key: 'store_fleet', label: 'Store Fleet Intelligence', status: 'partially_supported', note: '익명 store 코드 집계(business/user 단위)' },
  { key: 'brand', label: 'Brand Scope', status: 'insufficient_data', note: '별도 Brand 계층 없음(franchise=HQ)' },
  { key: 'enterprise', label: 'Enterprise Scope', status: 'partially_supported', note: 'franchises(0349) — 2+ Store 익명 집계만' },
  { key: 'region', label: 'Region Scope', status: 'partially_supported', note: 'franchise_regions 실존 라벨만' },
  { key: 'industry', label: 'Industry Scope', status: 'fully_supported', note: 'store_type_slug 실데이터' },
  { key: 'global', label: 'Global Scope', status: 'fully_supported', note: '전체 집계' },
  { key: 'fleet_health', label: 'Fleet Health Score', status: 'partially_supported', note: 'Queue Stability 성분 없음(null 재정규화)' },
  { key: 'cross_enterprise', label: 'Cross-Enterprise Benchmark', status: 'partially_supported', note: '익명 집계만(원본 미노출, 2+ Store 만)' },
  { key: 'anonymous_ranking', label: 'Anonymous Ranking', status: 'fully_supported', note: '결정적 익명 코드(실명 Ranking 없음)' },
  { key: 'best_practice', label: 'Best Practice Discovery', status: 'partially_supported', note: '관찰 상관 · median+3pp · sample 게이트' },
  { key: 'opportunity', label: 'Fleet Opportunity Engine', status: 'partially_supported', note: '5종 KPI 이상 탐지(min events 게이트)' },
  { key: 'regional_intel', label: 'Regional Intelligence', status: 'partially_supported', note: '실존 region 데이터 있을 때만' },
  { key: 'growth', label: 'Fleet Growth', status: 'fully_supported', note: '이전/현재 반기 비교(0 비교 금지)' },
  { key: 'recommendation', label: 'Fleet Recommendation', status: 'evidence_only', note: 'review_candidate 만(자동 적용 없음)' },
  { key: 'governance', label: 'Governance Integration', status: 'read_only', note: '기존 governance events 참조' },
  { key: 'trust', label: 'Trust Integration', status: 'read_only', note: 'ai_agents reputation 평균 참조(수정 없음)' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Fleet 은 Evidence 계층' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const HEALTH_TONE: Record<FleetHealthGrade, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { healthy: 'success', adequate: 'info', at_risk: 'warning', critical: 'danger', insufficient_data: 'neutral' };
export const HEALTH_LABEL: Record<FleetHealthGrade, string> = { healthy: '건강', adequate: '보통', at_risk: '위험 신호', critical: 'Critical', insufficient_data: '데이터 부족' };
export const POSITION_LABEL: Record<BenchmarkPosition, string> = { top_quartile: '상위 25%', above_median: '중앙값 이상', below_median: '중앙값 미만', bottom_quartile: '하위 25%', insufficient_data: '데이터 부족' };
export const POSITION_TONE: Record<BenchmarkPosition, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { top_quartile: 'success', above_median: 'info', below_median: 'warning', bottom_quartile: 'danger', insufficient_data: 'neutral' };
export const OPP_TYPE_LABEL: Record<OpportunityType, string> = { high_skip: 'Skip 증가', high_repeat: '반복 과다', quality_degradation: 'Quality 저하', low_completion: 'Completion 저조', low_diversity: 'Diversity 부족' };
export const SEVERITY_TONE: Record<OpportunitySeverity, 'neutral' | 'info' | 'warning' | 'danger'> = { low: 'neutral', moderate: 'info', high: 'warning', critical: 'danger' };
export const GROWTH_LABEL: Record<GrowthResult, string> = { growing: '성장', stable: '안정', declining: '감소', insufficient_data: '데이터 부족' };
export const GROWTH_TONE: Record<GrowthResult, 'success' | 'neutral' | 'danger' | 'warning'> = { growing: 'success', stable: 'neutral', declining: 'danger', insufficient_data: 'warning' };
