/**
 * executionReadiness — Controlled Execution Planning & Release Readiness 순수 로직 (Phase AI-OPS-2).
 *
 * 승인된 Operation(0504)을 Production 에 바로 적용하지 않고 Eligibility → Change Plan →
 * Dependency → Preflight → Change Window → Rollback/Observation Readiness → Go/No-Go →
 * Execution Package → **사람 실행 대기**로 관리하는 계산 계층.
 *
 * 원칙: 실행 상태(executing/deployed/live) 표현 금지 · Rollback/Observation 없는 준비 완료
 *       금지 · Critical Risk/Constitution 위반 시 No-Go 우선 · 자동 PASS 없음 ·
 *       deterministic · Date 주입 · Production Entity 변경 없음.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const EXECREADY_SOURCE_VERSION = 'execready_v1(0505)';

/* ── Execution Type(실제 Source 지원 여부) ──────────────────────────────── */
export type ExecutionType = 'configuration_change' | 'playlist_change' | 'rotation_change' | 'rollout_change' | 'scheduler_change' | 'recovery_action' | 'migration_change' | 'infrastructure_change' | 'policy_change' | 'observation_only';
export const EXECUTION_TYPES: Array<{ type: ExecutionType; label: string; support: 'supported' | 'unsupported'; note: string }> = [
  { type: 'playlist_change', label: 'Playlist Change', support: 'supported', note: 'Playlist Draft(0487) 흐름 연결' },
  { type: 'rotation_change', label: 'Rotation Change', support: 'supported', note: 'Rotation Draft(0488) 흐름 연결' },
  { type: 'rollout_change', label: 'Rollout Change', support: 'supported', note: 'Track Rollout(0486) 단계 검토' },
  { type: 'recovery_action', label: 'Recovery Action', support: 'supported', note: 'Recovery Candidate(0502, Twin 검증 필수)' },
  { type: 'observation_only', label: 'Observation Only', support: 'supported', note: '변경 없는 관측 계획' },
  { type: 'configuration_change', label: 'Configuration Change', support: 'unsupported', note: 'config 변경 Source 미연결' },
  { type: 'scheduler_change', label: 'Scheduler Change', support: 'unsupported', note: 'Scheduler 변경 금지 대상' },
  { type: 'migration_change', label: 'Migration Change', support: 'unsupported', note: 'Migration Apply 금지 — 문서화만' },
  { type: 'infrastructure_change', label: 'Infrastructure Change', support: 'unsupported', note: '인프라 Source 미연결' },
  { type: 'policy_change', label: 'Policy Change', support: 'unsupported', note: 'Policy 수정 금지 대상' },
];

/* ── Plan Status(실행 상태 표현 금지) ───────────────────────────────────── */
export type PlanStatus = 'draft' | 'pending_review' | 'waiting_evidence' | 'preflight_ready' | 'go_review' | 'ready_for_manual_execution' | 'no_go' | 'rejected' | 'cancelled' | 'expired' | 'completed_reference';
export const FORBIDDEN_STATUSES = ['executing', 'deployed', 'applied', 'production', 'live', 'running'];
export const PLAN_STATUSES: PlanStatus[] = ['draft', 'pending_review', 'waiting_evidence', 'preflight_ready', 'go_review', 'ready_for_manual_execution', 'no_go', 'rejected', 'cancelled', 'expired', 'completed_reference'];

/* ── Execution Eligibility ──────────────────────────────────────────────── */
export type Eligibility = 'eligible' | 'review_required' | 'missing_evidence' | 'version_mismatch' | 'expired' | 'blocked' | 'duplicate' | 'unsupported';
export interface EligibilityInput {
  operationStatus: string; sourceExists: boolean; sourceVersionMatch: boolean; inputHashMatch: boolean;
  evidenceCount: number; governanceReviewed: boolean; constitutionViolation: boolean; criticalRisk: boolean;
  sourceExpired: boolean; duplicatePlan: boolean; hasIdempotencyKey: boolean; executionType: ExecutionType;
}
export function validateExecutionEligibility(inp: EligibilityInput): { status: Eligibility; reasons: string[] } {
  if (EXECUTION_TYPES.find((t) => t.type === inp.executionType)?.support !== 'supported') return { status: 'unsupported', reasons: [`execution_type ${inp.executionType} 미지원`] };
  if (inp.duplicatePlan) return { status: 'duplicate', reasons: ['이미 실행 계획 존재'] };
  if (inp.operationStatus !== 'approved') return { status: 'blocked', reasons: [`operation status=${inp.operationStatus} — 승인 필요`] };
  if (!inp.sourceExists || !inp.hasIdempotencyKey) return { status: 'blocked', reasons: [!inp.sourceExists ? 'source 미존재' : 'idempotency key 없음'] };
  if (inp.constitutionViolation) return { status: 'blocked', reasons: ['Constitution 위반'] };
  if (inp.criticalRisk) return { status: 'blocked', reasons: ['Critical Risk'] };
  if (inp.sourceExpired) return { status: 'expired', reasons: ['source expired'] };
  if (!inp.sourceVersionMatch || !inp.inputHashMatch) return { status: 'version_mismatch', reasons: ['version/hash 불일치'] };
  if (inp.evidenceCount <= 0) return { status: 'missing_evidence', reasons: ['evidence 없음'] };
  if (!inp.governanceReviewed) return { status: 'review_required', reasons: ['Governance Review 미완료'] };
  return { status: 'eligible', reasons: [] };
}

/* ── Preflight Checklist(자동 PASS 없음) ────────────────────────────────── */
export type PreflightStatus = 'pending' | 'passed' | 'failed' | 'not_applicable' | 'unsupported';
export interface PreflightItem { key: string; label: string; required: boolean; status: PreflightStatus; evidence?: string | null; failure_reason?: string | null }
export const PREFLIGHT_CATALOG: Array<{ key: string; label: string; required: boolean; unsupported?: boolean }> = [
  { key: 'ci', label: 'CI 통과', required: true },
  { key: 'preview', label: 'Preview Ready', required: true },
  { key: 'source_branch', label: 'Source Branch 확인', required: true },
  { key: 'base_branch', label: 'Base Branch 확인', required: true },
  { key: 'commit_sha', label: 'Commit SHA 확인', required: true },
  { key: 'migration_order', label: 'Migration 순서 확인', required: true },
  { key: 'env_vars', label: 'Environment Variable 확인', required: false },
  { key: 'feature_flag', label: 'Feature Flag 확인', required: false },
  { key: 'snapshot', label: 'Snapshot 완료', required: true },
  { key: 'backup', label: 'Backup 확인', required: true },
  { key: 'rollback_plan', label: 'Rollback Plan 확인', required: true },
  { key: 'observation_plan', label: 'Observation Plan 확인', required: true },
  { key: 'monitoring', label: 'Monitoring 확인', required: false },
  { key: 'incident_owner', label: 'Incident Response Owner 확인', required: true },
  { key: 'change_window', label: 'Change Window 확인', required: true },
  { key: 'impact_scope', label: '영향 Scope 확인', required: true },
  { key: 'approver', label: '승인자 확인', required: true },
  { key: 'audit', label: 'Audit 확인', required: true },
];
export function buildDefaultPreflight(): PreflightItem[] {
  return PREFLIGHT_CATALOG.map((c) => ({ key: c.key, label: c.label, required: c.required, status: c.unsupported ? 'unsupported' : 'pending' }));
}
export function calculatePreflightProgress(items: PreflightItem[]): { total: number; passed: number; failed: number; pending: number; requiredRemaining: number; progressPct: number | null; blocked: boolean } {
  const applicable = items.filter((i) => i.status !== 'not_applicable' && i.status !== 'unsupported');
  if (!applicable.length) return { total: 0, passed: 0, failed: 0, pending: 0, requiredRemaining: 0, progressPct: null, blocked: false };
  const passed = applicable.filter((i) => i.status === 'passed').length;
  const failed = applicable.filter((i) => i.status === 'failed').length;
  const pending = applicable.filter((i) => i.status === 'pending').length;
  const requiredRemaining = applicable.filter((i) => i.required && i.status !== 'passed').length;
  return {
    total: applicable.length, passed, failed, pending, requiredRemaining,
    progressPct: clampScore((passed / applicable.length) * 100),
    blocked: applicable.some((i) => i.required && i.status === 'failed'),
  };
}

/* ── Rollback / Observation Readiness ───────────────────────────────────── */
export interface RollbackPlan { trigger?: string | null; steps?: string[] | null; owner?: string | null; recovery_time_min?: number | null; snapshot_ref?: string | null; validation?: string | null; irreversible?: boolean | null; irreversible_ack?: boolean | null }
export function validateRollbackReadiness(plan: RollbackPlan | null | undefined): string[] {
  if (!plan) return ['rollback plan 없음'];
  const errors: string[] = [];
  if (!plan.trigger) errors.push('rollback trigger 필수');
  if (!plan.steps?.length) errors.push('rollback steps 필수');
  if (!plan.owner) errors.push('rollback owner 필수');
  if (!isFiniteNumber(plan.recovery_time_min)) errors.push('expected recovery time 필수');
  if (!plan.validation) errors.push('rollback 후 validation 필수');
  if (plan.irreversible === true && plan.irreversible_ack !== true) errors.push('irreversible change — 명시적 확인(ack) 필수');
  return errors;
}
export interface ObservationPlan { period_hours?: number | null; kpis?: string[] | null; thresholds?: Record<string, number> | null; alert_condition?: string | null; monitoring_source?: string | null; owner?: string | null; success?: string | null; failure?: string | null; escalation?: string | null }
export const OBSERVABLE_KPIS = ['completion_rate', 'skip_rate', 'error_rate', 'like_rate', 'events'];
export function validateObservationReadiness(plan: ObservationPlan | null | undefined): string[] {
  if (!plan) return ['observation plan 없음'];
  const errors: string[] = [];
  if (!isFiniteNumber(plan.period_hours) || plan.period_hours <= 0) errors.push('observation period 필수');
  if (!plan.kpis?.length) errors.push('KPI 필수');
  for (const k of plan.kpis ?? []) if (!OBSERVABLE_KPIS.includes(k)) errors.push(`관측 불가 KPI: ${k}(실측 telemetry 없음)`);
  if (!plan.thresholds || !Object.keys(plan.thresholds).length) errors.push('threshold 필수');
  if (!plan.monitoring_source) errors.push('monitoring source 필수');
  if (!plan.owner) errors.push('observation owner 필수');
  if (!plan.success || !plan.failure) errors.push('success/failure criteria 필수');
  return errors;
}

/* ── Go / No-Go Engine(우선순위: Constitution > Critical Risk > 누락) ────── */
export type GoDecision = 'go' | 'conditional_go' | 'no_go' | 'review_required' | 'insufficient_data';
export interface GoNoGoInput {
  eligibility: Eligibility; constitutionPass: boolean; governancePass: boolean; criticalRisk: boolean;
  preflight: PreflightItem[]; rollbackErrors: string[]; observationErrors: string[];
  ownersAssigned: boolean; changeWindowSet: boolean; evidenceComplete: boolean; versionMatch: boolean;
}
export function evaluateGoNoGo(inp: GoNoGoInput): { decision: GoDecision; reasons: string[] } {
  const reasons: string[] = [];
  if (!inp.constitutionPass) return { decision: 'no_go', reasons: ['Constitution violation(최우선 차단)'] };
  if (inp.criticalRisk) return { decision: 'no_go', reasons: ['Critical Risk(차단)'] };
  if (inp.eligibility === 'expired' || !inp.versionMatch) return { decision: 'no_go', reasons: ['source expired/version mismatch'] };
  const pf = calculatePreflightProgress(inp.preflight);
  if (pf.blocked) reasons.push('필수 Preflight fail');
  if (inp.rollbackErrors.length) reasons.push(`Rollback 미완성(${inp.rollbackErrors.length})`);
  if (inp.observationErrors.length) reasons.push(`Observation 미완성(${inp.observationErrors.length})`);
  if (!inp.ownersAssigned) reasons.push('Owner 누락');
  if (!inp.evidenceComplete) reasons.push('Evidence 누락');
  if (reasons.length) return { decision: 'no_go', reasons };
  if (inp.eligibility !== 'eligible' || !inp.governancePass) return { decision: 'review_required', reasons: ['eligibility/governance 검토 필요'] };
  if (!inp.changeWindowSet) return { decision: 'review_required', reasons: ['Change Window 미확정'] };
  if (pf.progressPct == null) return { decision: 'insufficient_data', reasons: ['preflight 항목 없음'] };
  if (pf.requiredRemaining > 0) return { decision: 'conditional_go', reasons: [`필수 Preflight ${pf.requiredRemaining}건 잔여 — 완료 후 go(자동 실행 권한 아님)`] };
  return { decision: 'go', reasons: ['모든 조건 충족 — ready_for_manual_execution(사람 실행 대기)'] };
}

/* ── 기타 검증 ──────────────────────────────────────────────────────────── */
export function detectVersionMismatch(planVersions: Record<string, string>, currentVersions: Record<string, string>): string[] {
  return Object.entries(planVersions).filter(([k, v]) => currentVersions[k] != null && currentVersions[k] !== v).map(([k]) => k);
}
export function detectExpiredPlan(createdAt: string | Date, now: Date, ttlDays = 14): boolean {
  const age = (now.getTime() - new Date(createdAt).getTime()) / 86_400_000;
  return Number.isFinite(age) && age > ttlDays;
}
export interface ManualReference { external_change_id?: string | null; executed_by?: string | null; executed_at?: string | null; execution_result?: string | null }
export function validateManualExecutionReference(ref: ManualReference): string[] {
  const errors: string[] = [];
  if (!ref.external_change_id) errors.push('external_change_id 필수');
  if (!ref.executed_by) errors.push('executed_by 필수');
  if (!ref.executed_at) errors.push('executed_at 필수');
  if (!ref.execution_result || !['succeeded', 'failed', 'partially', 'rolled_back'].includes(ref.execution_result)) errors.push('execution_result 필수(succeeded/failed/partially/rolled_back)');
  return errors;
}

/* ── Execution Package(사람 확인용 — Apply SQL 자동 생성 없음) ──────────── */
export interface PlanLike {
  plan_code: string; change_summary: string; business_objective: string | null; scope: Record<string, unknown>;
  source_type: string; source_id: string; risk_tier: string; dependencies: unknown[]; preconditions: unknown[];
  execution_steps: unknown[]; validation_steps: unknown[]; rollback_plan: RollbackPlan | null; observation_plan: ObservationPlan | null;
  go_criteria: unknown[]; no_go_criteria: unknown[]; execution_owner: string | null; rollback_owner: string | null; observation_owner: string | null;
  change_window_start: string | null; change_window_end: string | null; source_versions: Record<string, string>; input_hash: string;
  evidence: unknown[]; limitations: unknown[];
}
export function buildExecutionPackage(plan: PlanLike): Array<{ section: string; content: string }> {
  return [
    { section: 'Change Summary', content: plan.change_summary },
    { section: 'Business Objective', content: plan.business_objective ?? '—' },
    { section: 'Scope', content: JSON.stringify(plan.scope) },
    { section: 'Source Operation', content: `${plan.source_type}:${plan.source_id}` },
    { section: 'Risk', content: plan.risk_tier },
    { section: 'Dependencies', content: `${plan.dependencies.length}건` },
    { section: 'Preconditions', content: `${plan.preconditions.length}건` },
    { section: 'Execution Steps (사람 실행)', content: `${plan.execution_steps.length}단계` },
    { section: 'Validation Steps', content: `${plan.validation_steps.length}단계` },
    { section: 'Rollback Plan', content: plan.rollback_plan ? `owner ${plan.rollback_plan.owner ?? '—'} · ${plan.rollback_plan.steps?.length ?? 0}단계` : '없음(준비 미완)' },
    { section: 'Observation Plan', content: plan.observation_plan ? `owner ${plan.observation_plan.owner ?? '—'} · ${plan.observation_plan.kpis?.length ?? 0} KPI` : '없음(준비 미완)' },
    { section: 'Owners', content: `exec ${plan.execution_owner ?? '—'} / rollback ${plan.rollback_owner ?? '—'} / obs ${plan.observation_owner ?? '—'}` },
    { section: 'Change Window', content: plan.change_window_start ? `${plan.change_window_start} ~ ${plan.change_window_end}` : '미확정' },
    { section: 'Version Chain / Hash', content: `${JSON.stringify(plan.source_versions)} · ${plan.input_hash}` },
    { section: 'Evidence', content: `${plan.evidence.length}건` },
    { section: 'Known Limitations', content: `${plan.limitations.length}건 · 자동 실행/Apply SQL 생성 없음` },
  ];
}

export function execReadyHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `xr_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type XrSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface XrSupport { key: string; label: string; status: XrSupportStatus; note: string }
export const XR_SUPPORT: XrSupport[] = [
  { key: 'eligibility', label: 'Execution Eligibility', status: 'fully_supported', note: '승인 상태/중복/버전/Evidence 8분류(서버 게이트 이중)' },
  { key: 'plan', label: 'Execution Plan', status: 'fully_supported', note: '실행 상태(executing/live) 표현 금지' },
  { key: 'exec_types', label: 'Execution Types', status: 'partially_supported', note: '5종 supported · scheduler/migration/policy 등 5종 unsupported' },
  { key: 'dependency', label: 'Dependency Validation', status: 'partially_supported', note: '실존 참조만(임의 생성 없음)' },
  { key: 'preflight', label: 'Preflight Checklist', status: 'fully_supported', note: '18항목 · 자동 PASS 없음 · 항목별 5상태' },
  { key: 'change_window', label: 'Change Window', status: 'fully_supported', note: '일정/조건 저장만 — 자동 예약 실행 금지' },
  { key: 'rollback', label: 'Rollback Readiness', status: 'fully_supported', note: '없으면 ready 금지(서버 게이트) · irreversible ack' },
  { key: 'observation', label: 'Observation Readiness', status: 'partially_supported', note: '관측 가능 KPI 5종만(임의 KPI 차단)' },
  { key: 'go_no_go', label: 'Go / No-Go Engine', status: 'fully_supported', note: 'Constitution>Critical Risk 우선 · conditional_go ≠ 실행 권한' },
  { key: 'package', label: 'Execution Package', status: 'fully_supported', note: '사람 확인 문서 — Apply SQL/실행 명령 자동 생성 없음' },
  { key: 'manual_ref', label: 'Manual Execution Reference', status: 'evidence_only', note: '외부 실행 참고 기록만(실행 버튼/Production API 없음)' },
  { key: 'auto_execution', label: 'Automatic Execution', status: 'unsupported', note: '금지 — 예약/실행/Deploy/Merge/Publish 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { draft: 'Draft', pending_review: '검토 대기', waiting_evidence: 'Evidence 대기', preflight_ready: 'Preflight Ready', go_review: 'Go Review', ready_for_manual_execution: '사람 실행 대기', no_go: 'No-Go', rejected: '기각', cancelled: '취소', expired: '만료', completed_reference: '실행 참고 기록됨' };
export const PLAN_STATUS_TONE: Record<PlanStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { draft: 'neutral', pending_review: 'info', waiting_evidence: 'warning', preflight_ready: 'info', go_review: 'warning', ready_for_manual_execution: 'success', no_go: 'danger', rejected: 'danger', cancelled: 'neutral', expired: 'neutral', completed_reference: 'success' };
export const GO_LABEL: Record<GoDecision, string> = { go: 'Go(사람 실행 대기)', conditional_go: 'Conditional Go(실행 권한 아님)', no_go: 'No-Go', review_required: '검토 필요', insufficient_data: '데이터 부족' };
export const GO_TONE: Record<GoDecision, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { go: 'success', conditional_go: 'warning', no_go: 'danger', review_required: 'info', insufficient_data: 'neutral' };
export const PREFLIGHT_TONE: Record<PreflightStatus, 'neutral' | 'success' | 'danger' | 'info' | 'warning'> = { pending: 'warning', passed: 'success', failed: 'danger', not_applicable: 'neutral', unsupported: 'neutral' };
export const ELIGIBILITY_TONE: Record<Eligibility, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { eligible: 'success', review_required: 'info', missing_evidence: 'warning', version_mismatch: 'danger', expired: 'neutral', blocked: 'danger', duplicate: 'warning', unsupported: 'danger' };
