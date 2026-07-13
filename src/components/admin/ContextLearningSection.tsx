/**
 * ContextLearningSection — Context Evolution & Adaptive Learning (Phase AI-MUSIC-3).
 *
 * Context Intelligence(현재 분석) 위에, **시간에 따른 진화**(Drift/Stability/Decay/Evolution)와
 * **Recommendation 품질 향상(Learning)**을 다룬다. Learning Signal·분석 전용 —
 * 자동 Playlist/Scheduler/Queue/Playback/Rollout 변경 없음. 추천 적용/기각은 운영자 수동 기록.
 *
 * 탭: Evolution · Drift · Stability · Similar Context · Recommendation Outcomes · Learning Timeline · Memory.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Waves, Activity, Share2, ClipboardCheck, History, Database, RefreshCw, Save,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchContextDetail, fetchContextTrend, fetchContextDrift, fetchContextSimilarity,
  saveContextSnapshot, fetchContextMemory, saveContextReco, resolveContextReco, fetchContextRecos, fetchContextLearning,
  type ContextOverview, type ContextDetailResp, type ContextTrendResp, type ContextDriftResp, type ContextLearningResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildContextKey, computeContextHealth, computeContextScore, recommendContext, sampleTier,
  SAMPLE_TIER_LABEL, SAMPLE_TIER_TONE, RECO_LABEL, type ContextDetail,
} from '@/lib/contextIntel';
import {
  computeDrift, computeStability, applyStability, rankSimilar, smartFallbackChain,
  computeSuccessRate, calibrateConfidence, buildEvolution, mergeTimeline, learningAllowed, learningConfidence,
  DRIFT_STATUS_LABEL, DRIFT_STATUS_TONE, STABILITY_LABEL, STABILITY_TONE, OUTCOME_LABEL, OUTCOME_TONE,
  RECO_STATUS_LABEL, RECO_STATUS_TONE, TIMELINE_KIND_LABEL,
  type ContextFeature, type Snapshot, type RecoOutcomeRow, type TimelineEntry, type RecoOutcome,
} from '@/lib/contextLearning';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const RANGES = ['7d', '30d', '90d', '12m'] as const;
const DAYPARTS = ['새벽', '아침', '점심', '오후', '저녁', '심야'] as const;

type Tab = 'evolution' | 'drift' | 'stability' | 'similar' | 'outcomes' | 'timeline' | 'memory';
const TABS: { key: Tab; label: string; icon: typeof LineChart }[] = [
  { key: 'evolution', label: 'Evolution', icon: LineChart },
  { key: 'drift', label: 'Drift', icon: Waves },
  { key: 'stability', label: 'Stability', icon: Activity },
  { key: 'similar', label: 'Similar Context', icon: Share2 },
  { key: 'outcomes', label: 'Recommendation Outcomes', icon: ClipboardCheck },
  { key: 'timeline', label: 'Learning Timeline', icon: History },
  { key: 'memory', label: 'Memory', icon: Database },
];

export default function ContextLearningSection() {
  const [tab, setTab] = useState<Tab>('evolution');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [weekdayGroup, setWeekdayGroup] = useState<string | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [drift, setDrift] = useState<ContextDriftResp | null>(null);
  const [trend, setTrend] = useState<ContextTrendResp | null>(null);
  const [similarity, setSimilarity] = useState<ContextFeature[]>([]);
  const [memory, setMemory] = useState<Snapshot[]>([]);
  const [recos, setRecos] = useState<RecoOutcomeRow[]>([]);
  const [learning, setLearning] = useState<ContextLearningResp | null>(null);
  const [busy, setBusy] = useState(false);

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
      const [de, dr, tr, sim, mem, rc, lr] = await Promise.all([
        fetchContextDetail(storeType, daypart, weekdayGroup, range, 20).catch(() => null),
        fetchContextDrift(storeType, daypart, weekdayGroup, range).catch(() => null),
        fetchContextTrend(storeType, daypart, weekdayGroup, range === '7d' ? '30d' : range).catch(() => null),
        fetchContextSimilarity(range, 20, 50).catch(() => ({ items: [] as ContextFeature[] })),
        fetchContextMemory(contextKey || storeType, 100).catch(() => [] as Snapshot[]),
        fetchContextRecos(contextKey || storeType, null, 100).catch(() => [] as RecoOutcomeRow[]),
        fetchContextLearning(contextKey || storeType).catch(() => null),
      ]);
      setDetail(de); setDrift(dr); setTrend(tr); setSimilarity(sim.items ?? []); setMemory(mem); setRecos(rc); setLearning(lr);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, [storeType, daypart, weekdayGroup, range, contextKey]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const d = useMemo(() => (detail ? (detail as ContextDetail) : null), [detail]);
  const health = useMemo(() => (d ? computeContextHealth(d.summary) : null), [d]);
  const score = useMemo(() => (d ? computeContextScore(d.summary) : null), [d]);
  const driftResult = useMemo(() => (drift?.recent && drift?.prior ? computeDrift(drift.prior, drift.recent) : null), [drift]);
  const stability = useMemo(() => computeStability((trend?.series ?? []).map((p) => p.completion_rate)), [trend]);
  const similar = useMemo(() => {
    if (!storeType) return [];
    const target = similarity.find((s) => s.store_type === storeType);
    return target ? rankSimilar(target, similarity) : [];
  }, [similarity, storeType]);
  const fallbackChain = useMemo(() => smartFallbackChain(contextKey || (storeType ?? ''), storeType ?? '', similar, `store_type=${storeType ?? ''}`), [contextKey, storeType, similar]);
  const successStats = useMemo(() => computeSuccessRate(recos), [recos]);
  const calibration = useMemo(() => calibrateConfidence(score?.confidence ?? learningConfidence(d?.summary.events ?? 0), successStats), [score, successStats, d]);
  const evolution = useMemo(() => buildEvolution(memory), [memory]);
  const liveRecos = useMemo(() => (d && learningAllowed(d.summary.events) ? recommendContext(d) : []), [d]);
  const timeline = useMemo<TimelineEntry[]>(() => {
    const items: TimelineEntry[] = [];
    for (const r of recos) items.push({ at: (r as unknown as { created_at?: string }).created_at ?? '', kind: 'recommendation', title: `${RECO_LABEL[r.reco_type as keyof typeof RECO_LABEL] ?? r.reco_type} · ${RECO_STATUS_LABEL[r.status]}`, detail: r.title ?? undefined });
    for (const s of memory) items.push({ at: s.created_at, kind: 'snapshot', title: `Snapshot Health ${s.health_score ?? '—'} · Drift ${s.drift_score ?? '—'}` });
    if (drift?.generated_at && driftResult) items.push({ at: drift.generated_at, kind: 'drift', title: `Drift ${driftResult.score ?? '—'} (${DRIFT_STATUS_LABEL[driftResult.status]})` });
    return mergeTimeline(items);
  }, [recos, memory, drift, driftResult]);

  const saveSnapshot = async () => {
    if (!d || !health || !score) return;
    setBusy(true);
    try {
      await saveContextSnapshot({
        context_key: contextKey || storeType, dimensions: { store_type: storeType, daypart, weekday_group: weekdayGroup },
        period_start: drift?.prior_window?.from ?? null, period_end: drift?.recent_window?.to ?? null,
        sample_size: d.summary.events, health_score: health.score, score: score.score, confidence: score.confidence,
        drift_score: driftResult?.score ?? null, reco_count: liveRecos.length, success_rate: successStats.successRate,
        support_status: health.status,
      });
      toast.success('Context Snapshot 저장됨(Memory)');
      const mem = await fetchContextMemory(contextKey || (storeType ?? ''), 100); setMemory(mem);
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const logReco = async (type: string, title: string, evidence: { label: string; value: string | number | null }[]) => {
    setBusy(true);
    try {
      await saveContextReco({
        context_key: contextKey || storeType, dimensions: { store_type: storeType, daypart, weekday_group: weekdayGroup },
        reco_type: type, title, evidence,
        before_kpi: { completion_rate: d?.summary.completion_rate ?? null, skip_rate: d?.summary.skip_rate ?? null },
      });
      toast.success('추천 기록됨(Outcome 추적 시작)');
      setRecos(await fetchContextRecos(contextKey || (storeType ?? ''), null, 100));
      setLearning(await fetchContextLearning(contextKey || (storeType ?? '')));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const resolveReco = async (id: string, status: string, outcome: RecoOutcome | null) => {
    setBusy(true);
    try {
      await resolveContextReco(id, status, outcome, outcome ? { completion_rate: d?.summary.completion_rate ?? null, skip_rate: d?.summary.skip_rate ?? null } : null);
      toast.success('추천 상태 갱신됨');
      setRecos(await fetchContextRecos(contextKey || (storeType ?? ''), null, 100));
      setLearning(await fetchContextLearning(contextKey || (storeType ?? '')));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="Context Evolution & Learning"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Context Evolution & Learning">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void loadOverview()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const insufficientDrift = !driftResult || driftResult.status === 'insufficient_data';

  return (
    <AdminCard
      title="Context Evolution & Learning"
      subtitle="Context 시간 진화(Drift/Stability/Decay) + Recommendation Learning · Signal/분석 전용(자동 반영 없음)"
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

      {/* ── Evolution ── */}
      {tab === 'evolution' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Evolution = Memory Snapshot 시계열 + 현재 Drift"
            description="Snapshot 을 저장할수록 Health/Drift 진화를 추적합니다(Memory 탭에서 저장). 별도 admin_context_evolution RPC 없이 Memory+Drift+Trend 재사용." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="현재 Health" value={health ? `${health.score}` : '—'} />
            <Kpi label="현재 Score/Conf" value={score ? `${score.score}/${score.confidence}` : '—'} />
            <Kpi label="현재 Drift" value={driftResult?.score != null ? `${driftResult.score}` : '데이터 부족'} badge={driftResult ? <AdminBadge tone={DRIFT_STATUS_TONE[driftResult.status]}>{DRIFT_STATUS_LABEL[driftResult.status]}</AdminBadge> : null} />
            <Kpi label="Health 추세(Memory)" value={evolution.healthTrend === 'insufficient_data' ? '데이터 부족' : evolution.healthTrend} />
          </div>
          {evolution.points.length === 0 ? <AdminEmpty icon={<LineChart size={20} />} title="Snapshot 없음" description="Memory 탭에서 현재 Context Snapshot 을 저장하면 진화 추적이 시작됩니다." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">시각</th><th className="px-2">Health</th><th className="px-2">ΔHealth</th><th className="px-2">Score</th><th className="px-2">Drift</th><th className="px-2">ΔDrift</th><th className="px-2">표본</th></tr></thead>
                <tbody>
                  {evolution.points.map((p, i) => (
                    <tr key={p.id ?? i} className="border-b border-border/50">
                      <td className="py-1.5 pr-2">{p.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-2 font-bold">{NUM(p.health_score)}</td>
                      <td className="px-2">{p.healthDelta == null ? '—' : (p.healthDelta > 0 ? `+${p.healthDelta}` : p.healthDelta)}</td>
                      <td className="px-2">{NUM(p.score)}</td><td className="px-2">{NUM(p.drift_score)}</td>
                      <td className="px-2">{p.driftDelta == null ? '—' : (p.driftDelta > 0 ? `+${p.driftDelta}` : p.driftDelta)}</td>
                      <td className="px-2">{NUM(p.sample_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Drift ── */}
      {tab === 'drift' && (
        <div className="space-y-3">
          {insufficientDrift ? (
            <AdminAlert tone="warning" title="Drift 계산 불가(표본 부족)"
              description={`두 기간 각각 최소 20 이벤트가 필요합니다. prior=${NUM(drift?.prior?.events)} / recent=${NUM(drift?.recent?.events)}. 데이터 축적 후 재분석.`} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Kpi label="Drift Score" value={`${driftResult!.score}`} badge={<AdminBadge tone={DRIFT_STATUS_TONE[driftResult!.status]}>{DRIFT_STATUS_LABEL[driftResult!.status]}</AdminBadge>} />
                <Kpi label="장르 분포 거리" value={`${driftResult!.genreDistance}`} />
                <Kpi label="완주율 Δ" value={driftResult!.completionDelta == null ? '—' : `${driftResult!.completionDelta}pp`} />
                <Kpi label="Skip Δ" value={driftResult!.skipDelta == null ? '—' : `${driftResult!.skipDelta}pp`} />
              </div>
              <AdminCard title="주요 장르 변화 (prior → recent)">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">장르</th><th className="px-2">이전 %</th><th className="px-2">현재 %</th><th className="px-2">Δ</th></tr></thead>
                  <tbody>
                    {driftResult!.topShifts.map((s) => (
                      <tr key={s.key} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{s.key}</td><td className="px-2">{s.prior}</td><td className="px-2">{s.recent}</td>
                        <td className={`px-2 font-bold ${s.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : s.delta < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>{s.delta > 0 ? `+${s.delta}` : s.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pt-1 text-[10px] text-muted-foreground">기간: 이전 {drift?.prior_window?.from?.slice(0, 10)} ~ {drift?.prior_window?.to?.slice(0, 10)} · 현재 {drift?.recent_window?.from?.slice(0, 10)} ~ {drift?.recent_window?.to?.slice(0, 10)}</p>
              </AdminCard>
            </>
          )}
        </div>
      )}

      {/* ── Stability ── */}
      {tab === 'stability' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Stability = 완주율 시계열 변동(Confidence 보정)"
            description="변동이 심하면 Confidence 를 하향합니다. 기존 Confidence 정의는 유지하고 Stability Factor 를 곱합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Stability" value={stability.cv == null ? '데이터 부족' : STABILITY_LABEL[stability.level]} badge={<AdminBadge tone={STABILITY_TONE[stability.level]}>{stability.level}</AdminBadge>} />
            <Kpi label="변동계수(CV)" value={stability.cv == null ? '—' : `${stability.cv}`} />
            <Kpi label="Stability Factor" value={`${stability.factor}`} />
            <Kpi label="보정 Confidence" value={score ? `${score.confidence} → ${applyStability(score.confidence, stability.factor)}` : '—'} />
          </div>
          <p className="text-[11px] text-muted-foreground">기준: 완주율 {trend ? `${trend.series.length}개 ${trend.bucket} bucket` : '데이터 없음'}. 포인트 부족 시 중립(factor 0.5).</p>
        </div>
      )}

      {/* ── Similar Context ── */}
      {tab === 'similar' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="유사 Context = 장르 분포 cosine + KPI 근접도"
            description="지원 Dimension(Store Type)만 사용합니다. Smart Fallback 은 유사 Context → 상위 Grain 순서로 이유(Evidence)와 함께 제안합니다." />
          {!similar.length ? <AdminEmpty icon={<Share2 size={20} />} title="유사 Context 없음" description="비교 가능한(표본 충족) Store Type 이 부족합니다." /> : (
            <AdminCard title={`유사 Context — 기준 ${storeType}`}>
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Store Type</th><th className="px-2">유사도</th><th className="px-2">장르 cosine</th><th className="px-2">KPI 근접</th><th className="px-2">표본</th></tr></thead>
                <tbody>
                  {similar.map((s) => (
                    <tr key={s.store_type} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-bold">{s.store_type}</td>
                      <td className="px-2"><AdminBadge tone={s.similarity >= 0.75 ? 'success' : s.similarity >= 0.5 ? 'warning' : 'neutral'}>{s.similarity}</AdminBadge></td>
                      <td className="px-2">{s.genreCosine}</td><td className="px-2">{s.kpiCloseness}</td><td className="px-2">{NUM(s.events)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminCard>
          )}
          <AdminCard title="Smart Fallback 체인">
            <ol className="space-y-1 text-[11px]">
              {fallbackChain.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <AdminBadge tone={f.type === 'self' ? 'info' : f.type === 'similar' ? 'success' : 'neutral'}>{f.type}</AdminBadge>
                  <code className="rounded bg-muted px-1.5 py-0.5">{f.context_key}</code>
                  <span className="text-muted-foreground">— {f.reason}</span>
                </li>
              ))}
            </ol>
          </AdminCard>
        </div>
      )}

      {/* ── Recommendation Outcomes ── */}
      {tab === 'outcomes' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Recommendation Outcome (운영자 수동 · 자동 적용 금지)"
            description="추천을 기록하면 적용/기각과 이후 KPI 개선 여부를 추적합니다. 성공률로 Recommendation 신뢰도를 보정합니다(AI 자신감 아님)." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="기록/적용/기각" value={`${successStats.total}/${successStats.applied}/${successStats.dismissed}`} />
            <Kpi label="개선/중립/악화" value={`${successStats.improved}/${successStats.neutral}/${successStats.degraded}`} />
            <Kpi label="성공률" value={successStats.successRate == null ? '데이터 부족' : `${successStats.successRate}%`} />
            <Kpi label="보정 신뢰도" value={`${calibration.calibrated}`} badge={<span className="text-[9px] text-muted-foreground">{calibration.basis}</span>} />
          </div>

          {/* 현재 Context 라이브 추천 → 기록 */}
          {liveRecos.length > 0 && (
            <AdminCard title="현재 Context 추천 (기록하여 추적 시작)">
              {liveRecos.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5">
                  <span className="flex items-center gap-1.5 text-[11px]"><AdminBadge tone="info">{RECO_LABEL[r.type]}</AdminBadge><span className="font-semibold">{r.title}</span></span>
                  <button disabled={busy} onClick={() => void logReco(r.type, r.title, r.evidence)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기록</button>
                </div>
              ))}
            </AdminCard>
          )}

          {/* 기록된 Outcome */}
          {!recos.length ? <AdminEmpty icon={<ClipboardCheck size={20} />} title="기록된 추천 없음" description="위 라이브 추천을 기록하면 여기서 적용/기각·Outcome 을 관리합니다." /> : (
            <div className="space-y-2">
              {recos.map((r) => {
                const created = (r as unknown as { created_at?: string }).created_at;
                return (
                  <div key={r.id} className="rounded-lg border border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AdminBadge tone={RECO_STATUS_TONE[r.status]}>{RECO_STATUS_LABEL[r.status]}</AdminBadge>
                      <AdminBadge tone="info">{RECO_LABEL[r.reco_type as keyof typeof RECO_LABEL] ?? r.reco_type}</AdminBadge>
                      {r.outcome && <AdminBadge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</AdminBadge>}
                      <span className="text-xs font-bold">{r.title}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{created?.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    {r.status === 'active' && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button disabled={busy} onClick={() => void resolveReco(r.id, 'applied', null)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">적용</button>
                        <button disabled={busy} onClick={() => void resolveReco(r.id, 'dismissed', null)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                      </div>
                    )}
                    {(r.status === 'applied' || r.status === 'resolved') && !r.outcome && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">Outcome(현재 KPI 기준):</span>
                        {(['improved', 'neutral', 'degraded'] as RecoOutcome[]).map((o) => (
                          <button key={o} disabled={busy} onClick={() => void resolveReco(r.id, 'resolved', o)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{OUTCOME_LABEL[o]}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Learning 집계 */}
          {learning && learning.by_type.length > 0 && (
            <AdminCard title="Type별 Learning">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Type</th><th className="px-2">기록</th><th className="px-2">적용</th><th className="px-2">기각</th><th className="px-2">개선</th><th className="px-2">악화</th></tr></thead>
                <tbody>
                  {learning.by_type.map((t) => (
                    <tr key={t.reco_type} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-semibold">{RECO_LABEL[t.reco_type as keyof typeof RECO_LABEL] ?? t.reco_type}</td>
                      <td className="px-2">{t.total}</td><td className="px-2">{t.applied}</td><td className="px-2">{t.dismissed}</td><td className="px-2">{t.improved}</td><td className="px-2">{t.degraded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Learning Timeline ── */}
      {tab === 'timeline' && (
        <div className="space-y-3">
          {!timeline.length ? <AdminEmpty icon={<History size={20} />} title="Timeline 없음" description="추천 기록·Snapshot·Drift 가 쌓이면 시간순으로 표시됩니다." /> : (
            <ol className="space-y-1.5">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="neutral">{TIMELINE_KIND_LABEL[e.kind]}</AdminBadge>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{e.title}</p>
                    {e.detail && <p className="text-muted-foreground">{e.detail}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{e.at.slice(0, 16).replace('T', ' ')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── Memory ── */}
      {tab === 'memory' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Context Memory (Snapshot 저장소)"
            description="현재 Context 의 Health/Score/Confidence/Drift/추천수/성공률을 Snapshot 으로 남겨 진화를 추적합니다. 자동 반영 없음(Learning Signal)." />
          <div className="flex items-center gap-2">
            <button disabled={busy || !d} onClick={() => void saveSnapshot()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Save size={12} /> 현재 Context Snapshot 저장</button>
            {d && <span className="text-[10px] text-muted-foreground">표본 {NUM(d.summary.events)} <AdminBadge tone={SAMPLE_TIER_TONE[sampleTier(d.summary.events)]}>{SAMPLE_TIER_LABEL[sampleTier(d.summary.events)]}</AdminBadge></span>}
          </div>
          {!memory.length ? <AdminEmpty icon={<Database size={20} />} title="Snapshot 없음" description="위 버튼으로 저장하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">시각</th><th className="px-2">Health</th><th className="px-2">Score</th><th className="px-2">Conf</th><th className="px-2">Drift</th><th className="px-2">추천수</th><th className="px-2">성공률</th><th className="px-2">표본</th></tr></thead>
                <tbody>
                  {memory.map((s, i) => (
                    <tr key={s.id ?? i} className="border-b border-border/50">
                      <td className="py-1.5 pr-2">{s.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-2 font-bold">{NUM(s.health_score)}</td><td className="px-2">{NUM(s.score)}</td><td className="px-2">{NUM(s.confidence)}</td>
                      <td className="px-2">{NUM(s.drift_score)}</td><td className="px-2">{NUM(s.reco_count)}</td><td className="px-2">{s.success_rate == null ? '—' : `${s.success_rate}%`}</td><td className="px-2">{NUM(s.sample_size)}</td>
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

function Kpi({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black">{value}{badge}</p>
    </div>
  );
}
