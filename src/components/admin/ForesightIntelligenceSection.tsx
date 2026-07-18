/**
 * ForesightIntelligenceSection — Enterprise Foresight Intelligence,
 * Strategic Foresight & Long-Term Future Planning Center (Phase AI-OPS-59).
 *
 * Enterprise Vision→Mission→Strategy→Innovation→Strategic Foresight→
 * Weak Signal Detection→Future Scenario Modeling→Long-Term Opportunity
 * Analysis→Strategic Option Generation→Executive Foresight Review→
 * Foresight Learning→Audit.
 * Weak Signal ≠ Future Fact · Scenario ≠ Prediction · Possibility ≠
 * Probability · Opportunity ≠ Success.
 * 자동 장기 전략 변경/투자 승인/사업 시작/Budget·조직 변경/계약 체결 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Compass, GitBranch, Grid3x3, History,
  Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseForesightSummary, fetchEnterpriseForesights,
  createEnterpriseForesight, reviewEnterpriseForesight,
  createEnterpriseForesightReview, reviewEnterpriseForesightReview,
  fetchEnterpriseForesightReviews, recordEnterpriseForesightEvent,
  fetchEnterpriseForesightAudit,
  type EnterpriseForesightSummary, type EnterpriseForesightRow,
  type EnterpriseForesightReviewRow, type EnterpriseForesightEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  FORESIGHT_CATEGORIES, WEAK_SIGNAL_DIMENSIONS, WEAK_SIGNAL_RESULTS,
  FUTURE_SCENARIO_DIMENSIONS, FUTURE_SCENARIO_RESULTS,
  LONG_TERM_OPPORTUNITY_DIMENSIONS, LONG_TERM_OPPORTUNITY_RESULTS,
  LONG_TERM_RISK_RESULTS, STRATEGIC_OPTION_RESULTS, TREND_EVOLUTION_RESULTS,
  SCENARIO_READINESS_RESULTS, OPPORTUNITY_HORIZON_RESULTS, UNCERTAINTY_RESULTS,
  FORESIGHT_RECOMMENDATION_TYPES, FORESIGHT_SCORECARD_FIELDS,
  buildForesightTimeline, ENTERPRISE_FORESIGHT_SUPPORT_MATRIX,
} from '@/lib/enterpriseForesight';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'foresights' | 'signal' | 'scenario' | 'opportunity' | 'risk'
  | 'option' | 'trend' | 'readiness' | 'horizon' | 'uncertainty' | 'timeline'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Foresight Overview', icon: Layers },
  { key: 'foresights', label: 'Foresight Candidates', icon: Compass },
  { key: 'signal', label: 'Weak Signals', icon: Activity },
  { key: 'scenario', label: 'Future Scenarios', icon: Compass },
  { key: 'opportunity', label: 'Long-Term Opportunities', icon: TrendingUp },
  { key: 'risk', label: 'Future Risks', icon: Shield },
  { key: 'option', label: 'Strategic Options', icon: Scale },
  { key: 'trend', label: 'Trend Evolution', icon: TrendingUp },
  { key: 'readiness', label: 'Scenario Readiness', icon: Activity },
  { key: 'horizon', label: 'Opportunity Horizon', icon: History },
  { key: 'uncertainty', label: 'Uncertainty', icon: Shield },
  { key: 'timeline', label: 'Foresight Timeline', icon: History },
  { key: 'summary', label: 'Executive Foresight Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Foresight Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Strategic Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '장기 전략 자동 변경·투자 자동 승인·사업 자동 시작·Budget 자동 변경·조직 자동 변경·계약 자동 체결·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(long_term_strategy_changed/investment_approved 등) 항상 false',
  'Weak Signal ≠ Future Fact · Trend ≠ Certainty · Scenario ≠ Prediction · Possibility ≠ Probability — 미래 가능성 관측 후보 분석이며 예측 확정이 아닙니다',
  'Opportunity ≠ Success · Risk ≠ Outcome — Evidence 없는 Strategic Option/Recommendation 서버 차단',
  'Foresight Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 장기 전략 결정은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0549/0551/0555/0556/0557/0559/0560/0561/0562)',
  '이름 실측: ai_enterprise_foresight/admin_enterprise_foresight_* 미사용 확인 — 스펙 권장명 그대로 사용(충돌 없음)',
  '미래학 연구/트렌드 DB/전문가 패널/호라이즌 스캐닝 도구/거시경제/포사이트 플랫폼 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Weak Signal Timeline/Scenario·Opportunity·Risk Evolution·Strategic Learning History 는 JSONB 통합 — 시계열 원장 테이블 아님',
  'Migration 0472~0563 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ForesightIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseForesightSummary>({});
  const [foresights, setForesights] = useState<EnterpriseForesightRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseForesightReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseForesightEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selForesight, setSelForesight] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('technology');
  const [sigDimSel, setSigDimSel] = useState<string>('signal_strength');
  const [scnDimSel, setScnDimSel] = useState<string>('plausibility');
  const [oppDimSel, setOppDimSel] = useState<string>('growth_potential');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, f, v, a] = await Promise.all([
        fetchEnterpriseForesightSummary(), fetchEnterpriseForesights(null, null, 200),
        fetchEnterpriseForesightReviews(null, 200), fetchEnterpriseForesightAudit(200),
      ]);
      setSummary(s); setForesights(f); setReviews(v); setAudit(a);
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
  const fsReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selForesight) { if (!selForesight) toast.error('Foresight 선택 필수'); return; }
    void act(() => reviewEnterpriseForesight(selForesight, action, r, payload), ok);
  };
  const frReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Foresight Review 선택 필수'); return; }
    void act(() => reviewEnterpriseForesightReview(selReview, action, r, payload), ok);
  };
  const fsEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { fs?: boolean; review?: boolean } = { fs: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseForesightEvent(kind, r, payload, ids.fs ? (selForesight || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('foresight_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('foresight_actuals', 'decision_scenarios_0557') ?? 0) > 0,
      innovation: (num('foresight_actuals', 'innovations_0562') ?? 0) > 0,
      strategic_foresight: (num('foresights', 'total') ?? 0) > 0,
      weak_signal_detection: (num('foresight_events', 'signal_reviews') ?? 0) > 0,
      future_scenario_modeling: (num('foresight_events', 'scenario_reviews') ?? 0) > 0,
      long_term_opportunity_analysis: (num('foresight_events', 'opportunity_reviews') ?? 0) + (num('foresight_events', 'horizon_reviews') ?? 0) > 0,
      strategic_option_generation: (num('foresight_events', 'strategic_options') ?? 0) > 0,
      executive_foresight_review: (num('foresight_events', 'foresight_review_requests') ?? 0) + (num('foresight_events', 'executive_review_requests') ?? 0) + (num('foresight_events', 'human_review_requests') ?? 0) + (num('foresight_events', 'review_references') ?? 0) > 0,
      foresight_learning: (num('foresight_events', 'learnings') ?? 0) > 0,
      audit: (num('foresight_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildForesightTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Foresight Intelligence & Long-Term Future Planning Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Foresight Intelligence & Long-Term Future Planning Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const fsSelect = (
    <select value={selForesight} onChange={(e) => setSelForesight(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Foresight 선택</option>
      {foresights.map((f) => <option key={f.id} value={f.id}>{f.foresight_code} · {f.foresight_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Foresight Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('highly_significant') || s.includes('highly_plausible') || s.includes('exceptional') || s.includes('strong') || s.includes('negligible') || s.includes('robust_option') || s.includes('highly_ready') || s.includes('low_uncertainty') || s.includes('review_reference') || s === 'observed' ? 'success' as const : s.includes('speculative') || s.includes('critical') || s.includes('weak_candidate') || s.includes('not_ready') || s.includes('declining') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseForesightEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const fsList = (list: EnterpriseForesightRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((f) => (
          <div key={f.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(f.foresight_status)}>{f.foresight_status}</AdminBadge>
            <AdminBadge tone={tone(f.signal_status)}>{f.signal_status}</AdminBadge>
            <AdminBadge tone={tone(f.scenario_status)}>{f.scenario_status}</AdminBadge>
            <span className="ml-2 font-bold">{f.foresight_code}</span>
            <span className="ml-2 text-muted-foreground">{f.foresight_category} · {f.foresight_name} · opportunity {f.opportunity_status} · reviews {Array.isArray(f.foresight_reviews) ? f.foresight_reviews.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseForesightReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
        {fsSelect}{reasonInput}
        {btn(`${title} 기록`, () => fsEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {fsSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => fsEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Foresight Intelligence & Long-Term Future Planning Center"
      subtitle="Weak Signal Detection→Future Scenario Modeling→Long-Term Opportunity Analysis→Strategic Option Generation→Executive Review→Learning — 장기 전략과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 가 현재와 가까운 미래만이 아니라 3년/5년/10년 관점의 장기 전략 방향을 검토하도록 지원하는 Strategic Foresight 계층입니다. AI 는 Weak Signal Detection/Future Scenario Modeling/Long-Term Opportunity·Risk 분석/Strategic Option 생성/Trend Evolution·Scenario Readiness·Horizon·Uncertainty 분석/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, 장기 전략 자동 변경·투자 자동 승인·사업 자동 시작·Budget 자동 변경·조직 자동 변경·계약 자동 체결·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Weak Signal ≠ Future Fact, Scenario ≠ Prediction, Possibility ≠ Probability, Opportunity ≠ Success. AI 는 가능성을 분석합니다. 사람이 전략을 수립하고, 투자를 결정하며, 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Foresights" value={NUM(num('foresights', 'total'))} />
            <Box label="Observed / Candidate / Reference / Archived" value={`${NUM(num('foresights', 'observed'))} / ${NUM(num('foresights', 'candidate'))} / ${NUM(num('foresights', 'review_reference'))} / ${NUM(num('foresights', 'archived'))}`} />
            <Box label="Highly Significant / Speculative Signals" value={`${NUM(num('foresights', 'highly_significant'))} / ${NUM(num('foresights', 'speculative_signals'))}`} />
            <Box label="Highly Plausible / Exploratory Scenarios" value={`${NUM(num('foresights', 'highly_plausible'))} / ${NUM(num('foresights', 'exploratory_scenarios'))}`} />
            <Box label="Exceptional·Strong / Weak Opportunities" value={`${NUM(num('foresights', 'exceptional_opportunities'))} / ${NUM(num('foresights', 'weak_opportunities'))}`} />
            <Box label="Foresight Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Signal / Scenario / Opportunity Reviews" value={`${NUM(num('foresight_events', 'signal_reviews'))} / ${NUM(num('foresight_events', 'scenario_reviews'))} / ${NUM(num('foresight_events', 'opportunity_reviews'))}`} />
            <Box label="Risk / Option / Trend" value={`${NUM(num('foresight_events', 'risk_reviews'))} / ${NUM(num('foresight_events', 'strategic_options'))} / ${NUM(num('foresight_events', 'trend_reviews'))}`} />
            <Box label="Readiness / Horizon / Uncertainty" value={`${NUM(num('foresight_events', 'readiness_reviews'))} / ${NUM(num('foresight_events', 'horizon_reviews'))} / ${NUM(num('foresight_events', 'uncertainty_reviews'))}`} />
            <Box label="Timelines / Summaries / Scorecards" value={`${NUM(num('foresight_events', 'timelines'))} / ${NUM(num('foresight_events', 'summaries'))} / ${NUM(num('foresight_events', 'scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('foresight_events', 'recommendations'))} />
            <Box label="Foresight / Executive / Human Review 요청" value={`${NUM(num('foresight_events', 'foresight_review_requests'))} / ${NUM(num('foresight_events', 'executive_review_requests'))} / ${NUM(num('foresight_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('foresight_events', 'review_references'))} />
            <Box label="Learnings / Innovation Links(0562)" value={`${NUM(num('foresight_events', 'learnings'))} / ${NUM(num('foresight_events', 'innovation_links'))}`} />
            <Box label="Scenario Links(0557) / Environment Links(0556)" value={`${NUM(num('foresight_events', 'scenario_links'))} / ${NUM(num('foresight_events', 'environment_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`foresight_unavailable: ${Array.isArray(summary.foresight_unavailable) ? (summary.foresight_unavailable as unknown[]).map(String).join(', ') : '—'}. Foresight 원천 실측 — Innovations(0562) ${NUM(num('foresight_actuals', 'innovations_0562'))}건 · Improvements(0561) ${NUM(num('foresight_actuals', 'improvements_0561'))}건 · Transformations(0560) ${NUM(num('foresight_actuals', 'transformations_0560'))}건 · Decision Scenarios(0557) ${NUM(num('foresight_actuals', 'decision_scenarios_0557'))}건 · Environment Observations(0556) ${NUM(num('foresight_actuals', 'environment_observations_0556'))}건 · Missions(0555) ${NUM(num('foresight_actuals', 'missions_0555'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'foresights' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FORESIGHT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Foresight 관측 기록(≠ 예측 확정)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseForesight({ foresight_category: catSel, foresight_name: r }), 'Foresight 관측 기록됨(자동 전략 변경 없음)');
            }, true)}
            {btn('Observed 표시', () => fsReview('mark_observed', {}, 'observed(관측 상태)'))}
            {btn('Candidate 표시', () => fsReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => fsReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => fsReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => fsReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {fsSelect}
          </div>
          <AdminAlert tone="info" description="Category 11종 · 자동 장기 전략 변경/투자 승인/사업 시작/Budget·조직 변경/계약 체결 계열 category 서버 차단 · archived 재결정 차단." />
          {fsList(foresights, 'Foresight 없음', '핵심 질문 예: 어떤 Weak Signal 이 나타나고 있는가? 어떤 미래 시나리오를 준비해야 하는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'signal' && (
        <>
          {resultEventTab('weak_signal_reviewed', 'Weak Signal 검토', 'Signal 5평가(§5 — Signal Strength/Evidence/Consistency/Relevance/Strategic Importance) — Weak Signal ≠ Future Fact.', WEAK_SIGNAL_RESULTS, { signal_dimension: sigDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Signal Dimension:</span>
            <select value={sigDimSel} onChange={(e) => setSigDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {WEAK_SIGNAL_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'scenario' && (
        <>
          {resultEventTab('future_scenario_reviewed', 'Future Scenario 검토', 'Scenario 5평가(§6 — Plausibility/Strategic Impact/Resource Readiness/Business Alignment/Uncertainty) — Scenario ≠ Prediction.', FUTURE_SCENARIO_RESULTS, { scenario_dimension: scnDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Scenario Dimension:</span>
            <select value={scnDimSel} onChange={(e) => setScnDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FUTURE_SCENARIO_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'opportunity' && (
        <>
          {resultEventTab('long_term_opportunity_reviewed', 'Long-Term Opportunity 검토', 'Opportunity 5평가(§7 — Growth Potential/Sustainability/Strategic Value/Competitive Advantage/Innovation Potential) — Opportunity ≠ Success.', LONG_TERM_OPPORTUNITY_RESULTS, { opportunity_dimension: oppDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Opportunity Dimension:</span>
            <select value={oppDimSel} onChange={(e) => setOppDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {LONG_TERM_OPPORTUNITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'risk' && resultEventTab('long_term_risk_reviewed', 'Long-Term Risk 검토', 'Risk ≠ Outcome — 미래 위험 관측 후보이며 결과 확정이 아닙니다.', LONG_TERM_RISK_RESULTS)}
      {tab === 'option' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {fsSelect}
            <select value={(STRATEGIC_OPTION_RESULTS as readonly string[]).includes(resultSel) ? resultSel : STRATEGIC_OPTION_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {STRATEGIC_OPTION_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('Strategic Option 기록(Evidence 필수)', () => fsEvent('strategic_option_recorded', { result: (STRATEGIC_OPTION_RESULTS as readonly string[]).includes(resultSel) ? resultSel : STRATEGIC_OPTION_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Strategic Option 기록됨(≠ 전략 결정)'), true)}
          </div>
          <AdminAlert tone="warning" description="Strategic Option ≠ 전략 결정 — Evidence 없는 옵션 기록 서버 차단, 선택은 사람이 수행합니다." />
          {eventList(evByType('strategic_option_recorded'), 'Strategic Option 없음', '전략 옵션 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'trend' && resultEventTab('trend_evolution_reviewed', 'Trend Evolution 검토', 'Trend ≠ Certainty — 추세 진화 관측 후보입니다.', TREND_EVOLUTION_RESULTS)}
      {tab === 'readiness' && resultEventTab('scenario_readiness_reviewed', 'Scenario Readiness 검토', 'Readiness ≠ Success — 시나리오 준비도 관측 후보입니다.', SCENARIO_READINESS_RESULTS)}
      {tab === 'horizon' && resultEventTab('opportunity_horizon_reviewed', 'Opportunity Horizon 검토', 'Horizon 관측 ≠ 시점 확정 — 3년/5년/10년 관점 관측 후보입니다.', OPPORTUNITY_HORIZON_RESULTS)}
      {tab === 'uncertainty' && resultEventTab('uncertainty_reviewed', 'Uncertainty 검토', 'Unknown 은 Unknown 으로 유지 — 불확실성 관측 기록입니다.', UNCERTAINTY_RESULTS)}
      {tab === 'timeline' && simpleEventTab('foresight_timeline_recorded', 'Foresight Timeline 기록', 'Weak Signal Timeline — foresight_history 로 통합 축적됩니다(≠ Forecast 확정).')}
      {tab === 'summary' && simpleEventTab('executive_foresight_summary_recorded', 'Executive Foresight Summary 기록', 'Summary ≠ 전략 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {fsSelect}{reasonInput}
            {btn('Foresight Scorecard 기록', () => fsEvent('executive_foresight_scorecard_recorded', { fields: [...FORESIGHT_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 전략 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${FORESIGHT_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 전략 지시(critical future risk/speculative signal 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_foresight_scorecard_recorded'), 'Scorecard 없음', 'Executive Foresight Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {fsSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {FORESIGHT_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => fsEvent('foresight_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Foresight Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('foresight_recommendation_recorded'), 'Recommendation 없음', 'Foresight Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {fsSelect}{reasonInput}
            {btn('Foresight Review 요청', () => {
              const r = needReason();
              if (!r || !selForesight) { if (!selForesight) toast.error('Foresight 선택 필수'); return; }
              void act(() => createEnterpriseForesightReview({ foresight_id: selForesight, review_type: 'foresight_review', review_summary: r }), 'Foresight Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selForesight) { if (!selForesight) toast.error('Foresight 선택 필수'); return; }
              void act(() => createEnterpriseForesightReview({ foresight_id: selForesight, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selForesight) { if (!selForesight) toast.error('Foresight 선택 필수'); return; }
              void act(() => createEnterpriseForesightReview({ foresight_id: selForesight, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(장기 전략 결정은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => frReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => frReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => frReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => frReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — foresight/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 장기 전략 결정은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/전략 결정이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('foresight_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('foresight_learning_recorded', 'Strategic Learning 기록', 'Foresight Learning ≠ 자동 전략 변경 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {fsSelect}{reasonInput}
            {btn('Innovation Link(0562 실존 검증)', () => fsEvent('innovation_reference_linked', { note: reason.trim() }, 'Innovation Link 기록됨(0562 참조만)'), true)}
            {btn('Improvement Link(0561)', () => fsEvent('improvement_reference_linked', { note: reason.trim() }, 'Improvement Link 기록됨(0561 참조만)'))}
            {btn('Transformation Link(0560)', () => fsEvent('transformation_reference_linked', { note: reason.trim() }, 'Transformation Link 기록됨(0560 참조만)'))}
            {btn('Value Link(0559)', () => fsEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨(0559 참조만)'))}
            {btn('Scenario Link(0557)', () => fsEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
            {btn('Environment Link(0556)', () => fsEvent('environment_reference_linked', { note: reason.trim() }, 'Environment Link 기록됨(0556 참조만)'))}
            {btn('Mission Link(0555)', () => fsEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Governance Link(0551)', () => fsEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(0551 참조만)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0551/0555/0556/0557/0559/0560/0561/0562). Link ≠ 변경/확정/결정." />
          {eventList([...evByType('innovation_reference_linked'), ...evByType('improvement_reference_linked'), ...evByType('transformation_reference_linked'), ...evByType('value_reference_linked'), ...evByType('scenario_reference_linked'), ...evByType('environment_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('governance_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Foresight 흐름 관측(12단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
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
          <AdminAlert tone="info" description={`Foresight 이벤트 31종 통합 Audit — 총 ${NUM(num('foresight_events', 'total'))}건. 자동 전략 변경 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Foresight Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_FORESIGHT_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 전략 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_FORESIGHT_SUPPORT_MATRIX.map((e) => (
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
