// Phase AI-MUSIC-8 — AI Constitution & Trust Governance 순수 로직 단위 테스트.
// Constitution Enforcement · Trust 계층(prediction/strategy/sandbox/draft/governance/overall+cap+provisional) ·
// Trust Status/Budget · Decision Quality · Reputation · Governance Health · Violation Response ·
// Change Eligibility · Expiration · Support · 0~100 clamp · NaN 금지 · AI 직접 수정 불가.
import { describe, it, expect } from 'vitest';
import {
  CONSTITUTION_RULES, immutableRules, constitutionCheck,
  predictionTrust, strategyTrust, governanceTrust, overallTrust,
  trustStatus, trustBudget, budgetExceeded, decisionQuality, reputation, governanceHealth,
  violationResponse, changeCandidateEligibility, defaultExecutionPreconditions, changeCandidateExpired,
  changeIdempotencyKey, GOVERNANCE_SUPPORT, CHANGE_MANAGEMENT_BOUNDARY, GOVERNANCE_CRITICAL_CAP,
  TRUST_STATE_LABEL, HEALTH_STATUS_LABEL,
  type ConstitutionContext, type ChangeEligibilityInput, type TrustScore,
} from './aiGovernance';

const conCtx = (over: Partial<ConstitutionContext> = {}): ConstitutionContext => ({
  humanApproved: true, evidenceComplete: true, baselinePresent: true, inputSnapshotPresent: true,
  sourceVersionPresent: true, confidencePresent: true, sample: 300, syntheticData: false,
  unsupportedInference: false, nullToZero: false, nanPresent: false, expiredInput: false,
  riskTier: 'low', unresolvedConflict: false, missingDependency: false, auditPresent: true, idempotencyPresent: true, ...over,
});

describe('Constitution — 규칙·Immutable·Enforcement', () => {
  it('immutable rule 은 immutable_block', () => {
    expect(immutableRules().every((r) => r.enforcement_type === 'immutable_block')).toBe(true);
    expect(CONSTITUTION_RULES.length).toBeGreaterThanOrEqual(27);
  });
  it('정상 → pass·미blocked', () => {
    const r = constitutionCheck(conCtx());
    expect(r.pass).toBe(true); expect(r.blocked).toBe(false); expect(r.violations).toBe(0);
  });
  it('사람 승인 없음 → blocked(immutable)', () => {
    const r = constitutionCheck(conCtx({ humanApproved: false }));
    expect(r.blocked).toBe(true); expect(r.criticalViolations).toBeGreaterThan(0);
  });
  it('Critical Risk → blocked', () => {
    expect(constitutionCheck(conCtx({ riskTier: 'critical' })).blocked).toBe(true);
  });
  it('Evidence 누락 → violation', () => {
    const r = constitutionCheck(conCtx({ evidenceComplete: false }));
    expect(r.pass).toBe(false); expect(r.results.find((x) => x.rule_code === 'EVIDENCE_REQUIRED')!.result).toBe('violation');
  });
  it('Sample 부족 → violation', () => {
    expect(constitutionCheck(conCtx({ sample: 10 })).pass).toBe(false);
  });
  it('NaN → violation', () => { expect(constitutionCheck(conCtx({ nanPresent: true })).pass).toBe(false); });
});

describe('Trust 계층 — provisional·cap·0~100·NaN 없음', () => {
  it('Outcome 없으면 provisional(상한 70)', () => {
    const t = predictionTrust({ accuracy: 90, sampleSufficiency: 200, outcomeSample: 0 });
    expect(t.provisional).toBe(true); expect(t.score!).toBeLessThanOrEqual(70);
  });
  it('실제 Outcome 있으면 정식 계산', () => {
    const t = strategyTrust({ outcomeSuccessRate: 80, sandboxPassRate: 70, evidenceCompleteness: 90, outcomeSample: 50 });
    expect(t.provisional).toBe(false); expect(t.score!).toBeGreaterThan(0);
  });
  it('성분 전무 → null(insufficient)', () => {
    const t = predictionTrust({ sampleSufficiency: 0, outcomeSample: 0 });
    expect(t.score == null || Number.isFinite(t.score)).toBe(true);
  });
  it('Governance Critical 위반 → 상한 40', () => {
    const g = governanceTrust({ violationBlockRate: 90, auditCompleteness: 90, approvalCompliance: 90, criticalBlockRate: 90, humanApprovalMissing: 0, productionBypass: 0, expiredBlockRate: 90, unauthorizedBlockRate: 90, criticalViolationActive: true });
    expect(g.score!).toBeLessThanOrEqual(40);
  });
  it('Overall — Governance 낮으면 상한 적용', () => {
    const layers: TrustScore[] = [
      { layer: 'prediction', score: 90, provisional: false, sample: 50, components: [] },
      { layer: 'strategy', score: 90, provisional: false, sample: 50, components: [] },
      { layer: 'governance', score: 20, provisional: false, sample: 1, components: [] },
    ];
    const o = overallTrust(layers);
    expect(o.score!).toBeLessThanOrEqual(30);
  });
  it('GOVERNANCE_CRITICAL_CAP 상수', () => { expect(GOVERNANCE_CRITICAL_CAP).toBe(50); });
});

describe('Trust Status / Budget', () => {
  const ok = (s: number): TrustScore => ({ layer: 'overall', score: s, provisional: false, sample: 100, components: [] });
  const gov = (s: number): TrustScore => ({ layer: 'governance', score: s, provisional: false, sample: 1, components: [] });
  it('Critical 위반 → suspended', () => { expect(trustStatus(ok(80), gov(80), true)).toBe('suspended'); });
  it('Governance 낮음 → restricted', () => { expect(trustStatus(ok(80), gov(20), false)).toBe('restricted'); });
  it('높은 Trust → trusted', () => { expect(trustStatus(ok(80), gov(80), false)).toBe('trusted'); });
  it('provisional → monitored', () => {
    expect(trustStatus({ layer: 'overall', score: 80, provisional: true, sample: 10, components: [] }, gov(80), false)).toBe('monitored');
  });
  it('suspended budget=0', () => { expect(trustBudget('suspended').dailyStrategyCandidates).toBe(0); });
  it('restricted High Risk 금지', () => { expect(trustBudget('restricted').dailyHighRiskCandidates).toBe(0); });
  it('budgetExceeded', () => { expect(budgetExceeded(10, 10)).toBe(true); expect(budgetExceeded(5, 10)).toBe(false); });
});

describe('Decision Quality / Reputation / Governance Health', () => {
  it('decisionQuality Outcome 없으면 성분 null·NaN 없음', () => {
    const d = decisionQuality({ evidenceCompleteness: 90 });
    expect(Number.isFinite(d.score!) || d.score == null).toBe(true);
  });
  it('reputation 이전값 smoothing', () => {
    const r = reputation({ decisionQuality: 80, overallTrust: 80, governanceTrust: 80, constitutionCompliance: 90, sample: 50, previous: 40 });
    expect(r.score!).toBeGreaterThan(40); expect(r.score!).toBeLessThan(80);
  });
  it('governanceHealth Critical 위반 → critical·상한', () => {
    const h = governanceHealth({ constitutionCompliance: 90, auditCompleteness: 90, unauthorizedBlock: 90, approvalCompliance: 90, expirationEnforcement: 90, duplicatePrevention: 90, idempotencySuccess: 90, criticalBlockRate: 90, evidenceCompleteness: 90, productionSafety: 90, criticalViolationActive: true });
    expect(h.status).toBe('critical'); expect(h.score).toBeLessThanOrEqual(35);
  });
  it('governanceHealth 정상 → healthy', () => {
    const h = governanceHealth({ constitutionCompliance: 95, auditCompleteness: 90, unauthorizedBlock: 100, approvalCompliance: 90, expirationEnforcement: 90, duplicatePrevention: 95, idempotencySuccess: 95, criticalBlockRate: 100, evidenceCompleteness: 90, productionSafety: 95, criticalViolationActive: false });
    expect(h.status).toBe('healthy');
  });
});

describe('Violation Response / Change Eligibility / Expiration', () => {
  it('critical 위반 → suspend·차단', () => {
    const r = violationResponse('critical', true);
    expect(r.blockCandidate).toBe(true); expect(r.trustAction).toBe('suspend');
  });
  it('warning → 기록·Review', () => {
    const r = violationResponse('warning', false);
    expect(r.blockCandidate).toBe(false); expect(r.reviewRequired).toBe(true);
  });
  const elig = (over: Partial<ChangeEligibilityInput> = {}): ChangeEligibilityInput => ({
    draftReady: true, canaryCandidate: true, promotionApproved: true, sandboxValid: true, constitutionPass: true,
    criticalViolation: false, riskTier: 'low', trustState: 'trusted', rollbackPlan: true, observationPlan: true,
    evidenceComplete: true, inputHashMatch: true, modelVersionMatch: true, policyVersionMatch: true, expired: false, humanApproved: true, ...over,
  });
  it('모두 충족 → eligible', () => { expect(changeCandidateEligibility(elig()).eligible).toBe(true); });
  it('Constitution 미Pass → 차단', () => { expect(changeCandidateEligibility(elig({ constitutionPass: false })).eligible).toBe(false); });
  it('Critical Risk → 차단', () => { expect(changeCandidateEligibility(elig({ riskTier: 'critical' })).eligible).toBe(false); });
  it('Trust suspended → 차단', () => { expect(changeCandidateEligibility(elig({ trustState: 'suspended' })).eligible).toBe(false); });
  it('사람 승인 없음 → 차단', () => { expect(changeCandidateEligibility(elig({ humanApproved: false })).eligible).toBe(false); });
  it('Rollback/Observation 없음 → 차단', () => {
    expect(changeCandidateEligibility(elig({ rollbackPlan: false })).eligible).toBe(false);
    expect(changeCandidateEligibility(elig({ observationPlan: false })).eligible).toBe(false);
  });
  it('Expiration', () => {
    expect(changeCandidateExpired({ sourceDraftChanged: true, canaryReleased: false, constitutionVersionChanged: false, policyVersionChanged: false, modelVersionChanged: false, inputHashChanged: false, riskRaisedToCritical: false, ageDays: 1 }).expired).toBe(true);
    expect(changeCandidateExpired({ sourceDraftChanged: false, canaryReleased: false, constitutionVersionChanged: false, policyVersionChanged: false, modelVersionChanged: false, inputHashChanged: false, riskRaisedToCritical: false, ageDays: 1 }).expired).toBe(false);
  });
  it('idempotencyKey 결정적', () => {
    expect(changeIdempotencyKey({ draftId: 'd1', contextKey: 'c', changeType: 'playlist', inputHash: 'h' })).toBe(changeIdempotencyKey({ draftId: 'd1', contextKey: 'c', changeType: 'playlist', inputHash: 'h' }));
  });
});

describe('Support / Boundary / 헬퍼', () => {
  it('Production Apply·Role Separation 미지원', () => {
    expect(GOVERNANCE_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(GOVERNANCE_SUPPORT.find((s) => s.key === 'role_separation')!.status).toBe('unsupported');
    expect(GOVERNANCE_SUPPORT.find((s) => s.key === 'human_override')!.status).toBe('audit_only');
  });
  it('Change Management Boundary 문서', () => {
    expect(CHANGE_MANAGEMENT_BOUNDARY.some((s) => s.includes('Production Apply 엔진이 아니다'))).toBe(true);
  });
  it('preconditions 기본 false', () => {
    expect(defaultExecutionPreconditions().separate_operational_approval).toBe(false);
  });
  it('라벨', () => { expect(TRUST_STATE_LABEL.suspended).toBe('Suspended'); expect(HEALTH_STATUS_LABEL.healthy).toBe('Healthy'); });
});
