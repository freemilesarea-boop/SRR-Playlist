/**
 * ExecutiveCenterSection — AI Music OS Executive Center (Phase AI-MUSIC-16).
 *
 * 기존 15개 Phase 의 실측 집계를 하나의 운영체제 관점으로 통합: Executive KPI · AI OS Health ·
 * Cross-Agent Orchestration(0497 재사용) · Strategic Risk · Opportunity · Twin Simulation(0499
 * 읽기 전용) · Executive Recommendation(4요소 필수 · Governance Review 대상).
 * Production Apply/자동 승인/실행 없음 — Evidence Only. AI 는 Executive Policy 를 수정할 수 없음.
 *
 * 탭: Executive Overview · AI Health · Fleet Health · Strategy · Risks · Opportunities ·
 *     Simulations · Executive Recommendations · Governance · Trust · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crown, Cpu, Globe2, Map as MapIcon, AlertTriangle, Lightbulb, FlaskConical, ClipboardList,
  Scale, Gauge, Grid3x3, Lock, RefreshCw,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchAiOsHealth, saveExecRecommendation, fetchExecRecommendations, setExecRecommendationStatus,
  fetchFleetSummary, fetchFleetGrowth, fetchRevenueSummary, fetchAgentReputation, fetchGovernanceSummary,
  fetchSelfHealingSummary, fetchTwinSimulationRuns, fetchContextOverview, fetchFleetHealth,
  type AiOsHealthResp, type ExecRecommendationRow, type FleetSummaryResp, type FleetGrowthRow,
  type RevenueSummary, type AgentReputationRow, type GovernanceSummaryResp, type SelfHealingSummaryResp,
  type TwinSimRunRow, type ContextOverview, type FleetHealthResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  EXEC_SOURCE_VERSION, buildExecutiveKpis, computeAiOsHealth, detectStrategicRisks, detectExecOpportunities,
  orchestrateExecutiveReview, buildStrategicPlan, validateRecommendation, execInputHash,
  EXEC_SUPPORT, KPI_STATUS_TONE, RISK_TONE, REC_STATUS_LABEL, REC_STATUS_TONE, HORIZONS,
  type Horizon, type PlanItem,
} from '@/lib/executiveIntel';
import { calculateFleetHealth, benchmarkStats } from '@/lib/fleetIntel';
import { seasonForMonth } from '@/lib/aiMemory';
import { agentDef, STANCE_LABEL, STANCE_TONE, CONSENSUS_LABEL, FINAL_DECISION_LABEL, type AgentCode } from '@/lib/multiAgent';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'aihealth' | 'fleethealth' | 'strategy' | 'risks' | 'opportunities' | 'simulations'
  | 'recommendations' | 'governance' | 'trust' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Crown }[] = [
  { key: 'overview', label: 'Executive Overview', icon: Crown },
  { key: 'aihealth', label: 'AI Health', icon: Cpu },
  { key: 'fleethealth', label: 'Fleet Health', icon: Globe2 },
  { key: 'strategy', label: 'Strategy', icon: MapIcon },
  { key: 'risks', label: 'Risks', icon: AlertTriangle },
  { key: 'opportunities', label: 'Opportunities', icon: Lightbulb },
  { key: 'simulations', label: 'Simulations', icon: FlaskConical },
  { key: 'recommendations', label: 'Recommendations', icon: ClipboardList },
  { key: 'governance', label: 'Governance', icon: Scale },
  { key: 'trust', label: 'Trust', icon: Gauge },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function ExecutiveCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [osHealth, setOsHealth] = useState<AiOsHealthResp | null>(null);
  const [fleet, setFleet] = useState<FleetSummaryResp | null>(null);
  const [growth, setGrowth] = useState<FleetGrowthRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [reputation, setReputation] = useState<AgentReputationRow[]>([]);
  const [, setGov] = useState<GovernanceSummaryResp | null>(null);
  const [healing, setHealing] = useState<SelfHealingSummaryResp | null>(null);
  const [twinRuns, setTwinRuns] = useState<TwinSimRunRow[]>([]);
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [fleetHealthRaw, setFleetHealthRaw] = useState<FleetHealthResp | null>(null);
  const [recs, setRecs] = useState<ExecRecommendationRow[]>([]);
  const [horizon, setHorizon] = useState<Horizon>('30d');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [oh, fs, fg, rv, rep, gs, hs, tr, ov, fh, rc] = await Promise.all([
        fetchAiOsHealth(), fetchFleetSummary('30d'), fetchFleetGrowth('30d'),
        fetchRevenueSummary().catch(() => null), fetchAgentReputation().catch(() => [] as AgentReputationRow[]),
        fetchGovernanceSummary().catch(() => null), fetchSelfHealingSummary().catch(() => null),
        fetchTwinSimulationRuns(null, 'completed', 20).catch(() => [] as TwinSimRunRow[]),
        fetchContextOverview('30d'), fetchFleetHealth('global', null, '30d').catch(() => null),
        fetchExecRecommendations(null, null, null, 100),
      ]);
      setOsHealth(oh); setFleet(fs); setGrowth(fg); setRevenue(rv); setReputation(rep); setGov(gs);
      setHealing(hs); setTwinRuns(tr); setOverview(ov); setFleetHealthRaw(fh); setRecs(rc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const g = fleet?.global ?? null;
  const domains = osHealth?.domains as Record<string, Record<string, number | null>> | null;

  // ── 실측 신호 파생(전부 실데이터 · 없으면 null) ──
  const eventsGrowthPct = useMemo(() => {
    const prev = growth.reduce((a, r) => a + r.prev_events, 0); const curr = growth.reduce((a, r) => a + r.curr_events, 0);
    return prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;
  }, [growth]);
  const avgTrust = useMemo(() => (reputation.length ? Math.round(reputation.reduce((a, r) => a + r.reputation, 0) / reputation.length) : null), [reputation]);
  const govViolations = num(domains?.governance?.violations_30d) ?? 0;
  const govHealth = useMemo(() => Math.max(0, 100 - govViolations * 5), [govViolations]);
  const diversityProxy = useMemo(() => {
    const items = overview?.items ?? [];
    return items.length ? Math.min(100, Math.round((items.length / 8) * 100)) : null;
  }, [overview]);
  const revenueTrendPct = null; // 월별 revenue 추세 집계 미구현(정직 — insufficient)

  const kpis = useMemo(() => buildExecutiveKpis({
    eventsGrowthPct, completionRate: num(g?.completion_rate), skipRate: num(g?.skip_rate),
    likeRate: num(g?.like_rate), diversityProxy, revenueMonth: revenue?.month ?? null,
    revenueTrendPct, aiTrust: avgTrust, governanceHealth: govHealth,
  }), [eventsGrowthPct, g, diversityProxy, revenue, avgTrust, govHealth]);

  const fleetHealth = useMemo(() => {
    const kpi = fleetHealthRaw?.kpi ?? null;
    return calculateFleetHealth({
      playbackHealth: kpi?.playback_health ?? null, streamingQuality: kpi?.streaming_quality ?? null,
      queueStability: null, rotationQuality: kpi?.rotation_quality ?? null,
      playlistDiversity: kpi?.playlist_diversity ?? null, satisfaction: kpi?.satisfaction ?? null,
      aiTrust: avgTrust, governanceHealth: govHealth,
    });
  }, [fleetHealthRaw, avgTrust, govHealth]);

  const osScore = useMemo(() => computeAiOsHealth({
    agentTrust: avgTrust, fleetHealth: fleetHealth.score, governanceHealth: govHealth,
    memoryCoverage: num(domains?.memory?.total) != null && num(domains?.memory?.total)! > 0 ? 60 : null,
    selfHealingScore: null,
    federatedPrivacyRate: null,
    streamingStability: num(g?.error_rate) != null ? Math.max(0, 100 - num(g?.error_rate)! * 10) : null,
  }), [avgTrust, fleetHealth, govHealth, domains, g]);

  const risks = useMemo(() => detectStrategicRisks({
    replayRate: null, errorRate: num(g?.error_rate), revenueTrendPct,
    governanceViolations: govViolations, activeIncidents: num(healing?.incidents?.active),
  }), [g, govViolations, healing]);

  const opportunities = useMemo(() => {
    const rows = (overview?.items ?? []).map((r) => ({ storeType: r.store_type, events: r.events, completionRate: r.completion_rate }));
    const stats = benchmarkStats(rows.map((r) => r.completionRate));
    const top = rows.filter((r) => r.completionRate != null).sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))[0];
    return detectExecOpportunities({
      topIndustry: top && stats ? { storeType: top.storeType, completionRate: top.completionRate, deltaVsMedian: Math.round(((top.completionRate ?? 0) - stats.median) * 10) / 10 } : null,
      currentSeason: seasonForMonth(now.getMonth() + 1), activeRollouts: null,
      bestPracticeCount: num(domains?.fleet?.best_practices),
    });
  }, [overview, domains, now]);

  const orchestration = useMemo(() => {
    const sample = num(g?.events) ?? 0;
    if (sample < 50) return null;
    const repMap = Object.fromEntries(reputation.map((r) => [r.agent_code, r.reputation])) as Partial<Record<AgentCode, number>>;
    return orchestrateExecutiveReview({
      completionRate: num(g?.completion_rate), skipRate: num(g?.skip_rate), likeRate: num(g?.like_rate),
      diversityProxy, errorRate: num(g?.error_rate), replayRate: null,
      revenueTrendPct, governanceHealth: govHealth, governanceViolations: govViolations, sample,
    }, repMap);
  }, [g, diversityProxy, govHealth, govViolations, reputation]);

  const plan = useMemo(() => buildStrategicPlan(horizon, risks.risks, opportunities, orchestration?.consensus.score ?? null), [horizon, risks, opportunities, orchestration]);

  const saveRec = async (item: PlanItem) => {
    const errors = validateRecommendation(item);
    if (errors.length) { toast.error(`4요소 검증 실패: ${errors.join(', ')}`); return; }
    setBusy(true);
    try {
      const hash = execInputHash([item.horizon, item.category, item.title]);
      const res = await saveExecRecommendation({
        rec_code: `rec_${hash.slice(5)}`, category: item.category, horizon: item.horizon,
        title: item.title, summary: item.summary, evidence: item.evidence, confidence: item.confidence,
        risk_tier: item.riskTier, expected_outcome: item.expectedOutcome,
        source_refs: [{ label: 'orchestration', value: orchestration?.consensus.type ?? null }],
        limitations: item.limitations, source_version: EXEC_SOURCE_VERSION, input_hash: hash,
      });
      toast.success(res.idempotent ? '이미 제안됨(중복 방지)' : 'Executive Recommendation 저장(Governance Review 대상)');
      setRecs(await fetchExecRecommendations(null, null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const setRecStatus = async (r: ExecRecommendationRow, status: string) => {
    setBusy(true);
    try {
      await setExecRecommendationStatus(r.id, status, 'Governance 판단(사람)');
      toast.success(`상태 변경: ${REC_STATUS_LABEL[status] ?? status}`);
      setRecs(await fetchExecRecommendations(null, null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  if (loading) return <AdminCard title="AI Music OS Executive Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Music OS Executive Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="AI Music OS Executive Center"
      subtitle="15개 AI 계층 통합 Executive Intelligence (Evidence Only · Production Apply 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Executive Recommendation 은 Recommendation·Evidence·Confidence·Risk·Expected Outcome 4요소가 필수이며 전부 Governance Review 를 거칩니다(자동 승인 없음 — approved 는 governance_review 경유만 허용, 서버 게이트). AI 는 Executive Policy/Production Entity 를 직접 수정하지 않으며 자동 Apply/Merge/Rollout/Publish 는 없습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Executive Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AdminBadge tone={osScore.grade === 'healthy' ? 'success' : osScore.grade === 'adequate' ? 'info' : osScore.grade === 'at_risk' ? 'warning' : 'neutral'}>AI OS: {osScore.grade}</AdminBadge>
            <span className="text-sm font-black">{osScore.score ?? '—'}</span>
            {osScore.missing.length > 0 && <span className="text-[10px] text-muted-foreground">미계측: {osScore.missing.join(', ')}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.key} className="rounded-lg border border-border p-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-muted-foreground">{k.label}</p>
                  <AdminBadge tone={KPI_STATUS_TONE[k.status]}>{k.status === 'available' ? '실측' : k.status === 'proxy' ? 'proxy' : k.status}</AdminBadge>
                </div>
                <p className="mt-0.5 text-sm font-black">{k.value == null ? '—' : `${NUM(k.value)}${k.unit === '₩' ? '' : k.unit}`}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="위험 감지" value={`${risks.risks.length}건`} />
            <Box label="기회 감지" value={`${opportunities.length}건`} />
            <Box label="Recommendation" value={`${recs.length}건`} />
            <Box label="Twin Runs (참조)" value={NUM(twinRuns.length)} />
          </div>
        </div>
      )}

      {/* ── AI Health ── */}
      {tab === 'aihealth' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="AI OS Health (전 도메인 읽기 전용 집계)" description="Multi-Agent/Governance/Memory/Pattern/Twin/Fleet/Federated/Self-Healing 상태를 참조만 합니다(수정 없음)." />
          {!domains ? <AdminEmpty icon={<Cpu size={20} />} title="집계 없음" /> : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="Agents / Avg Trust" value={`${NUM(num(domains.agents?.count))} / ${NUM(num(domains.agents?.avg_reputation))}`} />
              <Box label="Governance 위반(30d)" value={NUM(num(domains.governance?.violations_30d))} />
              <Box label="Memory (active/total)" value={`${NUM(num(domains.memory?.active))} / ${NUM(num(domains.memory?.total))}`} />
              <Box label="Patterns (validated)" value={`${NUM(num(domains.patterns?.validated))} / ${NUM(num(domains.patterns?.total))}`} />
              <Box label="Twins (ready)" value={`${NUM(num(domains.twins?.ready))} / ${NUM(num(domains.twins?.total))}`} />
              <Box label="Federated Patterns" value={NUM(num(domains.federated?.patterns))} />
              <Box label="Active Incidents" value={NUM(num(domains.incidents?.active))} />
              <Box label="Exec Rec (review)" value={NUM(num(domains.executive_recommendations?.governance_review))} />
            </div>
          )}
        </div>
      )}

      {/* ── Fleet Health ── */}
      {tab === 'fleethealth' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black">{fleetHealth.score ?? '—'}</span>
            <AdminBadge tone={fleetHealth.grade === 'healthy' ? 'success' : fleetHealth.grade === 'insufficient_data' ? 'neutral' : 'warning'}>{fleetHealth.grade}</AdminBadge>
            <span className="text-[10px] text-muted-foreground">0500 Fleet Health 재사용(성분 재정규화)</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {fleetHealth.components.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{c.key}</p>
                <p className="mt-0.5 text-sm font-black">{c.value ?? '미지원'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Strategy ── */}
      {tab === 'strategy' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Strategic Planning (7일/30일/분기/시즌)" description="계획은 실측 위험/기회에서 파생되며 장기 Horizon 일수록 Confidence penalty 가 적용됩니다. 근거 Consensus 없으면 계획을 생성하지 않습니다." />
          <div className="flex flex-wrap gap-1.5">
            {HORIZONS.map((h) => <button key={h.key} onClick={() => setHorizon(h.key)} className={`rounded-md px-2 py-1 text-[11px] font-bold ${horizon === h.key ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{h.label}</button>)}
          </div>
          {!plan.length ? <AdminEmpty icon={<MapIcon size={20} />} title="계획 없음" description="감지된 위험/기회가 없거나 Consensus 근거가 부족합니다(가짜 계획 생성 없음)." /> : (
            <div className="space-y-1.5">
              {plan.map((p, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={p.category === 'risk_mitigation' ? 'warning' : 'info'}>{p.category}</AdminBadge>
                    <AdminBadge tone={RISK_TONE[p.riskTier]}>risk {p.riskTier}</AdminBadge>
                    <span className="font-semibold">{p.title}</span>
                    <span className="text-[10px] text-muted-foreground">conf {p.confidence}</span>
                    <button disabled={busy} onClick={() => void saveRec(p)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Recommendation 저장</button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{p.summary} · 제한: {p.limitations.join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Risks ── */}
      {tab === 'risks' && (
        <div className="space-y-2">
          {!risks.risks.length ? <AdminEmpty icon={<AlertTriangle size={20} />} title="감지된 전략 위험 없음" description="실측 신호에서 위험 임계 초과가 없습니다(가짜 위험 생성 없음)." /> : (
            risks.risks.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={RISK_TONE[r.severity]}>{r.severity}</AdminBadge>
                <AdminBadge tone="neutral">{r.type}</AdminBadge>
                <span className="font-semibold">{r.summary}</span>
              </div>
            ))
          )}
          <AdminAlert tone="info" title="판정하지 않는 위험 축(데이터 부족)" description={`${risks.unsupported.join(', ')} — 실측 데이터가 없어 insufficient_data 로 유지합니다.`} />
        </div>
      )}

      {/* ── Opportunities ── */}
      {tab === 'opportunities' && (
        <div className="space-y-2">
          {!opportunities.length ? <AdminEmpty icon={<Lightbulb size={20} />} title="감지된 기회 없음" description="실측 근거가 있는 기회만 표시합니다." /> : (
            opportunities.map((o, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{o.type}</AdminBadge>
                <span className="font-semibold">{o.summary}</span>
              </div>
            ))
          )}
          <p className="text-[10px] text-muted-foreground">신규 브랜드 확장 기회는 Brand 데이터 미연결로 unsupported.</p>
        </div>
      )}

      {/* ── Simulations ── */}
      {tab === 'simulations' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Executive Simulation (0499 Twin 재사용 · simulated ≠ actual)" description="Twin Run 결과를 경영 관점으로 참조만 합니다. Completion→Revenue 연계 계수는 실측 근거가 없어 unsupported — Revenue 영향을 추정 표기하지 않습니다." />
          {!twinRuns.length ? <AdminEmpty icon={<FlaskConical size={20} />} title="완료된 Twin Run 없음" description="Digital Twin Lab 에서 Scenario 를 먼저 시뮬레이션하세요." /> : (
            <div className="space-y-1.5">
              {twinRuns.slice(0, 10).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone="info">simulated</AdminBadge>
                  <code className="text-[10px]">{r.run_code.slice(0, 20)}</code>
                  <span className="text-[10px] text-muted-foreground">horizon {r.simulation_horizon}일 · seed {r.seed} · {r.created_at.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          {!recs.length ? <AdminEmpty icon={<ClipboardList size={20} />} title="Recommendation 없음" description="Strategy 탭에서 계획을 저장하세요." /> : (
            recs.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={REC_STATUS_TONE[r.status] ?? 'neutral'}>{REC_STATUS_LABEL[r.status] ?? r.status}</AdminBadge>
                  <AdminBadge tone="neutral">{r.category} · {r.horizon}</AdminBadge>
                  <AdminBadge tone={RISK_TONE[r.risk_tier as 'low' | 'medium' | 'high' | 'critical'] ?? 'neutral'}>risk {r.risk_tier}</AdminBadge>
                  <span className="font-semibold">{r.title.slice(0, 44)}</span>
                  <span className="text-[10px] text-muted-foreground">conf {r.confidence}</span>
                  <div className="ml-auto flex gap-1">
                    {r.status === 'proposed' && <button disabled={busy} onClick={() => void setRecStatus(r, 'governance_review')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Governance 제출</button>}
                    {r.status === 'governance_review' && (
                      <>
                        <button disabled={busy} onClick={() => void setRecStatus(r, 'approved_reference')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">승인(참고)</button>
                        <button disabled={busy} onClick={() => void setRecStatus(r, 'rejected')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{r.summary.slice(0, 100)}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Governance ── */}
      {tab === 'governance' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Governance Integration (자동 승인 없음)" description="모든 Executive Recommendation 은 governance_review 를 거친 뒤에만 approved_reference 가 가능합니다(서버 게이트). 승인돼도 '참고' 지위이며 실행은 기존 Draft/Promotion/Candidate 흐름과 사람 승인으로만 진행됩니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Review 대기" value={NUM(recs.filter((r) => r.status === 'governance_review').length)} />
            <Box label="승인(참고)" value={NUM(recs.filter((r) => r.status === 'approved_reference').length)} />
            <Box label="기각" value={NUM(recs.filter((r) => r.status === 'rejected').length)} />
            <Box label="Governance 위반(30d)" value={NUM(num(domains?.governance?.violations_30d))} />
          </div>
        </div>
      )}

      {/* ── Trust ── */}
      {tab === 'trust' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Cross-Agent Orchestration (0497 Consensus 재사용 · 정의 무변경)" description="플랫폼 전체 실측 신호를 8 Agent 가 평가합니다. 신호 없는 도메인은 abstain 을 유지하며, Agent Reputation 은 참조만 합니다." />
          {!orchestration ? <AdminEmpty icon={<Gauge size={20} />} title="표본 부족" description="플랫폼 이벤트 표본이 부족해 Orchestration 을 실행하지 않습니다." /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={orchestration.finalDecision === 'proceed_to_governance' ? 'success' : orchestration.finalDecision === 'governance_review' ? 'warning' : 'neutral'}>{FINAL_DECISION_LABEL[orchestration.finalDecision]}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{CONSENSUS_LABEL[orchestration.consensus.type]} · Score {orchestration.consensus.score ?? '—'} · 기권 {orchestration.consensus.abstain}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Agent</th><th className="px-2">Stance</th><th className="px-2">Score</th><th className="px-2">근거</th></tr></thead>
                  <tbody>
                    {orchestration.opinions.map((o) => (
                      <tr key={o.agent} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{agentDef(o.agent)?.name}</td>
                        <td className="px-2"><AdminBadge tone={STANCE_TONE[o.stance]}>{STANCE_LABEL[o.stance]}</AdminBadge></td>
                        <td className="px-2">{o.score ?? '—'}</td>
                        <td className="px-2 text-[10px] text-muted-foreground">{o.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {EXEC_SUPPORT.map((s) => (
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

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
