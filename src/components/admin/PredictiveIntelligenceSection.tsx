/**
 * PredictiveIntelligenceSection — Predictive Music Intelligence & AI Simulation (Phase AI-MUSIC-4).
 *
 * 과거·현재 분석을 넘어 **미래 KPI 예측 + 변경 전 시뮬레이션**을 제공한다. 예측/시뮬레이션 전용 —
 * 자동 Playlist/Scheduler/Queue/Playback/Recommendation/Weight 변경 없음.
 *
 * 탭: Forecast · Simulation · Risk · Opportunities · Counterfactual · Prediction History.
 * 모든 예측은 Evidence 포함(Explainable) · Sample 부족이면 생성 금지 · 예측은 추정(Confidence 동반).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, FlaskConical, AlertTriangle, Target, GitCompare, History, RefreshCw, Save, Inbox,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchContextTrend, fetchContextDrift,
  fetchPredictionScan, savePredictionSnapshot, fetchPredictionHistory,
  type ContextOverview, type ContextDetailResp, type ContextTrendResp, type ContextDriftResp,
  type PredictionScanResp, type PredictionSnapshot,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildContextKey, recommendContext, RECO_LABEL,
  type ContextDetail, type GenreMoodRow,
} from '@/lib/contextIntel';
import { computeStability, computeDrift } from '@/lib/contextLearning';
import {
  forecastContext, forecastKpi, classifyForecast, simulateItemChange, simulateMix, predictRecoImpact,
  counterfactual, predictRisk, detectOpportunities, scanSlopes, predictionAllowed,
  FORECAST_STATUS_LABEL, FORECAST_STATUS_TONE, riskTone, deltaTone,
  type ItemKpi, type SimAction, type MixTarget, type ForecastMetric,
} from '@/lib/predictiveIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const SIGN = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const RANGES = ['7d', '30d', '90d', '12m'] as const;
const DAYPARTS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;

type Tab = 'forecast' | 'simulation' | 'risk' | 'opportunities' | 'counterfactual' | 'history';
const TABS: { key: Tab; label: string; icon: typeof TrendingUp }[] = [
  { key: 'forecast', label: 'Forecast', icon: TrendingUp },
  { key: 'simulation', label: 'Simulation', icon: FlaskConical },
  { key: 'risk', label: 'Risk', icon: AlertTriangle },
  { key: 'opportunities', label: 'Opportunities', icon: Target },
  { key: 'counterfactual', label: 'Counterfactual', icon: GitCompare },
  { key: 'history', label: 'Prediction History', icon: History },
];
const FORECAST_METRICS: { key: ForecastMetric; label: string }[] = [
  { key: 'completion_rate', label: '완주율' }, { key: 'skip_rate', label: 'Skip' }, { key: 'avg_listen_seconds', label: '평균청취' },
];

export default function PredictiveIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('forecast');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [scan, setScan] = useState<PredictionScanResp | null>(null);
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [weekdayGroup, setWeekdayGroup] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [trend, setTrend] = useState<ContextTrendResp | null>(null);
  const [drift, setDrift] = useState<ContextDriftResp | null>(null);
  const [history, setHistory] = useState<PredictionSnapshot[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Simulation controls
  const [simKind, setSimKind] = useState<'playlist' | 'track' | 'genre' | 'mood'>('playlist');
  const [simItemKey, setSimItemKey] = useState<string>('');
  const [simAction, setSimAction] = useState<SimAction>('add');

  const contextKey = useMemo(() => buildContextKey({ store_type: storeType, daypart, weekday_group: weekdayGroup }), [storeType, daypart, weekdayGroup]);

  const loadTop = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [o, s] = await Promise.all([fetchContextOverview(range), fetchPredictionScan(range, 20)]);
      setOverview(o); setScan(s);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range, storeType]);
  useEffect(() => { void loadTop(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContext = useCallback(async () => {
    if (!storeType) return;
    setBusy(true);
    try {
      const [de, tr, dr, hi] = await Promise.all([
        fetchContextDetail(storeType, daypart, weekdayGroup, range, 20).catch(() => null),
        fetchContextTrend(storeType, daypart, weekdayGroup, range === '7d' ? '30d' : range).catch(() => null),
        fetchContextDrift(storeType, daypart, weekdayGroup, range).catch(() => null),
        fetchPredictionHistory(contextKey || storeType, null, 100).catch(() => [] as PredictionSnapshot[]),
      ]);
      setDetail(de); setTrend(tr); setDrift(dr); setHistory(hi);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, [storeType, daypart, weekdayGroup, range, contextKey]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const d = useMemo(() => (detail ? (detail as ContextDetail) : null), [detail]);
  const stability = useMemo(() => computeStability((trend?.series ?? []).map((p) => p.completion_rate)), [trend]);
  const driftResult = useMemo(() => (drift?.recent && drift?.prior ? computeDrift(drift.prior, drift.recent) : null), [drift]);
  const confInput = useMemo(() => ({ sample: d?.summary.events ?? 0, stabilityFactor: stability.factor, driftScore: driftResult?.score ?? null, freshnessDays: d?.summary.days_since_last ?? null }), [d, stability, driftResult]);
  const forecast = useMemo(() => (d && trend ? forecastContext(trend.series, d.summary, confInput) : []), [d, trend, confInput]);
  const scanRow = useMemo(() => scan?.items.find((r) => r.store_type === storeType) ?? null, [scan, storeType]);
  const slopes = useMemo(() => (scanRow ? scanSlopes(scanRow, scan?.half_days ?? 15) : null), [scanRow, scan]);
  const risk = useMemo(() => (slopes && d ? predictRisk({ completionSlopePerDay: slopes.completionSlopePerDay, skipSlopePerDay: slopes.skipSlopePerDay, driftScore: driftResult?.score ?? null, sample: d.summary.events }) : null), [slopes, d, driftResult]);
  const opportunities = useMemo(() => (scan ? detectOpportunities(scan.items) : []), [scan]);
  const liveRecos = useMemo(() => (d && predictionAllowed(d.summary.events) ? recommendContext(d) : []), [d]);

  // Simulation items
  const simItems = useMemo<ItemKpi[]>(() => {
    if (!d) return [];
    if (simKind === 'playlist') return d.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate }));
    if (simKind === 'track') return d.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate }));
    return [];
  }, [d, simKind]);
  const simItem = useMemo(() => simItems.find((i) => i.key === simItemKey) ?? simItems[0] ?? null, [simItems, simItemKey]);
  const itemSim = useMemo(() => (d && simItem && (simKind === 'playlist' || simKind === 'track')) ? simulateItemChange(d.summary, simAction, simItem, simAction === 'swap' ? bestItem(simItems) : undefined) : null, [d, simItem, simAction, simKind, simItems]);

  const mixGroups = useMemo<GenreMoodRow[]>(() => (d ? (simKind === 'mood' ? d.moods : d.genres) : []), [d, simKind]);
  const recommendedMix = useMemo<MixTarget[]>(() => buildRecommendedMix(mixGroups), [mixGroups]);
  const currentMix = useMemo<MixTarget[]>(() => buildCurrentMix(mixGroups), [mixGroups]);
  const mixSim = useMemo(() => (d && (simKind === 'genre' || simKind === 'mood') ? simulateMix(d.summary, mixGroups, recommendedMix) : null), [d, simKind, mixGroups, recommendedMix]);

  // Counterfactual: 현재 Genre Mix vs 추천(고성과 가중) Mix
  const cfCurrent = useMemo(() => (d ? simulateMix(d.summary, d.genres, currentMix) : null), [d, currentMix]);
  const cfRecommended = useMemo(() => (d ? simulateMix(d.summary, d.genres, recommendedMix) : null), [d, recommendedMix]);
  const cf = useMemo(() => {
    if (!cfCurrent || !cfRecommended || cfCurrent.insufficient || cfRecommended.insufficient) return null;
    return counterfactual(
      { label: '현재 Mix', completion: cfCurrent.after.completion, skip: cfCurrent.after.skip, diversity: cfCurrent.after.diversity, health: cfCurrent.after.health },
      { label: '추천 Mix', completion: cfRecommended.after.completion, skip: cfRecommended.after.skip, diversity: cfRecommended.after.diversity, health: cfRecommended.after.health },
    );
  }, [cfCurrent, cfRecommended]);

  const saveForecast = async () => {
    if (!d || !forecast.length) return;
    setBusy(true);
    try {
      const f30 = forecast.find((f) => f.horizon === 30) ?? forecast[0];
      await savePredictionSnapshot({
        context_key: contextKey || storeType, prediction_type: 'forecast', horizon: '30d',
        prediction: { completion: f30.completion, skip: f30.skip, listen: f30.listen, health: f30.health },
        confidence: f30.confidence,
        evidence: [
          { label: 'Context', value: contextKey || storeType }, { label: '표본', value: d.summary.events },
          { label: 'Stability', value: stability.factor }, { label: 'Drift', value: driftResult?.score ?? null },
          { label: 'Confidence', value: f30.confidence }, { label: '기간', value: range },
        ],
      });
      toast.success('Forecast Snapshot 저장됨(History)');
      setHistory(await fetchPredictionHistory(contextKey || (storeType ?? ''), null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="Predictive Intelligence & Simulation"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Predictive Intelligence & Simulation">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void loadTop()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const insufficient = !d || !predictionAllowed(d.summary.events);

  return (
    <AdminCard
      title="Predictive Intelligence & Simulation"
      subtitle="미래 KPI 예측 + 변경 전 시뮬레이션 · 예측/시뮬레이션 전용(실제 변경 없음)"
      action={
        <div className="flex items-center gap-1.5">
          <select value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => { void loadTop(); void loadContext(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* Context 선택(Opportunities 제외 공통) */}
      {tab !== 'opportunities' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
          <span className="text-[10px] font-bold text-muted-foreground">Context</span>
          <select value={storeType ?? ''} onChange={(e) => setStoreType(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {(overview?.items ?? []).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type} ({NUM(it.events)})</option>)}
          </select>
          <select value={daypart ?? ''} onChange={(e) => setDaypart(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">Daypart 전체</option>{DAYPARTS.map((dp) => <option key={dp} value={dp}>{dp}</option>)}
          </select>
          <select value={weekdayGroup ?? ''} onChange={(e) => setWeekdayGroup(e.target.value || null)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">평일/주말 전체</option><option value="weekday">평일</option><option value="weekend">주말</option>
          </select>
          {busy && <span className="text-[10px] text-muted-foreground">로딩…</span>}
          <code className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px]">{contextKey || storeType}</code>
        </div>
      )}

      {insufficient && tab !== 'opportunities' && (
        <AdminAlert tone="warning" title="Prediction 생성 불가(표본 부족)"
          description={`이 Context 표본이 ${NUM(d?.summary.events ?? 0)} 입니다(최소 20). 예측/시뮬레이션/Forecast/Risk 는 표본 충족 시에만 생성됩니다.`} />
      )}

      {/* ── Forecast ── */}
      {tab === 'forecast' && !insufficient && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Forecast = 버킷 시계열 선형 회귀 예측(추정)"
            description="예측은 과거 추세의 외삽이며 보장이 아닙니다. Prediction Confidence(표본·Stability·Drift·Freshness·Horizon)를 함께 확인하세요." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Horizon</th><th className="px-2">완주율</th><th className="px-2">Skip</th><th className="px-2">평균청취</th><th className="px-2">Health</th><th className="px-2">Confidence</th></tr></thead>
              <tbody>
                {forecast.map((f) => (
                  <tr key={f.horizon} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-bold">{f.horizon}일</td>
                    <td className="px-2">{f.insufficient ? '데이터 부족' : `${f.completion}%`}</td>
                    <td className="px-2">{f.insufficient ? '—' : `${f.skip}%`}</td>
                    <td className="px-2">{f.insufficient ? '—' : `${f.listen}s`}</td>
                    <td className="px-2">{f.health == null ? '—' : f.health}</td>
                    <td className="px-2"><AdminBadge tone={f.confidence >= 60 ? 'success' : f.confidence >= 35 ? 'warning' : 'danger'}>{f.confidence}</AdminBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminCard title="지표별 Forecast Trend (30일)">
            <div className="flex flex-wrap gap-2">
              {FORECAST_METRICS.map((m) => {
                const fk = trend ? forecastKpi(trend.series, m.key, 30) : null;
                const st = fk ? classifyForecast(fk, m.key) : 'insufficient_data';
                return (
                  <div key={m.key} className="rounded-lg border border-border p-2">
                    <p className="text-[10px] font-bold text-muted-foreground">{m.label}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold">{fk?.current ?? '—'} → {fk?.predicted ?? '—'} <AdminBadge tone={FORECAST_STATUS_TONE[st]}>{FORECAST_STATUS_LABEL[st]}</AdminBadge></p>
                  </div>
                );
              })}
            </div>
          </AdminCard>
          <button disabled={busy} onClick={() => void saveForecast()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Save size={12} /> Forecast(30d) Snapshot 저장</button>
        </div>
      )}

      {/* ── Simulation ── */}
      {tab === 'simulation' && !insufficient && d && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="What-if 시뮬레이션 (실제 변경 없음)"
            description="Playlist/Track 추가·제거·교체, Genre/Mood 비율 변경 시 예상 KPI 를 가중 혼합으로 계산합니다." />
          <div className="flex flex-wrap items-center gap-1.5">
            {(['playlist', 'track', 'genre', 'mood'] as const).map((k) => (
              <button key={k} onClick={() => { setSimKind(k); setSimItemKey(''); }} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${simKind === k ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}>{k}</button>
            ))}
          </div>

          {(simKind === 'playlist' || simKind === 'track') && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={simItem?.key ?? ''} onChange={(e) => setSimItemKey(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
                  {simItems.slice(0, 50).map((i) => <option key={i.key} value={i.key}>{i.label} ({NUM(i.events)}, {i.completion_rate ?? '—'}%)</option>)}
                </select>
                {(['add', 'remove', 'swap'] as SimAction[]).map((a) => (
                  <button key={a} onClick={() => setSimAction(a)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${simAction === a ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}>{a === 'swap' ? 'swap(↔최고)' : a}</button>
                ))}
              </div>
              {itemSim && (itemSim.insufficient
                ? <AdminAlert tone="warning" title="시뮬레이션 불가" description="대상/Context 표본 부족." />
                : <SimResultCard title={`${simKind} ${simAction} 예상`} before={itemSim.before} after={itemSim.after} delta={itemSim.delta} evidence={itemSim.evidence} />)}
            </>
          )}

          {(simKind === 'genre' || simKind === 'mood') && (
            mixSim && (mixSim.insufficient
              ? <AdminAlert tone="warning" title="시뮬레이션 불가" description={`사용 가능한 ${simKind} 그룹(표본≥5)이 부족합니다.`} />
              : (
                <AdminCard title={`${simKind} 비율 → 고성과 가중 예상`}>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <KpiBox label="완주율" value={`${mixSim.before.completion} → ${mixSim.after.completion}`} tone={deltaTone(mixSim.delta.completion, true)} sign={mixSim.delta.completion} />
                    <KpiBox label="Skip" value={`${mixSim.before.skip} → ${mixSim.after.skip}`} tone={deltaTone(mixSim.delta.skip, false)} sign={mixSim.delta.skip} />
                    <KpiBox label="Diversity" value={`${mixSim.before.diversity} → ${mixSim.after.diversity}`} tone={deltaTone(mixSim.delta.diversity, true)} sign={mixSim.delta.diversity} />
                    <KpiBox label="Health(예상)" value={`${mixSim.after.health}`} tone="neutral" />
                  </div>
                  <p className="pt-1 text-[10px] text-muted-foreground">추천 Mix: {recommendedMix.slice(0, 4).map((m) => `${m.key} ${Math.round(m.share * 100)}%`).join(' · ')}</p>
                </AdminCard>
              ))
          )}

          {/* Recommendation Impact */}
          {liveRecos.length > 0 && (
            <AdminCard title="Recommendation Impact (적용 가정 예상 개선)">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">추천</th><th className="px-2">완주율 Δ</th><th className="px-2">Skip Δ</th><th className="px-2">Health Δ</th></tr></thead>
                <tbody>
                  {liveRecos.slice(0, 6).map((r, i) => {
                    const imp = predictRecoImpact(r.type, d.summary, 70);
                    return (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{RECO_LABEL[r.type]}</td>
                        <td className="px-2 text-emerald-600 dark:text-emerald-400">{SIGN(imp.completion)}</td>
                        <td className="px-2 text-rose-600 dark:text-rose-400">{SIGN(imp.skip)}</td>
                        <td className="px-2">{SIGN(imp.health)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="pt-1 text-[10px] text-muted-foreground">※ headroom·Confidence 기반 보수적 추정. 실제 개선 보장 아님.</p>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Risk ── */}
      {tab === 'risk' && !insufficient && (
        <div className="space-y-3">
          {!risk || risk.insufficient ? <AdminAlert tone="warning" title="Risk 계산 불가" description="두 기간 표본/기울기 데이터 부족." /> : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">종합 Risk</span>
                <AdminBadge tone={riskTone(risk.overall)}>{risk.overall}/100</AdminBadge>
              </div>
              {risk.risks.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="w-24 text-[11px] font-semibold">{r.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${r.score >= 60 ? 'bg-rose-500' : r.score >= 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${r.score}%` }} /></div>
                  <span className="w-10 text-right text-[11px]">{r.score}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 pt-1">
                {risk.evidence.map((e, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{e.label}: <b>{e.value == null ? '—' : String(e.value)}</b></span>)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Opportunities ── */}
      {tab === 'opportunities' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Opportunity Detection (전 Context 스캔)"
            description="최근 상승 추세 + 완주율 headroom + 충분 표본인 Context 의 예상 개선폭을 산출합니다. 표본 부족/결측 Context 는 제외." />
          {!opportunities.length ? <AdminEmpty icon={<Target size={20} />} title="탐지된 기회 없음" description="상승 추세이면서 표본이 충분한 Context 가 없습니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Store Type</th><th className="px-2">예상 개선</th><th className="px-2">근거</th><th className="px-2">Confidence</th><th className="px-2">표본</th></tr></thead>
                <tbody>
                  {opportunities.map((o) => (
                    <tr key={o.store_type} className="border-b border-border/50 hover:bg-muted/40 cursor-pointer" onClick={() => { setStoreType(o.store_type); setDaypart(null); setWeekdayGroup(null); setTab('forecast'); }}>
                      <td className="py-1.5 pr-2 font-bold">{o.store_type}</td>
                      <td className="px-2"><AdminBadge tone="success">+{o.expectedImprovement}%</AdminBadge></td>
                      <td className="px-2 text-[10px] text-muted-foreground">{o.basis}</td>
                      <td className="px-2">{o.confidence}</td><td className="px-2">{NUM(o.events)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Counterfactual ── */}
      {tab === 'counterfactual' && !insufficient && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Counterfactual: 현재 Genre Mix vs 추천(고성과 가중) Mix"
            description="Winner 를 단정하지 않고 항목별 차이만 비교합니다(예측 기반)." />
          {!cf ? <AdminEmpty icon={<GitCompare size={20} />} title="비교 불가" description="사용 가능한 장르 그룹(표본≥5)이 부족합니다." /> : (
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">KPI</th><th className="px-2">현재 Mix</th><th className="px-2">추천 Mix</th><th className="px-2">Δ</th><th className="px-2">비교</th></tr></thead>
              <tbody>
                {cf.rows.map((r) => (
                  <tr key={r.kpi} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{r.kpi}</td>
                    <td className="px-2">{NUM(r.a)}</td><td className="px-2">{NUM(r.b)}</td>
                    <td className="px-2">{r.delta == null ? '—' : SIGN(r.delta)}</td>
                    <td className="px-2 text-[10px] text-muted-foreground">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Prediction History ── */}
      {tab === 'history' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Prediction History"
            description="저장한 예측 Snapshot 을 시간순으로 조회합니다(예측 전용 기록, 실제 변경 없음)." />
          {!history.length ? <AdminEmpty icon={<Inbox size={20} />} title="저장된 예측 없음" description="Forecast 탭에서 Snapshot 을 저장하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">시각</th><th className="px-2">Type</th><th className="px-2">Horizon</th><th className="px-2">예측</th><th className="px-2">Conf</th></tr></thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.id ?? i} className="border-b border-border/50">
                      <td className="py-1.5 pr-2">{h.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-2"><AdminBadge tone="neutral">{h.prediction_type}</AdminBadge></td>
                      <td className="px-2">{h.horizon ?? '—'}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{JSON.stringify(h.prediction)}</td>
                      <td className="px-2">{h.confidence ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AdminCard>
  );
}

/* ── 헬퍼 ─────────────────────────────────────────────────────────────────── */
function bestItem(items: ItemKpi[]): ItemKpi | undefined {
  return [...items].filter((i) => i.completion_rate != null).sort((a, b) => (b.completion_rate ?? 0) - (a.completion_rate ?? 0))[0];
}
function buildCurrentMix(groups: GenreMoodRow[]): MixTarget[] {
  const known = groups.filter((g) => !g.is_unknown);
  const tot = known.reduce((a, g) => a + g.events, 0) || 1;
  return known.map((g) => ({ key: g.key, share: g.events / tot }));
}
function buildRecommendedMix(groups: GenreMoodRow[]): MixTarget[] {
  const known = groups.filter((g) => !g.is_unknown && g.events >= 5 && g.completion_rate != null);
  const weights = known.map((g) => ({ key: g.key, w: Math.max(1, (g.completion_rate ?? 0) - 50) }));
  const tot = weights.reduce((a, x) => a + x.w, 0) || 1;
  return weights.map((x) => ({ key: x.key, share: x.w / tot }));
}

function KpiBox({ label, value, tone, sign }: { label: string; value: string; tone: 'success' | 'danger' | 'neutral'; sign?: number | null }) {
  const color = tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : '';
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xs font-bold ${color}`}>{value} {sign != null && sign !== 0 && <span>({sign > 0 ? '+' : ''}{sign})</span>}</p>
    </div>
  );
}
function SimResultCard({ title, before, after, delta, evidence }: {
  title: string; before: { completion: number | null; skip: number | null }; after: { completion: number | null; skip: number | null };
  delta: { completion: number | null; skip: number | null }; evidence: { label: string; value: string | number | null }[];
}) {
  return (
    <AdminCard title={title}>
      <div className="grid grid-cols-2 gap-2">
        <KpiBox label="완주율" value={`${before.completion} → ${after.completion}`} tone={deltaTone(delta.completion, true)} sign={delta.completion} />
        <KpiBox label="Skip" value={`${before.skip} → ${after.skip}`} tone={deltaTone(delta.skip, false)} sign={delta.skip} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {evidence.map((e, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{e.label}: <b>{e.value == null ? '—' : String(e.value)}</b></span>)}
      </div>
    </AdminCard>
  );
}
