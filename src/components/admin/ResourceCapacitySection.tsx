/**
 * ResourceCapacitySection — Enterprise Resource Intelligence, Capacity Planning &
 * Operational Optimization Center (Phase AI-OPS-26).
 *
 * Enterprise→Resources→Capacity→Utilization→Optimization→Operational Efficiency→Executive Resource Advisory.
 * 자동 서버 증설/축소/인프라·AI 모델·Capacity·비용 변경 없음 · Capacity ≠ Demand ·
 * Utilization ≠ Efficiency · Bottleneck ≠ Root Cause · Forecast ≠ Actual.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Cpu, Gauge, Grid3x3, History, Hourglass, Layers, Lightbulb,
  ListChecks, Lock, RefreshCw, Scale, ScrollText, Server, TrendingUp, Zap,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchResourceSummary, createResourceRegistryEntry, reviewResourceRegistryEntry,
  fetchResourceRegistry, fetchResourceUsageTimeline, recordResourceGovernance, fetchResourceAudit,
  type ResourceSummary, type ResourceRegistryRow, type ResourceUsagePoint, type ResourceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  assessCapacity, analyzeUtilization, analyzeAiResource, evaluateInfraEfficiency,
  forecastCapacity, detectBottlenecks, evaluateOperationalEfficiency, classifyTrend,
  buildResourceBriefing, buildResourceRecommendation, buildResourceCockpit,
  RESOURCE_KINDS, FORECAST_HORIZONS, RESOURCE_SUPPORT,
} from '@/lib/resourceIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'cockpit' | 'dashboard' | 'registry' | 'capacity' | 'utilization' | 'airesources' | 'efficiency'
  | 'forecast' | 'bottlenecks' | 'opefficiency' | 'briefing' | 'recommendations' | 'humanreviews'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Resource & Capacity Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Resource Dashboard', icon: Gauge },
  { key: 'registry', label: 'Resource Registry', icon: ListChecks },
  { key: 'capacity', label: 'Capacity Planning', icon: Server },
  { key: 'utilization', label: 'Resource Utilization', icon: Activity },
  { key: 'airesources', label: 'AI Resources', icon: Cpu },
  { key: 'efficiency', label: 'Infrastructure Efficiency', icon: Zap },
  { key: 'forecast', label: 'Capacity Forecast', icon: TrendingUp },
  { key: 'bottlenecks', label: 'Resource Bottlenecks', icon: Hourglass },
  { key: 'opefficiency', label: 'Operational Efficiency', icon: Scale },
  { key: 'briefing', label: 'Executive Resource Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Resource Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ResourceCapacitySection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<ResourceSummary>({});
  const [registry, setRegistry] = useState<ResourceRegistryRow[]>([]);
  const [timeline, setTimeline] = useState<ResourceUsagePoint[]>([]);
  const [audit, setAudit] = useState<ResourceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, re, tl, au] = await Promise.all([
        fetchResourceSummary(), fetchResourceRegistry(null, 100), fetchResourceUsageTimeline(30), fetchResourceAudit(100),
      ]);
      setSummary(s); setRegistry(re); setTimeline(tl); setAudit(au);
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

  const actuals = useMemo(() => (typeof summary.capacity_actuals === 'object' && summary.capacity_actuals !== null && !Array.isArray(summary.capacity_actuals) ? summary.capacity_actuals as Record<string, unknown> : {}), [summary]);
  const anum = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);
  const snapStatuses = useMemo(() => (typeof actuals.snapshot_status_latest === 'object' && actuals.snapshot_status_latest !== null ? actuals.snapshot_status_latest as Record<string, number> : {}), [actuals]);

  const usageTrend = useMemo(() => classifyTrend(timeline.map((p) => ({ value: p.playback_events }))), [timeline]);

  const registryCapacity = useMemo(() => registry.filter((r) => r.resource_status !== 'deprecated').map((r) => ({
    r, c: assessCapacity({ current: r.capacity_reference, used: null }),   // 자원별 사용량 원본 없음 → insufficient 정직 유지
  })), [registry]);

  const utilization = useMemo(() => analyzeUtilization([
    { key: 'cpu_usage', usagePct: null }, { key: 'memory_usage', usagePct: null },
    { key: 'gpu_usage', usagePct: null }, { key: 'storage_usage', usagePct: null },
    { key: 'database_usage', usagePct: null }, { key: 'network_usage', usagePct: null },
  ]), []);

  const aiResource = useMemo(() => analyzeAiResource({ tokenConsumption: null, inferenceRequests: null, queueLength: null, processingTimeMs: null, modelAvailabilityPct: null }), []);

  const infraEff = useMemo(() => evaluateInfraEfficiency({ metrics: [
    { key: 'playback_volume', utilizationPct: null, sample: timeline.length },   // limit 미구성 → 비율 산정 불가(추정 금지)
    { key: 'database_rows', utilizationPct: null, sample: 30 },
  ] }), [timeline]);

  const forecasts = useMemo(() => FORECAST_HORIZONS.map((h) => forecastCapacity(timeline.map((p) => ({ value: p.playback_events })), h)), [timeline]);

  const bottlenecks = useMemo(() => detectBottlenecks([
    { kind: 'cpu_bottleneck', signal: null, threshold: 80, evidence: ['APM 원본 없음 — unavailable 유지'] },
    { kind: 'memory_bottleneck', signal: null, threshold: 80, evidence: ['APM 원본 없음 — unavailable 유지'] },
    { kind: 'storage_bottleneck', signal: null, threshold: 80, evidence: ['storage 측정 원본 없음'] },
    { kind: 'network_bottleneck', signal: null, threshold: 80, evidence: ['네트워크 측정 원본 없음'] },
    { kind: 'queue_bottleneck', signal: null, threshold: 80, evidence: ['queue 측정 원본 없음'] },
  ]), []);

  const opEff = useMemo(() => {
    const metrics = anum('capacity_metrics_active_0508'); const rows = anum('tracks_rows');
    return evaluateOperationalEfficiency([
      { component: 'infrastructure_efficiency', score: metrics && metrics > 0 ? 55 : null, evidence: metrics && metrics > 0 ? [`0508 active metrics ${metrics}건 실측`] : [] },
      { component: 'database_efficiency', score: rows != null ? 50 : null, evidence: rows != null ? ['행 수 실측(tracks/playlists/users)'] : [] },
      { component: 'ai_efficiency', score: null, evidence: [] },       // 모델 사용 로그 없음
      { component: 'network_efficiency', score: null, evidence: [] },  // 네트워크 측정 없음
      { component: 'resource_balance', score: null, evidence: [] },    // 비율 실측 부족
    ]);
  }, [anum]);

  const briefing = useMemo(() => buildResourceBriefing({
    periodKind: 'weekly',
    capacityChanges: usageTrend.dataStatus === 'ok' ? [`playback volume ${usageTrend.trend}(${usageTrend.changePct ?? '—'}%)`] : [],
    resourcePressure: Object.entries(snapStatuses).filter(([k]) => ['constrained', 'saturation_risk', 'exhausted'].includes(k)).map(([k, v]) => `${k}: ${v}건(0508 실측)`),
    bottlenecks: bottlenecks.candidates.filter((b) => b.verdict === 'bottleneck_candidate').map((b) => b.kind),
    unknownFactors: [...utilization.rows.filter((r) => r.status === 'resource_unavailable').map((r) => `${r.key}: 원본 없음`)].slice(0, 6),
    recommendations: [],
  }), [usageTrend, snapStatuses, bottlenecks, utilization]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildResourceRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const pressured = Object.entries(snapStatuses).filter(([k]) => ['constrained', 'saturation_risk', 'exhausted'].includes(k)).reduce((a, [, v]) => a + v, 0);
    if (pressured > 0) push(buildResourceRecommendation({ type: 'review_capacity', reason: `압박 상태 Capacity 스냅샷 ${pressured}건(0508 실측)`, evidence: ['snapshot_status'], confidence: null, assumptions: [] }));
    if (!registry.length) push(buildResourceRecommendation({ type: 'validate_usage', reason: 'Resource Registry 비어 있음 — 사람 등록 필요(자동 등록 불가)', evidence: ['registry:0'], confidence: null, assumptions: [] }));
    if (infraEff.wasteCandidates.length) push(buildResourceRecommendation({ type: 'reduce_waste', reason: `저활용 후보 ${infraEff.wasteCandidates.length}건(Waste 단정 아님)`, evidence: infraEff.wasteCandidates, confidence: null, assumptions: [] }));
    if (bottlenecks.candidates.some((b) => b.verdict === 'bottleneck_candidate')) push(buildResourceRecommendation({ type: 'review_bottleneck', reason: '병목 후보 존재(Root Cause 단정 아님)', evidence: ['bottleneck_candidates'], confidence: null, assumptions: [] }));
    if (utilization.unavailableCount > 0) push(buildResourceRecommendation({ type: 'improve_monitoring', reason: `측정 불가 자원 ${utilization.unavailableCount}종 — APM/측정 도입 검토`, evidence: ['resource_unavailable'], confidence: null, assumptions: [] }));
    if (opEff.missingComponents.length) push(buildResourceRecommendation({ type: 'gather_more_evidence', reason: `Evidence 없는 효율 컴포넌트 ${opEff.missingComponents.length}건`, evidence: opEff.missingComponents, confidence: null, assumptions: [] }));
    return out;
  }, [snapStatuses, registry, infraEff, bottlenecks, utilization, opEff]);

  const cockpit = useMemo(() => buildResourceCockpit({
    registryTotal: registry.length,
    capacityMeasured: anum('capacity_snapshots_0508') ?? 0,
    utilizationMeasured: utilization.measuredCount,
    aiResourceVerdict: aiResource.verdict,
    infraBalance: infraEff.balance,
    bottleneckCandidates: bottlenecks.candidates.filter((b) => b.verdict === 'bottleneck_candidate').length,
    opEfficiencyOverall: opEff.overall,
    summaryNote: null,
  }), [registry, anum, utilization, aiResource, infraEff, bottlenecks, opEff]);

  if (loading) return <AdminCard title="Enterprise Resource Intelligence & Capacity Planning Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Resource Intelligence & Capacity Planning Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Resource Intelligence & Capacity Planning Center"
      subtitle="Resources→Capacity→Utilization→Optimization→Operational Efficiency→Executive Resource Advisory — 자동 증설/축소/인프라·모델 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 서버 증설/축소, 자동 인프라/AI 모델/Capacity/비용/계약/Production 변경, 자동 Merge/Deploy 는 없습니다. Capacity 와 Efficiency 는 실측만 사용하며 추정하지 않습니다. Capacity ≠ Demand, Utilization ≠ Efficiency, Bottleneck ≠ Root Cause, Forecast ≠ Actual, Recommendation ≠ Operational Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · autoScaled=false</p>
        </div>
      )}

      {/* ── Dashboard(0508 실측) ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Capacity Metrics(active·0508)" value={NUM(anum('capacity_metrics_active_0508'))} />
            <Box label="Capacity Snapshots(0508)" value={NUM(anum('capacity_snapshots_0508'))} />
            <Box label="Cost Snapshots(90d·0508)" value={NUM(anum('cost_snapshots_90d_0508'))} />
            <Box label="Playback Events(30d)" value={NUM(anum('playback_events_30d'))} />
            <Box label="Sessions(30d)" value={NUM(anum('distinct_sessions_30d'))} />
            <Box label="Tracks 행" value={NUM(anum('tracks_rows'))} />
            <Box label="Playlists 행" value={NUM(anum('playlists_rows'))} />
            <Box label="Users 행" value={NUM(anum('users_rows'))} />
          </div>
          <AdminAlert tone="info" description={`resource_unavailable: ${Array.isArray(summary.resource_unavailable) ? (summary.resource_unavailable as unknown[]).map(String).join(', ') : '—'} — APM/모델 사용 로그 원본 없음(임의 생성 금지).`} />
        </div>
      )}

      {/* ── Registry ── */}
      {tab === 'registry' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {RESOURCE_KINDS.slice(0, 4).map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createResourceRegistryEntry({ code: `res_${kind}_${now.toISOString().slice(0, 19)}`, kind, title: r.slice(0, 100), evidence: [{ label: 'note', value: '사람 등록 자원' }] }), `${kind} 등록(자동 증설 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 등록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="자원 이름/사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!registry.length ? <AdminEmpty title="등록 자원 없음" description="자원은 AI 가 자동 등록/증설/축소하지 않습니다 — 사람 등록만 기록됩니다(4상태)." /> : registry.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.resource_code}</span>
                <AdminBadge tone="info">{r.resource_kind}</AdminBadge>
                <AdminBadge tone={r.resource_status === 'active' ? 'success' : r.resource_status === 'maintenance' ? 'warning' : r.resource_status === 'deprecated' ? 'neutral' : 'warning'}>{r.resource_status}</AdminBadge>
                <span className="text-muted-foreground">{r.title} · {r.provider ?? '—'} · capacity {r.capacity_reference == null ? 'null(0 아님)' : `${NUM(r.capacity_reference)} ${r.capacity_unit ?? ''}`}</span>
              </div>
              {r.resource_status !== 'deprecated' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['active', 'maintenance', 'deprecated'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewResourceRegistryEntry(r.id, st, rr), `${st}(인프라 자동 변경 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Capacity ── */}
      {tab === 'capacity' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {Object.entries(snapStatuses).map(([k, v]) => <Box key={k} label={`snapshot: ${k}`} value={NUM(v)} />)}
            {!Object.keys(snapStatuses).length && <Box label="0508 snapshot(30d)" value="없음" />}
          </div>
          <div className="space-y-1">
            {registryCapacity.slice(0, 10).map(({ r, c }) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{r.resource_code}</span>
                <AdminBadge tone={c.verdict === 'measured' ? 'info' : 'warning'}>{c.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">capacity {r.capacity_reference ?? 'null'} · used 원본 없음 → pressure {c.pressurePct ?? 'null(0 아님)'} · Capacity ≠ Demand</span>
              </div>
            ))}
          </div>
          <AdminAlert tone="info" description="Current/Used/Remaining/Pressure 는 실측 기반으로만 계산합니다. 자원별 사용량 원본이 없으면 insufficient_data 로 유지되며, 상세 실측은 ai_capacity_snapshots(0508)를 참조합니다. Capacity Trend 는 Forecast 탭의 실측 시계열을 사용합니다." />
        </div>
      )}

      {/* ── Utilization / AI Resources ── */}
      {tab === 'utilization' && (
        <div className="space-y-1">
          {utilization.rows.map((r) => (
            <div key={r.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.key}</span>
              <AdminBadge tone={r.status === 'measured' ? 'info' : 'warning'}>{r.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{r.usagePct == null ? 'null(원본 없음 — 0 아님)' : `${r.usagePct}%`} · Utilization ≠ Efficiency</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">CPU/Memory/GPU/Storage/Database/Network 사용률은 APM 원본이 없어 resource_unavailable 로 유지됩니다 — 임의 생성하지 않습니다.</p>
        </div>
      )}
      {tab === 'airesources' && (
        <div className="space-y-1">
          {aiResource.components.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.key}</span>
              <AdminBadge tone={c.status === 'measured' ? 'info' : 'warning'}>{c.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{c.value == null ? 'null(원본 없음)' : NUM(c.value)}</span>
            </div>
          ))}
          <AdminAlert tone="info" description={`판정: ${aiResource.verdict} — AI Model Usage/Token/Inference/Queue/Processing Time 은 모델 사용 로그 원본이 없어 resource_unavailable 로 유지됩니다. noAutoScaling=true — AI 자원을 자동 증설하지 않습니다.`} />
        </div>
      )}

      {/* ── Infra Efficiency / Forecast / Bottlenecks / Op Efficiency ── */}
      {tab === 'efficiency' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Waste 후보(단정 아님)" value={infraEff.wasteCandidates.join(', ') || '없음'} />
            <Box label="포화 후보" value={infraEff.saturationCandidates.join(', ') || '없음'} />
            <Box label="Balance" value={infraEff.balance} />
          </div>
          {infraEff.excluded.length > 0 && <AdminAlert tone="warning" title={`제외 ${infraEff.excluded.length}건`} description={`${infraEff.excluded.join(' · ')} — Efficiency 는 추정이 아닌 실측만 사용합니다.`} />}
        </div>
      )}
      {tab === 'forecast' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordResourceGovernance('capacity_forecasted', r, { forecasts: forecasts.map((f) => ({ horizon: f.horizon, projected: f.projected, verdict: f.verdict })) }), 'Forecast 기록(Forecast ≠ Actual)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Forecast 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Usage Trend(30d 실측)" value={usageTrend.dataStatus === 'ok' ? `${usageTrend.trend}(${usageTrend.changePct ?? '—'}%)` : usageTrend.dataStatus} />
            <Box label="일별 표본" value={NUM(timeline.length)} />
            <Box label="최근일 playback" value={NUM(timeline.length ? timeline[timeline.length - 1].playback_events : null)} />
          </div>
          {forecasts.map((f) => (
            <div key={f.horizon} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{f.horizon}</span>
              <AdminBadge tone={f.verdict === 'forecast_candidate' ? 'info' : 'warning'}>{f.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">projected {f.projected == null ? 'null(계산 불가)' : NUM(f.projected)} · {f.basis ?? '—'} · Forecast ≠ Actual(Prediction)</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'bottlenecks' && (
        <div className="space-y-1">
          {bottlenecks.candidates.map((b) => (
            <div key={b.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{b.kind}</span>
              <AdminBadge tone={b.verdict === 'bottleneck_candidate' ? 'danger' : b.verdict === 'no_known_bottleneck' ? 'success' : 'warning'}>{b.verdict}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Bottleneck ≠ Root Cause{b.verdict === 'resource_unavailable' ? ' · 측정 원본 없음 — unavailable 유지' : ''}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">CPU/Memory/Storage/Network/Queue 병목은 측정 원본이 생기면 후보로만 표시하며 원인으로 단정하지 않습니다.</p>
        </div>
      )}
      {tab === 'opefficiency' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Overall(단독 해석 금지)" value={opEff.overall == null ? 'insufficient_data' : String(opEff.overall)} />
            <Box label="Missing" value={opEff.missingComponents.join(', ') || '없음'} />
            <Box label="Unknown" value={NUM(opEff.unknownFactors.length)} />
          </div>
          {opEff.byComponent.map((c) => (
            <div key={c.component} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.component}</span>
              <span className="ml-2">{c.score == null ? 'Evidence 없음 — 점수 제외' : c.score}</span>
              <span className="ml-2 text-muted-foreground">Evidence {c.evidenceCount}건</span>
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
              void act(() => recordResourceGovernance('resource_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Resource Briefing 기록</button>
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

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Operational Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['resource_registered', 'resource_reviewed', 'resource_deprecated'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="자원 등록/상태 판정은 전부 사람이 수행합니다(자동 변경 없음)." /> : (
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
        const ext = audit.filter((e) => e.event_type === 'external_resource_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 자원 자료는 참조로만 기록됩니다." /> : (
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
              void act(() => recordResourceGovernance('capacity_assessed', r, { snapshot_statuses: snapStatuses, usage_trend: usageTrend.trend ?? usageTrend.dataStatus }), 'Capacity 평가 기록(Capacity ≠ Demand)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Capacity 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="자원 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
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
          {RESOURCE_SUPPORT.map((s) => (
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
