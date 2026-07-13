/**
 * TrackIntelligenceSection — Track Intelligence & Lifecycle Engine (Phase AI-MUSIC-1).
 *
 * Playlist 가 아니라 **Track 중심**으로 성과를 학습한다. 실제 Track KPI 로 Health·Lifecycle·
 * Trend·Industry/Daypart/Season Score·Recommendation·Graph·Timeline 을 제공한다.
 * 자동 Stage 변경 없이 추천만 생성. 기존 Playback/Queue/Generator/Rotation/Rollout 무변경(읽기 전용).
 *
 * 탭: Overview · Health · Lifecycle · Industry · Playlist · Timeline · Recommendations · Support Matrix.
 * (Brand 는 store_type proxy — 미지원 표기)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Music2, HeartPulse, Recycle, Building2, ListMusic, GitBranch, Sparkles, BookOpen, RefreshCw, Inbox, Search } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchTrackIntelList, fetchTrackIntelDetail,
  type TrackIntelRow, type TrackIntelDetail,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  computeHealth, computeTrend, recommendLifecycle, scoreBreakdown, recommendTrack,
  SUPPORT_MATRIX, LIFECYCLE_LABEL, LIFECYCLE_TONE, TREND_LABEL, TREND_TONE, RECO_LABEL, healthTone,
  type TrackIntelKpi, type Breakdown,
} from '@/lib/trackIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '데이터 없음' : `${n}%`);

type Tab = 'overview' | 'health' | 'lifecycle' | 'industry' | 'playlist' | 'timeline' | 'reco' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Music2 }[] = [
  { key: 'overview', label: 'Overview', icon: Music2 },
  { key: 'health', label: 'Health', icon: HeartPulse },
  { key: 'lifecycle', label: 'Lifecycle', icon: Recycle },
  { key: 'industry', label: 'Industry', icon: Building2 },
  { key: 'playlist', label: 'Playlist', icon: ListMusic },
  { key: 'timeline', label: 'Timeline', icon: GitBranch },
  { key: 'reco', label: 'Recommendations', icon: Sparkles },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

function toKpi(r: TrackIntelRow): TrackIntelKpi { return { ...r }; }

export default function TrackIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [rows, setRows] = useState<TrackIntelRow[] | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<TrackIntelRow | null>(null);
  const [detail, setDetail] = useState<TrackIntelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await fetchTrackIntelList('90d', 200); setRows(r); if (r.length && !selected) setSelected(r[0]); }
    catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [selected]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async (trackId: string) => {
    setDetailLoading(true);
    try { setDetail(await fetchTrackIntelDetail(trackId, '90d')); } catch { setDetail(null); } finally { setDetailLoading(false); }
  }, []);
  useEffect(() => { if (selected && (tab === 'industry' || tab === 'playlist' || tab === 'timeline')) void loadDetail(selected.track_id); }, [selected, tab, loadDetail]);

  const kpis = useMemo(() => (rows ?? []).map(toKpi), [rows]);
  const filtered = useMemo(() => kpis.filter((k) => q === '' || (k.title ?? '').toLowerCase().includes(q.toLowerCase()) || (k.artist ?? '').toLowerCase().includes(q.toLowerCase())), [kpis, q]);
  const selKpi = selected ? toKpi(selected) : null;
  const selHealth = selKpi ? computeHealth(selKpi) : null;

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Music2 size={16} /> Track Intelligence & Lifecycle</span>}
      subtitle="Track 중심 성과 학습 — Health·Lifecycle·추천, 자동 Stage 변경 없음(읽기 전용)"
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
      {err && <AdminAlert tone="warning" title="Track 데이터를 불러오지 못했어요" description={`${err.message} · 0489 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {/* Track 선택(상세 탭용) */}
      {(tab === 'health' || tab === 'lifecycle' || tab === 'industry' || tab === 'playlist' || tab === 'timeline' || tab === 'reco') && (
        <div className="rounded-xl bg-bg-deep p-2">
          <div className="mb-1.5 flex items-center gap-1 rounded-lg bg-bg-card px-2 py-1">
            <Search size={12} className="text-ink-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Track 검색" className="w-full bg-transparent text-xs text-ink placeholder:text-ink-dim outline-none" />
          </div>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {filtered.slice(0, 24).map((k) => (
              <button key={k.track_id} onClick={() => setSelected(rows!.find((r) => r.track_id === k.track_id)!)}
                className={`rounded-full px-2 py-0.5 text-[10px] ${selected?.track_id === k.track_id ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:text-ink'}`}>
                {k.title ?? k.track_id.slice(0, 6)}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'overview' && <OverviewTab kpis={filtered} loading={loading} q={q} setQ={setQ} onSelect={(id) => { setSelected(rows!.find((r) => r.track_id === id)!); setTab('health'); }} />}
      {tab === 'health' && <HealthTab k={selKpi} />}
      {tab === 'lifecycle' && <LifecycleTab k={selKpi} />}
      {tab === 'industry' && <BreakdownTab detail={detail} loading={detailLoading} which="by_industry" title="업종(Store Type) Score" note="Brand 는 미지원 — store_type proxy" />}
      {tab === 'playlist' && <BreakdownTab detail={detail} loading={detailLoading} which="by_playlist" title="Playlist 성과" />}
      {tab === 'timeline' && <TimelineTab k={selKpi} detail={detail} loading={detailLoading} />}
      {tab === 'reco' && <RecoTab k={selKpi} health={selHealth} detail={detail} />}
      {tab === 'support' && <SupportTab />}
    </AdminCard>
  );
}

/* ── Overview ──────────────────────────────────────────────── */
function OverviewTab({ kpis, loading, q, setQ, onSelect }: { kpis: TrackIntelKpi[]; loading: boolean; q: string; setQ: (s: string) => void; onSelect: (id: string) => void }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (kpis.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="Track 성과 데이터 없음" description="재생 이벤트가 있는 Track 이 없습니다." />;
  const ranked = kpis.map((k) => ({ k, h: computeHealth(k), life: recommendLifecycle(k, computeHealth(k)) })).sort((a, b) => b.h.score - a.h.score);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rounded-lg bg-bg-deep px-2 py-1">
        <Search size={12} className="text-ink-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Track 검색" className="w-full bg-transparent text-xs text-ink placeholder:text-ink-dim outline-none" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead><tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">Track</th><th className="px-2 py-2 text-right font-semibold">이벤트</th>
            <th className="px-2 py-2 text-right font-semibold">완주</th><th className="px-2 py-2 text-right font-semibold">Health</th>
            <th className="px-2 py-2 font-semibold">Trend</th><th className="px-2 py-2 font-semibold">Lifecycle</th>
          </tr></thead>
          <tbody>
            {ranked.slice(0, 40).map(({ k, h, life }) => {
              const tr = computeTrend(k);
              return (
                <tr key={k.track_id} className="cursor-pointer border-b border-line/5 last:border-0 hover:bg-bg-hover" onClick={() => onSelect(k.track_id)}>
                  <td className="px-2 py-2"><span className="font-semibold text-ink">{k.title}</span>{k.artist ? <span className="text-ink-dim"> · {k.artist}</span> : ''}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(k.events)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{PCT(k.completion_rate)}</td>
                  <td className="px-2 py-2 text-right"><AdminBadge tone={healthTone(h.score)} size="sm">{h.score}</AdminBadge></td>
                  <td className="px-2 py-2"><AdminBadge tone={TREND_TONE[tr.dir]} size="sm">{TREND_LABEL[tr.dir]}</AdminBadge></td>
                  <td className="px-2 py-2"><AdminBadge tone={LIFECYCLE_TONE[life.stage]} size="sm">{LIFECYCLE_LABEL[life.stage]}</AdminBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Health ────────────────────────────────────────────────── */
function HealthTab({ k }: { k: TrackIntelKpi | null }) {
  if (!k) return <AdminEmpty icon={<HeartPulse size={24} />} title="Track 선택" description="위에서 Track 을 선택하세요." />;
  const h = computeHealth(k);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl bg-bg-deep p-3">
        <div className="text-3xl font-bold" style={{ color: h.score >= 75 ? '#34d399' : h.score >= 50 ? '#fbbf24' : '#f87171' }}>{h.score}</div>
        <div>
          <p className="text-xs font-bold text-ink">{k.title}{k.artist ? ` · ${k.artist}` : ''}</p>
          <p className="text-[10px] text-ink-dim">Health {h.score} · Confidence {h.confidence} · 이벤트 {NUM(k.events)} · 완주 {PCT(k.completion_rate)} · Skip {PCT(k.skip_rate)}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {h.components.map((c) => (
          <div key={c.key} className="flex items-center gap-2">
            <span className="w-20 text-[11px] text-ink-mute">{c.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-card"><div className="h-full rounded-full bg-accent" style={{ width: `${c.present ? c.value : 0}%` }} /></div>
            <span className="w-16 text-right text-[11px] tabular-nums text-ink">{c.present ? c.value : '데이터 없음'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Lifecycle ─────────────────────────────────────────────── */
function LifecycleTab({ k }: { k: TrackIntelKpi | null }) {
  if (!k) return <AdminEmpty icon={<Recycle size={24} />} title="Track 선택" description="위에서 Track 을 선택하세요." />;
  const h = computeHealth(k);
  const life = recommendLifecycle(k, h);
  const stages = ['draft', 'testing', 'growing', 'core', 'stable', 'declining', 'archive_candidate', 'archived'] as const;
  return (
    <div className="space-y-3">
      <AdminAlert tone={LIFECYCLE_TONE[life.stage] === 'success' ? 'success' : 'info'} icon={<Recycle size={16} />} title={`추천 Lifecycle: ${LIFECYCLE_LABEL[life.stage]}`} description={`${life.reason} · 자동 Stage 변경 없음(추천만)`} />
      <div className="flex flex-wrap gap-1">
        {stages.map((s) => <AdminBadge key={s} tone={s === life.stage ? LIFECYCLE_TONE[s] : 'neutral'} size="sm">{LIFECYCLE_LABEL[s]}</AdminBadge>)}
      </div>
      <div className="rounded-lg bg-bg-deep p-2">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-dim">Evidence</p>
        <p className="text-[11px] text-ink-mute">{life.evidence.map((e) => `${e.label} ${e.value ?? '—'}`).join(' · ')}</p>
      </div>
    </div>
  );
}

/* ── Breakdown (Industry / Playlist) ───────────────────────── */
function BreakdownTab({ detail, loading, which, title, note }: { detail: TrackIntelDetail | null; loading: boolean; which: 'by_industry' | 'by_playlist'; title: string; note?: string }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!detail) return <AdminEmpty icon={<Building2 size={24} />} title="Track 선택" description="위에서 Track 을 선택하세요." />;
  const rows = (detail[which] as Breakdown[]) ?? [];
  const scored = scoreBreakdown(rows);
  if (scored.length === 0) return <AdminEmpty icon={<Building2 size={24} />} title="데이터 없음" description={`이 Track 의 ${title} 데이터가 없습니다.`} />;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold text-ink">{title}{note ? <span className="ml-1 font-normal text-ink-dim">· {note}</span> : ''}</p>
      {scored.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-ink">{s.key}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-ink-dim">이벤트 {NUM(s.events)}</span>
            {s.supported ? <AdminBadge tone={healthTone(s.score ?? 0)} size="sm">{s.score}</AdminBadge> : <AdminBadge tone="neutral" size="sm">표본 부족</AdminBadge>}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Timeline (Graph + window trend) ───────────────────────── */
function TimelineTab({ k, detail, loading }: { k: TrackIntelKpi | null; detail: TrackIntelDetail | null; loading: boolean }) {
  if (!k) return <AdminEmpty icon={<GitBranch size={24} />} title="Track 선택" description="위에서 Track 을 선택하세요." />;
  const tr = computeTrend(k);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ l: '7일', v: NUM(k.p7d) }, { l: '30일', v: NUM(k.p30d) }, { l: '90일', v: NUM(k.p90d) }, { l: 'Trend', v: TREND_LABEL[tr.dir] }].map((s) => (
          <div key={s.l} className="rounded-xl bg-bg-deep p-3"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.l}</p><p className="mt-1 text-base font-bold text-ink">{s.v}</p></div>
        ))}
      </div>
      <div className="rounded-lg bg-bg-deep p-2">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-bold text-ink"><GitBranch size={12} /> Relationship Graph (Track → Playlist → Industry → Daypart → Season)</p>
        {loading ? <div className="h-16 animate-pulse rounded bg-bg-card" />
          : <div className="space-y-1 text-[10px] text-ink-dim">
            <p>Playlist: {(detail?.by_playlist ?? []).slice(0, 4).map((p) => `${p.key}(${p.events})`).join(' · ') || '—'}</p>
            <p>Industry: {(detail?.by_industry ?? []).slice(0, 5).map((p) => `${p.key}(${p.events})`).join(' · ') || '—'}</p>
            <p>Daypart: {(detail?.by_daypart ?? []).map((p) => `${p.key}(${p.events})`).join(' · ') || '—'}</p>
            <p>Season: {(detail?.by_season ?? []).map((p) => `${p.key}(${p.events})`).join(' · ') || '—'}</p>
          </div>}
      </div>
    </div>
  );
}

/* ── Recommendations ───────────────────────────────────────── */
function RecoTab({ k, health, detail }: { k: TrackIntelKpi | null; health: ReturnType<typeof computeHealth> | null; detail: TrackIntelDetail | null }) {
  if (!k || !health) return <AdminEmpty icon={<Sparkles size={24} />} title="Track 선택" description="위에서 Track 을 선택하세요." />;
  const industryScores = scoreBreakdown((detail?.by_industry as Breakdown[]) ?? []);
  const recos = recommendTrack(k, health, industryScores);
  if (recos.length === 0) return <AdminEmpty icon={<Sparkles size={24} />} title="추천 없음" description="현재 KPI 로 추천할 항목이 없습니다(실제 데이터 기준)." />;
  return (
    <div className="space-y-2">
      {recos.map((r, i) => (
        <div key={i} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminBadge tone={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'info'} size="sm">{r.priority}</AdminBadge>
            <span className="text-xs font-bold text-ink">{RECO_LABEL[r.type]}</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-mute">{r.reason}</p>
          <p className="mt-0.5 text-[10px] text-ink-dim">{r.evidence.map((e) => `${e.label} ${e.value ?? '—'}`).join(' · ')}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Support Matrix ────────────────────────────────────────── */
function SupportTab() {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">실제 데이터 지원 여부 — 미지원은 점수 계산에서 제외</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {SUPPORT_MATRIX.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-1.5 text-[11px]">
            <span className="text-ink">{s.label}</span>
            <span className="flex items-center gap-1.5"><AdminBadge tone={s.supported ? 'success' : 'neutral'} size="sm">{s.supported ? '지원' : '미지원'}</AdminBadge><span className="text-[9px] text-ink-dim">{s.note}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
