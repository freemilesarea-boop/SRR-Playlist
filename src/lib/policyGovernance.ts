/**
 * policyGovernance — Enterprise Policy & Strategy Governance 순수 로직 (Phase AI-OPS-9).
 *
 * Business Rules → Policy Inventory → Versioning → Impact Analysis → Simulation →
 * AI Recommendation → Human Approval → Governance Audit.
 *
 * 원칙:
 *  - deterministic · pure function · null safety · NaN/Infinity 방어 · Date 주입 가능.
 *  - AI 는 Policy Recommendation 만 생성 — 자동 정책/가격/계약/정산/추천 정책 변경 없음.
 *  - Simulation 은 Digital Twin evidence-only(simulatedNotActual) — 실제 적용 없음.
 *  - 데이터 없는 축은 insufficient_data — 추측 금지. Production Entity 변경 없음.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 상수/타입 ────────────────────────────────────────────────────────── */
export const POLICY_DOMAINS = [
  'pricing', 'contract', 'settlement', 'playlist', 'recommendation', 'ai_learning',
  'security', 'privacy', 'retention', 'brand', 'enterprise', 'store', 'artist',
  'content', 'rollout', 'incident', 'capacity', 'cost',
] as const;
export type PolicyDomain = (typeof POLICY_DOMAINS)[number];

export type PolicyStatus = 'active' | 'draft' | 'deprecated' | 'archived' | 'proposed' | 'insufficient_data';
export type ApprovalStatus = 'draft' | 'proposed' | 'waiting_review' | 'approved_reference' | 'rejected' | 'cancelled' | 'archived';
export type ImpactLevel = 'negligible' | 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
export type ConsistencyVerdict = 'consistent' | 'partially_consistent' | 'conflicting' | 'insufficient_data';
export type AlignmentVerdict = 'aligned' | 'partially_aligned' | 'misaligned' | 'insufficient_data';

export const IMPACT_TONE: Record<ImpactLevel, 'success' | 'warning' | 'danger' | 'info'> = {
  negligible: 'success', low: 'success', moderate: 'warning', high: 'danger', critical: 'danger', insufficient_data: 'info',
};
export const CONSISTENCY_TONE: Record<ConsistencyVerdict, 'success' | 'warning' | 'danger' | 'info'> = {
  consistent: 'success', partially_consistent: 'warning', conflicting: 'danger', insufficient_data: 'info',
};
export const APPROVAL_TONE: Record<ApprovalStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'info', proposed: 'info', waiting_review: 'warning', approved_reference: 'success', rejected: 'danger', cancelled: 'info', archived: 'info',
};

/* ── Versioning(덮어쓰기 금지 — append-only 보조 로직) ───────────────── */
export interface VersionEntry { version: number; changeReason?: string | null }

/** 다음 버전 번호 — 기존 최대 + 1(중복/덮어쓰기 금지). 빈 목록 → 1. */
export function nextPolicyVersion(existing: VersionEntry[]): number {
  const max = existing.reduce((a, v) => (isFiniteNumber(v.version) && v.version > a ? v.version : a), 0);
  return max + 1;
}

/** 버전 추가 검증 — 중복 버전/사유 누락/역행 방지. */
export function validateVersionAppend(existing: VersionEntry[], candidate: VersionEntry): string[] {
  const errors: string[] = [];
  if (!isFiniteNumber(candidate.version) || candidate.version < 1) errors.push('version 은 1 이상');
  if (existing.some((v) => v.version === candidate.version)) errors.push('중복 버전 금지(덮어쓰기 금지)');
  if (isFiniteNumber(candidate.version) && candidate.version !== nextPolicyVersion(existing)) errors.push('버전은 순차 증가만 허용');
  if (!candidate.changeReason || !candidate.changeReason.trim()) errors.push('change_reason 필수 — 사유 없는 버전 금지');
  return errors;
}

/* ── Dependency Graph ─────────────────────────────────────────────────── */
export interface PolicyNode { code: string; dependsOn: string[] }
export interface DependencyGraph {
  nodes: string[];
  edges: { from: string; to: string }[];
  cycles: string[][];
  unknownRefs: string[];              // 존재하지 않는 정책 참조 — 추측 금지, 정직 표기
}

/** 정책 의존성 그래프 — edge(from 은 to 에 의존), cycle 감지(DFS), 미등록 참조 표기. */
export function buildDependencyGraph(policies: PolicyNode[]): DependencyGraph {
  const nodes = policies.map((p) => p.code);
  const set = new Set(nodes);
  const edges: { from: string; to: string }[] = [];
  const unknownRefs: string[] = [];
  for (const p of policies) {
    for (const dep of p.dependsOn ?? []) {
      if (!set.has(dep)) { if (!unknownRefs.includes(dep)) unknownRefs.push(dep); continue; }
      edges.push({ from: p.code, to: dep });
    }
  }
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (n: string) => {
    state.set(n, 1); stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 0) dfs(m);
      else if (s === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
    }
    stack.pop(); state.set(n, 2);
  };
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) dfs(n);
  return { nodes, edges, cycles, unknownRefs };
}

/** 변경 영향 하류 정책 — code 에 의존하는 정책의 transitive closure(결정적 정렬). */
export function findDownstreamPolicies(policies: PolicyNode[], code: string): string[] {
  const dependents = new Map<string, string[]>();  // dep → 그 dep 에 의존하는 정책들
  for (const p of policies) for (const dep of p.dependsOn ?? []) dependents.set(dep, [...(dependents.get(dep) ?? []), p.code]);
  const out = new Set<string>();
  const queue = [code];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const d of dependents.get(cur) ?? []) if (!out.has(d)) { out.add(d); queue.push(d); }
  }
  return [...out].sort();
}

/* ── Impact Analysis(추측 금지 — 실측 성분 재정규화) ─────────────────── */
export interface PolicyImpactComponents {
  revenueImpact: number | null; growthImpact: number | null; storeImpact: number | null;
  artistImpact: number | null; contractImpact: number | null; settlementImpact: number | null;
  playbackImpact: number | null; securityImpact: number | null; complianceImpact: number | null;
}

export interface PolicyImpactResult {
  score: number | null; level: ImpactLevel; used: string[]; missing: string[];
  noAutoAction: true; note: string;
}

const impactLevel = (score: number): Exclude<ImpactLevel, 'insufficient_data'> =>
  score < 10 ? 'negligible' : score < 30 ? 'low' : score < 55 ? 'moderate' : score < 80 ? 'high' : 'critical';

/** 정책 변경 영향 점수 — 성분(0~100) 가중 재정규화. 전부 null → insufficient_data(추측 금지). */
export function calculatePolicyImpact(c: PolicyImpactComponents): PolicyImpactResult {
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'revenue', value: c.revenueImpact, weight: 0.2 },
    { key: 'growth', value: c.growthImpact, weight: 0.12 },
    { key: 'store', value: c.storeImpact, weight: 0.1 },
    { key: 'artist', value: c.artistImpact, weight: 0.1 },
    { key: 'contract', value: c.contractImpact, weight: 0.12 },
    { key: 'settlement', value: c.settlementImpact, weight: 0.12 },
    { key: 'playback', value: c.playbackImpact, weight: 0.08 },
    { key: 'security', value: c.securityImpact, weight: 0.08 },
    { key: 'compliance', value: c.complianceImpact, weight: 0.08 },
  ]);
  if (score == null) return { score: null, level: 'insufficient_data', used, missing, noAutoAction: true, note: '측정 가능한 영향 성분 없음 — 추측 금지' };
  return { score, level: impactLevel(score), used, missing, noAutoAction: true, note: missing.length ? `누락 성분 제외 재정규화: ${missing.join(', ')}` : '전 성분 실측' };
}

/** 정책 위험 점수 — 영향 × (1 - confidence 보정) + unknown factor 가산(결정적). */
export function calculatePolicyRisk(input: { impactScore: number | null; confidence: number | null; unknownFactorCount: number }): { score: number | null; level: ImpactLevel } {
  if (!isFiniteNumber(input.impactScore)) return { score: null, level: 'insufficient_data' };
  const conf = isFiniteNumber(input.confidence) ? Math.max(0, Math.min(100, input.confidence)) : 50;
  const unknowns = isFiniteNumber(input.unknownFactorCount) ? Math.max(0, input.unknownFactorCount) : 0;
  const score = clampScore(input.impactScore * (1 - conf / 250) + Math.min(20, unknowns * 5));
  return { score, level: impactLevel(score) };
}

/* ── Policy Simulation(Digital Twin evidence-only — 실제 적용 금지) ───── */
export interface PolicySimulationInput {
  scenario: string;
  kind: 'subscription_price' | 'company_fee_ratio' | 'settlement_ratio' | 'playlist_policy' | 'recommendation_algorithm';
  /** 비율 변화(예: +10% 인상 → 10). ratio 계열은 새 비율값(0~1). */
  changeValue: number | null;
}
export interface PolicySimulationContext {
  mrr: number | null;                       // 실측 MRR
  activeSubscriptions: number | null;
  poolRevenueRatio: number | null;          // settlement_policies 실측
  companyFeeRatio: number | null;
  withholdingTaxRatio: number | null;
}
export interface PolicySimulationResult {
  scenario: string;
  result: 'projected' | 'conflicting' | 'insufficient_data';
  expectedBenefit: string;
  expectedRisk: string;
  evidence: { label: string; value: number | string | null }[];
  confidence: number | null;
  unknownFactors: string[];
  simulatedNotActual: true;
  evidenceOnly: true;
  noProductionApply: true;
}

const SIM_BASE: Pick<PolicySimulationResult, 'simulatedNotActual' | 'evidenceOnly' | 'noProductionApply'> =
  { simulatedNotActual: true, evidenceOnly: true, noProductionApply: true };

/** 정책 변경 시뮬레이션 — 산술 투영만(수요 탄력성 등 미지 요인은 unknownFactors 정직 표기). */
export function simulatePolicyChange(input: PolicySimulationInput, ctx: PolicySimulationContext): PolicySimulationResult {
  const insufficient = (why: string): PolicySimulationResult => ({
    scenario: input.scenario, result: 'insufficient_data', expectedBenefit: 'insufficient_data', expectedRisk: why,
    evidence: [], confidence: null, unknownFactors: [why], ...SIM_BASE,
  });
  if (input.kind === 'subscription_price') {
    if (!isFiniteNumber(ctx.mrr) || !isFiniteNumber(input.changeValue)) return insufficient('MRR 또는 변경률 없음 — 투영 불가');
    const projected = Math.round(ctx.mrr * (1 + input.changeValue / 100));
    return {
      scenario: input.scenario, result: 'projected',
      expectedBenefit: `단순 산술 MRR 투영 ${projected.toLocaleString('ko-KR')}원(현 ${ctx.mrr.toLocaleString('ko-KR')}원, 해지 반응 미반영)`,
      expectedRisk: input.changeValue > 0 ? '가격 인상에 따른 해지 증가 가능 — 탄력성 데이터 없음' : '단가 하락으로 MRR 감소 확정분 존재',
      evidence: [{ label: 'mrr_actual', value: ctx.mrr }, { label: 'change_pct', value: input.changeValue }, { label: 'projected_mrr_arithmetic', value: projected }],
      confidence: 40, unknownFactors: ['수요 탄력성(해지/전환) 데이터 없음'], ...SIM_BASE,
    };
  }
  if (input.kind === 'company_fee_ratio' || input.kind === 'settlement_ratio') {
    if (!isFiniteNumber(input.changeValue)) return insufficient('새 비율값 없음');
    if (input.changeValue < 0 || input.changeValue > 1) return insufficient('비율은 0~1 — 범위 밖 투영 금지');
    const pool = input.kind === 'settlement_ratio' ? input.changeValue : ctx.poolRevenueRatio;
    const fee = input.kind === 'company_fee_ratio' ? input.changeValue : ctx.companyFeeRatio;
    if (!isFiniteNumber(pool) || !isFiniteNumber(fee)) return insufficient('현행 settlement 비율 미확인');
    if (pool + fee > 1) {
      return {
        scenario: input.scenario, result: 'conflicting',
        expectedBenefit: '없음', expectedRisk: `pool(${pool}) + fee(${fee}) > 1 — 정산 불능 구조(Contract vs Settlement 충돌)`,
        evidence: [{ label: 'pool_revenue_ratio', value: pool }, { label: 'company_fee_ratio', value: fee }],
        confidence: 95, unknownFactors: [], ...SIM_BASE,
      };
    }
    return {
      scenario: input.scenario, result: 'projected',
      expectedBenefit: `구조 유효(pool ${pool} + fee ${fee} ≤ 1) — 배분 가능`,
      expectedRisk: '아티스트 정산액 변화에 따른 이탈 반응은 데이터 없음',
      evidence: [{ label: 'pool_revenue_ratio', value: pool }, { label: 'company_fee_ratio', value: fee }, { label: 'withholding_tax_ratio', value: ctx.withholdingTaxRatio }],
      confidence: 60, unknownFactors: ['아티스트 이탈 반응 데이터 없음'], ...SIM_BASE,
    };
  }
  // playlist_policy / recommendation_algorithm — 참여도 반응 모델 없음(정직 표기)
  return insufficient(`${input.kind} 반응 모델 없음 — Digital Twin 근거 데이터 부족`);
}

/* ── AI Policy Recommendation(Explainable 8요소) ─────────────────────── */
export interface PolicyRecommendation {
  code: string;
  recommendation: string;
  reason: string;
  evidence: { label: string; value: number | string | null }[];
  confidence: number;
  alternatives: string[];
  risk: string;
  preconditions: string[];
  limitations: string[];
  humanApprovalRequired: true;
  noAutoApply: true;
}

/** Explainable 검증 — 8요소(Recommendation/Reason/Evidence/Confidence/Alternatives/Risk/Preconditions/Limitations). */
export function validatePolicyRecommendation(r: Partial<PolicyRecommendation> | null | undefined): string[] {
  if (!r) return ['recommendation 없음'];
  const errors: string[] = [];
  if (!r.recommendation || !r.recommendation.trim()) errors.push('Recommendation 필수');
  if (!r.reason || !r.reason.trim()) errors.push('Reason 필수');
  if (!r.evidence || !r.evidence.length) errors.push('Evidence 필수(빈 배열 금지)');
  if (!isFiniteNumber(r.confidence) || r.confidence < 0 || r.confidence > 100) errors.push('Confidence 0~100 필수');
  if (!r.alternatives || !r.alternatives.length) errors.push('대안(Alternatives) 필수');
  if (!r.risk || !r.risk.trim()) errors.push('Risk 필수');
  if (!r.preconditions) errors.push('Preconditions 필수');
  if (!r.limitations || !r.limitations.length) errors.push('Limitations 필수');
  return errors;
}

export interface PolicyRecommendationInput {
  code: string;
  domain: PolicyDomain;
  finding: string;                    // 실측 관찰(예: 'pool+fee 합이 0.97 로 여유 3%')
  metricValue: number | null;
  sampleSize: number | null;
  simulation?: PolicySimulationResult | null;
}

/** 추천 생성 — 표본<5 또는 관찰 없음이면 생성 안 함(결정적·Human Approval 필수). */
export function buildPolicyRecommendation(input: PolicyRecommendationInput): PolicyRecommendation | { insufficient: true; why: string } {
  if (!input.finding || !input.finding.trim()) return { insufficient: true, why: '실측 관찰 없음 — 추천 생성 금지' };
  if (!isFiniteNumber(input.sampleSize) || input.sampleSize < 5) return { insufficient: true, why: '표본 5건 미만 — 추천 생성 금지' };
  if (!isFiniteNumber(input.metricValue)) return { insufficient: true, why: '지표 값 없음 — 추천 생성 금지' };
  const simConf = input.simulation && isFiniteNumber(input.simulation.confidence) ? input.simulation.confidence : null;
  const confidence = clampScore(Math.min(85, 35 + Math.min(30, input.sampleSize) + (simConf != null ? simConf / 5 : 0)));
  return {
    code: input.code,
    recommendation: `[${input.domain}] ${input.finding} — 정책 검토 제안(변경 아님)`,
    reason: `실측 관찰: ${input.finding} (표본 ${input.sampleSize}건, 지표 ${input.metricValue})`,
    evidence: [
      { label: 'metric_value', value: input.metricValue },
      { label: 'sample_size', value: input.sampleSize },
      ...(input.simulation ? [{ label: 'simulation_result', value: input.simulation.result }] : []),
    ],
    confidence,
    alternatives: ['현행 정책 유지(변경 없음)', '관찰 기간 연장 후 재평가'],
    risk: input.simulation?.expectedRisk ?? '변경 반응 데이터 부족 — 단계적 검토 필요',
    preconditions: ['Human Approval', '영향 분석 검토', input.simulation ? 'Simulation evidence 검토(simulated≠actual)' : '시뮬레이션 미수행 — 근거 한정'],
    limitations: ['추천만 — 자동 정책 변경·Production 적용 없음'],
    humanApprovalRequired: true,
    noAutoApply: true,
  };
}

/* ── Approval Workflow(참고 상태 — 실제 적용 아님) ───────────────────── */
const APPROVAL_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  draft: ['proposed', 'cancelled'],
  proposed: ['waiting_review', 'cancelled'],
  waiting_review: ['approved_reference', 'rejected', 'cancelled'],
  approved_reference: ['archived'],
  rejected: ['archived'],
  cancelled: ['archived'],
  archived: [],
};

/** 승인 워크플로 전이 — whitelist 만 허용. approved_reference 도 실제 적용 상태가 아님. */
export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return (APPROVAL_TRANSITIONS[from] ?? []).includes(to);
}

/** 감사 증거 패키지 — 결정 시점 근거 고정(재현 가능). */
export function buildApprovalEvidence(rec: PolicyRecommendation, decision: { status: ApprovalStatus; reason: string; decidedBy: string }, now: Date): {
  recCode: string; status: ApprovalStatus; decisionReason: string; decidedBy: string; decidedAt: string;
  evidenceSnapshot: { label: string; value: number | string | null }[]; confidenceAtDecision: number;
  productionApplied: false; humanDecision: true;
} {
  return {
    recCode: rec.code, status: decision.status, decisionReason: decision.reason, decidedBy: decision.decidedBy,
    decidedAt: now.toISOString(), evidenceSnapshot: [...rec.evidence], confidenceAtDecision: rec.confidence,
    productionApplied: false, humanDecision: true,
  };
}

/* ── Strategy Alignment(선언 목표 대비 — 추측 금지) ──────────────────── */
export interface StrategyAlignmentResult { verdict: AlignmentVerdict; matched: string[]; unmatched: string[]; note: string }

/** 정책 선언 목표 vs 회사 전략 축 교집합 비율로 판정(어느 한쪽 없으면 insufficient_data). */
export function evaluateStrategyAlignment(policyObjectives: string[] | null | undefined, strategyPillars: string[] | null | undefined): StrategyAlignmentResult {
  const objs = (policyObjectives ?? []).map((s) => s.trim()).filter(Boolean);
  const pillars = (strategyPillars ?? []).map((s) => s.trim()).filter(Boolean);
  if (!objs.length || !pillars.length) return { verdict: 'insufficient_data', matched: [], unmatched: objs, note: '정책 목표 또는 전략 축 미선언 — 판정 금지' };
  const pillarSet = new Set(pillars);
  const matched = objs.filter((o) => pillarSet.has(o)).sort();
  const unmatched = objs.filter((o) => !pillarSet.has(o)).sort();
  const ratio = matched.length / objs.length;
  const verdict: AlignmentVerdict = ratio >= 0.75 ? 'aligned' : ratio >= 0.25 ? 'partially_aligned' : 'misaligned';
  return { verdict, matched, unmatched, note: `선언 목표 ${objs.length}개 중 ${matched.length}개 전략 축 일치` };
}

/* ── Governance Consistency(정책 쌍 충돌 검토) ───────────────────────── */
export interface ConflictCheckInput {
  pair: 'contract_vs_settlement' | 'pricing_vs_revenue' | 'playlist_vs_brand' | 'security_vs_privacy' | 'cost_vs_capacity';
  values: Record<string, number | null>;
}
export interface ConflictCheckResult { pair: ConflictCheckInput['pair']; verdict: ConsistencyVerdict; detail: string }

/** 알려진 충돌 축 검사 — 판정 근거 없으면 insufficient_data(추측 금지). */
export function detectPolicyConflict(input: ConflictCheckInput): ConflictCheckResult {
  const v = input.values ?? {};
  switch (input.pair) {
    case 'contract_vs_settlement': {
      const pool = v.pool_revenue_ratio; const fee = v.company_fee_ratio;
      if (!isFiniteNumber(pool) || !isFiniteNumber(fee)) return { pair: input.pair, verdict: 'insufficient_data', detail: '정산 비율 미확인' };
      if (pool + fee > 1) return { pair: input.pair, verdict: 'conflicting', detail: `pool(${pool}) + fee(${fee}) > 1 — 배분 불능` };
      if (pool + fee > 0.95) return { pair: input.pair, verdict: 'partially_consistent', detail: `여유 ${(1 - pool - fee).toFixed(3)} — 세금/수수료 흡수 여력 부족` };
      return { pair: input.pair, verdict: 'consistent', detail: `pool + fee = ${(pool + fee).toFixed(3)} ≤ 1` };
    }
    case 'pricing_vs_revenue': {
      const price = v.plan_price; const mrr = v.mrr; const subs = v.active_subscriptions;
      if (!isFiniteNumber(price) || !isFiniteNumber(mrr) || !isFiniteNumber(subs) || subs <= 0) return { pair: input.pair, verdict: 'insufficient_data', detail: '가격/MRR/구독수 미확인' };
      const avg = mrr / subs;
      if (avg > price * 1.05) return { pair: input.pair, verdict: 'conflicting', detail: `평균 청구액(${Math.round(avg)})이 정가(${price}) 초과 — 가격 정책과 청구 불일치` };
      if (avg < price * 0.5) return { pair: input.pair, verdict: 'partially_consistent', detail: `평균 청구액(${Math.round(avg)})이 정가의 50% 미만 — 할인 정책 검토 필요` };
      return { pair: input.pair, verdict: 'consistent', detail: `평균 청구액 ${Math.round(avg)} — 정가 ${price} 범위 내` };
    }
    case 'cost_vs_capacity': {
      const usage = v.usage; const limit = v.limit;
      if (!isFiniteNumber(usage) || !isFiniteNumber(limit) || limit <= 0) return { pair: input.pair, verdict: 'insufficient_data', detail: 'limit 미확인 — utilization 생성 금지' };
      const util = usage / limit;
      if (util > 1) return { pair: input.pair, verdict: 'conflicting', detail: `사용량이 limit 초과(${(util * 100).toFixed(0)}%)` };
      if (util > 0.8) return { pair: input.pair, verdict: 'partially_consistent', detail: `utilization ${(util * 100).toFixed(0)}% — 용량 정책 재검토 권고` };
      return { pair: input.pair, verdict: 'consistent', detail: `utilization ${(util * 100).toFixed(0)}%` };
    }
    case 'playlist_vs_brand':
    case 'security_vs_privacy':
      // 정량 판정 기준 데이터 없음 — 추측 금지
      return { pair: input.pair, verdict: 'insufficient_data', detail: '정량 판정 기준 데이터 없음 — 수동 검토 필요' };
  }
}

/** 전체 일관성 — 개별 판정 집계(conflicting 1건이라도 있으면 conflicting). */
export function evaluateGovernanceConsistency(results: ConflictCheckResult[]): { verdict: ConsistencyVerdict; conflicting: number; partial: number; consistent: number; unknown: number } {
  const conflicting = results.filter((r) => r.verdict === 'conflicting').length;
  const partial = results.filter((r) => r.verdict === 'partially_consistent').length;
  const consistent = results.filter((r) => r.verdict === 'consistent').length;
  const unknown = results.filter((r) => r.verdict === 'insufficient_data').length;
  const verdict: ConsistencyVerdict = !results.length || consistent + partial + conflicting === 0 ? 'insufficient_data'
    : conflicting > 0 ? 'conflicting' : partial > 0 ? 'partially_consistent' : 'consistent';
  return { verdict, conflicting, partial, consistent, unknown };
}

/* ── Support Matrix(정직 표기) ────────────────────────────────────────── */
export interface PolicySupportItem { key: string; label: string; status: 'fully_supported' | 'supported' | 'reference_only' | 'insufficient_data' | 'unsupported'; note: string }

export const POLICY_SUPPORT: PolicySupportItem[] = [
  { key: 'settlement_policy_source', label: '정산 정책 원본', status: 'fully_supported', note: 'settlement_policies(0059) 실측 — append-only 원본 미변경' },
  { key: 'pricing_policy_source', label: '가격 정책 원본', status: 'fully_supported', note: 'subscription_plans(0015) 실측' },
  { key: 'retention_policy_source', label: 'Retention 정책 원본', status: 'fully_supported', note: 'ai_data_retention_policies(0510) — legal_basis 필수' },
  { key: 'sla_policy_source', label: 'SLA/Escalation 정책 원본', status: 'fully_supported', note: 'ai_operational_policies(0509)' },
  { key: 'brand_playlist_policy_source', label: '브랜드/플레이리스트 정책(B2B)', status: 'supported', note: 'franchise_music_policies + versions(0349)' },
  { key: 'enterprise_automation_source', label: 'Enterprise 자동화 규칙', status: 'supported', note: 'enterprise_policy_automation_rules(0378) — 읽기 집계만' },
  { key: 'contract_policy_source', label: '계약 정책', status: 'reference_only', note: 'artist_contracts(0057) 상태 실측 — 전용 정책 테이블 없음' },
  { key: 'store_artist_content_policy', label: 'Store/Artist/Content 정책', status: 'reference_only', note: '전용 정책 테이블 없음 — registry 기록으로만 관리' },
  { key: 'policy_registry', label: 'Policy Inventory(18 도메인)', status: 'fully_supported', note: 'ai_enterprise_policies(0512) whitelist' },
  { key: 'policy_versioning', label: 'Policy Versioning', status: 'fully_supported', note: 'append-only — 덮어쓰기 금지·중복 버전 unique 방지' },
  { key: 'dependency_graph', label: 'Dependency Graph', status: 'supported', note: 'depends_on 선언 기반 — cycle/미등록 참조 감지' },
  { key: 'impact_analysis', label: 'Impact Analysis', status: 'supported', note: '실측 성분 재정규화 — 전부 null 이면 insufficient_data' },
  { key: 'policy_simulation', label: 'Policy Simulation', status: 'supported', note: 'Digital Twin evidence-only(simulated≠actual) — 탄력성 미지 요인 정직 표기' },
  { key: 'playlist_reco_simulation', label: '플레이리스트/추천 알고리즘 시뮬레이션', status: 'insufficient_data', note: '참여도 반응 모델 없음 — 투영 금지' },
  { key: 'ai_recommendation', label: 'AI Policy Recommendation', status: 'fully_supported', note: 'Explainable 8요소 서버+클라이언트 이중 검증' },
  { key: 'approval_workflow', label: 'Human Approval Workflow', status: 'fully_supported', note: 'whitelist 전이 — approved_reference ≠ 실제 적용' },
  { key: 'strategy_alignment', label: 'Strategy Alignment', status: 'supported', note: '선언 목표 vs 전략 축 — 미선언 시 insufficient_data' },
  { key: 'governance_consistency', label: 'Governance Consistency', status: 'supported', note: '정량 축(정산/가격/용량)만 판정 — 나머지 수동 검토' },
  { key: 'governance_audit', label: 'Governance Audit', status: 'fully_supported', note: 'ai_policy_events whitelist — 삭제 RPC 없음' },
  { key: 'auto_policy_change', label: '자동 정책 변경', status: 'unsupported', note: '금지 — 추천만' },
  { key: 'auto_price_change', label: '자동 가격 변경', status: 'unsupported', note: '금지' },
  { key: 'auto_contract_settlement_change', label: '자동 계약/정산 정책 변경', status: 'unsupported', note: '금지 — 원본 테이블 미변경' },
  { key: 'auto_reco_policy_change', label: '자동 AI 추천 정책 변경', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: '자동 Merge/Deploy/Migration/Production Apply', status: 'unsupported', note: '금지 — approved_reference 도 적용 아님' },
];
