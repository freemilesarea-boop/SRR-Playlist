// Phase AI-OPS-9 — Policy Governance 순수 로직 단위 테스트.
// Versioning(중복/덮어쓰기 금지) · Dependency Graph(cycle/downstream) · Impact(레벨/insufficient) ·
// Simulation(revenue/settlement/playlist — simulated≠actual) · Recommendation(8요소/표본 방어/결정적) ·
// Approval(whitelist 전이) · Conflict/Consistency · Alignment · Support Matrix(자동 금지).
import { describe, it, expect } from 'vitest';
import {
  nextPolicyVersion, validateVersionAppend, buildDependencyGraph, findDownstreamPolicies,
  calculatePolicyImpact, calculatePolicyRisk, simulatePolicyChange,
  validatePolicyRecommendation, buildPolicyRecommendation, canTransitionApproval, buildApprovalEvidence,
  evaluateStrategyAlignment, detectPolicyConflict, evaluateGovernanceConsistency, POLICY_SUPPORT,
  type PolicyImpactComponents, type PolicyRecommendation, type PolicySimulationContext,
} from './policyGovernance';

const NOW = new Date('2026-07-14T12:00:00Z');
const CTX: PolicySimulationContext = { mrr: 1_000_000, activeSubscriptions: 100, poolRevenueRatio: 0.7, companyFeeRatio: 0.2, withholdingTaxRatio: 0.033 };

describe('Policy Versioning(덮어쓰기 금지)', () => {
  it('버전 증가 — 빈 목록 1, 최대+1 · 중복/역행/사유 누락 거부', () => {
    expect(nextPolicyVersion([])).toBe(1);
    expect(nextPolicyVersion([{ version: 1 }, { version: 3 }])).toBe(4);
    expect(validateVersionAppend([{ version: 1 }], { version: 2, changeReason: 'why' })).toEqual([]);
    expect(validateVersionAppend([{ version: 1 }], { version: 1, changeReason: 'why' }).some((e) => e.includes('중복'))).toBe(true);
    expect(validateVersionAppend([{ version: 1 }], { version: 5, changeReason: 'why' }).some((e) => e.includes('순차'))).toBe(true);
    expect(validateVersionAppend([{ version: 1 }], { version: 2, changeReason: ' ' }).some((e) => e.includes('사유'))).toBe(true);
  });
});

describe('Dependency Graph', () => {
  const P = [
    { code: 'pricing', dependsOn: [] },
    { code: 'settlement', dependsOn: ['pricing'] },
    { code: 'contract', dependsOn: ['settlement'] },
    { code: 'forecast', dependsOn: ['pricing', 'ghost'] },
  ];
  it('edge/미등록 참조/downstream transitive', () => {
    const g = buildDependencyGraph(P);
    expect(g.edges).toContainEqual({ from: 'settlement', to: 'pricing' });
    expect(g.unknownRefs).toEqual(['ghost']);
    expect(g.cycles).toEqual([]);
    expect(findDownstreamPolicies(P, 'pricing')).toEqual(['contract', 'forecast', 'settlement']);
    expect(findDownstreamPolicies(P, 'contract')).toEqual([]);
  });
  it('cycle 감지', () => {
    const g = buildDependencyGraph([{ code: 'a', dependsOn: ['b'] }, { code: 'b', dependsOn: ['a'] }]);
    expect(g.cycles.length).toBeGreaterThan(0);
  });
});

describe('Impact Analysis', () => {
  const C = (v: number | null): PolicyImpactComponents => ({ revenueImpact: v, growthImpact: v, storeImpact: v, artistImpact: v, contractImpact: v, settlementImpact: v, playbackImpact: v, securityImpact: v, complianceImpact: v });
  it('negligible~critical · 재정규화 · 전부 null insufficient · noAutoAction', () => {
    expect(calculatePolicyImpact(C(5)).level).toBe('negligible');
    expect(calculatePolicyImpact(C(20)).level).toBe('low');
    expect(calculatePolicyImpact(C(40)).level).toBe('moderate');
    expect(calculatePolicyImpact(C(70)).level).toBe('high');
    expect(calculatePolicyImpact(C(90)).level).toBe('critical');
    const partial = calculatePolicyImpact({ ...C(50), securityImpact: null });
    expect(partial.score).toBe(50); expect(partial.missing).toEqual(['security']);
    expect(calculatePolicyImpact(C(null)).level).toBe('insufficient_data');
    expect(calculatePolicyImpact(C(90)).noAutoAction).toBe(true);
  });
  it('위험 점수 — confidence 보정 · unknown 가산 · impact 없으면 insufficient', () => {
    expect(calculatePolicyRisk({ impactScore: null, confidence: 80, unknownFactorCount: 0 }).level).toBe('insufficient_data');
    const lowConf = calculatePolicyRisk({ impactScore: 60, confidence: 0, unknownFactorCount: 4 });
    const highConf = calculatePolicyRisk({ impactScore: 60, confidence: 100, unknownFactorCount: 0 });
    expect(lowConf.score!).toBeGreaterThan(highConf.score!);
  });
});

describe('Policy Simulation(simulated≠actual)', () => {
  it('구독료 변경 — 산술 MRR 투영 + 탄력성 unknown · MRR 없으면 insufficient', () => {
    const r = simulatePolicyChange({ scenario: '구독료 10% 인상', kind: 'subscription_price', changeValue: 10 }, CTX);
    expect(r.result).toBe('projected');
    expect(r.evidence.find((e) => e.label === 'projected_mrr_arithmetic')!.value).toBe(1_100_000);
    expect(r.unknownFactors.join(' ')).toContain('탄력성');
    expect(r.simulatedNotActual).toBe(true); expect(r.evidenceOnly).toBe(true); expect(r.noProductionApply).toBe(true);
    expect(simulatePolicyChange({ scenario: 'x', kind: 'subscription_price', changeValue: 10 }, { ...CTX, mrr: null }).result).toBe('insufficient_data');
  });
  it('정산 비율 — pool+fee>1 이면 conflicting · 범위 밖 금지', () => {
    expect(simulatePolicyChange({ scenario: 'pool 0.9', kind: 'settlement_ratio', changeValue: 0.9 }, CTX).result).toBe('conflicting');
    expect(simulatePolicyChange({ scenario: 'pool 0.75', kind: 'settlement_ratio', changeValue: 0.75 }, CTX).result).toBe('projected');
    expect(simulatePolicyChange({ scenario: 'fee 1.2', kind: 'company_fee_ratio', changeValue: 1.2 }, CTX).result).toBe('insufficient_data');
  });
  it('플레이리스트/추천 알고리즘 — 반응 모델 없음 insufficient(추측 금지)', () => {
    expect(simulatePolicyChange({ scenario: 'x', kind: 'playlist_policy', changeValue: 1 }, CTX).result).toBe('insufficient_data');
    expect(simulatePolicyChange({ scenario: 'x', kind: 'recommendation_algorithm', changeValue: 1 }, CTX).result).toBe('insufficient_data');
  });
});

describe('Recommendation(Explainable 8요소)', () => {
  const ok: Partial<PolicyRecommendation> = { recommendation: 'r', reason: 'why', evidence: [{ label: 'x', value: 1 }], confidence: 60, alternatives: ['유지'], risk: 'rk', preconditions: ['Human Approval'], limitations: ['추천만'] };
  it('8요소 검증 — 누락 시 오류', () => {
    expect(validatePolicyRecommendation(ok)).toEqual([]);
    expect(validatePolicyRecommendation({ ...ok, evidence: [] }).some((e) => e.includes('Evidence'))).toBe(true);
    expect(validatePolicyRecommendation({ ...ok, confidence: 150 }).some((e) => e.includes('0~100'))).toBe(true);
    expect(validatePolicyRecommendation({ ...ok, alternatives: [] }).some((e) => e.includes('대안'))).toBe(true);
    expect(validatePolicyRecommendation({ ...ok, limitations: [] }).some((e) => e.includes('Limitations'))).toBe(true);
    expect(validatePolicyRecommendation(null)).toEqual(['recommendation 없음']);
  });
  it('생성 — 표본<5/관찰 없음/지표 없음이면 생성 안 함 · Human Approval · 결정적', () => {
    const a = buildPolicyRecommendation({ code: 'r1', domain: 'settlement', finding: 'pool+fee 0.97', metricValue: 0.97, sampleSize: 12 });
    expect('insufficient' in a).toBe(false);
    if (!('insufficient' in a)) {
      expect(a.humanApprovalRequired).toBe(true); expect(a.noAutoApply).toBe(true);
      expect(validatePolicyRecommendation(a)).toEqual([]);
    }
    expect('insufficient' in buildPolicyRecommendation({ code: 'r2', domain: 'pricing', finding: 'x', metricValue: 1, sampleSize: 3 })).toBe(true);
    expect('insufficient' in buildPolicyRecommendation({ code: 'r3', domain: 'pricing', finding: ' ', metricValue: 1, sampleSize: 10 })).toBe(true);
    expect('insufficient' in buildPolicyRecommendation({ code: 'r4', domain: 'pricing', finding: 'x', metricValue: null, sampleSize: 10 })).toBe(true);
    const b = buildPolicyRecommendation({ code: 'r1', domain: 'settlement', finding: 'pool+fee 0.97', metricValue: 0.97, sampleSize: 12 });
    expect(a).toEqual(b);
  });
});

describe('Approval Workflow(참고 상태 — 실제 적용 아님)', () => {
  it('whitelist 전이만 허용', () => {
    expect(canTransitionApproval('draft', 'proposed')).toBe(true);
    expect(canTransitionApproval('proposed', 'waiting_review')).toBe(true);
    expect(canTransitionApproval('waiting_review', 'approved_reference')).toBe(true);
    expect(canTransitionApproval('waiting_review', 'rejected')).toBe(true);
    expect(canTransitionApproval('draft', 'approved_reference')).toBe(false);
    expect(canTransitionApproval('approved_reference', 'proposed')).toBe(false);
    expect(canTransitionApproval('archived', 'draft')).toBe(false);
  });
  it('감사 증거 패키지 — production 미적용·사람 결정 고정', () => {
    const rec = buildPolicyRecommendation({ code: 'r1', domain: 'settlement', finding: 'f', metricValue: 1, sampleSize: 10 });
    if ('insufficient' in rec) throw new Error('unexpected');
    const ev = buildApprovalEvidence(rec, { status: 'approved_reference', reason: '근거 충분', decidedBy: 'admin-1' }, NOW);
    expect(ev.productionApplied).toBe(false); expect(ev.humanDecision).toBe(true);
    expect(ev.decidedAt).toBe('2026-07-14T12:00:00.000Z');
    expect(ev.evidenceSnapshot.length).toBeGreaterThan(0);
  });
});

describe('Alignment / Consistency', () => {
  it('Strategy Alignment — 교집합 비율 · 미선언 insufficient', () => {
    expect(evaluateStrategyAlignment(['revenue_growth', 'brand_trust'], ['revenue_growth', 'brand_trust', 'retention']).verdict).toBe('aligned');
    expect(evaluateStrategyAlignment(['revenue_growth', 'x', 'y'], ['revenue_growth']).verdict).toBe('partially_aligned');
    expect(evaluateStrategyAlignment(['a', 'b'], ['c']).verdict).toBe('misaligned');
    expect(evaluateStrategyAlignment([], ['c']).verdict).toBe('insufficient_data');
    expect(evaluateStrategyAlignment(['a'], null).verdict).toBe('insufficient_data');
  });
  it('충돌 감지 — 정산 합>1 conflicting · 데이터 없으면 insufficient · 정성 축 수동 검토', () => {
    expect(detectPolicyConflict({ pair: 'contract_vs_settlement', values: { pool_revenue_ratio: 0.85, company_fee_ratio: 0.2 } }).verdict).toBe('conflicting');
    expect(detectPolicyConflict({ pair: 'contract_vs_settlement', values: { pool_revenue_ratio: 0.7, company_fee_ratio: 0.2 } }).verdict).toBe('consistent');
    expect(detectPolicyConflict({ pair: 'contract_vs_settlement', values: {} }).verdict).toBe('insufficient_data');
    expect(detectPolicyConflict({ pair: 'pricing_vs_revenue', values: { plan_price: 10000, mrr: 1_200_000, active_subscriptions: 100 } }).verdict).toBe('conflicting');
    expect(detectPolicyConflict({ pair: 'cost_vs_capacity', values: { usage: 90, limit: 100 } }).verdict).toBe('partially_consistent');
    expect(detectPolicyConflict({ pair: 'cost_vs_capacity', values: { usage: 90, limit: null } }).verdict).toBe('insufficient_data');
    expect(detectPolicyConflict({ pair: 'security_vs_privacy', values: {} }).verdict).toBe('insufficient_data');
  });
  it('전체 일관성 집계 — conflicting 우선 · 전부 unknown 이면 insufficient', () => {
    const c = (verdict: 'consistent' | 'partially_consistent' | 'conflicting' | 'insufficient_data') => ({ pair: 'cost_vs_capacity' as const, verdict, detail: '' });
    expect(evaluateGovernanceConsistency([c('consistent'), c('conflicting')]).verdict).toBe('conflicting');
    expect(evaluateGovernanceConsistency([c('consistent'), c('partially_consistent')]).verdict).toBe('partially_consistent');
    expect(evaluateGovernanceConsistency([c('consistent'), c('insufficient_data')]).verdict).toBe('consistent');
    expect(evaluateGovernanceConsistency([c('insufficient_data')]).verdict).toBe('insufficient_data');
    expect(evaluateGovernanceConsistency([]).verdict).toBe('insufficient_data');
  });
});

describe('Support Matrix', () => {
  it('정산/가격/Retention 원본 실측 · 플레이리스트 시뮬레이션 insufficient · 자동 실행 전부 unsupported', () => {
    expect(POLICY_SUPPORT.find((s) => s.key === 'settlement_policy_source')!.status).toBe('fully_supported');
    expect(POLICY_SUPPORT.find((s) => s.key === 'pricing_policy_source')!.status).toBe('fully_supported');
    expect(POLICY_SUPPORT.find((s) => s.key === 'policy_versioning')!.note).toContain('덮어쓰기 금지');
    expect(POLICY_SUPPORT.find((s) => s.key === 'playlist_reco_simulation')!.status).toBe('insufficient_data');
    expect(POLICY_SUPPORT.find((s) => s.key === 'store_artist_content_policy')!.status).toBe('reference_only');
    for (const k of ['auto_policy_change', 'auto_price_change', 'auto_contract_settlement_change', 'auto_reco_policy_change', 'production_apply']) {
      expect(POLICY_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
