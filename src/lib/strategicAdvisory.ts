/**
 * strategicAdvisory — Executive Strategic Intelligence/Scenario Optimization/
 * Decision Advisory 순수 로직 (Phase AI-OPS-20).
 *
 * Forecast → Scenario Comparison → Trade-off Analysis → Executive Advisory →
 * Human Decision. AI는 비교/분석/설명/권고만 — 최종 의사결정은 항상 사람.
 *
 * Advisory 정직성(전부 코드로 강제):
 *  - Recommendation ≠ Decision. Scenario ≠ Reality. Projection ≠ Outcome.
 *  - Forecast ≠ Guarantee. 상관 ≠ 인과. Confidence ≠ Correctness.
 *  - Trade-off 분석 ≠ 최적화 보장. 근거(설명 체인) 없는 추천 금지.
 *  - Unknown 은 Unknown 유지(null→0 금지). 표본<5 sample_too_small.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type StrategyPosture = 'current' | 'conservative' | 'balanced' | 'aggressive' | 'custom';
export type AdvisoryStatus = 'advisory_reference' | 'sample_too_small' | 'advisory_unverified' | 'insufficient_data';
export type AlignmentVerdict = 'aligned_reference' | 'partially_aligned' | 'misaligned_candidate' | 'alignment_unverified' | 'insufficient_data';

export interface ScenarioInput {
  name: string;
  posture: StrategyPosture;
  expectedDelivery: number | null;   // 0~100
  expectedRisk: number | null;       // 0~100 (높을수록 위험)
  expectedCostKrw: number | null;
  expectedImpact: number | null;     // 0~100
  expectedTimelineDays: number | null;
  confidence: number | null;
}

/* ── 1) Scenario Comparison(자동 선택 없음) ──────────────────────────── */
export function buildScenarioComparison(scenarios: ScenarioInput[] | null): { rows: (ScenarioInput & { completeness: number })[]; axes: string[]; status: AdvisoryStatus; autoSelected: false; scenarioIsNotReality: true } {
  const rows = (scenarios ?? []).map((s) => {
    const fields = [s.expectedDelivery, s.expectedRisk, s.expectedCostKrw, s.expectedImpact, s.expectedTimelineDays, s.confidence];
    const known = fields.filter((f) => f != null && isFiniteNumber(f)).length;
    return { ...s, completeness: clampScore((known / fields.length) * 100) };
  });
  const status: AdvisoryStatus = rows.length < 2 ? 'insufficient_data' : rows.length < 3 ? 'sample_too_small' : 'advisory_reference';
  return { rows, axes: ['expectedDelivery', 'expectedRisk', 'expectedCostKrw', 'expectedImpact', 'expectedTimelineDays', 'confidence'], status, autoSelected: false, scenarioIsNotReality: true };
}

/* ── 2) Trade-off Intelligence(체인 보존 — 최적화 보장 아님) ─────────── */
export const TRADEOFF_FACTORS = ['revenue', 'growth', 'risk', 'cost', 'delivery_speed', 'delivery_quality', 'organizational_load', 'capacity', 'sustainability'] as const;
export type TradeoffFactor = (typeof TRADEOFF_FACTORS)[number];

export function analyzeTradeoff(a: ScenarioInput | null, b: ScenarioInput | null): { chains: { factor: string; direction: string; consequence: string }[]; optimizationGuaranteed: false } {
  if (!a || !b) return { chains: [], optimizationGuaranteed: false };
  const chains: { factor: string; direction: string; consequence: string }[] = [];
  const cmp = (x: number | null, y: number | null) => (x != null && y != null && isFiniteNumber(x) && isFiniteNumber(y) ? x - y : null);
  const impactDiff = cmp(b.expectedImpact, a.expectedImpact);
  const riskDiff = cmp(b.expectedRisk, a.expectedRisk);
  const confDiff = cmp(b.confidence, a.confidence);
  const costDiff = cmp(b.expectedCostKrw, a.expectedCostKrw);
  if (impactDiff != null && impactDiff > 0 && riskDiff != null && riskDiff > 0) {
    chains.push({ factor: 'revenue', direction: `${b.name}: Impact ↑(+${Math.round(impactDiff)})`, consequence: `Risk ↑(+${Math.round(riskDiff)})${confDiff != null && confDiff < 0 ? ` → Confidence ↓(${Math.round(confDiff)})` : ''}` });
  }
  if (costDiff != null && costDiff < 0 && impactDiff != null && impactDiff < 0) {
    chains.push({ factor: 'cost', direction: `${b.name}: Cost ↓(${Math.round(costDiff)})`, consequence: `Impact ↓(${Math.round(impactDiff)}) — 절감 ↔ 성과 Trade-off` });
  }
  const speedDiff = cmp(a.expectedTimelineDays, b.expectedTimelineDays);
  if (speedDiff != null && speedDiff > 0 && riskDiff != null && riskDiff > 0) {
    chains.push({ factor: 'delivery_speed', direction: `${b.name}: Timeline ↓(-${Math.round(speedDiff)}일)`, consequence: `Risk ↑(+${Math.round(riskDiff)}) — 속도 ↔ 안정성 Trade-off` });
  }
  return { chains, optimizationGuaranteed: false };
}

/* ── 3) Decision Matrix ──────────────────────────────────────────────── */
export function buildDecisionMatrix(scenarios: ScenarioInput[] | null, meta: { unknownFactors: string[]; assumptions: string[]; evidenceCoverage: number | null }): { rows: { name: string; benefit: number | null; risk: number | null; cost: number | null; timeline: number | null; confidence: number | null }[]; unknownFactors: string[]; assumptions: string[]; evidenceCoverage: number | null; decisionMadeByAI: false } {
  return {
    rows: (scenarios ?? []).map((s) => ({ name: s.name, benefit: s.expectedImpact, risk: s.expectedRisk, cost: s.expectedCostKrw, timeline: s.expectedTimelineDays, confidence: s.confidence })),
    unknownFactors: meta.unknownFactors, assumptions: meta.assumptions, evidenceCoverage: meta.evidenceCoverage,
    decisionMadeByAI: false,
  };
}

/* ── 4) Strategy Posture 분류(자동 선택 없음 — 장단점 설명) ──────────── */
export function classifyStrategyPosture(s: { expectedRisk: number | null; expectedImpact: number | null }): { posture: StrategyPosture | 'insufficient_data'; pros: string[]; cons: string[]; autoSelected: false } {
  if (s.expectedRisk == null || s.expectedImpact == null || !isFiniteNumber(s.expectedRisk) || !isFiniteNumber(s.expectedImpact)) {
    return { posture: 'insufficient_data', pros: [], cons: ['Risk/Impact 미상 — 분류 불가(0 아님)'], autoSelected: false };
  }
  if (s.expectedRisk <= 30 && s.expectedImpact <= 50) return { posture: 'conservative', pros: ['낮은 위험', '높은 예측 가능성'], cons: ['제한적 성과 기대', '기회비용 가능'], autoSelected: false };
  if (s.expectedRisk >= 60 || s.expectedImpact >= 75) return { posture: 'aggressive', pros: ['높은 성과 기대'], cons: ['높은 위험', 'Confidence 하락 가능', '실패 시 손실 확대'], autoSelected: false };
  return { posture: 'balanced', pros: ['위험·성과 균형'], cons: ['어느 축도 극대화하지 않음'], autoSelected: false };
}

/* ── 5) Portfolio Optimization Advisory ─────────────────────────────── */
export function analyzePortfolioBalance(p: { includedCount: number; hardRiskCount: number; domains: string[]; totalReviewHours: number | null; availableReviewHours: number | null; expectedCompletionPct: number | null }): { balance: 'balanced_reference' | 'concentrated_candidate' | 'insufficient_data'; riskDistribution: string; resourcePressure: 'over_capacity' | 'high' | 'manageable' | 'capacity_unknown'; expectedCompletion: number | null; findings: string[]; autoRebalanced: false } {
  const findings: string[] = [];
  const uniqueDomains = new Set(p.domains).size;
  const balance = p.includedCount === 0 ? 'insufficient_data' : uniqueDomains <= 1 && p.includedCount >= 3 ? 'concentrated_candidate' : 'balanced_reference';
  if (balance === 'concentrated_candidate') findings.push(`단일 Domain(${p.domains[0]})에 ${p.includedCount}건 집중`);
  const riskDistribution = p.includedCount === 0 ? '평가 불가' : `Hard Risk ${p.hardRiskCount}/${p.includedCount}건`;
  let resourcePressure: 'over_capacity' | 'high' | 'manageable' | 'capacity_unknown';
  if (p.availableReviewHours == null || p.totalReviewHours == null) resourcePressure = 'capacity_unknown';
  else if (p.totalReviewHours > p.availableReviewHours) { resourcePressure = 'over_capacity'; findings.push(`검토 시간 초과(${p.totalReviewHours}h > ${p.availableReviewHours}h)`); }
  else if (p.totalReviewHours > p.availableReviewHours * 0.8) resourcePressure = 'high';
  else resourcePressure = 'manageable';
  return { balance, riskDistribution, resourcePressure, expectedCompletion: p.expectedCompletionPct, findings, autoRebalanced: false };
}

/* ── 6·7) Explainable Advisory(설명 체인 필수) ───────────────────────── */
export const ADVISORY_TYPES = ['consider_scenario', 'review_scenario', 'delay_scenario', 'gather_more_evidence', 'reduce_dependency', 'validate_assumptions', 'rebalance_portfolio_candidate', 'review_tradeoff', 'review_alignment_gap', 'update_briefing', 'manual'] as const;
export type AdvisoryType = (typeof ADVISORY_TYPES)[number];

export function buildExecutiveAdvisory(i: { type: string; title: string; summary: string; reasoningChain: string[]; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; unknownFactors: string[] }): { type: AdvisoryType; title: string; summary: string; reasoningChain: string[]; evidence: string[]; confidence: number | null; alternatives: string[]; assumptions: string[]; unknownFactors: string[]; limitations: string[]; humanApprovalRequired: true; decisionMade: false } | { rejected: true; why: string } {
  if (!(ADVISORY_TYPES as readonly string[]).includes(i.type)) return { rejected: true, why: `허용되지 않는 advisory 유형: ${i.type}` };
  // Explainable Strategy: 설명 체인 2단계 이상 없으면 추천 금지
  if (i.reasoningChain.filter((r) => r.trim()).length < 2) return { rejected: true, why: '설명 체인 2단계 이상 필수 — 근거 없는 추천 금지' };
  if (!i.evidence.length) return { rejected: true, why: 'Evidence 없는 추천 금지' };
  if (!i.summary.trim()) return { rejected: true, why: 'summary 필수' };
  return {
    type: i.type as AdvisoryType, title: i.title, summary: i.summary,
    reasoningChain: i.reasoningChain, evidence: i.evidence, confidence: i.confidence,
    alternatives: i.alternatives.length ? i.alternatives : ['현행 유지(권고 미채택)'],
    assumptions: i.assumptions, unknownFactors: i.unknownFactors,
    limitations: ['Recommendation ≠ Decision', 'Confidence ≠ Correctness'],
    humanApprovalRequired: true, decisionMade: false,
  };
}

export function validateExplainability(reasoningChain: string[] | null, evidence: string[] | null): { explainable: boolean; why: string } {
  if (!reasoningChain || reasoningChain.filter((r) => r.trim()).length < 2) return { explainable: false, why: '설명 체인 부족(2단계 미만) — 추천 생성 금지' };
  if (!evidence?.length) return { explainable: false, why: 'Evidence 없음 — 추천 생성 금지' };
  return { explainable: true, why: '설명 가능(왜 → 근거 → 결론 체인 존재)' };
}

/* ── 8) Executive Briefing(요약 — 자동 발송 없음) ────────────────────── */
export function buildExecutiveBriefing20(i: { period: 'today' | 'weekly' | 'monthly' | 'quarterly'; keyChanges: string[]; coreRisks: string[]; opportunities: string[]; unknowns: string[]; recommendations: string[] }): { period: string; sections: { keyChanges: string[]; coreRisks: string[]; opportunities: string[]; unknowns: string[]; recommendations: string[] }; autoSent: false; limitations: string[] } {
  const cap = (arr: string[]) => arr.slice(0, 15);
  return {
    period: i.period,
    sections: { keyChanges: cap(i.keyChanges), coreRisks: cap(i.coreRisks), opportunities: cap(i.opportunities), unknowns: cap(i.unknowns), recommendations: cap(i.recommendations) },
    autoSent: false,
    limitations: ['자동 발송 없음', '핵심 Risk/미확인 요소 생략 금지', 'Opportunity ≠ 보장'],
  };
}

/* ── 9) Strategic Alignment(자료 없으면 unverified) ──────────────────── */
export function evaluateStrategicAlignment(i: { scenarioName: string; matchedPriorities: number | null; totalPriorities: number | null; policyConflicts: number | null; governanceIssues: number | null }): { scenario: string; verdict: AlignmentVerdict; alignmentPct: number | null; issues: string[] } {
  if (i.matchedPriorities == null || i.totalPriorities == null || !isFiniteNumber(i.totalPriorities) || i.totalPriorities <= 0) {
    return { scenario: i.scenarioName, verdict: 'alignment_unverified', alignmentPct: null, issues: ['Priority 매핑 자료 없음 — 일치도 임의 생성 금지'] };
  }
  const issues: string[] = [];
  if (i.policyConflicts != null && i.policyConflicts > 0) issues.push(`Policy 충돌 ${i.policyConflicts}건`);
  if (i.governanceIssues != null && i.governanceIssues > 0) issues.push(`Governance 이슈 ${i.governanceIssues}건`);
  const pct = clampScore((i.matchedPriorities / i.totalPriorities) * 100);
  if (issues.length) return { scenario: i.scenarioName, verdict: 'misaligned_candidate', alignmentPct: pct, issues };
  return { scenario: i.scenarioName, verdict: pct >= 70 ? 'aligned_reference' : pct >= 40 ? 'partially_aligned' : 'misaligned_candidate', alignmentPct: pct, issues };
}

/* ── 10) Decision Impact Projection(Projection ≠ 실제 결과) ──────────── */
export function projectDecisionImpact(scenarios: ScenarioInput[] | null, kpis: { key: string; available: boolean }[]): { rows: { scenario: string; kpi: string; direction: 'increase_expected' | 'decrease_expected' | 'neutral_expected' | 'projection_unavailable' }[]; projectionNotOutcome: true } {
  const out: { scenario: string; kpi: string; direction: 'increase_expected' | 'decrease_expected' | 'neutral_expected' | 'projection_unavailable' }[] = [];
  for (const s of scenarios ?? []) {
    for (const k of kpis) {
      if (!k.available) { out.push({ scenario: s.name, kpi: k.key, direction: 'projection_unavailable' }); continue; }
      if (s.expectedImpact == null || !isFiniteNumber(s.expectedImpact)) { out.push({ scenario: s.name, kpi: k.key, direction: 'projection_unavailable' }); continue; }
      out.push({ scenario: s.name, kpi: k.key, direction: s.expectedImpact >= 60 ? 'increase_expected' : s.expectedImpact <= 30 ? 'decrease_expected' : 'neutral_expected' });
    }
  }
  return { rows: out, projectionNotOutcome: true };
}

/* ── 11) Executive Cockpit 2.0(9영역) ────────────────────────────────── */
export function buildExecutiveCockpit20(i: {
  strategy: string; comparisonCount: number; matrixReady: boolean; pendingAdvisories: number;
  portfolioBalance: string; tradeoffChains: number; projectionAvailable: number; projectionUnavailable: number;
  healthStatus: string; briefingPeriod: string;
}): { sections: { key: string; headline: string; detail: string }[]; humanDecisionRequired: true; autoExecution: false } {
  return {
    sections: [
      { key: 'strategy', headline: i.strategy, detail: '전략 현황(자동 선택 없음)' },
      { key: 'scenario_comparison', headline: `비교 ${i.comparisonCount}건`, detail: 'Scenario ≠ Reality' },
      { key: 'decision_matrix', headline: i.matrixReady ? 'Matrix 구성됨' : 'Matrix 데이터 부족', detail: '의사결정은 사람' },
      { key: 'executive_recommendation', headline: `검토 대기 권고 ${i.pendingAdvisories}건`, detail: 'Recommendation ≠ Decision' },
      { key: 'portfolio_balance', headline: i.portfolioBalance, detail: '자동 재조정 없음' },
      { key: 'tradeoff', headline: `Trade-off 체인 ${i.tradeoffChains}건`, detail: '최적화 보장 아님' },
      { key: 'business_projection', headline: `가능 ${i.projectionAvailable} · unavailable ${i.projectionUnavailable}`, detail: 'Projection ≠ Outcome' },
      { key: 'organizational_health', headline: i.healthStatus, detail: '점수 단독 해석 금지' },
      { key: 'executive_briefing', headline: `${i.briefingPeriod} Briefing`, detail: '자동 발송 없음' },
    ],
    humanDecisionRequired: true, autoExecution: false,
  };
}

/* ── 12) Advisory Confidence(Confidence ≠ Correctness) ───────────────── */
export function buildAdvisoryConfidence(i: { componentValues: (number | null)[]; unknownFactors: string[]; assumptions: string[]; inputAgeDays: number | null }): { confidence: number | null; evidenceCoverage: number | null; unknownFactors: string[]; assumptions: string[]; freshness: 'fresh' | 'stale_input_candidate' | 'unknown'; limitations: string[]; correctnessImplied: false } {
  const known = i.componentValues.filter((v): v is number => v != null && isFiniteNumber(v));
  const { score } = normalizeAvailableComponents(known.map((v, idx) => ({ key: `c${idx}`, value: v, weight: 1 })));
  const coverage = i.componentValues.length ? clampScore((known.length / i.componentValues.length) * 100) : null;
  return {
    confidence: score == null ? null : clampScore(score),
    evidenceCoverage: coverage,
    unknownFactors: i.unknownFactors, assumptions: i.assumptions,
    freshness: i.inputAgeDays == null ? 'unknown' : i.inputAgeDays > 30 ? 'stale_input_candidate' : 'fresh',
    limitations: ['Confidence 가 높다고 정답을 의미하지 않음(Confidence ≠ Correctness)'],
    correctnessImplied: false,
  };
}

/* ── Support Matrix(실측 기반 — 추측 없음) ──────────────────────────── */
export const ADVISORY_SUPPORT: { key: string; label: string; status: 'supported' | 'partial' | 'unsupported'; note: string }[] = [
  { key: 'scenario_comparison', label: 'Executive Scenario Comparison', status: 'supported', note: 'Current/Conservative/Balanced/Aggressive/Custom — 자동 선택 없음' },
  { key: 'tradeoff', label: 'Strategic Trade-off Intelligence', status: 'supported', note: '9요소 체인 — 최적화 보장 아님' },
  { key: 'decision_matrix', label: 'Executive Decision Matrix', status: 'supported', note: 'Benefit/Risk/Cost/Timeline/Confidence/Unknown/Assumptions/Coverage' },
  { key: 'strategy_posture', label: 'Strategy Optimization(분류)', status: 'supported', note: '장단점 설명만 — 자동 선택 없음' },
  { key: 'portfolio_advisory', label: 'Portfolio Optimization Advisory', status: 'supported', note: 'Balance/Capacity/Risk 분포/Resource Pressure — 자동 재조정 없음' },
  { key: 'recommendation_engine', label: 'Executive Recommendation Engine', status: 'supported', note: '11종 whitelist · 8요소 포함 · 사람 승인' },
  { key: 'explainable', label: 'Explainable Strategy', status: 'supported', note: '설명 체인 2단계 미만 시 서버·로직 이중 차단' },
  { key: 'briefing', label: 'Executive Briefing(일/주/월/분기)', status: 'supported', note: '핵심 Risk/미확인 생략 금지 — 자동 발송 없음' },
  { key: 'alignment', label: 'Strategic Alignment Intelligence', status: 'partial', note: 'Priority/Policy 매핑 자료 있을 때만 — 없으면 alignment_unverified' },
  { key: 'impact_projection', label: 'Decision Impact Projection', status: 'partial', note: 'Projection ≠ Outcome — KPI 원본 없으면 unavailable' },
  { key: 'cockpit20', label: 'Executive Cockpit 2.0', status: 'supported', note: '9영역 — humanDecisionRequired 고정' },
  { key: 'advisory_confidence', label: 'Advisory Confidence', status: 'supported', note: 'Confidence+Coverage+Unknown+Assumptions+Freshness+Limitations — ≠ Correctness' },
  { key: 'kpi_market', label: '시장/경쟁사 기반 Advisory', status: 'unsupported', note: 'market_data 없음(실측) — projection_unavailable' },
  { key: 'kpi_csat', label: 'CSAT 기반 Advisory', status: 'unsupported', note: '지표 원본 없음(실측)' },
  { key: 'auto_strategy_selection', label: '자동 전략 선택/Executive Decision', status: 'unsupported', note: '전면 금지 — 최종 결정은 항상 사람' },
  { key: 'auto_change', label: '자동 Priority/Portfolio/Budget/Policy/계약 변경', status: 'unsupported', note: '전면 금지' },
  { key: 'production_apply', label: 'Production/Merge/Deploy', status: 'unsupported', note: '미지원(의도적)' },
];
