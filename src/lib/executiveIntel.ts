/**
 * executiveIntel — Autonomous Music OS & Executive Intelligence 순수 로직 (Phase AI-MUSIC-16).
 *
 * 기존 15개 Phase 의 실측 집계를 하나의 경영진 관점으로 오케스트레이션한다:
 * Executive KPI → AI OS Health → Cross-Agent Orchestration(0497 재사용) → Strategic Risk
 * → Opportunity → Strategic Plan(7d/30d/quarter/season) → Executive Recommendation.
 *
 * 원칙: 모든 제안은 Recommendation+Evidence+Confidence+Risk+Expected Outcome 필수 ·
 *       Evidence Only(자동 실행/승인 없음) · 없는 KPI null 유지(재정규화) ·
 *       장기 Horizon 일수록 Confidence penalty · 기존 Consensus/정의 무변경(입력 변환만).
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';
import { runCollaboration, type CollaborationInput, type CollaborationResult, type AgentCode } from './multiAgent';

export { isFiniteNumber, clampScore };

export const EXEC_SOURCE_VERSION = 'exec_v1(0503)';

/* ── Executive KPI(실측만 — 없는 지표 insufficient) ─────────────────────── */
export interface ExecutiveKpiInput {
  eventsGrowthPct?: number | null; completionRate?: number | null; skipRate?: number | null;
  likeRate?: number | null; diversityProxy?: number | null; revenueMonth?: number | null;
  revenueTrendPct?: number | null; aiTrust?: number | null; governanceHealth?: number | null;
}
export interface ExecutiveKpi { key: string; label: string; value: number | null; unit: string; status: 'available' | 'proxy' | 'insufficient_data' | 'unsupported' }
export function buildExecutiveKpis(inp: ExecutiveKpiInput): ExecutiveKpi[] {
  const v = (key: string, label: string, value: number | null | undefined, unit: string, kind: 'available' | 'proxy' = 'available'): ExecutiveKpi =>
    ({ key, label, value: isFiniteNumber(value) ? value : null, unit, status: isFiniteNumber(value) ? kind : 'insufficient_data' });
  return [
    v('growth', 'Growth (Events)', inp.eventsGrowthPct, '%'),
    { key: 'retention', label: 'Retention', value: null, unit: '%', status: 'unsupported' },   // cohort retention 집계 미구현(정직)
    v('completion', 'Completion', inp.completionRate, '%'),
    v('satisfaction', 'Satisfaction (Like)', inp.likeRate, '%', 'proxy'),
    { key: 'discovery', label: 'Discovery', value: null, unit: '%', status: 'unsupported' },   // discovery 지표 미수집
    v('diversity', 'Diversity', inp.diversityProxy, 'pt', 'proxy'),
    v('revenue', 'Revenue (월)', inp.revenueMonth, '₩'),
    { key: 'ai_accuracy', label: 'AI Accuracy', value: null, unit: '%', status: 'insufficient_data' },  // Calibration Outcome 축적 전
    v('trust', 'AI Trust', inp.aiTrust, 'pt'),
    v('governance', 'Governance Health', inp.governanceHealth, 'pt'),
  ];
}

/* ── AI OS Health(도메인 재정규화) ──────────────────────────────────────── */
export interface OsHealthInput {
  agentTrust?: number | null; fleetHealth?: number | null; governanceHealth?: number | null;
  memoryCoverage?: number | null; selfHealingScore?: number | null; federatedPrivacyRate?: number | null;
  streamingStability?: number | null;
}
export function computeAiOsHealth(inp: OsHealthInput): { score: number | null; grade: 'healthy' | 'adequate' | 'at_risk' | 'insufficient_data'; missing: string[] } {
  const r = normalizeAvailableComponents([
    { key: 'agent_trust', value: inp.agentTrust ?? null, weight: 0.15 },
    { key: 'fleet_health', value: inp.fleetHealth ?? null, weight: 0.2 },
    { key: 'governance', value: inp.governanceHealth ?? null, weight: 0.15 },
    { key: 'memory_coverage', value: inp.memoryCoverage ?? null, weight: 0.1 },
    { key: 'self_healing', value: inp.selfHealingScore ?? null, weight: 0.1 },
    { key: 'federated_privacy', value: inp.federatedPrivacyRate ?? null, weight: 0.1 },
    { key: 'streaming_stability', value: inp.streamingStability ?? null, weight: 0.2 },
  ]);
  if (r.score == null) return { score: null, grade: 'insufficient_data', missing: r.missing };
  return { score: r.score, grade: r.score >= 70 ? 'healthy' : r.score >= 50 ? 'adequate' : 'at_risk', missing: r.missing };
}

/* ── Strategic Risk Engine(실측 신호 기반 — 없는 축 insufficient) ────────── */
export type StrategicRiskType = 'playlist_fatigue' | 'quality_risk' | 'revenue_risk' | 'governance_risk' | 'region_risk' | 'enterprise_risk' | 'capacity_risk';
export interface StrategicRisk { type: StrategicRiskType; severity: 'low' | 'medium' | 'high' | 'critical'; summary: string; evidence: Array<{ label: string; value: string | number | null }> }
export interface RiskSignals {
  replayRate?: number | null; errorRate?: number | null; revenueTrendPct?: number | null;
  governanceViolations?: number | null; activeIncidents?: number | null;
}
export function detectStrategicRisks(s: RiskSignals): { risks: StrategicRisk[]; unsupported: StrategicRiskType[] } {
  const risks: StrategicRisk[] = [];
  if (isFiniteNumber(s.replayRate) && s.replayRate >= 3) {
    risks.push({ type: 'playlist_fatigue', severity: s.replayRate >= 6 ? 'high' : 'medium', summary: `Replay ${s.replayRate}% — 반복 피로 신호`, evidence: [{ label: 'replay_rate', value: s.replayRate }] });
  }
  if (isFiniteNumber(s.errorRate) && s.errorRate >= 1) {
    risks.push({ type: 'quality_risk', severity: s.errorRate >= 5 ? 'critical' : s.errorRate >= 2 ? 'high' : 'medium', summary: `Player Error ${s.errorRate}%`, evidence: [{ label: 'error_rate', value: s.errorRate }] });
  }
  if (isFiniteNumber(s.revenueTrendPct) && s.revenueTrendPct <= -10) {
    risks.push({ type: 'revenue_risk', severity: s.revenueTrendPct <= -25 ? 'high' : 'medium', summary: `Revenue ${s.revenueTrendPct}% 감소 추세`, evidence: [{ label: 'revenue_trend_pct', value: s.revenueTrendPct }] });
  }
  if (isFiniteNumber(s.governanceViolations) && s.governanceViolations >= 1) {
    risks.push({ type: 'governance_risk', severity: s.governanceViolations >= 5 ? 'high' : 'medium', summary: `Governance 위반 ${s.governanceViolations}건(30d)`, evidence: [{ label: 'violations_30d', value: s.governanceViolations }] });
  }
  if (isFiniteNumber(s.activeIncidents) && s.activeIncidents >= 1) {
    risks.push({ type: 'quality_risk', severity: s.activeIncidents >= 3 ? 'high' : 'medium', summary: `미해결 Incident ${s.activeIncidents}건`, evidence: [{ label: 'active_incidents', value: s.activeIncidents }] });
  }
  // Region/Enterprise/Capacity 는 실측 데이터 부족 → 판정하지 않음(정직).
  return { risks, unsupported: ['region_risk', 'enterprise_risk', 'capacity_risk'] };
}

/* ── Opportunity Engine(실측 근거 있는 기회만) ──────────────────────────── */
export interface ExecOpportunity { type: string; summary: string; evidence: Array<{ label: string; value: string | number | null }> }
export interface OpportunitySignals {
  topIndustry?: { storeType: string; completionRate: number | null; deltaVsMedian: number | null } | null;
  currentSeason?: string | null; activeRollouts?: number | null; bestPracticeCount?: number | null;
}
export function detectExecOpportunities(s: OpportunitySignals): ExecOpportunity[] {
  const out: ExecOpportunity[] = [];
  if (s.topIndustry && isFiniteNumber(s.topIndustry.deltaVsMedian) && s.topIndustry.deltaVsMedian >= 3) {
    out.push({ type: 'industry_optimization', summary: `${s.topIndustry.storeType} 업종 우위 패턴 확산 검토(+${s.topIndustry.deltaVsMedian}pp vs median)`, evidence: [{ label: 'store_type', value: s.topIndustry.storeType }, { label: 'delta_pp', value: s.topIndustry.deltaVsMedian }] });
  }
  if (s.currentSeason) {
    out.push({ type: 'seasonal_playlist', summary: `${s.currentSeason} 시즌 Playlist Draft 준비 검토(기존 Generator 흐름)`, evidence: [{ label: 'season', value: s.currentSeason }] });
  }
  if (isFiniteNumber(s.activeRollouts) && s.activeRollouts > 0) {
    out.push({ type: 'new_track_testing', summary: `진행 중 Rollout ${s.activeRollouts}건 — 신곡 테스트 확대 검토`, evidence: [{ label: 'active_rollouts', value: s.activeRollouts }] });
  }
  if (isFiniteNumber(s.bestPracticeCount) && s.bestPracticeCount > 0) {
    out.push({ type: 'best_practice_adoption', summary: `Best Practice 후보 ${s.bestPracticeCount}건 — Fleet 확산 검토`, evidence: [{ label: 'best_practices', value: s.bestPracticeCount }] });
  }
  return out;   // 근거 없으면 빈 배열(가짜 기회 생성 없음)
}

/* ── Cross-Agent Orchestrator(0497 Consensus 재사용 — 정의 무변경) ──────── */
export interface OrchestratorInput {
  completionRate: number | null; skipRate: number | null; likeRate: number | null;
  diversityProxy: number | null; errorRate: number | null; replayRate: number | null;
  revenueTrendPct: number | null; governanceHealth: number | null; governanceViolations: number;
  sample: number;
}
export function orchestrateExecutiveReview(inp: OrchestratorInput, reputation: Partial<Record<AgentCode, number>> = {}): CollaborationResult {
  const ci: CollaborationInput = {
    contextKey: 'executive:platform', sample: inp.sample,
    contextHealth: null, contextDrift: null,
    predictedCompletion: inp.completionRate, predictedSkip: inp.skipRate, predictionConfidence: null, riskScore: null,
    playlistDiversity: inp.diversityProxy, playlistFreshness: null,
    trackCoverage: null, artistExposure: null,
    repeatRisk: inp.replayRate != null ? clampScore(inp.replayRate * 10) : null,
    fatigueRisk: null,
    streamingQuality: inp.errorRate != null ? clampScore(100 - inp.errorRate * 10) : null, bufferHealth: null,
    roi: inp.revenueTrendPct != null ? clampScore(50 + inp.revenueTrendPct) : null,
    storeSatisfaction: inp.likeRate != null ? clampScore(inp.likeRate * 20) : null,
    governanceHealth: inp.governanceHealth, constitutionPass: inp.governanceViolations === 0,
  };
  return runCollaboration(ci, reputation);
}

/* ── Strategic Planning(Horizon 별 — 장기일수록 Confidence penalty) ─────── */
export type Horizon = '7d' | '30d' | 'quarter' | 'season';
export const HORIZON_PENALTY: Record<Horizon, number> = { '7d': 0, '30d': 10, quarter: 25, season: 30 };
export interface PlanItem {
  horizon: Horizon; category: 'strategy' | 'risk_mitigation' | 'opportunity';
  title: string; summary: string; confidence: number; riskTier: 'low' | 'medium' | 'high' | 'critical';
  expectedOutcome: Record<string, string | number | null>;
  evidence: Array<{ label: string; value: string | number | null }>; limitations: string[];
}
export function buildStrategicPlan(horizon: Horizon, risks: StrategicRisk[], opportunities: ExecOpportunity[], baseConfidence: number | null): PlanItem[] {
  if (!isFiniteNumber(baseConfidence)) return [];   // 근거 confidence 없으면 계획 생성 안 함
  const conf = clampScore(baseConfidence - HORIZON_PENALTY[horizon]);
  const items: PlanItem[] = [];
  for (const r of risks) {
    items.push({
      horizon, category: 'risk_mitigation',
      title: `[${horizon}] ${r.type} 완화 검토`, summary: r.summary,
      confidence: conf, riskTier: r.severity === 'critical' ? 'critical' : r.severity === 'high' ? 'high' : 'medium',
      expectedOutcome: { direction: 'risk_reduction', metric: r.type, note: '관찰 상관 기반 — 보장 아님' },
      evidence: r.evidence, limitations: ['Evidence Only — Governance Review 필요', `horizon ${horizon} penalty -${HORIZON_PENALTY[horizon]}`],
    });
  }
  for (const o of opportunities) {
    items.push({
      horizon, category: 'opportunity',
      title: `[${horizon}] ${o.type} 검토`, summary: o.summary,
      confidence: conf, riskTier: 'low',
      expectedOutcome: { direction: 'improvement', metric: o.type, note: '관찰 상관 기반 — 보장 아님' },
      evidence: o.evidence, limitations: ['Evidence Only — 자동 실행 없음'],
    });
  }
  return items.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

/* ── Executive Recommendation 검증(4요소 필수) ──────────────────────────── */
export function validateRecommendation(item: PlanItem): string[] {
  const errors: string[] = [];
  if (!item.title || !item.summary) errors.push('recommendation text required');
  if (!item.evidence.length) errors.push('evidence required');
  if (!isFiniteNumber(item.confidence)) errors.push('confidence required');
  if (!item.riskTier) errors.push('risk required');
  if (!item.expectedOutcome || !Object.keys(item.expectedOutcome).length) errors.push('expected_outcome required');
  return errors;
}

export function execInputHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `exec_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type ExecSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface ExecSupport { key: string; label: string; status: ExecSupportStatus; note: string }
export const EXEC_SUPPORT: ExecSupport[] = [
  { key: 'executive_intel', label: 'Executive Intelligence', status: 'partially_supported', note: '실측 KPI 집계(Retention/Discovery 미수집)' },
  { key: 'orchestrator', label: 'Cross-Agent Orchestrator', status: 'read_only', note: '0497 Consensus 재사용(정의 무변경) — 신호 없는 Agent abstain' },
  { key: 'strategic_planning', label: 'Strategic Planning', status: 'partially_supported', note: '7d/30d/quarter/season — 장기 Confidence penalty' },
  { key: 'executive_kpi', label: 'Executive KPI', status: 'partially_supported', note: 'Growth/Completion/Revenue 실측 · Retention/Discovery unsupported' },
  { key: 'risk_engine', label: 'Strategic Risk Engine', status: 'partially_supported', note: 'Fatigue/Quality/Revenue/Governance 실측 · Region/Enterprise/Capacity insufficient' },
  { key: 'opportunity_engine', label: 'Opportunity Engine', status: 'partially_supported', note: '실측 근거 있는 기회만(가짜 기회 없음)' },
  { key: 'executive_simulation', label: 'Executive Simulation', status: 'read_only', note: '0499 Twin Run 재사용 · Revenue 연계 unsupported(simulated ≠ actual)' },
  { key: 'recommendation', label: 'Executive Recommendation', status: 'evidence_only', note: 'Evidence·Confidence·Risk·Expected Outcome 4요소 필수(서버 강제)' },
  { key: 'governance', label: 'Governance Integration', status: 'fully_supported', note: 'approved_reference 는 governance_review 경유 필수(자동 승인 차단)' },
  { key: 'trust', label: 'Trust Integration', status: 'read_only', note: 'Agent Reputation 참조만(수정 없음)' },
  { key: 'executive_policy', label: 'Executive Policy 수정', status: 'unsupported', note: '금지 — AI 가 Policy 를 직접 수정할 수 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Evidence Only' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const KPI_STATUS_TONE: Record<ExecutiveKpi['status'], 'success' | 'warning' | 'neutral' | 'danger'> = { available: 'success', proxy: 'warning', insufficient_data: 'neutral', unsupported: 'danger' };
export const RISK_TONE: Record<'low' | 'medium' | 'high' | 'critical', 'neutral' | 'info' | 'warning' | 'danger'> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
export const REC_STATUS_LABEL: Record<string, string> = { proposed: '제안됨', governance_review: 'Governance Review', approved_reference: '승인(참고)', rejected: '기각', expired: '만료' };
export const REC_STATUS_TONE: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = { proposed: 'neutral', governance_review: 'warning', approved_reference: 'success', rejected: 'danger', expired: 'neutral' };
export const HORIZONS: Array<{ key: Horizon; label: string }> = [{ key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: 'quarter', label: '분기' }, { key: 'season', label: '시즌' }];
