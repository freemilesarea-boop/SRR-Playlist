/**
 * securityGovernance — Security Operations, Access Governance, Privacy Control &
 * Compliance Evidence 순수 로직 (Phase AI-OPS-7).
 *
 * Identity/Access Inventory → Permission 분석 → 민감 데이터 검토 → SoD →
 * Privacy/Retention 검증 → 위험 탐지 → Access Review → 사람 승인/외부 조치 Reference →
 * Compliance Evidence Package → Audit. IAM 실행/계정 관리/개인정보 자동 삭제 엔진 아님.
 *
 * 원칙: 로그 부재 ≠ 접근 없음(logging_unavailable) · Role 이름만으로 권한 범위 단정 금지 ·
 *       단일 admin Role 환경에서 세분 RBAC 주장 금지(rbac_limited) · 실제 삭제 없이 완료
 *       표시 금지 · 암호화 미확인 시 encryption_unverified · 상관≠침해 원인 · null→0 없음 ·
 *       Evidence 없는 보안 보장 금지 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const SECGOV_SOURCE_VERSION = 'secgov_v1(0510)';

/* ── Security Domain / Role(실제 DB 값) ─────────────────────────────────── */
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data' | 'logging_unavailable' | 'rbac_limited' | 'manual_action_required' | 'encryption_unverified' | 'deletion_reference_only';
export const ACTUAL_ROLES = ['user', 'admin'] as const;                       // users.role CHECK(0001)
export const ACTUAL_ACCOUNT_TYPES = ['individual', 'business', 'artist'];     // 0017
export const SECURITY_DOMAINS: Array<{ domain: string; label: string; status: SupportStatus; note: string }> = [
  { domain: 'identity', label: 'Identity', status: 'partially_supported', note: 'users+auth.users 실시간 조회(마스킹) — MFA/Session 확인 불가' },
  { domain: 'authentication', label: 'Authentication', status: 'read_only', note: 'Supabase Auth 위임 — last_sign_in_at 만 확인 가능' },
  { domain: 'authorization', label: 'Authorization', status: 'rbac_limited', note: 'role 2종(user/admin)만 — 세분 RBAC 없음' },
  { domain: 'admin_access', label: 'Admin Access', status: 'partially_supported', note: '_admin_growth_guard 단일 게이트' },
  { domain: 'contract_data', label: 'Contract Data', status: 'partially_supported', note: 'artist_contracts(0057) — 조회 로그 없음' },
  { domain: 'settlement_data', label: 'Settlement Data', status: 'partially_supported', note: 'artist_settlements(0060) — masked snapshot' },
  { domain: 'payout_data', label: 'Payout Data', status: 'partially_supported', note: 'payout_reveal_audit(0061) 열람 기록 존재' },
  { domain: 'account_data', label: 'Account Data', status: 'encryption_unverified', note: 'payout_accounts.account_number — 컬럼 암호화 확인 불가' },
  { domain: 'personal_data', label: 'Personal Data', status: 'partially_supported', note: 'auth.users.email 등 — 조회 로그 없음' },
  { domain: 'storage_access', label: 'Storage Access', status: 'logging_unavailable', note: '다운로드 로그 미수집' },
  { domain: 'rpc_security', label: 'RPC Security', status: 'partially_supported', note: 'SECURITY DEFINER+search_path+guard 패턴 — 전수 자동 검증은 코드 분석 기반' },
  { domain: 'secrets', label: 'Secrets', status: 'evidence_only', note: 'env 위치 metadata 만 — 값 저장/조회 없음' },
  { domain: 'audit_logging', label: 'Audit Logging', status: 'partially_supported', note: 'AI 운영 audit 체인 존재 — 로그인/SELECT 로그 없음' },
  { domain: 'retention', label: 'Retention', status: 'insufficient_data', note: '승인된 보존 정책 없음(policy_not_defined)' },
  { domain: 'privacy_request', label: 'Privacy Request', status: 'deletion_reference_only', note: '접수/추적만 — 삭제는 외부 수동+Reference' },
  { domain: 'security_incident', label: 'Security Incident', status: 'partially_supported', note: 'ai_incidents(0502) 상관 연결' },
  { domain: 'vendor_security', label: 'Vendor Security', status: 'unsupported', note: '외부 Provider 보안 직접 검증 불가 — 안전 단정 금지' },
  { domain: 'emergency_access', label: 'Emergency Access', status: 'insufficient_data', note: 'Break Glass 계정 없음' },
];

/* ── Account Status(로그인 이력 없으면 단정 금지) ───────────────────────── */
export type AccountStatus = 'active' | 'inactive' | 'withdrawn' | 'locked_reference' | 'dormant_candidate' | 'service_account' | 'unknown' | 'insufficient_data';
export function classifyAccountStatus(inp: { exists: boolean; withdrawn: boolean; lastSignInAt: string | null; isServiceAccount?: boolean; now: Date; dormantDays?: number }): { status: AccountStatus; note: string } {
  if (!inp.exists) return { status: 'insufficient_data', note: '계정 정보 없음' };
  if (inp.isServiceAccount) return { status: 'service_account', note: '' };
  if (inp.withdrawn) return { status: 'withdrawn', note: '탈퇴 계정' };
  if (!inp.lastSignInAt) return { status: 'unknown', note: '로그인 이력 없음 — 휴면으로 단정하지 않음' };
  const t = Date.parse(inp.lastSignInAt);
  if (!Number.isFinite(t)) return { status: 'unknown', note: '로그인 시각 파싱 불가' };
  const days = (inp.now.getTime() - t) / 86400000;
  if (days > (inp.dormantDays ?? 90)) return { status: 'dormant_candidate', note: `마지막 로그인 ${Math.floor(days)}일 전 — 검토 후보(비활성화 상태 아님)` };
  return { status: 'active', note: '' };
}

/* ── Access Risk(재정규화 · 자동 조치 없음) ─────────────────────────────── */
export interface AccessRiskComponents {
  privilegedRole: number | null; rbacLimitation: number | null; dormantRisk: number | null; withdrawnAccessRisk: number | null;
  selfApprovalRisk: number | null; scopeUnrestricted: number | null; sensitiveAccess: number | null;
  auditGap: number | null; mfaUnknown: number | null; singleAdminRisk: number | null;
}
export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
export function calculateAccessRisk(c: AccessRiskComponents): { level: RiskLevel; score: number | null; missing: string[]; noAutoAction: true } {
  const weights: Record<keyof AccessRiskComponents, number> = {
    privilegedRole: 14, rbacLimitation: 10, dormantRisk: 10, withdrawnAccessRisk: 14, selfApprovalRisk: 10,
    scopeUnrestricted: 10, sensitiveAccess: 12, auditGap: 8, mfaUnknown: 6, singleAdminRisk: 6,
  };
  const comps = (Object.keys(weights) as Array<keyof AccessRiskComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (base.score === null) return { level: 'insufficient_data', score: null, missing: base.missing, noAutoAction: true };
  const level: RiskLevel = base.score >= 75 ? 'critical' : base.score >= 50 ? 'high' : base.score >= 25 ? 'moderate' : 'low';
  return { level, score: base.score, missing: base.missing, noAutoAction: true }; // Critical 이어도 자동 비활성화 없음
}

/* ── Privileged / Least Privilege ───────────────────────────────────────── */
export function classifyPrivilegedAccount(inp: { role: string; isActive: boolean }): { privileged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (inp.role === 'admin') reasons.push('admin role — 전체 admin RPC 실행 가능(정산/계약/지급/User 관리 포함)');
  return { privileged: inp.role === 'admin', reasons };
}
export type LeastPrivilege = 'appropriate' | 'potentially_excessive' | 'excessive' | 'scope_unrestricted' | 'rbac_limited' | 'insufficient_data';
export function evaluateLeastPrivilege(inp: { role: string; usageKnown: boolean; usedRecently: boolean | null; scopeRestricted: boolean | null; rbacGranular: boolean }): { result: LeastPrivilege; note: string } {
  if (!inp.rbacGranular) {
    // 세분 권한 없음 — 넓어 보인다는 이유만으로 오남용 단정 안 함
    if (inp.role === 'admin') return { result: 'rbac_limited', note: '단일 admin role — 축소 불가(구조 한계), 오남용 단정 아님' };
    return { result: 'appropriate', note: '일반 role' };
  }
  if (inp.scopeRestricted === false) return { result: 'scope_unrestricted', note: 'scope 제한 없음' };
  if (!inp.usageKnown || inp.usedRecently === null) return { result: 'insufficient_data', note: '사용 이력 미확인' };
  if (!inp.usedRecently) return { result: 'potentially_excessive', note: '장기 미사용 권한' };
  return { result: 'appropriate', note: '' };
}

/* ── Segregation of Duties ──────────────────────────────────────────────── */
export type SodResult = 'no_known_conflict' | 'potential_conflict' | 'conflict' | 'critical_conflict' | 'insufficient_data';
export interface SodInput { creatorId: string | null; reviewerId: string | null; approverId: string | null; ownerId: string | null; executorId?: string | null; financial?: boolean }
export function detectSegregationConflict(inp: SodInput): { result: SodResult; conflicts: string[]; note: string } {
  const note = 'no_known_conflict 는 충돌 부재 보장이 아니라 현재 Evidence 미확인이라는 뜻';
  const ids = [inp.creatorId, inp.reviewerId, inp.approverId, inp.ownerId].filter(Boolean);
  if (!ids.length) return { result: 'insufficient_data', conflicts: [], note };
  const conflicts: string[] = [];
  const same = (a: string | null | undefined, b: string | null | undefined) => a && b && a === b;
  if (same(inp.creatorId, inp.reviewerId)) conflicts.push('Creator=Reviewer');
  if (same(inp.reviewerId, inp.approverId)) conflicts.push('Reviewer=Approver');
  if (same(inp.ownerId, inp.approverId)) conflicts.push('Owner=Approver');
  if (same(inp.executorId, inp.approverId)) conflicts.push('Executor=Approver');
  if (same(inp.creatorId, inp.approverId)) conflicts.push('Creator=Approver(자기 승인)');
  if (!conflicts.length) return { result: 'no_known_conflict', conflicts, note };
  if (inp.financial && conflicts.length > 0) return { result: 'critical_conflict', conflicts, note: `${note} · 정산/지급 관련 충돌` };
  if (conflicts.length >= 2) return { result: 'conflict', conflicts, note };
  return { result: 'potential_conflict', conflicts, note };
}

/* ── Access Review ──────────────────────────────────────────────────────── */
export const REVIEW_TYPES = ['periodic', 'privileged_access', 'dormant_account', 'role_change', 'scope_review', 'sensitive_data_access', 'segregation_of_duties', 'emergency_access', 'manual'];
export const REVIEW_STATUSES = ['draft', 'pending_review', 'waiting_evidence', 'approved_reference', 'reduction_recommended', 'revocation_recommended', 'rejected', 'cancelled', 'expired', 'invalidated'];
export const FORBIDDEN_REVIEW_STATUSES = ['role_changed', 'account_disabled', 'permission_revoked', 'auto_approved'];
export function validateAccessReview(r: { review_code?: unknown; subject_user_id?: unknown; review_type?: unknown; evidence?: unknown; idempotency_key?: unknown; reviewerIsSubject?: boolean } | null): { errors: string[]; warnings: string[] } {
  if (!r) return { errors: ['review 없음'], warnings: [] };
  const errors: string[] = []; const warnings: string[] = [];
  if (!r.review_code) errors.push('review_code 필수');
  if (!r.subject_user_id) errors.push('subject_user_id 필수(실존 검증은 서버)');
  if (!REVIEW_TYPES.includes(r.review_type as string)) errors.push('review_type whitelist 위반');
  if (!Array.isArray(r.evidence) || r.evidence.length === 0) errors.push('evidence 필수');
  if (!r.idempotency_key) errors.push('idempotency_key 필수');
  if (r.reviewerIsSubject) warnings.push('Self Review — Reviewer 가 Subject 본인(단일 관리자 구조 한계)');
  return { errors, warnings };
}
export type AccessRecommendationType = 'retain_access' | 'narrow_scope' | 'remove_unused_permission' | 'assign_separate_approver' | 'assign_backup_admin' | 'review_dormant_account' | 'review_sensitive_access' | 'enable_mfa_review' | 'rotate_credentials_review' | 'disable_account_reference' | 'revoke_access_reference' | 'insufficient_data';
export function buildAccessRecommendation(inp: { accountStatus: AccountStatus; riskLevel: RiskLevel; sodResult: SodResult; privileged: boolean; hasBackupAdmin: boolean; mfaKnown: boolean }): {
  type: AccessRecommendationType; reason: string; confidence: number | null; risk: string; preconditions: string[]; limitations: string[]; noExecution: true;
} {
  const base = { confidence: 60, risk: inp.riskLevel, preconditions: ['관리자 검토', '외부 IAM 수동 조치'], limitations: ['권고만 — 자동 계정/권한 변경 없음'], noExecution: true as const };
  if (inp.riskLevel === 'insufficient_data') return { ...base, type: 'insufficient_data', reason: '위험 판정 데이터 부족', confidence: null };
  if (inp.accountStatus === 'withdrawn' && inp.privileged) return { ...base, type: 'disable_account_reference', reason: '탈퇴 관리자 — 외부에서 접근 차단 확인 필요' };
  if (inp.accountStatus === 'dormant_candidate') return { ...base, type: 'review_dormant_account', reason: '휴면 후보 — 검토 필요(단정 아님)' };
  if (inp.sodResult === 'critical_conflict' || inp.sodResult === 'conflict') return { ...base, type: 'assign_separate_approver', reason: '직무 분리 충돌 — 별도 승인자 필요' };
  if (inp.privileged && !inp.hasBackupAdmin) return { ...base, type: 'assign_backup_admin', reason: '단일 관리자 — Backup admin 확보 필요' };
  if (inp.privileged && !inp.mfaKnown) return { ...base, type: 'enable_mfa_review', reason: 'MFA 상태 미확인 — 검토 필요' };
  if (inp.privileged && inp.riskLevel === 'high') return { ...base, type: 'review_sensitive_access', reason: '민감 데이터 접근 검토' };
  return { ...base, type: 'retain_access', reason: '현재 Evidence 상 유지', confidence: 50 };
}
export const EXTERNAL_ACTION_TYPES = ['account_disabled_reference', 'account_enabled_reference', 'role_changed_reference', 'scope_reduced_reference', 'permission_revoked_reference', 'password_reset_reference', 'mfa_enabled_reference', 'session_revoked_reference', 'credential_rotated_reference'];
export function validateExternalActionReference(r: { action_type?: unknown; performed_by?: unknown; performed_at?: unknown; external_system?: unknown } | null): { errors: string[]; executionNotPerformed: true } {
  const errors: string[] = [];
  if (!r) errors.push('reference 없음');
  else {
    if (!EXTERNAL_ACTION_TYPES.includes(r.action_type as string)) errors.push('action_type whitelist 위반(참고 기록 전용)');
    if (!r.performed_by) errors.push('performed_by 필수');
    if (!r.performed_at) errors.push('performed_at 필수');
    if (!r.external_system) errors.push('external_system 필수');
  }
  return { errors, executionNotPerformed: true };
}

/* ── Sensitive Data ─────────────────────────────────────────────────────── */
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'sensitive', 'highly_sensitive', 'restricted'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];
export function classifySensitiveData(inp: { isSecret: boolean; isAccountNumber: boolean; isFinancial: boolean; isContract: boolean; isPersonal: boolean }): DataClassification {
  if (inp.isSecret) return 'restricted';
  if (inp.isAccountNumber) return 'highly_sensitive';
  if (inp.isFinancial || inp.isPersonal) return 'sensitive';
  if (inp.isContract) return 'confidential';
  return 'internal';
}
export type LoggingStatus = 'logged' | 'partially_logged' | 'logging_unavailable' | 'not_applicable';
export function evaluateAccessLogging(inp: { hasSelectLog: boolean; hasRevealAudit: boolean; hasChangeAudit: boolean }): { status: LoggingStatus; note: string } {
  const note = '로그가 없어도 접근이 없었다고 단정하지 않음';
  if (inp.hasSelectLog && inp.hasChangeAudit) return { status: 'logged', note };
  if (inp.hasRevealAudit || inp.hasChangeAudit) return { status: 'partially_logged', note };
  return { status: 'logging_unavailable', note };
}

/* ── RLS / RPC Security Review(Evidence 기반) ───────────────────────────── */
export type RlsRpcResult = 'secure_by_evidence' | 'partially_secured' | 'gap_detected' | 'critical_gap' | 'not_reviewed' | 'insufficient_data';
export interface RlsRpcInput {
  reviewed: boolean; rlsEnabled: boolean | null; policyExists: boolean | null; securityDefiner: boolean;
  searchPathPinned: boolean | null; adminGuard: boolean | null; scopeGuard: boolean | null; auditLogged: boolean | null;
  publicExecutable: boolean | null; sensitiveData: boolean;
}
export function evaluateRlsRpcSecurity(inp: RlsRpcInput): { result: RlsRpcResult; gaps: string[] } {
  if (!inp.reviewed) return { result: 'not_reviewed', gaps: [] };
  const gaps: string[] = [];
  if (inp.rlsEnabled === false) gaps.push('RLS 비활성');
  if (inp.policyExists === false) gaps.push('Policy 없음');
  if (inp.securityDefiner && inp.searchPathPinned === false) gaps.push('SECURITY DEFINER search_path 미고정');
  if (inp.adminGuard === false) gaps.push('Admin Guard 없음');
  if (inp.scopeGuard === false) gaps.push('Scope Guard 없음');
  if (inp.auditLogged === false) gaps.push('Audit 없음');
  if (inp.publicExecutable === true) gaps.push('public 실행 가능');
  // Critical: 민감 데이터 + (RLS 비활성 / guard 없는 public / search_path 미고정)
  if (inp.sensitiveData && (inp.rlsEnabled === false || (inp.publicExecutable === true && inp.adminGuard === false) || (inp.securityDefiner && inp.searchPathPinned === false))) {
    return { result: 'critical_gap', gaps };
  }
  if (gaps.length >= 2) return { result: 'gap_detected', gaps };
  if (gaps.length === 1) return { result: 'partially_secured', gaps };
  if (inp.rlsEnabled === null && inp.adminGuard === null) return { result: 'insufficient_data', gaps };
  return { result: 'secure_by_evidence', gaps }; // 보장 아님 — Evidence 기준
}

/* ── Audit Completeness(누락을 정상으로 계산 금지) ──────────────────────── */
export type AuditCompleteness = 'complete' | 'sufficient' | 'partial' | 'critical_gap' | 'logging_unavailable' | 'insufficient_data';
export function calculateAuditCompleteness(inp: { auditedAreas: number | null; totalAreas: number; criticalUnaudited: number }): { result: AuditCompleteness; coveragePct: number | null } {
  if (inp.auditedAreas === null || inp.totalAreas <= 0) return { result: 'insufficient_data', coveragePct: null };
  if (inp.auditedAreas === 0) return { result: 'logging_unavailable', coveragePct: 0 };
  const pct = Math.round((inp.auditedAreas / inp.totalAreas) * 1000) / 10;
  if (inp.criticalUnaudited > 0) return { result: 'critical_gap', coveragePct: pct };
  if (pct >= 99) return { result: 'complete', coveragePct: pct };
  if (pct >= 80) return { result: 'sufficient', coveragePct: pct };
  return { result: 'partial', coveragePct: pct };
}

/* ── Privacy Request ────────────────────────────────────────────────────── */
export const PRIVACY_REQUEST_TYPES = ['access', 'correction', 'deletion', 'restriction', 'export', 'consent_withdrawal', 'objection', 'manual'];
export const PRIVACY_STATUSES = ['new', 'identity_verification_required', 'verified', 'reviewing', 'waiting_legal_review', 'waiting_external_action', 'completed_reference', 'partially_completed_reference', 'rejected', 'cancelled', 'expired', 'invalidated'];
export const PRIVACY_ACTION_TYPES = ['data_exported_reference', 'profile_corrected_reference', 'account_deleted_reference', 'personal_data_deleted_reference', 'access_restricted_reference', 'consent_withdrawn_reference', 'request_rejected_reference'];
export function validatePrivacyRequest(r: { request_code?: unknown; request_type?: unknown; evidence?: unknown } | null): string[] {
  if (!r) return ['request 없음'];
  const errors: string[] = [];
  if (!r.request_code) errors.push('request_code 필수');
  if (!PRIVACY_REQUEST_TYPES.includes(r.request_type as string)) errors.push('request_type whitelist 위반');
  if (!Array.isArray(r.evidence) || r.evidence.length === 0) errors.push('evidence 필수');
  return errors;
}
export function validatePrivacyActionReference(r: { action_type?: unknown; performed_by?: unknown; performed_at?: unknown } | null): { errors: string[]; deletionReferenceOnly: true } {
  const errors: string[] = [];
  if (!r) errors.push('reference 없음');
  else {
    if (!PRIVACY_ACTION_TYPES.includes(r.action_type as string)) errors.push('action_type whitelist 위반(참고 기록 전용 — 자동 처리 아님)');
    if (!r.performed_by) errors.push('performed_by 필수');
    if (!r.performed_at) errors.push('performed_at 필수');
  }
  return { errors, deletionReferenceOnly: true };
}
export function canMarkPrivacyCompleted(hasExternalReference: boolean): { allowed: boolean; note: string } {
  return hasExternalReference
    ? { allowed: true, note: '외부 조치 Reference 확인 — completed_reference 는 자동 처리 완료가 아님' }
    : { allowed: false, note: '외부 조치 Reference 없이 완료 표시 금지(실제 삭제/처리 없음)' };
}

/* ── Retention ──────────────────────────────────────────────────────────── */
export type RetentionResult = 'compliant' | 'review_required' | 'overdue_candidate' | 'legal_hold' | 'policy_not_defined' | 'deletion_unsupported' | 'insufficient_data';
export function evaluateRetentionCompliance(inp: { policyDefined: boolean; retentionDays: number | null; dataAgeDays: number | null; legalHold: boolean }): { result: RetentionResult; note: string } {
  if (!inp.policyDefined) return { result: 'policy_not_defined', note: '보존 정책 미정의 — 위반으로 계산하지 않음(법적 기간 임의 생성 없음)' };
  if (inp.legalHold) return { result: 'legal_hold', note: '법적 보존 의무' };
  if (!isFiniteNumber(inp.retentionDays) || !isFiniteNumber(inp.dataAgeDays)) return { result: 'insufficient_data', note: '기간 데이터 부족' };
  if (inp.dataAgeDays > inp.retentionDays) return { result: 'overdue_candidate', note: '보존기간 초과 후보 — 삭제는 미지원(deletion_reference_only), 근거만 제시' };
  if (inp.dataAgeDays > inp.retentionDays * 0.9) return { result: 'review_required', note: '보존기간 임박' };
  return { result: 'compliant', note: '' };
}
export function validateRetentionPolicy(p: { policy_code?: unknown; data_domain?: unknown; legal_basis?: unknown; change_reason?: unknown; version?: unknown; effective_from?: unknown } | null, evaluationPeriod?: { start: string; end: string }): string[] {
  if (!p) return ['policy 없음'];
  const errors: string[] = [];
  if (!p.policy_code) errors.push('policy_code 필수');
  if (!p.legal_basis) errors.push('legal_basis 필수 — 법적 근거 없는 보존기간 생성 금지');
  if (!p.change_reason) errors.push('change_reason 필수(AI 직접 변경 금지)');
  if (evaluationPeriod && p.effective_from) {
    const from = Date.parse(String(p.effective_from));
    if (Number.isFinite(from) && Date.parse(evaluationPeriod.start) < from) errors.push('과거 기간에 현재 Policy 소급 적용 금지');
  }
  return errors;
}

/* ── Security Risk(재정규화 · Critical 우선 · 자동 차단 없음) ───────────── */
export interface SecurityRiskComponents {
  privilegedAccountRisk: number | null; rbacLimitation: number | null; dormantCandidates: number | null;
  scopeRestriction: number | null; sensitiveAccess: number | null; segregationConflict: number | null;
  rlsGap: number | null; rpcGuardGap: number | null; auditGap: number | null; mfaUnknown: number | null;
  singleAdminRisk: number | null; privacyGap: number | null; retentionGap: number | null; incidentLoad: number | null;
}
export interface SecurityCriticalContext { publicSensitiveData: boolean; unguardedPayoutMutation: boolean; secretExposure: boolean; unauthorizedProductionMutation: boolean; criticalRlsGap: boolean; unauditedPayoutChange: boolean; withdrawnAdminAccess: boolean }
export function calculateSecurityRisk(c: SecurityRiskComponents, ctx: SecurityCriticalContext): { score: number | null; level: RiskLevel; reasons: string[]; noAutoBlock: true } {
  const criticals: string[] = [];
  if (ctx.publicSensitiveData) criticals.push('공개 접근 가능한 민감 데이터');
  if (ctx.unguardedPayoutMutation) criticals.push('Guard 없는 지급/정산 변경');
  if (ctx.secretExposure) criticals.push('Secret 노출');
  if (ctx.unauthorizedProductionMutation) criticals.push('무권한 Production Mutation 가능');
  if (ctx.criticalRlsGap) criticals.push('critical RLS gap');
  if (ctx.unauditedPayoutChange) criticals.push('Audit 없는 지급 변경');
  if (ctx.withdrawnAdminAccess) criticals.push('탈퇴 관리자 접근 가능');
  const weights: Record<keyof SecurityRiskComponents, number> = {
    privilegedAccountRisk: 10, rbacLimitation: 7, dormantCandidates: 6, scopeRestriction: 7, sensitiveAccess: 9,
    segregationConflict: 8, rlsGap: 9, rpcGuardGap: 9, auditGap: 7, mfaUnknown: 5, singleAdminRisk: 8, privacyGap: 6, retentionGap: 5, incidentLoad: 4,
  };
  const comps = (Object.keys(weights) as Array<keyof SecurityRiskComponents>).map((k) => ({ key: k as string, value: c[k], weight: weights[k] }));
  const base = normalizeAvailableComponents(comps);
  if (criticals.length > 0) return { score: base.score, level: 'critical', reasons: [...criticals, '자동 차단/자동 조치 없음'], noAutoBlock: true };
  if (base.score === null) return { score: null, level: 'insufficient_data', reasons: ['성분 데이터 없음'], noAutoBlock: true };
  const level: RiskLevel = base.score >= 75 ? 'critical' : base.score >= 50 ? 'high' : base.score >= 25 ? 'moderate' : 'low';
  return { score: base.score, level, reasons: [], noAutoBlock: true };
}

/* ── Incident Correlation(공격/유출 단정 없음) ──────────────────────────── */
export type SecCorrelation = 'temporally_correlated' | 'scope_correlated' | 'possibly_related' | 'unrelated' | 'insufficient_data';
export function correlateSecurityIncident(event: { occurredAt: string | null; scopeKeys: string[] }, incident: { detectedAt: string | null; scopeKeys: string[]; windowHours?: number }): { correlation: SecCorrelation; note: string } {
  const note = '상관 표기일 뿐 — 공격/유출 원인으로 단정하지 않음';
  if (!event.occurredAt || !incident.detectedAt) return { correlation: 'insufficient_data', note };
  const e = Date.parse(event.occurredAt); const i = Date.parse(incident.detectedAt);
  if (!Number.isFinite(e) || !Number.isFinite(i)) return { correlation: 'insufficient_data', note };
  const timeMatch = Math.abs(e - i) <= (incident.windowHours ?? 24) * 3600_000;
  const scopeMatch = event.scopeKeys.some((k) => incident.scopeKeys.includes(k));
  const correlation: SecCorrelation = timeMatch && scopeMatch ? 'possibly_related' : timeMatch ? 'temporally_correlated' : scopeMatch ? 'scope_correlated' : 'unrelated';
  return { correlation, note };
}

/* ── Compliance ─────────────────────────────────────────────────────────── */
export type ControlStatus = 'operating' | 'partially_operating' | 'design_only' | 'gap_detected' | 'not_applicable' | 'not_reviewed' | 'insufficient_data';
export function calculateComplianceControlStatus(inp: { reviewed: boolean; evidenceCount: number; gapsFound: number; designedOnly: boolean }): ControlStatus {
  if (!inp.reviewed) return 'not_reviewed';
  if (inp.evidenceCount === 0) return 'insufficient_data'; // Evidence 없는 operating 금지
  if (inp.gapsFound > 0) return 'gap_detected';
  if (inp.designedOnly) return 'design_only';
  return 'operating';
}
export function buildComplianceEvidencePackage(inp: {
  identityCount: number | null; privilegedCount: number | null; roleInventory: string[]; accessReviews: number;
  segregationConflicts: number; sensitiveDataItems: number; rlsRpcSummary: string; privacyRequests: number;
  retentionPolicies: number; auditCompleteness: AuditCompleteness; securityEvents: number; externalActionReferences: number;
  openGaps: string[]; riskLevel: RiskLevel; humanDecisions: number;
}): Array<{ section: string; content: unknown }> {
  return [
    { section: 'Package Type', content: '내부 검토용 Evidence Package — ISO 27001/SOC 2/ISMS 등 공식 인증 아님' },
    { section: 'Identity Inventory', content: inp.identityCount ?? 'insufficient_data' },
    { section: 'Privileged Accounts', content: inp.privilegedCount ?? 'insufficient_data' },
    { section: 'Role Inventory', content: inp.roleInventory },
    { section: 'Access Reviews', content: inp.accessReviews },
    { section: 'Segregation Conflicts', content: inp.segregationConflicts },
    { section: 'Sensitive Data Inventory', content: inp.sensitiveDataItems },
    { section: 'RLS / RPC Review', content: inp.rlsRpcSummary },
    { section: 'Privacy Requests', content: inp.privacyRequests },
    { section: 'Retention Policies', content: inp.retentionPolicies },
    { section: 'Audit Completeness', content: inp.auditCompleteness },
    { section: 'Security Events', content: inp.securityEvents },
    { section: 'External Action References', content: inp.externalActionReferences },
    { section: 'Open Gaps', content: inp.openGaps },
    { section: 'Risk Summary', content: inp.riskLevel },
    { section: 'Human Decisions', content: inp.humanDecisions },
    { section: 'Limitations', content: ['단일 admin role(rbac_limited)', '로그인/SELECT 로그 부족(logging_unavailable)', 'MFA 확인 불가', '자동 조치 없음(manual_action_required)'] },
  ];
}

/* ── Security Recommendation ────────────────────────────────────────────── */
export type SecurityRecommendationType = 'review_privileged_account' | 'narrow_admin_scope' | 'separate_reviewer_approver' | 'assign_backup_admin' | 'review_dormant_account' | 'enable_mfa_review' | 'add_access_logging' | 'add_rls_policy_review' | 'add_rpc_guard_review' | 'define_retention_policy' | 'review_privacy_request' | 'rotate_secret_reference' | 'remove_unused_access_reference' | 'create_security_work_item' | 'insufficient_data';
export function buildSecurityRecommendation(inp: { singleAdmin: boolean; mfaKnown: boolean; loggingGaps: number; retentionPolicies: number; openPrivacyRequests: number; sodConflicts: number; dormantCandidates: number }): Array<{ type: SecurityRecommendationType; reason: string; severity: string; noExecution: true }> {
  const out: Array<{ type: SecurityRecommendationType; reason: string; severity: string; noExecution: true }> = [];
  const add = (type: SecurityRecommendationType, reason: string, severity: string) => out.push({ type, reason, severity, noExecution: true });
  if (inp.singleAdmin) add('assign_backup_admin', '활성 관리자 1명 — Backup admin 확보 필요', 'high');
  if (inp.sodConflicts > 0) add('separate_reviewer_approver', `직무 분리 충돌 ${inp.sodConflicts}건`, 'high');
  if (!inp.mfaKnown) add('enable_mfa_review', 'MFA 상태 미확인 — 검토 필요', 'medium');
  if (inp.loggingGaps > 0) add('add_access_logging', `민감 데이터 조회 로그 공백 ${inp.loggingGaps}건`, 'medium');
  if (inp.retentionPolicies === 0) add('define_retention_policy', '승인된 보존 정책 없음(policy_not_defined)', 'medium');
  if (inp.openPrivacyRequests > 0) add('review_privacy_request', `미처리 Privacy Request ${inp.openPrivacyRequests}건`, 'medium');
  if (inp.dormantCandidates > 0) add('review_dormant_account', `휴면 후보 ${inp.dormantCandidates}건(단정 아님)`, 'low');
  if (!out.length) add('insufficient_data', '권고 대상 신호 없음', 'informational');
  return out;
}

/* ── UI 톤 ──────────────────────────────────────────────────────────────── */
export const RISK_TONE: Record<RiskLevel, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { low: 'success', moderate: 'info', high: 'warning', critical: 'danger', insufficient_data: 'neutral' };
export const ACCT_TONE: Record<AccountStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = { active: 'success', inactive: 'neutral', withdrawn: 'danger', locked_reference: 'warning', dormant_candidate: 'warning', service_account: 'info', unknown: 'neutral', insufficient_data: 'neutral' };

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export const SEC_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'identity_inventory', label: 'Identity Inventory', status: 'partially_supported', note: '실시간 조회 · 이메일 마스킹 · 원본 미복제' },
  { key: 'account_status', label: 'Account Status', status: 'partially_supported', note: '로그인 이력 없으면 unknown(휴면 단정 없음)' },
  { key: 'role_inventory', label: 'Role Inventory', status: 'rbac_limited', note: 'user/admin 2종 — 세분 RBAC 없음' },
  { key: 'permission_inventory', label: 'Permission Inventory', status: 'evidence_only', note: '직접 Permission 시스템 없음 — RLS/RPC/Role Evidence 만' },
  { key: 'privileged_accounts', label: 'Privileged Accounts', status: 'partially_supported', note: 'admin role 기준' },
  { key: 'access_risk', label: 'Access Risk', status: 'partially_supported', note: '재정규화 · 자동 조치 없음' },
  { key: 'least_privilege', label: 'Least Privilege', status: 'rbac_limited', note: '단일 role 로 축소 불가 — 구조 한계 정직 표시' },
  { key: 'segregation_of_duties', label: 'Segregation of Duties', status: 'partially_supported', note: '단일 관리자 구조 충돌 정직 표시 · 자동 차단 없음' },
  { key: 'access_review', label: 'Access Review', status: 'fully_supported', note: '검토/권고 기록 · 실제 권한 변경 상태 없음' },
  { key: 'external_access_action', label: 'External Access Action', status: 'evidence_only', note: '외부 수행 Reference 만' },
  { key: 'sensitive_data_registry', label: 'Sensitive Data Registry', status: 'fully_supported', note: 'Metadata 만 · Secret 값 저장 금지' },
  { key: 'data_classification', label: 'Data Classification', status: 'fully_supported', note: '6단계 · 실제 컬럼 기반 seed 9건' },
  { key: 'access_logging', label: 'Access Logging', status: 'logging_unavailable', note: '계좌 열람(0061)만 부분 기록 — SELECT/로그인 로그 없음' },
  { key: 'rls_review', label: 'RLS Review', status: 'partially_supported', note: '코드 분석 Evidence — DB 적용 상태와 구분 표시' },
  { key: 'rpc_security_review', label: 'RPC Security Review', status: 'partially_supported', note: 'guard/search_path 패턴 Evidence 기반' },
  { key: 'privacy_request', label: 'Privacy Request', status: 'deletion_reference_only', note: '접수/추적 — 삭제는 외부 수동+Reference' },
  { key: 'privacy_action_reference', label: 'Privacy Action Reference', status: 'evidence_only', note: 'Reference 없이 완료 표시 차단(서버 게이트)' },
  { key: 'retention_policy', label: 'Retention Policy', status: 'insufficient_data', note: 'seed 0건 — 법적 근거와 함께 관리자 입력 필요' },
  { key: 'retention_validation', label: 'Retention Validation', status: 'partially_supported', note: '정책 없으면 policy_not_defined(위반 계산 없음)' },
  { key: 'consent_evidence', label: 'Consent Evidence', status: 'unsupported', note: '전용 동의 기록 테이블 미확인' },
  { key: 'audit_completeness', label: 'Audit Completeness', status: 'partially_supported', note: 'AI 운영 audit 체인 기준 — 로그인/SELECT 제외' },
  { key: 'compliance_controls', label: 'Compliance Controls', status: 'partially_supported', note: 'seed 6건 not_reviewed — Evidence 없는 operating 금지' },
  { key: 'compliance_evidence_package', label: 'Compliance Evidence Package', status: 'evidence_only', note: '내부 검토용 — 공식 인증 아님' },
  { key: 'incident_correlation', label: 'Security Incident Correlation', status: 'partially_supported', note: '상관만 — 공격/유출 단정 없음' },
  { key: 'security_risk', label: 'Security Risk', status: 'partially_supported', note: '재정규화 · Critical 우선 · 자동 차단 없음' },
  { key: 'security_recommendation', label: 'Security Recommendation', status: 'fully_supported', note: '권고만' },
  { key: 'automatic_account_disable', label: 'Automatic Account Disable', status: 'unsupported', note: '금지 — manual_action_required' },
  { key: 'automatic_role_change', label: 'Automatic Role Change', status: 'unsupported', note: '금지' },
  { key: 'automatic_permission_revocation', label: 'Automatic Permission Revocation', status: 'unsupported', note: '금지' },
  { key: 'automatic_data_deletion', label: 'Automatic Data Deletion', status: 'unsupported', note: '금지 — deletion_reference_only' },
  { key: 'automatic_compliance_certification', label: 'Automatic Compliance Certification', status: 'unsupported', note: '금지 — 공식 인증 주장 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];
