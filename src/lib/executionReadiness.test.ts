// Phase AI-OPS-2 — Execution Readiness 순수 로직 단위 테스트.
// Eligibility 8분류 · Plan Status(실행 상태 금지) · Preflight(자동 PASS 없음/진행률) ·
// Rollback/Observation 필수 · Go/No-Go(Constitution/Critical 우선) · Version/Expired ·
// Manual Reference · Execution Package · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  validateExecutionEligibility, PLAN_STATUSES, FORBIDDEN_STATUSES, buildDefaultPreflight,
  calculatePreflightProgress, validateRollbackReadiness, validateObservationReadiness,
  evaluateGoNoGo, detectVersionMismatch, detectExpiredPlan, validateManualExecutionReference,
  buildExecutionPackage, execReadyHash, EXECUTION_TYPES, XR_SUPPORT,
  type EligibilityInput, type PreflightItem, type GoNoGoInput, type PlanLike,
} from './executionReadiness';

const ELIG = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  operationStatus: 'approved', sourceExists: true, sourceVersionMatch: true, inputHashMatch: true,
  evidenceCount: 2, governanceReviewed: true, constitutionViolation: false, criticalRisk: false,
  sourceExpired: false, duplicatePlan: false, hasIdempotencyKey: true, executionType: 'playlist_change', ...over,
});

describe('Execution Eligibility', () => {
  it('승인된 Operation → eligible', () => { expect(validateExecutionEligibility(ELIG()).status).toBe('eligible'); });
  it('미승인 Operation 차단(blocked)', () => { expect(validateExecutionEligibility(ELIG({ operationStatus: 'reviewing' })).status).toBe('blocked'); });
  it('Source 미존재/Idempotency 없음 → blocked', () => {
    expect(validateExecutionEligibility(ELIG({ sourceExists: false })).status).toBe('blocked');
    expect(validateExecutionEligibility(ELIG({ hasIdempotencyKey: false })).status).toBe('blocked');
  });
  it('Evidence 누락 → missing_evidence · Version/Hash 불일치 → version_mismatch', () => {
    expect(validateExecutionEligibility(ELIG({ evidenceCount: 0 })).status).toBe('missing_evidence');
    expect(validateExecutionEligibility(ELIG({ sourceVersionMatch: false })).status).toBe('version_mismatch');
    expect(validateExecutionEligibility(ELIG({ inputHashMatch: false })).status).toBe('version_mismatch');
  });
  it('Expired/Duplicate/Critical/Constitution/Governance 미완료', () => {
    expect(validateExecutionEligibility(ELIG({ sourceExpired: true })).status).toBe('expired');
    expect(validateExecutionEligibility(ELIG({ duplicatePlan: true })).status).toBe('duplicate');
    expect(validateExecutionEligibility(ELIG({ criticalRisk: true })).status).toBe('blocked');
    expect(validateExecutionEligibility(ELIG({ constitutionViolation: true })).status).toBe('blocked');
    expect(validateExecutionEligibility(ELIG({ governanceReviewed: false })).status).toBe('review_required');
  });
  it('unsupported execution type 차단(scheduler/migration/policy)', () => {
    expect(validateExecutionEligibility(ELIG({ executionType: 'scheduler_change' })).status).toBe('unsupported');
    expect(validateExecutionEligibility(ELIG({ executionType: 'migration_change' })).status).toBe('unsupported');
  });
});

describe('Plan Status', () => {
  it('실행 상태(executing/deployed/live 등) 미포함', () => {
    for (const f of FORBIDDEN_STATUSES) expect(PLAN_STATUSES).not.toContain(f);
    expect(PLAN_STATUSES).toContain('ready_for_manual_execution');
  });
});

describe('Preflight', () => {
  it('기본 18항목 · 전부 pending(자동 PASS 없음)', () => {
    const items = buildDefaultPreflight();
    expect(items.length).toBe(18);
    expect(items.every((i) => i.status === 'pending')).toBe(true);
  });
  it('진행률/blocked 계산 · N/A·unsupported 제외', () => {
    const items: PreflightItem[] = [
      { key: 'a', label: 'a', required: true, status: 'passed' },
      { key: 'b', label: 'b', required: true, status: 'failed' },
      { key: 'c', label: 'c', required: false, status: 'pending' },
      { key: 'd', label: 'd', required: false, status: 'not_applicable' },
    ];
    const p = calculatePreflightProgress(items);
    expect(p.total).toBe(3); expect(p.passed).toBe(1); expect(p.blocked).toBe(true); expect(p.requiredRemaining).toBe(1);
    expect(calculatePreflightProgress([]).progressPct).toBeNull();
  });
});

describe('Rollback / Observation Readiness', () => {
  it('Rollback — trigger/steps/owner/recovery time/validation 필수 · irreversible ack', () => {
    expect(validateRollbackReadiness(null)).toContain('rollback plan 없음');
    expect(validateRollbackReadiness({ trigger: 't', steps: ['s'], owner: 'o', recovery_time_min: 30, validation: 'v' })).toEqual([]);
    expect(validateRollbackReadiness({ trigger: 't', steps: ['s'], owner: 'o', recovery_time_min: 30, validation: 'v', irreversible: true })).toContain('irreversible change — 명시적 확인(ack) 필수');
    expect(validateRollbackReadiness({ steps: [], owner: null }).length).toBeGreaterThan(2);
  });
  it('Observation — KPI/threshold/owner/source/criteria 필수 · 관측 불가 KPI 차단', () => {
    expect(validateObservationReadiness(null)).toContain('observation plan 없음');
    const ok = { period_hours: 24, kpis: ['skip_rate'], thresholds: { skip_rate: 10 }, monitoring_source: 'playback_events_v2', owner: 'o', success: 's', failure: 'f' };
    expect(validateObservationReadiness(ok)).toEqual([]);
    expect(validateObservationReadiness({ ...ok, kpis: ['revenue_per_second'] }).some((e) => e.includes('관측 불가 KPI'))).toBe(true);
  });
});

describe('Go / No-Go Engine', () => {
  const passing = (): GoNoGoInput => ({
    eligibility: 'eligible', constitutionPass: true, governancePass: true, criticalRisk: false,
    preflight: buildDefaultPreflight().map((i) => ({ ...i, status: 'passed' as const })),
    rollbackErrors: [], observationErrors: [], ownersAssigned: true, changeWindowSet: true,
    evidenceComplete: true, versionMatch: true,
  });
  it('전 조건 충족 → go(사람 실행 대기)', () => { expect(evaluateGoNoGo(passing()).decision).toBe('go'); });
  it('Constitution 위반 최우선 no_go · Critical Risk no_go', () => {
    expect(evaluateGoNoGo({ ...passing(), constitutionPass: false, criticalRisk: true }).reasons[0]).toContain('Constitution');
    expect(evaluateGoNoGo({ ...passing(), criticalRisk: true }).decision).toBe('no_go');
  });
  it('Rollback/Observation/Owner/Evidence 누락 → no_go · Preflight fail → no_go', () => {
    expect(evaluateGoNoGo({ ...passing(), rollbackErrors: ['x'] }).decision).toBe('no_go');
    expect(evaluateGoNoGo({ ...passing(), observationErrors: ['x'] }).decision).toBe('no_go');
    expect(evaluateGoNoGo({ ...passing(), ownersAssigned: false }).decision).toBe('no_go');
    expect(evaluateGoNoGo({ ...passing(), evidenceComplete: false }).decision).toBe('no_go');
    const pf = passing(); pf.preflight[0] = { ...pf.preflight[0], status: 'failed' };
    expect(evaluateGoNoGo(pf).decision).toBe('no_go');
  });
  it('version mismatch → no_go · Window 미확정 → review_required · 필수 pending → conditional_go', () => {
    expect(evaluateGoNoGo({ ...passing(), versionMatch: false }).decision).toBe('no_go');
    expect(evaluateGoNoGo({ ...passing(), changeWindowSet: false }).decision).toBe('review_required');
    const pf = passing(); pf.preflight[0] = { ...pf.preflight[0], status: 'pending' };
    const r = evaluateGoNoGo(pf);
    expect(r.decision).toBe('conditional_go'); expect(r.reasons[0]).toContain('자동 실행 권한 아님');
  });
  it('preflight 없음 → insufficient_data · governance 미통과 → review_required', () => {
    expect(evaluateGoNoGo({ ...passing(), preflight: [] }).decision).toBe('insufficient_data');
    expect(evaluateGoNoGo({ ...passing(), governancePass: false }).decision).toBe('review_required');
  });
});

describe('Version / Expired / Manual Reference / Package', () => {
  it('detectVersionMismatch — 변경된 키만', () => {
    expect(detectVersionMismatch({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual(['b']);
    expect(detectVersionMismatch({ a: '1' }, {})).toEqual([]);
  });
  it('detectExpiredPlan — TTL 14일', () => {
    const now = new Date('2026-07-14');
    expect(detectExpiredPlan('2026-06-01', now)).toBe(true);
    expect(detectExpiredPlan('2026-07-10', now)).toBe(false);
  });
  it('Manual Reference — 필수 필드 검증(자동 실행 경로 아님)', () => {
    expect(validateManualExecutionReference({})).toHaveLength(4);
    expect(validateManualExecutionReference({ external_change_id: 'CHG-1', executed_by: 'ops', executed_at: '2026-07-14', execution_result: 'succeeded' })).toEqual([]);
    expect(validateManualExecutionReference({ external_change_id: 'CHG-1', executed_by: 'ops', executed_at: 't', execution_result: 'deployed' }).length).toBe(1);
  });
  it('Execution Package — 필수 섹션 포함 · Apply SQL 미포함', () => {
    const plan: PlanLike = {
      plan_code: 'p', change_summary: 's', business_objective: null, scope: {}, source_type: 'executive_recommendation',
      source_id: 'x', risk_tier: 'low', dependencies: [], preconditions: [], execution_steps: [1], validation_steps: [1],
      rollback_plan: { trigger: 't', steps: ['s'], owner: 'o', recovery_time_min: 10, validation: 'v' },
      observation_plan: { period_hours: 24, kpis: ['skip_rate'], thresholds: { skip_rate: 10 }, monitoring_source: 'm', owner: 'o', success: 's', failure: 'f' },
      go_criteria: [], no_go_criteria: [], execution_owner: 'e', rollback_owner: 'r', observation_owner: 'ob',
      change_window_start: '2026-07-15', change_window_end: '2026-07-16', source_versions: { plan: 'v1' }, input_hash: 'h',
      evidence: [1], limitations: [1],
    };
    const pkg = buildExecutionPackage(plan);
    const sections = pkg.map((p) => p.section);
    for (const s of ['Change Summary', 'Risk', 'Rollback Plan', 'Observation Plan', 'Owners', 'Change Window', 'Version Chain / Hash', 'Known Limitations']) expect(sections).toContain(s);
    expect(JSON.stringify(pkg)).not.toMatch(/UPDATE\s+public|INSERT INTO|DELETE FROM/i); // 실행 SQL 미포함
  });
  it('hash 결정적', () => { expect(execReadyHash(['a'])).toBe(execReadyHash(['a'])); });
});

describe('Support Matrix', () => {
  it('Execution Type 5 supported/5 unsupported · Auto Execution/Production Apply unsupported', () => {
    expect(EXECUTION_TYPES.filter((t) => t.support === 'supported').length).toBe(5);
    expect(EXECUTION_TYPES.filter((t) => t.support === 'unsupported').length).toBe(5);
    expect(XR_SUPPORT.find((s) => s.key === 'auto_execution')!.status).toBe('unsupported');
    expect(XR_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(XR_SUPPORT.find((s) => s.key === 'manual_ref')!.status).toBe('evidence_only');
  });
});
