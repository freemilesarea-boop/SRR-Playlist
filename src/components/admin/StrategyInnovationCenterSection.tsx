/**
 * StrategyInnovationCenterSection — Enterprise E-7 (Strategy & Innovation Center).
 *
 * Strategy/Initiative/Opportunity/Innovation/Roadmap/Business Alignment 통합
 * Executive Strategy Layer. 신규 Strategy Engine/Innovation Engine/Roadmap Engine/
 * Migration/RPC 없음 — 기존 원장(AI-OPS-46 Portfolio · 0524 Roadmap ·
 * 0562 Innovation · 0561 Improvement · 0555 Mission · 0563 Foresight ·
 * AI-OPS-44 Performance · 0503 Exec Recommendation) 재사용(읽기 전용).
 * AI 는 전략을 결정하지 않는다 — 후보와 근거를 정리·연결만 한다.
 * (기존 ExecutiveStrategySection(0511)/CorporateStrategySection(0524)/
 *  StrategyIntelligenceSection(AI-OPS-41)/InnovationIntelligenceSection(0562)과 별개)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, Bot, Compass, Database, Gauge, GitBranch,
  LayoutDashboard, Lightbulb, Lock, Map, RefreshCw, Target,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge } from '@/components/admin/ui';
import {
  fetchStrategyPortfolios, fetchRoadmapItems, fetchEnterpriseInnovations,
  fetchEnterpriseImprovements, fetchEnterpriseMissions, fetchEnterpriseForesights,
  fetchEnterprisePerformanceSummary, fetchExecRecommendations,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  STRATEGY_RELATIONSHIP_EDGES,
  assessStrategyQuality, bucketizeInitiatives, buildStrategyOverview, buildStrategyRelationships,
  buildStrategySummaryLines, computeStrategyAnalytics, emptyStrategyFeeds, summarizeAlignment,
  summarizeInnovation, summarizeRoadmap,
  type StrategyFeeds,
} from '@/lib/strategyInnovationCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const PCT = (n: number | null) => (n == null ? '측정 불가' : `${n}%`);

type Tab = 'overview' | 'initiatives' | 'innovation' | 'alignment' | 'roadmap'
  | 'relationships' | 'analytics' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'initiatives', label: 'Initiatives', icon: Target },
  { key: 'innovation', label: 'Innovation', icon: Lightbulb },
  { key: 'alignment', label: 'Business Alignment', icon: Compass },
  { key: 'roadmap', label: 'Roadmap', icon: Map },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'analytics', label: 'Analytics', icon: Gauge },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Strategy Engine/Innovation Engine/Roadmap Engine 생성 없음 — 기존 원장 통합 조회 계층입니다',
  '신규 Migration/RPC 없음 — AI-OPS-46 Portfolio/0524 Roadmap/0562 Innovation/0561 Improvement/0555 Mission/0563 Foresight/AI-OPS-44 Performance/0503 Exec Recommendation 재사용(읽기 전용)',
  'AI 는 전략을 결정하지 않습니다 — Strategy/Initiative/Roadmap 자동 생성은 금지 목록이며, 생성·승인·변경은 각 기존 화면의 절차로 사람이 수행합니다',
  'Initiative/Roadmap 버킷은 실측 상태 문자열의 결정적 매핑이며, 매핑 불가 상태는 other 로 정직 공개합니다',
  'Roadmap Delayed 는 지연 판정 필드가 원장에 부재(실측)하여 항상 미관측으로 표시합니다 — 추론 없음',
  'Business Alignment 는 Mission(0555) 카테고리를 스펙 5목표에 연결만 하며, 스펙 외 카테고리는 별도 공개합니다',
  'Improvement Trend 는 관측 창 내 created_at 일 단위 집계의 전·후반 비교(E-2 로직 재사용)이며 미래 예측이 아닙니다',
  'Strategic Risk 는 risk_status 에 high 가 포함된 건수 집계이며 위험 재평가가 아닙니다',
  'AI Strategy Summary 는 관측값 기반 결정적 문장(5줄 이내)이며 판단/예측/승인이 아닙니다',
  '자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function StrategyInnovationCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<StrategyFeeds>(emptyStrategyFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const keys = ['portfolios', 'roadmapItems', 'innovations', 'improvements', 'missions', 'foresights', 'performance', 'execRecommendations'] as const;
      const results = await Promise.allSettled([
        fetchStrategyPortfolios(null, 100), fetchRoadmapItems(null, 100),
        fetchEnterpriseInnovations(null, null, 100), fetchEnterpriseImprovements(null, null, 100),
        fetchEnterpriseMissions(null, null, 100), fetchEnterpriseForesights(null, null, 100),
        fetchEnterprisePerformanceSummary(), fetchExecRecommendations(null, null, null, 100),
      ]);
      const next = emptyStrategyFeeds();
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) (next as unknown as Record<string, unknown>)[k] = r.value;
        else failed.push(k);
      });
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const overview = useMemo(() => buildStrategyOverview(feeds), [feeds]);
  const initiatives = useMemo(() => bucketizeInitiatives(feeds.portfolios?.map((p) => ({ status: p.portfolio_status })) ?? null), [feeds]);
  const innovation = useMemo(() => summarizeInnovation(feeds), [feeds]);
  const alignment = useMemo(() => summarizeAlignment(feeds.missions), [feeds]);
  const roadmap = useMemo(() => summarizeRoadmap(feeds.roadmapItems), [feeds]);
  const relationships = useMemo(() => buildStrategyRelationships(feeds), [feeds]);
  const analytics = useMemo(() => computeStrategyAnalytics(feeds), [feeds]);
  const quality = useMemo(() => assessStrategyQuality(feeds), [feeds]);
  const summaryLines = useMemo(() => buildStrategySummaryLines({
    activeInitiatives: overview.activeInitiatives,
    topImprovementCategory: innovation.byImprovementCategory[0]?.category ?? null,
    roadmapProgressPct: overview.roadmapProgressPct,
    strategicRisks: overview.strategicRisks,
    opportunityCount: analytics.opportunityCount,
  }), [overview, innovation, analytics]);

  if (loading) return <AdminCard title="Strategy & Innovation Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Strategy & Innovation Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const qualityTone = (l: string) => (l === 'healthy' ? 'success' : l === 'attention' ? 'warning' : l === 'critical' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';

  return (
    <AdminCard
      title="Strategy & Innovation Center"
      subtitle="Strategy·Initiative·Opportunity·Innovation·Roadmap·Business Alignment 통합 Executive Strategy Layer — AI 는 정리·연결만, 결정은 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 Intelligence·Decision·Governance·Knowledge·Performance 기반의 전략 정보를 하나의 화면에 통합하는 Executive Strategy Layer 입니다. AI 는 전략을 결정하지 않으며, 기존 데이터 기반 후보와 근거를 정리·연결만 합니다. 자동 Strategy 생성·자동 Initiative 생성·자동 Roadmap 생성·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Strategic Health" value={overview.strategicHealth} />
            <Box label="Active Initiatives" value={NUM(overview.activeInitiatives)} />
            <Box label="Innovation Status (후보)" value={NUM(overview.innovationStatus)} />
            <Box label="Roadmap Progress" value={PCT(overview.roadmapProgressPct)} />
            <Box label="Business Alignment" value={PCT(overview.businessAlignmentPct)} />
            <Box label="Executive Focus (제안)" value={NUM(overview.executiveFocus)} />
            <Box label="Strategic Risks (high)" value={NUM(overview.strategicRisks)} />
            <Box label="Strategic Opportunities" value={NUM(overview.strategicOpportunities)} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 미관측으로만 표시됩니다(추론 없음).`} />
          )}
        </div>
      )}

      {tab === 'initiatives' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {initiatives.buckets.map((b) => (
              <Box key={b.bucket} label={`${b.bucket} initiatives`} value={b.count == null ? '미관측' : `${NUM(b.count)}건`} />
            ))}
          </div>
          {(feeds.portfolios ?? []).slice(0, 20).map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-bold">{p.portfolio_code} · {p.portfolio_name}</span>
                <AdminBadge tone="neutral">{p.portfolio_status}</AdminBadge>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">initiative 참조 {NUM(Array.isArray(p.initiative_references) ? p.initiative_references.length : null)}건</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Strategy Portfolio(AI-OPS-46) 조회 — Initiative 를 새로 생성하지 않습니다. 매핑 불가 상태: {initiatives.otherStatuses.map((s) => `${s.status}(${s.count})`).join(', ') || '없음'}</p>
        </div>
      )}

      {tab === 'innovation' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Innovation Candidates (0562)" value={NUM(innovation.innovationCandidates)} />
            <Box label="Improvement Opportunities (0561)" value={NUM(innovation.improvementOpportunities)} />
            <Box label="High 위험 Innovation" value={NUM(innovation.highRiskInnovations)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {innovation.byImprovementCategory.map((c) => (
              <AdminBadge key={c.category} tone="neutral">{c.category} · {c.count}</AdminBadge>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">기존 Innovation(0562)/Improvement(0561) 원장 조회 — 새로운 Innovation Engine 없음. 카테고리는 실측 improvement_category 그대로입니다.</p>
        </div>
      )}

      {tab === 'alignment' && (
        <div className="space-y-2">
          {alignment.goals.map((g) => (
            <div key={g.goal} className="flex items-center justify-between rounded-lg border border-border p-2">
              <span className="text-xs font-bold">{g.goal} goals</span>
              <span className="text-[10px] text-muted-foreground">{g.count == null ? `미관측 — ${g.note}` : `${NUM(g.count)}건 (${g.note})`}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Mission(0555) 카테고리를 스펙 5목표에 연결 — 스펙 외 카테고리: {alignment.otherCategories.map((c) => `${c.category}(${c.count})`).join(', ') || '없음'} · Alignment {PCT(alignment.alignmentPct)}(매핑된 목표 비율 ≠ 전략 적합성)</p>
        </div>
      )}

      {tab === 'roadmap' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {roadmap.buckets.map((b) => (
              <Box key={b.bucket} label={`${b.bucket} roadmap`} value={b.count == null ? '미관측' : `${NUM(b.count)}건`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {roadmap.byPhase.map((p) => <AdminBadge key={p.phase} tone="neutral">{p.phase} · {p.count}</AdminBadge>)}
          </div>
          <p className="text-[11px] text-muted-foreground">Roadmap(0524) 조회 — 자동 생성 없음. 전체 {NUM(roadmap.total)}건 / 완료율 {PCT(roadmap.progressPct)} · Delayed 는 지연 판정 필드 부재로 미관측(추론 없음).</p>
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
                <span className="text-[10px] text-muted-foreground">{i < STRATEGY_RELATIONSHIP_EDGES.length ? STRATEGY_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Knowledge→Performance→Opportunity→Initiative→Strategy→Enterprise — Initiative 정리와 전략 승인은 사람이 수행합니다.</p>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Initiative Progress" value={PCT(analytics.initiativeProgressPct)} />
            <Box label="Completion Rate" value={PCT(analytics.completionRatePct)} />
            <Box label="Delayed Items" value={analytics.delayedItems == null ? '미관측(판정 필드 부재)' : NUM(analytics.delayedItems)} />
            <Box label="Improvement Trend" value={analytics.improvementTrend} />
            <Box label="Opportunity Count" value={NUM(analytics.opportunityCount)} />
            <Box label="Strategic Alignment" value={PCT(analytics.strategicAlignmentPct)} />
          </div>
          <p className="text-[11px] text-muted-foreground">Improvement Trend 는 관측 창 내 일 단위 집계의 전·후반 비교(E-2 로직 재사용) — 예측 아님. 측정 불가 값은 null(조작 없음).</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 전략 결정/예측/승인 아님.</p>
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
