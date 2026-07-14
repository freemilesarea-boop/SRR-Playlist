/**
 * FleetIntelligenceSection — Enterprise Fleet Intelligence & Cross-Enterprise Benchmarking (Phase AI-MUSIC-13).
 *
 * Store → Fleet → Region → Enterprise → Industry → Global 계층 읽기 전용 집계 분석.
 * Cross-Enterprise 는 익명 집계만(원본 franchise 이름/ID 미노출). Best Practice/Opportunity/
 * Recommendation 은 Governance Review 대상 Evidence 후보 — 자동 Apply/Publish/Rollout/
 * Scheduler/Queue/Playback 변경 없음.
 *
 * 탭: Fleet Overview · Enterprise · Brand · Region · Industry · Benchmark · Best Practices ·
 *     Opportunity · Fleet Health · Growth · Recommendations · Governance Evidence · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Globe2, Building2, Tag, MapPin, Factory, BarChart3, Award, Lightbulb, HeartPulse,
  TrendingUp, ClipboardList, ShieldCheck, Grid3x3, Lock, RefreshCw,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchFleetSummary, fetchFleetHealth, fetchEnterpriseBenchmark, fetchRegionBenchmark,
  fetchFleetGrowth, fetchFleetOpportunityScan, fetchBestPractices, saveBestPractice,
  fetchFleetOpportunities, saveFleetOpportunity, fetchContextOverview, fetchGovernanceSummary,
  type FleetSummaryResp, type FleetHealthResp, type EnterpriseBenchmarkRow, type RegionBenchmarkRow,
  type FleetGrowthRow, type FleetScanResp, type BestPracticeRow, type FleetOpportunityRow,
  type ContextOverview, type GovernanceSummaryResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  FLEET_SOURCE_VERSION, FLEET_SCOPES, FLEET_SUPPORT, calculateFleetHealth, benchmarkStats, compareToBenchmark,
  discoverBestPractices, detectOpportunities, classifyGrowth, buildFleetRecommendations, fleetInputHash,
  HEALTH_TONE, HEALTH_LABEL, POSITION_LABEL, POSITION_TONE, OPP_TYPE_LABEL, SEVERITY_TONE, GROWTH_LABEL, GROWTH_TONE,
  type OpportunityType, type OpportunitySeverity, type FleetHealthGrade,
} from '@/lib/fleetIntel';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'enterprise' | 'brand' | 'region' | 'industry' | 'benchmark' | 'bestpractices'
  | 'opportunity' | 'health' | 'growth' | 'recommendations' | 'governance' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Globe2 }[] = [
  { key: 'overview', label: 'Fleet Overview', icon: Globe2 },
  { key: 'enterprise', label: 'Enterprise', icon: Building2 },
  { key: 'brand', label: 'Brand', icon: Tag },
  { key: 'region', label: 'Region', icon: MapPin },
  { key: 'industry', label: 'Industry', icon: Factory },
  { key: 'benchmark', label: 'Benchmark', icon: BarChart3 },
  { key: 'bestpractices', label: 'Best Practices', icon: Award },
  { key: 'opportunity', label: 'Opportunity', icon: Lightbulb },
  { key: 'health', label: 'Fleet Health', icon: HeartPulse },
  { key: 'growth', label: 'Growth', icon: TrendingUp },
  { key: 'recommendations', label: 'Recommendations', icon: ClipboardList },
  { key: 'governance', label: 'Governance Evidence', icon: ShieldCheck },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function FleetIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<FleetSummaryResp | null>(null);
  const [health, setHealth] = useState<FleetHealthResp | null>(null);
  const [enterprise, setEnterprise] = useState<EnterpriseBenchmarkRow[]>([]);
  const [entNote, setEntNote] = useState<string | undefined>();
  const [regions, setRegions] = useState<RegionBenchmarkRow[]>([]);
  const [growth, setGrowth] = useState<FleetGrowthRow[]>([]);
  const [scan, setScan] = useState<FleetScanResp | null>(null);
  const [practices, setPractices] = useState<BestPracticeRow[]>([]);
  const [savedOpps, setSavedOpps] = useState<FleetOpportunityRow[]>([]);
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [gov, setGov] = useState<GovernanceSummaryResp | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, h, e, r, g, sc, bp, op, ov, gs] = await Promise.all([
        fetchFleetSummary('30d'), fetchFleetHealth('global', null, '30d'),
        fetchEnterpriseBenchmark('30d', 50).catch(() => ({ anonymized: true, items: [] as EnterpriseBenchmarkRow[], note: undefined })),
        fetchRegionBenchmark('30d', 50).catch(() => [] as RegionBenchmarkRow[]),
        fetchFleetGrowth('30d'), fetchFleetOpportunityScan('30d', 50, 50),
        fetchBestPractices(null, null, 100), fetchFleetOpportunities(null, null, 100),
        fetchContextOverview('30d'), fetchGovernanceSummary().catch(() => null),
      ]);
      setSummary(s); setHealth(h); setEnterprise(e.items); setEntNote(e.note); setRegions(r); setGrowth(g);
      setScan(sc); setPractices(bp); setSavedOpps(op); setOverview(ov); setGov(gs);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Fleet Health(성분 재정규화 — Queue Stability 미지원 null).
  const fleetHealth = useMemo(() => {
    if (!health?.supported || !health.kpi) return calculateFleetHealth({});
    return calculateFleetHealth({
      playbackHealth: health.kpi.playback_health, streamingQuality: health.kpi.streaming_quality,
      queueStability: null, rotationQuality: health.kpi.rotation_quality,
      playlistDiversity: health.kpi.playlist_diversity, satisfaction: health.kpi.satisfaction,
      aiTrust: health.governance?.trust ?? null, governanceHealth: health.governance?.governance_health ?? null,
    });
  }, [health]);

  // Industry rows(0490 재사용) → Best Practice 후보 + Benchmark 위치.
  const industryRows = useMemo(() => (overview?.items ?? []).map((it) => ({
    storeType: it.store_type, events: it.events, completionRate: it.completion_rate, skipRate: it.skip_rate,
  })), [overview]);
  const discovered = useMemo(() => discoverBestPractices(industryRows), [industryRows]);
  const completionStats = useMemo(() => benchmarkStats(industryRows.map((r) => r.completionRate)), [industryRows]);

  // Opportunity(익명 store scan vs global baseline).
  const detectedOpps = useMemo(() => {
    if (!scan?.items.length || !scan.global_baseline) return [];
    return detectOpportunities(
      scan.items.map((i) => ({ anonCode: i.anon_code, storeType: i.store_type, events: i.events, skipRate: i.skip_rate, completionRate: i.completion_rate, errorRate: i.error_rate, replayRate: i.replay_rate, trackCount: i.track_count })),
      { skipRate: scan.global_baseline.skip_rate ?? null, completionRate: scan.global_baseline.completion_rate ?? null, errorRate: scan.global_baseline.error_rate ?? null, replayRate: scan.global_baseline.replay_rate ?? null },
    );
  }, [scan]);

  const recommendations = useMemo(() => buildFleetRecommendations(discovered, detectedOpps), [discovered, detectedOpps]);

  const savePractice = async (p: typeof discovered[number]) => {
    setBusy(true);
    try {
      const hash = fleetInputHash(['bp', p.scopeKey, p.metric, p.segmentValue, p.baselineValue]);
      const res = await saveBestPractice({
        practice_code: `bp_${p.scopeKey}_${hash.slice(6)}`, scope: p.scope, scope_key: p.scopeKey, title: p.title,
        subject: { metric: p.metric }, observed_effect: { delta_pp: Math.round((p.segmentValue - p.baselineValue) * 10) / 10, delta_pct: p.deltaPct },
        sample_stores: null, sample_events: p.sampleEvents, evidence: p.evidence, limitations: p.limitations,
        source_version: FLEET_SOURCE_VERSION, input_hash: hash,
      });
      toast.success(res.idempotent ? '이미 저장됨(중복 방지)' : `Best Practice 후보 저장(${res.practice.status})`);
      setPractices(await fetchBestPractices(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const saveOpp = async (o: typeof detectedOpps[number]) => {
    setBusy(true);
    try {
      const hash = fleetInputHash(['opp', o.anonCode, o.type, o.kpi]);
      const res = await saveFleetOpportunity({
        opportunity_code: `opp_${o.type}_${hash.slice(6)}`, opportunity_type: o.type, scope: 'store', scope_key: o.anonCode,
        severity: o.severity, kpi_snapshot: { kpi: o.kpi, baseline: o.baseline, reason: o.reason },
        expected_direction: 'improve', evidence: o.evidence,
        limitations: ['익명 store 코드(원본 미노출)', '자동 실행 없음 — Review 후보'],
        source_version: FLEET_SOURCE_VERSION, input_hash: hash,
      });
      toast.success(res.idempotent ? '이미 저장됨(중복 방지)' : 'Opportunity 저장(detected)');
      setSavedOpps(await fetchFleetOpportunities(null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="Enterprise Fleet Intelligence"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Fleet Intelligence">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const g = summary?.global ?? null; const f = summary?.fleet ?? null;

  return (
    <AdminCard
      title="Enterprise Fleet Intelligence"
      subtitle="Store → Region → Enterprise → Industry → Global 익명 집계 분석 (Production 무변경 · 자동 적용 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Cross-Enterprise 비교는 익명화된 집계만 사용합니다(원본 franchise 이름/ID 미노출, 2개 미만 Store enterprise 제외). Best Practice/Opportunity/Recommendation 은 Governance Review 대상 후보이며 자동 Playlist Publish/Rollout/Scheduler/Queue/Playback 변경 및 Production Apply 는 없습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Fleet Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Stores (30d 활동)" value={NUM(g?.stores)} />
            <Box label="Industries" value={NUM(g?.industries)} />
            <Box label="Enterprises (HQ)" value={NUM(f?.enterprises)} />
            <Box label="Regions" value={NUM(f?.regions)} />
            <Box label="Fleet Stores (연결)" value={NUM(f?.fleet_stores)} />
            <Box label="Events" value={NUM(g?.events)} />
            <Box label="Completion" value={g?.completion_rate == null ? '—' : `${g.completion_rate}%`} />
            <Box label="Skip" value={g?.skip_rate == null ? '—' : `${g.skip_rate}%`} />
            <Box label="Like Rate" value={g?.like_rate == null ? '—' : `${g.like_rate}%`} />
            <Box label="Error Rate" value={g?.error_rate == null ? '—' : `${g.error_rate}%`} />
            <Box label="Best Practices" value={NUM(f?.best_practices)} />
            <Box label="Open Opportunities" value={NUM(f?.opportunities)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Scope</th><th className="px-2">지원</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {FLEET_SCOPES.map((s) => (
                  <tr key={s.scope} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                    <td className="px-2"><AdminBadge tone={s.support === 'supported' ? 'success' : s.support === 'insufficient_data' ? 'neutral' : 'warning'}>{s.support}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Enterprise ── */}
      {tab === 'enterprise' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Enterprise Benchmark (익명 집계)" description={entNote ?? 'Enterprise 원본(이름/ID)은 노출되지 않습니다. 실명 Ranking 대신 익명 Benchmark 만 제공합니다.'} />
          {!enterprise.length ? <AdminEmpty icon={<Building2 size={20} />} title="Enterprise 집계 없음" description="franchise 연결 + 2개 이상 Store 활동 데이터가 필요합니다(insufficient_data — 0 으로 조작하지 않음)." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">익명 코드</th><th className="px-2">Stores</th><th className="px-2">Events</th><th className="px-2">Completion</th><th className="px-2">Skip</th><th className="px-2">Like</th><th className="px-2">Error</th></tr></thead>
                <tbody>
                  {enterprise.map((r) => (
                    <tr key={r.anon_code} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-bold">{r.anon_code}</td>
                      <td className="px-2">{NUM(r.store_count)}</td><td className="px-2">{NUM(r.events)}</td>
                      <td className="px-2">{r.completion_rate ?? '—'}%</td><td className="px-2">{r.skip_rate ?? '—'}%</td>
                      <td className="px-2">{r.like_rate ?? '—'}%</td><td className="px-2">{r.error_rate ?? '—'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Brand ── */}
      {tab === 'brand' && (
        <AdminAlert tone="info" title="Brand Scope — insufficient_data" description="현재 스키마에는 Enterprise(HQ=franchises)와 Store 계층만 존재하며 별도 Brand 계층 데이터가 없습니다. Brand 간 원본 데이터 혼합 없이, Brand 계층이 실제 도입되면 익명 집계 방식으로 확장합니다(임의 추정/조작 없음)." />
      )}

      {/* ── Region ── */}
      {tab === 'region' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Regional Intelligence" description="실존하는 franchise_regions 라벨만 집계합니다(서울/경기 등 임의 지역 생성 없음). Region 은 소속 Enterprise 를 식별하지 않습니다." />
          {!regions.length ? <AdminEmpty icon={<MapPin size={20} />} title="Region 집계 없음" description="franchise_regions 연결 데이터가 아직 없습니다(insufficient_data)." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Region</th><th className="px-2">Stores</th><th className="px-2">Events</th><th className="px-2">Completion</th><th className="px-2">Skip</th><th className="px-2">Like</th></tr></thead>
                <tbody>
                  {regions.map((r) => (
                    <tr key={r.region_name} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-bold">{r.region_name}</td>
                      <td className="px-2">{NUM(r.store_count)}</td><td className="px-2">{NUM(r.events)}</td>
                      <td className="px-2">{r.completion_rate ?? '—'}%</td><td className="px-2">{r.skip_rate ?? '—'}%</td><td className="px-2">{r.like_rate ?? '—'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Industry ── */}
      {tab === 'industry' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Industry Intelligence (store_type 실데이터)" description="admin_context_overview(0490) 재사용 — 실제 존재하는 Industry 만 표시됩니다." />
          {!industryRows.length ? <AdminEmpty icon={<Factory size={20} />} title="Industry 데이터 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Industry</th><th className="px-2">Events</th><th className="px-2">Completion</th><th className="px-2">Skip</th><th className="px-2">vs Fleet Median</th></tr></thead>
                <tbody>
                  {industryRows.map((r) => {
                    const pos = compareToBenchmark(r.completionRate, completionStats, 'max');
                    return (
                      <tr key={r.storeType} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-bold">{r.storeType}</td>
                        <td className="px-2">{NUM(r.events)}</td>
                        <td className="px-2">{r.completionRate ?? '—'}%</td><td className="px-2">{r.skipRate ?? '—'}%</td>
                        <td className="px-2"><AdminBadge tone={POSITION_TONE[pos]}>{POSITION_LABEL[pos]}</AdminBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Benchmark ── */}
      {tab === 'benchmark' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Cross-Fleet Benchmark" description="같은 업종 기준 Completion 분포(median/quartile) 비교입니다. Enterprise 원본 미노출." />
          {!completionStats ? <AdminEmpty icon={<BarChart3 size={20} />} title="Benchmark 불가" description="비교 가능한 세그먼트가 2개 미만입니다(표본 1개로 Benchmark 를 만들지 않습니다)." /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="Completion Median" value={`${completionStats.median}%`} />
              <Box label="P25" value={`${completionStats.p25}%`} />
              <Box label="P75" value={`${completionStats.p75}%`} />
              <Box label="세그먼트 수" value={NUM(completionStats.n)} />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">비교 조건(같은 업종/규모/지역/운영 시간) 중 현재 실데이터로 지원되는 것은 업종(store_type) 기준입니다. 규모/운영 시간 비교는 데이터 미지원(unsupported).</p>
        </div>
      )}

      {/* ── Best Practices ── */}
      {tab === 'bestpractices' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Best Practice Discovery (관찰 상관 — 인과 아님)" description="Fleet median 대비 +3pp 이상 우위 세그먼트만 후보로 발견하며, 표본 부족 시 insufficient_data 로 표시합니다. 자동 적용 없음." />
          {!discovered.length ? <AdminEmpty icon={<Award size={20} />} title="발견된 후보 없음" description="현재 집계에서 median +3pp 이상 우위 세그먼트가 없습니다." /> : (
            <div className="space-y-1.5">
              {discovered.map((p) => (
                <div key={p.scopeKey} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={p.status === 'candidate' ? 'success' : 'neutral'}>{p.status}</AdminBadge>
                  <span className="font-semibold">{p.title}</span>
                  <span className="text-[10px] text-muted-foreground">sample {NUM(p.sampleEvents)} events</span>
                  <button disabled={busy} onClick={() => void savePractice(p)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">후보 저장</button>
                </div>
              ))}
            </div>
          )}
          {practices.length > 0 && (
            <AdminCard title={`저장된 Best Practice (${practices.length})`}>
              <div className="space-y-1.5">
                {practices.slice(0, 10).map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone={p.status === 'reference' ? 'success' : p.status === 'rejected' ? 'danger' : p.status === 'insufficient_data' ? 'neutral' : 'info'}>{p.status}</AdminBadge>
                    <span className="font-semibold">{p.title.slice(0, 50)}</span>
                    <span className="text-[10px] text-muted-foreground">{p.scope}:{p.scope_key} · {NUM(p.sample_events)} events</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Opportunity ── */}
      {tab === 'opportunity' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Fleet Opportunity Engine" description="익명 Store 코드 기준 KPI 이상(Skip 증가/반복 과다/Quality 저하/Completion 저조/Diversity 부족)을 Global Baseline 대비 탐지합니다. min 50 events 미만 Store 는 판정하지 않습니다." />
          {!detectedOpps.length ? <AdminEmpty icon={<Lightbulb size={20} />} title="탐지된 기회 없음" description="현재 집계에서 Baseline 대비 이상 신호가 없거나 표본이 부족합니다." /> : (
            <div className="space-y-1.5">
              {detectedOpps.slice(0, 20).map((o, i) => (
                <div key={`${o.anonCode}${o.type}${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={SEVERITY_TONE[o.severity as OpportunitySeverity]}>{o.severity}</AdminBadge>
                  <AdminBadge tone="neutral">{OPP_TYPE_LABEL[o.type as OpportunityType]}</AdminBadge>
                  <span className="font-semibold">{o.anonCode}</span>
                  <span className="text-[10px] text-muted-foreground">{o.reason}</span>
                  <button disabled={busy} onClick={() => void saveOpp(o)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">저장</button>
                </div>
              ))}
            </div>
          )}
          {savedOpps.length > 0 && <p className="text-[10px] text-muted-foreground">저장된 Opportunity: {savedOpps.length}건 (자동 실행 없음 — Review 대상)</p>}
        </div>
      )}

      {/* ── Fleet Health ── */}
      {tab === 'health' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={HEALTH_TONE[fleetHealth.grade as FleetHealthGrade]}>{HEALTH_LABEL[fleetHealth.grade as FleetHealthGrade]}</AdminBadge>
            <span className="text-sm font-black">{fleetHealth.score ?? '—'}</span>
            <span className="text-[10px] text-muted-foreground">Global Fleet Health (성분 재정규화 · 누락 성분 0 변환 없음)</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {fleetHealth.components.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{c.key}</p>
                <p className="mt-0.5 text-sm font-black">{c.value == null ? '미지원' : c.value}</p>
              </div>
            ))}
          </div>
          {fleetHealth.missing.length > 0 && <AdminAlert tone="info" title="미지원 성분" description={`${fleetHealth.missing.join(', ')} — null 유지(0 으로 조작하지 않음)`} />}
        </div>
      )}

      {/* ── Growth ── */}
      {tab === 'growth' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Fleet Growth (이전/현재 반기 비교)" description="이전 기간 데이터가 없으면 0 과 비교하지 않고 insufficient_data 로 표시합니다." />
          {!growth.length ? <AdminEmpty icon={<TrendingUp size={20} />} title="Growth 데이터 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Industry</th><th className="px-2">이전/현재 Events</th><th className="px-2">이전/현재 Stores</th><th className="px-2">Completion</th><th className="px-2">판정</th></tr></thead>
                <tbody>
                  {growth.map((r) => {
                    const cls = classifyGrowth(r.prev_events, r.curr_events);
                    return (
                      <tr key={r.store_type} className="border-b border-border/50">
                        <td className="py-1.5 pr-2 font-bold">{r.store_type}</td>
                        <td className="px-2">{NUM(r.prev_events)} → {NUM(r.curr_events)}</td>
                        <td className="px-2">{NUM(r.prev_stores)} → {NUM(r.curr_stores)}</td>
                        <td className="px-2">{r.prev_completion ?? '—'}% → {r.curr_completion ?? '—'}%</td>
                        <td className="px-2"><AdminBadge tone={GROWTH_TONE[cls.result]}>{GROWTH_LABEL[cls.result]}{cls.deltaPct != null ? ` (${cls.deltaPct > 0 ? '+' : ''}${cls.deltaPct}%)` : ''}</AdminBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" icon={<Lock size={14} />} title="Fleet Recommendation — Review Candidate (자동 적용 금지)" description="Best Practice/Opportunity 기반 검토 후보입니다. 관찰 상관 기반이며 효과를 보장하지 않고, Governance Review + 사람 승인 없이는 어떤 변경도 실행되지 않습니다." />
          {!recommendations.length ? <AdminEmpty icon={<ClipboardList size={20} />} title="Recommendation 없음" description="현재 집계에서 검토 후보가 없습니다(가짜 추천 생성 없음)." /> : (
            <div className="space-y-1.5">
              {recommendations.slice(0, 20).map((r, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="warning">Review Candidate</AdminBadge>
                    <AdminBadge tone="neutral">{r.basis}</AdminBadge>
                    <span className="font-semibold">{r.title}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{r.expected} · 제한: {r.limitations.join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Governance Evidence ── */}
      {tab === 'governance' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Governance / Trust 연동 (읽기 전용)" description="Fleet 판단은 기존 Governance Events 와 Agent Trust 를 참조만 하며 수정하지 않습니다. Critical 기회/후보는 기존 Governance Review 흐름으로 전달되는 Evidence 입니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Governance Violations" value={NUM(gov?.events?.violations)} />
            <Box label="Overrides" value={NUM(gov?.events?.overrides)} />
            <Box label="Critical Candidates" value={NUM(gov?.candidates?.critical_risk)} />
            <Box label="Avg Agent Trust" value={NUM(health?.governance?.trust)} />
          </div>
          <p className="text-[10px] text-muted-foreground">Trust/Constitution/Reputation 직접 변경 없음 · Fleet Recommendation 은 Production Change Candidate 의 참고 Evidence 로만 사용됩니다.</p>
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {FLEET_SUPPORT.map((s) => (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
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
