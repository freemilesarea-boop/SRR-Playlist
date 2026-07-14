/**
 * ExecutiveStrategySection — AI Executive Intelligence, Business Strategy & Decision
 * Intelligence Center (Phase AI-OPS-8).
 *
 * 경영진용 통합 View: KPI(실측) → Financial(실측/추정 분리) → Growth → Risk → Forecast →
 * Scenario(evidence-only) → Explainable Decision → Daily Briefing → 사람 결정 → Audit.
 * AI 는 추천·근거만 제공 — 자동 계약/정산/가격/요금제/플레이리스트 변경·자동 영업·
 * 자동 의사결정·Production Apply/Merge/Deploy 없음.
 *
 * 탭 15개: Executive Overview · Revenue · Growth · Financial · Forecast · Decision Center ·
 * Risks · Strategy · AI Insights · Executive Reports · Daily Briefing · Recommendations ·
 * Simulation · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, BarChart3, Brain, Briefcase, FileText, FlaskConical,
  Grid3x3, Layers, Lightbulb, Lock, RefreshCw, Scale, ScrollText, Target, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchExecBusinessSummary, fetchExecGrowthSeries, saveExecBriefing, fetchExecBriefings,
  saveExecDecision, decideExecDecision, fetchExecDecisions, fetchExecAudit, fetchCapacityUsage, fetchIncidents,
  type ExecBusinessSummary, type ExecGrowthSeries, type ExecBriefingRow, type ExecDecisionRow,
  type ExecEventRow, type CapacityUsageDay, type IncidentRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  calculateArrEstimate, calculateLtvEstimate, calculateCac,
  calculateBusinessRisk, buildDecisionRecommendation, validateExplainableDecision, buildDailyBriefing,
  evaluateBusinessScenario, forecastDemand, EXEC_SUPPORT, RISK_TONE, SCENARIO_TONE, DECISION_TONE,
  type DailyUsagePoint, type ExplainableDecision,
} from '@/lib/executiveStrategy';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const KRW = (n: number | string | null | undefined) => (n == null || n === 'cost_unknown' ? (n === 'cost_unknown' ? 'cost_unknown' : '—') : `₩${Number(n).toLocaleString('ko-KR')}`);

type Tab = 'overview' | 'revenue' | 'growth' | 'financial' | 'forecast' | 'decisions' | 'risks' | 'strategy'
  | 'insights' | 'reports' | 'briefing' | 'recommendations' | 'simulation' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Executive Overview', icon: Layers },
  { key: 'revenue', label: 'Revenue', icon: Banknote },
  { key: 'growth', label: 'Growth', icon: TrendingUp },
  { key: 'financial', label: 'Financial', icon: Briefcase },
  { key: 'forecast', label: 'Forecast', icon: BarChart3 },
  { key: 'decisions', label: 'Decision Center', icon: Scale },
  { key: 'risks', label: 'Risks', icon: AlertTriangle },
  { key: 'strategy', label: 'Strategy', icon: Target },
  { key: 'insights', label: 'AI Insights', icon: Brain },
  { key: 'reports', label: 'Executive Reports', icon: FileText },
  { key: 'briefing', label: 'Daily Briefing', icon: FileText },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'simulation', label: 'Simulation', icon: FlaskConical },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ExecutiveStrategySection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<ExecBusinessSummary>({});
  const [growth, setGrowth] = useState<ExecGrowthSeries | null>(null);
  const [briefings, setBriefings] = useState<ExecBriefingRow[]>([]);
  const [decisions, setDecisions] = useState<ExecDecisionRow[]>([]);
  const [audit, setAudit] = useState<ExecEventRow[]>([]);
  const [usage, setUsage] = useState<CapacityUsageDay[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, g, b, d, au, u, inc] = await Promise.all([
        fetchExecBusinessSummary(), fetchExecGrowthSeries(6), fetchExecBriefings(30),
        fetchExecDecisions(null, 100), fetchExecAudit(100), fetchCapacityUsage(30), fetchIncidents(null, null, 20),
      ]);
      setSummary(s); setGrowth(g); setBriefings(b); setDecisions(d); setAudit(au); setUsage(u); setIncidents(inc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수(Human Approval)'); return null; }
    return reason.trim();
  };

  const mrr = summary.mrr_actual as number | null ?? null;
  const arr = useMemo(() => calculateArrEstimate(mrr), [mrr]);
  const churn = summary.churn_rate_pct as number | null ?? null;
  const ltv = useMemo(() => {
    const activeSubs = summary.subscriptions_active as number | null;
    const avgRev = mrr != null && activeSubs != null && activeSubs > 0 ? mrr / activeSubs : null;
    return calculateLtvEstimate(avgRev, churn);
  }, [mrr, summary, churn]);
  const cac = useMemo(() => calculateCac(), []);
  const eventSeries: DailyUsagePoint[] = useMemo(() => usage.map((u) => ({ day: u.day, value: u.events })), [usage]);
  const trafficForecast = useMemo(() => forecastDemand(eventSeries, 30), [eventSeries]);

  const bizRisk = useMemo(() => {
    const expiring = summary.contracts_expiring_90d as number | null;
    const signed = summary.contracts_signed_total as number | null;
    const mom = summary.revenue_mom_pct as number | null;
    return calculateBusinessRisk({
      contractExpiryRisk: expiring != null && signed != null && signed > 0 ? Math.min(100, (expiring / signed) * 100 * 2) : null,
      churnRisk: churn,
      usageDeclineRisk: trafficForecast.pointForecast != null && eventSeries.at(-1) ? (trafficForecast.pointForecast < eventSeries.at(-1)!.value ? 60 : 15) : null,
      storeInactivityRisk: null,
      revenueDeclineRisk: mom != null ? (mom < -10 ? 80 : mom < 0 ? 50 : 10) : null,
      securityRisk: 60,   // AI-OPS-7 실측: 단일 관리자/rbac_limited/logging gap 기준 high
      operationalRisk: incidents.filter((i) => !i.resolved_at).length > 0 ? 60 : 20,
    });
  }, [summary, churn, trafficForecast, eventSeries, incidents]);

  const autoRecommendations = useMemo(() => {
    const out: ExplainableDecision[] = [];
    const topIndustry = growth?.growth_by_industry?.[0];
    if (topIndustry) {
      const r = buildDecisionRecommendation({ category: 'target_industry', topCandidate: topIndustry.industry, metricValue: topIndustry.count, sampleSize: growth!.growth_by_industry.reduce((a, x) => a + x.count, 0), code: `rec_industry_${now.toISOString().slice(0, 10)}` });
      if (!('insufficient' in r)) out.push(r);
    }
    const expiring = summary.contracts_expiring_90d as number | null;
    if (expiring != null && expiring > 0) {
      const r = buildDecisionRecommendation({ category: 'contract_renewal', topCandidate: `만료 임박 ${expiring}건`, metricValue: expiring, sampleSize: (summary.contracts_signed_total as number) ?? 0, code: `rec_contract_${now.toISOString().slice(0, 10)}` });
      if (!('insufficient' in r)) out.push(r);
    }
    if (bizRisk.level === 'high' || bizRisk.level === 'critical') {
      const r = buildDecisionRecommendation({ category: 'risk_priority', topCandidate: '매출/계약 위험', metricValue: bizRisk.score ?? 0, sampleSize: 10, code: `rec_risk_${now.toISOString().slice(0, 10)}` });
      if (!('insufficient' in r)) out.push(r);
    }
    return out;
  }, [growth, summary, bizRisk, now]);

  const briefingPreview = useMemo(() => buildDailyBriefing({
    todayRevenue: summary.revenue_30d as number | null, yesterdayRevenue: summary.revenue_prev_30d as number | null,
    newContracts: (summary.contracts_new_30d as number) ?? 0, expiringContracts: (summary.contracts_expiring_90d as number) ?? 0,
    activeIncidents: incidents.filter((i) => !i.resolved_at).length,
    criticalRisks: bizRisk.level === 'critical' || bizRisk.level === 'high' ? [`business risk ${bizRisk.level}`] : [],
    todoItems: decisions.filter((d) => d.decision_status === 'proposed').map((d) => d.recommendation.slice(0, 40)).slice(0, 5),
    topRecommendations: autoRecommendations.map((r) => r.recommendation).slice(0, 10),
  }, now), [summary, incidents, bizRisk, decisions, autoRecommendations, now]);

  const SCENARIOS = useMemo(() => {
    const stores = summary.active_stores_30d as number | null;
    const businesses = summary.active_businesses as number | null;
    const tracks = summary.tracks_total as number | null;
    return [
      { label: '매장 500개 증가', r: evaluateBusinessScenario({ scenario: '매장 +500', kind: 'stores' as const, delta: 500 }, { current: stores, capacityLimit: null, mrr }) },
      { label: '기업 50개 증가', r: evaluateBusinessScenario({ scenario: '기업 +50', kind: 'enterprises' as const, delta: 50 }, { current: businesses, capacityLimit: null, mrr }) },
      { label: '신규 음원 10만곡', r: evaluateBusinessScenario({ scenario: '음원 +100k', kind: 'tracks' as const, delta: 100000 }, { current: tracks, capacityLimit: null, mrr }) },
      { label: '서버 비용 2배', r: evaluateBusinessScenario({ scenario: '서버 비용 ×2', kind: 'server_cost' as const, multiplier: 2 }, { current: 1, capacityLimit: null, mrr }) },
      { label: '해지율 30% 가정', r: evaluateBusinessScenario({ scenario: '해지율 30%', kind: 'churn' as const, multiplier: 30 }, { current: 1, capacityLimit: null, mrr }) },
    ];
  }, [summary, mrr]);

  if (loading) return <AdminCard title="AI Executive Intelligence & Decision Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Executive Intelligence & Decision Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Executive Intelligence, Business Strategy & Decision Center"
      subtitle="회사 상태/성장/수익/위험/예측/추천을 하나의 View 로 — AI 는 추천과 근거만 제공(자동 의사결정·자동 실행 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 계약/정산/가격/요금제/플레이리스트 변경, 자동 영업 실행, 자동 의사결정, Production Apply/Merge/Deploy 는 없습니다. MRR 은 실측이며 ARR/순이익/LTV 는 추정(비용 데이터 없으면 cost_unknown)입니다. 모든 추천은 Recommendation/Reason/Evidence/Confidence/Alternative/Expected Benefit/Risk 를 포함하고 사람이 확정합니다. Scenario 는 evidence-only 시뮬레이션이며 실제 적용되지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="MRR (실측)" value={KRW(mrr)} />
          <Box label="ARR (추정)" value={arr.arr == null ? 'insufficient_data' : KRW(arr.arr)} />
          <Box label="매출 30d" value={KRW(summary.revenue_30d as number)} />
          <Box label="MoM 성장" value={summary.revenue_mom_pct == null ? 'insufficient_data' : `${summary.revenue_mom_pct}%`} />
          <Box label="순이익" value="cost_unknown" />
          <Box label="활성 기업" value={NUM(summary.active_businesses as number)} />
          <Box label="활성 매장 30d" value={NUM(summary.active_stores_30d as number)} />
          <Box label="활성 플레이어 30d" value={NUM(summary.active_players_30d as number)} />
          <Box label="스트리밍 시간 30d" value={`${NUM(summary.streaming_hours_30d as number)}h`} />
          <Box label="AI 추천 채택률" value={summary.ai_adoption_rate_pct == null ? 'insufficient_data' : `${summary.ai_adoption_rate_pct}%`} />
          <Box label="계약(서명/신규 30d)" value={`${NUM(summary.contracts_signed_total as number)}/${NUM(summary.contracts_new_30d as number)}`} />
          <Box label="해지율" value={churn == null ? 'insufficient_data' : `${churn}%`} />
          <Box label="정산 누적" value={KRW(summary.settlement_total_payout as number)} />
          <Box label="Business Risk" value={bizRisk.score == null ? bizRisk.level : `${bizRisk.score} (${bizRisk.level})`} />
        </div>
      )}

      {/* ── Revenue ── */}
      {tab === 'revenue' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="payment_orders(paid) 실측 월별 매출입니다." />
          {!growth?.monthly_paid_revenue.length ? <AdminEmpty icon={<Banknote size={20} />} title="매출 데이터 없음" /> : (
            growth.monthly_paid_revenue.map((m) => (
              <div key={m.month} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="font-semibold">{m.month.slice(0, 7)}</span>
                <span className="text-[10px] text-muted-foreground">{KRW(m.amount)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Growth ── */}
      {tab === 'growth' && growth && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="신규 기업(최근월)" value={NUM(growth.new_businesses.at(-1)?.count)} />
            <Box label="신규 아티스트" value={NUM(growth.new_artists.at(-1)?.count)} />
            <Box label="신규 음원" value={NUM(growth.new_tracks.at(-1)?.count)} />
            <Box label="신규 계약" value={NUM(growth.new_signed_contracts.at(-1)?.count)} />
          </div>
          <AdminAlert tone="info" title="업종별 활성 기업" description="브랜드/지역별 성장 축은 데이터 미비로 insufficient_data(업종만 실측)." />
          {growth.growth_by_industry.map((g) => (
            <div key={g.industry} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{g.industry}</span>
              <span className="text-[10px] text-muted-foreground">{NUM(g.count)}개 기업</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Financial ── */}
      {tab === 'financial' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="MRR (실측)" value={KRW(mrr)} />
            <Box label="ARR (추정)" value={arr.arr == null ? '—' : KRW(arr.arr)} />
            <Box label="Store LTV (추정)" value={ltv.ltv == null ? 'insufficient_data' : KRW(ltv.ltv)} />
            <Box label="Enterprise LTV" value="insufficient_data" />
            <Box label="CAC" value={cac.status} />
            <Box label="Payback Period" value={cac.status} />
            <Box label="계약 가치" value={KRW(summary.settlement_total_payout as number)} />
            <Box label="구독(활성/해지)" value={`${NUM(summary.subscriptions_active as number)}/${NUM(summary.subscriptions_canceled as number)}`} />
          </div>
          <AdminAlert tone="warning" description={`${arr.note} · ${ltv.note} · ${cac.note}`} />
        </div>
      )}

      {/* ── Forecast ── */}
      {tab === 'forecast' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" title="Forecast — 예측값(Actual 아님)" description="Deterministic Forecast(Capacity 엔진 재사용). 서버 비용/저장공간은 단가·limit 입력 전 cost_unknown/limit_unknown." />
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone="info">예측값 — Actual 아님</AdminBadge>
            <span className="font-semibold">트래픽(Playback Events) +30d</span>
            {trafficForecast.modelType === 'insufficient_data' ? <AdminBadge tone="neutral">insufficient_data</AdminBadge> : (
              <span className="text-[10px] text-muted-foreground">point {NUM(trafficForecast.pointForecast)} [{NUM(trafficForecast.lowerBound)}~{NUM(trafficForecast.upperBound)}] · confidence {trafficForecast.confidence} · {trafficForecast.modelType}</span>
            )}
          </div>
          {(['다음달 매출', '다음 분기 성장', '예상 정산'] as const).map((label) => (
            <div key={label} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{label}</span>
              <AdminBadge tone="neutral">insufficient_data</AdminBadge>
              <span className="text-[10px] text-muted-foreground">월 단위 실측 표본 부족(월별 데이터 6개 미만) — 임의 예측 생성 안 함</span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
            <span className="font-semibold">서버 비용 / 저장공간</span>
            <AdminBadge tone="neutral">cost_unknown / limit_unknown</AdminBadge>
            <span className="text-[10px] text-muted-foreground">Capacity Center(0508)에서 단가·limit 입력 후 산출 가능</span>
          </div>
        </div>
      )}

      {/* ── Decision Center ── */}
      {tab === 'decisions' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Decision Center (자동 의사결정 없음)" description="AI 제안은 Explainable 8요소를 포함하며 사람이 사유와 함께 승인 Reference/기각/보류합니다. 승인은 참고 기록일 뿐 자동 실행이 아닙니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 사유(필수 — Human Approval)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="decision 사유" />
          <div className="flex flex-wrap gap-1.5">
            {autoRecommendations.map((r) => (
              <button key={r.decision_code} disabled={busy} onClick={() => {
                const errors = validateExplainableDecision(r);
                if (errors.length) { toast.error(errors.join(', ')); return; }
                void act(() => saveExecDecision({ ...r, idempotency_key: r.decision_code }), 'Decision 제안 등록(추천만)');
              }} className="rounded-md border border-border px-2 py-1 text-[10px] font-bold hover:bg-muted disabled:opacity-50">+ {r.category} 제안 등록</button>
            ))}
            {!autoRecommendations.length && <span className="text-[10px] text-muted-foreground">표본 부족 — 추천 생성 안 함(insufficient_data)</span>}
          </div>
          {decisions.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.recommendation.slice(0, 40)}</span>
                <AdminBadge tone="neutral">{d.category}</AdminBadge>
                <AdminBadge tone={DECISION_TONE[d.decision_status] ?? 'neutral'}>{d.decision_status}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">confidence {d.confidence ?? '—'}</span>
                {['proposed', 'under_review', 'deferred'].includes(d.decision_status) && (
                  <div className="ml-auto flex gap-1">
                    {([['approved_reference', '승인 Ref'], ['rejected', '기각'], ['deferred', '보류'], ['under_review', '검토']] as const).map(([st, label]) => (
                      <button key={st} disabled={busy} onClick={() => { const r = needReason(); if (!r) return; void act(() => decideExecDecision(d.id, st, r), `결정: ${label}`); setReason(''); }} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{label}</button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">이유: {d.reason.slice(0, 60)} · 기대효과: {d.expected_benefit.slice(0, 40)} · 위험: {d.risk.slice(0, 40)} · 대안: {d.alternatives.join(', ').slice(0, 50)}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Risks ── */}
      {tab === 'risks' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black">{bizRisk.score ?? '—'}</span>
            <AdminBadge tone={RISK_TONE[bizRisk.level]}>{bizRisk.level}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">성분 재정규화 · 제외 {bizRisk.missing.length} · 자동 조치 없음</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="계약 만료 90d" value={NUM(summary.contracts_expiring_90d as number)} />
            <Box label="해지율" value={churn == null ? 'insufficient_data' : `${churn}%`} />
            <Box label="매출 MoM" value={summary.revenue_mom_pct == null ? '—' : `${summary.revenue_mom_pct}%`} />
            <Box label="Active Incidents" value={String(incidents.filter((i) => !i.resolved_at).length)} />
          </div>
          <AdminAlert tone="info" description="Security Risk 는 AI-OPS-7(단일 관리자/rbac_limited/logging gap), Operational Risk 는 Incident 실측 기준으로 반영됩니다." />
        </div>
      )}

      {/* ── Strategy / AI Insights ── */}
      {tab === 'strategy' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Strategy" description="업종/계약/위험 실측 기반 전략 후보입니다 — 실행은 사람이 별도 절차로 결정합니다." />
          {autoRecommendations.map((r) => (
            <div key={r.decision_code} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex items-center gap-2"><AdminBadge tone="info">{r.category}</AdminBadge><span className="font-semibold">{r.recommendation}</span></div>
              <p className="mt-1 text-[10px] text-muted-foreground">{r.reason} · 대안: {r.alternatives.join(' / ')}</p>
            </div>
          ))}
          {!autoRecommendations.length && <AdminEmpty icon={<Target size={20} />} title="전략 후보 없음(표본 부족)" />}
        </div>
      )}
      {tab === 'insights' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="실측 지표에서 도출된 관찰입니다 — 단정이 아닌 참고 근거입니다." />
          {[
            { k: 'AI 추천 채택률', v: summary.ai_adoption_rate_pct == null ? '결정된 운영 건 없음(insufficient_data)' : `${summary.ai_adoption_rate_pct}% (ai_operations 결정 건 기준)` },
            { k: '스트리밍 활동', v: `30일 ${NUM(summary.streaming_hours_30d as number)}시간 · 활성 매장 ${NUM(summary.active_stores_30d as number)}곳` },
            { k: '계약 파이프라인', v: `서명 ${NUM(summary.contracts_signed_total as number)} · 대기 ${NUM(summary.contracts_pending as number)} · 90일 내 만료 ${NUM(summary.contracts_expiring_90d as number)}` },
          ].map((x) => (
            <div key={x.k} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{x.k}</span>
              <span className="text-[10px] text-muted-foreground">{x.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Reports / Briefing ── */}
      {tab === 'reports' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="저장된 Briefing 이 Executive Report 이력입니다(참고 자료 — 실제 조치 아님)." />
          {!briefings.length ? <AdminEmpty icon={<FileText size={20} />} title="Report 없음" description="Daily Briefing 탭에서 생성하세요." /> : briefings.map((b) => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{b.briefing_date}</span>
              <span className="text-[10px] text-muted-foreground">MRR {KRW((b.snapshot as Record<string, number>).mrr_actual)} · 매출30d {KRW((b.snapshot as Record<string, number>).revenue_30d)}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'briefing' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Executive Daily Briefing (수동 생성)" description="자동 스케줄(매일 자동 생성)은 미지원입니다 — 관리자가 생성 버튼으로 실측 snapshot 을 저장합니다. 참고 자료이며 실제 조치가 아닙니다." />
          <button disabled={busy} onClick={() => void act(() => saveExecBriefing({
            highlights: briefingPreview.filter((p) => p.section !== 'Limitations'),
            recommendations_ref: autoRecommendations.map((r) => r.recommendation),
          }), 'Briefing 생성(오늘 날짜, 실측 snapshot)')} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">+ 오늘 Briefing 생성</button>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {briefingPreview.map((p) => (
              <div key={p.section} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{p.section}</p>
                <p className="mt-0.5 break-all text-[11px]">{typeof p.content === 'string' || typeof p.content === 'number' ? String(p.content) : JSON.stringify(p.content).slice(0, 150)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="AI Recommendations (Explainable)" description="모든 추천은 Recommendation/Reason/Evidence/Confidence/Alternative/Expected Benefit/Risk + Human Approval 을 포함합니다." />
          {autoRecommendations.map((r) => (
            <div key={r.decision_code} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone="info">{r.category}</AdminBadge>
                <span className="font-semibold">{r.recommendation}</span>
                <AdminBadge tone="neutral">confidence {r.confidence}</AdminBadge>
                <AdminBadge tone="warning">Human Approval 필요</AdminBadge>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Reason: {r.reason} · Benefit: {r.expected_benefit} · Risk: {r.risk} · Alt: {r.alternatives.join(' / ')}</p>
            </div>
          ))}
          {!autoRecommendations.length && <AdminEmpty icon={<Lightbulb size={20} />} title="추천 없음" description="표본 5건 미만이면 추천을 생성하지 않습니다(insufficient_data)." />}
        </div>
      )}

      {/* ── Simulation ── */}
      {tab === 'simulation' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Scenario Simulation (evidence-only)" description="실제 적용하지 않습니다 — Digital Twin 방식 시뮬레이션 결과이며 simulated 값은 actual 로 저장되지 않습니다. capacity limit/단가 미입력 시나리오는 판정 불가로 정직 표시합니다." />
          {SCENARIOS.map(({ label, r }) => (
            <div key={label} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="font-semibold">{label}</span>
              <AdminBadge tone={SCENARIO_TONE[r.result]}>{r.result}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">projected {NUM(r.projected)} · {r.note}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : audit.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <span className="text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</span>
              <AdminBadge tone={a.event_type.includes('rejected') ? 'danger' : a.event_type.includes('approved') ? 'success' : 'neutral'}>{a.event_type}</AdminBadge>
              <span className="text-[10px] text-muted-foreground">{(a.detail ?? '').slice(0, 70)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>{EXEC_SUPPORT.map((s) => (
              <tr key={s.key} className="border-b border-border/50">
                <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : ['estimated', 'partially_supported', 'evidence_only'].includes(s.status) ? 'warning' : 'neutral'}>{s.status}</AdminBadge></td>
                <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
              </tr>
            ))}</tbody>
          </table>
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
