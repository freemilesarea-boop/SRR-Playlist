/**
 * ContextIntelligenceSection — Context Intelligence Engine (Phase AI-MUSIC-2).
 *
 * 성과를 단일 업종/Track 이 아니라 **상황(Context) 조합**(Store Type · Daypart · Weekday Group)
 * 기준으로 학습한다. 각 Context 에서 실제 KPI 로 어떤 Track/Playlist/Genre/Mood 가 성과가 좋은지
 * 분석하고 Score/Health/Confidence/Trend/Recommendation/DNA/Comparison 을 제공한다.
 *
 * 자동 Playlist 생성/Scheduler/Queue/Playback/Brand Policy 변경 없음 — 분석·추천만(읽기 전용).
 * 미지원 Dimension(Brand/Store/Weather/Event/BPM/Season)은 Context Key 에서 제외하고 명시한다.
 *
 * 탭: Overview · Context Explorer · Tracks · Playlists · Genres & Moods · Trends ·
 *     Recommendations · Context DNA · Learning · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers, Compass, Music2, ListMusic, Tags, TrendingUp, Sparkles, Fingerprint,
  GraduationCap, BookOpen, RefreshCw, Inbox, GitCompare,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchContextOverview, fetchContextDetail, fetchContextTrend,
  type ContextOverview, type ContextDetailResp, type ContextTrendResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildContextKey, computeContextHealth, computeContextScore,
  rankContextItems, rankGenreMood, recommendContext, compareContexts, computeContextTrend, contextDNA,
  sampleTier, SUPPORT_MATRIX, GRAIN_LEVELS, GRAIN_LABEL, STATUS_LABEL, STATUS_TONE,
  WEEKDAY_GROUP_LABEL, DAYPART_OPTIONS, DAYPART_SLUG, TREND_DIR_LABEL, TREND_DIR_TONE,
  SAMPLE_TIER_LABEL, SAMPLE_TIER_TONE, RECO_LABEL,
  type ContextDetail, type TrendMetric, type SupportStatus, type ContextHealthResult,
} from '@/lib/contextIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '데이터 없음' : `${n}%`);
const RANGES = ['7d', '30d', '90d', '12m'] as const;

type Tab = 'overview' | 'explorer' | 'tracks' | 'playlists' | 'gm' | 'trends' | 'reco' | 'dna' | 'learning' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'explorer', label: 'Context Explorer', icon: Compass },
  { key: 'tracks', label: 'Tracks', icon: Music2 },
  { key: 'playlists', label: 'Playlists', icon: ListMusic },
  { key: 'gm', label: 'Genres & Moods', icon: Tags },
  { key: 'trends', label: 'Trends', icon: TrendingUp },
  { key: 'reco', label: 'Recommendations', icon: Sparkles },
  { key: 'dna', label: 'Context DNA', icon: Fingerprint },
  { key: 'learning', label: 'Learning', icon: GraduationCap },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

const SUPPORT_TONE: Record<SupportStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  supported: 'success', partially_supported: 'warning', insufficient_data: 'info', unsupported: 'danger',
};
const SUPPORT_LABEL: Record<SupportStatus, string> = {
  supported: '지원', partially_supported: '부분 지원', insufficient_data: '데이터 부족', unsupported: '미지원',
};

/** RPC 응답을 순수 로직이 기대하는 ContextDetail 로 정규화(방어적 기본값). */
function toDetail(r: ContextDetailResp): ContextDetail {
  return { ...r } as ContextDetail;
}
function trackScoreAvg(detail: ContextDetail): number | null {
  const scored = rankContextItems(detail.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate }))).filter((s) => s.supported && s.score != null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length);
}
function playlistScoreAvg(detail: ContextDetail): number | null {
  const scored = rankContextItems(detail.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate }))).filter((s) => s.supported && s.score != null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length);
}
function healthOf(detail: ContextDetail): ContextHealthResult {
  return computeContextHealth(detail.summary, { trackScoreAvg: trackScoreAvg(detail), playlistScoreAvg: playlistScoreAvg(detail) });
}

export default function ContextIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  // Context 선택(Explorer)
  const [storeType, setStoreType] = useState<string | null>(null);
  const [daypart, setDaypart] = useState<string | null>(null);
  const [weekdayGroup, setWeekdayGroup] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextDetailResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trend, setTrend] = useState<ContextTrendResp | null>(null);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('events');

  // 비교 대상 Context (Store Type)
  const [compareType, setCompareType] = useState<string | null>(null);
  const [compareDetail, setCompareDetail] = useState<ContextDetailResp | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const o = await fetchContextOverview(range);
      setOverview(o);
      if (o.items.length && !storeType) setStoreType(o.items[0].store_type);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range, storeType]);

  useEffect(() => { void loadOverview(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async () => {
    if (!storeType) return;
    setDetailLoading(true);
    try {
      const [d, t] = await Promise.all([
        fetchContextDetail(storeType, daypart, weekdayGroup, range, 20),
        fetchContextTrend(storeType, daypart, weekdayGroup, range === '7d' ? '30d' : range),
      ]);
      setDetail(d); setTrend(t);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setDetailLoading(false); }
  }, [storeType, daypart, weekdayGroup, range]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!compareType) { setCompareDetail(null); return; }
    let alive = true;
    void fetchContextDetail(compareType, null, null, range, 20).then((d) => { if (alive) setCompareDetail(d); }).catch(() => { if (alive) setCompareDetail(null); });
    return () => { alive = false; };
  }, [compareType, range]);

  const d = useMemo(() => (detail ? toDetail(detail) : null), [detail]);
  const health = useMemo(() => (d ? healthOf(d) : null), [d]);
  const score = useMemo(() => (d ? computeContextScore(d.summary) : null), [d]);
  const contextKey = useMemo(() => (d ? buildContextKey({ store_type: d.store_type, daypart: d.resolved.daypart, weekday_group: d.resolved.weekday_group }) : ''), [d]);
  const recos = useMemo(() => (d ? recommendContext(d) : []), [d]);
  const trackRank = useMemo(() => (d ? rankContextItems(d.tracks.map((t) => ({ key: t.track_id, label: t.title ?? t.track_id, events: t.events, completion_rate: t.completion_rate, skip_rate: t.skip_rate }))) : []), [d]);
  const playlistRank = useMemo(() => (d ? rankContextItems(d.playlists.map((p) => ({ key: p.playlist_id ?? '(none)', label: p.title ?? '(untitled)', events: p.events, completion_rate: p.completion_rate, skip_rate: p.skip_rate }))) : []), [d]);
  const genreRank = useMemo(() => (d ? rankGenreMood(d.genres) : null), [d]);
  const moodRank = useMemo(() => (d ? rankGenreMood(d.moods) : null), [d]);
  const dna = useMemo(() => (d ? contextDNA(d) : null), [d]);
  const trendResult = useMemo(() => (trend ? computeContextTrend(trend.series, trendMetric) : null), [trend, trendMetric]);

  const compare = useMemo(() => {
    if (!d || !compareDetail || !health) return null;
    const cd = toDetail(compareDetail);
    return compareContexts(
      { label: contextKey || d.store_type, summary: d.summary, health },
      { label: buildContextKey({ store_type: cd.store_type }) || cd.store_type, summary: cd.summary, health: healthOf(cd) },
    );
  }, [d, compareDetail, health, contextKey]);

  if (loading) {
    return <AdminCard title="Context Intelligence"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  }
  if (err) {
    return (
      <AdminCard title="Context Intelligence">
        <AdminAlert tone="danger" title="불러오기 실패" description={err.message}
          action={<button onClick={() => void loadOverview()} className="text-[11px] font-bold underline">재시도</button>} />
      </AdminCard>
    );
  }

  const singleSeason = (overview?.season_range?.distinct_seasons ?? 0) <= 1;

  return (
    <AdminCard
      title="Context Intelligence"
      subtitle="상황(Store Type · Daypart · Weekday) 조합별 실제 KPI 성과 학습 · 분석/추천 전용(자동 반영 없음)"
      action={
        <div className="flex items-center gap-1.5">
          <select value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => { void loadOverview(); void loadDetail(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted">
            <RefreshCw size={12} /> 새로고침
          </button>
        </div>
      }
    >
      {/* 탭 */}
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon; const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}>
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Context 선택 바(모든 데이터 탭 공통) */}
      {tab !== 'overview' && tab !== 'support' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
          <span className="text-[10px] font-bold text-muted-foreground">Context</span>
          <select value={storeType ?? ''} onChange={(e) => setStoreType(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {(overview?.items ?? []).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type} ({NUM(it.events)})</option>)}
          </select>
          <select value={daypart ?? ''} onChange={(e) => setDaypart(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">Daypart 전체</option>
            {DAYPART_OPTIONS.map((dp) => <option key={dp} value={dp}>{dp} ({DAYPART_SLUG[dp]})</option>)}
          </select>
          <select value={weekdayGroup ?? ''} onChange={(e) => setWeekdayGroup(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            <option value="">평일/주말 전체</option>
            <option value="weekday">평일</option>
            <option value="weekend">주말</option>
          </select>
          {detailLoading && <span className="text-[10px] text-muted-foreground">로딩…</span>}
          {d && (
            <span className="ml-auto flex items-center gap-1.5">
              <AdminBadge tone="neutral">{GRAIN_LABEL[d.resolved.grain]}</AdminBadge>
              {d.resolved.fallback && <AdminBadge tone="warning">Fallback</AdminBadge>}
              <code className="rounded bg-background px-1.5 py-0.5 text-[10px]">{contextKey || d.store_type}</code>
            </span>
          )}
        </div>
      )}

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          {singleSeason && (
            <AdminAlert tone="info" title="Season Context 비교 불가"
              description={`현재 데이터가 단일 계절만 존재합니다(distinct_seasons=${overview?.season_range?.distinct_seasons ?? 0}, ${overview?.season_range?.earliest?.slice(0, 10) ?? '—'} ~ ${overview?.season_range?.latest?.slice(0, 10) ?? '—'}). 계절 간 비교는 데이터 축적 후 지원됩니다.`} />
          )}
          <AdminAlert tone="info" title="Context = 지원 Dimension 조합"
            description="Store Type · Daypart · Weekday Group 만 Context Key 로 사용합니다. Brand/Individual Store/Weather/Event/BPM 은 실제 데이터 부재로 미지원(Support Matrix 참고)." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                  <th className="py-1.5 pr-2">Store Type (Level 1 Context)</th>
                  <th className="px-2">표본</th><th className="px-2">Track</th><th className="px-2">Playlist</th>
                  <th className="px-2">완주율</th><th className="px-2">Skip</th><th className="px-2">평균청취</th><th className="px-2">신뢰</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.items ?? []).map((it) => {
                  const tier = sampleTier(it.events);
                  return (
                    <tr key={it.store_type} className="border-b border-border/50 hover:bg-muted/40 cursor-pointer"
                      onClick={() => { setStoreType(it.store_type); setDaypart(null); setWeekdayGroup(null); setTab('explorer'); }}>
                      <td className="py-1.5 pr-2 font-bold">{it.store_type}</td>
                      <td className="px-2">{NUM(it.events)}</td>
                      <td className="px-2">{NUM(it.track_count)}</td>
                      <td className="px-2">{NUM(it.playlist_count)}</td>
                      <td className="px-2">{PCT(it.completion_rate)}</td>
                      <td className="px-2">{PCT(it.skip_rate)}</td>
                      <td className="px-2">{it.avg_listen_seconds == null ? '—' : `${it.avg_listen_seconds}s`}</td>
                      <td className="px-2"><AdminBadge tone={SAMPLE_TIER_TONE[tier]}>{SAMPLE_TIER_LABEL[tier]}</AdminBadge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!overview?.items.length && <AdminEmpty icon={<Inbox size={20} />} title="Context 데이터 없음" description="선택 기간에 재생 이벤트가 없습니다." />}
        </div>
      )}

      {/* ── Context Explorer (Summary + Health + Comparison) ── */}
      {tab === 'explorer' && (
        <div className="space-y-3">
          {!d ? <AdminEmpty icon={<Compass size={20} />} title="Context 선택" description="Store Type 을 선택하세요." /> : (
            <>
              {d.summary.events < 20 && (
                <AdminAlert tone="warning" title="표본 부족"
                  description={`이 Context 표본이 ${NUM(d.summary.events)} 입니다(최소 20). Score/추천 신뢰도가 낮으며 상위 Grain 으로 fallback 될 수 있습니다.`} />
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Kpi label="Health" value={health ? `${health.score}` : '—'} badge={health ? <AdminBadge tone={STATUS_TONE[health.status]}>{STATUS_LABEL[health.status]}</AdminBadge> : null} />
                <Kpi label="Score / Confidence" value={score ? `${score.score} / ${score.confidence}` : '—'} />
                <Kpi label="표본" value={NUM(d.summary.events)} badge={<AdminBadge tone={SAMPLE_TIER_TONE[sampleTier(d.summary.events)]}>{SAMPLE_TIER_LABEL[sampleTier(d.summary.events)]}</AdminBadge>} />
                <Kpi label="완주율 / Skip" value={`${PCT(d.summary.completion_rate)} / ${PCT(d.summary.skip_rate)}`} />
                <Kpi label="Track 수" value={NUM(d.summary.track_count)} />
                <Kpi label="Playlist 수" value={NUM(d.summary.playlist_count)} />
                <Kpi label="평균 청취" value={d.summary.avg_listen_seconds == null ? '—' : `${d.summary.avg_listen_seconds}s`} />
                <Kpi label="최근 재생(일 전)" value={NUM(d.summary.days_since_last)} />
              </div>

              {/* Score 성분 */}
              {score && (
                <AdminCard title="Context Score 성분" bodyClassName="space-y-1.5">
                  {score.components.map((c) => (
                    <div key={c.key} className="flex items-center gap-2">
                      <span className="w-20 text-[10px] font-bold text-muted-foreground">{c.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${c.present ? 'bg-accent' : 'bg-muted-foreground/30'}`} style={{ width: `${c.present ? c.value : 0}%` }} />
                      </div>
                      <span className="w-16 text-right text-[10px]">{c.present ? c.value : '미지원'}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[10px] text-muted-foreground">※ 평균 청취시간은 비임의 정규화 기준이 없어 Score 성분에서 제외(표시·비교에만 사용).</p>
                </AdminCard>
              )}

              {/* 후보 표본/Fallback */}
              <AdminCard title="Grain / Fallback" bodyClassName="text-[11px] space-y-1">
                <div className="flex flex-wrap gap-3">
                  <span>요청: <b>{d.requested.daypart ?? '—'}</b> / <b>{d.requested.weekday_group ? WEEKDAY_GROUP_LABEL[d.requested.weekday_group] : '—'}</b></span>
                  <span>해석: <b>{GRAIN_LABEL[d.resolved.grain]}</b></span>
                  <span>표본(L1/L2/L3): {NUM(d.candidate_samples.l1)} / {NUM(d.candidate_samples.l2)} / {NUM(d.candidate_samples.l3)} (min {d.candidate_samples.min_sample})</span>
                </div>
                {d.resolved.fallback && <p className="text-amber-600 dark:text-amber-400">표본 부족으로 상위 Grain 으로 fallback 되었습니다(Evidence 에 기록).</p>}
              </AdminCard>

              {/* Context 비교 */}
              <AdminCard
                title={<span className="inline-flex items-center gap-1"><GitCompare size={13} /> Context 비교</span>}
                action={
                  <select value={compareType ?? ''} onChange={(e) => setCompareType(e.target.value || null)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
                    <option value="">비교 Store Type 선택</option>
                    {(overview?.items ?? []).filter((it) => it.store_type !== storeType).map((it) => <option key={it.store_type} value={it.store_type}>{it.store_type}</option>)}
                  </select>
                }
              >
                {!compareType ? <p className="text-[11px] text-muted-foreground">비교할 Store Type 을 선택하세요. Winner 단정 없이 항목별 차이를 표시합니다.</p>
                  : !compare ? <p className="text-[11px] text-muted-foreground">로딩…</p>
                  : !compare.comparable ? <AdminAlert tone="warning" title="비교 불가" description={compare.reason} />
                  : (
                    <table className="w-full text-left text-xs">
                      <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">KPI</th><th className="px-2">{storeType}</th><th className="px-2">{compareType}</th><th className="px-2">Δ</th><th className="px-2">비교</th></tr></thead>
                      <tbody>
                        {compare.rows.map((r) => (
                          <tr key={r.kpi} className="border-b border-border/50">
                            <td className="py-1 pr-2 font-semibold">{r.kpi}</td>
                            <td className="px-2">{NUM(r.a)}</td><td className="px-2">{NUM(r.b)}</td>
                            <td className="px-2">{r.delta == null ? '—' : r.delta}</td>
                            <td className="px-2 text-[10px] text-muted-foreground">{r.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </AdminCard>
            </>
          )}
        </div>
      )}

      {/* ── Tracks ── */}
      {tab === 'tracks' && (
        <RankTable empty={!d} title="Context 내 Track 랭킹(완주율 기반 Score · 표본<5 미지원)"
          rows={trackRank} extraHeader="장르/무드" extraCell={(k) => {
            const t = d?.tracks.find((x) => x.track_id === k); return t ? `${t.genre ?? '—'} / ${t.mood ?? '—'}` : '—';
          }} />
      )}

      {/* ── Playlists ── */}
      {tab === 'playlists' && (
        <RankTable empty={!d} title="Context 내 Playlist 랭킹" rows={playlistRank}
          extraHeader="고유 Track" extraCell={(k) => {
            const p = d?.playlists.find((x) => (x.playlist_id ?? '(none)') === k); return p ? NUM(p.unique_track_count) : '—';
          }} />
      )}

      {/* ── Genres & Moods ── */}
      {tab === 'gm' && (
        <div className="grid gap-3 md:grid-cols-2">
          <GmCard title="Genre" data={genreRank} />
          <GmCard title="Mood" data={moodRank} />
        </div>
      )}

      {/* ── Trends ── */}
      {tab === 'trends' && (
        <div className="space-y-3">
          {!trend ? <AdminEmpty icon={<TrendingUp size={20} />} title="Trend 데이터 없음" /> : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-bold text-muted-foreground">지표</span>
                {(['events', 'completion_rate', 'skip_rate', 'avg_listen_seconds', 'track_count', 'playlist_count'] as TrendMetric[]).map((m) => (
                  <button key={m} onClick={() => setTrendMetric(m)}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${trendMetric === m ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}>{m}</button>
                ))}
                {trendResult && <AdminBadge tone={TREND_DIR_TONE[trendResult.dir]} className="ml-auto">{TREND_DIR_LABEL[trendResult.dir]}{trendResult.changeRate != null ? ` ${trendResult.changeRate}%` : ''} · {trendResult.points}pt</AdminBadge>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">기간({trend.bucket})</th><th className="px-2">표본</th><th className="px-2">완주율</th><th className="px-2">Skip</th><th className="px-2">평균청취</th><th className="px-2">Track</th><th className="px-2">Playlist</th></tr></thead>
                  <tbody>
                    {trend.series.map((p) => (
                      <tr key={p.bucket_start} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-semibold">{p.bucket_start.slice(0, 10)}</td>
                        <td className="px-2">{NUM(p.events)}</td><td className="px-2">{PCT(p.completion_rate)}</td>
                        <td className="px-2">{PCT(p.skip_rate)}</td><td className="px-2">{p.avg_listen_seconds == null ? '—' : `${p.avg_listen_seconds}s`}</td>
                        <td className="px-2">{NUM(p.track_count)}</td><td className="px-2">{NUM(p.playlist_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {trend.series.length < 3 && <p className="text-[10px] text-muted-foreground">데이터 포인트 부족(&lt; 3) — 추세 판정 불가.</p>}
            </>
          )}
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'reco' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="분석/추천 전용"
            description="모든 추천은 Evidence 기반이며 자동 Playlist/Scheduler/Queue/Track 변경을 하지 않습니다. 운영자 검토 대상입니다." />
          {!recos.length ? <AdminEmpty icon={<Sparkles size={20} />} title="추천 없음" description="비교 가능한 KPI/Baseline 이 부족합니다." /> : recos.map((r, i) => (
            <div key={i} className="rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <AdminBadge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'neutral'}>{r.priority}</AdminBadge>
                <AdminBadge tone="info">{RECO_LABEL[r.type]}</AdminBadge>
                <span className="text-xs font-bold">{r.title}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{r.reason}</p>
              <p className="mt-0.5 text-[11px]"><b>제안:</b> {r.suggested_action}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.evidence.map((e, j) => <span key={j} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{e.label}: <b>{e.value == null ? '—' : String(e.value)}</b></span>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Context DNA ── */}
      {tab === 'dna' && (
        <div className="space-y-3">
          {!dna ? <AdminEmpty icon={<Fingerprint size={20} />} title="Context 선택" /> : (
            <>
              <AdminAlert tone="info" title={`Context DNA · ${dna.context_key}`}
                description="실제 메타데이터/KPI 요약 Profile 입니다. 서술형 취향(예: '고급스러움')은 생성하지 않습니다." />
              <div className="grid gap-2 md:grid-cols-2">
                <DnaRow label="Dominant Genres" value={dna.dominant_genres.length ? dna.dominant_genres.join(', ') : '표본 부족'} />
                <DnaRow label="Dominant Moods" value={dna.dominant_moods.length ? dna.dominant_moods.join(', ') : '표본 부족'} />
                <DnaRow label="평균 완주율" value={PCT(dna.average_completion)} />
                <DnaRow label="평균 Skip" value={PCT(dna.average_skip)} />
                <DnaRow label="Diversity Profile" value={`${dna.diversity_profile} / 100`} />
                <DnaRow label="표본 / Confidence" value={`${NUM(dna.sample_size)} / ${dna.confidence}`} />
                <DnaRow label="BPM Range" value={dna.bpm_range} />
                <DnaRow label="Vocal Support" value={dna.vocal_support ? '지원' : '미지원(vocal_presence NULL)'} />
                <DnaRow label="Best Tracks" value={dna.best_tracks.length ? dna.best_tracks.join(', ') : '표본 부족'} />
                <DnaRow label="Best Playlists" value={dna.best_playlists.length ? dna.best_playlists.join(', ') : '표본 부족'} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Learning ── */}
      {tab === 'learning' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Learning Signal 전용(자동 변경 없음)"
            description="이번 Phase 는 Context Recommendation 을 별도 저장하지 않고 실시간 집계합니다(불필요한 Snapshot/Reco 테이블 미생성). 자동 Weight/Rule/Policy 변경 없음 — Learning Signal 만 제공합니다." />
          <AdminCard title="현재 Context 추천 요약(세션)" bodyClassName="space-y-1.5">
            {!d ? <p className="text-[11px] text-muted-foreground">Context 를 선택하세요.</p> : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(recos.reduce<Record<string, number>>((acc, r) => { acc[r.type] = (acc[r.type] ?? 0) + 1; return acc; }, {})).map(([k, v]) => (
                    <AdminBadge key={k} tone="neutral">{RECO_LABEL[k as keyof typeof RECO_LABEL] ?? k}: {v}</AdminBadge>
                  ))}
                  {!recos.length && <span className="text-[11px] text-muted-foreground">생성된 추천 없음</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">향후 연계: AI-PLAYLIST-2 실험 Winner · AI-RECOMMENDATION Outcome/Learning · Context별 승인율/실험 승률(저장 도입 시).</p>
              </>
            )}
          </AdminCard>
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="지원/미지원 Dimension (실제 DB 재확인)"
            description="미지원 Dimension 은 Context Key 에서 제외되며 성과 추정을 하지 않습니다." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Dimension</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {SUPPORT_MATRIX.map((s) => (
                  <tr key={s.key} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-bold">{s.label}</td>
                    <td className="px-2"><AdminBadge tone={SUPPORT_TONE[s.status]}>{SUPPORT_LABEL[s.status]}</AdminBadge></td>
                    <td className="px-2 text-[11px] text-muted-foreground">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminCard title="활성 Grain" bodyClassName="text-[11px] space-y-1">
            {GRAIN_LEVELS.map((g) => <div key={g.level}><b>{g.level}</b> — {g.label} <span className="text-muted-foreground">({g.dims.join(' + ')})</span></div>)}
            <p className="pt-1 text-muted-foreground">Level 4(+ Season)는 단일 계절 데이터로 비활성 — 데이터 축적 후 지원.</p>
          </AdminCard>
        </div>
      )}
    </AdminCard>
  );
}

/* ── 하위 표시 컴포넌트 ─────────────────────────────────────────────────── */
function Kpi({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-black">{value}{badge}</p>
    </div>
  );
}
function DnaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-semibold break-words">{value}</p>
    </div>
  );
}
function RankTable({ empty, title, rows, extraHeader, extraCell }: {
  empty: boolean; title: string;
  rows: { key: string; label: string; score: number | null; events: number; supported: boolean }[];
  extraHeader: string; extraCell: (key: string) => string;
}) {
  if (empty) return <AdminEmpty icon={<Inbox size={20} />} title="Context 선택" description="Store Type 을 선택하세요." />;
  if (!rows.length) return <AdminEmpty icon={<Inbox size={20} />} title="데이터 없음" />;
  return (
    <AdminCard title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">항목</th><th className="px-2">Score</th><th className="px-2">표본</th><th className="px-2">{extraHeader}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/50">
                <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
                <td className="px-2">{r.supported ? <AdminBadge tone={(r.score ?? 0) >= 70 ? 'success' : (r.score ?? 0) >= 50 ? 'warning' : 'danger'}>{r.score}</AdminBadge> : <span className="text-[10px] text-muted-foreground">표본 부족</span>}</td>
                <td className="px-2">{NUM(r.events)}</td>
                <td className="px-2 text-[11px] text-muted-foreground">{extraCell(r.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
function GmCard({ title, data }: { title: string; data: ReturnType<typeof rankGenreMood> | null }) {
  if (!data) return <AdminEmpty icon={<Tags size={20} />} title={`${title} 데이터 없음`} />;
  return (
    <AdminCard title={title} bodyClassName="space-y-2">
      <div>
        <p className="mb-1 text-[10px] font-bold text-muted-foreground">TOP (완주율 기반)</p>
        {data.top.length ? data.top.map((r) => (
          <div key={r.key} className="flex items-center justify-between border-b border-border/40 py-1 text-[11px]">
            <span className="font-semibold">{r.label}</span>
            <span className="flex items-center gap-1.5"><AdminBadge tone={(r.score ?? 0) >= 70 ? 'success' : 'warning'}>{r.score}</AdminBadge><span className="text-muted-foreground">{NUM(r.events)}</span></span>
          </div>
        )) : <p className="text-[11px] text-muted-foreground">표본 충족 항목 없음</p>}
      </div>
      {data.low.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-bold text-muted-foreground">저성과</p>
          {data.low.map((r) => <div key={r.key} className="flex items-center justify-between py-0.5 text-[11px]"><span>{r.label}</span><AdminBadge tone="danger">{r.score}</AdminBadge></div>)}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
        {data.unknown && <AdminBadge tone="neutral">unknown: {NUM(data.unknown.events)}</AdminBadge>}
        {data.insufficient.length > 0 && <AdminBadge tone="warning">표본부족 {data.insufficient.length}종</AdminBadge>}
      </div>
    </AdminCard>
  );
}
