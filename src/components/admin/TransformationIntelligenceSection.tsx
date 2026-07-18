/**
 * TransformationIntelligenceSection — Enterprise Transformation Intelligence,
 * Change Management & Organizational Evolution Center (Phase AI-OPS-56).
 *
 * Enterprise Vision→Mission→Strategy→Execution→Value Optimization→
 * Transformation Candidates→Change Impact Analysis→Transformation Readiness→
 * Stakeholder Analysis→Organizational Evolution→Executive Transformation
 * Review→Transformation Learning→Audit.
 * Readiness ≠ Successful Transformation · Change Impact ≠ Actual Outcome ·
 * Priority ≠ Mandatory Order · Evolution ≠ Automatic Change.
 * 자동 조직 개편/인사 이동/전략·Budget·KPI 변경 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, GitBranch, Grid3x3, History, Inbox,
  Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, TrendingUp, Users, Workflow,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseTransformationSummary, fetchEnterpriseTransformations,
  createEnterpriseTransformation, reviewEnterpriseTransformation,
  createEnterpriseTransformationReview, reviewEnterpriseTransformationReview,
  fetchEnterpriseTransformationReviews, recordEnterpriseTransformationEvent,
  fetchEnterpriseTransformationAudit,
  type EnterpriseTransformationSummary, type EnterpriseTransformationRow,
  type EnterpriseTransformationReviewRow, type EnterpriseTransformationEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  TRANSFORMATION_CATEGORIES, CHANGE_IMPACT_DIMENSIONS, CHANGE_IMPACT_RESULTS,
  TRANSFORMATION_READINESS_DIMENSIONS, TRANSFORMATION_READINESS_RESULTS,
  STAKEHOLDER_GROUPS, STAKEHOLDER_RESULTS, CHANGE_RISK_RESULTS, RESISTANCE_RESULTS,
  MISSION_ALIGNMENT_RESULTS, EVOLUTION_RESULTS, TRANSFORMATION_PRIORITY_RESULTS,
  TRANSFORMATION_RECOMMENDATION_TYPES, TRANSFORMATION_SCORECARD_FIELDS,
  buildTransformationTimeline, ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX,
} from '@/lib/enterpriseTransformation';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'transformations' | 'impact' | 'readiness' | 'stakeholder' | 'evolution'
  | 'dependency' | 'priority' | 'risk' | 'resistance' | 'alignment' | 'timeline'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Transformation Overview', icon: Layers },
  { key: 'transformations', label: 'Change Candidates', icon: Workflow },
  { key: 'impact', label: 'Change Impact', icon: Activity },
  { key: 'readiness', label: 'Readiness', icon: TrendingUp },
  { key: 'stakeholder', label: 'Stakeholder Analysis', icon: Users },
  { key: 'evolution', label: 'Organizational Evolution', icon: Workflow },
  { key: 'dependency', label: 'Change Dependencies', icon: GitBranch },
  { key: 'priority', label: 'Transformation Priority', icon: Scale },
  { key: 'risk', label: 'Change Risk', icon: Shield },
  { key: 'resistance', label: 'Resistance Analysis', icon: Shield },
  { key: 'alignment', label: 'Mission Alignment', icon: Scale },
  { key: 'timeline', label: 'Transformation Timeline', icon: History },
  { key: 'summary', label: 'Executive Transformation Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Transformation Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Transformation Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '조직 자동 개편·인사 자동 이동·전략 자동 변경·Budget 자동 변경·KPI 자동 변경·Project 자동 생성·계약 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(reorganization_applied/personnel_moved/strategy_changed 등) 항상 false',
  'Readiness ≠ Successful Transformation · Change Impact ≠ Actual Outcome — 변화 준비도/영향 관측 후보 분석이며 성공 보장이 아닙니다',
  'Priority ≠ Mandatory Order · Organizational Evolution ≠ Automatic Change — Evidence 없는 Change Recommendation 서버 차단',
  'Transformation Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Transformation 실행은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0547/0549/0551/0552/0555/0556/0557/0558/0559)',
  '이름 실측: ai_enterprise_transformations/admin_enterprise_transformation_* 미사용 확인 — 스펙 권장명 그대로 사용(충돌 없음)',
  'HR 정보 시스템/직원 설문/변화관리 도구/조직도 시스템/교육 플랫폼/문화 진단 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Transformation Timeline/Change·Readiness·Stakeholder·Evolution History 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0560 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function TransformationIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseTransformationSummary>({});
  const [transformations, setTransformations] = useState<EnterpriseTransformationRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseTransformationReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseTransformationEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selTransformation, setSelTransformation] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('organization');
  const [impDimSel, setImpDimSel] = useState<string>('organizational_impact');
  const [readyDimSel, setReadyDimSel] = useState<string>('leadership_readiness');
  const [stakeSel, setStakeSel] = useState<string>('executive');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, t, v, a] = await Promise.all([
        fetchEnterpriseTransformationSummary(), fetchEnterpriseTransformations(null, null, 200),
        fetchEnterpriseTransformationReviews(null, 200), fetchEnterpriseTransformationAudit(200),
      ]);
      setSummary(s); setTransformations(t); setReviews(v); setAudit(a);
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
  const tfReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selTransformation) { if (!selTransformation) toast.error('Transformation 선택 필수'); return; }
    void act(() => reviewEnterpriseTransformation(selTransformation, action, r, payload), ok);
  };
  const trReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Transformation Review 선택 필수'); return; }
    void act(() => reviewEnterpriseTransformationReview(selReview, action, r, payload), ok);
  };
  const tfEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { tf?: boolean; review?: boolean } = { tf: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseTransformationEvent(kind, r, payload, ids.tf ? (selTransformation || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('transformation_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('transformation_actuals', 'decision_scenarios_0557') ?? 0) > 0,
      execution: (num('transformation_actuals', 'execution_programs_0547') ?? 0) > 0,
      value_optimization: (num('transformation_actuals', 'value_realizations_0559') ?? 0) > 0,
      transformation_candidates: (num('transformations', 'total') ?? 0) > 0,
      change_impact_analysis: (num('transformation_events', 'impact_reviews') ?? 0) > 0,
      transformation_readiness: (num('transformation_events', 'readiness_reviews') ?? 0) > 0,
      stakeholder_analysis: (num('transformation_events', 'stakeholder_reviews') ?? 0) > 0,
      organizational_evolution: (num('transformation_events', 'evolution_reviews') ?? 0) > 0,
      executive_transformation_review: (num('transformation_events', 'transformation_review_requests') ?? 0) + (num('transformation_events', 'executive_review_requests') ?? 0) + (num('transformation_events', 'human_review_requests') ?? 0) + (num('transformation_events', 'review_references') ?? 0) > 0,
      transformation_learning: (num('transformation_events', 'learnings') ?? 0) > 0,
      audit: (num('transformation_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildTransformationTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Transformation Intelligence & Organizational Evolution Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Transformation Intelligence & Organizational Evolution Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const tfSelect = (
    <select value={selTransformation} onChange={(e) => setSelTransformation(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Transformation 선택</option>
      {transformations.map((t) => <option key={t.id} value={t.id}>{t.transformation_code} · {t.transformation_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Transformation Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('highly_ready') || s.includes('mostly_ready') || s.includes('negligible') || s.includes('low_impact') || s.includes('low_resistance') || s.includes('strongly_aligned') || s.includes('evolution_ready') || s.includes('minimally_affected') || s.includes('review_reference') || s === 'proposed' ? 'success' as const : s.includes('critical') || s.includes('not_ready') || s.includes('high_impact') || s.includes('high_resistance') || s.includes('misaligned') || s.includes('highly_affected') || s.includes('stalled') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseTransformationEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const tfList = (list: EnterpriseTransformationRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(t.transformation_status)}>{t.transformation_status}</AdminBadge>
            <AdminBadge tone={tone(t.impact_status)}>{t.impact_status}</AdminBadge>
            <AdminBadge tone={tone(t.readiness_status)}>{t.readiness_status}</AdminBadge>
            <span className="ml-2 font-bold">{t.transformation_code}</span>
            <span className="ml-2 text-muted-foreground">{t.transformation_category} · {t.transformation_name} · stakeholder {t.stakeholder_status} · reviews {Array.isArray(t.transformation_reviews) ? t.transformation_reviews.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseTransformationReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
  const simpleEventTab = (kind: string, title: string, note: string) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {tfSelect}{reasonInput}
        {btn(`${title} 기록`, () => tfEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {tfSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => tfEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Transformation Intelligence & Organizational Evolution Center"
      subtitle="Transformation Candidates→Change Impact→Readiness→Stakeholder Analysis→Organizational Evolution→Executive Review→Learning — 조직 변경과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 새로운 전략·프로세스·조직 구조·운영 방식으로 변화할 준비가 되어 있는지 분석하는 Transformation Intelligence 계층입니다. AI 는 Transformation Candidate 생성/Change Impact Analysis/Readiness Assessment/Stakeholder Analysis/Organizational Evolution·Dependency·Priority·Risk·Resistance·Alignment 분석/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, 조직 자동 개편·인사 자동 이동·전략 자동 변경·Budget 자동 변경·KPI 자동 변경·Project 자동 생성·계약 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Readiness ≠ Successful Transformation, Change Impact ≠ Actual Outcome, Priority ≠ Mandatory Order, Organizational Evolution ≠ Automatic Change. AI 는 Transformation 을 분석합니다. 사람이 조직을 변경하고 전략을 수정하며 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Transformations" value={NUM(num('transformations', 'total'))} />
            <Box label="Proposed / Candidate / Reference / Archived" value={`${NUM(num('transformations', 'proposed'))} / ${NUM(num('transformations', 'candidate'))} / ${NUM(num('transformations', 'review_reference'))} / ${NUM(num('transformations', 'archived'))}`} />
            <Box label="High / Uncertain Impact" value={`${NUM(num('transformations', 'high_impact'))} / ${NUM(num('transformations', 'uncertain_impact'))}`} />
            <Box label="Ready / Not Ready" value={`${NUM(num('transformations', 'ready'))} / ${NUM(num('transformations', 'not_ready'))}`} />
            <Box label="Highly Affected Stakeholders" value={NUM(num('transformations', 'highly_affected'))} />
            <Box label="Transformation Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Impact / Readiness / Stakeholder Reviews" value={`${NUM(num('transformation_events', 'impact_reviews'))} / ${NUM(num('transformation_events', 'readiness_reviews'))} / ${NUM(num('transformation_events', 'stakeholder_reviews'))}`} />
            <Box label="Evolution / Dependency / Priority" value={`${NUM(num('transformation_events', 'evolution_reviews'))} / ${NUM(num('transformation_events', 'dependency_records'))} / ${NUM(num('transformation_events', 'priority_reviews'))}`} />
            <Box label="Risk / Resistance / Alignment Reviews" value={`${NUM(num('transformation_events', 'risk_reviews'))} / ${NUM(num('transformation_events', 'resistance_reviews'))} / ${NUM(num('transformation_events', 'alignment_reviews'))}`} />
            <Box label="Timelines / Summaries / Scorecards" value={`${NUM(num('transformation_events', 'timelines'))} / ${NUM(num('transformation_events', 'summaries'))} / ${NUM(num('transformation_events', 'scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('transformation_events', 'recommendations'))} />
            <Box label="Transformation / Executive / Human Review 요청" value={`${NUM(num('transformation_events', 'transformation_review_requests'))} / ${NUM(num('transformation_events', 'executive_review_requests'))} / ${NUM(num('transformation_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('transformation_events', 'review_references'))} />
            <Box label="Learnings / Value Links(0559)" value={`${NUM(num('transformation_events', 'learnings'))} / ${NUM(num('transformation_events', 'value_links'))}`} />
            <Box label="Organization Links(0552) / Capacity Links(0558)" value={`${NUM(num('transformation_events', 'organization_links'))} / ${NUM(num('transformation_events', 'capacity_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`transformation_unavailable: ${Array.isArray(summary.transformation_unavailable) ? (summary.transformation_unavailable as unknown[]).map(String).join(', ') : '—'}. Transformation 원천 실측 — Value Realizations(0559) ${NUM(num('transformation_actuals', 'value_realizations_0559'))}건 · Capacity Resources(0558) ${NUM(num('transformation_actuals', 'capacity_resources_0558'))}건 · Organization Models(0552) ${NUM(num('transformation_actuals', 'organization_models_0552'))}건 · Governance Decisions(0551) ${NUM(num('transformation_actuals', 'governance_decisions_0551'))}건 · Missions(0555) ${NUM(num('transformation_actuals', 'missions_0555'))}건 · Environment Observations(0556) ${NUM(num('transformation_actuals', 'environment_observations_0556'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'transformations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRANSFORMATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Transformation 후보 생성(≠ 조직 변경)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseTransformation({ transformation_category: catSel, transformation_name: r }), 'Transformation 후보 생성됨(자동 조직 개편 없음)');
            }, true)}
            {btn('Proposed 표시', () => tfReview('mark_proposed', {}, 'proposed(제안 상태)'))}
            {btn('Candidate 표시', () => tfReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => tfReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => tfReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => tfReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {tfSelect}
          </div>
          <AdminAlert tone="info" description="Category 12종 · 자동 조직 개편/인사 이동/전략·Budget·KPI 변경/Project 생성/계약 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {tfList(transformations, 'Transformation 없음', '핵심 질문 예: 어떤 변화가 가장 높은 Business Value 를 만드는가? 현재 Readiness 는 어느 수준인가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'impact' && (
        <>
          {resultEventTab('change_impact_reviewed', 'Change Impact 검토', 'Impact 5평가(§5 — Organizational/Operational/Financial/Strategic/Cultural) — Change Impact ≠ Actual Outcome.', CHANGE_IMPACT_RESULTS, { impact_dimension: impDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Impact Dimension:</span>
            <select value={impDimSel} onChange={(e) => setImpDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {CHANGE_IMPACT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'readiness' && (
        <>
          {resultEventTab('transformation_readiness_reviewed', 'Transformation Readiness 검토', 'Readiness 5평가(§6 — Leadership/Workforce/Process/Technology/Governance) — Readiness ≠ Successful Transformation.', TRANSFORMATION_READINESS_RESULTS, { readiness_dimension: readyDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Readiness Dimension:</span>
            <select value={readyDimSel} onChange={(e) => setReadyDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRANSFORMATION_READINESS_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'stakeholder' && (
        <>
          {resultEventTab('stakeholder_analysis_reviewed', 'Stakeholder Analysis 검토', 'Stakeholder 5그룹(§7 — Executive/Management/Workforce/Partner/Customer) — Unknown 은 Unknown 으로 유지, 개인 평가 아님.', STAKEHOLDER_RESULTS, { stakeholder_group: stakeSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Stakeholder Group:</span>
            <select value={stakeSel} onChange={(e) => setStakeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STAKEHOLDER_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'evolution' && resultEventTab('organizational_evolution_reviewed', 'Organizational Evolution 검토', 'Organizational Evolution ≠ Automatic Change — 조직 진화 관측 후보입니다.', EVOLUTION_RESULTS)}
      {tab === 'dependency' && simpleEventTab('change_dependency_recorded', 'Change Dependency 기록', 'Change Dependency 는 JSONB 통합 — Dependency ≠ 자동 조정.')}
      {tab === 'priority' && resultEventTab('transformation_priority_reviewed', 'Transformation Priority 검토', 'Priority ≠ Mandatory Order — 우선순위 후보이며 강제 순서가 아닙니다.', TRANSFORMATION_PRIORITY_RESULTS)}
      {tab === 'risk' && resultEventTab('change_risk_reviewed', 'Change Risk 검토', 'Change Risk 관측 ≠ 실패 확정 — 위험 관측 후보입니다.', CHANGE_RISK_RESULTS)}
      {tab === 'resistance' && resultEventTab('resistance_analysis_reviewed', 'Resistance Analysis 검토', '저항 관측 후보 — 개인/조직 판정이 아닙니다.', RESISTANCE_RESULTS)}
      {tab === 'alignment' && resultEventTab('mission_alignment_reviewed', 'Mission Alignment 검토', 'Alignment 관측 ≠ Mission 변경 — Mission 정렬 관측 후보입니다.', MISSION_ALIGNMENT_RESULTS)}
      {tab === 'timeline' && simpleEventTab('transformation_timeline_recorded', 'Transformation Timeline 기록', 'Transformation Timeline — transformation_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'summary' && simpleEventTab('executive_transformation_summary_recorded', 'Executive Transformation Summary 기록', 'Summary ≠ 조직 변경 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tfSelect}{reasonInput}
            {btn('Transformation Scorecard 기록', () => tfEvent('executive_transformation_scorecard_recorded', { fields: [...TRANSFORMATION_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 개편 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${TRANSFORMATION_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 개편 지시(critical risk/not ready 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_transformation_scorecard_recorded'), 'Scorecard 없음', 'Executive Transformation Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tfSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {TRANSFORMATION_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => tfEvent('change_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Change Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('change_recommendation_recorded'), 'Recommendation 없음', 'Change Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tfSelect}{reasonInput}
            {btn('Transformation Review 요청', () => {
              const r = needReason();
              if (!r || !selTransformation) { if (!selTransformation) toast.error('Transformation 선택 필수'); return; }
              void act(() => createEnterpriseTransformationReview({ transformation_id: selTransformation, review_type: 'transformation_review', review_summary: r }), 'Transformation Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selTransformation) { if (!selTransformation) toast.error('Transformation 선택 필수'); return; }
              void act(() => createEnterpriseTransformationReview({ transformation_id: selTransformation, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selTransformation) { if (!selTransformation) toast.error('Transformation 선택 필수'); return; }
              void act(() => createEnterpriseTransformationReview({ transformation_id: selTransformation, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(조직 변경은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => trReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => trReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => trReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => trReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — transformation/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. Transformation 실행은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/조직 변경이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('transformation_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('transformation_learning_recorded', 'Transformation Learning 기록', 'Transformation Learning ≠ 자동 조직 변경 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {tfSelect}{reasonInput}
            {btn('Value Link(0559 실존 검증)', () => tfEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨(0559 참조만)'), true)}
            {btn('Organization Link(0552)', () => tfEvent('organization_reference_linked', { note: reason.trim() }, 'Organization Link 기록됨(0552 참조만)'))}
            {btn('Scenario Link(0557)', () => tfEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
            {btn('Program Link(0547)', () => tfEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Mission Link(0555)', () => tfEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Environment Link(0556)', () => tfEvent('environment_reference_linked', { note: reason.trim() }, 'Environment Link 기록됨(0556 참조만)'))}
            {btn('Governance Link(0551)', () => tfEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(0551 참조만)'))}
            {btn('Capacity Link(0558)', () => tfEvent('capacity_reference_linked', { note: reason.trim() }, 'Capacity Link 기록됨(0558 참조만)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0547/0549/0551/0552/0555/0556/0557/0558/0559). Link ≠ 변경/확정/개편." />
          {eventList([...evByType('value_reference_linked'), ...evByType('organization_reference_linked'), ...evByType('scenario_reference_linked'), ...evByType('program_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('environment_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('capacity_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Transformation 흐름 관측(13단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
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
          <AdminAlert tone="info" description={`Transformation 이벤트 31종 통합 Audit — 총 ${NUM(num('transformation_events', 'total'))}건. 자동 조직 개편 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Transformation Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 조직 개편 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_TRANSFORMATION_SUPPORT_MATRIX.map((e) => (
              <div key={e.feature} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.feature}</span>
                <AdminBadge tone={e.level === 'unavailable' ? 'danger' : e.level === 'fully_supported' ? 'success' : 'warning'}>{e.level}</AdminBadge>
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
