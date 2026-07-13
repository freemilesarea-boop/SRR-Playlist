/**
 * AdaptiveRotationSection — Adaptive Rotation & Anti-Fatigue Sequencing (Phase AI-PLAYLIST-5).
 *
 * Generator 가 선택한 Track 집합을 입력받아 반복 피로도·편중·흐름을 고려한 재생 순서 초안
 * (Rotation Draft)을 생성한다. Selection≠Sequencing. **자동 Queue/Scheduler/Playback 반영
 * 없음.** 승인=Publish 아님. 무작위 순서 금지(결정론적). 기존 구조 무변경(읽기 전용).
 *
 * 탭: Generator · Simulation · Drafts · Comparison · History · Learning · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shuffle, Activity, ListMusic, GitCompare, History as HistoryIcon, BookOpen, RefreshCw, Inbox, Sparkles, CheckCircle2 } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchRotationPool, saveRotationDraft, fetchRotationDrafts, setRotationDraftStatus, fetchRotationHistory, fetchRotationLearning,
  type RotationPoolTrack, type RotationDraftRow, type RotationHistoryRow, type RotationLearning,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { INDUSTRY_PROFILES } from '@/lib/playlistGenerator';
import {
  generateSequence, simulateSequence, compareSequences, DEFAULT_SEQUENCE_CONFIG,
  SUPPORT_MATRIX, BUCKET_LABEL, STATUS_LABEL, STATUS_TONE,
  type RotationTrack, type SequenceResult, type RotationSimulation, type SequenceConfig,
} from '@/lib/rotationSequencer';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '데이터 없음' : `${n}%`);
const INDUSTRIES = Object.keys(INDUSTRY_PROFILES);

type Tab = 'generator' | 'simulation' | 'drafts' | 'comparison' | 'history' | 'learning' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Shuffle }[] = [
  { key: 'generator', label: 'Generator', icon: Shuffle },
  { key: 'simulation', label: 'Simulation', icon: Activity },
  { key: 'drafts', label: 'Drafts', icon: ListMusic },
  { key: 'comparison', label: 'Comparison', icon: GitCompare },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'learning', label: 'Learning', icon: Activity },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

function toRotationTrack(r: RotationPoolTrack): RotationTrack { return { ...r, compatibility: null }; }

export default function AdaptiveRotationSection() {
  const [tab, setTab] = useState<Tab>('generator');
  const [pool, setPool] = useState<RotationTrack[]>([]);
  const [drafts, setDrafts] = useState<RotationDraftRow[] | null>(null);
  const [history, setHistory] = useState<RotationHistoryRow[] | null>(null);
  const [learning, setLearning] = useState<RotationLearning | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const [storeType, setStoreType] = useState('cafe');
  const [count, setCount] = useState(20);
  const [maxFatigue, setMaxFatigue] = useState(85);
  const [result, setResult] = useState<SequenceResult | null>(null);
  const [sim, setSim] = useState<RotationSimulation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setPool((await fetchRotationPool('30d', 500)).map(toRotationTrack)); }
    catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  const loadDrafts = useCallback(async () => { try { setDrafts(await fetchRotationDrafts(null, 50)); } catch { setDrafts([]); } }, []);
  const loadHistory = useCallback(async () => { try { const [h, l] = await Promise.all([fetchRotationHistory(100).catch(() => [] as RotationHistoryRow[]), fetchRotationLearning().catch(() => null)]); setHistory(h); setLearning(l); } catch { setHistory([]); } }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'drafts' || tab === 'comparison') void loadDrafts(); if (tab === 'history' || tab === 'learning') void loadHistory(); }, [tab, loadDrafts, loadHistory]);

  const cfg: SequenceConfig = useMemo(() => ({ ...DEFAULT_SEQUENCE_CONFIG, targetCount: count, maxFatigue }), [count, maxFatigue]);

  function runGenerate() {
    // Sequencing 입력 = 업종 적합 Track pool(Generator 선택 대체 — 실제 pool 필터). 새 Track 추가 없음.
    const profile = INDUSTRY_PROFILES[storeType];
    const filtered = pool.filter((t) => profile.genres.includes((t.main_genre ?? '').toLowerCase()) || profile.moods.includes((t.mood ?? '').trim()) || (t.completion_rate ?? 0) >= 70);
    const src = filtered.length >= 3 ? filtered : pool;
    const r = generateSequence(src, cfg, nowMs);
    setResult(r); setSim(simulateSequence(r));
    if (r.sequence.length === 0) toast.info('시퀀스 생성 실패 — 조건 완화 또는 Pool 확인.');
    else toast.success(`${r.sequence.length}곡 Rotation 순서 생성(초안 · 자동 반영 없음)`);
  }

  async function saveDraft() {
    if (!result || result.sequence.length === 0 || !sim) { toast.error('저장할 시퀀스가 없습니다.'); return; }
    setBusy(true);
    try {
      await saveRotationDraft({
        name: `${INDUSTRY_PROFILES[storeType]?.label ?? storeType} Rotation ${result.sequence.length}곡`, store_type_slug: storeType,
        target_duration_minutes: sim.durationMinutes, config: { targetCount: count, maxFatigue },
        sequence: result.sequence.map((s) => ({ position: s.position, track_id: s.track.track_id, title: s.track.title, bucket: s.bucket, score: s.score, fatigue: s.fatigue, reason: s.reason })),
        simulation: sim,
        evidence: result.relaxations.length ? result.relaxations.map((r) => ({ position: r.position, constraint: r.constraint, detail: r.detail })) : [{ constraint: 'none', detail: 'Hard/Soft 위반 없음' }],
      });
      toast.success('Rotation Draft 저장 (승인 후 기존 Playlist/Rollout 흐름)');
      if (tab === 'drafts') void loadDrafts();
    } catch (e) { toast.error(`저장 실패: ${friendlyError(e, '0488 미적용/중복 Track')}`); }
    finally { setBusy(false); }
  }

  async function decide(d: RotationDraftRow, status: 'approved' | 'rejected') {
    setBusy(true);
    try { await setRotationDraftStatus(d.id, status); toast.success(`${status === 'approved' ? '승인(Queue 반영 아님)' : '반려'}`); await loadDrafts(); }
    catch (e) { toast.error(`처리 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Shuffle size={16} /> Adaptive Rotation & Anti-Fatigue</span>}
      subtitle="재생 순서 초안 생성 (결정론적) — 자동 Queue/Scheduler 반영 없음, 승인=Publish 아님"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Pool 갱신
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
      {err && <AdminAlert tone="warning" title="Rotation Pool 을 불러오지 못했어요" description={`${err.message} · 0488 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {(tab === 'generator' || tab === 'simulation') && (
        <>
          <div className="rounded-xl bg-bg-deep p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[10px] text-ink-dim">업종
                <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
                  {INDUSTRIES.map((s) => <option key={s} value={s}>{INDUSTRY_PROFILES[s].label}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-ink-dim">곡 수
                <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, +e.target.value || 1)))} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink" />
              </label>
              <label className="text-[10px] text-ink-dim">최대 Fatigue
                <input type="number" min={0} max={100} value={maxFatigue} onChange={(e) => setMaxFatigue(Math.max(0, Math.min(100, +e.target.value || 0)))} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink" />
              </label>
              <div className="flex items-end"><button disabled={busy || loading} onClick={runGenerate} className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40"><Sparkles size={12} /> 순서 생성</button></div>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-dim">Pool {NUM(pool.length)}곡 · Rotation Budget: Core50·Winner20·New10·재발견15·Surprise5 · Energy 직접 데이터 없음 — BPM/Mood 흐름만 사용</p>
          </div>

          {tab === 'generator' && result && (result.sequence.length === 0
            ? <AdminEmpty icon={<Inbox size={24} />} title="시퀀스 없음" description="조건을 완화하거나 Pool 을 확인하세요." />
            : <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-ink">Rotation 순서 ({result.sequence.length}곡) · 선택 이유 공개</p>
                <button disabled={busy} onClick={saveDraft} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">Draft 저장</button>
              </div>
              {result.relaxations.length > 0 && <AdminAlert tone="warning" title={`Constraint 완화 ${result.relaxations.length}건`} description="후보 부족으로 일부 Soft Constraint 를 최소 위반으로 완화했습니다(숨기지 않음)." />}
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {result.sequence.map((s) => (
                  <div key={s.track.track_id} className="rounded-lg bg-bg-deep px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-ink"><span className="text-ink-dim">#{s.position + 1}</span> {s.track.title}{s.track.artist ? ` · ${s.track.artist}` : ''}</span>
                      <span className="flex shrink-0 items-center gap-1"><AdminBadge tone="neutral" size="sm">{BUCKET_LABEL[s.bucket]}</AdminBadge><span className="text-[11px] tabular-nums text-ink">seq {s.score}</span></span>
                    </div>
                    <p className="text-[9px] text-ink-dim">{s.track.main_genre ?? '—'} · {s.track.mood ?? '—'} · fatigue {s.fatigue} · 완주 {PCT(s.track.completion_rate)}</p>
                  </div>
                ))}
              </div>
            </div>)}

          {tab === 'simulation' && (sim
            ? <SimulationView sim={sim} />
            : <AdminEmpty icon={<Activity size={24} />} title="시뮬레이션 없음" description="Generator 탭에서 순서를 먼저 생성하세요." />)}
        </>
      )}

      {tab === 'drafts' && <DraftsTab drafts={drafts} busy={busy} onDecide={decide} />}
      {tab === 'comparison' && <ComparisonTab drafts={drafts} currentSim={sim} />}
      {tab === 'history' && <HistoryTab rows={history} />}
      {tab === 'learning' && <LearningTab data={learning} />}
      {tab === 'support' && <SupportTab />}
    </AdminCard>
  );
}

/* ── Simulation ────────────────────────────────────────────── */
function SimulationView({ sim }: { sim: RotationSimulation }) {
  const stats: { label: string; value: string }[] = [
    { label: '곡 수', value: NUM(sim.trackCount) }, { label: '총 시간(분)', value: NUM(sim.durationMinutes) },
    { label: '아티스트', value: NUM(sim.artistCount) }, { label: '장르', value: NUM(sim.genreCount) }, { label: '무드', value: NUM(sim.moodCount) },
    { label: '평균 완주', value: PCT(sim.avgCompletion) }, { label: '평균 Skip Risk', value: PCT(sim.avgSkipRisk) }, { label: '평균 Fatigue', value: `${sim.avgFatigue}` },
    { label: '아티스트 최대 점유', value: `${sim.maxArtistShare}%` }, { label: '장르 최대 점유', value: `${sim.maxGenreShare}%` },
    { label: '연속 아티스트 위반', value: NUM(sim.consecutiveArtistViolations) }, { label: '연속 장르 위반', value: NUM(sim.consecutiveGenreViolations) },
    { label: '평균 BPM 변화', value: sim.avgBpmDelta != null ? `${sim.avgBpmDelta}` : '데이터 없음' }, { label: 'Null 메타 비율', value: `${sim.nullMetadataRate}%` }, { label: 'Constraint 완화', value: NUM(sim.relaxationCount) },
  ];
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-ink-dim">실측 집계만 표시 · 효과(매출/체류) 예측 없음</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => <div key={s.label} className="rounded-xl bg-bg-deep p-2.5"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.label}</p><p className="mt-0.5 text-sm font-bold text-ink">{s.value}</p></div>)}
      </div>
      <p className="text-[10px] text-ink-dim">Budget 실제: {(['core_verified', 'recent_winner', 'new_test', 'rediscovery', 'surprise'] as const).map((b) => `${BUCKET_LABEL[b]} ${sim.bucketActual[b]}`).join(' · ')}</p>
    </div>
  );
}

/* ── Drafts ────────────────────────────────────────────────── */
function DraftsTab({ drafts, busy, onDecide }: { drafts: RotationDraftRow[] | null; busy: boolean; onDecide: (d: RotationDraftRow, s: 'approved' | 'rejected') => void }) {
  if (!drafts) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (drafts.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="Rotation Draft 없음" description="Generator 에서 순서를 생성/저장하세요 (0488 미적용 시 비어 있음)." />;
  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <div key={d.id} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-ink">{d.name}</span>
                <AdminBadge tone={STATUS_TONE[d.status] ?? 'neutral'} size="sm">{STATUS_LABEL[d.status] ?? d.status}</AdminBadge>
                <AdminBadge tone="neutral" size="sm">{Array.isArray(d.sequence) ? d.sequence.length : 0}곡</AdminBadge>
              </div>
              <p className="mt-1 text-[10px] text-ink-dim">{d.store_type_slug ?? '—'} · {d.target_duration_minutes ? `${d.target_duration_minutes}분 · ` : ''}{relativeTimeKo(d.created_at)}</p>
            </div>
            {(d.status === 'simulated' || d.status === 'draft') && (
              <div className="flex shrink-0 gap-1">
                <button disabled={busy} onClick={() => onDecide(d, 'rejected')} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">반려</button>
                <button disabled={busy} onClick={() => onDecide(d, 'approved')} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40"><CheckCircle2 size={11} /> 승인(반영 아님)</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Comparison (저장된 Draft simulation vs 현재) ───────────── */
function ComparisonTab({ drafts, currentSim }: { drafts: RotationDraftRow[] | null; currentSim: RotationSimulation | null }) {
  if (!currentSim) return <AdminEmpty icon={<GitCompare size={24} />} title="현재 시퀀스 없음" description="Generator 에서 순서를 생성하면 저장된 Draft 와 Simulation 비교합니다." />;
  const prev = (drafts ?? []).find((d) => d.simulation && (d.simulation as RotationSimulation).trackCount > 0);
  if (!prev) return <AdminEmpty icon={<GitCompare size={24} />} title="비교할 저장 Draft 없음" description="저장된 Rotation Draft 가 있으면 비교합니다." />;
  const cmp = compareSequences(prev.simulation as RotationSimulation, currentSim);
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" icon={<GitCompare size={16} />} title="Simulation 비교 (적용 전 성과 비교 없음)" description={`저장 Draft "${prev.name}" vs 현재 생성 시퀀스 — 실측 Playback 성과는 적용 전 비교하지 않습니다.`} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead><tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">지표</th><th className="px-2 py-2 text-right font-semibold">저장</th><th className="px-2 py-2 text-right font-semibold">현재</th><th className="px-2 py-2 text-center font-semibold">우위</th>
          </tr></thead>
          <tbody>
            {cmp.map((c) => (
              <tr key={c.metric} className="border-b border-line/5 last:border-0">
                <td className="px-2 py-2 text-ink">{c.metric}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(c.existing)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{NUM(c.rotation)}</td>
                <td className="px-2 py-2 text-center"><AdminBadge tone={c.better === 'rotation' ? 'success' : c.better === 'existing' ? 'warning' : 'neutral'} size="sm">{c.better === 'rotation' ? '현재' : c.better === 'existing' ? '저장' : c.better === 'tie' ? '동률' : '—'}</AdminBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── History / Learning / Support ──────────────────────────── */
function HistoryTab({ rows }: { rows: RotationHistoryRow[] | null }) {
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="이력 없음" description="생성/승인/반려 기록이 표시됩니다 (0488 미적용 시 비어 있음)." />;
  return (
    <div className="space-y-1.5">
      {rows.map((h) => (
        <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate text-ink">{h.action} {h.from_status ? `${h.from_status}→${h.to_status}` : h.to_status ?? ''}</span>
          <span className="shrink-0 text-ink-dim">{relativeTimeKo(h.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
function LearningTab({ data }: { data: RotationLearning | null }) {
  if (!data) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-mute">참고용 — 자동 Weight/Rule 변경 없음</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ l: '전체 Draft', v: NUM(data.total) }, { l: '승인', v: NUM(data.approved) }, { l: '반려', v: NUM(data.rejected) }, { l: '승인율', v: data.approval_rate != null ? `${data.approval_rate}%` : '—' }].map((s) => (
          <div key={s.l} className="rounded-xl bg-bg-deep p-3"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.l}</p><p className="mt-1 text-lg font-bold text-ink">{s.v}</p></div>
        ))}
      </div>
    </div>
  );
}
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
