/**
 * AiDecisionIntelligenceSection — Decision Intelligence (Phase AI-RECOMMENDATION-3).
 *
 * 추천 우선순위를 **실제 운영 결과(Outcome)** 기반으로 동적 계산해 보여준다. AI/LLM 이
 * 순위를 임의로 바꾸지 않으며, 이 단계는 **순위 계산만** 한다(Rule/Threshold/Weight 자동
 * 변경 없음). 순위/신뢰도/품질은 기존 recommendation history(0481)+outcomes(0482) 집계를
 * 재사용(decision_stats)해 프론트 decisionIntel.ts 로 계산한다.
 *
 * 탭: Overview · Ranking · History · Similar Cases · Quality · Timeline.
 * History 없는 추천은 자동으로 상위로 올라가지 않는다(성분 0). 샘플 부족 → '신뢰도 낮음'.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain, ListOrdered, History as HistoryIcon, Copy, Gauge, GitCommitHorizontal, RefreshCw, Inbox, Trophy, ThumbsDown,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchMemberGrowthKpis, fetchRevenueKpis, fetchBusinessSummary, fetchArtistBreakdown,
  fetchNocKpi, fetchStreamV2Health, fetchNowPlayingKpi,
  fetchDecisionStats, fetchOutcomes, saveRankingSnapshot,
  type DecisionStatRow, type OutcomeRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { generateRecommendations, CATEGORY_LABEL, type RecommendationInputs } from '@/lib/aiRecommendation';
import {
  rankRecommendations, buildBoard, summarizeHistory, findSimilarCases, confidenceLabel,
  RANK_COMPONENT_LABEL,
  type DecisionStat, type LiveRec, type RankedRecommendation, type CaseRecord, type HistorySummary,
} from '@/lib/decisionIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

// 추천별 Root Cause 후보 지원(시계열 존재) — coverage proxy. 시계열 없는 추천은 0.
const ROOTCAUSE_SUPPORT: Record<string, { supported: number; total: number }> = {
  revenue_drop: { supported: 6, total: 6 }, signup_drop: { supported: 2, total: 2 },
  business_stall: { supported: 1, total: 1 }, streaming_health: { supported: 3, total: 3 },
  playback_error: { supported: 3, total: 3 },
};

function toStat(r: DecisionStatRow): DecisionStat {
  return {
    recommendationKey: r.recommendation_key, considered: r.considered, dismissed: r.dismissed, resolved: r.resolved,
    executed: r.executed, improved: r.improved, unchanged: r.unchanged, worsened: r.worsened,
    insufficient: r.insufficient, pending: r.pending, avgDelta: r.avg_delta, successRate: r.success_rate, lastAt: r.last_at,
  };
}

type Tab = 'overview' | 'ranking' | 'history' | 'similar' | 'quality' | 'timeline';
const TABS: { key: Tab; label: string; icon: typeof Brain }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'ranking', label: 'Ranking', icon: ListOrdered },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'similar', label: 'Similar Cases', icon: Copy },
  { key: 'quality', label: 'Quality', icon: Gauge },
  { key: 'timeline', label: 'Timeline', icon: GitCommitHorizontal },
];

export default function AiDecisionIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [ranked, setRanked] = useState<RankedRecommendation[] | null>(null);
  const [stats, setStats] = useState<DecisionStat[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const settle = async <T,>(p: Promise<T>) => p.catch(() => null);
      const [member, revenue, business, artist, noc, streamHealth, nowPlaying, decisionStats, oc] = await Promise.all([
        settle(fetchMemberGrowthKpis()), settle(fetchRevenueKpis()), settle(fetchBusinessSummary()),
        settle(fetchArtistBreakdown()), settle(fetchNocKpi()), settle(fetchStreamV2Health(7)),
        settle(fetchNowPlayingKpi()), settle(fetchDecisionStats()), settle(fetchOutcomes({ limit: 100 })),
      ]);
      const inputs: RecommendationInputs = {
        memberThisMonth: member?.this_month ?? null, memberLastMonth: member?.last_month ?? null, memberMomRate: member?.mom_growth_rate ?? null,
        revenueThis: revenue?.month_revenue ?? null, revenueLast: revenue?.last_month_revenue ?? null, revenueGrowthThis: revenue?.revenue_growth_this ?? null,
        paymentFailures: revenue?.failed_payments ?? null,
        businessTotal: business?.total_business ?? null, businessMonthSignups: business?.month_signups ?? null,
        offlinePlayers: business?.offline_players ?? null, totalPlayers: business?.total_players ?? null,
        qcPending: artist?.qc.pending ?? null, settlementPending: artist?.settlement.pending ?? null,
        streamHealth: streamHealth?.overall_health ?? null, playbackErrors: nowPlaying?.error_count ?? null,
        offlineStores: noc?.offline_stores ?? null, todayIncidents: noc?.today_incidents ?? null,
      };
      const recs = generateRecommendations(inputs);
      const liveRecs: LiveRec[] = recs.map((r) => ({
        ruleKey: r.ruleKey, category: r.category, title: r.title,
        evidenceCount: r.evidence.length, evidenceSatisfied: r.evidence.filter((e) => e.satisfied).length,
        baseConfidence: r.confidence, baseScore: r.score,
        rootCauseSupported: ROOTCAUSE_SUPPORT[r.ruleKey]?.supported ?? 0, rootCauseTotal: ROOTCAUSE_SUPPORT[r.ruleKey]?.total ?? 0,
      }));
      const st = (decisionStats ?? []).map(toStat);
      setStats(st);
      setOutcomes(oc ?? []);
      setRanked(rankRecommendations(liveRecs, st, Date.now()));
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function snapshot() {
    if (!ranked || ranked.length === 0) { toast.error('저장할 순위가 없습니다.'); return; }
    setBusy(true);
    try {
      await saveRankingSnapshot(ranked.map((r, i) => ({ rule_key: r.ruleKey, rank: i + 1, score: r.score, confidence: r.confidence, quality: r.quality })));
      toast.success('순위 스냅샷 저장(Ranking History)');
    } catch (e) { toast.error(`저장 실패: ${friendlyError(e, '0483 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  const board = useMemo(() => buildBoard(stats), [stats]);
  const summaries = useMemo(() => stats.map(summarizeHistory).sort((a, b) => b.considered - a.considered), [stats]);
  const caseRecords: CaseRecord[] = useMemo(() => outcomes.map((o) => ({
    ruleKey: o.recommendation_key, category: '', metricKey: o.metric_key, outcomeStatus: o.outcome_status, delta: o.delta, at: o.after_at ?? o.before_at,
  })), [outcomes]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Brain size={16} /> Decision Intelligence</span>}
      subtitle="실제 Outcome 기반 추천 우선순위 계산 — AI 임의 변경 없음, 순위 계산만(Rule/Weight 무변경)"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 갱신
          </button>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {err && <AdminAlert tone="warning" title="Decision 데이터를 불러오지 못했어요" description={`${err.message} · 0481~0483 미적용 시 집계가 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'overview' && <OverviewTab board={board} ranked={ranked} stats={stats} loading={loading} />}
      {tab === 'ranking' && <RankingTab ranked={ranked} loading={loading} busy={busy} onSnapshot={snapshot} />}
      {tab === 'history' && <HistoryTab summaries={summaries} loading={loading} />}
      {tab === 'similar' && <SimilarTab ranked={ranked} caseRecords={caseRecords} />}
      {tab === 'quality' && <QualityTab ranked={ranked} loading={loading} />}
      {tab === 'timeline' && <TimelineTab outcomes={outcomes} nowMs={nowMs} />}
    </AdminCard>
  );
}

/* ── Overview (Decision Dashboard) ─────────────────────────── */
function OverviewTab({ board, ranked, stats, loading }: { board: ReturnType<typeof buildBoard>; ranked: RankedRecommendation[] | null; stats: DecisionStat[]; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  const totalExecuted = stats.reduce((s, x) => s + x.executed, 0);
  const totalImproved = stats.reduce((s, x) => s + x.improved, 0);
  const overallSr = totalExecuted > 0 ? Math.round((totalImproved / Math.max(1, stats.reduce((s, x) => s + x.improved + x.unchanged + x.worsened, 0))) * 1000) / 10 : null;
  const cards: { label: string; value: string; tone?: 'success' | 'warning' | 'neutral' }[] = [
    { label: '순위 추천', value: NUM(ranked?.length ?? 0) },
    { label: '총 실행(Outcome)', value: NUM(totalExecuted), tone: 'neutral' },
    { label: '총 개선', value: NUM(totalImproved), tone: totalImproved ? 'success' : 'neutral' },
    { label: '전체 성공률', value: overallSr != null ? `${overallSr}%` : '—', tone: 'neutral' },
    { label: '집계 추천 유형', value: NUM(stats.length) },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-bg-deep p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">{c.label}</p>
            <p className="mt-1 text-lg font-bold text-ink" style={c.tone === 'success' ? { color: '#34d399' } : undefined}>{c.value}</p>
          </div>
        ))}
      </div>
      {stats.length === 0
        ? <AdminAlert tone="info" title="집계된 Outcome/History 없음" description="추천 실행/처리 기록이 쌓이면 순위·성공률이 계산됩니다(추정 없음)." />
        : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BoardCard title="Most Executed" icon={<Trophy size={13} />} rows={board.mostExecuted} metric={(r) => `${NUM(r.executed)}회`} />
          <BoardCard title="Highest Success" icon={<Trophy size={13} />} rows={board.highestSuccess} metric={(r) => r.successRate != null ? `${r.successRate}%` : '—'} />
          <BoardCard title="Lowest Success" icon={<ThumbsDown size={13} />} rows={board.lowestSuccess} metric={(r) => r.successRate != null ? `${r.successRate}%` : '—'} />
          <BoardCard title="Most Ignored" icon={<ThumbsDown size={13} />} rows={board.mostIgnored} metric={(r) => `${NUM(r.dismissed)} dismiss`} />
        </div>}
    </div>
  );
}
function BoardCard({ title, icon, rows, metric }: { title: string; icon: React.ReactNode; rows: HistorySummary[]; metric: (r: HistorySummary) => string }) {
  return (
    <div className="rounded-xl bg-bg-deep p-3">
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-ink">{icon} {title}</p>
      {rows.length === 0 ? <p className="text-[10px] text-ink-dim">데이터 없음</p>
        : <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.recommendationKey} className="flex items-center justify-between text-[11px]">
              <span className="text-ink-mute">{r.recommendationKey}</span>
              <span className="tabular-nums text-ink">{metric(r)}</span>
            </div>
          ))}
        </div>}
    </div>
  );
}

/* ── Ranking (Explainable breakdown) ───────────────────────── */
function RankingTab({ ranked, loading, busy, onSnapshot }: { ranked: RankedRecommendation[] | null; loading: boolean; busy: boolean; onSnapshot: () => void }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!ranked || ranked.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="순위 대상 추천 없음" description="현재 활성 추천이 없습니다." />;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink-mute">실제 Outcome 기반 순위 · 성분 전부 공개(Explainability)</p>
        <button disabled={busy} onClick={onSnapshot} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">순위 스냅샷 저장</button>
      </div>
      {ranked.map((r, i) => (
        <div key={r.ruleKey} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-dim">#{i + 1}</span>
                <span className="text-xs font-bold text-ink">{r.title}</span>
                <AdminBadge tone="neutral" size="sm">{CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category}</AdminBadge>
                {r.lowConfidence && <AdminBadge tone="warning" size="sm">신뢰도 낮음</AdminBadge>}
              </div>
              <p className="mt-1 text-[10px] text-ink-dim">
                {(['evidence', 'history', 'outcome', 'coverage', 'freshness'] as const).map((k) => `${RANK_COMPONENT_LABEL[k]} ${r.breakdown[k]}`).join(' · ')} = <b className="text-ink">{r.breakdown.total}</b>
              </p>
              <p className="mt-0.5 text-[10px] text-ink-dim">Confidence {r.confidence} ({confidenceLabel(r.confidence, r.lowConfidence)}) · Quality {r.quality} · 성공률 {r.successRate != null ? `${r.successRate}%` : '—'} · 실행 {NUM(r.executed)}</p>
            </div>
            <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{r.score}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── History (Historical Recommendation Analysis) ──────────── */
function HistoryTab({ summaries, loading }: { summaries: HistorySummary[]; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (summaries.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="History 없음" description="처리/실행 기록이 없습니다 (0481~0482 미적용 시 비어 있음)." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">추천</th>
            <th className="px-2 py-2 text-right font-semibold">기록</th>
            <th className="px-2 py-2 text-right font-semibold">실행</th>
            <th className="px-2 py-2 text-right font-semibold">개선</th>
            <th className="px-2 py-2 text-right font-semibold">변화없음</th>
            <th className="px-2 py-2 text-right font-semibold">악화</th>
            <th className="px-2 py-2 text-right font-semibold">성공률</th>
            <th className="px-2 py-2 text-right font-semibold">평균Δ</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.recommendationKey} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-2 font-semibold text-ink">{s.recommendationKey}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(s.considered)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(s.executed)}</td>
              <td className="px-2 py-2 text-right tabular-nums" style={{ color: s.improved ? '#34d399' : undefined }}>{NUM(s.improved)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(s.unchanged)}</td>
              <td className="px-2 py-2 text-right tabular-nums" style={{ color: s.worsened ? '#f87171' : undefined }}>{NUM(s.worsened)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink">{s.successRate != null ? `${s.successRate}%` : '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{s.avgDelta != null ? s.avgDelta : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Similar Cases ─────────────────────────────────────────── */
function SimilarTab({ ranked, caseRecords }: { ranked: RankedRecommendation[] | null; caseRecords: CaseRecord[] }) {
  if (!ranked || ranked.length === 0) return <AdminEmpty icon={<Copy size={24} />} title="현재 추천 없음" description="유사 사례를 비교할 활성 추천이 없습니다." />;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">현재 추천별 과거 유사 사례(실제 Outcome 기록) 비교</p>
      {ranked.map((r) => {
        const sim = findSimilarCases({ ruleKey: r.ruleKey, category: r.category, metricKeys: [] }, caseRecords);
        return (
          <div key={r.ruleKey} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink">{r.title}</span>
              <AdminBadge tone={sim.matchCount > 0 ? 'info' : 'neutral'} size="sm">{sim.matchCount > 0 ? `유사 ${sim.matchCount}건` : '유사 사례 없음'}</AdminBadge>
            </div>
            {sim.matchCount > 0 && (
              <p className="mt-1 text-[10px] text-ink-dim">최빈 결과 {sim.topOutcome} · 개선율 {sim.improvedRate != null ? `${sim.improvedRate}%` : '—'} · 평균 Δ {sim.avgDelta != null ? sim.avgDelta : '—'}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Quality ───────────────────────────────────────────────── */
function QualityTab({ ranked, loading }: { ranked: RankedRecommendation[] | null; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!ranked || ranked.length === 0) return <AdminEmpty icon={<Gauge size={24} />} title="품질 대상 없음" description="현재 활성 추천이 없습니다." />;
  const sorted = [...ranked].sort((a, b) => b.quality - a.quality);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">Quality = Evidence·Outcome·Coverage·History·Freshness 평균</p>
      {sorted.map((r) => (
        <div key={r.ruleKey} className="flex items-center gap-2 rounded-xl bg-bg-deep p-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-ink">{r.title}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-card">
              <div className="h-full rounded-full bg-accent" style={{ width: `${r.quality}%` }} />
            </div>
          </div>
          <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{r.quality}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────────── */
function TimelineTab({ outcomes, nowMs }: { outcomes: OutcomeRow[]; nowMs: number }) {
  void nowMs;
  if (outcomes.length === 0) return <AdminEmpty icon={<GitCommitHorizontal size={24} />} title="Timeline 없음" description="Recommendation→Action→Outcome 기록이 없습니다 (0482 미적용 시 비어 있음)." />;
  const sorted = [...outcomes].sort((a, b) => Date.parse(b.before_at) - Date.parse(a.before_at)).slice(0, 20);
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-ink-mute">Recommendation → Action → Outcome 흐름(최근 20)</p>
      {sorted.map((o) => (
        <div key={o.id} className="flex items-center gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.outcome_status === 'improved' ? '#34d399' : o.outcome_status === 'worsened' ? '#f87171' : o.outcome_status === 'pending' ? '#38bdf8' : '#9ca3af' }} />
          <span className="min-w-0 flex-1 truncate text-ink">{o.recommendation_key} · {o.action_type ?? '—'}</span>
          <span className="text-ink-dim">Before {NUM(o.before_value)}{o.after_value != null ? ` → ${NUM(o.after_value)}` : ''} · {o.outcome_status}</span>
          <span className="shrink-0 text-ink-dim">{relativeTimeKo(o.before_at)}</span>
        </div>
      ))}
    </div>
  );
}
