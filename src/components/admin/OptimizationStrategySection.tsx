/**
 * OptimizationStrategySection — Autonomous Optimization Strategy Engine (Phase AI-MUSIC-5).
 *
 * Prediction 결과 기반으로 Context 별 최적화 전략 후보를 생성·평가한다. 전략 제안·시뮬레이션 전용 —
 * 자동 Playlist/Scheduler/Queue/Playback/Recommendation/Weight/Rollout/Experiment 변경 없음.
 * 운영자 승인 후에만 이후 Phase 에서 사용 가능.
 *
 * 탭: Strategy Center · Ranking · ROI · Cost · Risk · Multi Simulation · Dependency Graph · Strategy Memory.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Lightbulb, ListOrdered, TrendingUp, Coins, ShieldAlert, Layers, Network, Database, RefreshCw, Save, Inbox,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchContextDrift,
  saveStrategy, fetchStrategyMemory, resolveStrategy, fetchStrategyLearning,
  type ContextOverview, type ContextDetailResp, type ContextDriftResp, type StrategyRow, type StrategyLearningResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { buildContextKey, computeContextScore, type ContextDetail } from '@/lib/contextIntel';
import { computeDrift } from '@/lib/contextLearning';
import type { ItemKpi } from '@/lib/predictiveIntel';
import {
  generateStrategies, rankStrategies, multiStrategySimulation, dependencyGraph, optimizationPlan,
  COST_LABEL, STRATEGY_LABEL, roiTone, riskToneS, costTone, strategyAllowed,
  STRATEGY_STATUS_LABEL, STRATEGY_STATUS_TONE,
  type Strategy, type GenerateInput,
} from '@/lib/optimizationStrategy';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const SIGN = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const RANGES = ['7d', '30d', '90d', '12m'] as const;
const DAYPARTS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;

type Tab = 'center' | 'ranking' | 'roi' | 'cost' | 'risk' | 'multi' | 'dependency' | 'memory';
const TABS: { key: Tab; label: string; icon: typeof Lightbulb }[] = [
  { key: 'center', label: 'Strategy Center', icon: Lightbulb },
  { key: 'ranking', label: 'Ranking', icon: ListOrdered },
  { key: 'roi', label: 'ROI', icon: TrendingUp },
  { key: 'cost', label: 'Cost', icon: Coins },
  { key: 'risk', label: 'Risk', icon: ShieldAlert },
  { key: 'multi', label: 'Multi Simulation', icon: Layers },
  { key: 'dependency', label: 'Dependency Graph', icon: Network },
  { key: 'memory', label: 'Strategy Memory', icon: Database },
];

export default function OptimizationStrategySection() {
  const [tab, setTab] = useState<Tab>('center');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [weekdayGroup, setWeekdayGroup] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [drift, setDrift] = useState<ContextDriftResp | null>(null);
  const [memory, setMemory] = useState<StrategyRow[]>([]);
  const [learning, setLearning] = useState<StrategyLearningResp | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [riskPick, setRiskPick] = useState<string>('');

  const contextKey = useMemo(() => buildContextKey({ store_type: storeType, daypart, weekday_group: weekdayGroup }), [storeType, daypart, weekdayGroup]);

  const loadOverview = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const o = await fetchContextOverview(range);
      setOverview(o);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range, storeType]);
  useEffect(() => { void loadOverview(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadContext = useCallback(async () => {
    if (!storeType) return;
    setBusy(true);
    try {
      const [de, dr, mem, lr] = await Promise.all([
        fetchContextDetail(storeType, daypart, weekdayGroup, range, 20).catch(() => null),
        fetchContextDrift(storeType, daypart, weekdayGroup, range).catch(() => null),
        fetchStrategyMemory(contextKey || storeType, null, 100).catch(() => [] as StrategyRow[]),
        fetchStrategyLearning(contextKey || storeType).catch(() => null),
      ]);
      setDetail(de); setDrift(dr); setMemory(mem); setLearning(lr);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, [storeType, daypart, weekdayGroup, range, contextKey]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const d = useMemo(() => (detail ? (detail as ContextDetail) : null), [detail]);
  const driftResult = useMemo(() => (drift?.recent && drift?.prior ? computeDrift(drift.prior, drift.recent) : null), [drift]);
  const strategies = useMemo<Strategy[]>(() => {
    if (!d || !strategyAllowed(d.summary.events)) return [];
    const conf = computeContextScore(d.summary).confidence;
    const metaCov = d.summary.events > 0 ? Math.round((1 - d.summary.unknown_genre_events / d.summary.events) * 100) : 80;
    const histFail = learning?.totals && learning.totals.resolved_outcomes > 0 ? Math.round((learning.totals.degraded / learning.totals.resolved_outcomes) * 100) : 25;
    const toItems = (rows: { key: string; label?: string; title?: string | null; track_id?: string; playlist_id?: string | null; events: number; completion_rate: number | null; skip_rate: number | null }[]): ItemKpi[] => rows.map((r) => ({ key: r.key, label: r.label ?? '', events: r.events, completion_rate: r.completion_rate, skip_rate: r.skip_rate }));
    const input: GenerateInput = {
      summary: d.summary,
      tracks: toItems(d.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate }))),
      playlists: toItems(d.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate }))),
      genres: d.genres, moods: d.moods, confidence: conf, driftScore: driftResult?.score ?? null,
      metadataCoverage: metaCov, historicalFailureRate: histFail, daysSinceLast: d.summary.days_since_last,
    };
    return generateStrategies(input);
  }, [d, driftResult, learning]);

  const ranked = useMemo(() => rankStrategies(strategies), [strategies]);
  useEffect(() => { setSelectedIds(new Set(strategies.map((s) => s.id))); }, [strategies]);
  const selected = useMemo(() => strategies.filter((s) => selectedIds.has(s.id)), [strategies, selectedIds]);
  const multi = useMemo(() => (selected.length ? multiStrategySimulation(selected) : null), [selected]);
  const deps = useMemo(() => dependencyGraph(strategies), [strategies]);
  const plan = useMemo(() => optimizationPlan(strategies), [strategies]);
  const riskStrategy = useMemo(() => strategies.find((s) => s.id === riskPick) ?? strategies[0] ?? null, [strategies, riskPick]);

  const saveOne = async (s: Strategy) => {
    setBusy(true);
    try {
      await saveStrategy({
        context_key: contextKey || storeType, strategy_type: s.type, target: s.target,
        roi_score: s.roi, risk_score: s.risk.score, cost_score: s.cost.score, confidence: s.confidence,
        expected_gain: s.expected, evidence: s.evidence,
        before_kpi: { completion_rate: d?.summary.completion_rate ?? null, skip_rate: d?.summary.skip_rate ?? null },
      });
      toast.success('전략 저장됨(Strategy Memory)');
      setMemory(await fetchStrategyMemory(contextKey || (storeType ?? ''), null, 100));
      setLearning(await fetchStrategyLearning(contextKey || (storeType ?? '')));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const resolveOne = async (id: string, status: string, outcome: string | null) => {
    setBusy(true);
    try {
      await resolveStrategy(id, status, outcome, outcome ? { completion_rate: d?.summary.completion_rate ?? null, skip_rate: d?.summary.skip_rate ?? null } : null);
      toast.success('전략 상태 갱신됨');
      setMemory(await fetchStrategyMemory(contextKey || (storeType ?? ''), null, 100));
      setLearning(await fetchStrategyLearning(contextKey || (storeType ?? '')));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="Optimization Strategy"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Optimization Strategy">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void loadOverview()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const insufficient = !d || !strategyAllowed(d.summary.events);

  return (
    <AdminCard
      title="Optimization Strategy"
      subtitle="Prediction 기반 최적화 전략 후보 생성·평가 · 전략 제안/시뮬레이션 전용(자동 실행 없음, 운영자 승인 필요)"
      action={
        <div className="flex items-center gap-1.5">
          <select value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => { void loadOverview(); void loadContext(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* Context 선택 */}
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

      {insufficient && tab !== 'memory' && (
        <AdminAlert tone="warning" title="Strategy 생성 불가(표본 부족)"
          description={`이 Context 표본이 ${NUM(d?.summary.events ?? 0)} 입니다(최소 20). 전략/ROI/시뮬레이션은 표본 충족 시에만 생성됩니다.`} />
      )}

      {/* ── Strategy Center ── */}
      {tab === 'center' && !insufficient && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="전략 후보 (자동 실행 없음 · 운영자 승인 필요)"
            description="Prediction/시뮬레이션 기반 최적화 전략 후보입니다. 저장 후 Strategy Memory 에서 승인/기각합니다." />
          {!strategies.length ? <AdminEmpty icon={<Lightbulb size={20} />} title="전략 후보 없음" description="현재 KPI 로 유효한 전략이 없습니다." /> : strategies.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={roiTone(s.roi)}>ROI {s.roi}</AdminBadge>
                <AdminBadge tone="info">{STRATEGY_LABEL[s.type]}</AdminBadge>
                {s.target && <span className="text-[11px] font-semibold">{s.target}</span>}
                <span className="ml-auto flex items-center gap-1">
                  <AdminBadge tone={costTone(s.cost.level)}>Cost {COST_LABEL[s.cost.level]}</AdminBadge>
                  <AdminBadge tone={riskToneS(s.risk.score)}>Risk {s.risk.score}</AdminBadge>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
                <span>완주율 <b className="text-emerald-600 dark:text-emerald-400">{SIGN(s.expected.completion)}</b></span>
                <span>Skip <b className="text-rose-600 dark:text-rose-400">{SIGN(s.expected.skip)}</b></span>
                <span>Health <b>{SIGN(s.expected.health)}</b></span>
                <span>Confidence <b>{s.confidence}</b></span>
                <span>표본 <b>{NUM(s.sample)}</b></span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {s.evidence.slice(0, 5).map((e, j) => <span key={j} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{e.label}: <b>{e.value == null ? '—' : String(e.value)}</b></span>)}
                </div>
                <button disabled={busy} onClick={() => void saveOne(s)} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50"><Save size={11} /> 저장</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Ranking ── */}
      {tab === 'ranking' && !insufficient && (
        <RankTable ranked={ranked} />
      )}

      {/* ── ROI ── */}
      {tab === 'roi' && !insufficient && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="ROI = Expected Gain · Confidence · Cost 역 · Risk 역"
            description="실제 존재하는 값만 사용합니다. 예측 기반 추정이며 보장이 아닙니다." />
          {ranked.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-40 truncate text-[11px] font-semibold">{STRATEGY_LABEL[s.type]}{s.target ? ` · ${s.target}` : ''}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${s.roi >= 60 ? 'bg-emerald-500' : s.roi >= 35 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${s.roi}%` }} /></div>
              <span className="w-8 text-right text-[11px] font-bold">{s.roi}</span>
            </div>
          ))}
          {!ranked.length && <AdminEmpty icon={<TrendingUp size={20} />} title="전략 없음" />}
        </div>
      )}

      {/* ── Cost ── */}
      {tab === 'cost' && !insufficient && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">전략</th><th className="px-2">Cost Level</th><th className="px-2">Cost Score</th><th className="px-2">ROI</th></tr></thead>
            <tbody>
              {ranked.map((s) => (
                <tr key={s.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{STRATEGY_LABEL[s.type]}{s.target ? ` · ${s.target}` : ''}</td>
                  <td className="px-2"><AdminBadge tone={costTone(s.cost.level)}>{COST_LABEL[s.cost.level]}</AdminBadge></td>
                  <td className="px-2">{s.cost.score}</td><td className="px-2">{s.roi}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ranked.length && <AdminEmpty icon={<Coins size={20} />} title="전략 없음" />}
        </div>
      )}

      {/* ── Risk ── */}
      {tab === 'risk' && !insufficient && (
        <div className="space-y-3">
          {!riskStrategy ? <AdminEmpty icon={<ShieldAlert size={20} />} title="전략 없음" /> : (
            <>
              <select value={riskStrategy.id} onChange={(e) => setRiskPick(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
                {strategies.map((s) => <option key={s.id} value={s.id}>{STRATEGY_LABEL[s.type]}{s.target ? ` · ${s.target}` : ''} (Risk {s.risk.score})</option>)}
              </select>
              <div className="flex items-center gap-2"><span className="text-xs font-bold">종합 Risk</span><AdminBadge tone={riskToneS(riskStrategy.risk.score)}>{riskStrategy.risk.score}/100</AdminBadge></div>
              {riskStrategy.risk.components.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-28 text-[11px] font-semibold">{c.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full ${c.value >= 60 ? 'bg-rose-500' : c.value >= 35 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.value}%` }} /></div>
                  <span className="w-8 text-right text-[11px]">{c.value}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Multi Simulation ── */}
      {tab === 'multi' && !insufficient && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="복수 전략 동시 적용 가정(수확체감·충돌 인지)"
            description="선택 전략을 함께 적용한다고 가정한 예상 KPI 입니다. 실제 적용 없음." />
          {!strategies.length ? <AdminEmpty icon={<Layers size={20} />} title="전략 없음" /> : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {strategies.map((s) => (
                  <button key={s.id} onClick={() => setSelectedIds((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${selectedIds.has(s.id) ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>
                    {STRATEGY_LABEL[s.type]}
                  </button>
                ))}
              </div>
              {multi && (
                <AdminCard title={`조합 예상 (${selected.length}개)`}>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Box label="완주율 Δ" value={SIGN(multi.combined.completion)} />
                    <Box label="Skip Δ" value={SIGN(multi.combined.skip)} />
                    <Box label="청취 Δ" value={SIGN(multi.combined.listening)} />
                    <Box label="Health Δ" value={SIGN(multi.combined.health)} />
                  </div>
                  <p className="pt-1 text-[10px] text-muted-foreground">{multi.note}</p>
                  {multi.conflicts.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {multi.conflicts.map((c, i) => <AdminAlert key={i} tone="warning" title="충돌" description={c.reason} />)}
                    </div>
                  )}
                </AdminCard>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Dependency Graph ── */}
      {tab === 'dependency' && !insufficient && (
        <div className="space-y-3">
          <AdminCard title="Dependency (선행 → 후행)">
            {!deps.length ? <p className="text-[11px] text-muted-foreground">현재 전략 집합에 의존 관계가 없습니다.</p> : deps.map((dp, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-border/40 py-1 text-[11px]">
                <AdminBadge tone={dp.present ? 'success' : 'neutral'}>{STRATEGY_LABEL[dp.from]}</AdminBadge>
                <span>→</span>
                <AdminBadge tone={dp.present ? 'success' : 'neutral'}>{STRATEGY_LABEL[dp.to]}</AdminBadge>
                <span className="text-muted-foreground">— {dp.reason} {dp.present ? '' : '(일부 부재)'}</span>
              </div>
            ))}
          </AdminCard>
          <AdminCard title="Optimization Plan (실행 순서 — 자동 실행 없음)">
            {!plan.length ? <p className="text-[11px] text-muted-foreground">전략 없음</p> : (
              <ol className="space-y-1">
                {plan.map((p) => (
                  <li key={p.order} className="flex items-center gap-2 text-[11px]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-black">{p.order}</span>
                    <span className="font-semibold">{STRATEGY_LABEL[p.strategy.type]}{p.strategy.target ? ` · ${p.strategy.target}` : ''}</span>
                    <AdminBadge tone={roiTone(p.strategy.roi)}>ROI {p.strategy.roi}</AdminBadge>
                    <span className="text-muted-foreground">— {p.reason}</span>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>
        </div>
      )}

      {/* ── Strategy Memory ── */}
      {tab === 'memory' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Strategy Memory (운영자 승인/기각 · 자동 학습 없음)"
            description="저장된 전략을 승인/기각하고 이후 Outcome 을 기록합니다. 승인해도 자동 실행되지 않습니다." />
          {learning?.totals && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="총/승인/기각" value={`${learning.totals.total}/${learning.totals.approved}/${learning.totals.dismissed}`} />
              <Box label="개선/악화" value={`${learning.totals.improved}/${learning.totals.degraded}`} />
              <Box label="Outcome 판정" value={`${learning.totals.resolved_outcomes}`} />
              <Box label="Context" value={contextKey || (storeType ?? '—')} />
            </div>
          )}
          {!memory.length ? <AdminEmpty icon={<Inbox size={20} />} title="저장된 전략 없음" description="Strategy Center 에서 전략을 저장하세요." /> : (
            <div className="space-y-2">
              {memory.map((m) => (
                <div key={m.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdminBadge tone={STRATEGY_STATUS_TONE[m.status] ?? 'neutral'}>{STRATEGY_STATUS_LABEL[m.status] ?? m.status}</AdminBadge>
                    <AdminBadge tone="info">{STRATEGY_LABEL[m.strategy_type as keyof typeof STRATEGY_LABEL] ?? m.strategy_type}</AdminBadge>
                    {m.target && <span className="text-[11px] font-semibold">{m.target}</span>}
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">ROI {m.roi_score} · Risk {m.risk_score} · Cost {m.cost_score}</span>
                  </div>
                  {m.status === 'active' && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button disabled={busy} onClick={() => void resolveOne(m.id!, 'approved', null)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">승인</button>
                      <button disabled={busy} onClick={() => void resolveOne(m.id!, 'dismissed', null)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                    </div>
                  )}
                  {(m.status === 'approved' || m.status === 'resolved') && !m.outcome && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Outcome(현재 KPI 기준):</span>
                      {(['improved', 'neutral', 'degraded'] as const).map((o) => (
                        <button key={o} disabled={busy} onClick={() => void resolveOne(m.id!, 'resolved', o)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{o}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {learning && learning.by_type.length > 0 && (
            <AdminCard title="Type별 Strategy Learning">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Type</th><th className="px-2">총</th><th className="px-2">승인</th><th className="px-2">기각</th><th className="px-2">개선</th><th className="px-2">악화</th><th className="px-2">평균 ROI</th></tr></thead>
                <tbody>
                  {learning.by_type.map((t) => (
                    <tr key={t.strategy_type} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-semibold">{STRATEGY_LABEL[t.strategy_type as keyof typeof STRATEGY_LABEL] ?? t.strategy_type}</td>
                      <td className="px-2">{t.total}</td><td className="px-2">{t.approved}</td><td className="px-2">{t.dismissed}</td><td className="px-2">{t.improved}</td><td className="px-2">{t.degraded}</td><td className="px-2">{t.avg_roi ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminCard>
          )}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-black break-words">{value}</p>
    </div>
  );
}
function RankTable({ ranked }: { ranked: Strategy[] }) {
  if (!ranked.length) return <AdminEmpty icon={<ListOrdered size={20} />} title="전략 없음" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">#</th><th className="px-2">전략</th><th className="px-2">ROI</th><th className="px-2">완주율Δ</th><th className="px-2">SkipΔ</th><th className="px-2">HealthΔ</th><th className="px-2">Conf</th><th className="px-2">Cost</th><th className="px-2">Risk</th><th className="px-2">표본</th></tr></thead>
        <tbody>
          {ranked.map((s, i) => (
            <tr key={s.id} className="border-b border-border/50">
              <td className="py-1.5 pr-2">{i + 1}</td>
              <td className="px-2 font-semibold">{STRATEGY_LABEL[s.type]}{s.target ? ` · ${s.target}` : ''}</td>
              <td className="px-2"><AdminBadge tone={roiTone(s.roi)}>{s.roi}</AdminBadge></td>
              <td className="px-2 text-emerald-600 dark:text-emerald-400">{SIGN(s.expected.completion)}</td>
              <td className="px-2 text-rose-600 dark:text-rose-400">{SIGN(s.expected.skip)}</td>
              <td className="px-2">{SIGN(s.expected.health)}</td>
              <td className="px-2">{s.confidence}</td>
              <td className="px-2">{COST_LABEL[s.cost.level]}</td>
              <td className="px-2">{s.risk.score}</td>
              <td className="px-2">{s.sample.toLocaleString('ko-KR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
