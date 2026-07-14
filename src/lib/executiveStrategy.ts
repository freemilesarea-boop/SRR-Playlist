/**
 * executiveStrategy — Executive Intelligence, Business Strategy & Decision Intelligence
 * 순수 로직 (Phase AI-OPS-8).
 *
 * Operations → Business KPIs → Financial → Growth → Risk → Forecast → Scenario →
 * Decision Recommendation → Executive Briefing → Human Decision → Audit.
 * AI 는 추천과 근거(Evidence)만 제공 — 자동 계약/정산/가격/요금제/플레이리스트 변경·
 * 자동 영업·자동 의사결정 없음.
 *
 * 원칙: MRR 은 실측(subscriptions current_amount 합), ARR/순이익/LTV 는 '추정' 명시 ·
 *       비용 데이터 없으면 cost_unknown(CAC/Payback 미지원) · churn 0 → LTV null ·
 *       Forecast 는 deterministic + Actual 분리 · Scenario 는 evidence-only ·
 *       모든 추천에 Explainable 8요소 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';
import { forecastDemand, type DailyUsagePoint, type DemandForecast } from './capacityIntelligence';

export { isFiniteNumber, clampScore, normalizeAvailableComponents, forecastDemand };
export type { DailyUsagePoint, DemandForecast };

export const EXECSTRAT_SOURCE_VERSION = 'execstrat_v1(0511)';

/* ── Financial(실측/추정 분리) ───────────────────────────────────────────── */
export function calculateArrEstimate(mrrActual: number | null): { arr: number | null; isEstimate: true; note: string } {
  if (!isFiniteNumber(mrrActual) || mrrActual < 0) return { arr: null, isEstimate: true, note: 'MRR 실측 없음' };
  return { arr: mrrActual * 12, isEstimate: true, note: 'ARR = MRR×12 추정 — 실제 연간 청구액 아님' };
}
export function calculateGrowthRate(current: number | null, previous: number | null): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous <= 0) return null; // 이전 0 → 나눗셈 없음
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
export function calculateChurnRate(canceled: number | null, total: number | null): number | null {
  if (!isFiniteNumber(canceled) || !isFiniteNumber(total) || total <= 0 || canceled < 0) return null;
  return Math.round((canceled / total) * 1000) / 10;
}
/** LTV 추정 = 월 평균 매출/고객 ÷ 월 churn — churn 0/미측정이면 null(무한 LTV 주장 금지). */
export function calculateLtvEstimate(avgMonthlyRevenuePerCustomer: number | null, monthlyChurnRatePct: number | null): { ltv: number | null; isEstimate: true; note: string } {
  if (!isFiniteNumber(avgMonthlyRevenuePerCustomer) || avgMonthlyRevenuePerCustomer < 0) return { ltv: null, isEstimate: true, note: '고객당 매출 데이터 없음' };
  if (!isFiniteNumber(monthlyChurnRatePct) || monthlyChurnRatePct <= 0) return { ltv: null, isEstimate: true, note: 'churn 0/미측정 — LTV 산출 안 함(무한 LTV 주장 금지)' };
  return { ltv: Math.round(avgMonthlyRevenuePerCustomer / (monthlyChurnRatePct / 100)), isEstimate: true, note: '단순 추정 — 할인율/기간 미반영' };
}
export function calculateCac(): { cac: null; status: 'cost_unknown'; note: string } {
  return { cac: null, status: 'cost_unknown', note: '마케팅/영업 비용 데이터 없음 — CAC·Payback Period 미지원' };
}

/* ── Risk Intelligence(재정규화) ────────────────────────────────────────── */
export interface BusinessRiskComponents {
  contractExpiryRisk: number | null; churnRisk: number | null; usageDeclineRisk: number | null;
  storeInactivityRisk: number | null; revenueDeclineRisk: number | null; securityRisk: number | null; operationalRisk: number | null;
}
export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
export function calculateBusinessRisk(c: BusinessRiskComponents): { level: RiskLevel; score: number | null; missing: string[]; noAutoAction: true } {
  const weights: Record<keyof BusinessRiskComponents, number> = {
    contractExpiryRisk: 18, churnRisk: 18, usageDeclineRisk: 14, storeInactivityRisk: 12, revenueDeclineRisk: 20, securityRisk: 9, operationalRisk: 9,
  };
  const comps = (Object.keys(weights) as Array<keyof BusinessRiskComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (base.score === null) return { level: 'insufficient_data', score: null, missing: base.missing, noAutoAction: true };
  const level: RiskLevel = base.score >= 75 ? 'critical' : base.score >= 50 ? 'high' : base.score >= 25 ? 'moderate' : 'low';
  return { level, score: base.score, missing: base.missing, noAutoAction: true };
}

/* ── Explainable Decision(8요소 필수) ───────────────────────────────────── */
export interface ExplainableDecision {
  decision_code: string; category: string; recommendation: string; reason: string;
  evidence: Array<{ label: string; value: unknown }>; confidence: number | null;
  alternatives: string[]; expected_benefit: string; risk: string; humanApprovalRequired: true;
}
export function validateExplainableDecision(d: Partial<ExplainableDecision> | null): string[] {
  if (!d) return ['decision 없음'];
  const errors: string[] = [];
  if (!d.recommendation) errors.push('Recommendation 필수');
  if (!d.reason) errors.push('Reason 필수');
  if (!Array.isArray(d.evidence) || d.evidence.length === 0) errors.push('Evidence 필수');
  if (d.confidence !== null && d.confidence !== undefined && (!isFiniteNumber(d.confidence) || d.confidence < 0 || d.confidence > 100)) errors.push('Confidence 0~100');
  if (!Array.isArray(d.alternatives) || d.alternatives.length === 0) errors.push('Alternative 필수(대안 없는 추천 금지)');
  if (!d.expected_benefit) errors.push('Expected Benefit 필수');
  if (!d.risk) errors.push('Risk 필수');
  return errors;
}
export function buildDecisionRecommendation(inp: {
  category: 'target_industry' | 'target_brand' | 'playlist_expansion' | 'contract_renewal' | 'region_focus' | 'risk_priority';
  topCandidate: string | null; metricValue: number | null; sampleSize: number | null; code: string;
}): ExplainableDecision | { insufficient: true; reason: string } {
  if (!inp.topCandidate || !isFiniteNumber(inp.metricValue)) return { insufficient: true, reason: '후보/실측 지표 부족 — 추천 생성 안 함' };
  if (!isFiniteNumber(inp.sampleSize) || inp.sampleSize < 5) return { insufficient: true, reason: `표본 ${inp.sampleSize ?? 0}건 — 5건 미만 추천 생성 안 함` };
  const conf = clampScore(30 + Math.min(40, inp.sampleSize) + Math.min(20, inp.metricValue / 5));
  const labels: Record<string, { rec: string; benefit: string; risk: string; alt: string[] }> = {
    target_industry: { rec: `${inp.topCandidate} 업종 우선 공략`, benefit: '높은 활성도 업종 집중으로 전환율 개선', risk: '타 업종 기회 비용', alt: ['상위 2~3개 업종 병행', '현행 유지 후 1개월 재평가'] },
    target_brand: { rec: `${inp.topCandidate} 브랜드 영업 우선`, benefit: '활성 매장 확대', risk: '단일 브랜드 의존', alt: ['복수 브랜드 분산 접근'] },
    playlist_expansion: { rec: `${inp.topCandidate} 플레이리스트 확대 검토`, benefit: '완주율 높은 콘텐츠 확대', risk: '다양성 저하', alt: ['상위 3개 균등 확대', '신규 실험 후 결정'] },
    contract_renewal: { rec: `${inp.topCandidate} 계약 갱신 우선 협의`, benefit: '만료 위험 해소', risk: '조건 재협상 부담', alt: ['만료 60일 전 일괄 접촉'] },
    region_focus: { rec: `${inp.topCandidate} 지역 집중`, benefit: '지역 밀도 효과', risk: '타 지역 성장 둔화', alt: ['상위 2개 지역 병행'] },
    risk_priority: { rec: `${inp.topCandidate} 위험 우선 해결`, benefit: '핵심 위험 감소', risk: '자원 집중으로 다른 위험 지연', alt: ['위험 2건 병렬 처리'] },
  };
  const l = labels[inp.category];
  return {
    decision_code: inp.code, category: inp.category, recommendation: l.rec,
    reason: `실측 지표 ${inp.metricValue}(표본 ${inp.sampleSize}건) 기준 상위 후보`,
    evidence: [{ label: 'candidate', value: inp.topCandidate }, { label: 'metric', value: inp.metricValue }, { label: 'sample', value: inp.sampleSize }],
    confidence: conf, alternatives: l.alt, expected_benefit: l.benefit, risk: l.risk, humanApprovalRequired: true,
  };
}

/* ── Executive Daily Briefing(수동 생성 · 참고 자료) ────────────────────── */
export interface BriefingInput {
  todayRevenue: number | null; yesterdayRevenue: number | null; newContracts: number; expiringContracts: number;
  activeIncidents: number; criticalRisks: string[]; todoItems: string[]; topRecommendations: string[];
}
export function buildDailyBriefing(inp: BriefingInput, now: Date): Array<{ section: string; content: unknown }> {
  const dod = calculateGrowthRate(inp.todayRevenue, inp.yesterdayRevenue);
  return [
    { section: 'Briefing Date', content: now.toISOString().slice(0, 10) },
    { section: '어제 대비 성장', content: dod === null ? 'insufficient_data(전일 매출 0/미측정)' : `${dod}%` },
    { section: '주요 계약', content: `신규 서명 ${inp.newContracts}건 · 만료 임박 ${inp.expiringContracts}건` },
    { section: '주요 장애', content: inp.activeIncidents },
    { section: '주요 위험', content: inp.criticalRisks.length ? inp.criticalRisks : '확인된 critical 위험 없음(부재 보장 아님)' },
    { section: '오늘 해야 할 일', content: inp.todoItems },
    { section: 'AI 추천 Top', content: inp.topRecommendations },
    { section: 'Limitations', content: ['수동 생성 — 자동 스케줄 미지원', '참고 자료 — 실제 조치 아님'] },
  ];
}

/* ── Scenario Simulation(evidence-only — 실제 적용 없음) ────────────────── */
export type ScenarioResult = 'positive' | 'manageable' | 'strained' | 'critical' | 'insufficient_data';
export interface BusinessScenario { scenario: string; kind: 'stores' | 'enterprises' | 'tracks' | 'server_cost' | 'churn'; multiplier?: number; delta?: number }
export function evaluateBusinessScenario(s: BusinessScenario, base: { current: number | null; capacityLimit: number | null; mrr: number | null }): {
  result: ScenarioResult; projected: number | null; note: string; evidenceOnly: true; simulatedNotActual: true;
} {
  const common = { evidenceOnly: true as const, simulatedNotActual: true as const };
  if (!isFiniteNumber(base.current)) return { result: 'insufficient_data', projected: null, note: '기준 실측 없음', ...common };
  const projected = s.multiplier != null ? Math.round(base.current * s.multiplier) : base.current + (s.delta ?? 0);
  if (s.kind === 'server_cost') {
    return { result: base.mrr != null && base.mrr > 0 ? 'manageable' : 'insufficient_data', projected, note: '비용 단가 미입력 — 절대 비용은 cost_unknown, 배수 영향만 표기', ...common };
  }
  if (s.kind === 'churn') {
    return { result: projected >= 30 ? 'critical' : projected >= 15 ? 'strained' : 'manageable', projected, note: '해지율 % 가정 시나리오 — 실제 적용 없음', ...common };
  }
  if (!isFiniteNumber(base.capacityLimit) || base.capacityLimit <= 0) {
    return { result: 'insufficient_data', projected, note: 'capacity limit 미입력(limit_unknown) — 수용 가능 여부 판정 불가', ...common };
  }
  const util = (projected / base.capacityLimit) * 100;
  const result: ScenarioResult = util >= 100 ? 'critical' : util >= 85 ? 'strained' : util >= 60 ? 'manageable' : 'positive';
  return { result, projected, note: `projected utilization ${Math.round(util)}% — Digital Twin 방식 evidence-only`, ...common };
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'estimated' | 'evidence_only' | 'unsupported' | 'insufficient_data' | 'cost_unknown';
export const EXEC_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'mrr', label: 'MRR', status: 'fully_supported', note: 'subscriptions current_amount 실측 합' },
  { key: 'arr', label: 'ARR', status: 'estimated', note: 'MRR×12 추정 — 실제 연간 청구 아님' },
  { key: 'revenue_trend', label: '매출 추이', status: 'fully_supported', note: 'payment_orders(paid) 실측' },
  { key: 'net_profit', label: '순이익 추정', status: 'cost_unknown', note: '비용 데이터 없음 — 산출 불가' },
  { key: 'active_entities', label: '활성 기업/매장/플레이어', status: 'fully_supported', note: 'users/playback_events_v2 실측' },
  { key: 'streaming_hours', label: '스트리밍 시간', status: 'fully_supported', note: 'listened_seconds 실측' },
  { key: 'ai_adoption', label: 'AI 추천 채택률', status: 'partially_supported', note: 'ai_operations 결정 건 기준 — 미결정 제외' },
  { key: 'contract_growth', label: '계약 증가/만료', status: 'fully_supported', note: 'artist_contracts 실측' },
  { key: 'churn', label: '해지율', status: 'partially_supported', note: 'subscriptions canceled 비율 — 기간별 cohort 아님' },
  { key: 'settlement_volume', label: '정산 규모', status: 'fully_supported', note: 'final_payout_amount 실측' },
  { key: 'brand_region_growth', label: '브랜드/지역별 성장', status: 'insufficient_data', note: '업종(business_category)만 실측 — 브랜드/지역 축 미비(0349 franchise 는 별도 체계)' },
  { key: 'ltv', label: 'Store/Enterprise LTV', status: 'estimated', note: '월 매출÷churn 단순 추정 — churn 0 이면 산출 안 함' },
  { key: 'cac_payback', label: 'CAC / Payback', status: 'cost_unknown', note: '마케팅 비용 데이터 없음' },
  { key: 'revenue_forecast', label: 'Revenue Forecast', status: 'partially_supported', note: 'deterministic(1/7/30d) — 예측값 Actual 아님' },
  { key: 'infra_forecast', label: '서버 비용/저장공간/트래픽 예측', status: 'partially_supported', note: 'Capacity(0508) 재사용 — 비용은 cost_unknown' },
  { key: 'decision_recommendation', label: 'AI Decision Recommendation', status: 'fully_supported', note: 'Explainable 8요소 필수 — 표본 5건 미만 생성 안 함' },
  { key: 'daily_briefing', label: 'Executive Daily Briefing', status: 'partially_supported', note: '수동 생성 — 자동 스케줄(매일 자동) 미지원' },
  { key: 'scenario_simulation', label: 'Scenario Simulation', status: 'evidence_only', note: '실제 적용 없음 — simulated≠actual' },
  { key: 'auto_contract_change', label: '자동 계약 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_settlement_change', label: '자동 정산 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_pricing_change', label: '자동 가격/요금제 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_sales_execution', label: '자동 영업 실행', status: 'unsupported', note: '금지' },
  { key: 'auto_decision', label: '자동 의사결정', status: 'unsupported', note: '금지 — Human Approval 필수' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];

/* ── UI 톤 ──────────────────────────────────────────────────────────────── */
export const RISK_TONE: Record<RiskLevel, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { low: 'success', moderate: 'info', high: 'warning', critical: 'danger', insufficient_data: 'neutral' };
export const SCENARIO_TONE: Record<ScenarioResult, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { positive: 'success', manageable: 'info', strained: 'warning', critical: 'danger', insufficient_data: 'neutral' };
export const DECISION_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  proposed: 'info', under_review: 'warning', approved_reference: 'success', rejected: 'danger', deferred: 'neutral', expired: 'neutral', invalidated: 'neutral',
};
