/**
 * SecurityGovernanceSection — AI Security, Privacy & Compliance Center (Phase AI-OPS-7).
 *
 * Identity/Access Inventory → Permission 분석 → 민감 데이터 → SoD → Privacy/Retention →
 * 위험 탐지 → Access Review → 사람 승인/외부 조치 Reference → Compliance Evidence → Audit.
 * IAM 실행/계정 관리/개인정보 자동 삭제 엔진 아님. Disable Account/Change Role/Revoke
 * Permission/Reset Password/Enable MFA/Revoke Session/Delete User/Delete Personal Data/
 * Delete Account/Export All Automatically 버튼 없음.
 *
 * 탭 26개: Overview · Identity Inventory · Roles · Permissions · Privileged Accounts ·
 * Access Risk · Least Privilege · Segregation of Duties · Access Reviews · External Access
 * Actions · Sensitive Data Registry · Access Logging · RLS/RPC Security · Security Events ·
 * Privacy Requests · Retention Policies · Retention Validation · Consent Evidence ·
 * Audit Completeness · Compliance Controls · Evidence Packages · Security Incidents ·
 * Security Risk · Recommendations · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Database, FileCheck2, FileText, Fingerprint, Grid3x3, Key, Layers,
  Lock, RefreshCw, Scale, ScrollText, Shield, ShieldAlert, ShieldCheck, Timer, UserCheck, Users, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchSecuritySummary, fetchSecurityIdentities, createAccessReview, decideAccessReview, fetchAccessReviews,
  recordSecurityExternalAction, saveSecurityDataRegistry, fetchSecurityDataRegistry,
  createPrivacyRequest, updatePrivacyRequest, fetchPrivacyRequests, saveRetentionPolicy, fetchRetentionPolicies,
  saveComplianceControl, fetchComplianceControls, fetchSecurityAudit, fetchIncidents,
  type SecurityIdentityRow, type AccessReviewRow, type DataRegistryRow, type PrivacyRequestRow,
  type RetentionPolicyRow, type ComplianceControlRow, type SecurityEventRow, type IncidentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  classifyAccountStatus, calculateAccessRisk, classifyPrivilegedAccount, evaluateLeastPrivilege,
  detectSegregationConflict, validateExternalActionReference,
  evaluateAccessLogging, evaluateRlsRpcSecurity, calculateAuditCompleteness, canMarkPrivacyCompleted,
  evaluateRetentionCompliance, calculateSecurityRisk, correlateSecurityIncident,
  buildComplianceEvidencePackage, buildSecurityRecommendation, ACTUAL_ROLES, ACTUAL_ACCOUNT_TYPES,
  SECURITY_DOMAINS, SEC_SUPPORT, RISK_TONE, ACCT_TONE,
  type AccountStatus, type RiskLevel, type SecurityRiskComponents,
} from '@/lib/securityGovernance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'identities' | 'roles' | 'permissions' | 'privileged' | 'risk' | 'leastpriv' | 'sod'
  | 'reviews' | 'extactions' | 'registry' | 'logging' | 'rlsrpc' | 'events' | 'privacy' | 'retention'
  | 'retval' | 'consent' | 'auditcomp' | 'controls' | 'evidence' | 'incidents' | 'secrisk' | 'recommendations' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'identities', label: 'Identity Inventory', icon: Fingerprint },
  { key: 'roles', label: 'Roles', icon: Users },
  { key: 'permissions', label: 'Permissions', icon: Key },
  { key: 'privileged', label: 'Privileged Accounts', icon: ShieldAlert },
  { key: 'risk', label: 'Access Risk', icon: AlertTriangle },
  { key: 'leastpriv', label: 'Least Privilege', icon: Scale },
  { key: 'sod', label: 'Segregation of Duties', icon: Scale },
  { key: 'reviews', label: 'Access Reviews', icon: UserCheck },
  { key: 'extactions', label: 'External Access Actions', icon: FileText },
  { key: 'registry', label: 'Sensitive Data Registry', icon: Database },
  { key: 'logging', label: 'Access Logging', icon: ScrollText },
  { key: 'rlsrpc', label: 'RLS / RPC Security', icon: ShieldCheck },
  { key: 'events', label: 'Security Events', icon: Activity },
  { key: 'privacy', label: 'Privacy Requests', icon: Lock },
  { key: 'retention', label: 'Retention Policies', icon: Timer },
  { key: 'retval', label: 'Retention Validation', icon: Timer },
  { key: 'consent', label: 'Consent Evidence', icon: FileCheck2 },
  { key: 'auditcomp', label: 'Audit Completeness', icon: FileCheck2 },
  { key: 'controls', label: 'Compliance Controls', icon: ShieldCheck },
  { key: 'evidence', label: 'Evidence Packages', icon: FileText },
  { key: 'incidents', label: 'Security Incidents', icon: AlertTriangle },
  { key: 'secrisk', label: 'Security Risk', icon: Shield },
  { key: 'recommendations', label: 'Recommendations', icon: Zap },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

/* 코드 분석 기반 RLS/RPC 검토 대상(Evidence — DB 적용 상태와 구분). */
const RLSRPC_OBJECTS = [
  { name: 'payout_accounts', type: 'table', sensitive: true, input: { reviewed: true, rlsEnabled: true, policyExists: true, securityDefiner: false, searchPathPinned: null, adminGuard: null, scopeGuard: true, auditLogged: true, publicExecutable: false, sensitiveData: true }, note: '0060 — RLS+열람 audit(0061)' },
  { name: 'artist_settlements', type: 'table', sensitive: true, input: { reviewed: true, rlsEnabled: true, policyExists: true, securityDefiner: false, searchPathPinned: null, adminGuard: null, scopeGuard: true, auditLogged: false, publicExecutable: false, sensitiveData: true }, note: '0060 — SELECT 로그 없음' },
  { name: 'admin_* RPC 체계(0472~0510)', type: 'rpc', sensitive: true, input: { reviewed: true, rlsEnabled: null, policyExists: null, securityDefiner: true, searchPathPinned: true, adminGuard: true, scopeGuard: true, auditLogged: true, publicExecutable: false, sensitiveData: true }, note: 'SECURITY DEFINER + search_path + guard 패턴' },
  { name: 'playback_events_v2', type: 'table', sensitive: false, input: { reviewed: true, rlsEnabled: true, policyExists: true, securityDefiner: false, searchPathPinned: null, adminGuard: null, scopeGuard: true, auditLogged: false, publicExecutable: false, sensitiveData: false }, note: '0253' },
  { name: 'storage(audio/covers)', type: 'storage', sensitive: false, input: { reviewed: false, rlsEnabled: null, policyExists: null, securityDefiner: false, searchPathPinned: null, adminGuard: null, scopeGuard: null, auditLogged: null, publicExecutable: null, sensitiveData: false }, note: 'bucket policy 미검토(not_reviewed)' },
];

export default function SecurityGovernanceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Record<string, number | string | Record<string, number> | null>>({});
  const [identities, setIdentities] = useState<SecurityIdentityRow[]>([]);
  const [identityNote, setIdentityNote] = useState('');
  const [reviews, setReviews] = useState<AccessReviewRow[]>([]);
  const [registry, setRegistry] = useState<DataRegistryRow[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyRequestRow[]>([]);
  const [retention, setRetention] = useState<RetentionPolicyRow[]>([]);
  const [controls, setControls] = useState<ComplianceControlRow[]>([]);
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, ids, rv, reg, pr, rp, cc, ev, inc] = await Promise.all([
        fetchSecuritySummary(), fetchSecurityIdentities(200), fetchAccessReviews(null, 100),
        fetchSecurityDataRegistry(100), fetchPrivacyRequests(null, 100), fetchRetentionPolicies(100),
        fetchComplianceControls(100), fetchSecurityAudit(100), fetchIncidents(null, null, 30),
      ]);
      setSummary(s); setIdentities(ids.items); setIdentityNote(ids.note); setReviews(rv); setRegistry(reg);
      setPrivacy(pr); setRetention(rp); setControls(cc); setEvents(ev); setIncidents(inc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수'); return null; }
    return reason.trim();
  };

  const admins = useMemo(() => identities.filter((i) => i.is_admin), [identities]);
  const activeAdmins = useMemo(() => admins.filter((i) => i.is_active), [admins]);
  const statusOf = useCallback((i: SecurityIdentityRow) => classifyAccountStatus({ exists: true, withdrawn: !i.is_active, lastSignInAt: i.last_sign_in_at, now }), [now]);
  const dormantCandidates = useMemo(() => identities.filter((i) => statusOf(i).status === 'dormant_candidate'), [identities, statusOf]);
  const withdrawnAdmins = useMemo(() => admins.filter((i) => !i.is_active), [admins]);

  const accessRisk = useMemo(() => calculateAccessRisk({
    privilegedRole: admins.length ? Math.min(100, admins.length * 30) : null,
    rbacLimitation: 70,                                     // role 2종 — 구조적 한계(실측)
    dormantRisk: identities.length ? Math.min(100, dormantCandidates.length * 25) : null,
    withdrawnAccessRisk: withdrawnAdmins.length ? 90 : 5,
    selfApprovalRisk: activeAdmins.length <= 1 ? 80 : 20,
    scopeUnrestricted: 70,                                  // admin scope 제한 없음
    sensitiveAccess: registry.some((r) => ['highly_sensitive', 'restricted'].includes(r.classification)) ? 60 : null,
    auditGap: registry.length ? (registry.filter((r) => r.access_logging_status === 'logging_unavailable').length / registry.length) * 100 : null,
    mfaUnknown: 60,                                         // MFA 확인 불가
    singleAdminRisk: activeAdmins.length <= 1 ? 90 : 10,
  }), [admins, activeAdmins, identities, dormantCandidates, withdrawnAdmins, registry]);

  const sod = useMemo(() => {
    const a = activeAdmins[0]?.id ?? null;
    return detectSegregationConflict({ creatorId: a, reviewerId: a, approverId: a, ownerId: a, financial: true });
  }, [activeAdmins]);

  const auditCompleteness = useMemo(() => calculateAuditCompleteness({
    auditedAreas: 12,  // AI 운영 audit 체인(0479~0510) + payout_reveal_audit — 실측 근거
    totalAreas: 16,    // 스펙 29 평가 대상(로그인/SELECT/Export/Session 미기록)
    criticalUnaudited: 0,
  }), []);

  const secRisk = useMemo(() => {
    const c: SecurityRiskComponents = {
      privilegedAccountRisk: accessRisk.score, rbacLimitation: 70,
      dormantCandidates: identities.length ? Math.min(100, dormantCandidates.length * 25) : null,
      scopeRestriction: 70,
      sensitiveAccess: registry.length ? 60 : null,
      segregationConflict: sod.result === 'critical_conflict' ? 90 : sod.result === 'conflict' ? 70 : sod.result === 'no_known_conflict' ? 10 : null,
      rlsGap: 20, rpcGuardGap: 15,
      auditGap: auditCompleteness.coveragePct != null ? 100 - auditCompleteness.coveragePct : null,
      mfaUnknown: 60, singleAdminRisk: activeAdmins.length <= 1 ? 90 : 10,
      privacyGap: privacy.length ? 40 : null, retentionGap: retention.length === 0 ? 70 : 20,
      incidentLoad: incidents.length ? Math.min(100, incidents.filter((i) => !i.resolved_at).length * 25) : null,
    };
    return calculateSecurityRisk(c, {
      publicSensitiveData: false, unguardedPayoutMutation: false, secretExposure: false,
      unauthorizedProductionMutation: false, criticalRlsGap: false, unauditedPayoutChange: false,
      withdrawnAdminAccess: withdrawnAdmins.length > 0,
    });
  }, [accessRisk, identities, dormantCandidates, registry, sod, auditCompleteness, activeAdmins, privacy, retention, incidents, withdrawnAdmins]);

  const recommendations = useMemo(() => buildSecurityRecommendation({
    singleAdmin: activeAdmins.length <= 1, mfaKnown: false,
    loggingGaps: registry.filter((r) => r.access_logging_status === 'logging_unavailable').length,
    retentionPolicies: retention.filter((r) => r.lifecycle_status === 'active').length,
    openPrivacyRequests: privacy.filter((p) => !['completed_reference', 'partially_completed_reference', 'rejected', 'cancelled', 'expired', 'invalidated'].includes(p.request_status)).length,
    sodConflicts: sod.result === 'no_known_conflict' || sod.result === 'insufficient_data' ? 0 : 1,
    dormantCandidates: dormantCandidates.length,
  }), [activeAdmins, registry, retention, privacy, sod, dormantCandidates]);

  const evidencePackage = useMemo(() => buildComplianceEvidencePackage({
    identityCount: identities.length || null, privilegedCount: admins.length || null,
    roleInventory: [...ACTUAL_ROLES], accessReviews: reviews.length,
    segregationConflicts: sod.conflicts.length, sensitiveDataItems: registry.length,
    rlsRpcSummary: `${RLSRPC_OBJECTS.length}개 객체 코드 분석(Evidence — DB 적용 상태와 구분)`,
    privacyRequests: privacy.length, retentionPolicies: retention.length,
    auditCompleteness: auditCompleteness.result, securityEvents: events.length,
    externalActionReferences: events.filter((e) => e.event_type === 'external_action_reference_recorded').length,
    openGaps: recommendations.filter((r) => r.type !== 'insufficient_data').map((r) => r.type),
    riskLevel: secRisk.level as RiskLevel, humanDecisions: reviews.filter((r) => r.decision).length,
  }), [identities, admins, reviews, sod, registry, privacy, retention, auditCompleteness, events, recommendations, secRisk]);

  if (loading) return <AdminCard title="AI Security, Privacy & Compliance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Security, Privacy & Compliance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Security, Privacy & Compliance Center"
      subtitle="Identity → 권한 분석 → 민감 데이터 → SoD → Privacy/Retention → Access Review → 외부 조치 Reference → Compliance Evidence (계정/권한/데이터 변경 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 IAM 실행/계정 관리/개인정보 자동 삭제 엔진이 아닙니다. 계정 비활성화·Role 변경·권한 회수·비밀번호 초기화·MFA·Session 종료·데이터 삭제는 수행하지 않으며 외부 수행 Reference 만 기록합니다. 로그가 없다고 접근이 없었다고 단정하지 않고(logging_unavailable), 단일 admin Role 환경을 세분 RBAC 으로 주장하지 않습니다(rbac_limited). 본 자료는 내부 검토용이며 공식 인증(ISO 27001/SOC 2/ISMS)이 아닙니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Total Accounts" value={NUM(summary.total_accounts as number)} />
          <Box label="Active" value={NUM(summary.active_accounts as number)} />
          <Box label="Admin" value={NUM(summary.admin_accounts as number)} />
          <Box label="Dormant Candidates" value={String(dormantCandidates.length)} />
          <Box label="Reviews Pending" value={NUM(summary.reviews_pending as number)} />
          <Box label="SoD Conflicts" value={String(sod.conflicts.length)} />
          <Box label="Sensitive Items" value={NUM(summary.registry_items as number)} />
          <Box label="Logging Gaps" value={String(registry.filter((r) => r.access_logging_status === 'logging_unavailable').length)} />
          <Box label="Privacy Open" value={NUM(summary.privacy_requests_open as number)} />
          <Box label="Retention Active" value={NUM(summary.retention_policies_active as number)} />
          <Box label="Audit Completeness" value={auditCompleteness.result} />
          <Box label="Security Risk" value={secRisk.score == null ? secRisk.level : `${secRisk.score} (${secRisk.level})`} />
        </div>
      )}

      {/* ── Identities ── */}
      {tab === 'identities' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Identity Inventory (실시간 · 원본 미복제)" description={identityNote} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Email(마스킹)</th><th className="px-2">Role</th><th className="px-2">Type</th><th className="px-2">Status</th><th className="px-2">Last Sign-in</th><th className="px-2">MFA</th></tr></thead>
              <tbody>{identities.slice(0, 30).map((i) => {
                const st = statusOf(i);
                return (
                  <tr key={i.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{i.masked_email ?? '—'}</td>
                    <td className="px-2"><AdminBadge tone={i.is_admin ? 'warning' : 'neutral'}>{i.role}</AdminBadge></td>
                    <td className="px-2 text-[10px]">{i.account_type ?? '—'}</td>
                    <td className="px-2"><AdminBadge tone={ACCT_TONE[st.status as AccountStatus]}>{st.status}</AdminBadge></td>
                    <td className="px-2 text-[10px]">{i.last_sign_in_at ? i.last_sign_in_at.slice(0, 16) : '이력 없음(단정 안 함)'}</td>
                    <td className="px-2 text-[10px]">{i.mfa_status}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Roles ── */}
      {tab === 'roles' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Role Inventory (rbac_limited)" description={`실제 DB Role 은 ${ACTUAL_ROLES.join('/')} 2종 · account_type ${ACTUAL_ACCOUNT_TYPES.join('/')}. 세분화 RBAC 이 없으며 존재하지 않는 Role 을 만들지 않습니다.`} />
          {ACTUAL_ROLES.map((r) => (
            <div key={r} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={r === 'admin' ? 'warning' : 'neutral'}>{r}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{NUM(((summary.roles ?? {}) as Record<string, number>)[r])}건 · {r === 'admin' ? '전체 admin RPC 실행 가능(단일 게이트)' : '일반 사용자'}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Permissions ── */}
      {tab === 'permissions' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Permission Inventory (evidence_only)" description="직접 Permission 시스템이 없어 RLS/RPC/Role 기반 Evidence 로만 표시합니다. Role 이름만으로 실제 권한 범위를 단정하지 않습니다." />
          {[
            { perm: 'Admin Dashboard / 전체 admin RPC', evidence: '_admin_growth_guard(role=admin)', scope: '제한 없음(scope_unrestricted)' },
            { perm: 'Contract Read', evidence: 'artist_contracts RLS + admin RPC', scope: 'artist 본인/admin' },
            { perm: 'Settlement Read/Write', evidence: '0059~0060 RPC(admin guard)', scope: 'admin' },
            { perm: 'Payout Account Reveal', evidence: 'payout_reveal_audit(0061) 기록', scope: 'admin — 열람 audit 존재' },
            { perm: 'Storage Read/Write', evidence: 'storage bucket policy(미검토)', scope: 'not_reviewed' },
          ].map((p) => (
            <div key={p.perm} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{p.perm}</span>
              <span className="text-[10px] text-muted-foreground">evidence: {p.evidence} · scope: {p.scope}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Privileged ── */}
      {tab === 'privileged' && (
        <div className="space-y-2">
          {admins.map((a) => {
            const p = classifyPrivilegedAccount({ role: a.role, isActive: a.is_active });
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{a.masked_email ?? a.id.slice(0, 8)}</span>
                <AdminBadge tone="warning">privileged</AdminBadge>
                {!a.is_active && <AdminBadge tone="danger">withdrawn — 접근 차단 확인 필요</AdminBadge>}
                <span className="text-[10px] text-muted-foreground">{p.reasons.join(' · ')}</span>
              </div>
            );
          })}
          {!admins.length && <AdminEmpty icon={<ShieldAlert size={20} />} title="Privileged 계정 없음" />}
        </div>
      )}

      {/* ── Access Risk ── */}
      {tab === 'risk' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black">{accessRisk.score ?? '—'}</span>
            <AdminBadge tone={RISK_TONE[accessRisk.level]}>{accessRisk.level}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">성분 재정규화 · 제외 {accessRisk.missing.length} · 자동 조치 없음</span>
          </div>
          <AdminAlert tone="info" description="Critical 이어도 자동 계정 비활성화하지 않습니다. MFA/Session 은 확인 불가로 위험 성분에 반영(unknown)." />
        </div>
      )}

      {/* ── Least Privilege ── */}
      {tab === 'leastpriv' && (
        <div className="space-y-2">
          {admins.map((a) => {
            const lp = evaluateLeastPrivilege({ role: a.role, usageKnown: false, usedRecently: null, scopeRestricted: null, rbacGranular: false });
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{a.masked_email ?? a.id.slice(0, 8)}</span>
                <AdminBadge tone="neutral">{lp.result}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{lp.note}</span>
              </div>
            );
          })}
          <AdminAlert tone="warning" description="단일 admin role 구조로 권한 축소가 불가능합니다(rbac_limited). 권한이 넓어 보인다는 이유만으로 오남용을 단정하지 않습니다." />
        </div>
      )}

      {/* ── SoD ── */}
      {tab === 'sod' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={sod.result === 'critical_conflict' ? 'danger' : sod.result === 'no_known_conflict' ? 'success' : 'warning'}>{sod.result}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{sod.conflicts.join(' · ') || '확인된 충돌 없음'}</span>
          </div>
          <AdminAlert tone="warning" description={`${sod.note}. 단일 관리자 환경에서는 Creator/Reviewer/Approver 가 구조적으로 동일해 정직하게 충돌로 표시하며, 자동 차단하지 않습니다.`} />
        </div>
      )}

      {/* ── Access Reviews ── */}
      {tab === 'reviews' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Access Review (실제 권한 변경 없음)" description="검토·권고 기록만 생성합니다. 권고 이후 실제 조치는 외부(IAM/Supabase Dashboard)에서 수행하고 Reference 로 기록합니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토/결정 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="review 사유" />
          <div className="flex flex-wrap gap-1.5">
            {admins.slice(0, 3).map((a) => (
              <button key={a.id} disabled={busy} onClick={() => void act(() => createAccessReview({
                review_code: `ar_${a.id.slice(0, 8)}_${now.toISOString().slice(0, 10)}`, subject_user_id: a.id, review_type: 'privileged_access',
                current_permissions: { role: a.role, scope: 'unrestricted' }, risk_summary: { level: accessRisk.level },
                conflict_summary: { sod: sod.result }, idempotency_key: `ar_${a.id}_${now.toISOString().slice(0, 10)}`,
                evidence: [{ label: 'privileged', value: true }],
              }), 'Access Review 시작')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ {a.masked_email ?? a.id.slice(0, 6)} Review</button>
            ))}
          </div>
          {reviews.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{r.review_code.slice(0, 26)}</span>
              <AdminBadge tone="neutral">{r.review_type}</AdminBadge>
              <AdminBadge tone={r.review_status === 'approved_reference' ? 'success' : r.review_status.includes('recommended') ? 'warning' : r.review_status === 'rejected' ? 'danger' : 'info'}>{r.review_status}</AdminBadge>
              {['pending_review', 'waiting_evidence'].includes(r.review_status) && (
                <div className="ml-auto flex gap-1">
                  {([['approved_reference', 'Access 유지 Ref'], ['reduction_recommended', 'Scope 축소 권고'], ['revocation_recommended', '권한 회수 권고'], ['waiting_evidence', '추가 Evidence'], ['rejected', '기각']] as const).map(([st, label]) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => decideAccessReview(r.id, st, st.includes('recommended') ? st : null, rr), `결정: ${label}`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{label}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── External Actions ── */}
      {tab === 'extactions' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="External Access Actions (Reference 만)" description="계정/권한 조치는 외부에서 사람이 수행하며 여기서는 참고 기록만 저장합니다. Disable Account/Change Role/Revoke Permission/Reset Password 버튼은 존재하지 않습니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="external 사유" />
          <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return;
            const ref = { action_type: 'password_reset_reference', performed_by: 'ops(사람)', performed_at: now.toISOString(), external_system: 'supabase_dashboard', result: 'reported_by_human' };
            const v = validateExternalActionReference(ref);
            if (v.errors.length) { toast.error(v.errors.join(', ')); return; }
            void act(() => recordSecurityExternalAction({ ...ref, subject_user_id: admins[0]?.id }), '외부 조치 Reference 기록(실행 아님)'); setReason('');
          }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">외부 조치 Reference 기록</button>
          {events.filter((e) => e.event_type === 'external_action_reference_recorded').map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{e.created_at.slice(0, 16)}</span>
              <AdminBadge tone="info">{String((e.payload as Record<string, unknown>)?.action_type ?? e.detail)}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">by {String((e.payload as Record<string, unknown>)?.performed_by ?? '—')}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Registry ── */}
      {tab === 'registry' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Sensitive Data Registry (Metadata 만)" description="Secret 값 자체는 저장하지 않습니다. 암호화를 확인하지 못한 항목은 encryption_unverified 로 정직 표시합니다." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Data</th><th className="px-2">위치</th><th className="px-2">분류</th><th className="px-2">암호화</th><th className="px-2">조회 로그</th><th className="px-2">상태</th><th className="px-2" /></tr></thead>
              <tbody>{registry.map((r) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{r.data_code.replace('reg_', '')}</td>
                  <td className="px-2 text-[10px]">{r.table_name}{r.column_name ? `.${r.column_name}` : ''}</td>
                  <td className="px-2"><AdminBadge tone={['highly_sensitive', 'restricted'].includes(r.classification) ? 'danger' : r.classification === 'sensitive' || r.classification === 'confidential' ? 'warning' : 'neutral'}>{r.classification}</AdminBadge></td>
                  <td className="px-2 text-[10px]">{r.encryption_status}</td>
                  <td className="px-2 text-[10px]">{r.access_logging_status}</td>
                  <td className="px-2"><AdminBadge tone={r.lifecycle_status === 'active' ? 'success' : 'warning'}>{r.lifecycle_status}</AdminBadge></td>
                  <td className="px-2">{r.lifecycle_status === 'draft' && (
                    <button disabled={busy} onClick={() => void act(() => saveSecurityDataRegistry({ data_code: r.data_code, lifecycle_status: 'active', change_reason: '관리자 확정(실제 컬럼 확인)' }), 'Registry 확정')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">확정</button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Access Logging ── */}
      {tab === 'logging' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Access Logging (logging_unavailable)" description="계좌 열람만 payout_reveal_audit(0061)로 기록됩니다. 로그인/민감 테이블 SELECT/Export/다운로드 로그는 없으며, 로그가 없다고 접근이 없었다고 단정하지 않습니다." />
          {[
            { area: '계좌 원본 열람', input: { hasSelectLog: false, hasRevealAudit: true, hasChangeAudit: true } },
            { area: '계약 조회', input: { hasSelectLog: false, hasRevealAudit: false, hasChangeAudit: true } },
            { area: '정산 조회', input: { hasSelectLog: false, hasRevealAudit: false, hasChangeAudit: true } },
            { area: '개인정보(email) 조회', input: { hasSelectLog: false, hasRevealAudit: false, hasChangeAudit: false } },
            { area: 'Storage 다운로드', input: { hasSelectLog: false, hasRevealAudit: false, hasChangeAudit: false } },
          ].map((x) => {
            const r = evaluateAccessLogging(x.input);
            return (
              <div key={x.area} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{x.area}</span>
                <AdminBadge tone={r.status === 'logged' ? 'success' : r.status === 'partially_logged' ? 'warning' : 'neutral'}>{r.status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{r.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── RLS/RPC ── */}
      {tab === 'rlsrpc' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="RLS / RPC Security Review (코드 분석 Evidence)" description="Migration 코드 분석 결과이며, 0472~0510 은 프로덕션 미적용 상태입니다(적용 상태와 구분). secure_by_evidence 는 보장이 아니라 Evidence 기준입니다." />
          {RLSRPC_OBJECTS.map((o) => {
            const r = evaluateRlsRpcSecurity(o.input);
            return (
              <div key={o.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{o.name}</span>
                <AdminBadge tone="neutral">{o.type}</AdminBadge>
                <AdminBadge tone={r.result === 'secure_by_evidence' ? 'success' : r.result === 'critical_gap' ? 'danger' : r.result === 'not_reviewed' ? 'neutral' : 'warning'}>{r.result}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{r.gaps.join(' · ') || o.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Security Events ── */}
      {tab === 'events' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="보안 검토 이벤트이며 침해 확정 이벤트가 아닙니다. 보안 이벤트와 공격을 동일시하지 않습니다." />
          {!events.length ? <AdminEmpty icon={<Activity size={20} />} title="Security Event 없음" /> : events.slice(0, 20).map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{e.created_at.slice(0, 16)}</span>
              <AdminBadge tone={e.severity === 'critical' || e.severity === 'high' ? 'danger' : e.severity === 'medium' ? 'warning' : 'neutral'}>{e.event_type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{(e.detail ?? '').slice(0, 60)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Privacy ── */}
      {tab === 'privacy' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Privacy Requests (deletion_reference_only)" description="실제 개인정보 삭제/Export 를 수행하지 않습니다. 외부 조치 Reference 없이 completed_reference 표시가 서버에서 차단됩니다. Delete Personal Data/Delete Account/Export All 버튼은 존재하지 않습니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="요청/결정 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="privacy 사유" />
          <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => createPrivacyRequest({
            request_code: `pr_${now.getTime().toString(36)}`, request_type: 'deletion', data_scope: ['personal_data'],
            evidence: [{ label: 'channel', value: '수동 접수' }, { label: 'reason', value: r }],
          }), 'Privacy Request 등록'); setReason(''); }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ 삭제 요청 등록(접수만)</button>
          {privacy.map((p) => {
            const canComplete = canMarkPrivacyCompleted(!!p.external_action_reference);
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{p.request_code.slice(0, 20)}</span>
                <AdminBadge tone="neutral">{p.request_type}</AdminBadge>
                <AdminBadge tone={p.request_status.includes('completed') ? 'success' : p.request_status === 'rejected' ? 'danger' : 'warning'}>{p.request_status}</AdminBadge>
                {p.legal_hold && <AdminBadge tone="warning">legal_hold</AdminBadge>}
                {!['completed_reference', 'partially_completed_reference', 'rejected', 'cancelled', 'expired', 'invalidated'].includes(p.request_status) && (
                  <div className="ml-auto flex gap-1">
                    <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updatePrivacyRequest(p.id, 'status', { status: 'verified' }, r), 'Identity Verification Reference'); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">신원 확인 Ref</button>
                    <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updatePrivacyRequest(p.id, 'action_reference', { action_type: 'personal_data_deleted_reference', performed_by: 'ops(사람)', performed_at: now.toISOString(), external_system: 'supabase_dashboard' }, r), '외부 Action Reference 기록(자동 처리 아님)'); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">외부 Action Ref</button>
                    <button disabled={busy || !canComplete.allowed} title={canComplete.note} onClick={() => { const r = needReason(); if (!r) return; void act(() => updatePrivacyRequest(p.id, 'status', { status: 'completed_reference' }, r), '완료 Reference'); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-40">완료 Ref</button>
                    <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => updatePrivacyRequest(p.id, 'status', { status: 'rejected' }, r), '기각'); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                  </div>
                )}
              </div>
            );
          })}
          {!privacy.length && <AdminEmpty icon={<Lock size={20} />} title="Privacy Request 없음" />}
        </div>
      )}

      {/* ── Retention Policies ── */}
      {tab === 'retention' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Retention Policies (임의 생성 없음)" description="법적 보존기간을 임의로 정하지 않습니다(seed 0건). legal_basis 와 함께 관리자가 입력해야 하며 삭제는 deletion_reference_only 입니다." />
          <button disabled={busy} onClick={() => void act(() => saveRetentionPolicy({
            policy_code: 'ret_settlement_records', data_domain: 'settlement_data', retention_period_days: 1825,
            legal_basis: '국세기본법 등 거래기록 5년 보존(관리자 확인 필요)', settlement_requirement: true,
            lifecycle_status: 'draft', change_reason: '관리자 초안 — 법무 검토 전 draft',
          }), 'Retention Policy 초안(draft — 법무 검토 필요)')} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ 정산 기록 보존 초안(draft)</button>
          {retention.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{r.policy_code}</span>
              <AdminBadge tone="neutral">v{r.version}</AdminBadge>
              <AdminBadge tone={r.lifecycle_status === 'active' ? 'success' : 'warning'}>{r.lifecycle_status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{r.data_domain} · {r.retention_period_days ?? '—'}일 · 근거: {r.legal_basis.slice(0, 40)} · {r.deletion_method}</span>
            </div>
          ))}
          {!retention.length && <AdminEmpty icon={<Timer size={20} />} title="Retention Policy 없음(policy_not_defined)" />}
        </div>
      )}

      {/* ── Retention Validation ── */}
      {tab === 'retval' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="정책이 없으면 위반으로 계산하지 않습니다. 삭제 대상 후보와 근거만 제시하며 삭제 실행 기능이 없습니다." />
          {registry.slice(0, 6).map((r) => {
            const pol = retention.find((p) => p.id === r.retention_policy_id && p.lifecycle_status === 'active');
            const v = evaluateRetentionCompliance({ policyDefined: !!pol, retentionDays: pol?.retention_period_days ?? null, dataAgeDays: null, legalHold: false });
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{r.data_code.replace('reg_', '')}</span>
                <AdminBadge tone={v.result === 'compliant' ? 'success' : v.result === 'overdue_candidate' ? 'danger' : 'neutral'}>{v.result}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{v.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Consent ── */}
      {tab === 'consent' && (
        <div className="space-y-2">
          <AdminEmpty icon={<FileCheck2 size={20} />} title="Consent Evidence — unsupported" description="전용 동의 기록 테이블(동의 버전/시각/철회)이 확인되지 않아 unsupported 로 정직 표시합니다. 동의 구조 도입은 별도 Phase 검토 대상입니다." />
        </div>
      )}

      {/* ── Audit Completeness ── */}
      {tab === 'auditcomp' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={auditCompleteness.result === 'complete' ? 'success' : auditCompleteness.result === 'critical_gap' ? 'danger' : 'warning'}>{auditCompleteness.result}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">coverage {auditCompleteness.coveragePct ?? '—'}% (AI 운영 audit 체인 12/16 영역 — 로그인/SELECT/Export/Session 미기록)</span>
          </div>
          <AdminAlert tone="warning" description="Audit 누락 영역을 정상 처리로 계산하지 않습니다. Access Log 부재는 접근 부재를 의미하지 않습니다." />
        </div>
      )}

      {/* ── Compliance Controls ── */}
      {tab === 'controls' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Compliance Controls (내부 검토용)" description="Evidence 없는 Control 을 operating 으로 표시하지 않습니다(서버 게이트). ISO 27001/SOC 2/ISMS 등 공식 인증을 주장하지 않습니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="검토 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="control 사유" />
          {controls.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{c.title}</span>
              <AdminBadge tone={c.control_status === 'operating' ? 'success' : c.control_status === 'gap_detected' ? 'danger' : 'neutral'}>{c.control_status}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{c.requirement?.slice(0, 50)}</span>
              {c.control_status === 'not_reviewed' && (
                <button disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => saveComplianceControl({ control_code: c.control_code, control_status: 'operating', change_reason: r, evidence: [{ label: 'reviewed_sources', value: c.evidence_sources }, { label: 'reviewed_at', value: now.toISOString() }] }), 'Control 검토 기록(Evidence 포함)'); setReason(''); }} className="ml-auto rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토 완료 기록</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Evidence Packages ── */}
      {tab === 'evidence' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {evidencePackage.map((p) => (
              <div key={p.section} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{p.section}</p>
                <p className="mt-0.5 break-all text-[11px]">{typeof p.content === 'string' || typeof p.content === 'number' ? String(p.content) : JSON.stringify(p.content).slice(0, 160)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Security Incidents ── */}
      {tab === 'incidents' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="보안 이벤트와 Incident(0502)의 시간/scope 상관만 표기합니다 — 공격/유출 원인으로 단정하지 않습니다." />
          {!events.length || !incidents.length ? <AdminEmpty icon={<AlertTriangle size={20} />} title="상관 대상 없음" /> : (
            events.slice(0, 5).flatMap((e) => incidents.slice(0, 3).map((i) => {
              const r = correlateSecurityIncident({ occurredAt: e.created_at, scopeKeys: [e.event_type] }, { detectedAt: i.detected_at, scopeKeys: [i.incident_type, i.scope] });
              return (
                <div key={`${e.id}-${i.id}`} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-semibold">{e.event_type.slice(0, 24)} ↔ {i.incident_code}</span>
                  <AdminBadge tone={r.correlation === 'unrelated' || r.correlation === 'insufficient_data' ? 'neutral' : 'warning'}>{r.correlation}</AdminBadge>
                </div>
              );
            }))
          )}
        </div>
      )}

      {/* ── Security Risk ── */}
      {tab === 'secrisk' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black">{secRisk.score ?? '—'}</span>
            <AdminBadge tone={RISK_TONE[secRisk.level]}>{secRisk.level}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">{secRisk.reasons.join(' · ')}</span>
          </div>
          <AdminAlert tone="info" description="없는 성분은 제외 후 재정규화합니다. Critical 이어도 자동 차단/자동 조치는 없습니다(manual_action_required)." />
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          {recommendations.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warning' : 'info'}>{r.type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{r.reason} · 자동 실행 없음</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!events.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{e.created_at.slice(0, 16)}</span>
              <AdminBadge tone={e.severity === 'high' || e.severity === 'critical' ? 'danger' : 'neutral'}>{e.event_type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{(e.detail ?? '').slice(0, 70)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Domain</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>{SECURITY_DOMAINS.map((d) => (
                <tr key={d.domain} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{d.label}</td>
                  <td className="px-2"><AdminBadge tone={d.status === 'unsupported' ? 'danger' : ['fully_supported', 'partially_supported'].includes(d.status) ? 'success' : 'neutral'}>{d.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{d.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>{SEC_SUPPORT.map((s) => (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : ['partially_supported', 'evidence_only', 'provisional'].includes(s.status) ? 'warning' : 'neutral'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
