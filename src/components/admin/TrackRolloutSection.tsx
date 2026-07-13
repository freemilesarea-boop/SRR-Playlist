/**
 * TrackRolloutSection — New Track Test Pool & Progressive Rollout (Phase AI-PLAYLIST-3).
 *
 * 신규 음원을 전체 매장에 즉시 배포하지 않고 Test Pool → Pilot → Expanded → Global 순으로
 * 점진 확산한다. **자동 배포/승격/Rollback 없음** — 실제 재생 이벤트 KPI 로 추천만 하고
 * 단계 변경은 운영자 승인(수동)이다. 기존 Playback/Queue/Playlist/Experiment 무변경.
 *
 * 탭: Test Pool · Pilot · Expanded · Global · History · Learning.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Rocket, FlaskConical, Radio, Globe, History as HistoryIcon, Activity, RefreshCw, Inbox, ChevronUp, ChevronDown, Plus, Search } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchTopTracks, fetchTrackRollouts, upsertTrackRollout, setTrackRolloutStage, compareTrackRollout,
  fetchTrackRolloutHistory, fetchTrackRolloutLearning,
  type TrackRolloutRow, type TrackRolloutHistoryRow, type TrackRolloutLearning, type TopTrack,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  evaluatePromotion, normalizeKpi, nextStage, prevStage, suggestNextPercent,
  STAGE_LABEL, STAGE_TONE, STAGE_PERCENT, DECISION_LABEL, DECISION_TONE,
  type RolloutStage, type RolloutEvaluation,
} from '@/lib/trackRollout';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'test_pool' | 'pilot' | 'expanded' | 'global' | 'history' | 'learning';
const TABS: { key: Tab; label: string; icon: typeof Rocket }[] = [
  { key: 'test_pool', label: 'Test Pool', icon: FlaskConical },
  { key: 'pilot', label: 'Pilot', icon: Radio },
  { key: 'expanded', label: 'Expanded', icon: Rocket },
  { key: 'global', label: 'Global', icon: Globe },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'learning', label: 'Learning', icon: Activity },
];
// 탭 → 포함 stage 필터.
const TAB_STAGES: Record<Exclude<Tab, 'history' | 'learning'>, RolloutStage[]> = {
  test_pool: ['draft', 'test_pool'], pilot: ['pilot', 'limited'], expanded: ['expanded'], global: ['global', 'archived'],
};

export default function TrackRolloutSection() {
  const [tab, setTab] = useState<Tab>('test_pool');
  const [rollouts, setRollouts] = useState<TrackRolloutRow[] | null>(null);
  const [tracks, setTracks] = useState<TopTrack[]>([]);
  const [history, setHistory] = useState<TrackRolloutHistoryRow[] | null>(null);
  const [learning, setLearning] = useState<TrackRolloutLearning | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evals, setEvals] = useState<Record<string, RolloutEvaluation>>({});

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [r, t] = await Promise.all([fetchTrackRollouts(null, 200), fetchTopTracks(50).catch(() => [] as TopTrack[])]);
      setRollouts(r); setTracks(t);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  const loadHistory = useCallback(async () => {
    try { const [h, l] = await Promise.all([fetchTrackRolloutHistory(100).catch(() => [] as TrackRolloutHistoryRow[]), fetchTrackRolloutLearning().catch(() => null)]); setHistory(h); setLearning(l); } catch { setHistory([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'history' || tab === 'learning') void loadHistory(); }, [tab, loadHistory]);

  async function createRollout(trackId: string, title: string) {
    setBusy(true);
    try { await upsertTrackRollout(null, { track_id: trackId, track_title: title }); toast.success(`Test Pool 진입: ${title}`); await load(); }
    catch (e) { toast.error(`생성 실패: ${friendlyError(e, '0486 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  async function evaluate(r: TrackRolloutRow) {
    setBusy(true);
    try {
      const res = await compareTrackRollout({ trackId: r.track_id, scopeType: r.scope_type, scopeValue: r.scope_value, range: '30d' });
      const kpi = normalizeKpi(res.kpi);
      const evalResult = evaluatePromotion(kpi, r.promotion_config);
      setEvals((prev) => ({ ...prev, [r.id]: evalResult }));
      toast.info(`${r.track_title}: ${DECISION_LABEL[evalResult.decision]}`);
    } catch (e) { toast.error(`평가 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  async function move(r: TrackRolloutRow, dir: 'promote' | 'rollback' | 'archive') {
    const ev = evals[r.id];
    const to = dir === 'archive' ? 'archived' : dir === 'promote' ? nextStage(r.stage as RolloutStage) : prevStage(r.stage as RolloutStage);
    if (!to) { toast.error('이동할 단계가 없습니다.'); return; }
    // promote/rollback 은 평가 Evidence 필수(서버도 강제).
    if ((dir === 'promote' || dir === 'rollback')) {
      if (!ev) { toast.error('먼저 "평가"를 실행해 Evidence 를 확보하세요.'); return; }
      if (dir === 'promote' && ev.decision !== 'promote') { toast.error('승격 기준 미충족 — 평가 결과가 승격 추천이 아닙니다.'); return; }
    }
    setBusy(true);
    try {
      await setTrackRolloutStage({
        id: r.id, toStage: to, decision: dir,
        toPercent: dir === 'promote' ? suggestNextPercent(r.stage as RolloutStage) : STAGE_PERCENT[to],
        evidence: dir === 'archive' ? [] : ev?.evidence ?? [], reason: ev?.reason,
      });
      toast.success(`${STAGE_LABEL[to]} (${DECISION_LABEL[dir === 'promote' ? 'promote' : dir === 'rollback' ? 'rollback' : 'hold']}) · 자동 배포 아님`);
      await load(); if (tab === 'history') void loadHistory();
    } catch (e) { toast.error(`단계 변경 실패: ${friendlyError(e, '근거 부족이거나 0486 미적용')}`); }
    finally { setBusy(false); }
  }

  const visible = useMemo(() => {
    if (tab === 'history' || tab === 'learning' || !rollouts) return [];
    const stages = TAB_STAGES[tab];
    return rollouts.filter((r) => stages.includes(r.stage as RolloutStage));
  }, [rollouts, tab]);

  const activeTrackIds = useMemo(() => new Set((rollouts ?? []).map((r) => r.track_id)), [rollouts]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Rocket size={16} /> New Track Progressive Rollout</span>}
      subtitle="신규 음원 점진 확산 (Test Pool→Pilot→Expanded→Global) — 자동 배포 없음, 실제 KPI 로 추천만"
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
      {err && <AdminAlert tone="warning" title="Rollout 데이터를 불러오지 못했어요" description={`${err.message} · 0486 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'test_pool' && <TrackPicker tracks={tracks} activeIds={activeTrackIds} busy={busy} onAdd={createRollout} />}
      {(tab === 'test_pool' || tab === 'pilot' || tab === 'expanded' || tab === 'global') && (
        <RolloutList rollouts={visible} loading={loading} busy={busy} evals={evals} onEvaluate={evaluate} onMove={move} />
      )}
      {tab === 'history' && <HistoryTab rows={history} />}
      {tab === 'learning' && <LearningTab data={learning} />}
    </AdminCard>
  );
}

/* ── Track Picker (Test Pool 진입) ─────────────────────────── */
function TrackPicker({ tracks, activeIds, busy, onAdd }: { tracks: TopTrack[]; activeIds: Set<string>; busy: boolean; onAdd: (id: string, title: string) => void }) {
  const [q, setQ] = useState('');
  const candidates = tracks.filter((t) => !activeIds.has(t.track_id) && (q === '' || t.title.toLowerCase().includes(q.toLowerCase()))).slice(0, 6);
  return (
    <div className="rounded-xl bg-bg-deep p-3">
      <p className="mb-2 flex items-center gap-1 text-[11px] font-bold text-ink"><Plus size={13} /> Test Pool 진입 (신규 음원 · 자동 확산 없음)</p>
      <div className="mb-2 flex items-center gap-1 rounded-lg bg-bg-card px-2 py-1">
        <Search size={12} className="text-ink-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="트랙 검색" className="w-full bg-transparent text-xs text-ink placeholder:text-ink-dim outline-none" />
      </div>
      {candidates.length === 0 ? <p className="text-[10px] text-ink-dim">추가 가능한 트랙이 없습니다.</p>
        : <div className="space-y-1">
          {candidates.map((t) => (
            <div key={t.track_id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-ink-mute">{t.title}{t.artist ? ` · ${t.artist}` : ''}</span>
              <button disabled={busy} onClick={() => onAdd(t.track_id, t.title)} className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-black disabled:opacity-40">Test Pool 추가</button>
            </div>
          ))}
        </div>}
    </div>
  );
}

/* ── Rollout List ──────────────────────────────────────────── */
function RolloutList({ rollouts, loading, busy, evals, onEvaluate, onMove }: {
  rollouts: TrackRolloutRow[]; loading: boolean; busy: boolean; evals: Record<string, RolloutEvaluation>;
  onEvaluate: (r: TrackRolloutRow) => void; onMove: (r: TrackRolloutRow, d: 'promote' | 'rollback' | 'archive') => void;
}) {
  if (loading) return <div className="h-24 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rollouts.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="해당 단계 음원 없음" description="Test Pool 에서 음원을 추가하거나 승격하세요." />;
  return (
    <div className="space-y-2">
      {rollouts.map((r) => {
        const ev = evals[r.id];
        return (
          <div key={r.id} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">{r.track_title ?? r.track_id.slice(0, 8)}</span>
                  <AdminBadge tone={STAGE_TONE[r.stage as RolloutStage] ?? 'neutral'} size="sm">{STAGE_LABEL[r.stage as RolloutStage] ?? r.stage}</AdminBadge>
                  <AdminBadge tone="neutral" size="sm">{r.rollout_percent}%</AdminBadge>
                  {ev && <AdminBadge tone={DECISION_TONE[ev.decision]} size="sm">{DECISION_LABEL[ev.decision]}</AdminBadge>}
                </div>
                <p className="mt-1 text-[10px] text-ink-dim">기준: 완주≥{r.promotion_config.completion_min} · Skip≤{r.promotion_config.skip_max} · 샘플≥{r.promotion_config.sample_min} · scope {r.scope_type}{r.scope_value ? `·${r.scope_value}` : ''}</p>
                {ev && <p className="mt-0.5 text-[10px]" style={{ color: DECISION_TONE[ev.decision] === 'danger' ? '#f87171' : DECISION_TONE[ev.decision] === 'success' ? '#34d399' : '#fbbf24' }}>{ev.reason} · {ev.evidence.map((e) => `${e.label} ${e.value ?? '—'}${e.pass ? '✓' : '✗'}`).join(' · ')}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <button disabled={busy} onClick={() => onEvaluate(r)} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40"><Activity size={11} /> 평가</button>
                {nextStage(r.stage as RolloutStage) && <button disabled={busy || ev?.decision !== 'promote'} title={ev?.decision !== 'promote' ? '평가 결과가 승격 추천일 때만' : ''} onClick={() => onMove(r, 'promote')} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40"><ChevronUp size={11} /> 승격</button>}
                {prevStage(r.stage as RolloutStage) && <button disabled={busy || !ev} onClick={() => onMove(r, 'rollback')} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40"><ChevronDown size={11} /> Rollback</button>}
                {r.stage !== 'archived' && <button disabled={busy} onClick={() => onMove(r, 'archive')} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink disabled:opacity-40">보관</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── History ───────────────────────────────────────────────── */
function HistoryTab({ rows }: { rows: TrackRolloutHistoryRow[] | null }) {
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="승격/Rollback 이력 없음" description="단계 변경이 기록되면 표시됩니다 (0486 미적용 시 비어 있음)." />;
  return (
    <div className="space-y-1.5">
      {rows.map((h) => (
        <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-ink">{(h.track_id ?? '').slice(0, 8)} · {STAGE_LABEL[h.from_stage as RolloutStage] ?? h.from_stage} → {STAGE_LABEL[h.to_stage as RolloutStage] ?? h.to_stage}</span>
          <AdminBadge tone={h.decision === 'promote' ? 'success' : h.decision === 'rollback' ? 'danger' : 'neutral'} size="sm">{DECISION_LABEL[h.decision as keyof typeof DECISION_LABEL] ?? h.decision}</AdminBadge>
          <span className="shrink-0 text-ink-dim">{relativeTimeKo(h.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Learning ──────────────────────────────────────────────── */
function LearningTab({ data }: { data: TrackRolloutLearning | null }) {
  if (!data) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  const promote = data.by_decision.promote ?? 0;
  const rollback = data.by_decision.rollback ?? 0;
  const decided = promote + rollback;
  const promoteRate = decided > 0 ? Math.round((promote / decided) * 1000) / 10 : null;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-mute">참고용 — 자동 Rule/Threshold 변경 없음</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="전체 Rollout" value={NUM(data.total_rollouts)} />
        <Stat label="승격" value={NUM(promote)} />
        <Stat label="Rollback" value={NUM(rollback)} />
        <Stat label="승격 성공률" value={promoteRate != null ? `${promoteRate}%` : '—'} />
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-bold text-ink">Stage 분포</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.stage_distribution).map(([stage, cnt]) => (
            <AdminBadge key={stage} tone={STAGE_TONE[stage as RolloutStage] ?? 'neutral'} size="sm">{STAGE_LABEL[stage as RolloutStage] ?? stage} {cnt}</AdminBadge>
          ))}
          {Object.keys(data.stage_distribution).length === 0 && <span className="text-[10px] text-ink-dim">데이터 없음</span>}
        </div>
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-bg-deep p-3"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p><p className="mt-1 text-lg font-bold text-ink">{value}</p></div>;
}
