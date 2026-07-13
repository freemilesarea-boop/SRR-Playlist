/**
 * PlaylistExperimentSection — Playlist Optimization & Experimentation (Phase AI-PLAYLIST-2).
 *
 * Playlist 를 AI 가 바로 교체하지 않고 실험 → 비교 → 검증 → 승인 → 확산 으로 안전하게
 * 발전시킨다. 실제 재생 이벤트(playback_events_v2) 기반 A/B 비교 + 승자 기록(Evidence 필수).
 * **자동 Playlist 교체 없음.** 기존 Playback/Queue/Scheduler/Playlist/Recommendation 무변경.
 *
 * 탭: Experiments(생성/목록) · Comparison(A/B 비교·승자 확정) · History · Learning.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, GitCompare, History as HistoryIcon, Activity, RefreshCw, Inbox, Play, Ban, Trophy, Plus } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchPlaylistIntelligence, fetchPlaylistExperiments, upsertPlaylistExperiment, setPlaylistExperimentStatus,
  comparePlaylists, concludePlaylistExperiment, fetchExperimentLearning,
  type PlaylistExperimentRow, type ExperimentLearningRow, type PlaylistIntelligence,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  compareKpis, decideWinner, buildWinnerEvidence, alignRows,
  STATUS_LABEL, STATUS_TONE, WINNER_LABEL, WINNER_TONE, METRIC_WINNER_LABEL,
  type CompareKpi, type MetricCompare, type WinnerResult,
} from '@/lib/playlistExperiment';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'experiments' | 'comparison' | 'history' | 'learning';
const TABS: { key: Tab; label: string; icon: typeof FlaskConical }[] = [
  { key: 'experiments', label: 'Experiments', icon: FlaskConical },
  { key: 'comparison', label: 'Comparison', icon: GitCompare },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'learning', label: 'Learning', icon: Activity },
];
const SCOPES = ['all', 'industry', 'store_type', 'time', 'season'] as const;
const RANGES = ['7d', '30d', '90d', '12m'] as const;

function toCompareKpi(r: { playlist_id: string | null; playlist_title: string | null; events: number; skips: number; skip_rate: number | null; completion_rate: number | null; avg_listen_seconds: number | null; likes: number; replays: number; unique_tracks: number }): CompareKpi {
  return { playlistId: r.playlist_id, title: r.playlist_title, events: r.events, skips: r.skips, skip_rate: r.skip_rate, completion_rate: r.completion_rate, avg_listen_seconds: r.avg_listen_seconds, likes: r.likes, replays: r.replays, unique_tracks: r.unique_tracks };
}

export default function PlaylistExperimentSection() {
  const [tab, setTab] = useState<Tab>('experiments');
  const [intel, setIntel] = useState<PlaylistIntelligence | null>(null);
  const [experiments, setExperiments] = useState<PlaylistExperimentRow[] | null>(null);
  const [learning, setLearning] = useState<ExperimentLearningRow[] | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PlaylistExperimentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [i, e] = await Promise.all([fetchPlaylistIntelligence('30d').catch(() => null), fetchPlaylistExperiments(null, 50)]);
      setIntel(i); setExperiments(e);
    } catch (ex) { setErr(classifyAdminError(ex)); } finally { setLoading(false); }
  }, []);
  const loadLearning = useCallback(async () => {
    try { setLearning(await fetchExperimentLearning()); } catch { setLearning([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'learning') void loadLearning(); }, [tab, loadLearning]);

  const playlistOptions = useMemo(() => (intel?.playlists ?? []).filter((p) => p.playlist_id).map((p) => ({ id: p.playlist_id as string, title: p.playlist_title ?? '(제목 없음)' })), [intel]);

  async function createExperiment(payload: Record<string, unknown>) {
    setBusy(true);
    try { await upsertPlaylistExperiment(null, payload); toast.success('실험 생성(초안)'); await load(); }
    catch (e) { toast.error(`생성 실패: ${friendlyError(e, '0485 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }
  async function changeStatus(exp: PlaylistExperimentRow, status: 'running' | 'cancelled') {
    setBusy(true);
    try { await setPlaylistExperimentStatus(exp.id, status); toast.success(`상태: ${STATUS_LABEL[status]}`); await load(); }
    catch (e) { toast.error(`상태 변경 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }
  function openComparison(exp: PlaylistExperimentRow) { setSelected(exp); setTab('comparison'); }

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><FlaskConical size={16} /> Playlist Optimization & Experiments</span>}
      subtitle="실제 재생 이벤트 기반 A/B 실험 — 자동 교체 없음, 승자는 추천만(Evidence 필수)"
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
      {err && <AdminAlert tone="warning" title="실험 데이터를 불러오지 못했어요" description={`${err.message} · 0485 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'experiments' && <ExperimentsTab experiments={experiments} loading={loading} busy={busy} options={playlistOptions} industries={intel?.industries.map((i) => i.store_type_slug) ?? []} onCreate={createExperiment} onStatus={changeStatus} onCompare={openComparison} />}
      {tab === 'comparison' && <ComparisonTab exp={selected} busy={busy} setBusy={setBusy} onDone={load} toCompareKpi={toCompareKpi} />}
      {tab === 'history' && <HistoryTab experiments={(experiments ?? []).filter((e) => e.status === 'completed')} loading={loading} />}
      {tab === 'learning' && <LearningTab rows={learning} />}
    </AdminCard>
  );
}

/* ── Experiments (create + list) ───────────────────────────── */
function ExperimentsTab({ experiments, loading, busy, options, industries, onCreate, onStatus, onCompare }: {
  experiments: PlaylistExperimentRow[] | null; loading: boolean; busy: boolean;
  options: { id: string; title: string }[]; industries: string[];
  onCreate: (payload: Record<string, unknown>) => void;
  onStatus: (e: PlaylistExperimentRow, s: 'running' | 'cancelled') => void; onCompare: (e: PlaylistExperimentRow) => void;
}) {
  const [name, setName] = useState('');
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [scope, setScope] = useState<typeof SCOPES[number]>('all');
  const [scopeValue, setScopeValue] = useState('');
  const [range, setRange] = useState<typeof RANGES[number]>('30d');

  const scopeOptions = scope === 'industry' || scope === 'store_type' ? industries
    : scope === 'time' ? ['새벽', '아침', '점심', '오후', '저녁', '심야']
      : scope === 'season' ? ['봄', '여름', '가을', '겨울'] : [];

  function submit() {
    if (!name.trim() || !a || !b || a === b) { toast.error('이름과 서로 다른 Playlist A/B 를 선택하세요.'); return; }
    const at = options.find((o) => o.id === a)?.title; const bt = options.find((o) => o.id === b)?.title;
    onCreate({ name: name.trim(), playlist_a_id: a, playlist_a_title: at, playlist_b_id: b, playlist_b_title: bt, scope_type: scope, scope_value: scope === 'all' ? null : scopeValue || null, range });
    setName('');
  }

  return (
    <div className="space-y-3">
      {/* 생성 폼 */}
      <div className="rounded-xl bg-bg-deep p-3">
        <p className="mb-2 flex items-center gap-1 text-[11px] font-bold text-ink"><Plus size={13} /> 새 실험 (초안 생성 · 자동 실행 없음)</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="실험 이름" className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim" />
          <div className="flex gap-2">
            <select value={scope} onChange={(e) => { setScope(e.target.value as typeof SCOPES[number]); setScopeValue(''); }} className="flex-1 rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {scopeOptions.length > 0 && (
              <select value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} className="flex-1 rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
                <option value="">범위 선택</option>
                {scopeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select value={range} onChange={(e) => setRange(e.target.value as typeof RANGES[number])} className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
              {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <select value={a} onChange={(e) => setA(e.target.value)} className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
            <option value="">Playlist A</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <select value={b} onChange={(e) => setB(e.target.value)} className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
            <option value="">Playlist B</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </div>
        <div className="mt-2 flex justify-end">
          <button disabled={busy} onClick={submit} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40"><Plus size={12} /> 실험 생성</button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? <div className="h-24 animate-pulse rounded-2xl bg-bg-deep" />
        : !experiments || experiments.length === 0 ? <AdminEmpty icon={<Inbox size={24} />} title="실험 없음" description="위에서 A/B 실험을 생성하세요 (0485 미적용 시 저장 비활성)." />
          : <div className="space-y-2">
            {experiments.map((e) => (
              <div key={e.id} className="rounded-xl bg-bg-deep p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-ink">{e.name}</span>
                      <AdminBadge tone={STATUS_TONE[e.status] ?? 'neutral'} size="sm">{STATUS_LABEL[e.status] ?? e.status}</AdminBadge>
                      {e.winner && <AdminBadge tone={WINNER_TONE[e.winner as keyof typeof WINNER_TONE] ?? 'neutral'} size="sm">{WINNER_LABEL[e.winner as keyof typeof WINNER_LABEL] ?? e.winner}</AdminBadge>}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-mute">{e.playlist_a_title} vs {e.playlist_b_title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-dim">scope {e.scope_type}{e.scope_value ? `·${e.scope_value}` : ''} · {e.range} · {relativeTimeKo(e.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {e.status === 'draft' && <button disabled={busy} onClick={() => onStatus(e, 'running')} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40"><Play size={11} /> 실행</button>}
                    {(e.status === 'running' || e.status === 'draft') && <button disabled={busy} onClick={() => onCompare(e)} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40"><GitCompare size={11} /> 비교</button>}
                    {(e.status === 'running' || e.status === 'draft') && <button disabled={busy} onClick={() => onStatus(e, 'cancelled')} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40"><Ban size={11} /> 취소</button>}
                    {e.status === 'completed' && <button onClick={() => onCompare(e)} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink">결과</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>}
    </div>
  );
}

/* ── Comparison ────────────────────────────────────────────── */
function ComparisonTab({ exp, busy, setBusy, onDone, toCompareKpi }: {
  exp: PlaylistExperimentRow | null; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void;
  toCompareKpi: (r: { playlist_id: string | null; playlist_title: string | null; events: number; skips: number; skip_rate: number | null; completion_rate: number | null; avg_listen_seconds: number | null; likes: number; replays: number; unique_tracks: number }) => CompareKpi;
}) {
  const [metrics, setMetrics] = useState<MetricCompare[] | null>(null);
  const [decision, setDecision] = useState<WinnerResult | null>(null);
  const [pair, setPair] = useState<{ a: CompareKpi | null; b: CompareKpi | null }>({ a: null, b: null });
  const [loading, setLoading] = useState(false);

  const runCompare = useCallback(async () => {
    if (!exp || !exp.playlist_a_id || !exp.playlist_b_id) return;
    setLoading(true);
    try {
      const res = await comparePlaylists({ playlistA: exp.playlist_a_id, playlistB: exp.playlist_b_id, scopeType: exp.scope_type, scopeValue: exp.scope_value, range: exp.range });
      const { a, b } = alignRows(res.rows.map(toCompareKpi), exp.playlist_a_id, exp.playlist_b_id);
      setPair({ a, b });
      if (a && b) {
        const m = compareKpis(a, b);
        setMetrics(m);
        setDecision(decideWinner(m, a.events, b.events));
      } else { setMetrics([]); setDecision(null); }
    } catch (e) { toast.error(`비교 실패: ${friendlyError(e, '0485 미적용일 수 있음')}`); }
    finally { setLoading(false); }
  }, [exp, toCompareKpi]);

  useEffect(() => { void runCompare(); }, [runCompare]);

  async function conclude() {
    if (!exp || !metrics || !decision) return;
    const evidence = decision.winner === 'insufficient' ? [] : buildWinnerEvidence(metrics);
    setBusy(true);
    try {
      await concludePlaylistExperiment(exp.id, decision.winner, { metrics, decision, a: pair.a, b: pair.b }, evidence);
      toast.success(`실험 종결: ${WINNER_LABEL[decision.winner]} (자동 교체 없음 · 추천만)`);
      onDone();
    } catch (e) { toast.error(`종결 실패: ${friendlyError(e, '근거 부족이거나 0485 미적용')}`); }
    finally { setBusy(false); }
  }

  if (!exp) return <AdminEmpty icon={<GitCompare size={24} />} title="선택된 실험 없음" description="Experiments 탭에서 실험의 '비교' 를 누르세요." />;
  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-ink">{exp.name} · {exp.playlist_a_title} vs {exp.playlist_b_title}</p>
        <button onClick={() => void runCompare()} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink">다시 비교</button>
      </div>
      {!pair.a || !pair.b
        ? <AdminAlert tone="warning" title="비교 불가" description="선택 범위에서 한쪽 Playlist 의 재생 이벤트가 없습니다(Sample 부족)." />
        : <>
          {decision && <AdminAlert tone={WINNER_TONE[decision.winner] === 'success' ? 'success' : decision.winner === 'insufficient' ? 'warning' : 'info'} icon={<Trophy size={16} />} title={`결과: ${WINNER_LABEL[decision.winner]}`} description={decision.reason} />}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead><tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                <th className="px-2 py-2 font-semibold">지표</th>
                <th className="px-2 py-2 text-right font-semibold">A</th>
                <th className="px-2 py-2 text-right font-semibold">B</th>
                <th className="px-2 py-2 text-center font-semibold">승</th>
              </tr></thead>
              <tbody>
                {(metrics ?? []).map((m) => (
                  <tr key={m.key} className="border-b border-line/5 last:border-0">
                    <td className="px-2 py-2 text-ink">{m.label} <span className="text-[9px] text-ink-dim">({m.direction === 'higher' ? '↑' : '↓'})</span></td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(m.aValue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(m.bValue)}</td>
                    <td className="px-2 py-2 text-center"><AdminBadge tone={m.winner === 'na' ? 'neutral' : m.winner === 'tie' ? 'neutral' : 'success'} size="sm">{METRIC_WINNER_LABEL[m.winner]}</AdminBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {exp.status !== 'completed' && decision && (
            <div className="flex justify-end">
              <button disabled={busy} onClick={() => void conclude()} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40">
                <Trophy size={12} /> 승자 확정·종결 (추천만)
              </button>
            </div>
          )}
        </>}
    </div>
  );
}

/* ── History ───────────────────────────────────────────────── */
function HistoryTab({ experiments, loading }: { experiments: PlaylistExperimentRow[]; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (experiments.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="완료된 실험 없음" description="실험을 종결하면 여기에 표시됩니다." />;
  return (
    <div className="space-y-1.5">
      {experiments.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-ink">{e.name} · {e.playlist_a_title} vs {e.playlist_b_title}</span>
          <AdminBadge tone={WINNER_TONE[e.winner as keyof typeof WINNER_TONE] ?? 'neutral'} size="sm">{WINNER_LABEL[e.winner as keyof typeof WINNER_LABEL] ?? e.winner ?? '—'}</AdminBadge>
          <span className="shrink-0 text-ink-dim">{e.ended_at ? relativeTimeKo(e.ended_at) : relativeTimeKo(e.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Learning ──────────────────────────────────────────────── */
function LearningTab({ rows }: { rows: ExperimentLearningRow[] | null }) {
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Activity size={24} />} title="학습 신호 없음" description="완료 실험이 쌓이면 승자 빈도가 집계됩니다 (참고용 · 자동 반영 없음)." />;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-ink-mute">참고용 승자 빈도 — 자동 Rule/Weight/Playlist 변경 없음</p>
      {rows.map((r) => (
        <div key={r.playlist_title} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-ink">{r.playlist_title}</span>
          <span className="text-ink-dim">승 {NUM(r.wins)} / 등장 {NUM(r.appearances)}</span>
        </div>
      ))}
    </div>
  );
}
