/**
 * ValueIntelligenceSection — Enterprise Value Intelligence, Business Value
 * Attribution & ROI Governance Center (Phase AI-OPS-45).
 *
 * Enterprise Strategy→Strategic Initiative→Execution Outcome→Performance KPI→
 * Business Value→Value Attribution→ROI Analysis→Investment Effectiveness→
 * Enterprise Value Score→Value Trade-off→Executive Value Review→
 * Observed Business Outcome→Value Learning→Audit.
 * Business Value ≠ Financial Statement · ROI Candidate ≠ Accounting ROI ·
 * Attribution ≠ Proven Causality · Value Score ≠ Company Valuation ·
 * Review ≠ Approval. ROI 자동 확정·투자 자동 승인/중단·자동 회계 처리 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, DollarSign, Gauge, GitBranch, Grid3x3,
  History, Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Search,
  Target, TrendingUp, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseValueSummary, fetchEnterpriseBusinessValues, createEnterpriseBusinessValue,
  reviewEnterpriseBusinessValue, recordEnterpriseValueSnapshot, fetchEnterpriseValueSnapshots,
  recordEnterpriseValueReview, recordEnterpriseValueEvent, fetchEnterpriseValueAudit,
  type EnterpriseValueSummary, type EnterpriseBusinessValueRow, type EnterpriseValueSnapshotRow,
  type EnterpriseValueEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  BUSINESS_VALUE_CATEGORIES, VALUE_TREND_RESULTS, ROI_RESULTS,
  VALUE_ATTRIBUTION_DIMENSIONS, VALUE_ATTRIBUTION_RESULTS, VALUE_LINK_RESULTS,
  INVESTMENT_EFFECTIVENESS_RESULTS, VALUE_DRIFT_RESULTS, VALUE_CORRELATION_RESULTS,
  VALUE_TRADEOFF_AXES, VALUE_TRADEOFF_RESULTS, VALUE_DATA_QUALITY_LEVELS,
  VALUE_RECOMMENDATION_TYPES, VALUE_SCORE_FIELDS, buildValueTimeline,
  ENTERPRISE_VALUE_COMPONENTS, ENTERPRISE_VALUE_SUPPORT_MATRIX,
} from '@/lib/enterpriseValue';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inbox' | 'values' | 'baseline' | 'investments' | 'snapshots' | 'trends'
  | 'attribution' | 'kpilinks' | 'execlinks' | 'roi' | 'effectiveness' | 'confidence' | 'drift'
  | 'correlation' | 'crossdomain' | 'valuescore' | 'scorecard' | 'summaryrec' | 'tradeoff'
  | 'recommendations' | 'reviewqueue' | 'reviewed' | 'links' | 'outcomes' | 'learning'
  | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Value Overview', icon: Layers },
  { key: 'inbox', label: 'Value Inbox', icon: Inbox },
  { key: 'values', label: 'Business Values', icon: BookOpen },
  { key: 'baseline', label: 'Value Baselines', icon: History },
  { key: 'investments', label: 'Investment References', icon: DollarSign },
  { key: 'snapshots', label: 'Observed Snapshots', icon: ClipboardList },
  { key: 'trends', label: 'Value Trend', icon: TrendingUp },
  { key: 'attribution', label: 'Value Attribution', icon: GitBranch },
  { key: 'kpilinks', label: 'KPI → Value Links', icon: GitBranch },
  { key: 'execlinks', label: 'Execution → Value Links', icon: GitBranch },
  { key: 'roi', label: 'ROI Analysis', icon: Scale },
  { key: 'effectiveness', label: 'Investment Effectiveness', icon: Gauge },
  { key: 'confidence', label: 'Value Confidence', icon: Gauge },
  { key: 'drift', label: 'Value Drift', icon: Activity },
  { key: 'correlation', label: 'Value Correlation', icon: GitBranch },
  { key: 'crossdomain', label: 'Cross-Domain Value', icon: GitBranch },
  { key: 'valuescore', label: 'Enterprise Value Score', icon: Target },
  { key: 'scorecard', label: 'Strategic Value Scorecard', icon: Grid3x3 },
  { key: 'summaryrec', label: 'Executive Value Summary', icon: ClipboardList },
  { key: 'tradeoff', label: 'Value Trade-offs', icon: Scale },
  { key: 'recommendations', label: 'Value Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Users },
  { key: 'reviewed', label: 'Review References', icon: Scale },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'outcomes', label: 'Business Outcomes', icon: Search },
  { key: 'learning', label: 'Value Learning', icon: Lightbulb },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'ROI 자동 승인/확정·자동 투자 승인/중단·자동 Budget/Resource/Strategy/KPI/Portfolio 변경·자동 Payment/Settlement/회계 처리·자동 기업가치 산정/M&A 판단/투자자 공시·자동 Production/Deploy/Merge 없음 — 모든 반환 flag(roi_confirmed/investment_approved/accounting_applied 등) 항상 false',
  'Business Value ≠ Financial Statement — 회계 원장/재무제표/Revenue Recognition 피드 부재(insufficient_data 유지)',
  'ROI Candidate ≠ Accounting ROI ≠ Investment Decision — ROI 기록은 Evidence 필수, 낮은 Confidence 는 uncertain 유지',
  'Value Attribution ≠ Proven Causality — 외부/미지 요인 절반 이상이면 attribution_unverified 유지',
  'KPI Improvement ≠ Value Creation · Revenue Increase ≠ Enterprise Value Increase — Link/Cross-Domain 은 후보 판정',
  'Enterprise Value Score ≠ Company Valuation — 기업가치 산정/M&A/공시 계열 category 서버 차단',
  'Value Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval',
  'Snapshot observed_value/investment/benefit 은 null 유지 가능(Null → 0 변환 금지) · verified 표기는 출처 참조 필수',
  '시장 데이터/기업가치 평가 모델/IR·M&A 분석 시스템 부재 — 비교·평가 지표는 Candidate 중심',
  'Migration 0472~0549 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ValueIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseValueSummary>({});
  const [values, setValues] = useState<EnterpriseBusinessValueRow[]>([]);
  const [snapshots, setSnapshots] = useState<EnterpriseValueSnapshotRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseValueEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selValue, setSelValue] = useState('');
  const [catSel, setCatSel] = useState<string>('revenue');
  const [attrDimSel, setAttrDimSel] = useState<string>('strategy_contribution');
  const [axisSel, setAxisSel] = useState<string>('short_term_roi_vs_long_term_value');
  const [qualitySel, setQualitySel] = useState<string>('quality_unverified');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [numVal, setNumVal] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, v, sn, a] = await Promise.all([
        fetchEnterpriseValueSummary(), fetchEnterpriseBusinessValues(null, null, 200),
        fetchEnterpriseValueSnapshots(null, 200), fetchEnterpriseValueAudit(200),
      ]);
      setSummary(s); setValues(v); setSnapshots(sn); setAudit(a);
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
  const valueReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selValue) { if (!selValue) toast.error('Value 선택 필수'); return; }
    void act(() => reviewEnterpriseBusinessValue(selValue, action, r, payload), ok);
  };
  const execReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selValue) { if (!selValue) toast.error('Value 선택 필수'); return; }
    void act(() => recordEnterpriseValueReview(selValue, action, r, payload), ok);
  };
  const valueEvent = (kind: string, payload: Record<string, unknown>, ok: string, requireValue = false) => {
    const r = needReason();
    if (!r) return;
    if (requireValue && !selValue) { toast.error('Value 선택 필수'); return; }
    void act(() => recordEnterpriseValueEvent(kind, r, payload, selValue || null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => buildValueTimeline({ present: {
    enterprise_strategy: (num('value_actuals', 'strategy_portfolios_0545') ?? 0) > 0,
    strategic_initiative: (num('value_actuals', 'strategic_initiatives_0545') ?? 0) > 0,
    execution_outcome: (num('value_actuals', 'execution_programs_0547') ?? 0) > 0,
    performance_kpi: (num('value_actuals', 'enterprise_kpis_0548') ?? 0) > 0,
    business_value: (num('values', 'total') ?? 0) > 0,
    value_attribution: (num('value_events', 'attribution_reviews') ?? 0) > 0,
    roi_analysis: (num('value_events', 'roi_reviews') ?? 0) > 0,
    investment_effectiveness: (num('value_events', 'effectiveness_reviews') ?? 0) > 0,
    enterprise_value_score: (num('value_events', 'value_scores') ?? 0) > 0,
    value_tradeoff: (num('value_events', 'tradeoff_reviews') ?? 0) > 0,
    executive_value_review: (num('value_events', 'executive_review_requests') ?? 0) + (num('value_events', 'review_references') ?? 0) > 0,
    observed_business_outcome: (num('value_events', 'business_outcome_links') ?? 0) > 0,
    value_learning: (num('value_events', 'learning_references') ?? 0) > 0,
  } }), [num]);

  if (loading) return <AdminCard title="Value Intelligence & ROI Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Value Intelligence & ROI Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const valueSelect = (
    <select value={selValue} onChange={(e) => setSelValue(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Value 선택</option>
      {values.map((v) => <option key={v.id} value={v.id}>{v.value_code} · {v.value_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const numInput = <input value={numVal} onChange={(e) => setNumVal(e.target.value)} placeholder="수치" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('positive') || s.includes('excellent') || s.includes('acceptable') || s.includes('strong_attribution') || s.includes('strong_link') || s.includes('high_effectiveness') || s.includes('favorable') || s.includes('no_material') || s.includes('active_reference') || s.includes('verified_source') || s === 'stable_candidate' ? 'success' as const : s.includes('poor') || s.includes('strong_negative') || s.includes('severe') || s.includes('ineffective') || s.includes('conflicting') || s.includes('diverging') || s.includes('deprecated') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseValueEventRow[], emptyTitle: string, emptyDesc: string) => (
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
  const valueList = (list: EnterpriseBusinessValueRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((v) => (
          <div key={v.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(v.value_status)}>{v.value_status}</AdminBadge>
            <AdminBadge tone={tone(v.value_trend_status)}>{v.value_trend_status}</AdminBadge>
            <AdminBadge tone={tone(v.roi_status)}>{v.roi_status}</AdminBadge>
            <span className="ml-2 font-bold">{v.value_code}</span>
            <span className="ml-2 text-muted-foreground">{v.value_category} · {v.value_name} · baseline {NUM(v.baseline_value)} · current {NUM(v.current_value_reference)} · invest {NUM(v.investment_reference)}{v.unit_type ? ` ${v.unit_type}` : ''}</span>
          </div>
        ))}
      </div>
    )
  );
  const snapshotList = (list: EnterpriseValueSnapshotRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(s.data_quality)}>{s.data_quality}</AdminBadge>
            <span className="ml-2 font-bold">{s.observed_value == null ? 'null(관측 없음)' : NUM(s.observed_value)}</span>
            <span className="ml-2 text-muted-foreground">{s.snapshot_period_reference ?? '—'} · vs baseline {NUM(s.variance_vs_baseline)} · invest {NUM(s.investment_reference)} · benefit {NUM(s.benefit_reference)} · {new Date(s.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {valueSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => valueEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Value Intelligence & ROI Governance Center"
      subtitle="Strategic Initiative→Execution Outcome→Performance KPI→Business Value→Value Attribution→ROI Analysis→Investment Effectiveness→Enterprise Value Score→Value Trade-off→Executive Value Review→Outcome→Learning — 투자·경영 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 Execution 과 KPI 가 실제 Business Value 를 창출했는지 객관적으로 분석하는 Value Intelligence 계층입니다. AI 는 Business Value Model 구조화·Baseline/Investment Reference·Snapshot·Value Trend·Value Attribution·KPI/Execution→Value Link·ROI Candidate·Investment Effectiveness·Confidence·Drift·Correlation·Cross-Domain Value·Enterprise Value Score·Strategic Value Scorecard·Executive Value Summary·Trade-off·Recommendation·Review 요청까지만 수행하며, ROI 자동 승인/확정·자동 투자 승인/중단·자동 Budget/Resource Allocation/Strategy/KPI/Portfolio 변경·자동 Payment/Settlement/회계 처리·자동 기업가치 산정/M&A 판단/투자자 공시·자동 Production/Deploy/Merge 는 수행하지 않습니다. Business Value ≠ Financial Statement, ROI Candidate ≠ Accounting ROI, Attribution ≠ Proven Causality, KPI Improvement ≠ Value Creation, Value Score ≠ Company Valuation, Review ≠ Approval. AI 는 가치를 설명하고, 사람이 투자와 경영을 결정합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Business Values" value={NUM(num('values', 'total'))} />
            <Box label="Active / Paused / Deprecated" value={`${NUM(num('values', 'active'))} / ${NUM(num('values', 'paused'))} / ${NUM(num('values', 'deprecated'))}`} />
            <Box label="Baseline / Investment / Observed 보유" value={`${NUM(num('values', 'with_baseline'))} / ${NUM(num('values', 'with_investment'))} / ${NUM(num('values', 'with_observed'))}`} />
            <Box label="Positive / Negative Trend" value={`${NUM(num('values', 'positive_trend'))} / ${NUM(num('values', 'negative_trend'))}`} />
            <Box label="Excellent / Poor / Uncertain ROI" value={`${NUM(num('values', 'excellent_roi'))} / ${NUM(num('values', 'poor_roi'))} / ${NUM(num('values', 'uncertain_roi'))}`} />
            <Box label="Strong / Unverified Attribution" value={`${NUM(num('values', 'strong_attribution'))} / ${NUM(num('values', 'attribution_unverified'))}`} />
            <Box label="Snapshots (관측 / null)" value={`${NUM(num('snapshots', 'with_observed_value'))} / ${NUM(num('snapshots', 'null_observed'))}`} />
            <Box label="Verified / Unverified Source" value={`${NUM(num('snapshots', 'verified_source'))} / ${NUM(num('snapshots', 'quality_unverified'))}`} />
            <Box label="Baselines / Investment Refs" value={`${NUM(num('value_events', 'baselines'))} / ${NUM(num('value_events', 'investment_references'))}`} />
            <Box label="Trend / Attribution Reviews" value={`${NUM(num('value_events', 'trend_reviews'))} / ${NUM(num('value_events', 'attribution_reviews'))}`} />
            <Box label="KPI / Execution Link Reviews" value={`${NUM(num('value_events', 'kpi_link_reviews'))} / ${NUM(num('value_events', 'execution_link_reviews'))}`} />
            <Box label="ROI / Effectiveness Reviews" value={`${NUM(num('value_events', 'roi_reviews'))} / ${NUM(num('value_events', 'effectiveness_reviews'))}`} />
            <Box label="Drift / Correlation / Cross-Domain" value={`${NUM(num('value_events', 'drift_reviews'))} / ${NUM(num('value_events', 'correlation_reviews'))} / ${NUM(num('value_events', 'cross_domain_reviews'))}`} />
            <Box label="Value Scores / Scorecards" value={`${NUM(num('value_events', 'value_scores'))} / ${NUM(num('value_events', 'scorecards'))}`} />
            <Box label="Trade-off Reviews" value={NUM(num('value_events', 'tradeoff_reviews'))} />
            <Box label="Recommendations" value={NUM(num('value_events', 'recommendations'))} />
            <Box label="Value / Executive / Strategy Review 요청" value={`${NUM(num('value_events', 'value_review_requests'))} / ${NUM(num('value_events', 'executive_review_requests'))} / ${NUM(num('value_events', 'strategy_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('value_events', 'review_references'))} />
            <Box label="KPI / Initiative / Program Links" value={`${NUM(num('value_events', 'kpi_links'))} / ${NUM(num('value_events', 'initiative_links'))} / ${NUM(num('value_events', 'program_links'))}`} />
            <Box label="Outcome Links / Learning" value={`${NUM(num('value_events', 'business_outcome_links'))} / ${NUM(num('value_events', 'learning_references'))}`} />
          </div>
          <AdminAlert tone="info" description={`value_unavailable: ${Array.isArray(summary.value_unavailable) ? (summary.value_unavailable as unknown[]).map(String).join(', ') : '—'}. Value 원천 실측 — KPIs(0548) ${NUM(num('value_actuals', 'enterprise_kpis_0548'))}건 · KPI Snapshots(0548) ${NUM(num('value_actuals', 'kpi_snapshots_0548'))}건 · Programs(0547) ${NUM(num('value_actuals', 'execution_programs_0547'))}건 · Initiatives(0545) ${NUM(num('value_actuals', 'strategic_initiatives_0545'))}건 · Portfolios(0545) ${NUM(num('value_actuals', 'strategy_portfolios_0545'))}건 · Decision Outcomes(0514) ${NUM(num('value_actuals', 'decision_outcomes_0514'))}건 · Commitments(0520) ${NUM(num('value_actuals', 'commitments_0520'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="가치 대기함 — draft Value 와 저ROI/악화 후보. 우선순위와 투자 판단은 사람이 결정합니다." />
          {valueList(values.filter((v) => v.value_status === 'draft'), 'Draft Value 없음', '0건은 가치 체계가 완성됐음을 의미하지 않습니다.')}
          {valueList(values.filter((v) => v.roi_status === 'poor_roi_candidate' || ['moderate_negative_candidate', 'strong_negative_candidate'].includes(v.value_trend_status)), '저ROI/악화 후보 없음', 'Poor ROI/Negative Trend 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'values' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {BUSINESS_VALUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Value Model 생성(≠ 재무제표)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseBusinessValue({ value_category: catSel, value_name: r }), 'Value Model 생성됨(draft — 자동 확정 없음)');
            }, true)}
            {btn('Active Reference', () => valueReview('activate_reference', {}, 'active_reference'))}
            {btn('Pause', () => valueReview('pause_reference', {}, 'paused_reference'))}
            {btn('Deprecate', () => valueReview('deprecate_reference', {}, 'deprecated_reference'))}
            {valueSelect}
          </div>
          <AdminAlert tone="info" description="Category 16종 · 기업가치 산정/M&A/공시/개인 평가 계열 category 서버 차단 · deprecated 재결정 차단." />
          {valueList(values, 'Business Value 없음', '핵심 질문 예: 어떤 Initiative 가 가장 큰 Value 를 만들었는가? ROI 는? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'baseline' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{numInput}{reasonInput}
            {btn('Baseline 기록(출처 필수)', () => valueReview('record_baseline', { baseline_value: Number(numVal) || 0, baseline_source_reference: reason.trim() }, 'Baseline 기록됨'), true)}
          </div>
          <AdminAlert tone="warning" description="출처 없는 Value Baseline 기록 서버 차단 — Baseline ≠ 회계 확정 수치." />
          {eventList(evByType('value_baseline_recorded'), 'Baseline 기록 없음', 'Value Baseline 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'investments' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{numInput}{reasonInput}
            {btn('Investment Reference 기록(출처 필수)', () => valueReview('record_investment_reference', { investment_reference: Number(numVal) || 0, investment_source_reference: reason.trim() }, 'Investment Reference 기록됨(≠ 회계 장부)'), true)}
          </div>
          <AdminAlert tone="warning" description="Investment Reference ≠ 회계 장부/집행 승인 — 출처 없는 기록 서버 차단." />
          {eventList(evByType('value_investment_reference_recorded'), 'Investment Reference 없음', '투자 참조 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'snapshots' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{numInput}
            <select value={qualitySel} onChange={(e) => setQualitySel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {VALUE_DATA_QUALITY_LEVELS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            {reasonInput}
            {btn('Snapshot 기록(Observed)', () => {
              const r = needReason();
              if (!r || !selValue) { if (!selValue) toast.error('Value 선택 필수'); return; }
              void act(() => recordEnterpriseValueSnapshot({ business_value_id: selValue, observed_value: numVal.trim() === '' ? null : Number(numVal), data_quality: qualitySel, notes: r, snapshot_period_reference: r.slice(0, 60) }), 'Snapshot 기록됨(관측 없으면 null 유지)');
            }, true)}
          </div>
          <AdminAlert tone="info" description="Observed Business Value — 관측값 없으면 null 유지(0 치환 금지) · verified 표기는 출처 참조 필수." />
          {snapshotList(snapshots, 'Snapshot 없음', 'Value 관측 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'trends' && resultEventTab('value_trend_reviewed', 'Value Trend 검토', 'Trend 5단계(§5) — Value Trend ≠ Future Trend.', VALUE_TREND_RESULTS)}
      {tab === 'attribution' && resultEventTab('value_attribution_reviewed', 'Value Attribution 검토', 'Attribution 6차원(§7 — Strategy/Execution/KPI/Resource/External/Unknown) — Attribution ≠ Proven Causality.', VALUE_ATTRIBUTION_RESULTS, { attribution_dimension: attrDimSel })}
      {tab === 'attribution' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Attribution Dimension:</span>
          <select value={attrDimSel} onChange={(e) => setAttrDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {VALUE_ATTRIBUTION_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}
      {tab === 'kpilinks' && resultEventTab('kpi_value_link_reviewed', 'KPI → Value Link 검토', 'KPI(0548 실존 검증) 개선과 Value 변화의 연결 후보 — KPI Improvement ≠ Value Creation.', VALUE_LINK_RESULTS)}
      {tab === 'execlinks' && resultEventTab('execution_value_link_reviewed', 'Execution → Value Link 검토', 'Execution Program(0547 실존 검증)과 Value 의 연결 후보 — Link ≠ 인과 확정.', VALUE_LINK_RESULTS)}
      {tab === 'roi' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}
            <select value={ROI_RESULTS.includes(resultSel as (typeof ROI_RESULTS)[number]) ? resultSel : ROI_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ROI_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('ROI Candidate 기록(Evidence 필수)', () => valueEvent('roi_candidate_reviewed', { result: ROI_RESULTS.includes(resultSel as (typeof ROI_RESULTS)[number]) ? resultSel : ROI_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'ROI Candidate 기록됨(≠ Accounting ROI)'), true)}
          </div>
          <AdminAlert tone="warning" description="ROI Candidate ≠ Accounting ROI ≠ Investment Decision — Evidence 없는 ROI 기록 서버 차단, ROI History 누적." />
          {eventList(evByType('roi_candidate_reviewed'), 'ROI 검토 없음', 'ROI Candidate 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'effectiveness' && resultEventTab('investment_effectiveness_reviewed', 'Investment Effectiveness 검토', 'Effectiveness Candidate ≠ 투자 중단 신호 — 중단 판단은 사람.', INVESTMENT_EFFECTIVENESS_RESULTS)}
      {tab === 'confidence' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{numInput}{reasonInput}
            {btn('Confidence 기록(0~100)', () => valueEvent('value_confidence_reviewed', { confidence: Number(numVal) || 0 }, 'Confidence 기록됨(≠ Certainty)', true), true)}
          </div>
          <AdminAlert tone="info" description="Value Confidence ≠ Certainty — 표본·출처 품질·Attribution 상태 기반 후보 수치입니다." />
          {eventList(evByType('value_confidence_reviewed'), 'Confidence 기록 없음', 'Value Confidence 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'drift' && resultEventTab('value_drift_reviewed', 'Value Drift 검토', 'Value Drift ≠ 자동 재배분 신호 — 측정/정의 변화 후보.', VALUE_DRIFT_RESULTS)}
      {tab === 'correlation' && resultEventTab('value_correlation_reviewed', 'Value Correlation 검토', 'Value Correlation ≠ Causality — 표본 부족 시 sample_too_small 유지.', VALUE_CORRELATION_RESULTS)}
      {tab === 'crossdomain' && resultEventTab('cross_domain_value_reviewed', 'Cross-Domain Value 검토', 'Brand ↑ Revenue ↓ 같은 발산 후보 탐지 — Revenue Increase ≠ Enterprise Value Increase.', VALUE_CORRELATION_RESULTS)}

      {tab === 'valuescore' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{numInput}{reasonInput}
            {btn('Enterprise Value Score 기록(0~100)', () => valueEvent('enterprise_value_score_recorded', { value_score: Number(numVal) || 0 }, 'Value Score 기록됨(≠ Company Valuation)', true), true)}
          </div>
          <AdminAlert tone="warning" description={`Enterprise Value Score ≠ Company Valuation — §8 필드 9종(${VALUE_SCORE_FIELDS.join(', ')}) 기반 후보 점수.`} />
          {eventList(evByType('enterprise_value_score_recorded'), 'Value Score 없음', 'Enterprise Value Score 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{reasonInput}
            {btn('Strategic Value Scorecard 기록', () => valueEvent('strategic_value_scorecard_recorded', { fields: [...VALUE_SCORE_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 경영 평가)', true), true)}
          </div>
          <AdminAlert tone="info" description="저ROI/악화 우선 결정적 정렬 후보 — 자동 평가/투자 결정 없음." />
          {eventList(evByType('strategic_value_scorecard_recorded'), 'Scorecard 없음', '전략 Value Scorecard 기록이 여기에 표시됩니다.')}
          {valueList(values.filter((v) => v.roi_status === 'poor_roi_candidate' || v.value_trend_status === 'strong_negative_candidate'), 'Critical 우선 Value 없음', 'Poor ROI/Strong Negative 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'summaryrec' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reasonInput}
            {btn('Executive Value Summary 기록', () => valueEvent('executive_value_summary_recorded', { note: reason.trim() }, 'Executive Value Summary 기록됨'), true)}
          </div>
          <AdminAlert tone="info" description="Summary ≠ 가치 확정 — Executive 가 먼저 확인할 관측 요약 후보입니다." />
          {eventList(evByType('executive_value_summary_recorded'), 'Summary 없음', 'Executive Value Summary 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'tradeoff' && resultEventTab('value_tradeoff_reviewed', 'Value Trade-off 검토', '축 6종(단기 ROI vs 장기 Value·Brand vs Revenue 등) — Trade-off ≠ 자동 우선순위 결정.', VALUE_TRADEOFF_RESULTS, { axis: axisSel })}
      {tab === 'tradeoff' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="text-[11px] text-muted-foreground">Trade-off Axis:</span>
          <select value={axisSel} onChange={(e) => setAxisSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            {VALUE_TRADEOFF_AXES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {VALUE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => valueEvent('value_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Value Recommendation ≠ Decision — Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('value_recommendation_recorded'), 'Recommendation 없음', 'Value Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{reasonInput}
            {btn('Value Review 요청', () => execReview('request_value_review', {}, 'Value Review 요청됨'), true)}
            {btn('Executive Review 요청', () => execReview('request_executive_review', {}, 'Executive Review 요청됨(≠ Approval)'))}
            {btn('Strategy Review 요청', () => execReview('request_strategy_review', {}, 'Strategy Review 요청됨'))}
            {btn('Review Reference 기록(Evidence 필수)', () => execReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'))}
            {btn('수정 요청', () => execReview('request_revision', {}, '수정 요청됨'))}
          </div>
          <AdminAlert tone="warning" description="Executive Value Review — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · Review ≠ Approval. 최종 Value 판단은 반드시 사람이 수행합니다." />
          {eventList([...evByType('value_review_requested'), ...evByType('executive_review_requested'), ...evByType('strategy_review_requested'), ...evByType('value_revision_requested')], 'Review 요청 없음', 'Value/Executive/Strategy Review 요청이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review References — 사람 평가 기록(≠ Approval·자동 투자/회계 처리 없음)." />
          {valueList(values.filter((v) => v.review_reference != null), 'Review Reference Value 없음', '사람 평가가 기록된 Value 가 여기에 표시됩니다.')}
          {eventList(evByType('value_review_reference_recorded'), 'Review Reference 이벤트 없음', '평가 Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{reasonInput}
            {btn('KPI Link(0548 실존 검증)', () => valueEvent('kpi_reference_linked', { note: reason.trim() }, 'KPI Link 기록됨', true), true)}
            {btn('Initiative Link(0545)', () => valueEvent('initiative_reference_linked', { note: reason.trim() }, 'Initiative Link 기록됨', true))}
            {btn('Portfolio Link(0545)', () => valueEvent('portfolio_reference_linked', { note: reason.trim() }, 'Portfolio Link 기록됨'))}
            {btn('Program Link(0547)', () => valueEvent('program_reference_linked', { note: reason.trim() }, 'Program Link 기록됨', true))}
            {btn('Decision Outcome Link(0514)', () => valueEvent('decision_outcome_linked', { note: reason.trim() }, 'Decision Outcome Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0514/0545/0547/0548). Link ≠ 인과/성공/ROI 확정." />
          {eventList([...evByType('kpi_reference_linked'), ...evByType('initiative_reference_linked'), ...evByType('portfolio_reference_linked'), ...evByType('program_reference_linked'), ...evByType('decision_outcome_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'outcomes' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{reasonInput}
            {btn('Business Outcome 연결', () => valueEvent('business_outcome_linked', { note: reason.trim() }, 'Outcome 연결됨(≠ Proven Causality)', true), true)}
          </div>
          <AdminAlert tone="info" description="Outcome Link ≠ Proven Causality — KPI 변화가 우연인지의 판단은 사람이 수행합니다." />
          {eventList(evByType('business_outcome_linked'), 'Outcome Link 없음', '관측된 Business Outcome 연결이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {valueSelect}{reasonInput}
            {btn('Value Learning 기록', () => valueEvent('value_learning_reference_recorded', { note: reason.trim() }, 'Learning Reference 기록됨', true), true)}
          </div>
          <AdminAlert tone="info" description="Learning Reference ≠ 자동 전략 변경 — 학습 반영 여부는 사람이 결정합니다." />
          {eventList(evByType('value_learning_reference_recorded'), 'Learning Reference 없음', '가치 학습 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Value 흐름 관측 — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님)." />
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
          <AdminAlert tone="info" description={`Value 이벤트 32종 통합 Audit — 총 ${NUM(num('value_events', 'total'))}건. 자동 확정 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Value Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 컴포넌트 ${ENTERPRISE_VALUE_COMPONENTS.length}종 · 매트릭스 ${ENTERPRISE_VALUE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 ROI 확정/투자 승인/회계 처리 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_VALUE_SUPPORT_MATRIX.map((e) => (
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
