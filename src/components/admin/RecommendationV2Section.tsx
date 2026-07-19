/**
 * RecommendationV2Section — Contextual Recommendation Engine v2 & Shadow Comparison
 * (Phase AI-RECOMMEND-2).
 *
 * Production 추천 v1/Playlist/Queue/Scheduler/Player 를 변경하지 않는 Shadow Draft.
 * v1 비교는 서버가 읽기 전용으로만 호출하며, Approve 는 검토 감사 기록이다.
 * Publish/Apply 버튼은 존재하지 않는다.
 *
 * 탭: Create · Drafts · Detail · v1 Compare · Limitations.
 * 시각화는 외부 라이브러리 없이 HTML Bar 로 구현하고 수치 표를 병행한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, ListOrdered, FileSearch, GitCompareArrows, ShieldAlert, RefreshCw, Inbox } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  compareAiRecDraftWithV1, createAiRecDraft, fetchAiRecCandidatePool, fetchAiRecDraftDetail,
  fetchAiRecDrafts, reevaluateAiRecDraft, setAiRecDraftStatus,
  type AiRecDraftDetail, type AiRecDraftListRow, type AiRecDraftStatus,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { INDUSTRY_PROFILES } from '@/lib/playlistGenerator';
import {
  DEFAULT_REC_CONTEXT, FIXED_REC_WARNING, buildRecExplanation, buildRecPayload,
  computeRecommendationQuality, rankRecommendations,
  type RecPoolRow, type RecRankingResult, type RecommendationContext, type RecommendationQualityResult,
} from '@/lib/recommendIntelV2';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'create' | 'drafts' | 'detail' | 'compare' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: 'create', label: 'Create', icon: Sparkles },
  { key: 'drafts', label: 'Drafts', icon: ListOrdered },
  { key: 'detail', label: 'Detail', icon: FileSearch },
  { key: 'compare', label: 'v1 Compare', icon: GitCompareArrows },
  { key: 'limits', label: 'Limitations', icon: ShieldAlert },
];

const STATUS_TONE: Record<AiRecDraftStatus, 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral', ready_for_review: 'info', approved: 'success', rejected: 'danger', expired: 'warning', archived: 'neutral',
};

const KNOWN_LIMITATIONS = [
  '이 Recommendation Draft는 실제 Playlist, Queue, Scheduler, Player 또는 Production 추천 결과에 자동 반영되지 않습니다.',
  'Approve는 검토 감사 기록일 뿐이며 v1 추천 RPC는 교체·비활성화되지 않습니다.',
  'Score/Rank는 서버(_ai_rec_draft_quality)가 Hard Gate·Rank 무결성과 함께 재검증합니다(클라이언트 값 미신뢰).',
  'Reaction 데이터는 Production 실측 0건 — 표본 Confidence 기반이며 학습 완료를 주장하지 않습니다.',
  '추천 노출(Exposure) 원장이 없어 30일 재생 이벤트 프록시만 사용합니다(insufficient_data).',
  'Store Fit이 없으면 업종 기본 Profile을 default_profile로 명시해 사용합니다.',
  'v1 비교는 recommend_tracks_by_context가 지원하는 Context(time_slot/situation/business_type/mood)만 가능하며 읽기 전용 호출입니다.',
  'Playlist/Sequence Compatibility는 기준(Draft/current track)이 없으면 insufficient_data입니다.',
  'Exploration Ratio는 20% 상한이며 Hard Gate를 통과한 후보만 배정됩니다(정책/QC 완화 없음).',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다. Migration 0565~0567은 Production 미적용입니다.',
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

/** Score Breakdown Bar — 외부 라이브러리 없이 HTML 바(수치 병행). */
function BreakdownBars({ breakdown }: { breakdown: Record<string, unknown> }) {
  const entries = Object.entries(breakdown).filter(([k, v]) => k !== 'overallScore' && (v == null || typeof v === 'number'));
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-[10px]">
          <span className="w-40 shrink-0 text-ink-mute">{k}</span>
          <div className="h-2 flex-1 rounded bg-black/30">
            {typeof v === 'number' ? <div className="h-2 rounded bg-accent" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /> : null}
          </div>
          <span className="w-16 text-right text-ink">{typeof v === 'number' ? v : 'insufficient'}</span>
        </div>
      ))}
    </div>
  );
}

export default function RecommendationV2Section() {
  const [tab, setTab] = useState<Tab>('create');
  const [drafts, setDrafts] = useState<AiRecDraftListRow[] | null>(null);
  const [detail, setDetail] = useState<AiRecDraftDetail | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [nowMs] = useState(() => Date.now());

  // Create 설정
  const [name, setName] = useState('');
  const [storeType, setStoreType] = useState('cafe');
  const [target, setTarget] = useState(10);
  const [seed, setSeed] = useState(1);
  const [minQc, setMinQc] = useState<number | ''>(60);
  const [minFit, setMinFit] = useState<number | ''>('');
  const [blockExplicit, setBlockExplicit] = useState(true);
  const [requireInstrumental, setRequireInstrumental] = useState(false);
  const [explorationPct, setExplorationPct] = useState(10);
  const [maxArtistPct, setMaxArtistPct] = useState(30);
  const [recentDays, setRecentDays] = useState<number | ''>('');
  const [preview, setPreview] = useState<{
    ctx: RecommendationContext; result: RecRankingResult; quality: RecommendationQualityResult;
    explanation: string[]; payload: Record<string, unknown>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setDrafts(await fetchAiRecDrafts(null, 100)); }
    catch (e) { setErr(classifyAdminError(e)); setDrafts(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const generatePreview = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const ctx: RecommendationContext = {
        ...DEFAULT_REC_CONTEXT,
        storeType, targetCount: target, seed,
        minQc: minQc === '' ? null : minQc,
        minStoreFit: minFit === '' ? null : minFit,
        blockExplicit, requireInstrumental,
        explorationRatio: explorationPct / 100,
        maxArtistShare: maxArtistPct / 100,
        recentPlayExcludeDays: recentDays === '' ? null : recentDays,
      };
      const pool = await fetchAiRecCandidatePool({ store_type: storeType, limit: 500 });
      const rows = pool.items as unknown as RecPoolRow[];
      const result = rankRecommendations(rows, ctx, { baselinePlaylist: null, currentTrack: null, nextTrack: null }, nowMs);
      const quality = computeRecommendationQuality(result, new Date(nowMs).toISOString());
      const explanation = buildRecExplanation(ctx, result, quality);
      const payload = buildRecPayload(name.trim() || `${storeType} 추천 v2`, ctx, result, explanation, quality);
      setPreview({ ctx, result, quality, explanation, payload });
      if (result.selected.length === 0) toast.info('추천 후보 없음 — 조건 또는 후보 데이터를 확인하세요.');
    } catch (e) { setErr(classifyAdminError(e)); toast.error(`후보 조회 실패: ${friendlyError(e, '0567 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }, [storeType, target, seed, minQc, minFit, blockExplicit, requireInstrumental, explorationPct, maxArtistPct, recentDays, name, nowMs]);

  const save = useCallback(async () => {
    if (!preview || preview.result.selected.length === 0) { toast.error('저장할 추천 Draft가 없습니다.'); return; }
    setBusy(true);
    try {
      const saved = await createAiRecDraft(preview.payload);
      toast.success(saved.duplicate ? '동일 조건 Draft가 이미 있어 기존 것을 반환했습니다.' : 'Draft 저장(서버가 Hard Gate·Rank·품질 재검증). 자동 반영 없음.');
      setDetail(saved); setTab('detail'); await load();
    } catch (e) { toast.error(`저장 거부/실패: ${friendlyError(e, 'Hard Gate/Rank 위반 시 서버가 거부합니다')}`); }
    finally { setBusy(false); }
  }, [preview, load]);

  const openDetail = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await fetchAiRecDraftDetail(id)); setTab('detail'); }
    catch (e) { toast.error(`상세 조회 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }, []);

  const runV1Compare = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await compareAiRecDraftWithV1(id)); setTab('compare'); toast.success('v1 비교 완료(v1은 읽기 전용 호출·무변경)'); await load(); }
    catch (e) { toast.error(`v1 비교 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }, [load]);

  const changeStatus = useCallback(async (id: string, status: AiRecDraftStatus) => {
    if (status === 'rejected' && !rejectReason.trim()) { toast.error('거절 사유를 입력하세요.'); return; }
    setBusy(true);
    try {
      const d = await setAiRecDraftStatus(id, status, status === 'rejected' ? rejectReason.trim() : undefined);
      setDetail(d); setRejectReason('');
      toast.success(status === 'approved' ? '검토 승인 기록(Production 추천 적용 아님)' : `상태 변경: ${status}`);
      await load();
    } catch (e) { toast.error(`상태 변경 실패: ${friendlyError(e, 'Hard 위반 시 승격 불가')}`); }
    finally { setBusy(false); }
  }, [rejectReason, load]);

  return (
    <AdminCard title="Recommendation v2" subtitle="AI-RECOMMEND-2 — Contextual Engine & v1 Shadow Comparison (자동 반영 없음)">
      <AdminAlert tone="info">{FIXED_REC_WARNING}</AdminAlert>

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
            <label className="text-[11px] text-ink-mute">이름
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="미입력 시 자동" className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">업종(Store Type)
              <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink">
                {Object.values(INDUSTRY_PROFILES).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-ink-mute">추천 곡 수(1~100)
              <input type="number" min={1} max={100} value={target} onChange={(e) => setTarget(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Seed
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최소 QC(Hard)
              <input type="number" value={minQc} placeholder="미설정" onChange={(e) => setMinQc(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최소 Store Fit(Soft)
              <input type="number" value={minFit} placeholder="미설정" onChange={(e) => setMinFit(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Exploration %(≤20)
              <input type="number" min={0} max={20} value={explorationPct} onChange={(e) => setExplorationPct(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Artist 최대 %(상한)
              <input type="number" min={5} max={100} value={maxArtistPct} onChange={(e) => setMaxArtistPct(Math.max(5, Math.min(100, Number(e.target.value) || 30)))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최근 재생 제외(일)
              <input type="number" value={recentDays} placeholder="미설정" onChange={(e) => setRecentDays(e.target.value === '' ? '' : Number(e.target.value))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <div className="flex items-end gap-3 text-[11px] text-ink">
              <label className="flex items-center gap-1"><input type="checkbox" checked={blockExplicit} onChange={(e) => setBlockExplicit(e.target.checked)} />Explicit 금지</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={requireInstrumental} onChange={(e) => setRequireInstrumental(e.target.checked)} />Instrumental 필수</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void generatePreview()} disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
              {busy ? '계산 중…' : '추천 Preview 생성'}
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !preview}
              className="rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
              Draft 저장(서버 재검증)
            </button>
          </div>

          {preview ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Box label="후보" value={NUM(preview.result.candidates.length)} />
                <Box label="Eligible" value={NUM(preview.result.eligibleCount)} />
                <Box label="선택" value={NUM(preview.result.selected.length)} />
                <Box label="Exploration" value={NUM(preview.result.explorationCount)} hint="저노출/신곡" />
                <Box label="Quality(미리보기)" value={preview.quality.score == null ? 'insufficient' : `${preview.quality.score} (${preview.quality.grade})`} hint="서버 재계산이 최종" />
              </div>
              <div className="rounded-lg bg-bg-deep p-3 text-[11px] leading-5 text-ink">
                {preview.explanation.map((l, i) => <div key={i}>{l}</div>)}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg bg-bg-deep p-2 text-[11px]">
                {preview.result.selected.map((c, i) => (
                  <div key={c.trackId} className="flex justify-between border-b border-white/5 py-1">
                    <span className="text-ink">{i + 1}. {c.title ?? c.trackId} <span className="text-ink-mute">{c.artistKey ?? ''}</span>{c.isExploration ? <AdminBadge tone="info">탐색</AdminBadge> : null}</span>
                    <span className="text-ink-mute">점수 {c.finalScore} · Fit {c.storeFitScore ?? '—'} · QC {c.qualityScore ?? '—'}</span>
                  </div>
                ))}
                {preview.result.selected.length === 0 ? <AdminEmpty icon={<Inbox size={24} />} title="추천 없음" description="Hard Gate 제외가 많거나 후보가 부족합니다." /> : null}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-ink-mute">Preview를 생성하세요(동일 입력+Seed → 동일 순위 · 서버가 최종 재검증).</p>
          )}
        </div>
      ) : null}

      {tab === 'drafts' ? (
        <div className="mt-3 space-y-2">
          {loading ? <p className="text-[11px] text-ink-mute">불러오는 중…</p> : null}
          {!loading && drafts && drafts.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Recommendation Draft 없음" description="Create 탭에서 생성하세요. (0567 미적용 환경에서는 비어 있습니다)" />
          ) : null}
          {drafts?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2 text-[11px]">
              <div>
                <div className="font-semibold text-ink">{d.name} <AdminBadge tone={STATUS_TONE[d.status]}>{d.status}</AdminBadge>{d.has_v1_comparison ? <AdminBadge tone="info">v1 비교됨</AdminBadge> : null}</div>
                <div className="text-ink-mute">
                  {d.store_type ?? d.recommendation_mode} · 후보 {NUM(d.candidate_count)} · Eligible {NUM(d.eligible_count)} · 선택 {NUM(d.selected_count)}/{NUM(d.target_track_count)}
                  · Quality {d.quality_score == null ? 'insufficient' : `${d.quality_score} (${d.quality_grade})`}
                  · {relativeTimeKo(d.created_at, nowMs)} · {d.created_by_name ?? '?'}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void openDetail(d.id)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink hover:text-white disabled:opacity-50">상세</button>
                <button type="button" onClick={() => void runV1Compare(d.id)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink-mute hover:text-ink disabled:opacity-50">v1 비교</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'detail' ? (
        detail ? (
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{detail.draft.name}</span>
              <AdminBadge tone={STATUS_TONE[detail.draft.status]}>{detail.draft.status}</AdminBadge>
              <span className="text-ink-mute">{detail.draft.recommendation_mode} · Seed {detail.draft.seed} · {detail.draft.algorithm_version}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Quality(서버)" value={detail.draft.quality_score == null ? 'insufficient' : `${detail.draft.quality_score} (${detail.draft.quality_grade})`} />
              <Box label="후보/Eligible" value={`${NUM(detail.draft.candidate_count)} / ${NUM(detail.draft.eligible_count)}`} />
              <Box label="선택/목표" value={`${NUM(detail.draft.selected_count)} / ${NUM(detail.draft.target_track_count)}`} />
              <Box label="만료" value={detail.draft.expires_at ? relativeTimeKo(detail.draft.expires_at, nowMs) : '—'} />
              <Box label="검토자" value={detail.draft.reviewed_by_name ?? '—'} hint={detail.draft.reviewed_at ? relativeTimeKo(detail.draft.reviewed_at, nowMs) : undefined} />
            </div>
            {detail.draft.warnings.length > 0 ? <AdminAlert tone="warning">{detail.draft.warnings.join(' · ')}</AdminAlert> : null}
            {detail.draft.insufficient_data.length > 0 ? <AdminAlert tone="info">데이터 부족: {detail.draft.insufficient_data.join(', ')}</AdminAlert> : null}
            <div className="rounded-lg bg-bg-deep p-3">
              <div className="mb-1 font-semibold text-ink">Quality Breakdown(서버)</div>
              <BreakdownBars breakdown={(detail.draft.quality_breakdown as { breakdown?: Record<string, unknown> }).breakdown ?? {}} />
            </div>
            <div className="rounded-lg bg-bg-deep p-3 leading-5 text-ink">
              {detail.draft.explanation.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void reevaluateAiRecDraft(detail.draft.id).then((d) => { setDetail(d); toast.success('서버 재평가 완료'); }).catch((e) => toast.error(friendlyError(e, '')))} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">재평가</button>
              <button type="button" onClick={() => void runV1Compare(detail.draft.id)} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">v1 비교</button>
              {detail.draft.status === 'draft' ? (
                <button type="button" onClick={() => void changeStatus(detail.draft.id, 'ready_for_review')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Review Ready</button>
              ) : null}
              {detail.draft.status === 'ready_for_review' ? (
                <>
                  <button type="button" onClick={() => void changeStatus(detail.draft.id, 'approved')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-emerald-300 disabled:opacity-50">Approve(기록)</button>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="거절 사유(필수)" className="rounded bg-bg-deep px-2 py-1 text-ink" />
                  <button type="button" onClick={() => void changeStatus(detail.draft.id, 'rejected')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-red-300 disabled:opacity-50">Reject</button>
                </>
              ) : null}
              {detail.draft.status !== 'archived' ? (
                <button type="button" onClick={() => void changeStatus(detail.draft.id, 'archived')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink-mute disabled:opacity-50">Archive</button>
              ) : null}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-bg-deep p-2">
              {detail.tracks.filter((t) => t.selected).map((t) => (
                <div key={t.track_id} className="border-b border-white/5 py-1 text-ink">
                  {t.rank + 1}. {t.title ?? t.track_id} — {t.artist ?? '?'}
                  <span className="text-ink-mute"> · {t.main_genre ?? '?'} · 점수 {t.final_score ?? '—'}{t.v1_rank != null ? ` · v1 #${t.v1_rank + 1} (Δ${t.rank_delta})` : ''}</span>
                </div>
              ))}
              {detail.tracks.length === 0 ? <AdminEmpty icon={<Inbox size={24} />} title="Track 없음" description="Draft 에 저장된 Track 이 없습니다." /> : null}
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
          <div className="mt-3"><AdminEmpty icon={<FileSearch size={24} />} title="선택된 Draft 없음" description="Drafts 탭에서 상세를 열어주세요." /></div>
        )
      ) : null}

      {tab === 'compare' ? (
        detail && detail.draft.comparison_summary && Object.keys(detail.draft.comparison_summary).length > 0 ? (
          (() => {
            const m = detail.draft.comparison_summary as Record<string, unknown>;
            const lim = (m.limitations as string[] | undefined) ?? [];
            return (
              <div className="mt-3 space-y-2 text-[11px]">
                <AdminAlert tone="info">v1(recommend_tracks_by_context)은 읽기 전용으로 호출됐으며 변경되지 않았습니다.</AdminAlert>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Top-N Overlap" value={String(m.top_n_overlap ?? '—')} hint={`비율 ${m.overlap_ratio ?? '—'}`} />
                  <Box label="v1 결과 수" value={String(m.v1_count ?? '—')} />
                  <Box label="v1 Only" value={String(m.v1_only ?? '—')} />
                  <Box label="v2 Only" value={String(m.v2_only ?? '—')} />
                </div>
                <div className="rounded-lg bg-bg-deep p-2 text-ink-mute">
                  {lim.map((l, i) => <div key={i}>· {l}</div>)}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg bg-bg-deep p-2">
                  {detail.tracks.filter((t) => t.selected).map((t) => (
                    <div key={t.track_id} className="border-b border-white/5 py-1 text-ink">
                      v2 #{t.rank + 1} {t.title ?? t.track_id}
                      <span className="text-ink-mute"> — {t.v1_rank != null ? `v1 #${t.v1_rank + 1} (Δ${t.rank_delta})` : 'v2 Only'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="mt-3"><AdminEmpty icon={<GitCompareArrows size={24} />} title="v1 비교 없음" description="Drafts/Detail 탭에서 'v1 비교'를 실행하세요." /></div>
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
