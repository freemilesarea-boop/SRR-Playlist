/**
 * OrganizationIntelligenceSection — Enterprise Organizational Intelligence,
 * Organizational Health & Operating Model Center (Phase AI-OPS-48).
 *
 * Enterprise Vision→Operating Model→Organization Structure→Role &
 * Responsibility→Decision Flow→Cross-Functional Collaboration→Organizational
 * Health→Operating Maturity→Bottleneck Detection→Capability Gap→Improvement
 * Candidate→Executive Organization Review→Operating Learning→Audit.
 * Organization Candidate ≠ Organization Change · Organizational Health ≠ HR
 * Evaluation · Capability Gap ≠ Employee Performance · Review ≠ Approval.
 * 자동 조직 개편/팀 생성·삭제/인사 이동/승진/해고/평가/보상 없음.
 * (기존 OrganizationalLearningSection(0515) 과 별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, ClipboardList, Gauge, GitBranch,
  Grid3x3, History, Inbox, Layers, Lightbulb, Lock, Network, RefreshCw,
  Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseOrganizationSummary, fetchEnterpriseOrganizationModels,
  createEnterpriseOrganizationModel, reviewEnterpriseOrganizationModel,
  createEnterpriseOperatingReview, reviewEnterpriseOperatingReview,
  fetchEnterpriseOperatingReviews, recordEnterpriseOrganizationEvent,
  fetchEnterpriseOrganizationAudit,
  type EnterpriseOrganizationSummary, type EnterpriseOrganizationModelRow,
  type EnterpriseOperatingReviewRow, type EnterpriseOrganizationEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  ORGANIZATION_CATEGORIES, ORG_HEALTH_RESULTS, OPERATING_MATURITY_DIMENSIONS,
  OPERATING_MATURITY_RESULTS, CAPABILITY_GAP_DOMAINS, CAPABILITY_GAP_RESULTS,
  DECISION_FLOW_RESULTS, COLLABORATION_RESULTS, BOTTLENECK_RESULTS,
  WORKLOAD_RESULTS, ORG_DEPENDENCY_RESULTS, SPOF_RESULTS,
  ORG_RECOMMENDATION_TYPES, ORG_SCORECARD_FIELDS, buildOrganizationTimeline,
  ENTERPRISE_ORGANIZATION_COMPONENTS, ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX,
} from '@/lib/enterpriseOrganization';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'models' | 'structure' | 'rolematrix' | 'responsibility' | 'decisionflow'
  | 'collaboration' | 'health' | 'maturity' | 'capgap' | 'bottleneck' | 'workload' | 'dependency'
  | 'spof' | 'scenario' | 'improvement' | 'summary' | 'scorecard' | 'recommendations'
  | 'reviewqueue' | 'reviewed' | 'links' | 'learning' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Organization Overview', icon: Layers },
  { key: 'models', label: 'Organization Models', icon: BookOpen },
  { key: 'structure', label: 'Team Structure', icon: Network },
  { key: 'rolematrix', label: 'Role Matrix', icon: Grid3x3 },
  { key: 'responsibility', label: 'Responsibility Matrix', icon: ClipboardList },
  { key: 'decisionflow', label: 'Decision Flow', icon: GitBranch },
  { key: 'collaboration', label: 'Collaboration Network', icon: Network },
  { key: 'health', label: 'Organizational Health', icon: Activity },
  { key: 'maturity', label: 'Operating Maturity', icon: Gauge },
  { key: 'capgap', label: 'Capability Gap', icon: Shield },
  { key: 'bottleneck', label: 'Bottleneck Detection', icon: AlertTriangle },
  { key: 'workload', label: 'Workload Balance', icon: Users },
  { key: 'dependency', label: 'Dependencies', icon: GitBranch },
  { key: 'spof', label: 'Single Point of Failure', icon: Shield },
  { key: 'scenario', label: 'Organization Scenarios', icon: Search },
  { key: 'improvement', label: 'Improvement Candidates', icon: Lightbulb },
  { key: 'summary', label: 'Executive Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Organization Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Organization Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'learning', label: 'Organizational Learning', icon: BookOpen },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 조직 개편/팀 생성·삭제/인사 이동/승진/해고/평가/보상/KPI·Budget·Strategy·Governance·Production 변경/Merge/Deploy 없음 — 모든 반환 flag(organization_changed/personnel_changed/promotion_applied 등) 항상 false',
  'Organization Candidate ≠ Organization Change — 생성은 draft, 종결(archived_reference) 재결정 차단',
  'Organizational Health ≠ HR Evaluation · Capability Gap ≠ Employee Performance — 개인 평가/랭킹 category 서버 차단',
  'Operating Maturity ≠ Organizational Success · Bottleneck ≠ Root Cause · Collaboration Score ≠ Team Quality',
  'Improvement Candidate ≠ Approved Improvement — Evidence 없는 Improvement/Recommendation 서버 차단',
  'Organization Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 최종 조직 변경은 사람',
  '실제 조직도/HR/Payroll/근태/협업 도구/성과 평가 시스템 피드 부재(실측) — insufficient_data 유지, 본 계층은 관측·분석용이며 인사 시스템이 아님',
  '기존 조직 관련 원장은 ai_organizational_learnings(0515)/ai_org_memory(0531)뿐 — 참조만 하며 원본 무변경',
  'Migration 0472~0552 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function OrganizationIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseOrganizationSummary>({});
  const [models, setModels] = useState<EnterpriseOrganizationModelRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseOperatingReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseOrganizationEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selModel, setSelModel] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('engineering');
  const [matDimSel, setMatDimSel] = useState<string>('process_consistency');
  const [capDomSel, setCapDomSel] = useState<string>('leadership');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, m, r, a] = await Promise.all([
        fetchEnterpriseOrganizationSummary(), fetchEnterpriseOrganizationModels(null, null, 200),
        fetchEnterpriseOperatingReviews(null, 200), fetchEnterpriseOrganizationAudit(200),
      ]);
      setSummary(s); setModels(m); setReviews(r); setAudit(a);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const modelReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selModel) { if (!selModel) toast.error('Organization Model 선택 필수'); return; }
    void act(() => reviewEnterpriseOrganizationModel(selModel, action, r, payload), ok);
  };
  const opReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Operating Review 선택 필수'); return; }
    void act(() => reviewEnterpriseOperatingReview(selReview, action, r, payload), ok);
  };
  const orgEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { model?: boolean; review?: boolean } = { model: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseOrganizationEvent(kind, r, payload, ids.model ? (selModel || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildOrganizationTimeline({ present: {
    enterprise_vision: (num('organization_actuals', 'investment_portfolios_0550') ?? 0) > 0,
    operating_model: (num('models', 'total') ?? 0) > 0,
    organization_structure: (num('organization_events', 'team_structures') ?? 0) > 0,
    role_responsibility: (num('organization_events', 'role_mappings') ?? 0) + (num('organization_events', 'responsibility_matrices') ?? 0) > 0,
    decision_flow: (num('organization_events', 'decision_flow_reviews') ?? 0) > 0,
    cross_functional_collaboration: (num('organization_events', 'collaboration_reviews') ?? 0) > 0,
    organizational_health: (num('organization_events', 'health_reviews') ?? 0) > 0,
    operating_maturity: (num('organization_events', 'maturity_reviews') ?? 0) > 0,
    bottleneck_detection: (num('organization_events', 'bottleneck_reviews') ?? 0) > 0,
    capability_gap: (num('organization_events', 'capability_gap_reviews') ?? 0) > 0,
    improvement_candidate: (num('organization_events', 'improvement_candidates') ?? 0) > 0,
    executive_organization_review: (num('organization_events', 'organization_review_requests') ?? 0) + (num('organization_events', 'executive_review_requests') ?? 0) + (num('organization_events', 'operating_review_requests') ?? 0) + (num('organization_events', 'review_references') ?? 0) > 0,
    operating_learning: (num('organization_events', 'learning_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Organizational Intelligence & Operating Model Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Organizational Intelligence & Operating Model Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const modelSelect = (
    <select value={selModel} onChange={(e) => setSelModel(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Organization Model 선택</option>
      {models.map((m) => <option key={m.id} value={m.id}>{m.organization_code} · {m.organization_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Operating Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('excellent') || s.includes('healthy_candidate') || s.includes('highly_mature') || s.includes('mature_candidate') || s.includes('minimal_gap') || s.includes('strong_collaboration') || s.includes('fast_decision') || s.includes('balanced_workload') || s.includes('no_material') || s.includes('active_reference') || s.includes('review_reference_recorded') ? 'success' as const : s.includes('unhealthy') || s.includes('critical') || s.includes('siloed') || s.includes('blocked') || s.includes('overloaded') || s.includes('immature') || s.includes('significant_gap') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseOrganizationEventRow[], emptyTitle: string, emptyDesc: string) => (
    !rows.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {rows.slice(0, 30).map((e) => (
          <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(String(e.payload?.result ?? e.event_type))}>{e.event_type}</AdminBadge>
            <span className="ml-2">{e.detail}</span>
            <span className="ml-2 text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const modelList = (list: EnterpriseOrganizationModelRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((m) => (
          <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(m.organization_status)}>{m.organization_status}</AdminBadge>
            <AdminBadge tone={tone(m.health_status)}>{m.health_status}</AdminBadge>
            <AdminBadge tone={tone(m.capability_gap_status)}>{m.capability_gap_status}</AdminBadge>
            <span className="ml-2 font-bold">{m.organization_code}</span>
            <span className="ml-2 text-muted-foreground">{m.organization_category} · {m.organization_name} · maturity {m.maturity_status} · roles {Array.isArray(m.role_matrix) ? m.role_matrix.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseOperatingReviewRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.review_status)}>{r.review_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.review_code}</span>
            <span className="ml-2 text-muted-foreground">{r.review_type} · findings {Array.isArray(r.findings) ? r.findings.length : 0}건 · {r.review_summary ?? '—'}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}, ids: { model?: boolean; review?: boolean } = { model: true }) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {ids.model ? modelSelect : null}{ids.review ? reviewSelect : null}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => orgEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`, ids), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Organizational Intelligence & Operating Model Center"
      subtitle="Enterprise Vision→Operating Model→Organization Structure→Role & Responsibility→Decision Flow→Collaboration→Health→Maturity→Bottleneck→Capability Gap→Improvement→Executive Review→Learning — 최종 조직/운영 변경은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 조직과 운영 모델을 분석하고 개선 후보를 제안하는 Organizational Intelligence 계층입니다. AI 는 Organization Model 구조화·Team Structure/Role Matrix/Responsibility 기록·Decision Flow/Collaboration/Health/Maturity/Bottleneck/Capability Gap/Workload/Dependency/SPOF 분석·Scenario/Improvement Candidate·Executive Summary/Scorecard·Recommendation·Review 요청까지만 수행하며, 자동 조직 개편·자동 팀 생성/삭제·자동 인사 이동·자동 승진/해고·자동 평가/보상·자동 KPI/Budget/Strategy/Governance/Production 변경·자동 Merge/Deploy 는 수행하지 않습니다. Organization Candidate ≠ Organization Change, Organizational Health ≠ HR Evaluation, Capability Gap ≠ Employee Performance, Collaboration Score ≠ Team Quality, Review ≠ Approval. AI 는 조직을 설명한다. 사람이 조직을 결정한다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Organization Models" value={NUM(num('models', 'total'))} />
            <Box label="Draft / Active / In Review / Archived" value={`${NUM(num('models', 'draft'))} / ${NUM(num('models', 'active'))} / ${NUM(num('models', 'in_review'))} / ${NUM(num('models', 'archived'))}`} />
            <Box label="Healthy / Unhealthy Candidates" value={`${NUM(num('models', 'healthy'))} / ${NUM(num('models', 'unhealthy'))}`} />
            <Box label="Mature / Critical Gap Candidates" value={`${NUM(num('models', 'mature'))} / ${NUM(num('models', 'critical_gap'))}`} />
            <Box label="Operating Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Team Structures / Role Mappings" value={`${NUM(num('organization_events', 'team_structures'))} / ${NUM(num('organization_events', 'role_mappings'))}`} />
            <Box label="Responsibility / Decision Flow Reviews" value={`${NUM(num('organization_events', 'responsibility_matrices'))} / ${NUM(num('organization_events', 'decision_flow_reviews'))}`} />
            <Box label="Collaboration / Health Reviews" value={`${NUM(num('organization_events', 'collaboration_reviews'))} / ${NUM(num('organization_events', 'health_reviews'))}`} />
            <Box label="Maturity / Capability Gap Reviews" value={`${NUM(num('organization_events', 'maturity_reviews'))} / ${NUM(num('organization_events', 'capability_gap_reviews'))}`} />
            <Box label="Bottleneck / Workload / Dependency / SPOF" value={`${NUM(num('organization_events', 'bottleneck_reviews'))} / ${NUM(num('organization_events', 'workload_reviews'))} / ${NUM(num('organization_events', 'dependency_reviews'))} / ${NUM(num('organization_events', 'spof_reviews'))}`} />
            <Box label="Scenarios / Improvement Candidates" value={`${NUM(num('organization_events', 'scenarios'))} / ${NUM(num('organization_events', 'improvement_candidates'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('organization_events', 'summaries'))} / ${NUM(num('organization_events', 'scorecards'))} / ${NUM(num('organization_events', 'recommendations'))}`} />
            <Box label="Organization / Executive / Operating Review 요청" value={`${NUM(num('organization_events', 'organization_review_requests'))} / ${NUM(num('organization_events', 'executive_review_requests'))} / ${NUM(num('organization_events', 'operating_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('organization_events', 'review_references'))} />
            <Box label="Governance / Resource Links / Learning" value={`${NUM(num('organization_events', 'governance_links'))} / ${NUM(num('organization_events', 'resource_links'))} / ${NUM(num('organization_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`organization_unavailable: ${Array.isArray(summary.organization_unavailable) ? (summary.organization_unavailable as unknown[]).map(String).join(', ') : '—'}. Organization 원천 실측 — Governance Decisions(0551) ${NUM(num('organization_actuals', 'governance_decisions_0551'))}건 · Investment Portfolios(0550) ${NUM(num('organization_actuals', 'investment_portfolios_0550'))}건 · Programs(0547) ${NUM(num('organization_actuals', 'execution_programs_0547'))}건 · Resources(0546) ${NUM(num('organization_actuals', 'resource_inventory_0546'))}건 · Commitments(0520) ${NUM(num('organization_actuals', 'commitments_0520'))}건 · Organizational Learnings(0515) ${NUM(num('organization_actuals', 'organizational_learnings_0515'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'models' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ORGANIZATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Organization Model 생성(≠ 조직 개편)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseOrganizationModel({ organization_category: catSel, organization_name: r }), 'Organization Model 생성됨(draft — 자동 개편 없음)');
            }, true)}
            {btn('Active Reference', () => modelReview('activate_reference', {}, 'active_reference(≠ 조직 변경 확정)'))}
            {btn('Review Reference', () => modelReview('mark_review_reference', {}, 'review_reference'))}
            {btn('Archive', () => modelReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => modelReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {modelSelect}
          </div>
          <AdminAlert tone="info" description="Category 16종 · 자동 개편/인사/개인 평가 계열 category 서버 차단 · archived 재결정 차단." />
          {modelList(models, 'Organization Model 없음', '핵심 질문 예: 조직 구조가 전략 실행에 적합한가? 병목은 어디인가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'structure' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Team Structure 기록', () => orgEvent('team_structure_recorded', { note: reason.trim() }, 'Team Structure 기록됨(≠ 조직 개편)'), true)}
          </div>
          <AdminAlert tone="info" description="Team Structure Candidate ≠ 조직 개편 — 관측된 팀 구조를 구조화한 기록입니다." />
          {eventList(evByType('team_structure_recorded'), 'Team Structure 없음', '팀 구조 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'rolematrix' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Role Mapping 기록', () => orgEvent('role_mapping_recorded', { note: reason.trim() }, 'Role Mapping 기록됨(개인 평가 아님)'), true)}
          </div>
          <AdminAlert tone="warning" description="Role Matrix — 역할/책임 관측 기록이며 개인 성과 평가에 사용하지 않습니다." />
          {eventList(evByType('role_mapping_recorded'), 'Role Mapping 없음', '역할 매핑 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'responsibility' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Responsibility Matrix 기록', () => orgEvent('responsibility_matrix_recorded', { note: reason.trim() }, 'Responsibility Matrix 기록됨(≠ 인사 발령)'), true)}
          </div>
          <AdminAlert tone="info" description="Responsibility Matrix ≠ 인사 발령 — 책임 소재 관측 기록입니다." />
          {eventList(evByType('responsibility_matrix_recorded'), 'Responsibility Matrix 없음', '책임 매트릭스 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'decisionflow' && resultEventTab('decision_flow_reviewed', 'Decision Flow 검토', 'Decision Flow Candidate ≠ 자동 프로세스 변경 — 의사결정 경로/속도 관측 후보입니다.', DECISION_FLOW_RESULTS)}
      {tab === 'collaboration' && resultEventTab('collaboration_network_reviewed', 'Collaboration Network 검토', 'Collaboration Score ≠ Team Quality — 협업 그래프/지연 관측 후보입니다.', COLLABORATION_RESULTS)}
      {tab === 'health' && resultEventTab('organizational_health_reviewed', 'Organizational Health 검토', 'Health 5단계(§5) — Organizational Health ≠ HR Evaluation, 개인 평가에 사용하지 않습니다.', ORG_HEALTH_RESULTS)}
      {tab === 'maturity' && (
        <>
          {resultEventTab('operating_maturity_reviewed', 'Operating Maturity 검토', 'Maturity 6차원(§6 — Process Consistency/Decision Speed/Collaboration/Ownership Clarity/Capability Coverage/Governance Alignment) — Operating Maturity ≠ Organizational Success.', OPERATING_MATURITY_RESULTS, { maturity_dimension: matDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Maturity Dimension:</span>
            <select value={matDimSel} onChange={(e) => setMatDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {OPERATING_MATURITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'capgap' && (
        <>
          {resultEventTab('capability_gap_reviewed', 'Capability Gap 검토', 'Capability 7도메인(§7 — Leadership/Technical/Operational/Business/AI/Security/Compliance) — Capability Gap ≠ Employee Performance.', CAPABILITY_GAP_RESULTS, { capability_domain: capDomSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Capability Domain:</span>
            <select value={capDomSel} onChange={(e) => setCapDomSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CAPABILITY_GAP_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'bottleneck' && resultEventTab('bottleneck_reviewed', 'Bottleneck 검토', 'Bottleneck ≠ Root Cause — 병목 후보이며 원인 확정/책임 추궁이 아닙니다.', BOTTLENECK_RESULTS)}
      {tab === 'workload' && resultEventTab('workload_balance_reviewed', 'Workload Balance 검토', 'Workload Candidate ≠ 개인 평가/재배치 신호 — 역할 과부하 관측 후보입니다.', WORKLOAD_RESULTS)}
      {tab === 'dependency' && resultEventTab('dependency_reviewed', 'Dependency 검토', 'Dependency Candidate ≠ 자동 조정 — 팀 간 의존 관측 후보입니다.', ORG_DEPENDENCY_RESULTS)}
      {tab === 'spof' && resultEventTab('single_point_of_failure_reviewed', 'SPOF 검토', 'SPOF Candidate ≠ 개인 책임 추궁 — 단일 실패 지점 관측 후보입니다.', SPOF_RESULTS)}

      {tab === 'scenario' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Organization Scenario 기록', () => orgEvent('organizational_scenario_recorded', { note: reason.trim() }, 'Scenario 기록됨(≠ Organization Change)'), true)}
          </div>
          <AdminAlert tone="info" description="Scenario ≠ Organization Change — 가정 기반 시나리오 후보이며 실행이 아닙니다." />
          {eventList(evByType('organizational_scenario_recorded'), 'Scenario 없음', '조직 시나리오 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'improvement' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Improvement Candidate 기록(Evidence 필수)', () => orgEvent('improvement_candidate_recorded', { note: reason.trim(), evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Improvement Candidate 기록됨(≠ Approved Improvement)'), true)}
          </div>
          <AdminAlert tone="warning" description="Improvement Candidate ≠ Approved Improvement — Evidence 없는 기록 서버 차단, 채택은 사람이 결정합니다." />
          {eventList(evByType('improvement_candidate_recorded'), 'Improvement Candidate 없음', '개선 후보 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Executive Organization Summary 기록', () => orgEvent('executive_organization_summary_recorded', { note: reason.trim() }, 'Summary 기록됨(≠ 조직 평가 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive Summary ≠ 조직 평가 확정 — 경영진 판단 보조 자료입니다." />
          {eventList(evByType('executive_organization_summary_recorded'), 'Summary 없음', 'Executive Organization Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Organization Scorecard 기록', () => orgEvent('executive_organization_scorecard_recorded', { fields: [...ORG_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ HR 평가)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${ORG_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ HR 평가(unhealthy/critical gap 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_organization_scorecard_recorded'), 'Scorecard 없음', 'Executive Organization Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ORG_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => orgEvent('organization_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Organization Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('organization_recommendation_recorded'), 'Recommendation 없음', 'Organization Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Organization Review 요청', () => {
              const r = needReason();
              if (!r || !selModel) { if (!selModel) toast.error('Organization Model 선택 필수'); return; }
              void act(() => createEnterpriseOperatingReview({ organization_model_id: selModel, review_type: 'organization_review', review_summary: r }), 'Organization Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selModel) { if (!selModel) toast.error('Organization Model 선택 필수'); return; }
              void act(() => createEnterpriseOperatingReview({ organization_model_id: selModel, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Operating Review 요청', () => {
              const r = needReason();
              if (!r || !selModel) { if (!selModel) toast.error('Organization Model 선택 필수'); return; }
              void act(() => createEnterpriseOperatingReview({ organization_model_id: selModel, review_type: 'operating_review', review_summary: r }), 'Operating Review 요청됨(≠ Approval)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => opReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => opReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => opReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => opReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Operating Review(§9 — organization/executive/operating 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 최종 조직 변경은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/조직 변경이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('organization_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Portfolio Link(0545 실존 검증)', () => orgEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'), true)}
            {btn('Program Link(0547)', () => orgEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Governance Link(0551)', () => orgEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(≠ 승인)'))}
            {btn('Resource Link(0546)', () => orgEvent('resource_reference_linked', { note: reason.trim() }, 'Resource Link 기록됨(≠ 인력 배치)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0545/0546/0547/0551). Link ≠ 승인/배치/조직 변경." />
          {eventList([...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('resource_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {modelSelect}{reasonInput}
            {btn('Organizational Learning 기록', () => orgEvent('organizational_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 조직 변경 — 학습 반영 여부는 사람이 결정합니다(0515 참조만)." />
          {eventList(evByType('organizational_learning_reference_recorded'), 'Learning Reference 없음', '조직 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Organization 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
          <div className="space-y-1">
            {flowTimeline.map((s) => (
              <div key={s.stage} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.present ? 'success' : 'warning'}>{s.present ? '관측됨' : '미관측'}</AdminBadge>
                <span className="font-bold">{s.stage}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`Organization 이벤트 31종 통합 Audit — 총 ${NUM(num('organization_events', 'total'))}건. 자동 개편 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Organizational Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_ORGANIZATION_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 개편/인사/승진/해고/보상 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_ORGANIZATION_SUPPORT_MATRIX.map((e) => (
              <div key={e.capability} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.capability}</span>
                <AdminBadge tone={e.support === 'unavailable' ? 'danger' : e.support === 'fully_supported' ? 'success' : 'warning'}>{e.support}</AdminBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l) => (
            <div key={l} className="rounded-lg border border-border p-2 text-[11px]">{l}</div>
          ))}
        </div>
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
