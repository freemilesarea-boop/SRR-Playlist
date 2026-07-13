/**
 * draftPromotion — Human-Governed Draft Promotion & Controlled Execution Gateway 순수 로직
 * (Phase AI-MUSIC-7).
 *
 * AI-MUSIC-6 Sandbox 에서 검증된 Strategy 를 **운영자 승인 후에만** 독립 Draft(Playlist/Rotation/
 * Rollout/Experiment)로 변환하고, Draft 를 재검증하여 Canary Candidate 지정까지만 수행한다.
 * 실제 Production 실행 없음 · 자동 Draft/Canary/승인/Publish 없음.
 *
 *   Sandbox Approval Candidate → Human Review → Promotion Request → Draft Conversion
 *   → Draft Validation → Canary Candidate → 운영자 승인 대기
 *
 * 원칙:
 *  - Production Entity 무변경(독립 Draft Entity). 지원되지 않는 Strategy/Draft 강제 변환 금지.
 *  - Sandbox go 만으로/Approval Candidate 만으로 Draft 생성 금지 — 운영자 명시 Promotion 승인 필수.
 *  - Expired/Rejected Sandbox·Hard Constraint Fail·Evidence 없음 승격 금지.
 *  - 점수 0~100 clamp · NaN 금지 · 미지원 값 null 유지 · Critical Risk 승인/Candidate 금지.
 */
import { MIN_EVENTS } from './playlistIntel';
import type { StrategyType } from './optimizationStrategy';
import { STRATEGY_LABEL } from './optimizationStrategy';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export const PROMOTION_MODEL_VERSION = 'promotion-1.0';
export interface EvidenceItem { label: string; value: string | number | boolean | null }

/* ── 5) Strategy → Draft Mapping ────────────────────────────────────────── */
export type DraftType = 'playlist' | 'rotation' | 'rollout' | 'experiment';
export const DRAFT_TYPE_LABEL: Record<DraftType, string> = { playlist: 'Playlist Draft', rotation: 'Rotation Draft', rollout: 'Rollout Draft', experiment: 'Experiment Draft' };

/** 각 Strategy 가 변환 가능한 Draft 유형(실제 지원 매핑). 여러 개면 운영자가 선택. */
export const STRATEGY_DRAFT_MAP: Record<StrategyType, DraftType[]> = {
  playlist_refresh: ['playlist', 'experiment'],
  track_replacement: ['playlist', 'experiment'],
  track_promotion: ['playlist'],
  track_demotion: ['playlist'],
  genre_ratio: ['playlist', 'experiment'],
  mood_ratio: ['playlist', 'experiment'],
  rotation_interval: ['rotation'],
  rediscovery: ['playlist', 'rotation'],
  test_pool_expand: ['rollout'],
  test_pool_reduce: ['rollout'],
};
export function draftTypesFor(type: StrategyType): DraftType[] { return STRATEGY_DRAFT_MAP[type] ?? []; }
export function strategySupportsDraft(type: StrategyType, draft: DraftType): boolean { return draftTypesFor(type).includes(draft); }

/* ── Sandbox Run 요약(Eligibility 입력) ─────────────────────────────────── */
export interface SandboxRunLite {
  sandbox_run_id: string; strategy_id: string | null; context_key: string;
  run_status: string; review_status: string; decision: string | null;
  hard_constraint_pass: boolean | null; sample_size: number | null; confidence: number | null;
  safety_score: number | null; benefit_score: number | null; roi_score: number | null; risk_score: number | null; cost_score: number | null;
  input_hash: string | null; model_version: string | null; expired_at: string | null;
  evidenceComplete?: boolean;
}

/* ── 2/11) Promotion Eligibility ────────────────────────────────────────── */
export type CheckResult = 'pass' | 'warning' | 'fail' | 'unsupported' | 'insufficient_data';
export interface EligibilityCheck { code: string; label: string; result: CheckResult; detail: string }
export interface EligibilityResult { eligible: boolean; checks: EligibilityCheck[]; blockers: string[] }

/** Sandbox Run + 목표 Draft Type 으로 승격 후보 자격 검증. 하나라도 fail 이면 승격 불가. */
export function promotionEligibility(run: SandboxRunLite, strategyType: StrategyType | null, draftType: DraftType | null): EligibilityResult {
  const checks: EligibilityCheck[] = [];
  const add = (code: string, label: string, ok: boolean, detail: string, soft = false) =>
    checks.push({ code, label, result: ok ? 'pass' : soft ? 'warning' : 'fail', detail });

  add('run_status', 'run_status', ['passed', 'review_required'].includes(run.run_status), `run_status=${run.run_status}`);
  add('review_status', 'approval_candidate', run.review_status === 'approval_candidate', `review_status=${run.review_status}`);
  add('not_expired', '미Expired', !run.expired_at, run.expired_at ? 'Expired Sandbox' : 'ok');
  add('not_rejected', 'Rejected 아님', run.decision !== 'reject', `decision=${run.decision}`);
  add('hard_pass', 'Hard Constraint Pass', run.hard_constraint_pass === true, `hard_pass=${run.hard_constraint_pass}`);
  add('sample', 'Sample 충족', isNum(run.sample_size) && run.sample_size >= MIN_EVENTS, `sample=${run.sample_size}`);
  add('evidence', 'Evidence 완전', run.evidenceComplete !== false, run.evidenceComplete === false ? 'Evidence 불완전' : 'ok');
  if (strategyType && draftType) add('mapping', 'Strategy→Draft 매핑', strategySupportsDraft(strategyType, draftType), `${strategyType}→${draftType}`);
  else checks.push({ code: 'mapping', label: 'Strategy→Draft 매핑', result: 'insufficient_data', detail: 'Draft Type 미선택' });

  const blockers = checks.filter((c) => c.result === 'fail').map((c) => c.label);
  const eligible = blockers.length === 0 && checks.some((c) => c.code === 'mapping' && c.result === 'pass');
  return { eligible, checks, blockers };
}

/* ── 17) Risk Tier ──────────────────────────────────────────────────────── */
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export interface RiskTierInput { strategyRisk: number; sandboxRisk: number; driftScore?: number | null; diffSize: number; predictionUncertainty: number; historicalFailure?: number | null; rollbackComplexity?: number | null }
/** 구성 요소 가중 평균 → tier. 실제 값만 사용. */
export function computeRiskTier(inp: RiskTierInput): { tier: RiskTier; score: number } {
  const comps = [
    { v: clamp100(inp.strategyRisk), w: 0.3 },
    { v: clamp100(inp.sandboxRisk), w: 0.2 },
    { v: clamp100(isNum(inp.driftScore) ? inp.driftScore : 30), w: 0.1 },
    { v: clamp100(clamp01(inp.diffSize / 10) * 100), w: 0.15 },
    { v: clamp100(inp.predictionUncertainty), w: 0.15 },
    { v: clamp100(isNum(inp.historicalFailure) ? inp.historicalFailure : 25), w: 0.1 },
  ];
  const score = clamp100(comps.reduce((a, c) => a + c.v * c.w, 0));
  const tier: RiskTier = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
  return { tier, score };
}

/* ── 18) Approval Policy ────────────────────────────────────────────────── */
export interface ApprovalPolicy { tier: RiskTier; minApprovers: number; additionalApprovalRequired: boolean; rollbackRequired: boolean; approvable: boolean; note: string }
export function approvalPolicy(tier: RiskTier): ApprovalPolicy {
  switch (tier) {
    case 'low': return { tier, minApprovers: 1, additionalApprovalRequired: false, rollbackRequired: false, approvable: true, note: '관리자 1인 승인' };
    case 'medium': return { tier, minApprovers: 1, additionalApprovalRequired: false, rollbackRequired: true, approvable: true, note: '관리자 Review + 승인' };
    case 'high': return { tier, minApprovers: 2, additionalApprovalRequired: true, rollbackRequired: true, approvable: true, note: '2단계 승인 권장 · 자기승인 제한 · Rollback 필수' };
    case 'critical': return { tier, minApprovers: 2, additionalApprovalRequired: true, rollbackRequired: true, approvable: false, note: 'Critical — 이번 Phase 승인 불가' };
  }
}

/* ── 6~10) Draft Conversion(Sandbox Snapshot 기준 · Production 무변경) ────── */
export interface DraftSourceRefs { sandbox_run_id: string; strategy_id: string | null; source_input_hash: string | null; source_model_version: string | null }
export interface StrategySnapshot {
  type: StrategyType; target: string | null; roi: number;
  expected: { completion: number; skip: number; listening: number; health: number };
}
export interface PlaylistDraftPayload {
  draft_type: 'playlist'; source_playlist_id: string | null; added_track_ids: string[]; removed_track_ids: string[];
  replaced_tracks: Array<{ out: string; in: string }>; before_genre_mix: Array<{ key: string; share: number }>; after_genre_mix: Array<{ key: string; share: number }>;
  expected_delta: { completion: number; skip: number; health: number }; confidence: number; roi: number; refs: DraftSourceRefs;
}
export interface RotationDraftPayload { draft_type: 'rotation'; context_key: string; current_interval: number | null; proposed_interval: number | null; expected_repeat_delta: number | null; expected_unique_track_ratio: number | null; confidence: number; refs: DraftSourceRefs }
export interface RolloutDraftPayload { draft_type: 'rollout'; track_id: string | null; current_stage: string | null; proposed_stage: string | null; target_context: string; current_sample: number; expected_sample: number | null; risk: number; confidence: number; refs: DraftSourceRefs }
export interface ExperimentDraftPayload { draft_type: 'experiment'; experiment_type: string; target_context: string; primary_metric: string; guardrail_metrics: string[]; minimum_sample: number; expected_gain: number; confidence: number; stop_conditions: string[]; rollback_conditions: string[]; status: 'draft' | 'review_required' | 'ready'; refs: DraftSourceRefs }
export type DraftPayload = PlaylistDraftPayload | RotationDraftPayload | RolloutDraftPayload | ExperimentDraftPayload;

export interface ConvertInput {
  draftType: DraftType; strategy: StrategySnapshot; contextKey: string; refs: DraftSourceRefs;
  genreMixBefore: Array<{ key: string; share: number }>; genreMixAfter: Array<{ key: string; share: number }>;
  confidence: number; sample: number; currentStage?: string | null; currentInterval?: number | null;
}
/** 지원 매핑에 한해 Draft payload 생성. 미지원 조합이면 null(억지 변환 금지). */
export function convertToDraft(inp: ConvertInput): DraftPayload | null {
  if (!strategySupportsDraft(inp.strategy.type, inp.draftType)) return null;
  const s = inp.strategy; const conf = clamp100(inp.confidence);
  if (inp.draftType === 'playlist') {
    const add = s.type === 'track_promotion' && s.target ? [s.target] : [];
    const remove = s.type === 'track_demotion' && s.target ? [s.target] : [];
    const replace = s.type === 'track_replacement' && s.target?.includes('↔') ? [{ out: s.target.split('↔')[0], in: s.target.split('↔')[1] }] : [];
    return { draft_type: 'playlist', source_playlist_id: s.target && !add.length && !remove.length ? s.target : null, added_track_ids: add, removed_track_ids: remove, replaced_tracks: replace, before_genre_mix: inp.genreMixBefore, after_genre_mix: inp.genreMixAfter, expected_delta: { completion: s.expected.completion, skip: s.expected.skip, health: s.expected.health }, confidence: conf, roi: clamp100(s.roi), refs: inp.refs };
  }
  if (inp.draftType === 'rotation') {
    const proposed = isNum(inp.currentInterval) ? Math.max(3, inp.currentInterval + (s.type === 'rediscovery' ? 2 : -1)) : null;
    return { draft_type: 'rotation', context_key: inp.contextKey, current_interval: inp.currentInterval ?? null, proposed_interval: proposed, expected_repeat_delta: isNum(proposed) && isNum(inp.currentInterval) ? proposed - inp.currentInterval : null, expected_unique_track_ratio: isNum(proposed) ? clamp01(proposed / 20) : null, confidence: conf, refs: inp.refs };
  }
  if (inp.draftType === 'rollout') {
    const order = ['draft', 'test_pool', 'pilot', 'limited', 'expanded', 'global', 'archived'];
    const idx = inp.currentStage ? order.indexOf(inp.currentStage) : -1;
    const proposed = s.type === 'test_pool_expand' ? order[Math.min(order.length - 2, idx + 1)] ?? null : order[Math.max(0, idx - 1)] ?? null;
    return { draft_type: 'rollout', track_id: s.target, current_stage: inp.currentStage ?? null, proposed_stage: proposed, target_context: inp.contextKey, current_sample: inp.sample, expected_sample: s.type === 'test_pool_expand' ? Math.round(inp.sample * 0.3) : null, risk: clamp100(100 - conf), confidence: conf, refs: inp.refs };
  }
  // experiment
  return { draft_type: 'experiment', experiment_type: s.type, target_context: inp.contextKey, primary_metric: 'completion_rate', guardrail_metrics: ['skip_rate'], minimum_sample: MIN_EVENTS, expected_gain: s.expected.completion, confidence: conf, stop_conditions: ['guardrail_breach', 'sample_reached'], rollback_conditions: ['completion_regression', 'skip_spike'], status: conf >= 50 ? 'ready' : 'review_required', refs: inp.refs };
}

/* ── 12) Draft Validation ───────────────────────────────────────────────── */
export interface DraftValidationInput {
  draftType: DraftType; hasContent: boolean; sourceLinked: boolean; inputHashMatch: boolean; modelVersionMatch: boolean;
  candidateTracksPresent: boolean; trackStatusValid: boolean; playlistCapacityOk?: boolean | null; genreGuardrailPass: boolean; moodGuardrailPass: boolean;
  rolloutStageOk?: boolean | null; rotationIntervalOk?: boolean | null; metadataCoverage: number; sample: number; confidence: number;
  hardConstraintPass: boolean; regressionSafe: boolean; duplicateTrack: boolean; duplicateDraft: boolean; evidenceComplete: boolean;
}
export interface DraftValidationCheck { code: string; label: string; result: CheckResult }
export interface DraftValidationResult { status: 'ready' | 'review_required' | 'rejected'; checks: DraftValidationCheck[]; hardPass: boolean }

export function draftValidation(inp: DraftValidationInput): DraftValidationResult {
  const checks: DraftValidationCheck[] = [];
  const add = (code: string, label: string, r: CheckResult) => checks.push({ code, label, result: r });
  const boolR = (b: boolean | null | undefined, soft = false): CheckResult => b == null ? 'unsupported' : b ? 'pass' : soft ? 'warning' : 'fail';

  add('content', 'Draft 내용', boolR(inp.hasContent));
  add('source', 'Source 연결', boolR(inp.sourceLinked));
  add('input_hash', 'Input Hash 일치', boolR(inp.inputHashMatch));
  add('model_version', 'Model Version 일치', boolR(inp.modelVersionMatch, true));
  add('candidate_track', 'Candidate Track', boolR(inp.candidateTracksPresent));
  add('track_status', 'Track 상태 유효', boolR(inp.trackStatusValid));
  add('capacity', 'Playlist Capacity', boolR(inp.playlistCapacityOk));
  add('genre_guardrail', 'Genre Guardrail', boolR(inp.genreGuardrailPass));
  add('mood_guardrail', 'Mood Guardrail', boolR(inp.moodGuardrailPass));
  add('rollout_stage', 'Rollout Stage', boolR(inp.rolloutStageOk));
  add('rotation_interval', 'Rotation Interval', boolR(inp.rotationIntervalOk));
  add('metadata', 'Metadata Coverage', inp.metadataCoverage >= 70 ? 'pass' : inp.metadataCoverage >= 40 ? 'warning' : 'fail');
  add('sample', 'Sample 충족', inp.sample >= MIN_EVENTS ? 'pass' : 'fail');
  add('confidence', 'Confidence', inp.confidence >= 40 ? 'pass' : 'warning');
  add('hard_constraint', 'Hard Constraint', inp.hardConstraintPass ? 'pass' : 'fail');
  add('regression', 'Regression', inp.regressionSafe ? 'pass' : 'warning');
  add('dup_track', '중복 Track 없음', inp.duplicateTrack ? 'fail' : 'pass');
  add('dup_draft', '중복 Draft 없음', inp.duplicateDraft ? 'fail' : 'pass');
  add('evidence', 'Evidence Chain', inp.evidenceComplete ? 'pass' : 'fail');

  const hardFail = checks.some((c) => c.result === 'fail');
  const warn = checks.some((c) => c.result === 'warning');
  const status: DraftValidationResult['status'] = hardFail ? 'rejected' : warn ? 'review_required' : 'ready';
  return { status, checks, hardPass: inp.hardConstraintPass && !hardFail };
}

/* ── 16) Canary Readiness / 28) Approval Readiness ──────────────────────── */
export interface ReadinessInput {
  sandboxSafety: number; sandboxBenefit: number; confidence: number; sample: number; draftValidationReady: boolean;
  policyCompliant: boolean; rollbackReady: boolean; observationReady: boolean; historicalSuccess?: number | null;
}
export function canaryReadiness(inp: ReadinessInput): number {
  const comps = [
    { v: clamp100(inp.sandboxSafety), w: 0.2, present: isNum(inp.sandboxSafety) },
    { v: clamp100(inp.sandboxBenefit), w: 0.12, present: isNum(inp.sandboxBenefit) },
    { v: clamp100(inp.confidence), w: 0.15, present: isNum(inp.confidence) },
    { v: clamp100(clamp01(inp.sample / 200) * 100), w: 0.13, present: true },
    { v: inp.draftValidationReady ? 100 : 0, w: 0.15, present: true },
    { v: inp.policyCompliant ? 100 : 0, w: 0.1, present: true },
    { v: inp.rollbackReady ? 100 : 0, w: 0.08, present: true },
    { v: inp.observationReady ? 100 : 0, w: 0.05, present: true },
    { v: clamp100(inp.historicalSuccess ?? 60), w: 0.02, present: isNum(inp.historicalSuccess) },
  ];
  const present = comps.filter((c) => c.present);
  const wsum = present.reduce((a, c) => a + c.w, 0);
  return wsum > 0 ? clamp100(present.reduce((a, c) => a + c.v * c.w, 0) / wsum) : 0;
}
export interface ApprovalReadinessInput { eligible: boolean; sandboxDecision: string | null; safety: number; benefit: number; confidence: number; evidenceComplete: boolean; draftCompatible: boolean; policyCompliant: boolean; riskTier: RiskTier; rollbackReady: boolean }
export function approvalReadiness(inp: ApprovalReadinessInput): number {
  const riskScore = inp.riskTier === 'low' ? 100 : inp.riskTier === 'medium' ? 70 : inp.riskTier === 'high' ? 40 : 10;
  const comps = [
    { v: inp.eligible ? 100 : 0, w: 0.2 },
    { v: inp.sandboxDecision === 'go' ? 100 : inp.sandboxDecision === 'review_required' ? 60 : 0, w: 0.12 },
    { v: clamp100(inp.safety), w: 0.12 }, { v: clamp100(inp.benefit), w: 0.1 }, { v: clamp100(inp.confidence), w: 0.1 },
    { v: inp.evidenceComplete ? 100 : 0, w: 0.1 }, { v: inp.draftCompatible ? 100 : 0, w: 0.08 },
    { v: inp.policyCompliant ? 100 : 0, w: 0.08 }, { v: riskScore, w: 0.06 }, { v: inp.rollbackReady ? 100 : 0, w: 0.04 },
  ];
  return clamp100(comps.reduce((a, c) => a + c.v * c.w, 0));
}

/* ── 15) Canary Scope ───────────────────────────────────────────────────── */
export interface ScopeSupport { key: string; label: string; supported: boolean; note: string }
export const CANARY_SCOPE_SUPPORT: ScopeSupport[] = [
  { key: 'context', label: '단일 Context', supported: true, note: 'store_type+daypart+weekday' },
  { key: 'store_type', label: '단일 Store Type', supported: true, note: 'store_type_slug' },
  { key: 'playlist', label: '단일 Playlist', supported: true, note: 'playlist_id' },
  { key: 'track', label: '단일 Track', supported: true, note: 'track_id' },
  { key: 'test_pool', label: '제한된 Test Pool', supported: true, note: 'rollout stage' },
  { key: 'daypart', label: '제한된 Daypart', supported: true, note: 'created_at 시간대' },
  { key: 'brand', label: 'Brand Canary', supported: false, note: '재생-브랜드 연결 없음(business_id NULL)' },
  { key: 'store', label: 'Individual Store Canary', supported: false, note: 'store_id 없음' },
];

/* ── 19/20) Rollback / Observation Plan ─────────────────────────────────── */
export interface RollbackPlan { rollback_type: string; rollback_trigger: string; baseline_reference: string; expected_recovery: string; rollback_owner: string; rollback_window: string; rollback_status: string }
export function defaultRollbackPlan(contextKey: string): RollbackPlan {
  return { rollback_type: 'draft_revert', rollback_trigger: 'guardrail_breach_or_regression', baseline_reference: contextKey, expected_recovery: 'immediate(draft 미적용이므로 원복 불필요)', rollback_owner: 'admin', rollback_window: '즉시', rollback_status: 'planned' };
}
export interface ObservationPlan { observation_period: string; primary_metric: string; guardrail_metrics: string[]; minimum_sample: number; success_threshold: number; warning_threshold: number; failure_threshold: number; review_interval: string; owner: string }
export function defaultObservationPlan(): ObservationPlan {
  return { observation_period: '14d', primary_metric: 'completion_rate', guardrail_metrics: ['skip_rate'], minimum_sample: MIN_EVENTS, success_threshold: 3, warning_threshold: 0, failure_threshold: -2, review_interval: '3d', owner: 'admin' };
}
export function planComplete(rb: RollbackPlan | null, ob: ObservationPlan | null): boolean {
  return !!rb && !!rb.rollback_type && !!ob && !!ob.primary_metric && isNum(ob.minimum_sample);
}

/* ── 21) Go / No-Go Criteria ────────────────────────────────────────────── */
export interface GoNoGoInput { draftReady: boolean; hardPass: boolean; canaryReadiness: number; riskTier: RiskTier; rollbackReady: boolean; observationReady: boolean; approved: boolean; evidenceComplete: boolean; expired: boolean; inputHashMatch: boolean; policyVersionMatch: boolean; readinessThreshold?: number }
export interface GoNoGoResult { decision: 'go_candidate' | 'no_go'; reasons: string[] }
export function goNoGo(inp: GoNoGoInput): GoNoGoResult {
  const reasons: string[] = [];
  const th = inp.readinessThreshold ?? 60;
  if (!inp.draftReady) reasons.push('Draft Validation 미Pass');
  if (!inp.hardPass) reasons.push('Hard Constraint Fail');
  if (inp.expired) reasons.push('Expired');
  if (!inp.inputHashMatch) reasons.push('Input Hash 불일치');
  if (!inp.policyVersionMatch) reasons.push('Policy Version 불일치');
  if (inp.riskTier === 'critical') reasons.push('Critical Risk');
  if (!inp.rollbackReady) reasons.push('Rollback Plan 없음');
  if (!inp.observationReady) reasons.push('Observation Plan 없음');
  if (!inp.approved) reasons.push('승인 미완료');
  if (!inp.evidenceComplete) reasons.push('Evidence 불완전');
  if (inp.canaryReadiness < th) reasons.push(`Canary Readiness ${inp.canaryReadiness} < ${th}`);
  return { decision: reasons.length === 0 ? 'go_candidate' : 'no_go', reasons };
}

/* ── 23/24) Duplicate / Idempotency ─────────────────────────────────────── */
export function isDuplicatePromotion(existing: Array<{ sandbox_run_id: string; strategy_id: string | null; requested_draft_type: string; request_status: string }>, cand: { sandbox_run_id: string; strategy_id: string | null; requested_draft_type: string }): boolean {
  const active = new Set(['draft', 'pending_review', 'approved', 'converted']);
  return existing.some((e) => e.sandbox_run_id === cand.sandbox_run_id && (e.strategy_id ?? '') === (cand.strategy_id ?? '') && e.requested_draft_type === cand.requested_draft_type && active.has(e.request_status));
}
export function idempotencyKey(parts: { sandboxRunId: string; strategyId: string | null; draftType: DraftType; inputHash: string | null }): string {
  const s = `${parts.sandboxRunId}|${parts.strategyId ?? ''}|${parts.draftType}|${parts.inputHash ?? ''}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `pk_${(h >>> 0).toString(16)}`;
}

/* ── 22) Expiration ─────────────────────────────────────────────────────── */
export interface PromoExpireInput { sandboxExpired: boolean; inputHashMatch: boolean; modelVersionMatch: boolean; policyVersionMatch: boolean; ageDays: number; maxAgeDays?: number }
export function promotionExpired(inp: PromoExpireInput): { expired: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (inp.sandboxExpired) reasons.push('Source Sandbox Expired');
  if (!inp.inputHashMatch) reasons.push('Input Hash 변경');
  if (!inp.modelVersionMatch) reasons.push('Model Version 변경');
  if (!inp.policyVersionMatch) reasons.push('Policy 변경');
  if (isNum(inp.ageDays) && inp.ageDays > (inp.maxAgeDays ?? 14)) reasons.push(`경과 ${inp.ageDays}일`);
  return { expired: reasons.length > 0, reasons };
}

/* ── 27) Human Review Reasons ───────────────────────────────────────────── */
export const APPROVAL_REASONS = ['strong_expected_gain', 'low_risk', 'policy_compliant', 'sufficient_sample', 'strategic_priority', 'manual_business_reason'] as const;
export const REJECTION_REASONS = ['expected_gain_too_low', 'risk_too_high', 'policy_concern', 'operational_cost', 'wrong_context', 'duplicate_strategy', 'insufficient_evidence', 'stale_sandbox', 'manual_business_reason'] as const;

/* ── 4) Separation of Duties(현재 권한 모델 기준) ───────────────────────── */
export interface SoDResult { supported: boolean; note: string }
export const SEPARATION_OF_DUTIES: SoDResult = { supported: false, note: 'admin_users 는 super_admin 단일 role — 역할 분리(reviewer/approver) 미지원. 단일 관리자 승인 + Audit + 고위험 자기승인 제한으로 대체.' };
/** 고위험 자기승인 차단(요청자=승인자). low/medium 은 허용(단일 관리자). */
export function selfApprovalAllowed(tier: RiskTier, requester: string | null, approver: string | null): boolean {
  if (tier === 'high' || tier === 'critical') return !(requester && approver && requester === approver);
  return true;
}

/* ── 29) Draft Comparison(최대 3, Winner 단정 없음) ─────────────────────── */
export interface DraftCompareInput { id: string; label: string; draft_type: DraftType; expected_gain: number | null; risk: number | null; cost: number | null; roi: number | null; canary_readiness: number | null; approval_readiness: number | null; changed_track_count: number | null }
export interface DraftCompareRow { metric: string; values: Array<number | string | null>; note: string }
export function compareDrafts(drafts: DraftCompareInput[]): { drafts: string[]; rows: DraftCompareRow[] } {
  const labels = drafts.map((d) => d.label);
  const row = (metric: string, fn: (d: DraftCompareInput) => number | string | null, higherBetter?: boolean): DraftCompareRow => {
    const vals = drafts.map(fn); let note = '항목별 비교(단정 없음)';
    if (higherBetter != null) {
      const nums = vals.filter(isNum);
      if (nums.length >= 2) { const best = higherBetter ? Math.max(...nums) : Math.min(...nums); const idx = vals.findIndex((v) => v === best); if (idx >= 0) note = `${labels[idx]} ${higherBetter ? '우세' : '유리'}`; }
    }
    return { metric, values: vals, note };
  };
  return { drafts: labels, rows: [
    row('Draft Type', (d) => DRAFT_TYPE_LABEL[d.draft_type]),
    row('Expected Gain', (d) => d.expected_gain, true),
    row('Risk', (d) => d.risk, false), row('Cost', (d) => d.cost, false), row('ROI', (d) => d.roi, true),
    row('Canary Readiness', (d) => d.canary_readiness, true), row('Approval Readiness', (d) => d.approval_readiness, true),
    row('변경 Track', (d) => d.changed_track_count, false),
  ] };
}

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const REQUEST_STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_review: '검토 대기', approved: '승인', rejected: '기각', conversion_failed: '변환 실패', converted: '변환 완료', expired: 'Expired', cancelled: '취소' };
export const REQUEST_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = { draft: 'neutral', pending_review: 'info', approved: 'success', rejected: 'danger', conversion_failed: 'danger', converted: 'success', expired: 'warning', cancelled: 'neutral' };
export const DRAFT_STATUS_LABEL: Record<string, string> = { generated: '생성됨', validating: '검증중', ready: 'Ready', review_required: 'Review 필요', rejected: '기각', expired: 'Expired', cancelled: '취소' };
export const DRAFT_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = { generated: 'info', validating: 'info', ready: 'success', review_required: 'warning', rejected: 'danger', expired: 'warning', cancelled: 'neutral' };
export const CANARY_STATUS_LABEL: Record<string, string> = { not_candidate: '후보 아님', candidate: 'Canary 후보', review_required: 'Review 필요', rejected: '기각', expired: 'Expired' };
export const CANARY_STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = { not_candidate: 'neutral', candidate: 'success', review_required: 'warning', rejected: 'danger', expired: 'warning' };
export const RISK_TIER_LABEL: Record<RiskTier, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const RISK_TIER_TONE: Record<RiskTier, 'success' | 'warning' | 'danger'> = { low: 'success', medium: 'warning', high: 'danger', critical: 'danger' };
export const CHECK_TONE: Record<CheckResult, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { pass: 'success', warning: 'warning', fail: 'danger', unsupported: 'neutral', insufficient_data: 'info' };
export function promotionAllowed(sample: number): boolean { return isNum(sample) && sample >= MIN_EVENTS; }
export { STRATEGY_LABEL };
