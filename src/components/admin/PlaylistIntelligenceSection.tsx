/**
 * PlaylistIntelligenceSection — Adaptive Playlist Intelligence (Phase AI-PLAYLIST-1).
 *
 * "성과가 좋은(실제 KPI 기준) Playlist" 를 분석·추천한다. AI 가 음악 취향을 추측하지 않고,
 * 오직 playback_events_v2 집계(완주율·Skip율·다양성 등)로만 판단한다. 기존 Playback/
 * Queue/Scheduler/Playlist/Policy 는 변경하지 않는다(읽기 전용 + 추천/학습 기록만).
 *
 * 탭: Overview · Industries · Stores · Rankings · History · Recommendations · Learning.
 * 미지원(정직 표기): 개별 Store 단위(store_id 미기록) · Weather(데이터 없음) · Event 성과.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Music, Building2, Store, Trophy, History as HistoryIcon, Sparkles, Activity, RefreshCw, Inbox, CheckCircle2, XCircle,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchPlaylistIntelligence, fetchPlaylistRankings, fetchPlaylistHistory, fetchPlaylistLearning, savePlaylistReco,
  type PlaylistIntelligence, type PlaylistRankings, type PlaylistRecoRow, type PlaylistLearningRow, type PlaylistRange,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  rankPlaylists, summarizeIndustries, buildRecommendations, clampPct,
  SCORE_COMPONENT_LABEL, PRIORITY_TONE, PRIORITY_LABEL,
  type ScoredPlaylist, type PlaylistRecommendation,
} from '@/lib/playlistIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '데이터 없음' : `${n}%`);

type Tab = 'overview' | 'industries' | 'stores' | 'rankings' | 'history' | 'recommendations' | 'learning';
const TABS: { key: Tab; label: string; icon: typeof Music }[] = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'industries', label: 'Industries', icon: Building2 },
  { key: 'stores', label: 'Stores', icon: Store },
  { key: 'rankings', label: 'Rankings', icon: Trophy },
  { key: 'recommendations', label: 'Recommendations', icon: Sparkles },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'learning', label: 'Learning', icon: Activity },
];
const RANGES: PlaylistRange[] = ['7d', '30d', '90d', '12m'];

export default function PlaylistIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<PlaylistRange>('30d');
  const [intel, setIntel] = useState<PlaylistIntelligence | null>(null);
  const [rankings, setRankings] = useState<PlaylistRankings | null>(null);
  const [history, setHistory] = useState<PlaylistRecoRow[] | null>(null);
  const [learning, setLearning] = useState<PlaylistLearningRow[] | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [i, r] = await Promise.all([fetchPlaylistIntelligence(range), fetchPlaylistRankings(range).catch(() => null)]);
      setIntel(i); setRankings(r);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range]);

  const loadHistory = useCallback(async () => {
    try {
      const [h, l] = await Promise.all([fetchPlaylistHistory(50).catch(() => [] as PlaylistRecoRow[]), fetchPlaylistLearning().catch(() => [] as PlaylistLearningRow[])]);
      setHistory(h); setLearning(l);
    } catch { setHistory([]); setLearning([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'history' || tab === 'learning') void loadHistory(); }, [tab, loadHistory]);

  const scored = useMemo(() => (intel ? rankPlaylists(intel.playlists, nowMs) : []), [intel, nowMs]);
  const industries = useMemo(() => (intel ? summarizeIndustries(intel.industries) : []), [intel]);

  // 전체(업종 무관) 벤치마크 — store_type×playlist 매핑 부재로 전체 평균 기준 추천.
  const recommendations = useMemo<PlaylistRecommendation[]>(() => {
    if (!intel || intel.playlists.length === 0) return [];
    const totalEvents = intel.playlists.reduce((s, p) => s + p.events, 0);
    const totalSkips = intel.playlists.reduce((s, p) => s + p.skips, 0);
    const globalSkip = totalEvents > 0 ? clampPct((totalSkips / totalEvents) * 100) : null;
    const wc = intel.playlists.filter((p) => p.completion_rate != null);
    const globalCompletion = wc.length > 0 ? clampPct(wc.reduce((s, p) => s + (p.completion_rate as number) * p.events, 0) / wc.reduce((s, p) => s + p.events, 0)) : null;
    return buildRecommendations('전체(업종 무관)', globalCompletion, globalSkip, intel.playlists, nowMs);
  }, [intel, nowMs]);

  async function decide(rec: PlaylistRecommendation, state: 'applied' | 'dismissed') {
    setBusy(true);
    try {
      await savePlaylistReco({
        ruleKey: rec.ruleKey, evidence: rec.evidence, storeType: rec.storeType, targetTitle: rec.targetTitle,
        recommendedTitle: rec.recommendedTitle, reason: rec.reason, state,
      });
      toast.success(`추천 ${state === 'applied' ? '적용 기록' : '기각'} (자동 교체 없음)`);
      if (tab === 'history' || tab === 'learning') void loadHistory();
    } catch (e) { toast.error(`기록 실패: ${friendlyError(e, '0484 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Music size={16} /> Adaptive Playlist Intelligence</span>}
      subtitle="실제 재생 이벤트 KPI 기반 Playlist 성과·추천 — 취향 추측 없음, 기존 Playback/Queue 무변경"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <select value={range} onChange={(e) => setRange(e.target.value as PlaylistRange)} className="rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
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
      {err && <AdminAlert tone="warning" title="Playlist 성과를 불러오지 못했어요" description={`${err.message} · 0484 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'overview' && <OverviewTab intel={intel} scored={scored} loading={loading} />}
      {tab === 'industries' && <IndustriesTab industries={industries} loading={loading} />}
      {tab === 'stores' && <StoresTab industries={industries} loading={loading} />}
      {tab === 'rankings' && <RankingsTab rankings={rankings} loading={loading} />}
      {tab === 'recommendations' && <RecommendationsTab recs={recommendations} busy={busy} onDecide={decide} />}
      {tab === 'history' && <HistoryTab rows={history} />}
      {tab === 'learning' && <LearningTab rows={learning} />}
    </AdminCard>
  );
}

/* ── Overview ──────────────────────────────────────────────── */
function OverviewTab({ intel, scored, loading }: { intel: PlaylistIntelligence | null; scored: ScoredPlaylist[]; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!intel || scored.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="Playlist 성과 데이터 없음" description="추적된 재생 이벤트가 없습니다 (playback_events_v2)." />;
  const totalEvents = intel.playlists.reduce((s, p) => s + p.events, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="분석 Playlist" value={NUM(scored.length)} />
        <Stat label="재생 이벤트" value={NUM(totalEvents)} />
        <Stat label="업종(store_type)" value={NUM(intel.industries.length)} />
        <Stat label="시간대 밴드" value={NUM(intel.time_bands.length)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AdminBadge tone="neutral" size="sm">Weather 미지원(데이터 없음)</AdminBadge>
        <AdminBadge tone="neutral" size="sm">Event 성과 미지원</AdminBadge>
        <AdminBadge tone="neutral" size="sm">개별 Store 미지원(store_id 미기록)</AdminBadge>
      </div>
      <p className="text-[11px] font-bold text-ink">Playlist Score 상위</p>
      <div className="space-y-1.5">
        {scored.slice(0, 8).map((s, i) => <ScoreRow key={s.playlistId ?? i} rank={i + 1} s={s} />)}
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-bg-deep p-3"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p><p className="mt-1 text-lg font-bold text-ink">{value}</p></div>;
}
function ScoreRow({ rank, s }: { rank: number; s: ScoredPlaylist }) {
  return (
    <div className="rounded-xl bg-bg-deep p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-dim">#{rank}</span>
            <span className="text-xs font-bold text-ink">{s.title}</span>
            {s.insufficient && <AdminBadge tone="warning" size="sm">데이터 부족</AdminBadge>}
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">
            {(['completion', 'skip', 'diversity', 'coverage', 'freshness', 'evidence'] as const).map((k) => `${SCORE_COMPONENT_LABEL[k]} ${s.breakdown[k]}`).join(' · ')} = <b className="text-ink">{s.breakdown.total}</b>
          </p>
          <p className="mt-0.5 text-[10px] text-ink-dim">이벤트 {NUM(s.events)} · 완주 {PCT(s.completionRate)} · Skip {PCT(s.skipRate)} · 다양성 {s.diversity != null ? `${s.diversity}%` : '—'}</p>
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{s.score}</span>
      </div>
    </div>
  );
}

/* ── Industries ────────────────────────────────────────────── */
function IndustriesTab({ industries, loading }: { industries: ReturnType<typeof summarizeIndustries>; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (industries.length === 0) return <AdminEmpty icon={<Building2 size={24} />} title="업종 성과 데이터 없음" description="store_type 별 재생 이벤트가 없습니다." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead><tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
          <th className="px-2 py-2 font-semibold">업종(store_type)</th>
          <th className="px-2 py-2 text-right font-semibold">이벤트</th>
          <th className="px-2 py-2 text-right font-semibold">완주율</th>
          <th className="px-2 py-2 text-right font-semibold">Skip율</th>
          <th className="px-2 py-2 text-right font-semibold">Playlist</th>
          <th className="px-2 py-2 text-right font-semibold">고유 트랙</th>
        </tr></thead>
        <tbody>
          {industries.map((i) => (
            <tr key={i.store_type_slug} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-2 font-semibold text-ink">{i.store_type_slug}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(i.events)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink">{PCT(i.completion_rate)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{PCT(i.skip_rate)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(i.playlist_count)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(i.unique_tracks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Stores (store_type 기반; 개별 매장 미지원) ─────────────── */
function StoresTab({ industries, loading }: { industries: ReturnType<typeof summarizeIndustries>; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  return (
    <div className="space-y-3">
      <AdminAlert tone="info" icon={<Store size={16} />} title="개별 Store 단위 미지원"
        description="playback_events_v2 에 store_id 가 기록되지 않아 개별 매장 성과는 분석할 수 없습니다. 매장 유형(store_type) 단위로만 제공합니다." />
      <IndustriesTab industries={industries} loading={false} />
    </div>
  );
}

/* ── Rankings ──────────────────────────────────────────────── */
function RankingsTab({ rankings, loading }: { rankings: PlaylistRankings | null; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!rankings || (rankings.top_completion.length === 0 && rankings.lowest_skip.length === 0 && rankings.top_growth.length === 0)) {
    return <AdminEmpty icon={<Trophy size={24} />} title="랭킹 데이터 없음" description="최소 이벤트(20) 이상 Playlist 가 없습니다." />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <RankCard title="완주율 TOP" icon={<Trophy size={13} />} rows={rankings.top_completion.map((r) => ({ title: r.playlist_title, metric: PCT(r.completion_rate), sub: `${NUM(r.events)} events` }))} />
      <RankCard title="Skip 낮은 순" icon={<CheckCircle2 size={13} />} rows={rankings.lowest_skip.map((r) => ({ title: r.playlist_title, metric: PCT(r.skip_rate), sub: `${NUM(r.events)} events` }))} />
      <RankCard title="성장 TOP" icon={<Activity size={13} />} rows={rankings.top_growth.map((r) => ({ title: r.playlist_title, metric: r.growth_rate != null ? `${r.growth_rate}%` : '—', sub: `${NUM(r.recent_events)}/${NUM(r.prior_events)}` }))} />
    </div>
  );
}
function RankCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: { title: string | null; metric: string; sub: string }[] }) {
  return (
    <div className="rounded-xl bg-bg-deep p-3">
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-ink">{icon} {title}</p>
      {rows.length === 0 ? <p className="text-[10px] text-ink-dim">데이터 없음</p>
        : <div className="space-y-1">
          {rows.slice(0, 8).map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-ink-mute">{r.title ?? '(제목 없음)'}</span>
              <span className="shrink-0 tabular-nums text-ink">{r.metric}</span>
            </div>
          ))}
        </div>}
    </div>
  );
}

/* ── Recommendations ───────────────────────────────────────── */
function RecommendationsTab({ recs, busy, onDecide }: { recs: PlaylistRecommendation[]; busy: boolean; onDecide: (r: PlaylistRecommendation, s: 'applied' | 'dismissed') => void }) {
  if (recs.length === 0) return <AdminEmpty icon={<Sparkles size={24} />} title="교체 추천 없음" description="업종 평균 대비 저성과 Playlist 가 없습니다(실제 KPI 기준, 추측 없음)." />;
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" icon={<Sparkles size={16} />} title="Evidence 기반 교체 추천" description="자동 교체하지 않습니다. 적용/기각은 Learning Signal 로만 기록됩니다(Rule/Playlist 무변경)." />
      {recs.map((r, i) => (
        <div key={i} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={PRIORITY_TONE[r.priority]} size="sm">{PRIORITY_LABEL[r.priority]}</AdminBadge>
                <span className="text-xs font-bold text-ink">{r.targetTitle}</span>
                <span className="text-ink-dim">→</span>
                <span className="text-xs font-bold" style={{ color: '#34d399' }}>{r.recommendedTitle}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-mute">{r.reason}</p>
              <p className="mt-0.5 text-[10px] text-ink-dim">{r.evidence.map((e) => `${e.label} ${e.current ?? '—'}${e.benchmark != null ? `/${e.benchmark}` : ''}`).join(' · ')}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button disabled={busy} onClick={() => onDecide(r, 'dismissed')} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">기각</button>
              <button disabled={busy} onClick={() => onDecide(r, 'applied')} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40"><CheckCircle2 size={11} /> 적용 기록</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── History ───────────────────────────────────────────────── */
function HistoryTab({ rows }: { rows: PlaylistRecoRow[] | null }) {
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="추천 이력 없음" description="아직 기록된 Playlist 추천이 없습니다 (0484 미적용 시 비어 있음)." />;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-ink">{r.target_playlist_title ?? '—'} → {r.recommended_title ?? '—'}</span>
          <AdminBadge tone={r.state === 'applied' ? 'success' : r.state === 'dismissed' ? 'neutral' : 'info'} size="sm">
            {r.state === 'applied' ? <CheckCircle2 size={10} /> : r.state === 'dismissed' ? <XCircle size={10} /> : null} {r.state}
          </AdminBadge>
          <span className="shrink-0 text-ink-dim">{relativeTimeKo(r.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Learning ──────────────────────────────────────────────── */
function LearningTab({ rows }: { rows: PlaylistLearningRow[] | null }) {
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Activity size={24} />} title="학습 신호 없음" description="추천 적용/기각 기록이 쌓이면 집계됩니다 (참고용 · 자동 교체 없음)." />;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-ink-mute">참고용 Learning Signal — 자동 Rule/Playlist 변경 없음</p>
      {rows.map((r) => (
        <div key={r.rule_key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="text-ink">{r.rule_key}</span>
          <span className="text-ink-dim">총 {NUM(r.total)} · 적용 {NUM(r.applied)} · 기각 {NUM(r.dismissed)}{r.apply_rate != null ? ` · 적용률 ${r.apply_rate}%` : ''}</span>
        </div>
      ))}
    </div>
  );
}
