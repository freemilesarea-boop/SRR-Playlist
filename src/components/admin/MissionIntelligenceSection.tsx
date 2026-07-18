/**
 * MissionIntelligenceSection — Enterprise Mission Intelligence, Objective
 * Alignment & Strategic Outcome Center (Phase AI-OPS-51).
 *
 * Enterprise Vision→Enterprise Mission→Strategic Objectives→Enterprise OKRs→
 * Cross-Organization Alignment→Initiative/Execution/Performance/Business
 * Outcome Alignment→Mission Drift Detection→Strategic Outcome→Executive
 * Mission Review→Mission Learning→Audit.
 * Mission Alignment ≠ Mission Success · Objective Alignment ≠ Achievement ·
 * Strategic Outcome ≠ Business Success · Mission Drift ≠ Organizational
 * Failure. 자동 Mission/Vision/OKR/KPI/Strategy 변경 없음.
 * (기존 MissionControlSection(0478 통합 관제) 과 별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Compass, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseMissionSummary, fetchEnterpriseMissions, createEnterpriseMission,
  reviewEnterpriseMission, createEnterpriseObjectiveAlignment,
  reviewEnterpriseObjectiveAlignment, fetchEnterpriseObjectiveAlignments,
  recordEnterpriseMissionEvent, fetchEnterpriseMissionAudit,
  type EnterpriseMissionSummary, type EnterpriseMissionRow,
  type EnterpriseObjectiveAlignmentRow, type EnterpriseMissionEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  MISSION_CATEGORIES, MISSION_ALIGNMENT_DIMENSIONS, MISSION_ALIGNMENT_RESULTS,
  MISSION_DRIFT_DIMENSIONS, MISSION_DRIFT_RESULTS,
  STRATEGIC_OUTCOME_DIMENSIONS, STRATEGIC_OUTCOME_RESULTS,
  ALIGNMENT_TREND_RESULTS, OBJECTIVE_COVERAGE_RESULTS,
  MISSION_RECOMMENDATION_TYPES, MISSION_SCORECARD_FIELDS, buildMissionTimeline,
  ENTERPRISE_MISSION_COMPONENTS, ENTERPRISE_MISSION_SUPPORT_MATRIX,
} from '@/lib/enterpriseMission';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'missions' | 'objectives' | 'okr' | 'alignments' | 'initiative' | 'kpi'
  | 'portfolio' | 'organization' | 'value' | 'execution' | 'alignment' | 'drift' | 'outcome'
  | 'trend' | 'coverage' | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Mission Overview', icon: Layers },
  { key: 'missions', label: 'Mission Models', icon: Compass },
  { key: 'objectives', label: 'Strategic Objectives', icon: ClipboardList },
  { key: 'okr', label: 'OKR Alignment', icon: Gauge },
  { key: 'alignments', label: 'Objective Alignments', icon: GitBranch },
  { key: 'initiative', label: 'Initiative Alignment', icon: Activity },
  { key: 'kpi', label: 'KPI Alignment', icon: Gauge },
  { key: 'portfolio', label: 'Portfolio Alignment', icon: Grid3x3 },
  { key: 'organization', label: 'Organization Alignment', icon: Users },
  { key: 'value', label: 'Value Alignment', icon: Activity },
  { key: 'execution', label: 'Execution Alignment', icon: Activity },
  { key: 'alignment', label: 'Mission Alignment', icon: Compass },
  { key: 'drift', label: 'Mission Drift', icon: Search },
  { key: 'outcome', label: 'Strategic Outcome', icon: Shield },
  { key: 'trend', label: 'Alignment Trend', icon: History },
  { key: 'coverage', label: 'Objective Coverage', icon: Search },
  { key: 'summary', label: 'Executive Mission Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Mission Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Mission Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'learning', label: 'Mission Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Mission/Vision 자동 변경·OKR 자동 생성·KPI/Strategy/Governance/Budget/Organization/Portfolio 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(mission_changed/vision_changed/okr_generated 등) 항상 false',
  'Mission Alignment ≠ Mission Success · Objective Alignment ≠ Objective Achievement — Evidence 없는 Alignment 기록 서버 차단',
  'Strategic Outcome ≠ Business Success · Mission Drift ≠ Organizational Failure · Alignment Score ≠ Executive Judgment',
  'Mission Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Mission 변경은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0524 Vision/0545 Portfolio/0547 Program/0548 KPI/0549 Value/0550 Investment/0552 Organization)',
  'OKR Mapping 은 기존 기록의 관측 매핑만 — OKR 시스템 원장 부재(실측), OKR 자동 생성 없음',
  '공식 Mission 헌장 원장/이사회 의사록/직원 서베이/시장 조사/ESG 리포팅 피드 부재(실측) — insufficient_data 유지',
  'Vision/Objective 기록은 ai_corporate_vision_records/ai_corporate_objectives(0524) 참조만 — 원본 무변경',
  'Migration 0472~0555 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function MissionIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseMissionSummary>({});
  const [missions, setMissions] = useState<EnterpriseMissionRow[]>([]);
  const [alignments, setAlignments] = useState<EnterpriseObjectiveAlignmentRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseMissionEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selMission, setSelMission] = useState('');
  const [selAlignment, setSelAlignment] = useState('');
  const [catSel, setCatSel] = useState<string>('strategic');
  const [dimSel, setDimSel] = useState<string>('strategy_alignment');
  const [driftDimSel, setDriftDimSel] = useState<string>('objective_drift');
  const [outcomeDimSel, setOutcomeDimSel] = useState<string>('mission_coverage');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, m, a, ev] = await Promise.all([
        fetchEnterpriseMissionSummary(), fetchEnterpriseMissions(null, null, 200),
        fetchEnterpriseObjectiveAlignments(null, 200), fetchEnterpriseMissionAudit(200),
      ]);
      setSummary(s); setMissions(m); setAlignments(a); setAudit(ev);
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
  const mReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selMission) { if (!selMission) toast.error('Mission 선택 필수'); return; }
    void act(() => reviewEnterpriseMission(selMission, action, r, payload), ok);
  };
  const oaReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selAlignment) { if (!selAlignment) toast.error('Objective Alignment 선택 필수'); return; }
    void act(() => reviewEnterpriseObjectiveAlignment(selAlignment, action, r, payload), ok);
  };
  const mEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { mission?: boolean; alignment?: boolean } = { mission: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseMissionEvent(kind, r, payload, ids.mission ? (selMission || null) : null, ids.alignment ? (selAlignment || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildMissionTimeline({ present: {
    enterprise_vision: (num('mission_actuals', 'corporate_visions_0524') ?? 0) > 0,
    enterprise_mission: (num('missions', 'total') ?? 0) > 0,
    strategic_objectives: (num('mission_events', 'objective_mappings') ?? 0) > 0,
    enterprise_okrs: (num('mission_events', 'okr_mappings') ?? 0) > 0,
    cross_organization_alignment: (num('mission_events', 'organization_reviews') ?? 0) > 0,
    initiative_alignment: (num('mission_events', 'initiative_reviews') ?? 0) > 0,
    execution_alignment: (num('mission_events', 'execution_reviews') ?? 0) > 0,
    performance_alignment: (num('mission_events', 'kpi_reviews') ?? 0) > 0,
    business_outcome_alignment: (num('mission_events', 'value_reviews') ?? 0) > 0,
    mission_drift_detection: (num('mission_events', 'drift_reviews') ?? 0) > 0,
    strategic_outcome: (num('mission_events', 'outcome_reviews') ?? 0) > 0,
    executive_mission_review: (num('mission_events', 'mission_review_requests') ?? 0) + (num('mission_events', 'executive_review_requests') ?? 0) + (num('mission_events', 'strategic_review_requests') ?? 0) + (num('mission_events', 'review_references') ?? 0) > 0,
    mission_learning: (num('mission_events', 'learnings') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Mission Intelligence & Strategic Outcome Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Mission Intelligence & Strategic Outcome Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const missionSelect = (
    <select value={selMission} onChange={(e) => setSelMission(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Mission 선택</option>
      {missions.map((m) => <option key={m.id} value={m.id}>{m.mission_code} · {m.mission_status}</option>)}
    </select>
  );
  const alignmentSelect = (
    <select value={selAlignment} onChange={(e) => setSelAlignment(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Objective Alignment 선택</option>
      {alignments.map((a) => <option key={a.id} value={a.id}>{a.alignment_code} · {a.record_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('highly_aligned') || s.includes('aligned_candidate') || s.includes('stable') || s.includes('strongly_supported') || s.includes('full_coverage') || s.includes('improving') || s.includes('active_reference') || s.includes('review_reference_recorded') ? 'success' as const : s.includes('misaligned') || s.includes('critical_drift') || s.includes('unsupported') || s.includes('uncovered') || s.includes('declining') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseMissionEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const missionList = (list: EnterpriseMissionRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((m) => (
          <div key={m.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(m.mission_status)}>{m.mission_status}</AdminBadge>
            <AdminBadge tone={tone(m.alignment_status)}>{m.alignment_status}</AdminBadge>
            <AdminBadge tone={tone(m.drift_status)}>{m.drift_status}</AdminBadge>
            <span className="ml-2 font-bold">{m.mission_code}</span>
            <span className="ml-2 text-muted-foreground">{m.mission_category} · {m.mission_name} · objectives {Array.isArray(m.objective_mappings) ? m.objective_mappings.length : 0}건 · OKR {Array.isArray(m.okr_mappings) ? m.okr_mappings.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const alignmentList = (list: EnterpriseObjectiveAlignmentRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((a) => (
          <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(a.record_status)}>{a.record_status}</AdminBadge>
            <AdminBadge tone={tone(a.alignment_status)}>{a.alignment_status}</AdminBadge>
            <span className="ml-2 font-bold">{a.alignment_code}</span>
            <span className="ml-2 text-muted-foreground">{a.alignment_dimension} · {a.objective_name} · evidence {Array.isArray(a.evidence) ? a.evidence.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {missionSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => mEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Mission Intelligence & Strategic Outcome Center"
      subtitle="Enterprise Mission→Strategic Objectives→OKR/Initiative/KPI/Portfolio/Organization/Value/Execution Alignment→Mission Drift→Strategic Outcome→Executive Review→Learning — Mission 과 Strategy 변경은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 의 모든 전략·조직·Portfolio·Execution·Business Value 가 Mission 과 얼마나 정렬되어 있는지 분석하는 Mission Intelligence 계층입니다. AI 는 Mission Model 생성·Objective/OKR Mapping·Initiative/KPI/Portfolio/Organization/Value/Execution Alignment 분석·Mission Drift Detection·Strategic Outcome/Trend 분석·Executive Summary/Scorecard·Recommendation·Review 요청·Learning 기록까지만 수행하며, Mission 자동 변경·Vision 자동 변경·OKR 자동 생성·KPI/Strategy/Governance/Budget/Organization/Portfolio 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Mission Alignment ≠ Mission Success, Objective Alignment ≠ Objective Achievement, Strategic Outcome ≠ Business Success, Mission Drift ≠ Organizational Failure. AI 는 Mission Alignment 를 설명하고 개선 후보를 제안합니다. 사람이 Mission 과 Strategy 를 변경하고 책임집니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Mission Models" value={NUM(num('missions', 'total'))} />
            <Box label="Draft / Candidate / Active / Archived" value={`${NUM(num('missions', 'draft'))} / ${NUM(num('missions', 'candidate'))} / ${NUM(num('missions', 'active'))} / ${NUM(num('missions', 'archived'))}`} />
            <Box label="Aligned / Misaligned Candidates" value={`${NUM(num('missions', 'aligned'))} / ${NUM(num('missions', 'misaligned'))}`} />
            <Box label="Drifting / Unsupported Candidates" value={`${NUM(num('missions', 'drifting'))} / ${NUM(num('missions', 'unsupported'))}`} />
            <Box label="Objective Alignments" value={NUM(num('alignments', 'total'))} />
            <Box label="Recorded / Under Review / Reference / Revision" value={`${NUM(num('alignments', 'recorded'))} / ${NUM(num('alignments', 'under_review'))} / ${NUM(num('alignments', 'reference_recorded'))} / ${NUM(num('alignments', 'revision_requested'))}`} />
            <Box label="Misaligned Objective Alignments" value={NUM(num('alignments', 'misaligned'))} />
            <Box label="Objective / OKR Mappings" value={`${NUM(num('mission_events', 'objective_mappings'))} / ${NUM(num('mission_events', 'okr_mappings'))}`} />
            <Box label="Initiative / KPI / Portfolio Reviews" value={`${NUM(num('mission_events', 'initiative_reviews'))} / ${NUM(num('mission_events', 'kpi_reviews'))} / ${NUM(num('mission_events', 'portfolio_reviews'))}`} />
            <Box label="Organization / Value / Execution Reviews" value={`${NUM(num('mission_events', 'organization_reviews'))} / ${NUM(num('mission_events', 'value_reviews'))} / ${NUM(num('mission_events', 'execution_reviews'))}`} />
            <Box label="Mission Alignment / Drift / Outcome" value={`${NUM(num('mission_events', 'mission_alignment_reviews'))} / ${NUM(num('mission_events', 'drift_reviews'))} / ${NUM(num('mission_events', 'outcome_reviews'))}`} />
            <Box label="Trend / Coverage Reviews" value={`${NUM(num('mission_events', 'trend_reviews'))} / ${NUM(num('mission_events', 'coverage_reviews'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('mission_events', 'summaries'))} / ${NUM(num('mission_events', 'scorecards'))} / ${NUM(num('mission_events', 'recommendations'))}`} />
            <Box label="Mission / Executive / Strategic Review 요청" value={`${NUM(num('mission_events', 'mission_review_requests'))} / ${NUM(num('mission_events', 'executive_review_requests'))} / ${NUM(num('mission_events', 'strategic_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('mission_events', 'review_references'))} />
            <Box label="Learnings / KPI / Portfolio Links" value={`${NUM(num('mission_events', 'learnings'))} / ${NUM(num('mission_events', 'kpi_links'))} / ${NUM(num('mission_events', 'portfolio_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`mission_unavailable: ${Array.isArray(summary.mission_unavailable) ? (summary.mission_unavailable as unknown[]).map(String).join(', ') : '—'}. Mission 원천 실측 — Corporate Visions(0524) ${NUM(num('mission_actuals', 'corporate_visions_0524'))}건 · Corporate Objectives(0524) ${NUM(num('mission_actuals', 'corporate_objectives_0524'))}건 · Strategy Portfolios(0545) ${NUM(num('mission_actuals', 'strategy_portfolios_0545'))}건 · KPIs(0548) ${NUM(num('mission_actuals', 'enterprise_kpis_0548'))}건 · Investment Portfolios(0550) ${NUM(num('mission_actuals', 'investment_portfolios_0550'))}건 · Organization Models(0552) ${NUM(num('mission_actuals', 'organization_models_0552'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'missions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MISSION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Mission Model 생성(≠ Mission 변경)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseMission({ mission_category: catSel, mission_name: r }), 'Mission Model 생성됨(draft — 자동 Mission 변경 없음)');
            }, true)}
            {btn('Candidate 표시', () => mReview('mark_candidate', {}, 'candidate'))}
            {btn('Active Reference', () => mReview('activate_reference', {}, 'active_reference(≠ Mission 확정)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => mReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'))}
            {btn('Archive', () => mReview('archive_reference', {}, 'archived_reference'))}
            {missionSelect}
          </div>
          <AdminAlert tone="info" description="Category 14종 · 자동 Mission/Vision/OKR 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {missionList(missions, 'Mission Model 없음', '핵심 질문 예: Enterprise 는 Mission 과 얼마나 정렬되어 있는가? 어떤 조직이 Drift 를 보이는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'objectives' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('Strategic Objective Mapping 기록', () => mEvent('strategic_objective_mapped', { note: reason.trim() }, 'Objective Mapping 기록됨(≠ Objective 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Objective Mapping — Mission Tree 에 연결된 목표 관측 기록이며 목표 확정이 아닙니다." />
          {eventList(evByType('strategic_objective_mapped'), 'Objective Mapping 없음', '전략 목표 매핑이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'okr' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('OKR Mapping 기록(기존 기록만)', () => mEvent('okr_mapped', { note: reason.trim() }, 'OKR Mapping 기록됨(≠ OKR 자동 생성)'), true)}
          </div>
          <AdminAlert tone="warning" description="OKR Mapping ≠ OKR 자동 생성 — OKR 시스템 원장 부재(실측), 기존 기록의 관측 매핑만 수행합니다." />
          {eventList(evByType('okr_mapped'), 'OKR Mapping 없음', 'OKR 매핑 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'alignments' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}
            <select value={dimSel} onChange={(e) => setDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MISSION_ALIGNMENT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {reasonInput}
            {btn('Objective Alignment 기록(Evidence 필수)', () => {
              const r = needReason();
              if (!r || !selMission) { if (!selMission) toast.error('Mission 선택 필수'); return; }
              void act(() => createEnterpriseObjectiveAlignment({ mission_id: selMission, alignment_dimension: dimSel, objective_name: r, evidence: [{ type: 'manual_review', note: r }] }), 'Objective Alignment 기록됨(≠ Achievement)');
            }, true)}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {alignmentSelect}
            <select value={MISSION_ALIGNMENT_RESULTS.includes(resultSel as (typeof MISSION_ALIGNMENT_RESULTS)[number]) ? resultSel : MISSION_ALIGNMENT_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MISSION_ALIGNMENT_RESULTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {btn('검토 시작', () => oaReview('mark_under_review', {}, 'under_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => oaReview('record_review_reference', { result: MISSION_ALIGNMENT_RESULTS.includes(resultSel as (typeof MISSION_ALIGNMENT_RESULTS)[number]) ? resultSel : MISSION_ALIGNMENT_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ 달성 확정)'), true)}
            {btn('수정 요청', () => oaReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => oaReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Objective Alignment(§5 — 6차원) — Evidence 없는 기록 서버 차단 · Self-Review 차단 · 종결 재결정 차단 · Alignment ≠ Achievement." />
          {alignmentList(alignments, 'Objective Alignment 없음', '목표 정렬 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'initiative' && resultEventTab('initiative_alignment_reviewed', 'Initiative Alignment 검토', 'Initiative Alignment ≠ 실행 보장 — Objective 없는 Initiative/Initiative 없는 Objective 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'kpi' && resultEventTab('kpi_alignment_reviewed', 'KPI Alignment 검토', 'KPI Alignment ≠ KPI 변경 — Strategic Outcome 에 기여하지 못하는 KPI 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'portfolio' && resultEventTab('portfolio_alignment_reviewed', 'Portfolio Alignment 검토', 'Portfolio Alignment ≠ Portfolio 변경 — Mission 에서 벗어나는 Portfolio 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'organization' && resultEventTab('organization_alignment_reviewed', 'Organization Alignment 검토', 'Organization Alignment ≠ 조직 변경 — Cross-Organization 정렬 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'value' && resultEventTab('value_alignment_reviewed', 'Value Alignment 검토', 'Value Alignment ≠ 가치 확정 — Mission 과 연결되지 않는 Business Value 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'execution' && resultEventTab('execution_alignment_reviewed', 'Execution Alignment 검토', 'Execution Alignment ≠ 실행 지시 — 실행 계층의 Mission 정렬 관측 후보.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'alignment' && resultEventTab('mission_alignment_reviewed', 'Mission Alignment 검토', 'Mission Alignment 6평가(§5 — Strategy/Portfolio/Execution/KPI/Organization/Business Value) — Mission Alignment ≠ Mission Success.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'drift' && (
        <>
          {resultEventTab('mission_drift_reviewed', 'Mission Drift 검토', 'Drift 5평가(§6 — Objective/KPI/Portfolio/Execution/Organizational) — Mission Drift ≠ Organizational Failure.', MISSION_DRIFT_RESULTS, { drift_dimension: driftDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Drift Dimension:</span>
            <select value={driftDimSel} onChange={(e) => setDriftDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MISSION_DRIFT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'outcome' && (
        <>
          {resultEventTab('strategic_outcome_reviewed', 'Strategic Outcome 검토', 'Outcome 5분석(§7 — Mission/Outcome Coverage·KPI/Initiative/Value Contribution) — Strategic Outcome ≠ Business Success.', STRATEGIC_OUTCOME_RESULTS, { outcome_dimension: outcomeDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Outcome Dimension:</span>
            <select value={outcomeDimSel} onChange={(e) => setOutcomeDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_OUTCOME_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'trend' && resultEventTab('alignment_trend_reviewed', 'Alignment Trend 검토', 'Trend ≠ Forecast 확정 — 기간별 정렬 추세 관측 후보.', ALIGNMENT_TREND_RESULTS)}
      {tab === 'coverage' && resultEventTab('objective_coverage_reviewed', 'Objective Coverage 검토', 'Coverage Candidate ≠ Objective 달성 — Initiative 없는 Objective 관측 후보.', OBJECTIVE_COVERAGE_RESULTS)}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('Executive Mission Summary 기록', () => mEvent('executive_mission_summary_recorded', { note: reason.trim() }, 'Summary 기록됨(≠ Mission 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive Mission Summary ≠ Mission 확정 — 경영진 판단 보조 자료입니다." />
          {eventList(evByType('executive_mission_summary_recorded'), 'Summary 없음', 'Executive Mission Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('Mission Scorecard 기록', () => mEvent('executive_mission_scorecard_recorded', { fields: [...MISSION_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ Executive Judgment)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${MISSION_SCORECARD_FIELDS.join(', ')}) — Alignment Score ≠ Executive Judgment(misaligned/critical drift 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_mission_scorecard_recorded'), 'Scorecard 없음', 'Executive Mission Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {MISSION_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => mEvent('mission_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Mission Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('mission_recommendation_recorded'), 'Recommendation 없음', 'Mission Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('Mission Review 요청', () => mEvent('mission_review_requested', { note: reason.trim() }, 'Mission Review 요청됨(≠ Approval)'), true)}
            {btn('Executive Review 요청', () => mEvent('executive_review_requested', { note: reason.trim() }, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Strategic Review 요청', () => mEvent('strategic_review_requested', { note: reason.trim() }, 'Strategic Review 요청됨(Mission 변경은 사람)'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — Mission/Executive/Strategic Review 3종 요청만) — Review ≠ Approval. Mission 변경은 반드시 사람이 수행합니다." />
          {eventList([...evByType('mission_review_requested'), ...evByType('executive_review_requested'), ...evByType('strategic_review_requested')], 'Review 요청 없음', 'Mission/Executive/Strategic Review 요청이 여기에 표시됩니다.')}
          {missionList(missions.filter((m) => ['draft', 'candidate'].includes(m.mission_status)), '대기 Mission 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('Mission Learning 기록', () => mEvent('mission_learning_recorded', { note: reason.trim() }, 'Learning 기록됨(≠ 자동 Mission 변경)'), true)}
          </div>
          <AdminAlert tone="info" description="Mission Learning ≠ 자동 Mission 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('mission_learning_recorded'), 'Learning 없음', 'Mission 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {missionSelect}{reasonInput}
            {btn('KPI Link(0548 실존 검증)', () => mEvent('kpi_reference_linked', { note: reason.trim() }, 'KPI Link 기록됨(≠ KPI 변경)'), true)}
            {btn('Portfolio Link(0550)', () => mEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨(≠ Portfolio 변경)'))}
            {btn('Program Link(0547)', () => mEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Organization Link(0552)', () => mEvent('organization_reference_linked', { note: reason.trim() }, 'Organization Link 기록됨(≠ 조직 변경)'))}
            {btn('Value Link(0549)', () => mEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨(≠ 가치 확정)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0547/0548/0549/0550/0552). Link ≠ 변경/확정/승인." />
          {eventList([...evByType('kpi_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('organization_reference_linked'), ...evByType('value_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Mission 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Mission 이벤트 31종 통합 Audit — 총 ${NUM(num('mission_events', 'total'))}건. 자동 Mission 변경 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Mission Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_MISSION_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_MISSION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 Mission/Vision/OKR 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_MISSION_SUPPORT_MATRIX.map((e) => (
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
