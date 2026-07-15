/**
 * FinancialIntelligenceSection — Enterprise Financial Intelligence, Capital Performance &
 * Financial Decision Center (Phase AI-OPS-23).
 *
 * Business Performance→Financial Performance→Capital Intelligence→Financial Risk→Executive Financial Advisory.
 * 회계 자동 수정/예산 자동 변경/지출·투자 자동 승인 없음 · Revenue ≠ Profit ·
 * Cash Flow ≠ Liquidity Guarantee · ROI ≠ Investment Success · Risk ≠ Failure.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote, BarChart3, Coins, Gauge, Grid3x3, History, Layers, Lightbulb,
  ListChecks, Lock, PiggyBank, RefreshCw, Scale, ScrollText, ShieldAlert, TrendingUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchFinancialSummary, createFinancialRecord, reviewFinancialRecord, fetchFinancialRecords,
  recordFinancialSnapshot, captureFinancialSnapshot, fetchFinancialSnapshots,
  fetchFinancialTimeline, recordFinancialGovernance, fetchFinancialAudit,
  type FinancialSummary, type FinancialRecordRow, type FinancialSnapshotRow,
  type FinancialTimelinePoint, type FinancialEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  computeMargins, analyzeCashFlow, analyzeCapitalPerformance, analyzeCostDistribution,
  classifyFinancialVariance, assessRoi, assessFinancialRisk, classifyTrend,
  buildFinancialBriefing, buildFinancialRecommendation, buildFinancialCockpit,
  FINANCIAL_SUPPORT,
} from '@/lib/financialIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const REC_TERMINAL = ['superseded_reference', 'invalidated'];

type Tab = 'cockpit' | 'dashboard' | 'cashflow' | 'capital' | 'cost' | 'variance' | 'roi' | 'risk'
  | 'trend' | 'briefing' | 'records' | 'snapshots' | 'recommendations' | 'humanreviews'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Financial Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Financial Dashboard', icon: Gauge },
  { key: 'cashflow', label: 'Cash Flow Intelligence', icon: Banknote },
  { key: 'capital', label: 'Capital Performance', icon: PiggyBank },
  { key: 'cost', label: 'Cost Intelligence', icon: Coins },
  { key: 'variance', label: 'Financial Variance', icon: Scale },
  { key: 'roi', label: 'ROI Intelligence', icon: TrendingUp },
  { key: 'risk', label: 'Financial Risk', icon: ShieldAlert },
  { key: 'trend', label: 'Financial Trends', icon: BarChart3 },
  { key: 'briefing', label: 'Executive Financial Briefing', icon: ScrollText },
  { key: 'records', label: 'Financial Records', icon: ListChecks },
  { key: 'snapshots', label: 'Financial Snapshots', icon: History },
  { key: 'recommendations', label: 'Financial Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const CAPTURE_SOURCES = ['mrr', 'cash_inflow', 'cash_outflow_settlements', 'company_fee', 'provider_costs_actual', 'net_cash_flow_partial'] as const;

export default function FinancialIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<FinancialSummary>({});
  const [records, setRecords] = useState<FinancialRecordRow[]>([]);
  const [snapshots, setSnapshots] = useState<FinancialSnapshotRow[]>([]);
  const [timeline, setTimeline] = useState<FinancialTimelinePoint[]>([]);
  const [audit, setAudit] = useState<FinancialEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, re, sn, tl, au] = await Promise.all([
        fetchFinancialSummary(), fetchFinancialRecords(null, 100), fetchFinancialSnapshots(null, 100),
        fetchFinancialTimeline(30), fetchFinancialAudit(100),
      ]);
      setSummary(s); setRecords(re); setSnapshots(sn); setTimeline(tl); setAudit(au);
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
  const needNumber = (): number | null => {
    const n = Number(reason.trim());
    if (!reason.trim() || !Number.isFinite(n)) { toast.error('숫자 입력 필요(null→0 변환 금지)'); return null; }
    return n;
  };

  const actuals = useMemo(() => (typeof summary.financial_actuals === 'object' && summary.financial_actuals !== null && !Array.isArray(summary.financial_actuals) ? summary.financial_actuals as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);

  const cashflow = useMemo(() => analyzeCashFlow({
    inflow: num('cash_inflow_30d'), outflowPartial: num('cash_outflow_settlements_30d'),
    investmentFlow: null, financingFlow: null,   // 투자/재무 현금흐름 원본 없음(실측)
  }), [num]);

  const margins = useMemo(() => computeMargins({
    revenue: num('cash_inflow_30d'), knownCosts: num('cash_outflow_settlements_30d'), costBasisComplete: false,
  }), [num]);

  const capital = useMemo(() => {
    const alloc = records.filter((r) => r.record_kind === 'capital_allocation_reference' && !REC_TERMINAL.includes(r.record_status) && r.amount != null);
    const invest = records.filter((r) => r.record_kind === 'investment_reference' && !REC_TERMINAL.includes(r.record_status) && r.amount != null);
    return analyzeCapitalPerformance({
      allocated: alloc.length ? alloc.reduce((a, r) => a + (r.amount ?? 0), 0) : null,
      utilized: invest.length ? invest.reduce((a, r) => a + (r.amount ?? 0), 0) : null,
      evidence: alloc.length || invest.length ? ['financial_records 실측'] : [],
    });
  }, [records]);

  const costDist = useMemo(() => {
    const byProvider = (typeof summary.cost_by_provider_90d === 'object' && summary.cost_by_provider_90d !== null && !Array.isArray(summary.cost_by_provider_90d) ? summary.cost_by_provider_90d as Record<string, { actual?: number | null; estimated?: number | null }> : {});
    const rows: { category: string; amount: number | null; kind: 'actual' | 'estimated' }[] = [];
    for (const [provider, v] of Object.entries(byProvider)) {
      if (v && typeof v === 'object') {
        rows.push({ category: `${provider}(actual)`, amount: typeof v.actual === 'number' ? v.actual : null, kind: 'actual' });
        rows.push({ category: `${provider}(estimated)`, amount: typeof v.estimated === 'number' ? v.estimated : null, kind: 'estimated' });
      }
    }
    for (const r of records.filter((x) => ['cost_entry', 'licensing_cost_entry'].includes(x.record_kind) && !REC_TERMINAL.includes(x.record_status))) {
      rows.push({ category: `${r.record_kind}:${r.title}`, amount: r.amount, kind: 'actual' });
    }
    return analyzeCostDistribution(rows);
  }, [summary, records]);

  const variances = useMemo(() => {
    const rows = snapshots.filter((s) => s.budget_value != null).slice(0, 10).map((s) => ({
      label: `${s.metric_source}(${s.period_kind})`,
      v: classifyFinancialVariance({ actual: s.actual_value, budget: s.budget_value, costMetric: s.metric_source.startsWith('provider_costs') || s.metric_source === 'cash_outflow_settlements' }),
    }));
    const budgetRecs = records.filter((r) => r.record_kind === 'budget_reference' && !REC_TERMINAL.includes(r.record_status) && r.amount != null).slice(0, 5);
    for (const b of budgetRecs) rows.push({ label: `budget:${b.title} vs inflow(30d)`, v: classifyFinancialVariance({ actual: num('cash_inflow_30d'), budget: b.amount }) });
    return rows;
  }, [snapshots, records, num]);

  const trends = useMemo(() => ([
    { metric: 'cash_inflow', t: classifyTrend(timeline.map((p) => ({ value: p.cash_inflow }))) },
    { metric: 'paid_orders', t: classifyTrend(timeline.map((p) => ({ value: p.paid_orders }))) },
    { metric: 'failed_orders', t: classifyTrend(timeline.map((p) => ({ value: p.failed_orders }))) },
    { metric: 'cash_outflow_settlements', t: classifyTrend(timeline.map((p) => ({ value: p.cash_outflow_settlements }))) },
  ]), [timeline]);

  const roiRows = useMemo(() => records.filter((r) => r.record_kind === 'investment_reference' && !REC_TERMINAL.includes(r.record_status)).slice(0, 10).map((r) => assessRoi({
    target: r.title, investment: r.amount, returnValue: null,   // 투자별 수익 귀속 원본 없음 → insufficient_data 유지
    evidence: (r.evidence ?? []).length ? ['financial_record'] : [], sample: snapshots.length,
  })), [records, snapshots]);

  const risks = useMemo(() => {
    const inflow = num('cash_inflow_30d'); const outflow = num('cash_outflow_settlements_30d');
    const paid = timeline.reduce((a, p) => a + p.paid_orders, 0); const failed = timeline.reduce((a, p) => a + p.failed_orders, 0);
    return [
      assessFinancialRisk({ kind: 'cash_flow_risk', signal: inflow != null && outflow != null && inflow > 0 ? Math.round((outflow / inflow) * 100) : null, highThreshold: 80, mediumThreshold: 50, evidence: timeline.length ? ['timeline 실측'] : [] }),
      assessFinancialRisk({ kind: 'burn_rate_risk', signal: null, highThreshold: 3, mediumThreshold: 6, lowerIsRiskier: true, evidence: ['cash_position 원본 없음 — unknown 유지'] }),
      assessFinancialRisk({ kind: 'liquidity_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['회계 원장 없음 — unknown 유지'] }),
      assessFinancialRisk({ kind: 'cost_growth_risk', signal: null, highThreshold: 30, mediumThreshold: 15, evidence: ['비용 시계열 원본 없음 — unknown 유지'] }),
      assessFinancialRisk({ kind: 'revenue_stability_risk', signal: paid + failed > 0 ? Math.round((failed / (paid + failed)) * 100) : null, highThreshold: 30, mediumThreshold: 10, evidence: timeline.length ? ['payment_orders 실패율 실측'] : [] }),
    ];
  }, [num, timeline]);

  const briefing = useMemo(() => buildFinancialBriefing({
    periodKind: 'weekly',
    revenueChanges: trends.filter(({ metric, t }) => metric === 'cash_inflow' && t.dataStatus === 'ok').map(({ t }) => `cash_inflow ${t.trend}(${t.changePct ?? '—'}%)`),
    costChanges: trends.filter(({ metric, t }) => metric === 'cash_outflow_settlements' && t.dataStatus === 'ok').map(({ t }) => `정산 outflow ${t.trend}(${t.changePct ?? '—'}%)`),
    risks: risks.filter((r) => r.level === 'high' || r.level === 'medium').map((r) => `${r.kind}: ${r.level}(Risk ≠ Failure)`),
    opportunities: variances.filter(({ v }) => v.verdict === 'positive').map(({ label }) => `${label} variance positive`),
    unknownFactors: risks.filter((r) => r.level === 'unknown').map((r) => `${r.kind}: 원본 없음`),
  }), [trends, risks, variances]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildFinancialRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (costDist.verdict === 'insufficient_data') push(buildFinancialRecommendation({ type: 'review_cost', reason: '비용 자료 없음 — 비용 구조 파악 전 해석 금지', evidence: ['cost_rows:0'], confidence: null, assumptions: [] }));
    const failedTrend = trends.find(({ metric }) => metric === 'failed_orders');
    if (failedTrend && failedTrend.t.trend === 'improving') push(buildFinancialRecommendation({ type: 'validate_revenue', reason: '결제 실패 증가 추세 — Revenue 안정성 검토(확정 아님)', evidence: ['failed_orders trend'], confidence: null, assumptions: [] }));
    if (cashflow.verdict === 'partial_measured' && (cashflow.netPartial ?? 0) < 0) push(buildFinancialRecommendation({ type: 'review_cash_flow', reason: '부분 Net Cash Flow 음수 — 회계 원장 없이 단정 금지', evidence: ['net_partial<0'], confidence: null, assumptions: [] }));
    const neg = variances.filter(({ v }) => v.verdict === 'negative').length;
    if (neg > 0) push(buildFinancialRecommendation({ type: 'investigate_variance', reason: `Variance negative ${neg}건(Variance ≠ Failure)`, evidence: [`negative:${neg}`], confidence: null, assumptions: [] }));
    if (roiRows.some((r) => r.verdict !== 'roi_candidate')) push(buildFinancialRecommendation({ type: 'review_roi', reason: 'ROI 산정 불가 투자 존재 — 수익 귀속 근거 필요', evidence: ['roi_unresolved'], confidence: null, assumptions: [] }));
    if (risks.some((r) => r.level === 'unknown')) push(buildFinancialRecommendation({ type: 'gather_financial_evidence', reason: 'unknown 리스크 존재 — 원본(원장/Cash Position) 확보 필요', evidence: ['risk_unknown'], confidence: null, assumptions: [] }));
    return out;
  }, [costDist, trends, cashflow, variances, roiRows, risks]);

  const cockpit = useMemo(() => buildFinancialCockpit({
    revenue30d: num('cash_inflow_30d'), netPartial: cashflow.netPartial, marginPct: margins.marginPct,
    costCategories: costDist.shares.length, roiAssessed: roiRows.length,
    trendsAnalyzed: trends.filter(({ t }) => t.dataStatus === 'ok').length,
    risksHigh: risks.filter((r) => r.level === 'high').length,
    recommendationsOpen: autoRecs.length, summaryNote: null,
  }), [num, cashflow, margins, costDist, roiRows, trends, risks, autoRecs]);

  if (loading) return <AdminCard title="Enterprise Financial Intelligence & Financial Decision Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Financial Intelligence & Financial Decision Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Financial Intelligence & Financial Decision Center"
      subtitle="Business Performance→Financial Performance→Capital→Financial Risk→Executive Financial Advisory — 회계 수정/예산 변경/지출·투자 승인 자동화 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 회계 수정, 자동 예산 변경, 자동 지출/투자 승인, 자동 계약/KPI/Strategy/Production 변경, 자동 Merge/Deploy 는 없습니다. AI는 재무 분석·비용 구조 설명·투자 효율 평가·리스크 제시만 하며 투자 결정을 대신하지 않습니다. Revenue ≠ Profit, Cash Flow ≠ Liquidity Guarantee, Forecast ≠ Actual, ROI ≠ Investment Success, Margin ≠ Business Health, Risk ≠ Failure, Recommendation ≠ Financial Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · revenueIsNotProfit</p>
        </div>
      )}

      {/* ── Dashboard(실측 8영역) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Revenue — paid orders(30d)" value={NUM(num('revenue_paid_orders_30d'))} />
            <Box label="MRR 실측" value={NUM(num('mrr'))} />
            <Box label="Margin(부분 Proxy)" value={margins.marginPct == null ? 'insufficient_data' : `${margins.marginPct}%`} />
            <Box label="Net Cash Flow(부분·30d)" value={NUM(cashflow.netPartial)} />
            <Box label="정산 Outflow(30d)" value={NUM(num('cash_outflow_settlements_30d'))} />
            <Box label="Company Fee(90d)" value={NUM(num('company_fee_90d'))} />
            <Box label="Provider Cost actual(90d)" value={num('provider_costs_actual_90d') == null ? 'null(표본 0 — 0 아님)' : NUM(num('provider_costs_actual_90d'))} />
            <Box label="High Risk 건수" value={NUM(risks.filter((r) => r.level === 'high').length)} />
          </div>
          <AdminAlert tone="info" description={`financial_unavailable: ${Array.isArray(summary.financial_unavailable) ? (summary.financial_unavailable as unknown[]).map(String).join(', ') : '—'} — 회계 원장/EBITDA/Cash Position 원본 없음(임의 생성 금지). Margin 은 정산 지급만 반영한 부분 Proxy 이며 Margin ≠ Business Health.`} />
        </div>
      )}

      {/* ── Cash Flow ── */}
      {tab === 'cashflow' && (
        <div className="space-y-2">
          {cashflow.segments.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.key}</span>
              <AdminBadge tone={s.status === 'measured_partial' ? 'info' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.value == null ? 'null(원본 없음 — 0 아님)' : NUM(s.value)}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">notAccountingLedger=true · Cash Flow ≠ Liquidity Guarantee · 현금 흐름 자동 수정 없음</p>
        </div>
      )}

      {/* ── Capital ── */}
      {tab === 'capital' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Utilization(배분 대비 투자)" value={capital.utilizationPct == null ? capital.verdict : `${capital.utilizationPct}%`} />
            <Box label="Capital Allocation 기록" value={NUM(records.filter((r) => r.record_kind === 'capital_allocation_reference').length)} />
            <Box label="Investment 기록" value={NUM(records.filter((r) => r.record_kind === 'investment_reference').length)} />
          </div>
          <AdminAlert tone="info" description="Capital Allocation/Investment 는 사람이 기록한 참조만 사용합니다(회계 장부 아님). notInvestmentDecision=true — AI 가 투자 결정을 대신하지 않습니다. Capital Growth 는 자본 시계열 원본이 없어 financial_unavailable 입니다." />
        </div>
      )}

      {/* ── Cost ── */}
      {tab === 'cost' && (
        costDist.verdict === 'insufficient_data' ? <AdminEmpty title="비용 자료 없음" description="ai_cost_snapshots(0508) 또는 cost_entry 기록이 생기면 분포를 분석합니다 — 임의 생성하지 않습니다." /> : (
          <div className="space-y-1">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Box label="합계(알려진 비용만)" value={NUM(costDist.totalKnown)} />
              <Box label="null 제외(0 변환 금지)" value={NUM(costDist.excludedNull)} />
              <Box label="추정치 포함 여부" value={costDist.estimatedIncluded ? 'estimated 포함(Actual 아님)' : 'actual만'} />
            </div>
            {costDist.shares.map((s) => (
              <div key={s.category} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{s.category}</span>
                <AdminBadge tone={s.kind === 'actual' ? 'success' : 'warning'}>{s.kind}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{NUM(s.amount)} · {s.sharePct}%</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Variance / ROI / Risk / Trend ── */}
      {tab === 'variance' && (
        !variances.length ? <AdminEmpty title="Variance 대상 없음" description="Budget 기록 또는 budget_value 있는 Snapshot 이 있어야 비교합니다." /> : (
          <div className="space-y-1">
            {variances.map(({ label, v }, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{label}</span>
                <AdminBadge tone={v.verdict === 'positive' ? 'success' : v.verdict === 'negative' ? 'danger' : v.verdict === 'variance_unknown' ? 'warning' : 'neutral'}>{v.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">variance {v.variance ?? 'null'} · {v.variancePct == null ? '—' : `${v.variancePct}%`} · Variance ≠ Failure</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'roi' && (
        !roiRows.length ? <AdminEmpty title="ROI 대상 없음" description="investment_reference 기록이 생기면 Evidence 기반으로만 ROI 를 평가합니다. Feature/Project/Campaign/Infrastructure ROI 는 수익 귀속 원본이 없으면 insufficient_data 로 유지됩니다." /> : (
          <div className="space-y-1">
            {roiRows.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{r.target}</span>
                <AdminBadge tone={r.verdict === 'roi_candidate' ? 'info' : 'warning'}>{r.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">ROI {r.roiPct == null ? 'null(수익 귀속 원본 없음)' : `${r.roiPct}%`} · ROI ≠ Investment Success</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'risk' && (
        <div className="space-y-1">
          {risks.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.kind}</span>
              <AdminBadge tone={r.level === 'high' ? 'danger' : r.level === 'medium' ? 'warning' : r.level === 'low' ? 'success' : 'neutral'}>{r.level}</AdminBadge>
              {r.verdict === 'financial_unverified' && <AdminBadge tone="warning">financial_unverified</AdminBadge>}
              <span className="ml-2 text-muted-foreground">Risk ≠ Failure{r.level === 'unknown' ? ' · 원본 없음 — unknown 유지' : ''}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'trend' && (
        <div className="space-y-1">
          {trends.map(({ metric, t }) => (
            <div key={metric} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{metric}</span>
              {t.dataStatus === 'ok' ? (
                <AdminBadge tone={t.trend === 'improving' ? 'success' : t.trend === 'declining' ? 'danger' : t.trend === 'volatile' ? 'warning' : 'neutral'}>{t.trend}</AdminBadge>
              ) : <AdminBadge tone="warning">{t.dataStatus}</AdminBadge>}
              <span className="ml-2 text-muted-foreground">{t.changePct == null ? '변화율 계산 불가' : `${t.changePct}%`} · 30d 실측 · Trend ≠ Guarantee</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordFinancialGovernance('financial_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Financial Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음)</p>
        </div>
      )}

      {/* ── Records / Snapshots ── */}
      {tab === 'records' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(['budget_reference', 'investment_reference', 'capital_allocation_reference', 'cost_entry'] as const).map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const n = needNumber(); if (n == null) return;
                void act(() => createFinancialRecord({ code: `fin_${kind}_${now.toISOString().slice(0, 19)}`, kind, title: `${kind} 사람 기록`, amount: n, evidence: [{ label: 'note', value: '사람 입력 기록(회계 장부 아님)' }] }), `${kind} 기록(자동 승인 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 기록(숫자)</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="금액 숫자 또는 사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!records.length ? <AdminEmpty title="Financial Record 없음" description="예산/투자/자본 배분/비용 항목은 사람 기록만 저장됩니다 — 회계 장부가 아닙니다." /> : records.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.record_code}</span>
                <AdminBadge tone="info">{r.record_kind}</AdminBadge>
                <AdminBadge tone={r.record_status === 'active_reference' ? 'success' : REC_TERMINAL.includes(r.record_status) ? 'neutral' : 'warning'}>{r.record_status}</AdminBadge>
                <span className="text-muted-foreground">{r.title} · {r.amount == null ? 'null(0 아님)' : NUM(r.amount)} {r.currency} · {r.period_kind}</span>
              </div>
              {!REC_TERMINAL.includes(r.record_status) && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['active_reference', 'under_review', 'superseded_reference'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewFinancialRecord(r.id, st, rr), `${st}(승인 아님 — 검토 기록)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'snapshots' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {CAPTURE_SOURCES.map((src) => (
              <button key={src} disabled={busy} onClick={() => {
                void act(() => captureFinancialSnapshot(`fcap_${src}_${now.toISOString().slice(0, 19)}`, src, 'monthly'), `${src} 실측(Revenue ≠ Profit)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{src} 실측</button>
            ))}
            <button disabled={busy} onClick={() => {
              const n = needNumber(); if (n == null) return;
              void act(() => recordFinancialSnapshot({ key: `fbud_${now.toISOString().slice(0, 19)}`, source: 'cash_inflow', periodKind: 'monthly', sourceKind: 'human_entered', evidence: [{ label: 'note', value: '사람 입력 Budget(자동 변경 아님)' }], budget: n }), 'Budget 기록(사람 입력)');
            }} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">Inflow Budget 기록(숫자)</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Budget 숫자(사람 입력)" className="min-w-[160px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!snapshots.length ? <AdminEmpty title="Snapshot 없음" description="실측 캡처 또는 사람 입력으로만 기록됩니다(append-only)." /> : snapshots.slice(0, 40).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{s.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone={s.source_kind === 'measured' ? 'success' : s.source_kind === 'forecast_reference' ? 'warning' : 'info'}>{s.source_kind}</AdminBadge>
              <AdminBadge tone="neutral">{s.metric_source}</AdminBadge>
              <span className="ml-2">actual {s.actual_value == null ? 'null(0 아님)' : NUM(s.actual_value)} · budget {s.budget_value == null ? '—' : NUM(s.budget_value)} · forecast {s.forecast_value == null ? '—' : NUM(s.forecast_value)} · 표본 {s.sample_size ?? '—'}</span>
            </div>
          ))}
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
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Financial Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['financial_record_reviewed', 'financial_record_created', 'financial_record_invalidated'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="재무 기록/검토는 전부 사람이 수행합니다(자동 승인 없음)." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_financial_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 재무 자료는 참조로만 기록됩니다 — 실데이터 없이 외부 비교하지 않습니다." /> : (
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
              void act(() => recordFinancialGovernance('financial_risk_assessed', r, { risks: risks.map((x) => ({ kind: x.kind, level: x.level })) }), 'Risk 평가 기록(Risk ≠ Failure)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Risk 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="재무 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
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
          {FINANCIAL_SUPPORT.map((s) => (
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
