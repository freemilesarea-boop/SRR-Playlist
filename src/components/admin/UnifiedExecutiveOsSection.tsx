/**
 * UnifiedExecutiveOsSection — Enterprise E-10 (Unified Executive AI Operating System).
 *
 * E-1~E-9 Executive Layer 를 하나의 운영체계로 통합하는 최상위 계층.
 * 신규 Executive Engine/AI Engine/Agent/Knowledge Store/Timeline Engine/
 * Migration/RPC 없음 — 기존 원장 14종 재사용(읽기 전용), 계산은 E-1/E-2/E-3/
 * E-5/E-7/E-8 모듈 함수 재사용. AI 는 결정을 내리지 않는다 — 최종 결정은 사람.
 * (기존 ExecutiveOsSection(0533)과 별개, 미접촉)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, Bot, Database, Gauge, GitBranch, History,
  LayoutDashboard, Layers, Lock, RefreshCw,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchActionHistory, fetchNocKpi, fetchStreamingSummary, fetchRevenueSummary,
  fetchRevenueTrend, fetchRevenueForecast, fetchReadableSettlementKpi, fetchArtistSummary,
  fetchGovernanceSummary, fetchIncidents, fetchRecoveryCandidates, fetchStrategyPortfolios,
  fetchEnterprisePerformanceSummary, fetchEnterpriseResilienceSummary,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { analyzeTrendDirection, seriesOf } from '@/lib/enterpriseIntelligenceHub';
import {
  EXECUTIVE_LAYERS, OS_RELATIONSHIP_EDGES,
  assessOsQuality, buildCockpit, buildOsRelationships, buildOsSummaryLines,
  buildUnifiedTimeline, computeOsAnalytics, emptyOsFeeds,
  type OsFeeds, type OsIncidentRow, type OsRecoveryRow, type OsPortfolioRow, type OsActionRow,
} from '@/lib/unifiedExecutiveOS';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const DIR_LABEL: Record<string, string> = { up: '▲ 상승', down: '▼ 하락', flat: '― 유지', insufficient_data: '표본 부족' };

const LAYER_INFO: Record<(typeof EXECUTIVE_LAYERS)[number], { title: string; phase: string }> = {
  command: { title: 'Executive Command Center', phase: 'E-1' },
  intelligence: { title: 'Enterprise Intelligence Hub', phase: 'E-2' },
  decision: { title: 'Decision & Review Center', phase: 'E-3' },
  governance: { title: 'Governance & Compliance Center', phase: 'E-4' },
  knowledge: { title: 'Enterprise Knowledge Hub', phase: 'E-5' },
  performance: { title: 'Performance Intelligence (AI-OPS-44)', phase: 'AI-OPS-44' },
  strategy: { title: 'Strategy & Innovation Center', phase: 'E-7' },
  foresight: { title: 'Foresight & Risk Center', phase: 'E-8' },
  resilience: { title: 'Resilience & Recovery Center', phase: 'E-9' },
};

type Tab = 'cockpit' | 'workspace' | 'timeline' | 'relationships' | 'analytics' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'cockpit', label: 'Executive Cockpit', icon: LayoutDashboard },
  { key: 'workspace', label: 'Workspace', icon: Layers },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'analytics', label: 'Analytics', icon: Gauge },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Executive Engine/AI Engine/Agent/Knowledge Store/Timeline Engine 생성 없음 — E-1~E-9 Layer 를 연결하는 최상위 조회 계층입니다',
  '신규 Migration/RPC 없음 — 기존 원장 14종 재사용(읽기 전용), 계산은 E-1 Alert·Timeline/E-2 Trend/E-3 Decision Analytics/E-5 Knowledge Overview/E-7 일 단위 집계/E-8 worstQuality 모듈 함수 재사용',
  'AI 는 결정을 내리지 않습니다 — 요약·연결·우선순위 제안만 수행하며, 최종 결정은 사람입니다',
  'Workspace 는 동일 Dashboard 페이지에 이미 배선된 각 센터 섹션의 안내 목록입니다(스크롤 접근) — 별도 라우팅/새 화면 없음',
  'Enterprise Score 는 관측된 Layer 등급 환산 평균이며 관측 Layer <5 이면 산출하지 않습니다(과단정 방지) — Score ≠ 실제 기업 상태 보장',
  'Overall Confidence 는 피드 관측 커버리지(14종 중 관측 수)이며 실제 신뢰도가 아닙니다',
  'Enterprise Health Trend/Governance Trend/Strategy Trend 는 시계열 저장소·피드 부재(실측) — 신규 저장소를 만들지 않고 미관측으로 표시합니다',
  'Layer 등급은 대표 피드 기반 관측 요약이며 각 센터의 세부 판정을 대체하지 않습니다',
  'AI Summary 마지막 줄은 스펙 고정 문구이며, 미관측 값은 수치를 지어내지 않습니다',
  '자동 Executive Decision/자동 Strategy 생성/자동 Governance 승인/자동 계약 승인/자동 지급/자동 Recovery 실행/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function UnifiedExecutiveOsSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [feeds, setFeeds] = useState<OsFeeds>(emptyOsFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const results = await Promise.allSettled([
        fetchActionHistory(100), fetchNocKpi(), fetchStreamingSummary(), fetchRevenueSummary(),
        fetchRevenueTrend('30d'), fetchRevenueForecast(), fetchReadableSettlementKpi(month), fetchArtistSummary(),
        fetchGovernanceSummary(), fetchIncidents(null, null, 100), fetchRecoveryCandidates(null, null, 100),
        fetchStrategyPortfolios(null, 100), fetchEnterprisePerformanceSummary(), fetchEnterpriseResilienceSummary(),
      ]);
      const keys = ['actionHistory', 'noc', 'streaming', 'revenue', 'revenueTrend', 'revenueForecast',
        'settlementKpi', 'artist', 'govSummary', 'incidents', 'recoveries', 'portfolios', 'performance', 'resilienceSummary'] as const;
      const next = emptyOsFeeds();
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status !== 'fulfilled' || r.value == null) { failed.push(k); return; }
        if (k === 'govSummary') {
          next.govEvents = (r.value as { events?: { violations: number; overrides: number; checks: number } | null }).events ?? null;
          if (next.govEvents == null) failed.push('govEvents');
        } else if (k === 'actionHistory') {
          next.actionHistory = r.value as OsActionRow[];
        } else if (k === 'incidents') {
          next.incidents = r.value as OsIncidentRow[];
        } else if (k === 'recoveries') {
          next.recoveries = r.value as OsRecoveryRow[];
        } else if (k === 'portfolios') {
          next.portfolios = r.value as OsPortfolioRow[];
        } else {
          (next as unknown as Record<string, unknown>)[k] = r.value;
        }
      });
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cockpit = useMemo(() => buildCockpit(feeds), [feeds]);
  const timeline = useMemo(() => buildUnifiedTimeline(feeds), [feeds]);
  const relationships = useMemo(() => buildOsRelationships(feeds), [feeds]);
  const analytics = useMemo(() => computeOsAnalytics(feeds), [feeds]);
  const quality = useMemo(() => assessOsQuality(feeds), [feeds]);
  const summaryLines = useMemo(() => buildOsSummaryLines({
    enterpriseHealth: cockpit.card.enterpriseHealth,
    governanceViolations: feeds.govEvents?.violations ?? null,
    openIncidents: feeds.incidents == null ? null : feeds.incidents.filter((i) => i.resolved_at == null).length,
    performanceTrend: analyzeTrendDirection(seriesOf(feeds.revenueTrend, 'revenue')).direction,
  }), [cockpit, feeds]);

  if (loading) return <AdminCard title="Unified Executive AI Operating System"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Unified Executive AI Operating System">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const qualityTone = (l: string) => (l === 'healthy' ? 'success' : l === 'attention' ? 'warning' : l === 'critical' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';

  return (
    <AdminCard
      title="Unified Executive AI Operating System"
      subtitle="E-1~E-9 Executive Layer 통합 최상위 운영 계층 — AI 는 요약·연결·우선순위 제안만, 최종 결정은 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 화면은 Executive Command·Intelligence·Decision·Governance·Knowledge·Performance·Strategy·Foresight·Resilience Layer 를 하나의 운영체계로 통합하는 최상위 계층입니다. 신규 Executive Engine·AI Engine·Agent·Knowledge Store·Timeline Engine 은 만들지 않았고, AI 는 Enterprise 를 요약·연결하고 우선순위를 제안할 뿐 결정을 내리지 않습니다. 자동 Executive Decision·자동 Strategy 생성·자동 Governance 승인·자동 계약 승인·자동 지급·자동 Recovery 실행·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'cockpit' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Enterprise Health" value={cockpit.card.enterpriseHealth} />
            <Box label="Executive Status (Command)" value={cockpit.card.executiveStatus} />
            <Box label="Operational Stability (Resilience)" value={cockpit.card.operationalStability} />
            <Box label="Strategic Health (Strategy)" value={cockpit.card.strategicHealth} />
            <Box label="Governance Health" value={cockpit.card.governanceHealth} />
            <Box label="Executive Readiness (관측 Layer)" value={`${cockpit.card.executiveReadiness}/9`} />
            <Box label="Overall Confidence (관측 커버리지)" value={`${cockpit.card.overallConfidencePct}%`} />
            <Box label="Enterprise Score" value={cockpit.card.enterpriseScore == null ? '산출 보류(관측 <5)' : `${cockpit.card.enterpriseScore}점`} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 미관측으로만 표시됩니다(추론 없음).`} />
          )}
          <p className="text-[11px] text-muted-foreground">Enterprise Score 는 관측 Layer 등급 환산 평균 ≠ 실제 기업 상태 보장 · Overall Confidence 는 피드 관측 커버리지 ≠ 실제 신뢰도.</p>
        </div>
      )}

      {tab === 'workspace' && (
        <div className="space-y-1">
          {cockpit.layers.map((l) => (
            <div key={l.layer} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(l.level)}>{l.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{LAYER_INFO[l.layer].title}</span>
                <AdminBadge tone="neutral">{LAYER_INFO[l.layer].phase}</AdminBadge>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{l.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">모든 센터는 이 Dashboard 페이지에 이미 배선되어 있어 스크롤로 접근합니다 — 별도 라우팅/새 화면 없음(정직 고지).</p>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          {timeline.events.length === 0
            ? <AdminEmpty title="Timeline 없음" description="관측된 소스에 표시할 이벤트가 없습니다." />
            : timeline.events.map((e, i) => (
              <div key={`${e.at}-${e.label}-${i}`} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString('ko-KR')}</span>
                  <span className="truncate text-xs font-bold">{e.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{e.detail}</span>
                  <AdminBadge tone="neutral">{e.source}</AdminBadge>
                </div>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">E-1 병합 로직 재사용(신규 Timeline Engine 없음) — 소스: {timeline.observedSources.join(', ') || '없음'} · 불량 timestamp drop {NUM(timeline.droppedInvalid)}건.</p>
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
                <span className="text-[10px] text-muted-foreground">{i < OS_RELATIONSHIP_EDGES.length ? OS_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Command→…→Resilience→Enterprise — 각 단계의 승인·실행·최종 결정은 사람이 수행합니다.</p>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-2">
          {analytics.map((t) => (
            <div key={t.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={t.direction === 'up' ? 'success' : t.direction === 'down' ? 'danger' : 'neutral'}>{DIR_LABEL[t.direction]}</AdminBadge>
                <span className="text-xs font-bold">{t.area} trend</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{t.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">기존 Trend 로직(E-2/E-7/E-9) 재사용 — 관측 구간 내 비교이며 예측이 아닙니다. 시계열 부재 영역은 미관측으로 표시합니다.</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내, 마지막 줄 스펙 고정) — 판단/예측/승인 아님.</p>
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <AdminBadge tone={qualityTone(quality.overall)}>{quality.overall}</AdminBadge>
            <span className="text-xs font-bold">Enterprise Quality (관측 Layer 종합 — E-8 worstQuality 재사용)</span>
          </div>
          {quality.entries.map((q) => (
            <div key={q.layer} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(q.level)}>{q.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{LAYER_INFO[q.layer].title}</span>
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
