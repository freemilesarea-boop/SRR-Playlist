/**
 * EnvironmentIntelligenceSection — Enterprise Ecosystem Intelligence,
 * External Intelligence & Strategic Environment Center (Phase AI-OPS-52).
 *
 * Enterprise Vision→Enterprise Mission→Internal Intelligence→External
 * Environment→Market/Competitive/Partner/Customer/Technology/Regulatory/
 * Macroeconomic Intelligence→Risk Signal Detection→Strategic Environment
 * Assessment→Executive Environment Review→Environment Learning→Audit.
 * Market Trend ≠ Future Market · Risk Signal ≠ Actual Risk · Regulation
 * Change ≠ Legal Advice. 자동 전략/계약/Partner/Pricing 변경 없음.
 * (기존 EcosystemIntelligenceSection(0530 내부 의존성)과 별도 신규 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, Gauge, GitBranch, Globe, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Search, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseEnvironmentSummary, fetchEnterpriseEnvironmentObservations,
  createEnterpriseEnvironmentObservation, reviewEnterpriseEnvironmentObservation,
  createEnterpriseEnvironmentReview, reviewEnterpriseEnvironmentReview,
  fetchEnterpriseEnvironmentReviews, recordEnterpriseEnvironmentEvent,
  fetchEnterpriseEnvironmentAudit,
  type EnterpriseEnvironmentSummary, type EnterpriseEnvironmentObservationRow,
  type EnterpriseEnvironmentReviewRow, type EnterpriseEnvironmentEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  ENVIRONMENT_CATEGORIES, MARKET_SIGNAL_RESULTS,
  ENVIRONMENT_IMPACT_DIMENSIONS, ENVIRONMENT_IMPACT_RESULTS,
  EXTERNAL_RISK_DIMENSIONS, EXTERNAL_RISK_RESULTS,
  ENVIRONMENT_RECOMMENDATION_TYPES, ENVIRONMENT_SCORECARD_FIELDS, buildEnvironmentTimeline,
  ENTERPRISE_ENVIRONMENT_COMPONENTS, ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX,
} from '@/lib/enterpriseEnvironment';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'observations' | 'market' | 'competitive' | 'customer' | 'partner'
  | 'technology' | 'regulatory' | 'economic' | 'risk' | 'impact' | 'mapping' | 'relationships'
  | 'timeline' | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Environment Overview', icon: Layers },
  { key: 'observations', label: 'Environment Observations', icon: Globe },
  { key: 'market', label: 'Market Intelligence', icon: Activity },
  { key: 'competitive', label: 'Competitive Intelligence', icon: Search },
  { key: 'customer', label: 'Customer Intelligence', icon: Users },
  { key: 'partner', label: 'Partner Intelligence', icon: Users },
  { key: 'technology', label: 'Technology Intelligence', icon: Activity },
  { key: 'regulatory', label: 'Regulatory Intelligence', icon: Shield },
  { key: 'economic', label: 'Economic Signals', icon: Gauge },
  { key: 'risk', label: 'External Risk', icon: Shield },
  { key: 'impact', label: 'Environment Impact', icon: Gauge },
  { key: 'mapping', label: 'Environment Mapping', icon: GitBranch },
  { key: 'relationships', label: 'Ecosystem Relationships', icon: GitBranch },
  { key: 'timeline', label: 'Environment Timeline', icon: History },
  { key: 'summary', label: 'Executive Environment Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Environment Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Environment Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Strategy/Mission 자동 변경·계약 자동 체결/해지·Partner 자동 승인·Vendor/Budget/Pricing/Product 자동 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(strategy_changed/contract_signed/partner_approved 등) 항상 false',
  'Market Trend ≠ Future Market · Competitor Analysis ≠ Competitor Intent · Technology Trend ≠ Guaranteed Adoption',
  'Regulation Change ≠ Legal Advice — 규제 해석과 법적 판단은 사람(법무)이 수행',
  'Customer Trend ≠ Customer Demand · Risk Signal ≠ Actual Risk · Recommendation ≠ Decision',
  'Environment Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, 전략·계약 변경은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0545/0547/0549/0551/0553/0555)',
  '외부 시장 데이터/경쟁사 인텔리전스/뉴스 미디어/규제 공보/거시경제 데이터/고객 서베이 피드 부재(실측) — insufficient_data 유지, 관측은 수동 기록 기반',
  'Market/Competitor/Technology/Regulatory Timeline 은 environment_history JSONB append — 시계열 원장 테이블 아님',
  'Migration 0472~0556 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function EnvironmentIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseEnvironmentSummary>({});
  const [observations, setObservations] = useState<EnterpriseEnvironmentObservationRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseEnvironmentReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseEnvironmentEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selObservation, setSelObservation] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('market');
  const [riskDimSel, setRiskDimSel] = useState<string>('regulatory');
  const [impactDimSel, setImpactDimSel] = useState<string>('mission_impact');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, o, r, a] = await Promise.all([
        fetchEnterpriseEnvironmentSummary(), fetchEnterpriseEnvironmentObservations(null, null, 200),
        fetchEnterpriseEnvironmentReviews(null, 200), fetchEnterpriseEnvironmentAudit(200),
      ]);
      setSummary(s); setObservations(o); setReviews(r); setAudit(a);
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
  const obsReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selObservation) { if (!selObservation) toast.error('Observation 선택 필수'); return; }
    void act(() => reviewEnterpriseEnvironmentObservation(selObservation, action, r, payload), ok);
  };
  const erReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Environment Review 선택 필수'); return; }
    void act(() => reviewEnterpriseEnvironmentReview(selReview, action, r, payload), ok);
  };
  const envEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { obs?: boolean; review?: boolean } = { obs: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseEnvironmentEvent(kind, r, payload, ids.obs ? (selObservation || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildEnvironmentTimeline({ present: {
    enterprise_vision: (num('environment_actuals', 'missions_0555') ?? 0) > 0,
    enterprise_mission: (num('environment_events', 'mission_links') ?? 0) > 0,
    internal_intelligence: (num('environment_actuals', 'knowledge_memories_0553') ?? 0) > 0,
    external_environment: (num('observations', 'total') ?? 0) > 0,
    market_intelligence: (num('environment_events', 'market_reviews') ?? 0) > 0,
    competitive_intelligence: (num('environment_events', 'competitive_reviews') ?? 0) > 0,
    partner_intelligence: (num('environment_events', 'partner_reviews') ?? 0) > 0,
    customer_intelligence: (num('environment_events', 'customer_reviews') ?? 0) > 0,
    technology_intelligence: (num('environment_events', 'technology_reviews') ?? 0) > 0,
    regulatory_intelligence: (num('environment_events', 'regulatory_reviews') ?? 0) > 0,
    macroeconomic_intelligence: (num('environment_events', 'economic_reviews') ?? 0) > 0,
    risk_signal_detection: (num('environment_events', 'risk_reviews') ?? 0) > 0,
    strategic_environment_assessment: (num('environment_events', 'impact_reviews') ?? 0) + (num('environment_events', 'mappings') ?? 0) > 0,
    executive_environment_review: (num('environment_events', 'environment_review_requests') ?? 0) + (num('environment_events', 'executive_review_requests') ?? 0) + (num('environment_events', 'human_review_requests') ?? 0) + (num('environment_events', 'review_references') ?? 0) > 0,
    environment_learning: (num('environment_events', 'learnings') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Ecosystem Intelligence & Strategic Environment Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Ecosystem Intelligence & Strategic Environment Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const obsSelect = (
    <select value={selObservation} onChange={(e) => setSelObservation(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Observation 선택</option>
      {observations.map((o) => <option key={o.id} value={o.id}>{o.observation_code} · {o.observation_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Environment Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('strong_signal') || s.includes('normal_candidate') || s.includes('low_impact') || s.includes('review_reference') ? 'success' as const : s.includes('critical') || s.includes('high_impact') || s.includes('unsupported') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseEnvironmentEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const obsList = (list: EnterpriseEnvironmentObservationRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((o) => (
          <div key={o.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(o.observation_status)}>{o.observation_status}</AdminBadge>
            <AdminBadge tone={tone(o.signal_status)}>{o.signal_status}</AdminBadge>
            <AdminBadge tone={tone(o.risk_status)}>{o.risk_status}</AdminBadge>
            <span className="ml-2 font-bold">{o.observation_code}</span>
            <span className="ml-2 text-muted-foreground">{o.environment_category} · {o.observation_title} · impact {o.impact_status} · history {Array.isArray(o.environment_history) ? o.environment_history.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseEnvironmentReviewRow[], emptyTitle: string, emptyDesc: string) => (
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
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {obsSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => envEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Ecosystem Intelligence & Strategic Environment Center"
      subtitle="External Environment→Market/Competitive/Partner/Customer/Technology/Regulatory/Macroeconomic Intelligence→Risk Signal→Strategic Environment Assessment→Executive Review→Learning — 전략과 계약, 투자와 실행은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Enterprise 외부 환경을 관측하고 Mission·Strategy·Portfolio·Execution 과 연결하여 환경 변화와 위험 신호를 설명하는 Ecosystem Intelligence 계층입니다. AI 는 Market/Competitive/Partner/Customer/Technology/Regulatory/Economic 분석·Risk Signal Detection·Strategic Environment Mapping·Ecosystem Relationship 분석·Executive Summary/Scorecard·Recommendation·Review 요청·Learning 기록까지만 수행하며, Strategy/Mission 자동 변경·계약 자동 체결/해지·Partner 자동 승인·Vendor/Budget/Pricing/Product 자동 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Market Trend ≠ Future Market, Risk Signal ≠ Actual Risk, Regulation Change ≠ Legal Advice, Recommendation ≠ Decision. AI 는 외부 환경을 분석하고 영향도를 제안합니다. 사람이 전략과 계약, 투자와 실행을 결정합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Environment Observations" value={NUM(num('observations', 'total'))} />
            <Box label="Observed / Candidate / Reference / Archived" value={`${NUM(num('observations', 'observed'))} / ${NUM(num('observations', 'candidate'))} / ${NUM(num('observations', 'review_reference'))} / ${NUM(num('observations', 'archived'))}`} />
            <Box label="Strong Signals / High Impact" value={`${NUM(num('observations', 'strong_signals'))} / ${NUM(num('observations', 'high_impact'))}`} />
            <Box label="Critical·Elevated Risk" value={NUM(num('observations', 'critical_risk'))} />
            <Box label="Environment Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Market / Competitive / Partner Reviews" value={`${NUM(num('environment_events', 'market_reviews'))} / ${NUM(num('environment_events', 'competitive_reviews'))} / ${NUM(num('environment_events', 'partner_reviews'))}`} />
            <Box label="Customer / Technology / Regulatory Reviews" value={`${NUM(num('environment_events', 'customer_reviews'))} / ${NUM(num('environment_events', 'technology_reviews'))} / ${NUM(num('environment_events', 'regulatory_reviews'))}`} />
            <Box label="Economic / Risk / Impact Reviews" value={`${NUM(num('environment_events', 'economic_reviews'))} / ${NUM(num('environment_events', 'risk_reviews'))} / ${NUM(num('environment_events', 'impact_reviews'))}`} />
            <Box label="Mappings / Relationships / Timelines" value={`${NUM(num('environment_events', 'mappings'))} / ${NUM(num('environment_events', 'relationships'))} / ${NUM(num('environment_events', 'timelines'))}`} />
            <Box label="Summaries / Scorecards / Recommendations" value={`${NUM(num('environment_events', 'summaries'))} / ${NUM(num('environment_events', 'scorecards'))} / ${NUM(num('environment_events', 'recommendations'))}`} />
            <Box label="Environment / Executive / Human Review 요청" value={`${NUM(num('environment_events', 'environment_review_requests'))} / ${NUM(num('environment_events', 'executive_review_requests'))} / ${NUM(num('environment_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('environment_events', 'review_references'))} />
            <Box label="Learnings / Mission / Portfolio Links" value={`${NUM(num('environment_events', 'learnings'))} / ${NUM(num('environment_events', 'mission_links'))} / ${NUM(num('environment_events', 'portfolio_links'))}`} />
            <Box label="Governance / Knowledge Links" value={`${NUM(num('environment_events', 'governance_links'))} / ${NUM(num('environment_events', 'knowledge_links'))}`} />
            <Box label="Reviewed References" value={NUM(num('observations', 'reviewed_references'))} />
          </div>
          <AdminAlert tone="info" description={`environment_unavailable: ${Array.isArray(summary.environment_unavailable) ? (summary.environment_unavailable as unknown[]).map(String).join(', ') : '—'}. Environment 원천 실측 — Missions(0555) ${NUM(num('environment_actuals', 'missions_0555'))}건 · Strategy Portfolios(0545) ${NUM(num('environment_actuals', 'strategy_portfolios_0545'))}건 · Business Values(0549) ${NUM(num('environment_actuals', 'business_values_0549'))}건 · Governance Decisions(0551) ${NUM(num('environment_actuals', 'governance_decisions_0551'))}건 · Knowledge Memories(0553) ${NUM(num('environment_actuals', 'knowledge_memories_0553'))}건 · AI Reviews(0554) ${NUM(num('environment_actuals', 'ai_reviews_0554'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'observations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ENVIRONMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Environment Observation 생성(≠ 사실 확정)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseEnvironmentObservation({ environment_category: catSel, observation_title: r }), 'Observation 생성됨(observed — 자동 전략 변경 없음)');
            }, true)}
            {btn('Candidate 표시', () => obsReview('mark_candidate', {}, 'candidate'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => obsReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => obsReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => obsReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {obsSelect}
          </div>
          <AdminAlert tone="info" description="Category 15종 · 자동 전략/계약/Partner/Pricing 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {obsList(observations, 'Environment Observation 없음', '핵심 질문 예: 시장은 어떻게 변화하는가? 어떤 규제 변화가 발생했는가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'market' && resultEventTab('market_trend_reviewed', 'Market Trend 검토', 'Market 5평가(§5 — Trend Strength/Signal Consistency/Evidence Quality/Freshness/Coverage) — Market Trend ≠ Future Market.', MARKET_SIGNAL_RESULTS)}
      {tab === 'competitive' && resultEventTab('competitive_landscape_reviewed', 'Competitive Landscape 검토', 'Competitor Analysis ≠ Competitor Intent — 경쟁 환경 관측 후보입니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'customer' && resultEventTab('customer_trend_reviewed', 'Customer Trend 검토', 'Customer Trend ≠ Customer Demand — 고객 트렌드 관측 후보입니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'partner' && resultEventTab('partner_relationship_reviewed', 'Partner Relationship 검토', 'Partner 분석 ≠ Partner 자동 승인 — 전략적 파트너 관측 후보입니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'technology' && resultEventTab('technology_trend_reviewed', 'Technology Trend 검토', 'Technology Trend ≠ Guaranteed Adoption — 기술 변화 관측 후보입니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'regulatory' && resultEventTab('regulatory_change_reviewed', 'Regulatory Change 검토', 'Regulation Change ≠ Legal Advice — 규제 해석과 법적 판단은 사람(법무)이 수행합니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'economic' && resultEventTab('economic_signal_reviewed', 'Economic Signal 검토', 'Economic Signal ≠ 확정 전망 — 거시경제 신호 관측 후보입니다.', MARKET_SIGNAL_RESULTS)}
      {tab === 'risk' && (
        <>
          {resultEventTab('risk_signal_reviewed', 'Risk Signal 검토', 'Risk 6분석(§7 — Regulatory/Technology/Competitive/Supply Chain/Financial/Reputation) — Risk Signal ≠ Actual Risk.', EXTERNAL_RISK_RESULTS, { risk_dimension: riskDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Risk Dimension:</span>
            <select value={riskDimSel} onChange={(e) => setRiskDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXTERNAL_RISK_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'impact' && (
        <>
          {resultEventTab('environment_impact_reviewed', 'Environment Impact 검토', 'Impact 5평가(§6 — Mission/Strategy/Portfolio/Financial/Operational) — Impact Candidate ≠ 전략 변경 지시.', ENVIRONMENT_IMPACT_RESULTS, { impact_dimension: impactDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Impact Dimension:</span>
            <select value={impactDimSel} onChange={(e) => setImpactDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ENVIRONMENT_IMPACT_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}

      {tab === 'mapping' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Environment Mapping 기록', () => envEvent('environment_mapping_recorded', { note: reason.trim() }, 'Mapping 기록됨(≠ 전략 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Strategic Environment Mapping — 외부 환경과 전략의 연결 관측이며 전략 확정이 아닙니다." />
          {eventList(evByType('environment_mapping_recorded'), 'Mapping 없음', '환경 매핑 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'relationships' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Ecosystem Relationship 기록', () => envEvent('ecosystem_relationship_recorded', { note: reason.trim() }, 'Relationship 기록됨(≠ 계약 관계 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Ecosystem Relationship — 파트너/공급망 관계 관측이며 계약 관계 확정이 아닙니다." />
          {eventList(evByType('ecosystem_relationship_recorded'), 'Relationship 없음', '생태계 관계 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'timeline' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Environment Timeline 기록(History append)', () => envEvent('environment_timeline_recorded', { note: reason.trim() }, 'Timeline 기록됨(≠ Forecast 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Market/Competitor/Technology/Regulatory Timeline — environment_history 로 통합 축적됩니다." />
          {eventList(evByType('environment_timeline_recorded'), 'Timeline 없음', '환경 타임라인 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Executive Environment Summary 기록', () => envEvent('executive_environment_summary_recorded', { note: reason.trim() }, 'Summary 기록됨(≠ 환경 판단 확정)'), true)}
          </div>
          <AdminAlert tone="info" description="Executive Environment Summary ≠ 환경 판단 확정 — 경영진 판단 보조 자료입니다." />
          {eventList(evByType('executive_environment_summary_recorded'), 'Summary 없음', 'Executive Environment Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Environment Scorecard 기록', () => envEvent('executive_environment_scorecard_recorded', { fields: [...ENVIRONMENT_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 전략 변경 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${ENVIRONMENT_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 전략 변경 지시(critical risk/high impact 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_environment_scorecard_recorded'), 'Scorecard 없음', 'Executive Environment Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ENVIRONMENT_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => envEvent('environment_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Environment Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('environment_recommendation_recorded'), 'Recommendation 없음', 'Environment Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Environment Review 요청', () => {
              const r = needReason();
              if (!r || !selObservation) { if (!selObservation) toast.error('Observation 선택 필수'); return; }
              void act(() => createEnterpriseEnvironmentReview({ environment_observation_id: selObservation, review_type: 'environment_review', review_summary: r }), 'Environment Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selObservation) { if (!selObservation) toast.error('Observation 선택 필수'); return; }
              void act(() => createEnterpriseEnvironmentReview({ environment_observation_id: selObservation, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selObservation) { if (!selObservation) toast.error('Observation 선택 필수'); return; }
              void act(() => createEnterpriseEnvironmentReview({ environment_observation_id: selObservation, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(전략·계약 변경은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => erReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => erReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => erReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => erReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — environment/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. 전략 변경과 계약 변경은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/전략 변경이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('environment_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Environment Learning 기록', () => envEvent('environment_learning_recorded', { note: reason.trim() }, 'Learning 기록됨(≠ 자동 전략 변경)'), true)}
          </div>
          <AdminAlert tone="info" description="Environment Learning ≠ 자동 전략 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('environment_learning_recorded'), 'Learning 없음', '환경 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {obsSelect}{reasonInput}
            {btn('Mission Link(0555 실존 검증)', () => envEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨(≠ Mission 변경)'), true)}
            {btn('Portfolio Link(0545)', () => envEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Program Link(0547)', () => envEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨'))}
            {btn('Value Link(0549)', () => envEvent('value_reference_linked', { note: reason.trim() }, 'Value Link 기록됨'))}
            {btn('Governance Link(0551)', () => envEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(≠ 승인)'))}
            {btn('Knowledge Link(0553)', () => envEvent('knowledge_reference_linked', { note: reason.trim() }, 'Knowledge Link 기록됨(≠ 사실 확정)'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0545/0547/0549/0551/0553/0555). Link ≠ 변경/확정/승인." />
          {eventList([...evByType('mission_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('value_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('knowledge_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Environment 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Environment 이벤트 31종 통합 Audit — 총 ${NUM(num('environment_events', 'total'))}건. 자동 전략 변경 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Ecosystem Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_ENVIRONMENT_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 전략/계약 변경 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_ENVIRONMENT_SUPPORT_MATRIX.map((e) => (
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
