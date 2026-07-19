/**
 * GovernanceComplianceCenterSection — Enterprise E-4 (Governance & Compliance Center).
 *
 * Policy/Governance/Compliance/Permission/Audit/Human Oversight 통합 Governance Layer.
 * 신규 Governance Engine/Policy Engine/Permission Engine/Migration/RPC 없음 —
 * 기존 0496 AI Governance · 0512 Policy Registry · 0510 Identity/Access Review ·
 * 0479 Action Center · Settlement KPI 재사용(읽기 전용).
 * Governance 는 결정을 대신하지 않는다 — 결정이 정책에 맞는지 확인한다.
 * (기존 AiGovernanceSection(0496)/PolicyGovernanceSection(0512)/
 *  SecurityGovernanceSection(0510)/GovernanceIntelligenceSection(AI-OPS-47)과 별개)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, BookOpen, Bot, ClipboardList, Gauge, GitBranch,
  LayoutDashboard, Lock, RefreshCw, Scale, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge } from '@/components/admin/ui';
import {
  fetchGovernanceSummary, fetchConstitutionRules, fetchPolicyInventory,
  fetchSecurityIdentities, fetchAccessReviews, fetchActionHistory, fetchReadableSettlementKpi,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  GOVERNANCE_OVERSIGHT_MATRIX, GOVERNANCE_RELATIONSHIP_EDGES,
  buildGovernanceOverview, buildGovernanceRelationships, buildGovernanceSummaryLines,
  categorizeAuditHistory, computeComplianceAnalytics, emptyGovernanceFeeds,
  summarizePermissions, summarizePolicies,
  type GovernanceFeeds,
} from '@/lib/governanceComplianceCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'policy' | 'compliance' | 'permissions' | 'audit'
  | 'relationships' | 'analytics' | 'summary' | 'oversight' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Governance Overview', icon: LayoutDashboard },
  { key: 'policy', label: 'Policy', icon: BookOpen },
  { key: 'compliance', label: 'Compliance', icon: Scale },
  { key: 'permissions', label: 'Permissions', icon: Users },
  { key: 'audit', label: 'Audit', icon: ClipboardList },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'analytics', label: 'Analytics', icon: Gauge },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'oversight', label: 'Human Oversight', icon: Shield },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Governance Engine/Policy Engine/Permission Engine 생성 없음 — 기존 체계 통합 조회 계층입니다',
  '신규 Migration/RPC 없음 — 0496 AI Governance/0512 Policy Registry/0510 Identity·Access Review/0479 Action Center/Settlement KPI 재사용(읽기 전용)',
  'AI 는 Policy 를 생성하지 않습니다 — 기존 Policy Registry 를 조회만 하며, Policy/Permission 변경은 사람이 기존 절차로 수행합니다',
  'Governance 는 결정을 대신하지 않습니다 — 결정이 정책에 맞는지 관측값 기반으로 확인만 합니다',
  'Compliance 판정은 관측값 기반 결정적 규칙이며, 미관측 영역은 insufficient_data 로만 표시합니다(추론 없음)',
  '스펙의 Permission 5역할 중 executive/reviewer/operator/read_only 는 현 Permission 체계에 부재(실측 role 기반) — null 로 정직 표시',
  'Analytics 의 Audit Coverage/Human Review Rate 는 측정 가능한 관측 창 내 기록만 사용하며, 측정 불가 시 null 입니다',
  'Governance Summary 는 관측값 기반 결정적 문장 생성(5줄 이내)이며 판단/예측/승인이 아닙니다',
  '자동 Policy 생성/자동 Permission 변경/자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function GovernanceComplianceCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<GovernanceFeeds>(emptyGovernanceFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const results = await Promise.allSettled([
        fetchGovernanceSummary(), fetchConstitutionRules(null), fetchPolicyInventory(null, null, 200),
        fetchSecurityIdentities(200), fetchAccessReviews(null, 100), fetchActionHistory(100),
        fetchReadableSettlementKpi(month),
      ]);
      const next = emptyGovernanceFeeds();
      const failed: string[] = [];
      const take = <T,>(i: number, name: string): T | null => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) return r.value as T;
        failed.push(name);
        return null;
      };
      const gov = take<Awaited<ReturnType<typeof fetchGovernanceSummary>>>(0, 'governanceSummary');
      next.govEvents = gov?.events ?? null;
      next.govCandidates = gov?.candidates ?? null;
      next.constitutionRules = take<Awaited<ReturnType<typeof fetchConstitutionRules>>>(1, 'constitutionRules');
      next.policies = take<Awaited<ReturnType<typeof fetchPolicyInventory>>>(2, 'policyInventory');
      next.identities = take<Awaited<ReturnType<typeof fetchSecurityIdentities>>>(3, 'identities')?.items ?? null;
      next.accessReviews = take<Awaited<ReturnType<typeof fetchAccessReviews>>>(4, 'accessReviews');
      next.actionHistory = take<Awaited<ReturnType<typeof fetchActionHistory>>>(5, 'actionHistory');
      next.settlementKpi = take<Record<string, unknown>>(6, 'settlementKpi');
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const overview = useMemo(() => buildGovernanceOverview(feeds), [feeds]);
  const policies = useMemo(() => summarizePolicies(feeds.policies), [feeds]);
  const permissions = useMemo(() => summarizePermissions(feeds.identities), [feeds]);
  const auditBuckets = useMemo(() => categorizeAuditHistory(feeds.actionHistory), [feeds]);
  const relationships = useMemo(() => buildGovernanceRelationships(feeds), [feeds]);
  const analytics = useMemo(() => computeComplianceAnalytics(feeds), [feeds]);
  const summaryLines = useMemo(() => {
    const permissionChanges = feeds.actionHistory == null
      ? null
      : feeds.actionHistory.filter((r) => r.command_type.includes('permission')).length;
    const pendingApprovals = feeds.actionHistory == null
      ? null
      : feeds.actionHistory.filter((r) => r.command_type.startsWith('decision_') && (r.status === 'pending' || r.status === 'running')).length;
    return buildGovernanceSummaryLines({
      criticalViolations: overview.card.criticalViolations,
      pendingApprovals,
      auditRecords: overview.card.auditRecords,
      compliance: overview.card.complianceStatus,
      permissionChanges,
    });
  }, [feeds, overview]);

  if (loading) return <AdminCard title="Governance & Compliance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Governance & Compliance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const compTone = (s: string) => (s === 'compliant' ? 'success' : s === 'warning' ? 'warning' : s === 'violation' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';

  return (
    <AdminCard
      title="Governance & Compliance Center"
      subtitle="Policy·Governance·Compliance·Permission·Audit·Human Oversight 통합 — Governance 는 결정을 대신하지 않고 정책 부합 여부를 확인"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 Governance/Audit 체계를 통합하는 Governance Layer 입니다. AI 는 Policy 를 생성하지 않고 기존 Policy 를 조회하며, 권한과 감사는 기존 체계를 그대로 사용합니다. AI 는 Explain/Recommend/Summarize/Highlight Risk 만 수행하고, Approve/Reject/Execute/Policy 변경/Permission 변경은 사람만 수행합니다. 자동 Policy 생성·자동 Permission 변경·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Governance Status" value={overview.card.governanceStatus} />
            <Box label="Active Policies" value={NUM(overview.card.activePolicies)} />
            <Box label="Pending Reviews" value={NUM(overview.card.pendingReviews)} />
            <Box label="Compliance Status" value={overview.card.complianceStatus} />
            <Box label="Audit Records (관측 창)" value={NUM(overview.card.auditRecords)} />
            <Box label="Human Oversight (사람 전용 능력)" value={`${overview.card.humanOversightHumanOnly}종`} />
            <Box label="Permission Admins" value={NUM(overview.card.permissionAdmins)} />
            <Box label="Critical Violations" value={NUM(overview.card.criticalViolations)} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — insufficient_data 로만 표시됩니다(추론 없음).`} />
          )}
        </div>
      )}

      {tab === 'policy' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {policies.byDomain.map((d) => (
              <Box key={d.domain} label={`${d.domain} policy`} value={d.count == null ? '미관측' : `${NUM(d.count)}건`} />
            ))}
          </div>
          {policies.otherDomains.length > 0 && (
            <p className="text-[11px] text-muted-foreground">스펙 외 실측 도메인: {policies.otherDomains.map((d) => `${d.domain}(${d.count})`).join(', ')}</p>
          )}
          <p className="text-[11px] text-muted-foreground">Policy Registry(0512) 조회 — 전체 {NUM(policies.totalCount)}건 / active {NUM(policies.activeCount)}건. AI 는 Policy 를 생성하지 않습니다.</p>
        </div>
      )}

      {tab === 'compliance' && (
        <div className="space-y-2">
          {overview.compliance.map((c) => (
            <div key={c.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={compTone(c.status)}>{c.status}</AdminBadge>
                <span className="truncate text-xs font-bold">{c.area} compliance</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{c.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Compliant/Warning/Violation/Insufficient Data — 관측값 기반 결정적 판정이며 없는 데이터를 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'permissions' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="전체 계정" value={NUM(permissions.totalCount)} />
            <Box label="활성 계정" value={NUM(permissions.activeCount)} />
            <Box label="Admin (is_admin)" value={NUM(permissions.adminCount)} />
          </div>
          {permissions.specRoles.map((r) => (
            <div key={r.role} className="flex items-center justify-between rounded-lg border border-border p-2">
              <span className="text-xs font-bold">{r.role}</span>
              <span className="text-[10px] text-muted-foreground">{r.count == null ? `미관측 — ${r.note}` : `${NUM(r.count)}명 (${r.note})`}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">실측 role: {permissions.actualRoles.map((r) => `${r.role}(${r.count})`).join(', ') || '미관측'} — 기존 Permission 체계 재사용, 변경은 사람만 수행합니다.</p>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-3">
          {auditBuckets.buckets.map((b) => (
            <div key={b.kind}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{b.kind} history · {NUM(b.rows.length)}건</div>
              {b.rows.length === 0
                ? <p className="text-[11px] text-muted-foreground">관측 창 내 기록 없음</p>
                : b.rows.slice(0, 10).map((r, i) => (
                  <div key={`${b.kind}-${i}`} className="mb-1 flex items-center justify-between rounded-lg border border-border p-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <AdminBadge tone="neutral">{r.command_type}</AdminBadge>
                      <span className="truncate text-xs">{r.reason ?? '—'}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{r.requested_by_name ?? '—'} · {r.requested_at ? new Date(r.requested_at).toLocaleString('ko-KR') : '—'} · {r.status}</span>
                  </div>
                ))}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">기존 0479 감사 로그를 그대로 분류 표시(신규 감사 테이블 없음) — 분류 외 기록 {NUM(auditBuckets.otherCount)}건.</p>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-1">
          {relationships.map((r, i) => (
            <div key={r.stage}>
              <div className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{r.stage}</span>
                  <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                </div>
                <span className="text-[10px] text-muted-foreground">{i < GOVERNANCE_RELATIONSHIP_EDGES.length ? GOVERNANCE_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Policy→Decision→Approval→Audit→Compliance→Governance — 연결 관계 표시이며 관측 여부는 실제 피드 기준입니다.</p>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Total Reviews" value={NUM(analytics.totalReviews)} />
            <Box label="Total Approvals" value={NUM(analytics.totalApprovals)} />
            <Box label="Policy Violations" value={NUM(analytics.policyViolations)} />
            <Box label="Compliance Warnings" value={NUM(analytics.complianceWarnings)} />
            <Box label="Audit Coverage (사유 기록률)" value={analytics.auditCoveragePct == null ? '측정 불가' : `${analytics.auditCoveragePct}%`} />
            <Box label="Human Review Rate (결정 완료율)" value={analytics.humanReviewRatePct == null ? '측정 불가' : `${analytics.humanReviewRatePct}%`} />
          </div>
          <p className="text-[11px] text-muted-foreground">관측 창 내 기록만 사용 — 측정 불가 시 null(조작 없음).</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 판단/예측/승인 아님.</p>
        </div>
      )}

      {tab === 'oversight' && (
        <div className="space-y-1">
          {GOVERNANCE_OVERSIGHT_MATRIX.map((e) => (
            <div key={e.capability} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={e.level === 'ai_allowed' ? 'success' : e.level === 'human_only' ? 'warning' : 'danger'}>{e.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{e.capability}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{e.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">AI 는 Explain/Recommend/Summarize/Highlight Risk 만 수행 — Approve/Reject/Execute/Policy 변경/Permission 변경은 사람만 수행합니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
