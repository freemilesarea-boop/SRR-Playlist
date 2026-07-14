// Phase AI-OPS-7 — Security Governance 순수 로직 단위 테스트.
// Identity(로그인 이력 없으면 단정 없음) · Role(실제 2종/rbac_limited) · Access Risk(재정규화) ·
// Least Privilege · SoD(단일 관리자 정직 표시) · Access Review(자동 변경 없음) ·
// Sensitive Data(Secret 저장 금지) · RLS/RPC(critical gap) · Privacy(실제 삭제 없음) ·
// Retention(소급 없음) · Audit(누락≠정상) · Security Risk(Critical 우선) · Compliance(인증 주장 없음).
import { describe, it, expect } from 'vitest';
import {
  classifyAccountStatus, ACTUAL_ROLES, calculateAccessRisk, classifyPrivilegedAccount,
  evaluateLeastPrivilege, detectSegregationConflict, validateAccessReview, buildAccessRecommendation,
  validateExternalActionReference, classifySensitiveData, evaluateAccessLogging, evaluateRlsRpcSecurity,
  calculateAuditCompleteness, validatePrivacyRequest, validatePrivacyActionReference, canMarkPrivacyCompleted,
  evaluateRetentionCompliance, validateRetentionPolicy, calculateSecurityRisk, correlateSecurityIncident,
  calculateComplianceControlStatus, buildComplianceEvidencePackage, buildSecurityRecommendation,
  REVIEW_STATUSES, FORBIDDEN_REVIEW_STATUSES, SEC_SUPPORT, SECURITY_DOMAINS,
  type AccessRiskComponents, type SecurityRiskComponents, type SecurityCriticalContext,
} from './securityGovernance';

const NOW = new Date('2026-07-14T12:00:00Z');

describe('Identity / Account Status', () => {
  it('Active / Withdrawn / Dormant Candidate / Service / Unknown(로그인 이력 없음 단정 금지)', () => {
    expect(classifyAccountStatus({ exists: true, withdrawn: false, lastSignInAt: '2026-07-10T00:00:00Z', now: NOW }).status).toBe('active');
    expect(classifyAccountStatus({ exists: true, withdrawn: true, lastSignInAt: null, now: NOW }).status).toBe('withdrawn');
    const dormant = classifyAccountStatus({ exists: true, withdrawn: false, lastSignInAt: '2026-01-01T00:00:00Z', now: NOW });
    expect(dormant.status).toBe('dormant_candidate');
    expect(dormant.note).toContain('비활성화 상태 아님');
    const unknown = classifyAccountStatus({ exists: true, withdrawn: false, lastSignInAt: null, now: NOW });
    expect(unknown.status).toBe('unknown');
    expect(unknown.note).toContain('단정하지 않음');
    expect(classifyAccountStatus({ exists: true, withdrawn: false, lastSignInAt: null, isServiceAccount: true, now: NOW }).status).toBe('service_account');
    expect(classifyAccountStatus({ exists: false, withdrawn: false, lastSignInAt: null, now: NOW }).status).toBe('insufficient_data');
  });
  it('실제 Role whitelist 는 user/admin 2종(rbac_limited)', () => {
    expect(ACTUAL_ROLES).toEqual(['user', 'admin']);
    expect(SECURITY_DOMAINS.find((d) => d.domain === 'authorization')!.status).toBe('rbac_limited');
  });
});

describe('Access Risk / Privileged / Least Privilege', () => {
  const C = (v: number | null): AccessRiskComponents => ({ privilegedRole: v, rbacLimitation: v, dormantRisk: v, withdrawnAccessRisk: v, selfApprovalRisk: v, scopeUnrestricted: v, sensitiveAccess: v, auditGap: v, mfaUnknown: v, singleAdminRisk: v });
  it('Low~Critical · 재정규화 · Insufficient · 자동 조치 없음', () => {
    expect(calculateAccessRisk(C(10)).level).toBe('low');
    expect(calculateAccessRisk(C(40)).level).toBe('moderate');
    expect(calculateAccessRisk(C(60)).level).toBe('high');
    expect(calculateAccessRisk(C(90)).level).toBe('critical');
    const partial = calculateAccessRisk({ ...C(50), mfaUnknown: null, auditGap: null });
    expect(partial.score).toBe(50); expect(partial.missing.length).toBe(2);
    expect(calculateAccessRisk(C(null)).level).toBe('insufficient_data');
    expect(calculateAccessRisk(C(90)).noAutoAction).toBe(true);
  });
  it('Privileged — admin role 만 · Least Privilege rbac_limited(오남용 단정 없음)', () => {
    expect(classifyPrivilegedAccount({ role: 'admin', isActive: true }).privileged).toBe(true);
    expect(classifyPrivilegedAccount({ role: 'user', isActive: true }).privileged).toBe(false);
    const lp = evaluateLeastPrivilege({ role: 'admin', usageKnown: false, usedRecently: null, scopeRestricted: null, rbacGranular: false });
    expect(lp.result).toBe('rbac_limited');
    expect(lp.note).toContain('단정 아님');
    expect(evaluateLeastPrivilege({ role: 'x', usageKnown: true, usedRecently: false, scopeRestricted: true, rbacGranular: true }).result).toBe('potentially_excessive');
    expect(evaluateLeastPrivilege({ role: 'x', usageKnown: true, usedRecently: true, scopeRestricted: false, rbacGranular: true }).result).toBe('scope_unrestricted');
    expect(evaluateLeastPrivilege({ role: 'x', usageKnown: false, usedRecently: null, scopeRestricted: true, rbacGranular: true }).result).toBe('insufficient_data');
  });
});

describe('Segregation of Duties', () => {
  it('Creator/Reviewer/Owner/Approver 충돌 · 정산 충돌은 critical · 문구', () => {
    expect(detectSegregationConflict({ creatorId: 'a', reviewerId: 'b', approverId: 'c', ownerId: 'd' }).result).toBe('no_known_conflict');
    expect(detectSegregationConflict({ creatorId: 'a', reviewerId: 'a', approverId: 'b', ownerId: 'c' }).result).toBe('potential_conflict');
    expect(detectSegregationConflict({ creatorId: 'a', reviewerId: 'a', approverId: 'a', ownerId: 'c' }).result).toBe('conflict');
    expect(detectSegregationConflict({ creatorId: 'a', reviewerId: 'b', approverId: 'a', ownerId: 'c', financial: true }).result).toBe('critical_conflict');
    expect(detectSegregationConflict({ creatorId: null, reviewerId: null, approverId: null, ownerId: null }).result).toBe('insufficient_data');
    expect(detectSegregationConflict({ creatorId: 'a', reviewerId: 'b', approverId: 'c', ownerId: 'd' }).note).toContain('미확인');
  });
});

describe('Access Review / Recommendation / External Reference', () => {
  it('필수 필드 · Self Review 경고 · 금지 상태 미포함', () => {
    expect(validateAccessReview({ review_code: 'r', subject_user_id: 'u', review_type: 'periodic', evidence: [1], idempotency_key: 'k' }).errors).toEqual([]);
    expect(validateAccessReview({ review_code: 'r', subject_user_id: 'u', review_type: 'auto', evidence: [1], idempotency_key: 'k' }).errors.some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateAccessReview({ review_code: 'r', subject_user_id: 'u', review_type: 'periodic', evidence: [1], idempotency_key: 'k', reviewerIsSubject: true }).warnings[0]).toContain('Self Review');
    for (const f of FORBIDDEN_REVIEW_STATUSES) expect(REVIEW_STATUSES).not.toContain(f);
  });
  it('Recommendation — 탈퇴 관리자/휴면/SoD/Backup/MFA · 자동 실행 없음', () => {
    const base = { accountStatus: 'active' as const, riskLevel: 'low' as const, sodResult: 'no_known_conflict' as const, privileged: true, hasBackupAdmin: true, mfaKnown: true };
    expect(buildAccessRecommendation(base).type).toBe('retain_access');
    expect(buildAccessRecommendation({ ...base, accountStatus: 'withdrawn' }).type).toBe('disable_account_reference');
    expect(buildAccessRecommendation({ ...base, accountStatus: 'dormant_candidate' }).type).toBe('review_dormant_account');
    expect(buildAccessRecommendation({ ...base, sodResult: 'critical_conflict' }).type).toBe('assign_separate_approver');
    expect(buildAccessRecommendation({ ...base, hasBackupAdmin: false }).type).toBe('assign_backup_admin');
    expect(buildAccessRecommendation({ ...base, mfaKnown: false }).type).toBe('enable_mfa_review');
    expect(buildAccessRecommendation({ ...base, riskLevel: 'insufficient_data' }).type).toBe('insufficient_data');
    expect(buildAccessRecommendation(base).noExecution).toBe(true);
  });
  it('External Action Reference — whitelist + 필수 필드 · 실행 아님', () => {
    const ok = validateExternalActionReference({ action_type: 'account_disabled_reference', performed_by: 'ops', performed_at: 't', external_system: 'supabase_dashboard' });
    expect(ok.errors).toEqual([]); expect(ok.executionNotPerformed).toBe(true);
    expect(validateExternalActionReference({ action_type: 'account_disable', performed_by: 'x', performed_at: 't', external_system: 's' }).errors.some((e) => e.includes('whitelist'))).toBe(true);
    expect(validateExternalActionReference(null).errors.length).toBe(1);
  });
});

describe('Sensitive Data / Logging', () => {
  it('분류 6단계 — Secret restricted · 계좌 highly_sensitive · 개인정보 sensitive · 계약 confidential', () => {
    expect(classifySensitiveData({ isSecret: true, isAccountNumber: false, isFinancial: false, isContract: false, isPersonal: false })).toBe('restricted');
    expect(classifySensitiveData({ isSecret: false, isAccountNumber: true, isFinancial: true, isContract: false, isPersonal: false })).toBe('highly_sensitive');
    expect(classifySensitiveData({ isSecret: false, isAccountNumber: false, isFinancial: true, isContract: false, isPersonal: false })).toBe('sensitive');
    expect(classifySensitiveData({ isSecret: false, isAccountNumber: false, isFinancial: false, isContract: true, isPersonal: false })).toBe('confidential');
    expect(classifySensitiveData({ isSecret: false, isAccountNumber: false, isFinancial: false, isContract: false, isPersonal: false })).toBe('internal');
  });
  it('Access Logging — 로그 없어도 접근 없음 단정 금지', () => {
    expect(evaluateAccessLogging({ hasSelectLog: true, hasRevealAudit: true, hasChangeAudit: true }).status).toBe('logged');
    expect(evaluateAccessLogging({ hasSelectLog: false, hasRevealAudit: true, hasChangeAudit: false }).status).toBe('partially_logged');
    const r = evaluateAccessLogging({ hasSelectLog: false, hasRevealAudit: false, hasChangeAudit: false });
    expect(r.status).toBe('logging_unavailable');
    expect(r.note).toContain('단정하지 않음');
  });
});

describe('RLS / RPC Security Review', () => {
  const OK = { reviewed: true, rlsEnabled: true, policyExists: true, securityDefiner: true, searchPathPinned: true, adminGuard: true, scopeGuard: true, auditLogged: true, publicExecutable: false, sensitiveData: true };
  it('secure_by_evidence / partial / gap / critical / not_reviewed', () => {
    expect(evaluateRlsRpcSecurity(OK).result).toBe('secure_by_evidence');
    expect(evaluateRlsRpcSecurity({ ...OK, auditLogged: false }).result).toBe('partially_secured');
    expect(evaluateRlsRpcSecurity({ ...OK, auditLogged: false, scopeGuard: false }).result).toBe('gap_detected');
    expect(evaluateRlsRpcSecurity({ ...OK, rlsEnabled: false }).result).toBe('critical_gap');           // 민감 데이터 + RLS 비활성
    expect(evaluateRlsRpcSecurity({ ...OK, searchPathPinned: false }).result).toBe('critical_gap');     // search_path 미고정 SECURITY DEFINER
    expect(evaluateRlsRpcSecurity({ ...OK, publicExecutable: true, adminGuard: false }).result).toBe('critical_gap');
    expect(evaluateRlsRpcSecurity({ ...OK, reviewed: false }).result).toBe('not_reviewed');
  });
});

describe('Privacy / Retention / Audit', () => {
  it('Privacy Request 검증 · Reference 없이 완료 표시 금지 · 실제 삭제 없음', () => {
    expect(validatePrivacyRequest({ request_code: 'p', request_type: 'deletion', evidence: [1] })).toEqual([]);
    expect(validatePrivacyRequest({ request_code: 'p', request_type: 'purge_all', evidence: [1] }).some((e) => e.includes('whitelist'))).toBe(true);
    const ref = validatePrivacyActionReference({ action_type: 'personal_data_deleted_reference', performed_by: 'ops', performed_at: 't' });
    expect(ref.errors).toEqual([]); expect(ref.deletionReferenceOnly).toBe(true);
    expect(canMarkPrivacyCompleted(false).allowed).toBe(false);
    expect(canMarkPrivacyCompleted(true).note).toContain('자동 처리 완료가 아님');
  });
  it('Retention — policy_not_defined(위반 계산 없음)/legal_hold/overdue candidate/소급 금지', () => {
    expect(evaluateRetentionCompliance({ policyDefined: false, retentionDays: null, dataAgeDays: 100, legalHold: false }).result).toBe('policy_not_defined');
    expect(evaluateRetentionCompliance({ policyDefined: true, retentionDays: 365, dataAgeDays: 100, legalHold: true }).result).toBe('legal_hold');
    const overdue = evaluateRetentionCompliance({ policyDefined: true, retentionDays: 365, dataAgeDays: 400, legalHold: false });
    expect(overdue.result).toBe('overdue_candidate');
    expect(overdue.note).toContain('deletion_reference_only');
    expect(evaluateRetentionCompliance({ policyDefined: true, retentionDays: 365, dataAgeDays: 100, legalHold: false }).result).toBe('compliant');
    expect(evaluateRetentionCompliance({ policyDefined: true, retentionDays: null, dataAgeDays: 100, legalHold: false }).result).toBe('insufficient_data');
    expect(validateRetentionPolicy({ policy_code: 'p', data_domain: 'personal_data', legal_basis: null, change_reason: 'r' }).some((e) => e.includes('법적 근거'))).toBe(true);
    expect(validateRetentionPolicy({ policy_code: 'p', data_domain: 'personal_data', legal_basis: 'l', change_reason: 'r', effective_from: '2026-07-01' }, { start: '2026-06-01', end: '2026-06-30' }).some((e) => e.includes('소급'))).toBe(true);
  });
  it('Audit Completeness — 누락을 정상으로 계산 안 함 · logging_unavailable', () => {
    expect(calculateAuditCompleteness({ auditedAreas: 16, totalAreas: 16, criticalUnaudited: 0 }).result).toBe('complete');
    expect(calculateAuditCompleteness({ auditedAreas: 13, totalAreas: 16, criticalUnaudited: 0 }).result).toBe('sufficient');
    expect(calculateAuditCompleteness({ auditedAreas: 8, totalAreas: 16, criticalUnaudited: 0 }).result).toBe('partial');
    expect(calculateAuditCompleteness({ auditedAreas: 15, totalAreas: 16, criticalUnaudited: 1 }).result).toBe('critical_gap');
    expect(calculateAuditCompleteness({ auditedAreas: 0, totalAreas: 16, criticalUnaudited: 0 }).result).toBe('logging_unavailable');
    expect(calculateAuditCompleteness({ auditedAreas: null, totalAreas: 16, criticalUnaudited: 0 }).result).toBe('insufficient_data');
  });
});

describe('Security Risk / Correlation / Compliance', () => {
  const C = (v: number | null): SecurityRiskComponents => ({ privilegedAccountRisk: v, rbacLimitation: v, dormantCandidates: v, scopeRestriction: v, sensitiveAccess: v, segregationConflict: v, rlsGap: v, rpcGuardGap: v, auditGap: v, mfaUnknown: v, singleAdminRisk: v, privacyGap: v, retentionGap: v, incidentLoad: v });
  const CTX: SecurityCriticalContext = { publicSensitiveData: false, unguardedPayoutMutation: false, secretExposure: false, unauthorizedProductionMutation: false, criticalRlsGap: false, unauditedPayoutChange: false, withdrawnAdminAccess: false };
  it('Low~Critical · Critical 조건 우선(Secret/RLS/무권한 Mutation) · 자동 차단 없음', () => {
    expect(calculateSecurityRisk(C(10), CTX).level).toBe('low');
    expect(calculateSecurityRisk(C(60), CTX).level).toBe('high');
    expect(calculateSecurityRisk(C(5), { ...CTX, secretExposure: true }).level).toBe('critical');
    expect(calculateSecurityRisk(C(5), { ...CTX, criticalRlsGap: true }).level).toBe('critical');
    expect(calculateSecurityRisk(C(5), { ...CTX, unauthorizedProductionMutation: true }).level).toBe('critical');
    expect(calculateSecurityRisk(C(null), CTX).level).toBe('insufficient_data');
    expect(calculateSecurityRisk(C(90), CTX).noAutoBlock).toBe(true);
  });
  it('Incident Correlation — 공격/유출 단정 없음', () => {
    const r = correlateSecurityIncident({ occurredAt: '2026-07-14T01:00:00Z', scopeKeys: ['admin'] }, { detectedAt: '2026-07-14T02:00:00Z', scopeKeys: ['admin'] });
    expect(r.correlation).toBe('possibly_related');
    expect(r.note).toContain('단정하지 않음');
    expect(correlateSecurityIncident({ occurredAt: null, scopeKeys: [] }, { detectedAt: null, scopeKeys: [] }).correlation).toBe('insufficient_data');
  });
  it('Compliance Control — Evidence 없는 operating 금지 · 상태 분류', () => {
    expect(calculateComplianceControlStatus({ reviewed: false, evidenceCount: 0, gapsFound: 0, designedOnly: false })).toBe('not_reviewed');
    expect(calculateComplianceControlStatus({ reviewed: true, evidenceCount: 0, gapsFound: 0, designedOnly: false })).toBe('insufficient_data');
    expect(calculateComplianceControlStatus({ reviewed: true, evidenceCount: 2, gapsFound: 1, designedOnly: false })).toBe('gap_detected');
    expect(calculateComplianceControlStatus({ reviewed: true, evidenceCount: 2, gapsFound: 0, designedOnly: true })).toBe('design_only');
    expect(calculateComplianceControlStatus({ reviewed: true, evidenceCount: 2, gapsFound: 0, designedOnly: false })).toBe('operating');
  });
  it('Evidence Package — 공식 인증 아님 명시 + 필수 섹션', () => {
    const pkg = buildComplianceEvidencePackage({ identityCount: 10, privilegedCount: 1, roleInventory: ['user', 'admin'], accessReviews: 0, segregationConflicts: 1, sensitiveDataItems: 9, rlsRpcSummary: 'reviewed', privacyRequests: 0, retentionPolicies: 0, auditCompleteness: 'partial', securityEvents: 0, externalActionReferences: 0, openGaps: ['g'], riskLevel: 'high', humanDecisions: 0 });
    expect(String(pkg[0].content)).toContain('공식 인증 아님');
    const sections = pkg.map((p) => p.section);
    for (const s of ['Identity Inventory', 'Privileged Accounts', 'Segregation Conflicts', 'RLS / RPC Review', 'Retention Policies', 'Audit Completeness', 'Open Gaps', 'Limitations']) expect(sections).toContain(s);
  });
  it('Security Recommendation — 단일 admin/SoD/logging/retention 신호', () => {
    const recs = buildSecurityRecommendation({ singleAdmin: true, mfaKnown: false, loggingGaps: 3, retentionPolicies: 0, openPrivacyRequests: 1, sodConflicts: 1, dormantCandidates: 2 });
    const types = recs.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['assign_backup_admin', 'separate_reviewer_approver', 'enable_mfa_review', 'add_access_logging', 'define_retention_policy', 'review_privacy_request', 'review_dormant_account']));
    expect(recs.every((r) => r.noExecution)).toBe(true);
    expect(buildSecurityRecommendation({ singleAdmin: false, mfaKnown: true, loggingGaps: 0, retentionPolicies: 1, openPrivacyRequests: 0, sodConflicts: 0, dormantCandidates: 0 })[0].type).toBe('insufficient_data');
  });
});

describe('Support Matrix', () => {
  it('자동 조치 전부 unsupported · 정직 상태(logging_unavailable/rbac_limited/deletion_reference_only)', () => {
    for (const k of ['automatic_account_disable', 'automatic_role_change', 'automatic_permission_revocation', 'automatic_data_deletion', 'automatic_compliance_certification', 'production_apply']) {
      expect(SEC_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
    expect(SEC_SUPPORT.find((s) => s.key === 'access_logging')!.status).toBe('logging_unavailable');
    expect(SEC_SUPPORT.find((s) => s.key === 'role_inventory')!.status).toBe('rbac_limited');
    expect(SEC_SUPPORT.find((s) => s.key === 'privacy_request')!.status).toBe('deletion_reference_only');
    expect(SEC_SUPPORT.find((s) => s.key === 'consent_evidence')!.status).toBe('unsupported');
    expect(SECURITY_DOMAINS.find((d) => d.domain === 'vendor_security')!.status).toBe('unsupported');
  });
});
