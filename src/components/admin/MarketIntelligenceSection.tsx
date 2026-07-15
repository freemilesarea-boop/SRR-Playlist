/**
 * MarketIntelligenceSection — Enterprise Market Intelligence, Competitive Intelligence &
 * External Environment Center (Phase AI-OPS-24).
 *
 * Enterprise→Market→Competition→Industry→External Signals→Market Intelligence→Executive Market Advisory.
 * 자동 경쟁사 생성/시장 분석 확정/전략·KPI·예산 변경 없음 · Signal ≠ Fact ·
 * Market Trend ≠ Future Guarantee · Opportunity ≠ Success · Correlation ≠ Causation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Building2, Factory, GitBranch, Grid3x3, History, Layers, Lightbulb,
  Lock, MapPin, Radio, RefreshCw, Scale, ScrollText, ShieldAlert, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchMarketSummary, createMarketCompetitor, observeMarketCompetitor, reviewMarketCompetitor,
  fetchMarketCompetitors, recordMarketSignal, reviewMarketSignal, fetchMarketSignals,
  fetchMarketCategoryTimeline, recordMarketGovernance, fetchMarketAudit,
  type MarketSummary, type MarketCompetitorRow, type MarketSignalRow,
  type MarketCategoryPoint, type MarketEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  analyzeCategoryTrends, assessCompetitorCoverage, analyzeIndustry, analyzeRegionalPattern,
  analyzeCustomerBehavior, proposeMarketOpportunity, assessMarketRisk, correlateMarketChain,
  buildMarketBriefing, buildMarketRecommendation, buildMarketDashboard,
  MARKET_SUPPORT,
} from '@/lib/marketIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const COMP_TERMINAL = ['superseded_reference', 'invalidated'];
const SIGNAL_TERMINAL = ['expired_reference', 'invalidated'];

type Tab = 'dashboard' | 'trends' | 'competitors' | 'industry' | 'signals' | 'regional' | 'behavior'
  | 'opportunities' | 'risks' | 'correlation' | 'briefing' | 'recommendations' | 'humanreviews'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'dashboard', label: 'Executive Market Dashboard', icon: Layers },
  { key: 'trends', label: 'Market Trend Intelligence', icon: TrendingUp },
  { key: 'competitors', label: 'Competitive Intelligence', icon: Building2 },
  { key: 'industry', label: 'Industry Intelligence', icon: Factory },
  { key: 'signals', label: 'External Signals', icon: Radio },
  { key: 'regional', label: 'Regional Intelligence', icon: MapPin },
  { key: 'behavior', label: 'Customer Behavior', icon: Activity },
  { key: 'opportunities', label: 'Market Opportunities', icon: Lightbulb },
  { key: 'risks', label: 'Market Risk', icon: ShieldAlert },
  { key: 'correlation', label: 'Market Correlation', icon: GitBranch },
  { key: 'briefing', label: 'Executive Market Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Market Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const SIGNAL_KINDS = ['economic', 'seasonal', 'regulatory', 'technology', 'consumer'] as const;

export default function MarketIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<MarketSummary>({});
  const [competitors, setCompetitors] = useState<MarketCompetitorRow[]>([]);
  const [signals, setSignals] = useState<MarketSignalRow[]>([]);
  const [catTimeline, setCatTimeline] = useState<MarketCategoryPoint[]>([]);
  const [audit, setAudit] = useState<MarketEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, co, si, tl, au] = await Promise.all([
        fetchMarketSummary(), fetchMarketCompetitors(null, 100), fetchMarketSignals(null, 100),
        fetchMarketCategoryTimeline(30), fetchMarketAudit(100),
      ]);
      setSummary(s); setCompetitors(co); setSignals(si); setCatTimeline(tl); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  const behaviorActuals = useMemo(() => (typeof summary.behavior_actuals === 'object' && summary.behavior_actuals !== null && !Array.isArray(summary.behavior_actuals) ? summary.behavior_actuals as Record<string, unknown> : {}), [summary]);
  const bnum = useCallback((k: string): number | null => (typeof behaviorActuals[k] === 'number' ? behaviorActuals[k] as number : null), [behaviorActuals]);
  const categoryPlays = useMemo(() => (typeof summary.category_plays_30d === 'object' && summary.category_plays_30d !== null && !Array.isArray(summary.category_plays_30d) ? summary.category_plays_30d as Record<string, number> : {}), [summary]);
  const hourDist = useMemo(() => (typeof summary.hour_distribution_30d === 'object' && summary.hour_distribution_30d !== null && !Array.isArray(summary.hour_distribution_30d) ? summary.hour_distribution_30d as Record<string, number> : {}), [summary]);

  const categoryTrends = useMemo(() => {
    const byCat = new Map<string, { day: string; plays: number }[]>();
    for (const p of catTimeline) {
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category)!.push({ day: p.day, plays: p.plays });
    }
    return analyzeCategoryTrends([...byCat.entries()].map(([category, pts]) => ({
      category, points: pts.sort((a, b) => a.day.localeCompare(b.day)).map((x) => ({ value: x.plays })),
    })));
  }, [catTimeline]);

  const coverage = useMemo(() => assessCompetitorCoverage(competitors.filter((c) => !COMP_TERMINAL.includes(c.record_status)).map((c) => ({
    name: c.name, dataAvailability: c.data_availability, evidenceCount: (c.evidence ?? []).length,
  }))), [competitors]);

  const activeSignals = useMemo(() => signals.filter((s) => !SIGNAL_TERMINAL.includes(s.signal_status)), [signals]);

  const industry = useMemo(() => analyzeIndustry({
    growthSignals: activeSignals.filter((s) => s.signal_kind === 'industry').length,
    riskSignals: activeSignals.filter((s) => ['regulatory', 'economic'].includes(s.signal_kind)).length,
    opportunitySignals: activeSignals.filter((s) => ['consumer', 'technology'].includes(s.signal_kind)).length,
    evidence: activeSignals.length ? ['market_signals 실측(observed)'] : [],
  }), [activeSignals]);

  const regional = useMemo(() => analyzeRegionalPattern(Object.entries(categoryPlays).map(([name, plays]) => ({ name, plays: typeof plays === 'number' ? plays : null }))), [categoryPlays]);

  const behavior = useMemo(() => analyzeCustomerBehavior({
    hourCounts: hourDist, sessionCount: bnum('distinct_sessions_30d'),
    playlistsPlayed: bnum('playlists_played_30d'), playlistsTotal: bnum('playlists_total'),
  }), [hourDist, bnum]);

  const opportunities = useMemo(() => {
    const out: { type: string; basis: string; confidence: number | null }[] = [];
    const push = (r: ReturnType<typeof proposeMarketOpportunity>) => { if (!('rejected' in r)) out.push({ type: r.type, basis: r.basis, confidence: r.confidence }); };
    for (const t of categoryTrends.trends.filter((x) => x.trend === 'improving').slice(0, 3)) {
      push(proposeMarketOpportunity({ type: 'growth_candidate', basis: `${t.category} 재생 상승 관찰(${t.changePct ?? '—'}%)`, evidence: ['category timeline 실측'], unknownFactors: ['외부 수요', '계절성'] }));
    }
    if (behavior.adoptionPct != null && behavior.adoptionPct < 50) {
      push(proposeMarketOpportunity({ type: 'opportunity_candidate', basis: `Playlist 채택률 ${behavior.adoptionPct}% — 미사용 Playlist 활용 검토 후보`, evidence: ['playlist adoption 실측'], unknownFactors: ['수요 원인'] }));
    }
    return out;
  }, [categoryTrends, behavior]);

  const risks = useMemo(() => {
    const declining = categoryTrends.trends.filter((t) => t.trend === 'declining' || t.trend === 'volatile').length;
    const analyzed = categoryTrends.trends.filter((t) => t.dataStatus === 'ok').length;
    return [
      assessMarketRisk({ kind: 'competition_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['경쟁사 외부 데이터 없음 — unknown 유지'] }),
      assessMarketRisk({ kind: 'demand_risk', signal: analyzed > 0 ? Math.round((declining / analyzed) * 100) : null, highThreshold: 50, mediumThreshold: 25, evidence: analyzed ? ['category trend 실측'] : [] }),
      assessMarketRisk({ kind: 'seasonal_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['계절성 시장 데이터셋 없음 — unknown 유지'] }),
      assessMarketRisk({ kind: 'regulatory_risk', signal: activeSignals.some((s) => s.signal_kind === 'regulatory') ? 50 : null, highThreshold: 80, mediumThreshold: 40, evidence: activeSignals.some((s) => s.signal_kind === 'regulatory') ? ['regulatory signal observed'] : ['규제 피드 없음 — unknown 유지'] }),
      assessMarketRisk({ kind: 'market_uncertainty', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['외부 시장 데이터 없음 — unknown 유지'] }),
    ];
  }, [categoryTrends, activeSignals]);

  const totalTrend = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of catTimeline) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.plays);
    const pts = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => ({ value: v }));
    return analyzeCategoryTrends([{ category: 'all', points: pts }]).trends[0] ?? null;
  }, [catTimeline]);

  const correlations = useMemo(() => {
    const top = categoryTrends.trends.find((t) => t.dataStatus === 'ok');
    return correlateMarketChain([
      { label: `Market(${top?.category ?? 'top category'}) ↔ Customer(전체 재생)`, strategySignal: top?.changePct ?? null, kpiSignal: totalTrend?.changePct ?? null, sample: new Set(catTimeline.map((p) => p.day)).size },
      { label: 'Market ↔ Strategy(0524)', strategySignal: null, kpiSignal: null, sample: 0 },   // 전략↔시장 시계열 원본 없음
      { label: 'Market ↔ KPI(0525)', strategySignal: null, kpiSignal: null, sample: 0 },
    ]);
  }, [categoryTrends, totalTrend, catTimeline]);

  const briefing = useMemo(() => buildMarketBriefing({
    periodKind: 'weekly',
    marketChanges: categoryTrends.trends.filter((t) => t.dataStatus === 'ok').slice(0, 5).map((t) => `${t.category}: ${t.trend}(${t.changePct ?? '—'}%)`),
    opportunities: opportunities.map((o) => `${o.type}: ${o.basis}`),
    risks: risks.filter((r) => r.level === 'high' || r.level === 'medium').map((r) => `${r.kind}: ${r.level}`),
    unknownFactors: risks.filter((r) => r.level === 'unknown').map((r) => `${r.kind}: 외부 데이터 없음`),
    recommendations: [],
  }), [categoryTrends, opportunities, risks]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildMarketRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (!activeSignals.length) push(buildMarketRecommendation({ type: 'observe_market', reason: '관찰된 Market Signal 없음 — 관찰 기록 시작 필요', evidence: ['signals:0'], confidence: null, assumptions: [] }));
    if (coverage.unverified.length) push(buildMarketRecommendation({ type: 'review_competitor', reason: `Evidence 없는 경쟁사 프로필 ${coverage.unverified.length}건`, evidence: coverage.unverified, confidence: null, assumptions: [] }));
    if (opportunities.length) push(buildMarketRecommendation({ type: 'validate_opportunity', reason: `기회 후보 ${opportunities.length}건 — 확정 아님, 검증 필요`, evidence: ['opportunity candidates'], confidence: null, assumptions: [] }));
    if (categoryTrends.trends.some((t) => t.trend === 'declining')) push(buildMarketRecommendation({ type: 'review_customer_trend', reason: '하락 카테고리 관찰 — 원인 검토(단정 아님)', evidence: ['category trend'], confidence: null, assumptions: [] }));
    if (risks.some((r) => r.level === 'unknown')) push(buildMarketRecommendation({ type: 'gather_external_evidence', reason: 'unknown 리스크 존재 — 외부 데이터 확보 전 해석 금지', evidence: ['risk_unknown'], confidence: null, assumptions: [] }));
    if (industry.verdict !== 'observation_based') push(buildMarketRecommendation({ type: 'monitor_industry', reason: '산업 신호 부족 — industry signal 관찰 필요', evidence: [industry.verdict], confidence: null, assumptions: [] }));
    return out;
  }, [activeSignals, coverage, opportunities, categoryTrends, risks, industry]);

  const dashboard = useMemo(() => buildMarketDashboard({
    categoriesTracked: Object.keys(categoryPlays).length,
    signalsObserved: activeSignals.filter((s) => s.signal_status === 'observed').length,
    competitorsProfiled: coverage.profiled, competitorsUnavailable: coverage.marketUnavailable,
    opportunitiesProposed: opportunities.length,
    risksHigh: risks.filter((r) => r.level === 'high').length,
    behaviorVerdict: behavior.verdict, summaryNote: null,
  }), [categoryPlays, activeSignals, coverage, opportunities, risks, behavior]);

  if (loading) return <AdminCard title="Enterprise Market Intelligence & External Environment Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Market Intelligence & External Environment Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Market Intelligence & External Environment Center"
      subtitle="Market→Competition→Industry→External Signals→Market Intelligence→Executive Market Advisory — 자동 경쟁사 생성/시장 분석 확정 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 경쟁사 생성, 자동 시장 분석 확정, 자동 사업 전략/KPI/예산/계약/Production 변경, 자동 Merge/Deploy 는 없습니다. 외부 시장 데이터가 없는 항목은 market_unavailable 로 유지하며 임의 생성하지 않습니다. Market Trend ≠ Future Guarantee, Competition ≠ Threat, Opportunity ≠ Success, Signal ≠ Fact, Correlation ≠ Causation, Recommendation ≠ Business Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {dashboard.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <AdminAlert tone="info" description={`market_unavailable: ${Array.isArray(summary.market_unavailable) ? (summary.market_unavailable as unknown[]).map(String).join(', ') : '—'} — 외부 원본 없음(임의 생성 금지).`} />
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · marketConclusionConfirmed=false</p>
        </div>
      )}

      {/* ── Trends ── */}
      {tab === 'trends' && (
        !categoryTrends.trends.length ? <AdminEmpty title="Trend 자료 없음" description="카테고리별 재생 시계열이 쌓이면 Improving/Stable/Declining/Volatile 로만 분류합니다." /> : (
          <div className="space-y-1">
            {categoryTrends.trends.map((t) => (
              <div key={t.category} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{t.category}</span>
                {t.dataStatus === 'ok' ? (
                  <AdminBadge tone={t.trend === 'improving' ? 'success' : t.trend === 'declining' ? 'danger' : t.trend === 'volatile' ? 'warning' : 'neutral'}>{t.trend}</AdminBadge>
                ) : <AdminBadge tone="warning">{t.dataStatus}</AdminBadge>}
                <span className="ml-2 text-muted-foreground">{t.changePct == null ? '변화율 계산 불가' : `${t.changePct}%`} · 30d 내부 실측 · Trend ≠ Future Guarantee</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Industry/Seasonal Trend 는 외부 데이터셋이 없어 내부 시계열 관찰만 제공합니다(market_unavailable).</p>
          </div>
        )
      )}

      {/* ── Competitors ── */}
      {tab === 'competitors' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => createMarketCompetitor({ code: `comp_${now.toISOString().slice(0, 19)}`, name: r.slice(0, 100), evidence: [{ label: 'source', value: '사람 입력 관찰' }] }), '경쟁사 프로필 기록(사람 입력·Threat 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">경쟁사 프로필 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="경쟁사 이름/관찰 내용/사유(사람 입력·필수)" className="min-w-[240px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="프로필(사람 입력)" value={NUM(coverage.profiled)} />
            <Box label="외부 데이터 보유" value={NUM(coverage.externalDataAvailable)} />
            <Box label="market_unavailable" value={NUM(coverage.marketUnavailable)} />
            <Box label="Evidence 없음" value={NUM(coverage.unverified.length)} />
          </div>
          {!competitors.length ? <AdminEmpty title="경쟁사 프로필 없음" description="경쟁사는 AI 가 자동 생성하지 않습니다 — 사람 입력만 기록됩니다. 외부 데이터 없는 경쟁사는 market_unavailable 로 유지됩니다." /> : competitors.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.competitor_code}</span>
                <span className="font-bold">{c.name}</span>
                <AdminBadge tone={c.data_availability === 'external_data_available' ? 'success' : 'warning'}>{c.data_availability}</AdminBadge>
                <AdminBadge tone={c.record_status === 'active_reference' ? 'info' : 'neutral'}>{c.record_status}</AdminBadge>
                <span className="text-muted-foreground">{c.category ?? '—'} · {c.region ?? '—'} · Competition ≠ Threat</span>
              </div>
              {!COMP_TERMINAL.includes(c.record_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => observeMarketCompetitor(c.id, rr), '관찰 기록(사실 단정 아님)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">관찰 기록</button>
                  {(['active_reference', 'under_review', 'superseded_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewMarketCompetitor(c.id, st, rr), st); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {(() => {
            const obs = audit.filter((e) => e.event_type === 'competitor_observed').slice(0, 10);
            return obs.length ? (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-muted-foreground">Competitor Timeline(관찰 이력)</p>
                {obs.map((e) => (
                  <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
                ))}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── Industry ── */}
      {tab === 'industry' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="판정" value={industry.verdict} />
            <Box label="Growth 신호(observed)" value={NUM(industry.observationCounts.growth)} />
            <Box label="Risk 신호(observed)" value={NUM(industry.observationCounts.risk)} />
            <Box label="Opportunity 신호(observed)" value={NUM(industry.observationCounts.opportunity)} />
          </div>
          <AdminAlert tone="info" description="Industry Growth/Risk/Opportunity/Change 는 산업 데이터셋 원본이 없어 사람이 기록한 observed signal 집계만 제공합니다(market_unavailable). notConfirmedConclusion=true — 확정 결론이 아닙니다." />
        </div>
      )}

      {/* ── Signals ── */}
      {tab === 'signals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {SIGNAL_KINDS.map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => recordMarketSignal({ code: `sig_${kind}_${now.toISOString().slice(0, 19)}`, kind, title: r.slice(0, 100), evidence: [{ label: 'source', value: '사람 관찰 기록' }] }), `${kind} signal 기록(observed — Fact 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 기록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Signal 제목/사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!signals.length ? <AdminEmpty title="Signal 없음" description="Signal 은 Confirmed 가 아닌 observed 상태에서 시작합니다(Signal ≠ Fact)." /> : signals.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{s.signal_code}</span>
                <AdminBadge tone="info">{s.signal_kind}</AdminBadge>
                <AdminBadge tone={s.signal_status === 'observed' ? 'warning' : s.signal_status === 'corroborated_reference' ? 'success' : 'neutral'}>{s.signal_status}</AdminBadge>
                <span className="text-muted-foreground">{s.title} · Signal ≠ Fact</span>
              </div>
              {!SIGNAL_TERMINAL.includes(s.signal_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewMarketSignal(s.id, 'corroborated_reference', rr, [{ label: 'additional', value: rr }]), 'corroborated(추가 Evidence — Fact 확정 아님)'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">corroborated(Evidence 추가)</button>
                  {(['contradicted_reference', 'expired_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewMarketSignal(s.id, st, rr), st); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Regional / Behavior ── */}
      {tab === 'regional' && (
        <div className="space-y-2">
          {regional.verdict === 'market_unavailable' ? <AdminEmpty title="지역 패턴 자료 없음" description="Country/Region/City 시장 데이터 원본이 없습니다 — 내부 카테고리 분포만 제공됩니다(market_unavailable)." /> : (
            <div className="space-y-1">
              {regional.shares.map((s) => (
                <div key={s.name} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{s.name}</span>
                  <span className="ml-2 text-muted-foreground">{NUM(s.plays)} plays · {s.sharePct}%</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Enterprise Regions(조직 실측)" value={NUM(bnum('enterprise_regions_registered'))} />
            <Box label="null 제외" value={NUM(regional.excludedNull)} />
            <Box label="Country/City 시장 데이터" value="market_unavailable" />
          </div>
          <AdminAlert tone="info" description="서울→카페→로파이 같은 지역×카테고리 시장 패턴은 지역 시장 데이터 원본이 없어 카테고리(store_type_slug) 수준 내부 분포만 제공합니다. enterprise_regions 는 조직 구조이며 시장 지역 데이터가 아닙니다." />
        </div>
      )}
      {tab === 'behavior' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Plays(30d)" value={NUM(bnum('plays_30d'))} />
            <Box label="Sessions(30d)" value={NUM(bnum('distinct_sessions_30d'))} />
            <Box label="Playlist 채택률" value={behavior.adoptionPct == null ? 'insufficient_data' : `${behavior.adoptionPct}%`} />
            <Box label="Peak Hours(top3)" value={behavior.peakHours.length ? behavior.peakHours.map((h) => `${h}시`).join(', ') : 'insufficient_data'} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="카테고리 수(30d)" value={NUM(bnum('distinct_categories_30d'))} />
            <Box label="Playlists 재생(30d)" value={NUM(bnum('playlists_played_30d'))} />
            <Box label="판정" value={behavior.verdict} />
          </div>
          <p className="text-[10px] text-muted-foreground">internalDataOnly=true — Listening/Store Usage/Playlist Adoption/Session/Time Pattern 전부 내부 실측(playback_events_v2)입니다.</p>
        </div>
      )}

      {/* ── Opportunities / Risks / Correlation ── */}
      {tab === 'opportunities' && (
        !opportunities.length ? <AdminEmpty title="기회 후보 없음" description="Evidence 있는 관찰이 쌓이면 Opportunity/Growth/Expansion Candidate 를 제안합니다 — 확정이 아닙니다." /> : (
          <div className="space-y-1">
            {opportunities.map((o, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{o.type}</AdminBadge>
                <span className="ml-2">{o.basis}</span>
                <span className="ml-2 text-muted-foreground">confidence {o.confidence ?? '—'} · Opportunity ≠ Success · 확정 아님</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'risks' && (
        <div className="space-y-1">
          {risks.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.kind}</span>
              <AdminBadge tone={r.level === 'high' ? 'danger' : r.level === 'medium' ? 'warning' : r.level === 'low' ? 'success' : 'neutral'}>{r.level}</AdminBadge>
              <span className="ml-2 text-muted-foreground">notFactualClaim{r.level === 'unknown' ? ' · 외부 데이터 없음 — unknown 유지' : ''}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'correlation' && (
        <div className="space-y-1">
          {correlations.pairs.map((p) => (
            <div key={p.label} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{p.label}</span>
              <AdminBadge tone={p.verdict === 'correlation_candidate' ? 'info' : p.verdict === 'no_known_correlation' ? 'neutral' : 'warning'}>{p.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{p.strength ?? '—'} · Correlation ≠ Causation(인과 주장 없음)</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Market→Customer→Strategy→Execution→KPI 체인은 상관 관찰만 수행하며, 전략/KPI 시계열 원본이 없는 쌍은 insufficient_data 로 유지됩니다.</p>
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordMarketGovernance('market_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Market Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 금지)</p>
        </div>
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Business Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['competitor_recorded', 'competitor_reviewed', 'market_signal_recorded', 'market_signal_reviewed'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="경쟁사 프로필/Signal 기록·검토는 전부 사람이 수행합니다." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_market_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 시장 자료는 참조로만 기록됩니다 — 원본 없이 시장 결론을 확정하지 않습니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordMarketGovernance('market_risk_assessed', r, { risks: risks.map((x) => ({ kind: x.kind, level: x.level })) }), 'Risk 평가 기록(사실 단정 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Risk 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="시장 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {MARKET_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
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
