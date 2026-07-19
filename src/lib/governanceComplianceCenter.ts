/**
 * governanceComplianceCenter — Enterprise E-4 (Governance & Compliance Center).
 *
 * Enterprise 전역의 Policy/Governance/Compliance/Permission/Audit/Human Oversight 를
 * 통합하는 Governance Layer. 신규 Governance Engine/Policy Engine/Permission Engine
 * 없음 — 입력은 전부 기존 adminApi wrapper 반환값(0496 AI Governance ·
 * 0512 Policy Registry · 0510 Security Identity/Access Review · 0479 Action Center)
 * 이며, 이 모듈은 결정적(pure)으로 분류/집계/표시만 수행한다.
 *
 * 원칙:
 *  - Governance 는 결정을 대신하지 않는다 — 결정이 정책에 맞는지 확인만 한다.
 *  - AI 는 Policy 를 생성하지 않는다 — 기존 Policy 를 조회한다.
 *  - 권한/감사는 기존 체계를 그대로 사용한다 — 없는 데이터는 추론하지 않고
 *    insufficient_data/미관측으로 표시한다.
 */
import { isFiniteNumber, clampScore } from './aiMemory';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export const GOVERNANCE_POLICY_DOMAINS = ['enterprise', 'financial', 'music', 'operational', 'security', 'compliance'] as const;
export type GovernancePolicyDomain = (typeof GOVERNANCE_POLICY_DOMAINS)[number];

export const COMPLIANCE_AREAS = ['policy', 'review', 'approval', 'financial', 'audit'] as const;
export type ComplianceArea = (typeof COMPLIANCE_AREAS)[number];

export const COMPLIANCE_STATUSES = ['compliant', 'warning', 'violation', 'insufficient_data'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const PERMISSION_SPEC_ROLES = ['admin', 'executive', 'reviewer', 'operator', 'read_only'] as const;
export type PermissionSpecRole = (typeof PERMISSION_SPEC_ROLES)[number];

export const AUDIT_HISTORY_KINDS = ['review', 'approval', 'decision', 'export', 'report'] as const;
export type AuditHistoryKind = (typeof AUDIT_HISTORY_KINDS)[number];

export const GOVERNANCE_RELATIONSHIP_FLOW = ['policy', 'decision', 'approval', 'audit', 'compliance', 'governance'] as const;
export type GovernanceStage = (typeof GOVERNANCE_RELATIONSHIP_FLOW)[number];

export const GOVERNANCE_RELATIONSHIP_EDGES: Array<{ from: GovernanceStage; to: GovernanceStage; via: string }> = [
  { from: 'policy', to: 'decision', via: 'Policy 가 결정의 기준을 제공한다' },
  { from: 'decision', to: 'approval', via: '결정은 사람의 승인/거절 절차를 거친다' },
  { from: 'approval', to: 'audit', via: '승인/거절은 감사 로그(0479)에 남는다' },
  { from: 'audit', to: 'compliance', via: '감사 기록이 컴플라이언스 확인의 입력이 된다' },
  { from: 'compliance', to: 'governance', via: '컴플라이언스 상태가 거버넌스 판단 근거가 된다' },
];

/** AI 가 수행 가능한 것 / 사람만 가능한 것 (스펙 1:1). */
export const GOVERNANCE_AI_ALLOWED = ['explain', 'recommend', 'summarize', 'highlight_risk'] as const;
export const GOVERNANCE_HUMAN_ONLY = ['approve', 'reject', 'execute', 'policy_change', 'permission_change'] as const;

/** 금지 목록 — 스펙 금지 사항 1:1. */
export const GOVERNANCE_BLOCKED_ACTIONS = [
  'automatic_policy_creation', 'automatic_permission_change', 'automatic_approval',
  'automatic_contract_approval', 'automatic_payment', 'automatic_merge',
  'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedGovernanceAction(action: string): boolean {
  return (GOVERNANCE_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

export interface GovernanceOversightEntry {
  capability: string;
  level: 'ai_allowed' | 'human_only' | 'unavailable';
  note: string;
}

export const GOVERNANCE_OVERSIGHT_MATRIX: GovernanceOversightEntry[] = [
  { capability: 'explain', level: 'ai_allowed', note: '기존 Policy/감사 기록을 원본 그대로 설명' },
  { capability: 'recommend', level: 'ai_allowed', note: '기존 Recommendation 원장 참조(신규 생성 없음)' },
  { capability: 'summarize', level: 'ai_allowed', note: 'Governance 상태 5줄 이내 결정적 요약' },
  { capability: 'highlight_risk', level: 'ai_allowed', note: '관측된 위반/경고 강조(재평가 없음)' },
  { capability: 'approve', level: 'human_only', note: '승인은 사람' },
  { capability: 'reject', level: 'human_only', note: '거절은 사람' },
  { capability: 'execute', level: 'human_only', note: '실행은 사람' },
  { capability: 'policy_change', level: 'human_only', note: 'Policy 변경은 사람(기존 Policy Registry 절차)' },
  { capability: 'permission_change', level: 'human_only', note: '권한 변경은 사람(기존 Permission 체계)' },
  { capability: 'automatic_policy_creation', level: 'unavailable', note: '자동 Policy 생성 금지' },
  { capability: 'automatic_permission_change', level: 'unavailable', note: '자동 Permission 변경 금지' },
  { capability: 'automatic_approval', level: 'unavailable', note: '자동 승인 금지' },
  { capability: 'automatic_contract_approval', level: 'unavailable', note: '자동 계약 승인 금지' },
  { capability: 'automatic_payment', level: 'unavailable', note: '자동 지급 금지' },
  { capability: 'automatic_merge', level: 'unavailable', note: '자동 Merge 금지' },
  { capability: 'automatic_deploy', level: 'unavailable', note: '자동 Deploy 금지' },
  { capability: 'automatic_production_apply', level: 'unavailable', note: 'Production Apply 금지' },
];

// ── 입력 행 (기존 wrapper 반환값의 최소 필드) ───────────────────────────

export interface GovEventsSummary {
  total: number; violations: number; blocked: number; overrides: number; checks: number;
}
export interface GovCandidatesSummary {
  total: number; pending: number; governance_ready: number; rejected: number; expired: number;
  high_risk: number; critical_risk: number;
}
export interface PolicyRowLite { domain: string; status: string }
export interface IdentityRowLite { role: string; is_admin: boolean; is_active: boolean }
export interface AccessReviewRowLite { review_status: string }
export interface AuditRowLite {
  command_type: string; status: string; reason?: string | null;
  requested_at?: string | null; requested_by_name?: string | null;
}

export interface GovernanceFeeds {
  govEvents: GovEventsSummary | null;        // fetchGovernanceSummary().events (0496)
  govCandidates: GovCandidatesSummary | null; // fetchGovernanceSummary().candidates (0496)
  constitutionRules: Array<{ is_active: boolean; severity: string }> | null; // 0496
  policies: PolicyRowLite[] | null;          // fetchPolicyInventory (0512)
  identities: IdentityRowLite[] | null;      // fetchSecurityIdentities (0510)
  accessReviews: AccessReviewRowLite[] | null; // fetchAccessReviews (0510)
  actionHistory: AuditRowLite[] | null;      // fetchActionHistory (0479)
  settlementKpi: Record<string, unknown> | null; // fetchReadableSettlementKpi
}

export function emptyGovernanceFeeds(): GovernanceFeeds {
  return {
    govEvents: null, govCandidates: null, constitutionRules: null, policies: null,
    identities: null, accessReviews: null, actionHistory: null, settlementKpi: null,
  };
}

const numField = (rec: Record<string, unknown> | null, key: string): number | null => {
  const v = rec?.[key];
  return isFiniteNumber(v) ? v : null;
};

// ── Policy Center — 기존 Policy 조회만 (생성 없음) ──────────────────────

export function summarizePolicies(policies: PolicyRowLite[] | null): {
  byDomain: Array<{ domain: GovernancePolicyDomain; count: number | null }>;
  otherDomains: Array<{ domain: string; count: number }>;
  activeCount: number | null;
  totalCount: number | null;
} {
  if (policies == null) {
    return {
      byDomain: GOVERNANCE_POLICY_DOMAINS.map((domain) => ({ domain, count: null })),
      otherDomains: [], activeCount: null, totalCount: null,
    };
  }
  const counts = new Map<string, number>();
  for (const p of policies) counts.set(p.domain, (counts.get(p.domain) ?? 0) + 1);
  const specSet = new Set<string>(GOVERNANCE_POLICY_DOMAINS);
  return {
    byDomain: GOVERNANCE_POLICY_DOMAINS.map((domain) => ({ domain, count: counts.get(domain) ?? 0 })),
    otherDomains: [...counts.entries()].filter(([d]) => !specSet.has(d))
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
    activeCount: policies.filter((p) => p.status === 'active').length,
    totalCount: policies.length,
  };
}

// ── Compliance Center — 관측값 기반 결정적 판정 ─────────────────────────

export interface ComplianceEntry {
  area: ComplianceArea;
  status: ComplianceStatus;
  note: string;
}

export function assessCompliance(feeds: GovernanceFeeds): ComplianceEntry[] {
  const out: ComplianceEntry[] = [];

  // policy — 0496 governance events (violations/overrides/checks)
  if (feeds.govEvents == null) out.push({ area: 'policy', status: 'insufficient_data', note: 'Governance 이벤트 피드 미관측' });
  else if (feeds.govEvents.violations > 0) out.push({ area: 'policy', status: 'violation', note: `Constitution 위반 ${feeds.govEvents.violations}건 관측` });
  else if (feeds.govEvents.overrides > 0) out.push({ area: 'policy', status: 'warning', note: `Human Override ${feeds.govEvents.overrides}건 — 검토 권장` });
  else if (feeds.govEvents.checks > 0) out.push({ area: 'policy', status: 'compliant', note: `Constitution 체크 ${feeds.govEvents.checks}건, 위반 0` });
  else out.push({ area: 'policy', status: 'insufficient_data', note: '체크 기록 0건 — 판정 보류' });

  // review — 0510 access reviews
  if (feeds.accessReviews == null) out.push({ area: 'review', status: 'insufficient_data', note: 'Access Review 피드 미관측' });
  else {
    const pending = feeds.accessReviews.filter((r) => r.review_status === 'pending').length;
    out.push(pending > 0
      ? { area: 'review', status: 'warning', note: `검토 대기 ${pending}건` }
      : { area: 'review', status: 'compliant', note: '대기 중 Access Review 없음' });
  }

  // approval — 0479 decision 기록
  if (feeds.actionHistory == null) out.push({ area: 'approval', status: 'insufficient_data', note: '감사 피드 미관측' });
  else {
    const decisions = feeds.actionHistory.filter((r) => r.command_type.startsWith('decision_'));
    const failed = decisions.filter((r) => r.status === 'failed').length;
    out.push(failed > 0
      ? { area: 'approval', status: 'warning', note: `기록 실패 ${failed}건` }
      : { area: 'approval', status: 'compliant', note: `결정 기록 ${decisions.length}건, 실패 0` });
  }

  // financial — settlement 보류/검증 실패
  if (feeds.settlementKpi == null) out.push({ area: 'financial', status: 'insufficient_data', note: 'Settlement KPI 피드 미관측' });
  else {
    const held = numField(feeds.settlementKpi, 'held_count') ?? 0;
    const verif = numField(feeds.settlementKpi, 'verification_failed_count') ?? 0;
    out.push(held + verif > 0
      ? { area: 'financial', status: 'warning', note: `보류 ${held}건 · 계좌 검증 실패 ${verif}건` }
      : { area: 'financial', status: 'compliant', note: '보류/검증 실패 0건' });
  }

  // audit — 0479 기록 존재 여부
  if (feeds.actionHistory == null) out.push({ area: 'audit', status: 'insufficient_data', note: '감사 피드 미관측' });
  else out.push(feeds.actionHistory.length > 0
    ? { area: 'audit', status: 'compliant', note: `관측 창 내 감사 기록 ${feeds.actionHistory.length}건` }
    : { area: 'audit', status: 'warning', note: '관측 창 내 감사 기록 0건' });

  return out;
}

const COMPLIANCE_RANK: Record<ComplianceStatus, number> = { violation: 0, warning: 1, insufficient_data: 2, compliant: 3 };

/** 종합 컴플라이언스 = 관측된 영역 중 최악 상태. 전 영역 미관측이면 insufficient_data. */
export function overallCompliance(entries: ComplianceEntry[]): ComplianceStatus {
  const observed = entries.filter((e) => e.status !== 'insufficient_data');
  if (observed.length === 0) return 'insufficient_data';
  return observed.reduce((worst, e) => (COMPLIANCE_RANK[e.status] < COMPLIANCE_RANK[worst] ? e.status : worst), 'compliant' as ComplianceStatus);
}

// ── Permission Center — 기존 Permission 체계 그대로 (변경 없음) ──────────

export function summarizePermissions(identities: IdentityRowLite[] | null): {
  actualRoles: Array<{ role: string; count: number }>;
  specRoles: Array<{ role: PermissionSpecRole; count: number | null; note: string }>;
  adminCount: number | null;
  activeCount: number | null;
  totalCount: number | null;
} {
  if (identities == null) {
    return {
      actualRoles: [],
      specRoles: PERMISSION_SPEC_ROLES.map((role) => ({ role, count: null, note: 'Identity 피드 미관측' })),
      adminCount: null, activeCount: null, totalCount: null,
    };
  }
  const counts = new Map<string, number>();
  for (const i of identities) counts.set(i.role, (counts.get(i.role) ?? 0) + 1);
  const adminCount = identities.filter((i) => i.is_admin).length;
  const specRoles = PERMISSION_SPEC_ROLES.map((role) => {
    if (role === 'admin') return { role, count: adminCount, note: 'is_admin=true 계정 수(실측)' };
    const actual = counts.get(role);
    return actual != null
      ? { role, count: actual, note: '실측 role 일치' }
      : { role, count: null, note: '해당 role 은 현 Permission 체계에 부재(실측) — 추론하지 않음' };
  });
  return {
    actualRoles: [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => a.role.localeCompare(b.role)),
    specRoles,
    adminCount,
    activeCount: identities.filter((i) => i.is_active).length,
    totalCount: identities.length,
  };
}

// ── Audit Center — 기존 0479 로그 분류만 ────────────────────────────────

export function categorizeAuditHistory<T extends AuditRowLite>(rows: T[] | null): {
  buckets: Array<{ kind: AuditHistoryKind; rows: T[] }>;
  otherCount: number;
} {
  const src = rows ?? [];
  const kindOf = (t: string): AuditHistoryKind | null => {
    if (t === 'executive_export') return 'export';
    if (t === 'executive_report') return 'report';
    if (t === 'executive_review' || t === 'executive_feedback') return 'review';
    if (t === 'decision_approve' || t === 'decision_reject' || t === 'executive_approval' || t === 'executive_reject') return 'approval';
    if (t.startsWith('decision_')) return 'decision';
    return null;
  };
  const buckets = AUDIT_HISTORY_KINDS.map((kind) => ({ kind, rows: [] as T[] }));
  let otherCount = 0;
  for (const r of src) {
    const kind = kindOf(r.command_type);
    if (kind == null) { otherCount += 1; continue; }
    buckets.find((b) => b.kind === kind)?.rows.push(r);
  }
  return { buckets, otherCount };
}

// ── Governance Relationships ────────────────────────────────────────────

export function buildGovernanceRelationships(feeds: GovernanceFeeds): Array<{
  stage: GovernanceStage;
  observed: boolean;
  note: string;
}> {
  const decisions = feeds.actionHistory?.filter((r) => r.command_type.startsWith('decision_')) ?? null;
  return GOVERNANCE_RELATIONSHIP_FLOW.map((stage) => {
    switch (stage) {
      case 'policy': return { stage, observed: feeds.policies != null, note: 'Policy Registry(0512)' };
      case 'decision': return { stage, observed: decisions != null && decisions.length > 0, note: 'decision_* 감사 기록(0479)' };
      case 'approval': return { stage, observed: decisions != null && decisions.some((r) => r.command_type === 'decision_approve' || r.command_type === 'decision_reject'), note: '사람의 승인/거절 기록' };
      case 'audit': return { stage, observed: feeds.actionHistory != null, note: 'Action Center 감사 원장(0479)' };
      case 'compliance': return { stage, observed: feeds.govEvents != null || feeds.settlementKpi != null, note: '컴플라이언스 관측 피드' };
      case 'governance': return { stage, observed: feeds.constitutionRules != null, note: 'Constitution Rules(0496)' };
      default: return { stage, observed: false, note: '' };
    }
  });
}

// ── Governance Overview (최상단 카드 8필드) ─────────────────────────────

export type GovernanceStatus = 'operational' | 'attention' | 'violation' | 'insufficient_data';

export interface GovernanceOverviewCard {
  governanceStatus: GovernanceStatus;
  activePolicies: number | null;
  pendingReviews: number | null;
  complianceStatus: ComplianceStatus;
  auditRecords: number | null;
  humanOversightHumanOnly: number; // 사람 전용 능력 수(항상 5 — 매트릭스 고정)
  permissionAdmins: number | null;
  criticalViolations: number | null;
}

export function buildGovernanceOverview(feeds: GovernanceFeeds): {
  card: GovernanceOverviewCard;
  compliance: ComplianceEntry[];
} {
  const compliance = assessCompliance(feeds);
  const overall = overallCompliance(compliance);
  const violations = feeds.govEvents?.violations ?? null;
  const status: GovernanceStatus = overall === 'insufficient_data'
    ? 'insufficient_data'
    : violations != null && violations > 0 ? 'violation'
      : overall === 'warning' ? 'attention' : 'operational';
  const policies = summarizePolicies(feeds.policies);
  const perms = summarizePermissions(feeds.identities);
  const pendingAccess = feeds.accessReviews == null ? null : feeds.accessReviews.filter((r) => r.review_status === 'pending').length;
  const pendingCandidates = feeds.govCandidates?.pending ?? null;
  return {
    card: {
      governanceStatus: status,
      activePolicies: policies.activeCount,
      pendingReviews: pendingAccess == null && pendingCandidates == null ? null : (pendingAccess ?? 0) + (pendingCandidates ?? 0),
      complianceStatus: overall,
      auditRecords: feeds.actionHistory == null ? null : feeds.actionHistory.length,
      humanOversightHumanOnly: GOVERNANCE_HUMAN_ONLY.length,
      permissionAdmins: perms.adminCount,
      criticalViolations: violations,
    },
    compliance,
  };
}

// ── Compliance Analytics ────────────────────────────────────────────────

export interface ComplianceAnalytics {
  totalReviews: number | null;
  totalApprovals: number | null;
  policyViolations: number | null;
  complianceWarnings: number;
  auditCoveragePct: number | null;   // 사유가 기록된 decision 비율 — 측정 불가 시 null
  humanReviewRatePct: number | null; // 결정 완료된 Access Review 비율 — 측정 불가 시 null
}

export function computeComplianceAnalytics(feeds: GovernanceFeeds): ComplianceAnalytics {
  const decisions = feeds.actionHistory?.filter((r) => r.command_type.startsWith('decision_')) ?? null;
  const withReason = decisions?.filter((r) => typeof r.reason === 'string' && r.reason.trim() !== '').length ?? null;
  const decidedReviews = feeds.accessReviews?.filter((r) => r.review_status !== 'pending').length ?? null;
  return {
    totalReviews: feeds.accessReviews == null ? null : feeds.accessReviews.length,
    totalApprovals: decisions == null ? null : decisions.filter((r) => r.command_type === 'decision_approve' && r.status === 'success').length,
    policyViolations: feeds.govEvents?.violations ?? null,
    complianceWarnings: assessCompliance(feeds).filter((e) => e.status === 'warning').length,
    auditCoveragePct: decisions == null || decisions.length === 0 || withReason == null ? null : clampScore((withReason / decisions.length) * 100),
    humanReviewRatePct: feeds.accessReviews == null || feeds.accessReviews.length === 0 || decidedReviews == null ? null : clampScore((decidedReviews / feeds.accessReviews.length) * 100),
  };
}

// ── Governance Summary (5줄 이내 결정적 — 판단 아님) ─────────────────────

export function buildGovernanceSummaryLines(input: {
  criticalViolations: number | null;
  pendingApprovals: number | null;
  auditRecords: number | null;
  compliance: ComplianceStatus;
  permissionChanges: number | null;
}): string[] {
  const lines: string[] = [];
  if (input.criticalViolations == null) lines.push('Policy 위반 상태는 관측되지 않았습니다.');
  else if (input.criticalViolations === 0) lines.push('Critical Policy 위반은 없습니다.');
  else lines.push(`Policy 위반 ${input.criticalViolations}건 — 사람 확인이 필요합니다.`);
  if (input.pendingApprovals == null) lines.push('Approval 대기 건수는 관측되지 않았습니다.');
  else if (input.pendingApprovals === 0) lines.push('Approval은 정상 처리 중입니다 (대기 0건).');
  else lines.push(`Approval 대기 ${input.pendingApprovals}건이 있습니다.`);
  if (input.auditRecords == null) lines.push('Audit 기록 피드는 관측되지 않았습니다.');
  else if (input.auditRecords > 0) lines.push(`Audit 기록은 관측 창 내 ${input.auditRecords}건 존재합니다.`);
  else lines.push('관측 창 내 Audit 기록이 없습니다 — 확인이 필요합니다.');
  const compText: Record<ComplianceStatus, string> = {
    compliant: 'Compliance는 Healthy 상태입니다.',
    warning: 'Compliance에 Warning이 있습니다.',
    violation: 'Compliance Violation이 관측되었습니다.',
    insufficient_data: 'Compliance 판정에 필요한 관측 데이터가 부족합니다.',
  };
  lines.push(compText[input.compliance]);
  if (input.permissionChanges == null) lines.push('Permission 변경 기록 피드는 관측되지 않았습니다.');
  else if (input.permissionChanges === 0) lines.push('관측 창 내 Permission 변경은 없습니다.');
  else lines.push(`관측 창 내 Permission 변경 기록 ${input.permissionChanges}건.`);
  return lines.slice(0, 5);
}
