/**
 * AiRecommendationSection — AI Recommendation Engine (Phase AI-RECOMMENDATION-1).
 *
 * 관리자가 데이터를 직접 해석하지 않아도, **실제 운영 KPI 만** 근거로 실행 가능한 추천을
 * 실시간 계산해 Feed 로 제공한다. LLM 추론·허위 원인 없음. 모든 추천은 Evidence(근거 KPI)
 * 와 Confidence(데이터 충족률)를 표시한다.
 *
 * 재사용: Trigger 지표는 기존 Dashboard KPI RPC(admin_revenue_kpis·admin_member_growth_kpis·
 * admin_artist_breakdown·admin_noc_kpi·admin_stream_v2_health 등)를 그대로 호출한다(새 KPI 없음).
 * Suggested Action 은 기존 Action Center action/Dashboard 를 링크로 안내(실행은 Action Center 재사용).
 * 신규는 관리자 결정(Dismiss/Resolve) 스냅샷/이력(0481)뿐이다.
 *
 * 탭: Overview · Feed · History. Evidence 는 카드/모달로 "왜 추천했는지" 표시.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, ListChecks, History as HistoryIcon, RefreshCw, CheckCircle2, XCircle, Inbox, ExternalLink, Info,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty, AdminModal } from '@/components/admin/ui';
import {
  fetchMemberGrowthKpis, fetchRevenueKpis, fetchBusinessSummary, fetchArtistBreakdown,
  fetchNocKpi, fetchStreamV2Health, fetchNowPlayingKpi,
  setRecommendationState, fetchRecommendationActiveStates, fetchRecommendationHistory,
  type RecommendationHistoryRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo, formatKstDateTime } from '@/lib/memberGrowth';
import {
  generateRecommendations, priorityRank,
  PRIORITY_LABEL, PRIORITY_TONE, CATEGORY_LABEL,
  type Recommendation, type RecommendationInputs, type Evidence, type Priority,
} from '@/lib/aiRecommendation';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'feed' | 'history';
const TABS: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: 'overview', label: 'Overview', icon: Sparkles },
  { key: 'feed', label: 'Feed', icon: ListChecks },
  { key: 'history', label: 'History', icon: HistoryIcon },
];

export default function AiRecommendationSection() {
  const [tab, setTab] = useState<Tab>('feed');

  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [states, setStates] = useState<Record<string, 'dismissed' | 'resolved'>>({});
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<RecommendationHistoryRow[] | null>(null);
  const [hLoading, setHLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Recommendation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const settle = async <T,>(p: Promise<T>) => p.catch(() => null);
      const [member, revenue, business, artist, noc, streamHealth, nowPlaying, activeStates] = await Promise.all([
        settle(fetchMemberGrowthKpis()), settle(fetchRevenueKpis()), settle(fetchBusinessSummary()),
        settle(fetchArtistBreakdown()), settle(fetchNocKpi()), settle(fetchStreamV2Health(7)),
        settle(fetchNowPlayingKpi()), settle(fetchRecommendationActiveStates()),
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
      setRecs(generateRecommendations(inputs));
      setStates(activeStates ?? {});
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    setHLoading(true);
    try { setHistory(await fetchRecommendationHistory({ limit: 50 })); } catch { setHistory([]); } finally { setHLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'history') void loadHistory(); }, [tab, loadHistory]);

  async function decide(rec: Recommendation, state: 'dismissed' | 'resolved') {
    setBusy(true);
    try {
      await setRecommendationState({
        ruleKey: rec.ruleKey, category: rec.category, priority: rec.priority, confidence: rec.confidence, score: rec.score,
        title: rec.title, message: rec.message, evidence: rec.evidence, actionRef: rec.suggestedAction.ref, state,
      });
      setStates((s) => ({ ...s, [rec.ruleKey]: state }));
      toast.success(`${rec.title}: ${state === 'resolved' ? '해결됨' : '숨김'}`);
      if (tab === 'history') void loadHistory();
    } catch (e) {
      toast.error(`기록 실패: ${friendlyError(e, '추천 레지스트리 미적용이거나 권한 없음')}`);
    } finally { setBusy(false); setDetail(null); }
  }

  // Feed = 오늘 처리(dismiss/resolve)되지 않은 추천만.
  const feed = (recs ?? []).filter((r) => !states[r.ruleKey]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Sparkles size={16} /> AI Recommendation Engine</span>}
      subtitle="실제 운영 KPI 근거의 실행 가능한 추천 — LLM 추론 없음, 모든 추천에 Evidence·Confidence 표시"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => void load()} disabled={loading} title="다시 계산"
            className="inline-flex items-center gap-1 rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
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
      {err && <AdminAlert tone="warning" title="추천을 계산하지 못했어요" description={err.message} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'overview' && <OverviewTab recs={recs} feed={feed} loading={loading} />}
      {tab === 'feed' && <FeedTab feed={feed} loading={loading} busy={busy} onDetail={setDetail} onDecide={decide} />}
      {tab === 'history' && <HistoryTab rows={history} loading={hLoading} />}

      {detail && (
        <AdminModal open onClose={() => setDetail(null)} title={<span className="flex items-center gap-1.5"><Info size={16} /> 추천 근거 (Evidence)</span>}>
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <AdminBadge tone={PRIORITY_TONE[detail.priority]} size="sm">{PRIORITY_LABEL[detail.priority]}</AdminBadge>
              <AdminBadge tone="neutral" size="sm">{CATEGORY_LABEL[detail.category]}</AdminBadge>
              <span className="font-bold text-ink">{detail.title}</span>
            </div>
            <p className="text-ink-mute">{detail.message}</p>
            <div className="rounded-lg bg-bg-deep p-2">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-dim">왜 추천했는가 (실제 KPI 비교)</p>
              <p className="text-ink">{detail.reason}</p>
              <p className="mt-1 text-ink-dim">Confidence(데이터 충족률) {detail.confidence}% · Score {detail.score}</p>
            </div>
            <EvidenceTable evidence={detail.evidence} />
            <div className="flex justify-end gap-2">
              <button onClick={() => void decide(detail, 'dismissed')} disabled={busy}
                className="rounded-full bg-bg-deep px-3 py-1.5 text-ink-mute hover:text-ink disabled:opacity-40">숨김</button>
              <button onClick={() => void decide(detail, 'resolved')} disabled={busy}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 font-bold text-black disabled:opacity-40">
                <CheckCircle2 size={12} /> 해결됨
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </AdminCard>
  );
}

/* ── Overview ──────────────────────────────────────────────── */
function OverviewTab({ recs, feed, loading }: { recs: Recommendation[] | null; feed: Recommendation[]; loading: boolean }) {
  if (loading) return <div className="h-24 animate-pulse rounded-2xl bg-bg-deep" />;
  const byPriority = (p: Priority) => feed.filter((r) => r.priority === p).length;
  const stats: { label: string; value: string; tone?: 'danger' | 'warning' | 'success' | 'neutral' }[] = [
    { label: '활성 추천', value: NUM(feed.length), tone: feed.length ? 'warning' : 'success' },
    { label: 'Critical', value: NUM(byPriority('critical')), tone: byPriority('critical') ? 'danger' : 'neutral' },
    { label: 'High', value: NUM(byPriority('high')), tone: byPriority('high') ? 'danger' : 'neutral' },
    { label: 'Medium', value: NUM(byPriority('medium')), tone: 'neutral' },
    { label: '처리됨(오늘)', value: NUM((recs?.length ?? 0) - feed.length), tone: 'neutral' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-bg-deep p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.label}</p>
            <p className="mt-1 text-lg font-bold text-ink" style={s.tone === 'danger' ? { color: '#f87171' } : s.tone === 'warning' ? { color: '#fbbf24' } : s.tone === 'success' ? { color: '#34d399' } : undefined}>{s.value}</p>
          </div>
        ))}
      </div>
      {feed.length === 0
        ? <AdminAlert tone="success" icon={<CheckCircle2 size={16} />} title="현재 조치가 필요한 추천 없음" description="실제 KPI 기준 임계를 넘는 항목이 없습니다(추정 없음)." />
        : <AdminAlert tone="info" icon={<Sparkles size={16} />} title={`${feed.length}건의 실행 가능한 추천`} description="Feed 탭에서 근거(Evidence)와 함께 확인하세요." />}
    </div>
  );
}

/* ── Feed ──────────────────────────────────────────────────── */
function FeedTab({ feed, loading, busy, onDetail, onDecide }: {
  feed: Recommendation[]; loading: boolean; busy: boolean;
  onDetail: (r: Recommendation) => void; onDecide: (r: Recommendation, s: 'dismissed' | 'resolved') => void;
}) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (feed.length === 0) return <AdminEmpty icon={<CheckCircle2 size={24} />} title="추천 없음" description="실제 KPI 기준 조치가 필요한 항목이 없습니다." />;
  const sorted = [...feed].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.score - a.score);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">Priority 순 · 모든 추천은 실제 KPI 근거(Evidence) 보유</p>
      {sorted.map((r) => (
        <div key={r.ruleKey} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={PRIORITY_TONE[r.priority]} size="sm">{PRIORITY_LABEL[r.priority]}</AdminBadge>
                <AdminBadge tone="neutral" size="sm">{CATEGORY_LABEL[r.category]}</AdminBadge>
                <span className="text-xs font-bold text-ink">{r.title}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-mute">{r.reason} {r.message}</p>
              <p className="mt-0.5 text-[10px] text-ink-dim">
                Confidence {r.confidence}% · Score {r.score} · 근거 {r.evidence.length}개 · 추천 Action: {r.suggestedAction.kind === 'action' ? `Action Center · ${r.suggestedAction.ref}` : `${r.suggestedAction.label}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <button onClick={() => onDetail(r)}
                className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink">
                <Info size={11} /> 근거
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute" title="실행은 Action Center/해당 Dashboard 재사용">
                <ExternalLink size={11} /> {r.suggestedAction.label}
              </span>
              <button disabled={busy} onClick={() => onDecide(r, 'dismissed')}
                className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">숨김</button>
              <button disabled={busy} onClick={() => onDecide(r, 'resolved')}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40">
                <CheckCircle2 size={11} /> 해결
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Evidence 표 ───────────────────────────────────────────── */
function EvidenceTable({ evidence }: { evidence: Evidence[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-1.5 font-semibold">KPI</th>
            <th className="px-2 py-1.5 text-right font-semibold">현재</th>
            <th className="px-2 py-1.5 text-right font-semibold">기준</th>
            <th className="px-2 py-1.5 text-right font-semibold">변화율</th>
            <th className="px-2 py-1.5 font-semibold">출처</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((e, i) => (
            <tr key={i} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-1.5 text-ink">{e.label} {e.satisfied ? <CheckCircle2 size={10} className="inline" /> : ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{NUM(e.current)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">{NUM(e.baseline)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{e.changeRate == null ? '—' : `${e.changeRate}%`}</td>
              <td className="px-2 py-1.5 text-ink-dim">{e.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────── */
function HistoryTab({ rows, loading }: { rows: RecommendationHistoryRow[] | null; loading: boolean }) {
  if (loading || !rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="추천 이력 없음" description="아직 처리된 추천이 없습니다 (0481 미적용 시 비어 있음)." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">추천</th>
            <th className="px-2 py-2 font-semibold">분류</th>
            <th className="px-2 py-2 font-semibold">우선</th>
            <th className="px-2 py-2 text-right font-semibold">Conf</th>
            <th className="px-2 py-2 font-semibold">상태</th>
            <th className="px-2 py-2 text-right font-semibold">시각</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-2"><span className="font-semibold text-ink">{r.title}</span></td>
              <td className="px-2 py-2 text-ink-mute">{CATEGORY_LABEL[r.category as Recommendation['category']] ?? r.category}</td>
              <td className="px-2 py-2"><AdminBadge tone={PRIORITY_TONE[r.priority as Priority] ?? 'neutral'} size="sm">{PRIORITY_LABEL[r.priority as Priority] ?? r.priority}</AdminBadge></td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{r.confidence}%</td>
              <td className="px-2 py-2">
                <AdminBadge tone={r.state === 'resolved' ? 'success' : 'neutral'} size="sm">
                  {r.state === 'resolved' ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {r.state === 'resolved' ? '해결' : '숨김'}
                </AdminBadge>
              </td>
              <td className="px-2 py-2 text-right text-ink-dim" title={formatKstDateTime(r.created_at)}>{relativeTimeKo(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
