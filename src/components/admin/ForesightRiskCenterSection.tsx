/**
 * ForesightRiskCenterSection — Enterprise E-8 (Foresight & Risk Center).
 *
 * Forecast/Risk/Scenario/Trend/Early Warning/Executive Outlook 통합
 * Executive Foresight Layer. 신규 Forecast Engine/Risk Engine/Scenario Engine/
 * Migration/RPC 없음 — 기존 원장(Revenue Forecast RPC · AI-OPS-39 Forecast Intel ·
 * 0528 Risk · 0516 Strategic Scenario · 0496 Governance · 관측 피드) 재사용(읽기 전용).
 * AI 는 미래를 단정하지 않는다 — 기존 데이터를 연결·설명·우선순위 제시만.
 * (기존 ForesightIntelligenceSection(0563)/RiskResilienceSection(0528)/
 *  StrategicScenarioSection(0516)/ForecastIntelligence(AI-OPS-39)과 별개)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, Bell, Bot, CloudSun, Database, GitBranch,
  LayoutDashboard, Lock, RefreshCw, Shield, TrendingUp, Layers,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchRevenueForecast, fetchRevenueTrend, fetchBusinessGrowth, fetchStreamingTimeline,
  fetchNocKpi, fetchStreamingSummary, fetchRevenueSummary, fetchReadableSettlementKpi,
  fetchArtistSummary, fetchForecastIntelSummary, fetchRiskSummary, fetchStratScenarios,
  fetchGovernanceSummary, fetchEnterprisePerformanceSummary,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  FORESIGHT_RELATIONSHIP_EDGES,
  assessForesightQuality, buildForesightOverview, buildForesightRelationships,
  buildOutlookSummaryLines, emptyForesightFeeds, summarizeForecasts, summarizeScenarios,
  type ForesightFeeds, type FRScenarioRow,
} from '@/lib/foresightRiskCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const DIR_LABEL: Record<string, string> = { up: '▲ 상승', down: '▼ 하락', flat: '― 유지', insufficient_data: '표본 부족' };

type Tab = 'overview' | 'forecast' | 'risks' | 'scenarios' | 'warnings' | 'trends'
  | 'relationships' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'forecast', label: 'Forecast', icon: CloudSun },
  { key: 'risks', label: 'Risks', icon: Shield },
  { key: 'scenarios', label: 'Scenarios', icon: Layers },
  { key: 'warnings', label: 'Early Warnings', icon: Bell },
  { key: 'trends', label: 'Trends', icon: TrendingUp },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Forecast Engine/Risk Engine/Scenario Engine 생성 없음 — 기존 원장 통합 조회 계층입니다',
  '신규 Migration/RPC 없음 — Revenue Forecast RPC/AI-OPS-39 Forecast Intel/0528 Risk/0516 Strategic Scenario/0496 Governance/관측 피드 재사용(읽기 전용)',
  'AI 는 미래를 단정하지 않습니다 — Forecast/Risk/Scenario 자동 생성은 금지 목록이며 기존 기록만 표시합니다',
  'Resource/Capacity Forecast 는 전용 원장 부재(실측) — 미관측으로만 표시(추론 없음)',
  'Security Risk 실시간 피드 미연결(실측) — 항상 미관측 표시. Strategic Risk 는 0528 원장 관측 여부만 표시(재계산 없음)',
  'Scenario 케이스 분류는 실측 scenario_type 의 결정적 substring 매핑이며, 실측 타입 목록을 함께 공개합니다',
  'Forecast Deviations 는 Forecast 대비 실측 편차 판정 피드 부재(실측) — 항상 미관측',
  'Trend 는 30d 관측 구간 전·후반 비교(E-2 로직 재사용), Early Warning 은 E-1 Alert 파생 규칙 재사용 — 예측/중복 로직 없음',
  'Executive Outlook Summary 는 관측값 기반 결정적 문장(5줄 이내)이며 미래 단정/승인이 아닙니다',
  '자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function ForesightRiskCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<ForesightFeeds>(emptyForesightFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const results = await Promise.allSettled([
        fetchRevenueForecast(), fetchRevenueTrend('30d'), fetchBusinessGrowth('30d'), fetchStreamingTimeline('30d'),
        fetchNocKpi(), fetchStreamingSummary(), fetchRevenueSummary(), fetchReadableSettlementKpi(month),
        fetchArtistSummary(), fetchForecastIntelSummary(), fetchRiskSummary(), fetchStratScenarios(null, null, 100),
        fetchGovernanceSummary(), fetchEnterprisePerformanceSummary(),
      ]);
      const keys = ['revenueForecast', 'revenueTrend', 'businessGrowth', 'streamingTimeline', 'noc', 'streaming',
        'revenue', 'settlementKpi', 'artist', 'forecastIntel', 'riskSummary', 'scenarios', 'govSummary', 'performance'] as const;
      const next = emptyForesightFeeds();
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status !== 'fulfilled' || r.value == null) { failed.push(k); return; }
        if (k === 'govSummary') {
          next.govEvents = (r.value as { events?: { violations: number; overrides: number; checks: number } | null }).events ?? null;
          if (next.govEvents == null) failed.push('govEvents');
        } else if (k === 'scenarios') {
          next.scenarios = r.value as FRScenarioRow[];
        } else {
          (next as unknown as Record<string, unknown>)[k] = r.value;
        }
      });
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const overview = useMemo(() => buildForesightOverview(feeds), [feeds]);
  const forecasts = useMemo(() => summarizeForecasts(feeds), [feeds]);
  const scenarios = useMemo(() => summarizeScenarios(feeds.scenarios), [feeds]);
  const relationships = useMemo(() => buildForesightRelationships(feeds), [feeds]);
  const quality = useMemo(() => assessForesightQuality(feeds), [feeds]);
  const summaryLines = useMemo(() => buildOutlookSummaryLines({
    operationalTrend: overview.trends.find((t) => t.area === 'operational')?.direction ?? 'insufficient_data',
    revenueForecastObserved: feeds.revenueForecast != null,
    criticalRisks: overview.warnings.criticalAlerts,
    scenarioTotal: scenarios.total,
    expectedCaseCount: scenarios.cases.find((c) => c.scenarioCase === 'expected_case')?.count ?? null,
  }), [overview, feeds, scenarios]);

  if (loading) return <AdminCard title="Foresight & Risk Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Foresight & Risk Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const qualityTone = (l: string) => (l === 'healthy' ? 'success' : l === 'attention' ? 'warning' : l === 'critical' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';

  return (
    <AdminCard
      title="Foresight & Risk Center"
      subtitle="Forecast·Risk·Scenario·Trend·Early Warning·Executive Outlook 통합 Executive Foresight Layer — AI 는 연결·설명만, 미래 단정 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 Forecast·Risk·Scenario·Trend·Alert 기록을 하나의 화면에서 연결하는 Executive Foresight Layer 입니다. AI 는 미래를 단정하지 않으며, 기존 데이터를 연결하고 설명하고 우선순위를 제시할 뿐입니다. 자동 Forecast 생성·자동 Risk 생성·자동 Scenario 생성·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Executive Outlook" value={overview.card.executiveOutlook} />
            <Box label="Forecast Health (관측 종류)" value={`${overview.card.forecastObserved}/5`} />
            <Box label="Risk Status" value={overview.card.riskStatus} />
            <Box label="Active Warnings" value={NUM(overview.card.activeWarnings)} />
            <Box label="Trend Status (판정 수)" value={`${overview.card.trendMeasured}/5`} />
            <Box label="Scenario Coverage" value={NUM(overview.card.scenarioCoverage)} />
            <Box label="Emerging Opportunities (상승 추세)" value={NUM(overview.card.emergingOpportunities)} />
            <Box label="Emerging Risks (하락+주의)" value={NUM(overview.card.emergingRisks)} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 미관측으로만 표시됩니다(추론 없음).`} />
          )}
        </div>
      )}

      {tab === 'forecast' && (
        <div className="space-y-2">
          {forecasts.map((f) => (
            <div key={f.kind} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={f.observed ? 'success' : 'neutral'}>{f.observed ? '관측됨' : '미관측'}</AdminBadge>
                <span className="text-xs font-bold">{f.kind} forecast</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{f.value != null ? `${NUM(f.value)}원 · ` : ''}{f.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Forecast 를 새로 생성하지 않습니다 — 기존 RPC/원장 관측값만 표시하며, 추정 ≠ 확정입니다.</p>
        </div>
      )}

      {tab === 'risks' && (
        <div className="space-y-2">
          {overview.risks.map((r) => (
            <div key={r.domain} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(r.level)}>{r.level}</AdminBadge>
                <span className="text-xs font-bold">{r.domain} risk</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{r.indicator != null ? `${NUM(r.indicator)}건 · ` : ''}{r.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Risk 를 새로 계산하지 않습니다 — 기존 관측값 연결이며, 세부 등급은 각 원장 화면에서 확인합니다.</p>
        </div>
      )}

      {tab === 'scenarios' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {scenarios.cases.map((c) => (
              <Box key={c.scenarioCase} label={c.scenarioCase} value={c.count == null ? '미관측' : `${NUM(c.count)}건`} />
            ))}
          </div>
          {(feeds.scenarios ?? []).slice(0, 20).map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-bold">{s.scenario_code} · {s.scenario_name}</span>
                <AdminBadge tone="neutral">{s.scenario_type}</AdminBadge>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{s.scenario_status} · conf {s.confidence == null ? '미관측' : s.confidence}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Strategic Scenario(0516) 조회 — 자동 생성 없음. 실측 타입: {scenarios.actualTypes.map((t) => `${t.type}(${t.count})`).join(', ') || '미관측'} · Scenario ≠ 현실.</p>
        </div>
      )}

      {tab === 'warnings' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Box label="Critical Alerts" value={NUM(overview.warnings.criticalAlerts)} />
            <Box label="Warning Alerts" value={NUM(overview.warnings.warningAlerts)} />
            <Box label="Trend Changes" value={NUM(overview.warnings.trendChanges)} />
            <Box label="Forecast Deviations" value={overview.warnings.forecastDeviations == null ? '미관측(판정 피드 부재)' : NUM(overview.warnings.forecastDeviations)} />
            <Box label="Risk Escalations (위반)" value={NUM(overview.warnings.riskEscalations)} />
          </div>
          {overview.warnings.alerts.length === 0
            ? <AdminEmpty title="활성 Alert 없음" description="관측된 피드 기준 활성 Alert 가 없습니다." />
            : overview.warnings.alerts.map((a) => (
              <div key={a.key} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone={a.priority === 'critical' ? 'danger' : a.priority === 'high' ? 'warning' : 'neutral'}>{a.priority}</AdminBadge>
                  <span className="truncate text-xs font-bold">{a.message}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{a.evidence}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">E-1 Alert 파생 규칙 재사용 — {overview.warnings.unobservedNote}.</p>
        </div>
      )}

      {tab === 'trends' && (
        <div className="space-y-2">
          {overview.trends.map((t) => (
            <div key={t.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={t.direction === 'up' ? 'success' : t.direction === 'down' ? 'danger' : 'neutral'}>{DIR_LABEL[t.direction]}</AdminBadge>
                <span className="text-xs font-bold">{t.area} trend</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{t.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">E-2 추세 로직 재사용 — 관측 구간 내 비교이며 미래 예측이 아닙니다.</p>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-1">
          {relationships.map((r, i) => (
            <div key={r.stage}>
              <div className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{r.stage}</span>
                  <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                </div>
                <span className="text-[10px] text-muted-foreground">{i < FORESIGHT_RELATIONSHIP_EDGES.length ? FORESIGHT_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Performance→Trend→Forecast→Risk→Scenario→Executive Outlook — 전망 판단과 대응 결정은 사람이 수행합니다.</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 미래 단정/예측/승인 아님.</p>
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-1">
          {quality.map((q) => (
            <div key={q.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(q.level)}>{q.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{q.area}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{q.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Healthy/Attention/Critical/Insufficient Data — 없는 데이터를 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
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
