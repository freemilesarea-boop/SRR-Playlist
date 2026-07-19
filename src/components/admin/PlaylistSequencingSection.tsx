/**
 * PlaylistSequencingSection — Sequencing Intelligence & Transition Planning
 * (Phase AI-PLAYLIST-INTEL-2).
 *
 * Phase 1 Draft 의 선택 Track 집합을 **순서만** 재설계한다(추가/제거 없음). 결과는
 * Sequence Draft(0566) 저장 + 사람 검토에서 종료 — playlist_tracks(order_index)/
 * Queue/Scheduler/Player 반영 버튼은 존재하지 않는다. Approve 는 감사 기록.
 *
 * 탭: Create · Sequences · Detail · Compare · Limitations.
 * 시각화는 외부 라이브러리 없이 SVG/HTML 로만 구현하고 수치 표를 함께 제공한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { GitBranch, ListOrdered, FileSearch, Scale, ShieldAlert, RefreshCw, Inbox } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  createAiPlSequence, fetchAiPlDrafts, fetchAiPlSequenceDetail, fetchAiPlSequenceInput,
  fetchAiPlSequences, reevaluateAiPlSequence, setAiPlSequenceStatus,
  type AiPlDraftListRow, type AiPlSeqDetail, type AiPlSeqListRow, type AiPlSeqStatus,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  DEFAULT_SEQ_CONFIG, FIXED_SEQUENCE_WARNING, buildSequenceExplanation, buildSequencePayload,
  compareOrders, computeSequenceQuality, generateSequence, normalizeSequenceTrack,
  type SeqInputRow, type SequenceStrategy, type SequencingConfig, type SequencingTrackFeature,
} from '@/lib/sequencingIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const STRATEGIES: SequenceStrategy[] = ['balanced', 'smooth', 'energy_rise', 'energy_fall', 'steady', 'daypart', 'manual_assist'];

type Tab = 'create' | 'list' | 'detail' | 'compare' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof GitBranch }[] = [
  { key: 'create', label: 'Create', icon: GitBranch },
  { key: 'list', label: 'Sequences', icon: ListOrdered },
  { key: 'detail', label: 'Detail', icon: FileSearch },
  { key: 'compare', label: 'Compare', icon: Scale },
  { key: 'limits', label: 'Limitations', icon: ShieldAlert },
];

const STATUS_TONE: Record<AiPlSeqStatus, 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral', ready_for_review: 'info', approved: 'success', rejected: 'danger', expired: 'warning', archived: 'neutral',
};

const KNOWN_LIMITATIONS = [
  '이 Sequence Draft는 실제 Playlist, Queue, Scheduler 또는 Player에 자동 반영되지 않습니다(Apply/Publish 경로 없음).',
  'Approve는 검토 감사 기록일 뿐이며 playlist_tracks.order_index는 어떤 경로로도 변경되지 않습니다.',
  'Quality Score는 서버(_ai_pl_seq_quality)가 Track Set 불변·Hard Gate와 함께 재계산해 저장합니다.',
  'Key/Camelot 데이터가 저장소에 없어 Harmonic Mixing 평가는 not_available입니다(구현 주장 안 함).',
  'BPM은 단순 절대 Delta로 평가하며 Half/Double-Time을 자동 추론하지 않습니다.',
  'predicted_dayparts 데이터가 없어 daypart 전략의 목표 Curve는 insufficient_data(balanced 기준 평가)입니다.',
  '결측 Energy/BPM/Vocal은 보간하지 않고 Metadata Completeness로 분리 평가합니다.',
  '매장별 최근 재생 데이터가 없어 fatigue는 전체 30일 이벤트 기반이며 store별 구분은 insufficient_data입니다.',
  'Hard(Track Set/고정 Position/원본 정책)는 목표 순서를 위해 완화하지 않으며 충돌 시 sequence_generation_failed를 반환합니다.',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다(정상 동작 단정 없음). Migration 0565/0566은 Production 미적용입니다.',
];

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {hint ? <div className="text-[10px] text-ink-mute">{hint}</div> : null}
    </div>
  );
}

/** Energy Curve — 외부 라이브러리 없이 SVG polyline. 수치 표는 상세 목록이 제공. */
function EnergyCurveSvg({ values }: { values: Array<number | null> }) {
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return <p className="text-[10px] text-ink-mute">Energy 실측값이 2개 미만 — Curve 미표시(보간 없음)</p>;
  const w = 260; const h = 48;
  const pts = values.map((v, i) => (v == null ? null : `${(i / Math.max(1, values.length - 1)) * w},${h - v * h}`))
    .filter((p): p is string => p != null).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full max-w-[260px]" role="img" aria-label="Energy Curve">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
    </svg>
  );
}

export default function PlaylistSequencingSection() {
  const [tab, setTab] = useState<Tab>('create');
  const [drafts, setDrafts] = useState<AiPlDraftListRow[] | null>(null);
  const [sequences, setSequences] = useState<AiPlSeqListRow[] | null>(null);
  const [detail, setDetail] = useState<AiPlSeqDetail | null>(null);
  const [compareA, setCompareA] = useState<AiPlSeqDetail | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [nowMs] = useState(() => Date.now());

  // Create 설정
  const [name, setName] = useState('');
  const [draftId, setDraftId] = useState('');
  const [strategy, setStrategy] = useState<SequenceStrategy>('balanced');
  const [seed, setSeed] = useState(1);
  const [artistGap, setArtistGap] = useState(2);
  const [albumGap, setAlbumGap] = useState(2);
  const [genreRun, setGenreRun] = useState(3);
  const [vocalRun, setVocalRun] = useState(3);
  const [maxEnergyDelta, setMaxEnergyDelta] = useState(0.25);
  const [maxBpmDelta, setMaxBpmDelta] = useState(30);
  const [preview, setPreview] = useState<{
    draftName: string; tracks: SequencingTrackFeature[]; explanation: string[];
    qualityScore: number | null; qualityGrade: string; failure: string[] | null;
    payload: Record<string, unknown> | null; warning: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [d, s] = await Promise.all([fetchAiPlDrafts(null, 100), fetchAiPlSequences(null, 100)]);
      setDrafts(d.filter((x) => x.status === 'approved' || x.status === 'ready_for_review' || x.status === 'draft'));
      setSequences(s);
    } catch (e) { setErr(classifyAdminError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const generatePreview = useCallback(async () => {
    if (!draftId) { toast.error('원본 Draft를 선택하세요.'); return; }
    setBusy(true); setErr(null);
    try {
      const input = await fetchAiPlSequenceInput(draftId);
      const tracks = (input.tracks as unknown as SeqInputRow[]).map(normalizeSequenceTrack);
      const cfg: SequencingConfig = {
        ...DEFAULT_SEQ_CONFIG, strategy, seed,
        artistMinGap: artistGap, albumMinGap: albumGap,
        maxGenreRun: genreRun, maxVocalRun: vocalRun,
        maxEnergyDelta, maxBpmDelta,
      };
      const r = generateSequence(tracks, cfg);
      if (!r.ok) {
        setPreview({ draftName: input.draft_name, tracks, explanation: [], qualityScore: null, qualityGrade: 'insufficient_data', failure: r.reasons, payload: null, warning: null });
        toast.error(`sequence_generation_failed: ${r.reasons.join(', ')}`);
        return;
      }
      const q = computeSequenceQuality(r.ordered, r.transitions, cfg, new Date(nowMs).toISOString());
      const explanation = buildSequenceExplanation(input.draft_name, cfg, r, q);
      const payload = buildSequencePayload(name.trim() || `${input.draft_name} · ${strategy}`, draftId, cfg, r, explanation, q);
      setPreview({
        draftName: input.draft_name, tracks: r.ordered, explanation,
        qualityScore: q.score, qualityGrade: q.grade, failure: null, payload,
        warning: input.draft_status !== 'approved' ? `원본 Draft 상태가 ${input.draft_status} — Preview 성격의 Sequence로 저장됩니다.` : null,
      });
    } catch (e) { setErr(classifyAdminError(e)); toast.error(`입력 조회 실패: ${friendlyError(e, '0566 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }, [draftId, strategy, seed, artistGap, albumGap, genreRun, vocalRun, maxEnergyDelta, maxBpmDelta, name, nowMs]);

  const save = useCallback(async () => {
    if (!preview?.payload) { toast.error('저장할 Sequence가 없습니다.'); return; }
    setBusy(true);
    try {
      const saved = await createAiPlSequence(preview.payload);
      toast.success(saved.duplicate ? '동일 조건 Sequence가 이미 있어 기존 것을 반환했습니다.' : 'Sequence 저장(서버가 Track Set·Hard·품질 재검증). 자동 반영 없음.');
      setDetail(saved); setTab('detail'); await load();
    } catch (e) { toast.error(`저장 거부/실패: ${friendlyError(e, 'Track Set 불일치/Hard 위반 시 서버가 거부합니다')}`); }
    finally { setBusy(false); }
  }, [preview, load]);

  const openDetail = useCallback(async (id: string, forCompare = false) => {
    setBusy(true);
    try {
      const d = await fetchAiPlSequenceDetail(id);
      if (forCompare) { setCompareA(d); setTab('compare'); }
      else { setDetail(d); setTab('detail'); }
    } catch (e) { toast.error(`상세 조회 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }, []);

  const changeStatus = useCallback(async (id: string, status: AiPlSeqStatus) => {
    if (status === 'rejected' && !rejectReason.trim()) { toast.error('거절 사유를 입력하세요.'); return; }
    setBusy(true);
    try {
      const d = await setAiPlSequenceStatus(id, status, status === 'rejected' ? rejectReason.trim() : undefined);
      setDetail(d); setRejectReason('');
      toast.success(status === 'approved' ? '검토 승인 기록(실제 순서 적용 아님)' : `상태 변경: ${status}`);
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${friendlyError(e, 'Hard 위반 시 승격 불가')}`); }
    finally { setBusy(false); }
  }, [rejectReason, load]);

  const toFeature = (t: AiPlSeqDetail['tracks'][number]): SequencingTrackFeature => normalizeSequenceTrack({
    track_id: t.track_id, original_draft_order: t.original_draft_order ?? 0,
    title: t.title, artist: t.artist, album_name: t.album_name, main_genre: t.main_genre,
    mood: t.mood, instrumental: t.instrumental, energy: t.energy, vocal_presence: t.vocal_presence,
    bpm: t.bpm, fit_score: null, events: null,
  });

  return (
    <AdminCard title="Sequencing Intelligence" subtitle="AI-PLAYLIST-INTEL-2 — Transition Planning (Shadow · 순서만 설계 · 자동 반영 없음)">
      <AdminAlert tone="info">{FIXED_SEQUENCE_WARNING}</AdminAlert>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
            <t.icon className="mr-1 inline h-3 w-3" />{t.label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={loading || busy}
          className="ml-auto rounded-full bg-bg-deep px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-50">
          <RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>

      {err ? (
        <div className="mt-3">
          <AdminAlert tone="danger">불러오기 실패: {err.message}</AdminAlert>
          <button type="button" onClick={() => void load()} className="mt-2 rounded bg-bg-deep px-3 py-1.5 text-xs text-ink">다시 시도</button>
        </div>
      ) : null}

      {tab === 'create' ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-[11px] text-ink-mute">원본 Playlist Draft
              <select value={draftId} onChange={(e) => setDraftId(e.target.value)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink">
                <option value="">선택…</option>
                {drafts?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.status} · {d.selected_track_count}곡)</option>)}
              </select>
            </label>
            <label className="text-[11px] text-ink-mute">이름
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="미입력 시 자동" className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Strategy
              <select value={strategy} onChange={(e) => setStrategy(e.target.value as SequenceStrategy)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink">
                {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-ink-mute">Seed
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Artist 최소 간격
              <input type="number" min={1} value={artistGap} onChange={(e) => setArtistGap(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Album 최소 간격
              <input type="number" min={1} value={albumGap} onChange={(e) => setAlbumGap(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Genre 연속 제한
              <input type="number" min={1} value={genreRun} onChange={(e) => setGenreRun(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Vocal 연속 제한
              <input type="number" min={1} value={vocalRun} onChange={(e) => setVocalRun(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최대 Energy Delta
              <input type="number" step={0.05} value={maxEnergyDelta} onChange={(e) => setMaxEnergyDelta(Number(e.target.value) || 0.25)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최대 BPM Delta
              <input type="number" value={maxBpmDelta} onChange={(e) => setMaxBpmDelta(Number(e.target.value) || 30)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void generatePreview()} disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
              {busy ? '계산 중…' : 'Sequence Preview 생성'}
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !preview?.payload}
              className="rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
              Sequence 저장(서버 재검증)
            </button>
          </div>

          {preview ? (
            preview.failure ? (
              <AdminAlert tone="danger">sequence_generation_failed — {preview.failure.join(' · ')} (Hard Constraint는 완화하지 않습니다)</AdminAlert>
            ) : (
              <div className="space-y-2">
                {preview.warning ? <AdminAlert tone="warning">{preview.warning}</AdminAlert> : null}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="원본 Draft" value={preview.draftName} />
                  <Box label="Track 수" value={NUM(preview.tracks.length)} hint="Track Set 불변(순서만 변경)" />
                  <Box label="Quality(미리보기)" value={preview.qualityScore == null ? 'insufficient' : `${preview.qualityScore} (${preview.qualityGrade})`} hint="서버 재계산이 최종" />
                  <Box label="Energy Curve" value="" hint="실측값만 표시" />
                </div>
                <EnergyCurveSvg values={preview.tracks.map((t) => t.energy)} />
                <div className="rounded-lg bg-bg-deep p-3 text-[11px] leading-5 text-ink">
                  {preview.explanation.map((l, i) => <div key={i}>{l}</div>)}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg bg-bg-deep p-2 text-[11px]">
                  {preview.tracks.map((t, i) => (
                    <div key={t.trackId} className="flex justify-between border-b border-white/5 py-1">
                      <span className="text-ink">{i + 1}. {t.title ?? t.trackId} <span className="text-ink-mute">{t.artistKey ?? ''}</span></span>
                      <span className="text-ink-mute">{t.genre ?? '?'} · E {t.energy ?? '—'} · BPM {t.bpm ?? '—'}{t.missing.length ? ` · ${t.missing.join(',')}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <p className="text-[11px] text-ink-mute">원본 Draft를 선택하고 Preview를 생성하세요(동일 입력+Seed → 동일 순서).</p>
          )}
        </div>
      ) : null}

      {tab === 'list' ? (
        <div className="mt-3 space-y-2">
          {loading ? <p className="text-[11px] text-ink-mute">불러오는 중…</p> : null}
          {!loading && sequences && sequences.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Sequence 없음" description="Create 탭에서 생성하세요. (0566 미적용 환경에서는 비어 있습니다)" />
          ) : null}
          {sequences?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2 text-[11px]">
              <div>
                <div className="font-semibold text-ink">{s.name} <AdminBadge tone={STATUS_TONE[s.status]}>{s.status}</AdminBadge></div>
                <div className="text-ink-mute">
                  원본 {s.draft_name} · {s.strategy} · {NUM(s.track_count)}곡 · Quality {s.quality_score == null ? 'insufficient' : `${s.quality_score} (${s.quality_grade})`}
                  · ΔE {s.avg_energy_delta ?? '—'} · {relativeTimeKo(s.created_at, nowMs)} · {s.created_by_name ?? '?'}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void openDetail(s.id)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink hover:text-white disabled:opacity-50">상세</button>
                <button type="button" onClick={() => void openDetail(s.id, true)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink-mute hover:text-ink disabled:opacity-50">비교 A로</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'detail' ? (
        detail ? (
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{detail.sequence.name}</span>
              <AdminBadge tone={STATUS_TONE[detail.sequence.status]}>{detail.sequence.status}</AdminBadge>
              <span className="text-ink-mute">{detail.sequence.strategy} · Seed {detail.sequence.seed} · {detail.sequence.algorithm_version}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Quality(서버)" value={detail.sequence.quality_score == null ? 'insufficient' : `${detail.sequence.quality_score} (${detail.sequence.quality_grade})`} />
              <Box label="아티스트 인접" value={String(detail.sequence.transition_summary.adjacent_same_artist ?? '—')} />
              <Box label="ΔEnergy 평균/최대" value={`${detail.sequence.transition_summary.avg_energy_delta ?? '—'} / ${detail.sequence.transition_summary.max_energy_delta ?? '—'}`} />
              <Box label="ΔBPM 평균/최대" value={`${detail.sequence.transition_summary.avg_bpm_delta ?? '—'} / ${detail.sequence.transition_summary.max_bpm_delta ?? '—'}`} />
              <Box label="Harmonic" value={String(detail.sequence.transition_summary.harmonic_transition ?? 'not_available')} hint="Key 데이터 부재" />
            </div>
            {detail.sequence.warnings.length > 0 ? <AdminAlert tone="warning">{detail.sequence.warnings.join(' · ')}</AdminAlert> : null}
            {detail.sequence.insufficient_data.length > 0 ? <AdminAlert tone="info">데이터 부족: {detail.sequence.insufficient_data.join(', ')}</AdminAlert> : null}
            <EnergyCurveSvg values={detail.tracks.map((t) => t.energy)} />
            <div className="rounded-lg bg-bg-deep p-3 leading-5 text-ink">
              {detail.sequence.explanation.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void reevaluateAiPlSequence(detail.sequence.id).then((d) => { setDetail(d); toast.success('서버 재평가 완료'); }).catch((e) => toast.error(friendlyError(e, '')))} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">재평가</button>
              {detail.sequence.status === 'draft' ? (
                <button type="button" onClick={() => void changeStatus(detail.sequence.id, 'ready_for_review')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Review Ready</button>
              ) : null}
              {detail.sequence.status === 'ready_for_review' ? (
                <>
                  <button type="button" onClick={() => void changeStatus(detail.sequence.id, 'approved')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-emerald-300 disabled:opacity-50">Approve(기록)</button>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="거절 사유(필수)" className="rounded bg-bg-deep px-2 py-1 text-ink" />
                  <button type="button" onClick={() => void changeStatus(detail.sequence.id, 'rejected')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-red-300 disabled:opacity-50">Reject</button>
                </>
              ) : null}
              {detail.sequence.status !== 'archived' ? (
                <button type="button" onClick={() => void changeStatus(detail.sequence.id, 'archived')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink-mute disabled:opacity-50">Archive</button>
              ) : null}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-bg-deep p-2">
              {detail.tracks.map((t) => (
                <div key={t.track_id} className="border-b border-white/5 py-1 text-ink">
                  {t.sequence_position + 1}. {t.title ?? t.track_id} — {t.artist ?? '?'}
                  <span className="text-ink-mute"> · {t.main_genre ?? '?'} · 원본 #{(t.original_draft_order ?? 0) + 1} · T {t.transition_score ?? '—'} · ΔE {t.energy_delta ?? '—'} · ΔBPM {t.bpm_delta ?? '—'}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-bg-deep p-2">
              <div className="mb-1 font-semibold text-ink">Audit</div>
              {detail.events.map((e, i) => (
                <div key={i} className="text-ink-mute">
                  {relativeTimeKo(e.created_at, nowMs)} · {e.event_type}{e.previous_status ? ` (${e.previous_status}→${e.next_status})` : ''} · {e.actor_name ?? 'system'}{e.reason ? ` · ${e.reason}` : ''}
                </div>
              ))}
              {detail.events.length === 0 ? <div className="text-ink-mute">이벤트 없음</div> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3"><AdminEmpty icon={<FileSearch size={24} />} title="선택된 Sequence 없음" description="Sequences 탭에서 상세를 열어주세요." /></div>
        )
      ) : null}

      {tab === 'compare' ? (
        compareA && detail ? (
          (() => {
            const a = [...compareA.tracks].sort((x, y) => (x.original_draft_order ?? 0) - (y.original_draft_order ?? 0)).map(toFeature);
            const b = [...detail.tracks].sort((x, y) => x.sequence_position - y.sequence_position).map(toFeature);
            const cmp = compareOrders(a, b);
            return (
              <div className="mt-3 space-y-2 text-[11px]">
                <AdminAlert tone="info">A: {compareA.sequence.name}(원본 순서 기준) ↔ B: {detail.sequence.name}(Sequence 순서) — 읽기 전용 비교</AdminAlert>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Position 변경" value={`${cmp.positionChanged}곡`} hint={`평균 이동 ${cmp.avgAbsPositionDelta}`} />
                  <Box label="아티스트 인접 A→B" value={`${cmp.a.adjacentSameArtist} → ${cmp.b.adjacentSameArtist}`} />
                  <Box label="장르 최대 연속 A→B" value={`${cmp.a.maxGenreRun} → ${cmp.b.maxGenreRun}`} />
                  <Box label="ΔEnergy 평균 A→B" value={`${cmp.a.avgEnergyDelta?.toFixed(2) ?? '—'} → ${cmp.b.avgEnergyDelta?.toFixed(2) ?? '—'}`} />
                </div>
                <p className="text-ink-mute">Vocal 최대 연속 {cmp.a.maxVocalRun} → {cmp.b.maxVocalRun} · 앨범 인접 {cmp.a.adjacentSameAlbum} → {cmp.b.adjacentSameAlbum} · ΔBPM 평균 {cmp.a.avgBpmDelta?.toFixed(1) ?? '—'} → {cmp.b.avgBpmDelta?.toFixed(1) ?? '—'}</p>
              </div>
            );
          })()
        ) : (
          <div className="mt-3"><AdminEmpty icon={<Scale size={24} />} title="비교 대상 없음" description="Sequences 탭에서 '비교 A로'를 선택하고, Detail 탭에 비교할 Sequence를 열어주세요." /></div>
        )
      ) : null}

      {tab === 'limits' ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </AdminCard>
  );
}
