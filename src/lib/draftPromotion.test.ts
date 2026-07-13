// Phase AI-MUSIC-7 — Draft Promotion Gateway 순수 로직 단위 테스트.
// Eligibility · Mapping · Draft Conversion · Draft Validation · Risk Tier · Approval Policy ·
// Canary/Approval Readiness · Go/NoGo · Rollback/Observation · Duplicate/Idempotency · Expiration ·
// Self-approval · Comparison · Support · Sample gate · 0~100 clamp · NaN 금지.
import { describe, it, expect } from 'vitest';
import {
  promotionEligibility, draftTypesFor, strategySupportsDraft, convertToDraft, draftValidation,
  computeRiskTier, approvalPolicy, canaryReadiness, approvalReadiness, goNoGo,
  defaultRollbackPlan, defaultObservationPlan, planComplete, isDuplicatePromotion, idempotencyKey,
  promotionExpired, selfApprovalAllowed, compareDrafts, CANARY_SCOPE_SUPPORT, SEPARATION_OF_DUTIES,
  APPROVAL_REASONS, REJECTION_REASONS, DRAFT_TYPE_LABEL, RISK_TIER_LABEL, promotionAllowed,
  type SandboxRunLite, type DraftValidationInput, type DraftSourceRefs,
  type StrategySnapshot, type DraftCompareInput,
} from './draftPromotion';

const run = (over: Partial<SandboxRunLite> = {}): SandboxRunLite => ({
  sandbox_run_id: 'r1', strategy_id: 'genre_ratio:x', context_key: 'store_type=cafe',
  run_status: 'passed', review_status: 'approval_candidate', decision: 'go', hard_constraint_pass: true,
  sample_size: 300, confidence: 70, safety_score: 75, benefit_score: 40, roi_score: 55, risk_score: 30, cost_score: 40,
  input_hash: 'h1', model_version: 'sandbox-1.0', expired_at: null, evidenceComplete: true, ...over,
});
const refs: DraftSourceRefs = { sandbox_run_id: 'r1', strategy_id: 's1', source_input_hash: 'h1', source_model_version: 'sandbox-1.0' };
const strat = (type: StrategySnapshot['type'], target: string | null = 'X'): StrategySnapshot => ({ type, target, roi: 55, expected: { completion: 4, skip: -3, listening: 5, health: 2 } });

describe('promotionEligibility', () => {
  it('적격 Sandbox + 매핑 → eligible', () => {
    const r = promotionEligibility(run(), 'genre_ratio', 'playlist');
    expect(r.eligible).toBe(true); expect(r.blockers.length).toBe(0);
  });
  it('Expired → 차단', () => { expect(promotionEligibility(run({ expired_at: '2026-07-01' }), 'genre_ratio', 'playlist').eligible).toBe(false); });
  it('review_status 아님 → 차단', () => { expect(promotionEligibility(run({ review_status: 'not_reviewed' }), 'genre_ratio', 'playlist').eligible).toBe(false); });
  it('Hard Fail → 차단', () => { expect(promotionEligibility(run({ hard_constraint_pass: false }), 'genre_ratio', 'playlist').eligible).toBe(false); });
  it('Rejected decision → 차단', () => { expect(promotionEligibility(run({ decision: 'reject' }), 'genre_ratio', 'playlist').eligible).toBe(false); });
  it('Sample 부족 → 차단', () => { expect(promotionEligibility(run({ sample_size: 10 }), 'genre_ratio', 'playlist').eligible).toBe(false); });
  it('미지원 매핑 → 차단', () => { expect(promotionEligibility(run(), 'rotation_interval', 'playlist').eligible).toBe(false); });
});

describe('Strategy → Draft Mapping', () => {
  it('genre_ratio → playlist/experiment', () => { expect(draftTypesFor('genre_ratio')).toEqual(['playlist', 'experiment']); });
  it('rotation_interval → rotation only', () => { expect(draftTypesFor('rotation_interval')).toEqual(['rotation']); });
  it('test_pool_expand → rollout', () => { expect(strategySupportsDraft('test_pool_expand', 'rollout')).toBe(true); expect(strategySupportsDraft('test_pool_expand', 'playlist')).toBe(false); });
});

describe('convertToDraft — 지원 매핑만·억지 변환 없음', () => {
  it('track_promotion → Playlist Draft(add)', () => {
    const d = convertToDraft({ draftType: 'playlist', strategy: strat('track_promotion', 'SongA'), contextKey: 'c', refs, genreMixBefore: [], genreMixAfter: [], confidence: 70, sample: 300 });
    expect(d?.draft_type).toBe('playlist');
    expect((d as { added_track_ids: string[] }).added_track_ids).toContain('SongA');
  });
  it('rotation_interval → Rotation Draft', () => {
    const d = convertToDraft({ draftType: 'rotation', strategy: strat('rotation_interval', null), contextKey: 'c', refs, genreMixBefore: [], genreMixAfter: [], confidence: 70, sample: 300, currentInterval: 10 });
    expect(d?.draft_type).toBe('rotation'); expect((d as { proposed_interval: number }).proposed_interval).toBe(9);
  });
  it('test_pool_expand → Rollout Draft(승격 Stage)', () => {
    const d = convertToDraft({ draftType: 'rollout', strategy: strat('test_pool_expand', 't1'), contextKey: 'c', refs, genreMixBefore: [], genreMixAfter: [], confidence: 70, sample: 100, currentStage: 'pilot' });
    expect((d as { proposed_stage: string }).proposed_stage).toBe('limited');
  });
  it('experiment → status running 생성 없음(draft/review/ready)', () => {
    const d = convertToDraft({ draftType: 'experiment', strategy: strat('playlist_refresh', null), contextKey: 'c', refs, genreMixBefore: [], genreMixAfter: [], confidence: 70, sample: 300 });
    expect(['draft', 'review_required', 'ready']).toContain((d as { status: string }).status);
  });
  it('미지원 조합 → null', () => {
    expect(convertToDraft({ draftType: 'rollout', strategy: strat('genre_ratio', null), contextKey: 'c', refs, genreMixBefore: [], genreMixAfter: [], confidence: 70, sample: 300 })).toBeNull();
  });
});

describe('draftValidation', () => {
  const base = (over: Partial<DraftValidationInput> = {}): DraftValidationInput => ({
    draftType: 'playlist', hasContent: true, sourceLinked: true, inputHashMatch: true, modelVersionMatch: true,
    candidateTracksPresent: true, trackStatusValid: true, playlistCapacityOk: true, genreGuardrailPass: true, moodGuardrailPass: true,
    rolloutStageOk: null, rotationIntervalOk: null, metadataCoverage: 90, sample: 300, confidence: 70,
    hardConstraintPass: true, regressionSafe: true, duplicateTrack: false, duplicateDraft: false, evidenceComplete: true, ...over,
  });
  it('정상 → ready', () => { expect(draftValidation(base()).status).toBe('ready'); });
  it('Hard Fail → rejected', () => { expect(draftValidation(base({ hardConstraintPass: false })).status).toBe('rejected'); });
  it('중복 Track → rejected', () => { expect(draftValidation(base({ duplicateTrack: true })).status).toBe('rejected'); });
  it('Regression 위험 → review_required', () => { expect(draftValidation(base({ regressionSafe: false })).status).toBe('review_required'); });
  it('미지원 항목 unsupported', () => {
    const v = draftValidation(base({ rolloutStageOk: null }));
    expect(v.checks.find((c) => c.code === 'rollout_stage')!.result).toBe('unsupported');
  });
});

describe('Risk Tier / Approval Policy', () => {
  it('낮은 위험 → low·승인 가능', () => {
    const t = computeRiskTier({ strategyRisk: 10, sandboxRisk: 10, driftScore: 5, diffSize: 1, predictionUncertainty: 10 });
    expect(t.tier).toBe('low'); expect(approvalPolicy('low').approvable).toBe(true);
  });
  it('높은 위험 → high/critical', () => {
    const t = computeRiskTier({ strategyRisk: 95, sandboxRisk: 90, driftScore: 90, diffSize: 20, predictionUncertainty: 90, historicalFailure: 90 });
    expect(['high', 'critical']).toContain(t.tier);
  });
  it('critical 승인 불가', () => { expect(approvalPolicy('critical').approvable).toBe(false); });
  it('high 추가 승인 필요', () => { expect(approvalPolicy('high').additionalApprovalRequired).toBe(true); });
});

describe('Readiness / Go-NoGo', () => {
  it('canaryReadiness 0~100', () => {
    const s = canaryReadiness({ sandboxSafety: 80, sandboxBenefit: 50, confidence: 70, sample: 300, draftValidationReady: true, policyCompliant: true, rollbackReady: true, observationReady: true });
    expect(s).toBeGreaterThan(60); expect(s).toBeLessThanOrEqual(100);
  });
  it('approvalReadiness 0~100·NaN 없음', () => {
    const s = approvalReadiness({ eligible: true, sandboxDecision: 'go', safety: 80, benefit: 40, confidence: 70, evidenceComplete: true, draftCompatible: true, policyCompliant: true, riskTier: 'low', rollbackReady: true });
    expect(Number.isFinite(s)).toBe(true); expect(s).toBeGreaterThan(0);
  });
  it('goNoGo: 모두 충족 → go_candidate', () => {
    expect(goNoGo({ draftReady: true, hardPass: true, canaryReadiness: 75, riskTier: 'low', rollbackReady: true, observationReady: true, approved: true, evidenceComplete: true, expired: false, inputHashMatch: true, policyVersionMatch: true }).decision).toBe('go_candidate');
  });
  it('goNoGo: critical/미승인 → no_go', () => {
    const r = goNoGo({ draftReady: true, hardPass: true, canaryReadiness: 75, riskTier: 'critical', rollbackReady: false, observationReady: true, approved: false, evidenceComplete: true, expired: false, inputHashMatch: true, policyVersionMatch: true });
    expect(r.decision).toBe('no_go'); expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('Rollback / Observation Plan', () => {
  it('기본 Plan 완전', () => { expect(planComplete(defaultRollbackPlan('c'), defaultObservationPlan())).toBe(true); });
  it('Plan 없음 → 미완전', () => { expect(planComplete(null, defaultObservationPlan())).toBe(false); });
});

describe('Duplicate / Idempotency / Expiration / Self-approval', () => {
  it('중복 Promotion 탐지', () => {
    const existing = [{ sandbox_run_id: 'r1', strategy_id: 's1', requested_draft_type: 'playlist', request_status: 'pending_review' }];
    expect(isDuplicatePromotion(existing, { sandbox_run_id: 'r1', strategy_id: 's1', requested_draft_type: 'playlist' })).toBe(true);
    expect(isDuplicatePromotion(existing, { sandbox_run_id: 'r1', strategy_id: 's1', requested_draft_type: 'rotation' })).toBe(false);
  });
  it('idempotencyKey 결정적', () => {
    const a = idempotencyKey({ sandboxRunId: 'r1', strategyId: 's1', draftType: 'playlist', inputHash: 'h1' });
    const b = idempotencyKey({ sandboxRunId: 'r1', strategyId: 's1', draftType: 'playlist', inputHash: 'h1' });
    expect(a).toBe(b);
  });
  it('promotionExpired', () => {
    expect(promotionExpired({ sandboxExpired: true, inputHashMatch: true, modelVersionMatch: true, policyVersionMatch: true, ageDays: 1 }).expired).toBe(true);
    expect(promotionExpired({ sandboxExpired: false, inputHashMatch: false, modelVersionMatch: true, policyVersionMatch: true, ageDays: 1 }).expired).toBe(true);
    expect(promotionExpired({ sandboxExpired: false, inputHashMatch: true, modelVersionMatch: true, policyVersionMatch: true, ageDays: 1 }).expired).toBe(false);
  });
  it('고위험 자기승인 차단, low 허용', () => {
    expect(selfApprovalAllowed('high', 'u1', 'u1')).toBe(false);
    expect(selfApprovalAllowed('high', 'u1', 'u2')).toBe(true);
    expect(selfApprovalAllowed('low', 'u1', 'u1')).toBe(true);
  });
});

describe('Comparison / Support / 게이트', () => {
  it('compareDrafts Winner 단정 없음·항목별', () => {
    const drafts: DraftCompareInput[] = [
      { id: 'a', label: 'A', draft_type: 'playlist', expected_gain: 4, risk: 30, cost: 40, roi: 55, canary_readiness: 70, approval_readiness: 80, changed_track_count: 1 },
      { id: 'b', label: 'B', draft_type: 'experiment', expected_gain: 6, risk: 40, cost: 30, roi: 50, canary_readiness: 60, approval_readiness: 75, changed_track_count: 0 },
    ];
    const c = compareDrafts(drafts);
    expect(c.rows.find((r) => r.metric === 'Expected Gain')!.note).toContain('B');
  });
  it('Brand/Store Canary 미지원', () => {
    expect(CANARY_SCOPE_SUPPORT.find((s) => s.key === 'brand')!.supported).toBe(false);
    expect(CANARY_SCOPE_SUPPORT.find((s) => s.key === 'context')!.supported).toBe(true);
  });
  it('Separation of Duties 미지원 명시', () => { expect(SEPARATION_OF_DUTIES.supported).toBe(false); });
  it('Reason 목록·라벨', () => {
    expect(APPROVAL_REASONS).toContain('low_risk'); expect(REJECTION_REASONS).toContain('stale_sandbox');
    expect(DRAFT_TYPE_LABEL.playlist).toBe('Playlist Draft'); expect(RISK_TIER_LABEL.critical).toBe('Critical');
  });
  it('promotionAllowed 표본 gate', () => { expect(promotionAllowed(10)).toBe(false); expect(promotionAllowed(20)).toBe(true); });
});
