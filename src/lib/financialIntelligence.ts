/**
 * financialIntelligence — Enterprise Financial Intelligence/Capital Performance/
 * Financial Decision Center 순수 로직 (Phase AI-OPS-23).
 *
 * Business Performance → Financial Performance → Capital Intelligence →
 * Financial Risk → Executive Financial Advisory.
 * AI는 재무 분석/비용 구조 설명/투자 효율 평가/리스크 제시만 —
 * 회계 자동 수정/예산 자동 변경/지출 자동 승인/투자 자동 결정 없음.
 *
 * Financial 정직성(전부 코드로 강제):
 *  - Revenue ≠ Profit. Cash Flow ≠ Liquidity Guarantee. Forecast ≠ Actual.
 *  - ROI ≠ Investment Success. Margin ≠ Business Health. Risk ≠ Failure.
 *  - Recommendation ≠ Financial Decision. Unknown 유지(null→0 금지).
 *  - 표본 부족 sample_too_small. 데이터 부족 insufficient_data. 근거 부족 financial_unverified.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어.
 */
import { isFiniteNumber, clampScore } from './aiMemory';
import { classifyTrend } from './performanceIntelligence';

export { classifyTrend };   // Financial Trend 는 0525 4분류 로직 재사용(Trend ≠ Guarantee)

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type FinVarianceVerdict = 'positive' | 'neutral' | 'negative' | 'variance_unknown';
export type FinRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export const FIN_RISK_KINDS = ['cash_flow_risk', 'burn_rate_risk', 'liquidity_risk', 'cost_growth_risk', 'revenue_stability_risk'] as const;
export const FIN_RECOMMENDATION_TYPES = ['review_cost', 'validate_revenue', 'review_cash_flow', 'investigate_variance', 'review_roi', 'gather_financial_evidence'] as const;

/* ── 1) Margin(부분 비용 기반 — Margin ≠ Business Health) ────────────── */
export function computeMargins(i: { revenue: number | null; knownCosts: number | null; costBasisComplete: boolean }): { grossProxy: number | null; marginPct: number | null; verdict: 'partial_measured' | 'insufficient_data'; partialCostBasis: boolean; marginIsNotBusinessHealth: true; revenueIsNotProfit: true } {
  if (i.revenue == null || i.knownCosts == null || !isFiniteNumber(i.revenue) || !isFiniteNumber(i.knownCosts)) {
    return { grossProxy: null, marginPct: null, verdict: 'insufficient_data', partialCostBasis: !i.costBasisComplete, marginIsNotBusinessHealth: true, revenueIsNotProfit: true };
  }
  const grossProxy = Math.round((i.revenue - i.knownCosts) * 100) / 100;
  const marginPct = i.revenue !== 0 ? Math.round((grossProxy / Math.abs(i.revenue)) * 10000) / 100 : null;
  return { grossProxy, marginPct, verdict: 'partial_measured', partialCostBasis: !i.costBasisComplete, marginIsNotBusinessHealth: true, revenueIsNotProfit: true };
}

/* ── 2) Cash Flow(부분 실측 — Liquidity 보장 아님) ───────────────────── */
export function analyzeCashFlow(i: { inflow: number | null; outflowPartial: number | null; investmentFlow: number | null; financingFlow: number | null }): { netPartial: number | null; verdict: 'partial_measured' | 'insufficient_data'; segments: { key: string; value: number | null; status: 'measured_partial' | 'financial_unavailable' }[]; cashFlowIsNotLiquidityGuarantee: true; notAccountingLedger: true } {
  const ok = i.inflow != null && i.outflowPartial != null && isFiniteNumber(i.inflow) && isFiniteNumber(i.outflowPartial);
  return {
    netPartial: ok ? Math.round(((i.inflow as number) - (i.outflowPartial as number)) * 100) / 100 : null,
    verdict: ok ? 'partial_measured' : 'insufficient_data',
    segments: [
      { key: 'cash_inflow', value: i.inflow, status: i.inflow != null ? 'measured_partial' : 'financial_unavailable' },
      { key: 'cash_outflow_partial', value: i.outflowPartial, status: i.outflowPartial != null ? 'measured_partial' : 'financial_unavailable' },
      { key: 'operating_cash_flow', value: ok ? Math.round(((i.inflow as number) - (i.outflowPartial as number)) * 100) / 100 : null, status: ok ? 'measured_partial' : 'financial_unavailable' },
      { key: 'investment_cash_flow', value: i.investmentFlow, status: i.investmentFlow != null ? 'measured_partial' : 'financial_unavailable' },
      { key: 'financing_cash_flow', value: i.financingFlow, status: i.financingFlow != null ? 'measured_partial' : 'financial_unavailable' },
    ],
    cashFlowIsNotLiquidityGuarantee: true, notAccountingLedger: true,
  };
}

/* ── 3) Capital Performance(근거 없으면 financial_unverified) ────────── */
export function analyzeCapitalPerformance(i: { allocated: number | null; utilized: number | null; evidence: string[] }): { utilizationPct: number | null; verdict: 'capital_candidate' | 'financial_unverified' | 'insufficient_data'; notInvestmentDecision: true } {
  if (!i.evidence.length) return { utilizationPct: null, verdict: 'financial_unverified', notInvestmentDecision: true };
  if (i.allocated == null || i.utilized == null || !isFiniteNumber(i.allocated) || !isFiniteNumber(i.utilized) || i.allocated <= 0) {
    return { utilizationPct: null, verdict: 'insufficient_data', notInvestmentDecision: true };
  }
  return { utilizationPct: clampScore((i.utilized / i.allocated) * 100), verdict: 'capital_candidate', notInvestmentDecision: true };
}

/* ── 4) Cost Distribution(actual/estimated 구분 — null 제외) ─────────── */
export function analyzeCostDistribution(costs: { category: string; amount: number | null; kind: 'actual' | 'estimated' }[] | null): { shares: { category: string; amount: number; sharePct: number; kind: 'actual' | 'estimated' }[]; totalKnown: number | null; excludedNull: number; estimatedIncluded: boolean; verdict: 'distributed' | 'insufficient_data' } {
  const valid = (costs ?? []).filter((c): c is { category: string; amount: number; kind: 'actual' | 'estimated' } => c.amount != null && isFiniteNumber(c.amount) && c.amount >= 0);
  const excludedNull = (costs ?? []).length - valid.length;
  if (!valid.length) return { shares: [], totalKnown: null, excludedNull, estimatedIncluded: false, verdict: 'insufficient_data' };
  const total = valid.reduce((a, c) => a + c.amount, 0);
  return {
    shares: valid.map((c) => ({ category: c.category, amount: c.amount, sharePct: total > 0 ? Math.round((c.amount / total) * 10000) / 100 : 0, kind: c.kind })).sort((a, b) => b.amount - a.amount).slice(0, 20),
    totalKnown: Math.round(total * 100) / 100,
    excludedNull,
    estimatedIncluded: valid.some((c) => c.kind === 'estimated'),
    verdict: 'distributed',
  };
}

/* ── 5) Financial Variance(4상태만 — Variance ≠ Failure) ─────────────── */
export function classifyFinancialVariance(i: { actual: number | null; budget: number | null; costMetric?: boolean; tolerancePct?: number }): { verdict: FinVarianceVerdict; variance: number | null; variancePct: number | null; forecastIsNotActual: true } {
  if (i.actual == null || i.budget == null || !isFiniteNumber(i.actual) || !isFiniteNumber(i.budget)) {
    return { verdict: 'variance_unknown', variance: null, variancePct: null, forecastIsNotActual: true };
  }
  const variance = Math.round((i.actual - i.budget) * 100) / 100;
  const variancePct = i.budget !== 0 ? Math.round((variance / Math.abs(i.budget)) * 10000) / 100 : null;
  const tol = isFiniteNumber(i.tolerancePct ?? NaN) ? Math.abs(i.tolerancePct as number) : 5;
  const withinTol = variancePct != null ? Math.abs(variancePct) <= tol : variance === 0;
  const better = i.costMetric ? variance < 0 : variance > 0;   // 비용 지표는 예산 미만이 positive
  return { verdict: withinTol ? 'neutral' : better ? 'positive' : 'negative', variance, variancePct, forecastIsNotActual: true };
}

/* ── 6) ROI(Evidence 기반만 — ROI ≠ Investment Success) ──────────────── */
export function assessRoi(i: { target: string; investment: number | null; returnValue: number | null; evidence: string[]; sample: number }): { target: string; roiPct: number | null; verdict: 'roi_candidate' | 'financial_unverified' | 'sample_too_small' | 'insufficient_data'; roiIsNotInvestmentSuccess: true } {
  if (!i.evidence.length) return { target: i.target, roiPct: null, verdict: 'financial_unverified', roiIsNotInvestmentSuccess: true };
  if (i.investment == null || i.returnValue == null || !isFiniteNumber(i.investment) || !isFiniteNumber(i.returnValue) || i.investment <= 0) {
    return { target: i.target, roiPct: null, verdict: 'insufficient_data', roiIsNotInvestmentSuccess: true };
  }
  if (i.sample < 5) return { target: i.target, roiPct: null, verdict: 'sample_too_small', roiIsNotInvestmentSuccess: true };
  return { target: i.target, roiPct: Math.round(((i.returnValue - i.investment) / i.investment) * 10000) / 100, verdict: 'roi_candidate', roiIsNotInvestmentSuccess: true };
}

/* ── 7) Financial Risk(Low/Medium/High/Unknown 만 — Risk ≠ Failure) ──── */
export function assessFinancialRisk(i: { kind: string; signal: number | null; highThreshold: number; mediumThreshold: number; lowerIsRiskier?: boolean; evidence: string[] }): { kind: string; level: FinRiskLevel; verdict: 'ok' | 'financial_unverified'; riskIsNotFailure: true } {
  if (!(FIN_RISK_KINDS as readonly string[]).includes(i.kind)) return { kind: i.kind, level: 'unknown', verdict: 'financial_unverified', riskIsNotFailure: true };
  if (!i.evidence.length) return { kind: i.kind, level: 'unknown', verdict: 'financial_unverified', riskIsNotFailure: true };
  if (i.signal == null || !isFiniteNumber(i.signal)) return { kind: i.kind, level: 'unknown', verdict: 'ok', riskIsNotFailure: true };
  const s = i.lowerIsRiskier ? -i.signal : i.signal;
  const high = i.lowerIsRiskier ? -i.highThreshold : i.highThreshold;
  const medium = i.lowerIsRiskier ? -i.mediumThreshold : i.mediumThreshold;
  const level: FinRiskLevel = s >= high ? 'high' : s >= medium ? 'medium' : 'low';
  return { kind: i.kind, level, verdict: 'ok', riskIsNotFailure: true };
}

/* ── 11) Executive Financial Briefing(자동 발송 없음) ────────────────── */
export const FIN_BRIEFING_PERIODS = ['today', 'weekly', 'monthly', 'quarterly'] as const;

export function buildFinancialBriefing(i: { periodKind: string; revenueChanges: string[]; costChanges: string[]; risks: string[]; opportunities: string[]; unknownFactors: string[] }): { periodKind: string; valid: boolean; sections: { key: string; items: string[] }[]; autoSendDisabled: true; revenueIsNotProfit: true } {
  return {
    periodKind: i.periodKind,
    valid: (FIN_BRIEFING_PERIODS as readonly string[]).includes(i.periodKind),
    sections: [
      { key: 'revenue_changes', items: i.revenueChanges.slice(0, 10) },
      { key: 'cost_changes', items: i.costChanges.slice(0, 10) },
      { key: 'financial_risks', items: i.risks.slice(0, 10) },
      { key: 'opportunities', items: i.opportunities.slice(0, 10) },
      { key: 'unknown_factors', items: i.unknownFactors.slice(0, 10) },
    ],
    autoSendDisabled: true, revenueIsNotProfit: true,
  };
}

/* ── 10) Financial Recommendation(6종 whitelist·Evidence 필수) ───────── */
export function buildFinancialRecommendation(i: { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives?: string[]; assumptions: string[] }):
  | { rejected: true; rejectReason: string }
  | { type: string; reason: string; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; limitations: string[]; humanApprovalRequired: true; approvalImplied: false } {
  if (!(FIN_RECOMMENDATION_TYPES as readonly string[]).includes(i.type)) return { rejected: true, rejectReason: `허용되지 않는 recommendation type: ${i.type}` };
  if (!i.evidence.length) return { rejected: true, rejectReason: 'Evidence 없는 권고 금지(financial_unverified)' };
  if (!i.reason.trim()) return { rejected: true, rejectReason: 'Reason 필수' };
  return {
    type: i.type, reason: i.reason, evidence: i.evidence.slice(0, 10),
    confidence: i.confidence != null && isFiniteNumber(i.confidence) ? clampScore(i.confidence) : null,
    alternatives: (i.alternatives ?? []).slice(0, 5), assumptions: i.assumptions.slice(0, 10),
    limitations: ['Recommendation ≠ Financial Decision', 'Revenue ≠ Profit', 'ROI ≠ Investment Success'],
    humanApprovalRequired: true, approvalImplied: false,
  };
}

/* ── 12) Financial Cockpit(9영역) ────────────────────────────────────── */
export function buildFinancialCockpit(i: { revenue30d: number | null; netPartial: number | null; marginPct: number | null; costCategories: number; roiAssessed: number; trendsAnalyzed: number; risksHigh: number; recommendationsOpen: number; summaryNote: string | null }): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; revenueIsNotProfit: true } {
  const n = (x: number | null) => (x != null && isFiniteNumber(x) ? x.toLocaleString('ko-KR') : 'insufficient_data');
  return {
    sections: [
      { key: 'financial_overview', headline: n(i.revenue30d), detail: 'Revenue(30d 실측) — Revenue ≠ Profit' },
      { key: 'cash_flow', headline: n(i.netPartial), detail: '부분 Net(비용 원장 없음) — Liquidity 보장 아님' },
      { key: 'margin', headline: i.marginPct == null ? 'insufficient_data' : `${i.marginPct}%`, detail: '부분 비용 기반 Proxy — Margin ≠ Business Health' },
      { key: 'cost_analysis', headline: n(i.costCategories), detail: '비용 카테고리(actual/estimated 구분)' },
      { key: 'roi', headline: n(i.roiAssessed), detail: 'ROI ≠ Investment Success' },
      { key: 'financial_trend', headline: n(i.trendsAnalyzed), detail: 'Trend ≠ Guarantee' },
      { key: 'financial_risk', headline: n(i.risksHigh), detail: 'high risk 건수 — Risk ≠ Failure' },
      { key: 'financial_recommendation', headline: n(i.recommendationsOpen), detail: 'Recommendation ≠ Financial Decision' },
      { key: 'executive_summary', headline: i.summaryNote ? 'note' : 'insufficient_data', detail: i.summaryNote ?? '요약 입력 없음 — unknown 유지' },
    ],
    humanDecisionRequired: true, revenueIsNotProfit: true,
  };
}

/* ── Support Matrix ──────────────────────────────────────────────────── */
export const FINANCIAL_SUPPORT: { key: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'revenue_paid_orders', status: 'supported', note: 'payment_orders(paid) 실측 — Revenue ≠ Profit' },
  { key: 'mrr', status: 'supported', note: 'subscriptions.current_amount 실측' },
  { key: 'cash_inflow', status: 'supported', note: 'payment_orders(paid) 실측' },
  { key: 'cash_outflow', status: 'partial', note: '정산 지급(artist_settlements)만 — 회계 원장 없음' },
  { key: 'company_fee', status: 'supported', note: 'company_fee_amount 실측' },
  { key: 'provider_costs', status: 'partial', note: 'ai_cost_snapshots(0508) actual/estimated 구분' },
  { key: 'margin_proxy', status: 'partial', note: '부분 비용 기반 — Margin ≠ Business Health' },
  { key: 'financial_variance', status: 'supported', note: 'Budget/Forecast/Actual 비교(4상태만)' },
  { key: 'financial_trend', status: 'supported', note: '0525 4분류 재사용 + sample_too_small 방어' },
  { key: 'roi_assessment', status: 'supported', note: 'Evidence 기반만 — ROI ≠ Investment Success' },
  { key: 'financial_risk', status: 'supported', note: 'Low/Medium/High/Unknown — Risk ≠ Failure' },
  { key: 'financial_briefing', status: 'supported', note: 'Today/Weekly/Monthly/Quarterly — 자동 발송 없음' },
  { key: 'ebitda', status: 'unsupported', note: '회계 원장 없음 — financial_unavailable' },
  { key: 'cash_position', status: 'unsupported', note: '은행/원장 원본 없음 — financial_unavailable' },
  { key: 'investment_financing_cash_flow', status: 'unsupported', note: '투자/재무 현금흐름 원본 없음' },
  { key: 'auto_accounting_change', status: 'unsupported', note: '회계 수정/예산 변경/지출·투자 승인 자동화 금지' },
];
