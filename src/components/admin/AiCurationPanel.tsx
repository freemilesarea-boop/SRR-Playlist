import { useCallback, useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Play, Wand2, ListMusic, FlaskConical } from 'lucide-react';
import {
  listAiCuration,
  setTrackAudioFeatures,
  markAnalysisFailed,
  recomputeTrackAiMetadata,
  recomputePlaylistFitScores,
  getAiRecommendedTracksForPlaylist,
  applyAiMetadata,
  generateAiSuggestions,
  listAiSuggestions,
  decideAiSuggestion,
  listUnifiedViolations,
  playEventStats,
  trackPerformance,
  playlistPerformance,
  registerSkipViolations,
  recomputeTrackFitScores,
  listStoreProfiles,
  setPlaylistStoreKey,
  exportEmbeddingPending,
  importTrackEmbeddings,
  listEmbeddingReviewTracks,
  getEmbeddingComparison,
  markEmbeddingReviewed,
  markEmbeddingReanalysisNeeded,
  addStoreSeedCandidate,
  applyEmbeddingToAiMetadata,
  embeddingStatus,
  buildStoreArchetypes,
  type EmbeddingStatus,
  getTrackGuardrails,
  setGuardrailOverride,
  recomputeGuardrailFlags,
  guardrailDashboard,
  listGuardrailViolationTracks,
  recomputeMetadataTrust,
  bulkGuardrailOverride,
  bulkGuardrailClear,
  bulkApplyAiMetadata,
  listHighRiskTracks,
  getUploaderDetail,
  rereviewBatch,
  finalizeRereview,
  rereviewSummary,
  rereviewQueue,
  rereviewTrackDetail,
  rereviewAction,
  applyAiMetadataAndRecompute,
  computeAllPlaylistFlows,
  computePlaylistFlow,
  playlistFlowSummary,
  getPlaylistFlow,
  generateAllReorders,
  generatePlaylistReorder,
  listReorderProposals,
  getReorderProposal,
  applyPlaylistReorder,
  rejectPlaylistReorder,
  businessSkipSummary,
  listBusinessExclusions,
  restoreBusinessExclusion,
  ignoreBusinessExclusion,
  reactivateBusinessExclusion,
  excludeTrackGroup,
  type BusinessSkipSummary,
  type BusinessExclusionRow,
  type EmbeddingPendingRow,
  type EmbeddingImportResult,
  type EmbeddingReviewRow,
  type EmbeddingComparison,
  type GuardrailStoreResult,
  type GuardrailDashboard,
  type GuardrailViolationTrack,
  type HighRiskTrack,
  type RereviewSummary,
  type RereviewQueueRow,
  type RereviewDetail,
  type RereviewActionType,
  type RecomputeResult,
  type FlowSummaryRow,
  type FlowTransition,
  type ReorderProposalRow,
  type ReorderDetail,
  type StoreProfileOption,
  type AiCurationRow,
  type CurationFilter,
  type FitScoreRow,
  type AiSuggestion,
  type UnifiedViolation,
  type PlayEventStats,
  type TrackPerformanceRow,
  type PlaylistPerformanceRow,
  type PerfSort,
} from '@/lib/aiCuration';
import { analyzeAudioFromUrl, generateMockFeatures } from '@/lib/audioAnalysis';
import { fetchPlaylists } from '@/lib/api';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import MetaApproveModal from '@/components/admin/MetaApproveModal';

const APPROVABLE_STATUSES = ['submitted', 'review_pending', 'changes_requested'];
const canApproveStatus = (s: string | null | undefined) => APPROVABLE_STATUSES.includes(s ?? '');

type SubTab = 'perf' | 'pending' | 'results' | 'fit' | 'review' | 'embedding' | 'embed_review' | 'guardrail' | 'highrisk' | 'rereview' | 'flow' | 'reorder' | 'business';
const BATCH = 15;

const STORE_LABELS: Record<string, string> = {
  gym: '헬스장', pilates: '필라테스', yoga: '요가', hospital: '병원',
  cafe_independent: '카페_개인', cafe_franchise: '카페_프차', winebar: '와인바', cocktail_bar: '칵테일바',
  restaurant: '식당', korean_restaurant: '한식당', brunch_cafe: '브런치', office: '사무실',
  coworking: '코워킹', salon: '미용실', nail_shop: '네일샵', hotel_lobby: '호텔로비',
  select_shop: '편집샵', clothing_store: '의류매장', kids_cafe: '키즈카페', dog_cafe: '애견카페',
  pc_bang: 'PC방', fine_dining: '파인다이닝',
  cafe_morning: '카페(오전)', cafe_afternoon: '카페(오후)', winebar_evening: '와인바', lounge: '라운지',
};

export default function AiCurationPanel() {
  const [sub, setSub] = useState<SubTab>('perf');
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Sparkles size={18} className="text-accent" /> AI 큐레이션 (v1)
        </h2>
        <p className="text-xs text-ink-mute">
          오디오 피처 분석 + 규칙 기반 AI 판정으로 매장/시간대 적합도를 계산합니다. (analyzer/version 기록 — 추후 ML 고도화)
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {([['perf', '운영 성과'], ['pending', '분석 대기'], ['results', 'AI 판정 결과'], ['fit', '플레이리스트 적합도'], ['review', '위반/검토 후보'], ['guardrail', 'Guardrail 대시보드'], ['highrisk', '고위험 검수'], ['rereview', '전체 재검수'], ['flow', 'Playlist Flow'], ['reorder', '자동 재배치'], ['business', '사업자 반응'], ['embed_review', '임베딩 검증'], ['embedding', '임베딩(PoC)']] as [SubTab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${sub === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'perf' && <PerformanceTab />}
      {sub === 'pending' && <PendingTab />}
      {sub === 'results' && <ResultsTab />}
      {sub === 'fit' && <FitTab />}
      {sub === 'review' && <UnifiedViolationsTab />}
      {sub === 'embedding' && <EmbeddingTab />}
      {sub === 'embed_review' && <EmbeddingReviewTab />}
      {sub === 'guardrail' && <GuardrailDashboardTab />}
      {sub === 'highrisk' && <HighRiskTab />}
      {sub === 'rereview' && <RereviewTab />}
      {sub === 'flow' && <FlowTab />}
      {sub === 'reorder' && <ReorderTab />}
      {sub === 'business' && <BusinessReactionTab />}
    </div>
  );
}

// 곡 1건 분석: 실분석(webaudio) 시도 → 실패 시 호출자가 처리
async function analyzeOne(row: AiCurationRow, useMock: boolean): Promise<void> {
  if (useMock) {
    await setTrackAudioFeatures(row.track_id, generateMockFeatures(row.track_id, row.duration));
    return;
  }
  if (!row.audio_url) throw new Error('audio_url 없음');
  const features = await analyzeAudioFromUrl(row.audio_url, row.duration);
  await setTrackAudioFeatures(row.track_id, features);
}

function PendingTab() {
  const [rows, setRows] = useState<AiCurationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listAiCuration('pending', 200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runBatch(targets: AiCurationRow[], useMock: boolean) {
    setBusy(true);
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        // 배치 내 병렬 — 단, 실분석은 무겁고 메모리 부담 → 순차 처리(안정성 우선)
        for (const row of slice) {
          setProgress(`분석 중… ${ok + fail + 1}/${targets.length} — ${row.title ?? ''}`);
          try {
            await analyzeOne(row, useMock);
            ok++;
          } catch (e) {
            fail++;
            await markAnalysisFailed(row.track_id, (e as Error).message).catch(() => {});
          }
        }
      }
      toast.success(`분석 완료 — 성공 ${ok} · 실패 ${fail}`);
      await load();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runBatch(rows, false)} disabled={busy || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
          <Play size={13} /> 전체 실분석 ({rows.length})
        </button>
        <button onClick={() => void runBatch(rows, true)} disabled={busy || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <FlaskConical size={13} /> 테스트용 mock 채우기
        </button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
        {progress && <span className="text-xs text-ink-mute">{progress}</span>}
      </div>
      <p className="text-[11px] text-ink-dim">
        실분석은 브라우저 Web Audio 로 곡을 디코드합니다(대용량은 느릴 수 있음). 실패 곡은 status=failed 로 기록되며 재생/발매에는 영향 없습니다.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '불러오는 중…' : '분석 대기 곡이 없어요. (모두 분석 완료)'}
        </p>
      ) : (
        <ul className="divide-y divide-line/10 rounded-xl bg-bg-card">
          {rows.map((r) => (
            <li key={r.track_id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="truncate">{r.title ?? '(제목없음)'} · <span className="text-ink-dim">{r.artist ?? ''}</span></span>
              <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{r.feature_status ?? '미분석'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultsTab({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const [rows, setRows] = useState<AiCurationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<CurationFilter>(reviewOnly ? 'review_needed' : 'analyzed');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listAiCuration(filter, 150)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function apply(r: AiCurationRow) {
    setBusyId(r.track_id);
    try {
      await applyAiMetadata(r.track_id, { genres: r.main_genre ? [r.main_genre] : null, moods: r.ai_moods ?? null, situations: r.ai_situations ?? null });
      toast.success('AI 메타데이터를 적용하고 적합도를 재계산했어요.');
      await load();
    } catch (e) { toast.error(`적용 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function reanalyze(r: AiCurationRow) {
    setBusyId(r.track_id);
    try {
      if (r.audio_url) { await analyzeOne(r, false); }
      else { await recomputeTrackAiMetadata(r.track_id); }
      toast.success('재분석 완료');
      await load();
    } catch (e) {
      await markAnalysisFailed(r.track_id, (e as Error).message).catch(() => {});
      toast.error(`재분석 실패: ${(e as Error).message}`);
      await load();
    } finally { setBusyId(null); }
  }

  const FILTERS: [CurationFilter, string][] = reviewOnly
    ? [['review_needed', '검토 필요'], ['mismatch_high', '불일치 높음'], ['failed', '분석 실패']]
    : [['analyzed', '분석됨'], ['real_dsp', '실 DSP'], ['heuristic', 'heuristic/mock'], ['mismatch_high', '불일치 높음'], ['gym_fit', '헬스장 적합'], ['gym_unfit', '헬스장 부적합'], ['cafe_fit', '카페 적합'], ['yoga_hospital_unfit', '요가/병원 부적합'], ['kids_risk', '키즈카페 위험'], ['failed', '실패'], ['all', '전체']];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 항목이 없어요.'}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const fit = r.ai_store_fit ?? {};
            const topStores = Object.entries(fit).sort((a, b) => b[1] - a[1]).slice(0, 4);
            return (
              <li key={r.track_id} className="rounded-xl bg-bg-card p-4 ring-1 ring-line/10">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{r.title ?? '(제목없음)'}</span>
                      <span className="text-sm text-ink-mute">· {r.artist ?? ''}</span>
                      {r.feature_status === 'failed' && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">분석 실패</span>}
                      {r.ai_status === 'reviewed' && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">검수됨</span>}
                      {r.analyzer && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.analyzer.startsWith('webaudio') || r.analyzer.startsWith('essentia') ? 'bg-sky-500/15 text-sky-600' : 'bg-ink/5 text-ink-dim'}`}>
                          {r.analyzer}{r.analysis_version ? ` · ${r.analysis_version}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-dim">
                      등록자: 장르 {r.main_genre ?? '-'} · 무드 {r.mood ?? '-'} · 매장 {(r.business_type_tags ?? []).join(',') || '-'}
                    </p>
                    <p className="text-[11px] text-ink-dim">
                      AI: 에너지 {r.ai_energy_level ?? '-'} · 무드 {(r.ai_moods ?? []).join(',') || '-'}
                    </p>
                  </div>
                  {r.mismatch_score != null && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.mismatch_score >= 0.5 ? 'bg-rose-500/15 text-rose-600' : r.mismatch_score >= 0.3 ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600'}`}>
                      불일치 {Math.round(r.mismatch_score * 100)}%
                    </span>
                  )}
                </div>

                {r.feature_status === 'done' && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink-mute">
                    {r.bpm != null && <Metric label="BPM" v={Math.round(r.bpm)} />}
                    {r.energy != null && <Metric label="energy" v={r.energy} />}
                    {r.danceability != null && <Metric label="dance" v={r.danceability} />}
                    {r.acousticness != null && <Metric label="acoustic" v={r.acousticness} />}
                    {r.instrumentalness != null && <Metric label="instr" v={r.instrumentalness} />}
                    {r.vocal_presence != null && <Metric label="vocal" v={r.vocal_presence} />}
                    {r.brightness != null && <Metric label="bright" v={r.brightness} />}
                    {r.spectral_centroid != null && <Metric label="centroid" v={Math.round(r.spectral_centroid)} />}
                    {r.loudness != null && <Metric label="LUFS≈" v={r.loudness} />}
                    {r.dynamic_range != null && <Metric label="DR" v={r.dynamic_range} />}
                  </div>
                )}

                {r.raw_features && Object.keys(r.raw_features).length > 0 && (
                  <details className="mt-1 text-[10px] text-ink-dim">
                    <summary className="cursor-pointer select-none">raw features 보기</summary>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {Object.entries(r.raw_features).map(([k, v]) => <Metric key={k} label={k} v={v} />)}
                    </div>
                  </details>
                )}

                {topStores.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {topStores.map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-[10px] text-ink-dim">{STORE_LABELS[k] ?? k}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-ink/5">
                          <div className={`h-full ${v >= 70 ? 'bg-emerald-500' : v >= 40 ? 'bg-amber-500' : 'bg-rose-400'}`} style={{ width: `${v}%` }} />
                        </div>
                        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums">{v}</span>
                      </div>
                    ))}
                  </div>
                )}

                {r.explanation && <p className="mt-2 rounded-lg bg-bg-soft/40 px-2.5 py-1.5 text-[11px] text-ink-mute">{r.explanation}</p>}
                {r.error_message && <p className="mt-1 text-[11px] text-rose-600">오류: {r.error_message}</p>}

                <GuardrailBadges trackId={r.track_id} ready={r.feature_status === 'done'} />

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button onClick={() => void apply(r)} disabled={busyId === r.track_id || r.feature_status !== 'done'}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
                    <Wand2 size={12} /> AI 메타 적용
                  </button>
                  <button onClick={() => void reanalyze(r)} disabled={busyId === r.track_id}
                    className="inline-flex items-center gap-1 rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
                    <RefreshCw size={12} /> 재분석
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, v }: { label: string; v: number }) {
  return <span className="rounded bg-ink/5 px-1.5 py-0.5">{label} <b className="tabular-nums">{typeof v === 'number' && v <= 1 ? v.toFixed(2) : v}</b></span>;
}

function FitTab() {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [pid, setPid] = useState<string>('');
  const [rows, setRows] = useState<FitScoreRow[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [storeProfiles, setStoreProfiles] = useState<StoreProfileOption[]>([]);
  const [storeKey, setStoreKey] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPlaylists().then((p) => { setPlaylists(p); if (p[0]) setPid(p[0].id); }).catch(() => {}); }, []);
  useEffect(() => { listStoreProfiles().then(setStoreProfiles).catch(() => {}); }, []);
  useEffect(() => {
    const pl = playlists.find((p) => p.id === pid) as (PlaylistRow & { ai_store_key?: string | null }) | undefined;
    setStoreKey(pl?.ai_store_key ?? '');
  }, [pid, playlists]);

  async function saveStoreKey(key: string) {
    setStoreKey(key);
    if (!pid) return;
    try {
      await setPlaylistStoreKey(pid, key || null);
      toast.success(key ? `매장 유형을 ${key} 로 지정했어요.` : '매장 유형 지정 해제');
      await recompute();
    } catch (e) { toast.error(`지정 실패: ${(e as Error).message}`); }
  }

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const [recs, sugs] = await Promise.all([getAiRecommendedTracksForPlaylist(pid, 100), listAiSuggestions(pid, 'pending')]);
      setRows(recs); setSuggestions(sugs);
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { void load(); }, [load]);

  async function recompute() {
    if (!pid) return;
    setBusy(true);
    try {
      const res = await recomputePlaylistFitScores(pid);
      toast.success(`적합도 재계산 완료 — ${res.tracks_scored}곡`);
      await load();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function genSuggestions() {
    if (!pid) return;
    setBusy(true);
    try {
      const res = await generateAiSuggestions(pid);
      toast.success(`추천 제안 ${res.suggestions}건 생성 (승인 전까지 공개 안 됨)`);
      await load();
    } catch (e) { toast.error(`제안 생성 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function decide(id: string, approve: boolean) {
    try {
      await decideAiSuggestion(id, approve);
      toast.success(approve ? '승인 — 플레이리스트에 추가했어요.' : '제외했어요.');
      await load();
    } catch (e) { toast.error(`처리 실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={pid} onChange={(e) => setPid(e.target.value)}
          className="rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select value={storeKey} onChange={(e) => void saveStoreKey(e.target.value)} title="매장 유형 (fit 계산 기준)"
          className="rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
          <option value="">매장 유형: 자동</option>
          {storeProfiles.map((s) => <option key={s.store_key} value={s.store_key}>{s.store_label}</option>)}
        </select>
        <button onClick={() => void recompute()} disabled={busy || !pid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
          <ListMusic size={13} /> 적합도 재계산
        </button>
        <button onClick={() => void genSuggestions()} disabled={busy || !pid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <Wand2 size={13} /> 추천 제안 생성
        </button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">fit_score ≥ 70 추천 후보만 표시됩니다. 자동 공개되지 않으며, "추천 제안 생성" 후 아래에서 승인해야 플레이리스트에 추가됩니다.</p>

      {suggestions.length > 0 && (
        <div className="rounded-xl bg-accent/5 p-3 ring-1 ring-accent/15">
          <h4 className="mb-2 text-xs font-bold text-accent">승인 대기 제안 ({suggestions.length}) — 승인 전까지 비공개</h4>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{s.title ?? '(제목없음)'} · <span className="text-ink-dim">{s.artist ?? ''}</span></span>
                <span className="shrink-0 font-bold tabular-nums text-emerald-600">{s.fit_score}</span>
                <span className="flex shrink-0 gap-1">
                  <button onClick={() => void decide(s.id, true)} className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/25">승인</button>
                  <button onClick={() => void decide(s.id, false)} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-ink/10">제외</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '추천 후보가 없어요. (재계산을 눌러보세요)'}</p>
      ) : (
        <ul className="divide-y divide-line/10 rounded-xl bg-bg-card">
          {rows.map((r) => (
            <li key={r.track_id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="min-w-0 truncate">{r.title ?? '(제목없음)'} · <span className="text-ink-dim">{r.artist ?? ''}</span></span>
              <span className="shrink-0 text-[10px] text-ink-dim">{r.reason}</span>
              <span className="shrink-0 font-bold tabular-nums text-emerald-600">{r.fit_score}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const VIOLATION_LABELS: Record<string, string> = {
  high_skip_rate: '스킵 과다', ai_mismatch: 'AI 불일치', wrong_store_fit: '매장 부적합', wrong_energy: '에너지 불일치',
};

function UnifiedViolationsTab() {
  const [rows, setRows] = useState<UnifiedViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [sev, setSev] = useState<'all' | 'high' | 'medium'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listUnifiedViolations(200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = rows.filter((r) => sev === 'all' || r.severity === sev);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'high', 'medium'] as const).map((s) => (
          <button key={s} onClick={() => setSev(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sev === s ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {s === 'all' ? '전체' : s === 'high' ? '심각' : '보통'}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">스킵 과다 + AI 불일치(매장 부적합/에너지 불일치)를 한 화면에서 검토합니다.</p>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '위반/검토 후보가 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''}</span></span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.severity === 'high' ? 'bg-rose-500/15 text-rose-600' : r.severity === 'medium' ? 'bg-amber-500/15 text-amber-600' : 'bg-ink/10 text-ink-mute'}`}>
                    {VIOLATION_LABELS[r.violation_type] ?? r.violation_type}
                  </span>
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{r.source === 'skip' ? '스킵' : 'AI'}</span>
                  {r.skip_count != null && <span className="text-[10px] text-ink-dim">스킵 {r.skip_count}</span>}
                  {r.mismatch_score != null && <span className="text-[10px] text-ink-dim">불일치 {Math.round(r.mismatch_score * 100)}%</span>}
                </span>
              </div>
              {r.reason && <p className="mt-1 text-[11px] text-ink-mute">{r.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PerformanceTab() {
  const [days, setDays] = useState<7 | 30>(30);
  const [stats, setStats] = useState<PlayEventStats | null>(null);
  const [tracks, setTracks] = useState<TrackPerformanceRow[]>([]);
  const [pls, setPls] = useState<PlaylistPerformanceRow[]>([]);
  const [sort, setSort] = useState<PerfSort>('skip_rate');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, p] = await Promise.all([playEventStats(days), trackPerformance(days, sort, 100), playlistPerformance(days)]);
      setStats(s); setTracks(t); setPls(p);
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [days, sort]);
  useEffect(() => { void load(); }, [load]);

  async function register() {
    setBusy(true);
    try { const r = await registerSkipViolations(); toast.success(`검토 후보 ${r.registered}건 등록`); await load(); }
    catch (e) { toast.error(`등록 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function recompute(trackId: string) {
    try { await recomputeTrackFitScores(trackId); toast.success('fit score 재계산 완료'); await load(); }
    catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([7, 30] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${days === d ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>최근 {d}일</button>
          ))}
        </div>
        <button onClick={() => void register()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/25 disabled:opacity-50">검토 후보 자동 등록</button>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
          <PStat label="재생" v={stats.total_plays} />
          <PStat label="스킵" v={stats.total_skips} />
          <PStat label="완청" v={stats.total_completes} />
          <PStat label="좋아요" v={stats.total_likes} />
          <PStat label="에러" v={stats.total_errors} />
          <PStat label="평균 완청률" v={`${stats.avg_completion_rate}%`} />
          <PStat label="평균 스킵률" v={`${stats.avg_skip_rate}%`} />
        </div>
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <h3 className="text-xs font-bold">곡별 성과</h3>
          <span className="ml-2 text-[10px] text-ink-dim">정렬:</span>
          {([['skip_rate', '스킵률↑'], ['completion_rate', '완청률↑'], ['fit_low', 'fit↓'], ['mismatch', '불일치↑']] as [PerfSort, string][]).map(([s, l]) => (
            <button key={s} onClick={() => setSort(s)} className={`rounded px-2 py-0.5 text-[10px] font-semibold ${sort === s ? 'bg-accent text-black' : 'bg-ink/5 text-ink-mute hover:bg-ink/10'}`}>{l}</button>
          ))}
        </div>
        {tracks.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-dim">{loading ? '불러오는 중…' : '재생 데이터가 없어요.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim">
                <tr className="text-left"><th className="py-1 pr-2">곡 / 플리</th><th>재생</th><th>스킵률</th><th>완청률</th><th>좋아요</th><th>err</th><th>behavior</th><th>fit</th><th>불일치</th><th></th></tr>
              </thead>
              <tbody>
                {tracks.map((r) => (
                  <tr key={`${r.track_id}:${r.playlist_id}`} className="border-t border-line/10">
                    <td className="py-1 pr-2"><div className="max-w-[200px] truncate font-semibold">{r.title ?? '(제목없음)'}</div><div className="max-w-[200px] truncate text-ink-dim">{r.artist ?? ''} · {r.playlist_title ?? '-'}</div></td>
                    <td className="tabular-nums">{r.play_count}</td>
                    <td className={`tabular-nums ${r.skip_rate >= 40 ? 'font-bold text-rose-600' : ''}`}>{r.skip_rate}%</td>
                    <td className="tabular-nums">{r.completion_rate}%</td>
                    <td className="tabular-nums">{r.like_count}</td>
                    <td className="tabular-nums">{r.error_count}</td>
                    <td className="tabular-nums font-semibold">{r.behavior_score}</td>
                    <td className="tabular-nums">{r.fit_score ?? '-'}</td>
                    <td className="tabular-nums">{r.mismatch_score != null ? `${Math.round(r.mismatch_score * 100)}%` : '-'}</td>
                    <td><button onClick={() => void recompute(r.track_id)} className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] hover:bg-ink/10">재계산</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-xs font-bold">플레이리스트별 성과</h3>
        {pls.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-dim">{loading ? '불러오는 중…' : '데이터 없음'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim"><tr className="text-left"><th className="py-1 pr-2">플레이리스트</th><th>재생</th><th>스킵</th><th>완청</th><th>스킵률</th><th>완청률</th><th>검토필요</th></tr></thead>
              <tbody>
                {pls.map((r) => (
                  <tr key={r.playlist_id} className="border-t border-line/10">
                    <td className="max-w-[200px] truncate py-1 pr-2 font-semibold">{r.playlist_title ?? '(제목없음)'}</td>
                    <td className="tabular-nums">{r.total_plays}</td>
                    <td className="tabular-nums">{r.total_skips}</td>
                    <td className="tabular-nums">{r.total_completes}</td>
                    <td className={`tabular-nums ${r.avg_skip_rate >= 40 ? 'font-bold text-rose-600' : ''}`}>{r.avg_skip_rate}%</td>
                    <td className="tabular-nums">{r.avg_completion_rate}%</td>
                    <td className="tabular-nums">{r.review_needed_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PStat({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="rounded-lg bg-bg-soft/40 p-2 text-center">
      <div className="text-lg font-extrabold tabular-nums">{v}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}

function EmbeddingTab() {
  const [pending, setPending] = useState<EmbeddingPendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<unknown[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<EmbeddingImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const [p, st] = await Promise.all([exportEmbeddingPending('openl3', 500), embeddingStatus('openl3').catch(() => null)]);
      setPending(p); setStatus(st);
    }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

  async function buildArchetypes() {
    setBusy(true);
    try { const r = await buildStoreArchetypes('openl3', 8); toast.success(`매장 아키타입 생성 — ${r.built}개 매장`); await loadPending(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  function downloadCsv() {
    const header = 'track_id,audio_url,title,artist,duration';
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const body = pending.map((r) => [r.track_id, r.audio_url, r.title, r.artist, r.duration].map(esc).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'embedding_pending.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResult(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const json = JSON.parse(await f.text());
      const arr = Array.isArray(json) ? json : Array.isArray((json as { embeddings?: unknown[] }).embeddings) ? (json as { embeddings: unknown[] }).embeddings : null;
      if (!arr) throw new Error('JSON 은 배열 또는 {embeddings:[...]} 형식이어야 합니다.');
      setParsed(arr);
      toast.info(`${arr.length}개 row 파싱됨. dry-run 으로 검증하세요.`);
    } catch (err) {
      setParsed(null);
      toast.error(`JSON 파싱 실패: ${(err as Error).message}`);
    }
  }

  async function runImport(dryRun: boolean) {
    if (!parsed) { toast.info('먼저 generated_embeddings.json 을 선택하세요.'); return; }
    setBusy(true);
    try {
      const res = await importTrackEmbeddings(parsed, dryRun);
      setResult(res);
      toast.success(`${dryRun ? '검증(dry-run)' : '임포트'} 완료 — 성공 ${res.imported} / 건너뜀 ${res.skipped}`);
      if (!dryRun) await loadPending();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-mute">
        Mac mini 없이 Colab/로컬에서 OpenL3 임베딩을 생성하는 수동 파이프라인입니다.
        ① pending CSV 내보내기 → ② Colab 에서 임베딩 생성(generated_embeddings.json) → ③ 여기서 dry-run 검증 후 임포트.
        자동 추천에는 반영되지 않습니다(관리자 검증용).
      </p>

      <div className="rounded-xl bg-bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold">① 분석 대기 ({pending.length})</h3>
          <div className="flex gap-1.5">
            <button onClick={() => void loadPending()} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={downloadCsv} disabled={pending.length === 0} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-bold text-black disabled:opacity-50">
              embedding_pending.csv 다운로드
            </button>
          </div>
        </div>
        <p className="text-[10px] text-ink-dim">CSV 컬럼: track_id, audio_url, title, artist, duration</p>
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-xs font-bold">② → ③ generated_embeddings.json 임포트</h3>
        <input type="file" accept="application/json,.json" onChange={onFile} className="block w-full text-xs text-ink-mute file:mr-2 file:rounded file:border-0 file:bg-bg-soft file:px-2 file:py-1 file:text-xs" />
        {fileName && <p className="mt-1 text-[10px] text-ink-dim">{fileName}{parsed ? ` · ${parsed.length} rows` : ''}</p>}
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => void runImport(true)} disabled={busy || !parsed} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft/60 px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
            dry-run 검증
          </button>
          <button onClick={() => void runImport(false)} disabled={busy || !parsed} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
            임포트 실행
          </button>
        </div>
        {result && (
          <div className="mt-2 rounded-lg bg-bg-soft/40 p-2 text-[11px]">
            <p className={result.skipped > 0 ? 'text-amber-600' : 'text-emerald-600'}>
              {result.dry_run ? '검증' : '임포트'}: 성공 <b>{result.imported}</b> · 건너뜀 <b>{result.skipped}</b>
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-rose-600">
                {result.errors.slice(0, 50).map((er, i) => <li key={i}>· {er.track_id}: {er.reason}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-xs font-bold">④ 매장 아키타입 생성 (추천 작동에 필수)</h3>
        <p className="mb-2 text-[10px] text-ink-dim">
          곡 임베딩 적재 후 실행하세요. 각 매장의 대표 벡터를 (승인된 seed 곡 또는 ai_store_fit 상위 곡의 임베딩 평균으로) 생성합니다.
          이게 있어야 "임베딩 검증" 탭의 TOP5 매장 추천(recommend_stores_for_track)이 작동합니다.
        </p>
        {status && (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PStat label="곡 임베딩" v={status.track_embeddings} />
            <PStat label="매장 아키타입" v={status.store_archetypes} />
            <PStat label="미적재(대기)" v={status.pending} />
            <PStat label="차원" v={status.embedding_dim ?? '-'} />
          </div>
        )}
        <button onClick={() => void buildArchetypes()} disabled={busy || (status?.track_embeddings ?? 0) === 0}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
          매장 아키타입 생성/갱신
        </button>
        {status && status.track_embeddings === 0 && <p className="mt-1 text-[10px] text-amber-600">곡 임베딩이 아직 0건입니다 — 먼저 ②③ 임포트를 완료하세요.</p>}
      </div>
    </div>
  );
}

const ISSUE_LABELS: Record<string, string> = {
  gym_false_positive: '헬스장 오판 의심', cafe_winebar_missed: '카페/와인바 누락', store_conflict: '등록매장 충돌',
  old_model: '구버전 모델', missing_archetype: '매장 기준 임베딩 없음',
};

function EmbeddingReviewTab() {
  const [rows, setRows] = useState<EmbeddingReviewRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cmp, setCmp] = useState<EmbeddingComparison | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listEmbeddingReviewTracks(filter, 'openl3', 150)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(tid: string) {
    if (openId === tid) { setOpenId(null); setCmp(null); return; }
    setOpenId(tid); setCmp(null); setCmpLoading(true);
    try { setCmp(await getEmbeddingComparison(tid, 'openl3')); }
    catch (e) { toast.error(`비교 실패: ${(e as Error).message}`); }
    finally { setCmpLoading(false); }
  }
  async function act(fn: () => Promise<void>, msg: string, tid: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); if (openId === tid) setCmp(await getEmbeddingComparison(tid, 'openl3')); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const done = rows.filter((r) => r.embedding_status === 'done').length;
  const pending = rows.filter((r) => r.embedding_status === 'none' || r.embedding_status === 'pending').length;
  const failed = rows.filter((r) => r.embedding_status === 'failed').length;

  const FILTERS: [string, string][] = [['all', '전체'], ['done', '완료'], ['pending', '대기'], ['failed', '실패'], ['disagree_high', '불일치 높음'], ['gym_fp', '헬스장 오판']];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <PStat label="전체" v={rows.length} /><PStat label="embedding 완료" v={done} /><PStat label="대기" v={pending} /><PStat label="실패" v={failed} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map(([f, l]) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>
        ))}
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const badge = r.embedding_status === 'done' ? 'bg-emerald-500/15 text-emerald-600'
              : r.embedding_status === 'failed' ? 'bg-rose-500/15 text-rose-600'
              : 'bg-ink/10 text-ink-mute';
            return (
              <li key={r.track_id} className="rounded-xl bg-bg-card ring-1 ring-line/10">
                <button onClick={() => void toggle(r.track_id)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
                  <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''}</span></span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.disagreement_score != null && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.disagreement_score >= 50 ? 'bg-rose-500/15 text-rose-600' : 'bg-ink/5 text-ink-dim'}`}>불일치 {r.disagreement_score}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge}`}>{r.embedding_status}</span>
                    {r.review_status && r.review_status !== 'pending' && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-600">{r.review_status}</span>}
                  </span>
                </button>

                {openId === r.track_id && (
                  <div className="border-t border-line/10 p-3">
                    {cmpLoading || !cmp ? (
                      <p className="py-3 text-center text-xs text-ink-dim">불러오는 중…</p>
                    ) : !cmp.has_embedding ? (
                      <p className="rounded-lg bg-bg-soft/40 px-3 py-3 text-xs text-ink-mute">아직 임베딩 분석 전입니다. Colab 또는 worker 로 분석 후 import 해주세요. (model={cmp.model_name ?? 'openl3'})</p>
                    ) : (
                      <div className="space-y-3">
                        {cmp.suspected_issues.length > 0 && (
                          <div className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700 ring-1 ring-amber-400/20">
                            ⚠ {cmp.suspected_issues.map((i) => ISSUE_LABELS[i] ?? i).join(' · ')}
                            {cmp.suspected_issues.includes('gym_false_positive') && <p className="mt-0.5">휴리스틱은 헬스장으로 보지만, 임베딩은 라운지/카페 계열에 더 가깝습니다.</p>}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="mb-1 text-[10px] font-bold text-ink-dim">기존 heuristic store_fit</p>
                            {cmp.heuristic_top5.map((h) => (
                              <div key={h.store_key} className="flex items-center gap-1.5 text-[11px]">
                                <span className="w-16 shrink-0 truncate text-ink-mute">{STORE_LABELS[h.store_key] ?? h.store_key}</span>
                                <div className="h-1.5 flex-1 rounded bg-ink/5"><div className="h-full rounded bg-indigo-400" style={{ width: `${h.score}%` }} /></div>
                                <span className="w-7 text-right tabular-nums">{h.score}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <p className="mb-1 text-[10px] font-bold text-accent">embedding similarity</p>
                            {cmp.embedding_top5.map((e) => {
                              const pct = Math.round(e.similarity * 100);
                              const col = e.similarity >= 0.8 ? 'bg-emerald-500' : e.similarity >= 0.6 ? 'bg-amber-500' : 'bg-ink/30';
                              return (
                                <div key={e.store_key} className="flex items-center gap-1.5 text-[11px]">
                                  <span className="w-16 shrink-0 truncate text-ink-mute">{STORE_LABELS[e.store_key] ?? e.store_key}</span>
                                  <div className="h-1.5 flex-1 rounded bg-ink/5"><div className={`h-full rounded ${col}`} style={{ width: `${pct}%` }} /></div>
                                  <span className="w-7 text-right tabular-nums">{pct}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => void act(() => applyEmbeddingToAiMetadata(r.track_id), 'embedding 결과 반영(검토용, 라이브 미연동)', r.track_id)} disabled={busy}
                            className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">AI 판정에 반영</button>
                          <button onClick={() => void act(() => markEmbeddingReviewed(r.track_id), '문제 없음 처리', r.track_id)} disabled={busy}
                            className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50">문제 없음</button>
                          <button onClick={() => void act(() => markEmbeddingReanalysisNeeded(r.track_id), '재분석 필요로 표시(다음 export 포함)', r.track_id)} disabled={busy}
                            className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50">재분석 필요</button>
                          {cmp.embedding_top5[0] && (
                            <button onClick={() => void act(() => addStoreSeedCandidate(r.track_id, cmp.embedding_top5[0].store_key), `${cmp.embedding_top5[0].store_key} seed 후보 등록`, r.track_id)} disabled={busy}
                              className="rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">seed 후보({STORE_LABELS[cmp.embedding_top5[0].store_key] ?? cmp.embedding_top5[0].store_key})</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GuardrailBadges({ trackId, ready }: { trackId: string; ready: boolean }) {
  const [rows, setRows] = useState<GuardrailStoreResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try { setRows(await getTrackGuardrails(trackId)); setOpen(true); }
    catch (e) { toast.error(`guardrail 조회 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function override(storeKey: string) {
    try { await setGuardrailOverride(trackId, storeKey, true, '관리자 override'); toast.success(`${storeKey} guardrail override`); setRows(await getTrackGuardrails(trackId)); }
    catch (e) { toast.error(`override 실패: ${(e as Error).message}`); }
  }
  if (!ready) return null;
  const blocked = rows?.filter((r) => r.gr.blocked) ?? [];
  const soft = rows?.filter((r) => !r.gr.blocked && r.gr.severity === 'soft_block') ?? [];
  const warn = rows?.filter((r) => !r.gr.blocked && r.gr.severity === 'warning') ?? [];
  return (
    <div className="mt-2">
      {!open ? (
        <button onClick={() => void load()} disabled={busy} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-ink/10 disabled:opacity-50">
          {busy ? '조회 중…' : '🛡 매장 금지규칙 검사'}
        </button>
      ) : (rows && rows.length === 0) ? (
        <p className="text-[10px] text-emerald-600">금지규칙 위반 없음 (모든 매장 통과)</p>
      ) : (
        <div className="space-y-1">
          {blocked.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-bold text-rose-600">차단:</span>
              {blocked.map((b) => (
                <span key={b.store_key} className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"
                  title={b.gr.violations.map((v) => v.reason).join(', ')}>
                  {STORE_LABELS[b.store_key] ?? b.store_key}
                  <button onClick={() => void override(b.store_key)} className="ml-0.5 rounded bg-rose-500/20 px-1 text-[9px] hover:bg-rose-500/30">override</button>
                </span>
              ))}
            </div>
          )}
          {soft.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] font-bold text-amber-600">감점:</span>{soft.map((s) => <span key={s.store_key} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700">{STORE_LABELS[s.store_key] ?? s.store_key}</span>)}</div>}
          {warn.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] font-bold text-yellow-600">주의:</span>{warn.map((w) => <span key={w.store_key} className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-700">{STORE_LABELS[w.store_key] ?? w.store_key}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

function GuardrailDashboardTab() {
  const [dash, setDash] = useState<GuardrailDashboard | null>(null);
  const [tracks, setTracks] = useState<GuardrailViolationTrack[]>([]);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([guardrailDashboard(), listGuardrailViolationTracks('hard_block', storeFilter, 200)]);
      setDash(d); setTracks(t); setSel({});
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [storeFilter]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  const selIds = Object.keys(sel).filter((k) => sel[k]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void run(() => recomputeGuardrailFlags(), '위반 스냅샷 재계산 완료')} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">위반 재계산</button>
        <button onClick={() => void run(() => recomputeMetadataTrust(), 'metadata trust 재계산 완료')} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">trust 재계산</button>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">먼저 "위반 재계산"으로 스냅샷을 생성하세요. (추천/정산 미반영 — 운영 점검용)</p>

      {dash && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PStat label="위반(전체)" v={dash.total_violating_tracks} />
            <PStat label="hard_block 곡" v={dash.hard_block_tracks} />
            <PStat label="soft_block" v={dash.by_severity?.soft_block ?? 0} />
            <PStat label="warning" v={dash.by_severity?.warning ?? 0} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">매장별 차단(hard)</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.by_store.slice(0, 12).map((s) => (
                  <li key={s.store_key} className="flex items-center justify-between gap-2">
                    <button onClick={() => setStoreFilter(storeFilter === s.store_key ? null : s.store_key)} className={`truncate text-left ${storeFilter === s.store_key ? 'font-bold text-accent' : 'text-ink-mute'}`}>{STORE_LABELS[s.store_key] ?? s.store_key}</button>
                    <span className="shrink-0 tabular-nums text-rose-600">{s.hard_count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">위반 규칙 TOP10</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.top_rules.map((r) => <li key={r.rule_key} className="flex justify-between gap-2"><span className="truncate text-ink-mute">{r.rule_key}</span><span className="shrink-0 tabular-nums">{r.cnt}</span></li>)}
              </ul>
            </div>
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">문제 업로더 (trust)</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.uploaders.slice(0, 12).map((u) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink-mute">{u.artist_name ?? u.user_id.slice(0, 8)}</span>
                    <span className="shrink-0 tabular-nums">위반 {u.hard_tracks}/{u.total_tracks} · trust <b className={`${(u.metadata_trust_score ?? 100) < 60 ? 'text-rose-600' : (u.metadata_trust_score ?? 100) < 85 ? 'text-amber-600' : 'text-emerald-600'}`}>{u.metadata_trust_score ?? '-'}</b></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-bold">위반 곡 {storeFilter ? `· ${STORE_LABELS[storeFilter] ?? storeFilter}` : '(hard_block 전체)'} ({tracks.length})</h3>
          {storeFilter && <button onClick={() => setStoreFilter(null)} className="rounded bg-ink/5 px-2 py-0.5 text-[10px]">필터 해제</button>}
          <div className="ml-auto flex gap-1.5">
            {storeFilter && <button onClick={() => void run(() => bulkGuardrailOverride(selIds, storeFilter, '대시보드 일괄 override'), `${selIds.length}곡 ${storeFilter} override`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50">선택 매장 override</button>}
            <button onClick={() => void run(() => bulkGuardrailClear(selIds, '문제 없음 일괄'), `${selIds.length}곡 문제 없음`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 disabled:opacity-50">문제 없음(전체 override)</button>
            <button onClick={() => void run(() => bulkApplyAiMetadata(selIds), `${selIds.length}곡 메타 재설정`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent disabled:opacity-50">메타 재설정</button>
          </div>
        </div>
        {tracks.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-dim">{loading ? '불러오는 중…' : '위반 곡이 없어요. (재계산 필요)'}</p>
        ) : (
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
            {tracks.map((t) => (
              <li key={t.track_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-ink/5">
                <input type="checkbox" checked={!!sel[t.track_id]} onChange={() => setSel((s) => ({ ...s, [t.track_id]: !s[t.track_id] }))} />
                <span className="min-w-0 flex-1 truncate"><b>{t.title ?? '(제목없음)'}</b> · <span className="text-ink-dim">{t.artist ?? ''}</span> · {t.main_genre ?? '-'}</span>
                <span className="shrink-0 text-rose-600">차단 {t.hard_stores}</span>
                <span className="hidden shrink-0 truncate text-[10px] text-ink-dim sm:block" title={(t.blocked_stores ?? []).join(', ')}>{(t.blocked_stores ?? []).slice(0, 4).map((s) => STORE_LABELS[s] ?? s).join(',')}</span>
                <button onClick={() => setMetaModal({ track_id: t.track_id, title: t.title })} className="shrink-0 rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">메타 수정</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={false}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}

function HighRiskTab() {
  const [rows, setRows] = useState<HighRiskTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null; canApprove: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listHighRiskTracks(200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, msg: string) {
    setBusyId(id);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function copyNotice(userId: string) {
    try { const d = await getUploaderDetail(userId); await navigator.clipboard.writeText(d.notice_message); toast.success('업로더 안내 문구를 복사했어요.'); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-dim">trust&lt;50 · guardrail hard · AI 불일치 · 임베딩 불일치 · 품질 REJECT(오디오 차단) 곡을 위험도순으로. (추천/정산 미반영)</p>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '고위험 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.track_id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''} · {r.release_status}</span></span>
                <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600">위험도 {r.risk_score}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                {r.low_trust && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-600">trust {r.trust_score}</span>}
                {r.guardrail_hard && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-600">차단 {r.hard_stores}매장</span>}
                {r.ai_mismatch_high && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">AI 불일치 {Math.round((r.mismatch_score ?? 0) * 100)}%</span>}
                {r.embedding_disagree_high && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">임베딩 불일치</span>}
                {r.lufs_boundary && (
                  <span title="오디오 품질 게이트(0210) 결과 reject — TP>+0.3 또는 clipping 또는 분석 실패"
                    className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-600">품질 REJECT</span>
                )}
                <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-dim">{r.owner_name ?? ''} ({r.trust_tier})</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => void act(r.track_id, () => applyAiMetadata(r.track_id, {}), 'AI 메타 적용')} disabled={busyId === r.track_id}
                  className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent disabled:opacity-50">AI 메타 적용</button>
                {r.guardrail_hard && (
                  <button onClick={() => void act(r.track_id, () => bulkGuardrailClear([r.track_id], '고위험 검수 - 문제없음'), '문제 없음(차단 해제)')} disabled={busyId === r.track_id}
                    className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 disabled:opacity-50">문제 없음</button>
                )}
                <button onClick={() => setMetaModal({ track_id: r.track_id, title: r.title, canApprove: canApproveStatus(r.release_status) })} disabled={busyId === r.track_id}
                  className="rounded-lg bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 disabled:opacity-50">메타 수정/승인</button>
                <button onClick={() => void copyNotice(r.owner_user_id)} className="rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">업로더 안내문구 복사</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={metaModal.canApprove}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}

const REREVIEW_STORE_LABELS: Record<string, string> = {
  gym: '헬스장', pilates: '필라테스', yoga: '요가', hospital: '병원', cafe_independent: '카페_개인',
  cafe_franchise: '카페_프렌차이즈', winebar: '와인바', cocktail_bar: '칵테일바', restaurant: '식당',
  korean_restaurant: '한식당', brunch_cafe: '브런치카페', office: '사무실', coworking: '코워킹스페이스',
  salon: '미용실', nail_shop: '네일샵', hotel_lobby: '호텔로비', select_shop: '편집샵',
  clothing_store: '의류매장', kids_cafe: '키즈카페', dog_cafe: '애견카페', pc_bang: 'PC방', fine_dining: '파인다이닝',
};
const storeLabel = (k: string) => REREVIEW_STORE_LABELS[k] ?? k;

function RereviewTab() {
  const [summary, setSummary] = useState<RereviewSummary | null>(null);
  const [rows, setRows] = useState<RereviewQueueRow[]>([]);
  const [filter, setFilter] = useState('needs_re_review');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<RereviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [autoResolve, setAutoResolve] = useState(true);
  const [results, setResults] = useState<Record<string, RecomputeResult>>({});
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null; canApprove: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]);
      setSummary(s); setRows(q); setSelected(new Set());
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function runFull() {
    if (!window.confirm('전체 재검수를 실행할까요? (진단/플래그만 — 자동 삭제·비공개 없음)')) return;
    setRunning(true);
    try {
      let offset = 0; let total = 0; let processed = 0;
      for (;;) {
        const r = await rereviewBatch(offset, 20);
        total = r.total; processed += r.processed;
        setProgress(`AI 메타 재계산… ${Math.min(offset + 20, total)}/${total}`);
        if (!r.has_more) break;
        offset = r.next_offset;
      }
      setProgress('guardrail/trust/플래그 생성 중…');
      const fin = await finalizeRereview();
      toast.success(`재검수 완료 — ${processed}곡 처리, 플래그 ${fin.flags_upserted}건`);
      await load();
    } catch (e) { toast.error(`재검수 실패: ${(e as Error).message}`); }
    finally { setRunning(false); setProgress(null); }
  }

  async function act(trackIds: string[], action: RereviewActionType, storeKey?: string, note?: string) {
    if (trackIds.length === 0) { toast.error('선택된 곡이 없어요.'); return; }
    setBusy(true);
    try { const r = await rereviewAction(trackIds, action, storeKey, note); toast.success(`처리됨 (${r.affected}곡)`); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  // AI 메타 적용 + 자동 재평가 파이프라인 (개별) — diff 패널 표시
  async function applyMetaOne(trackId: string) {
    setBusy(true);
    try {
      const res = await applyAiMetadataAndRecompute(trackId, { autoResolve });
      setResults((p) => ({ ...p, [trackId]: res }));
      toast.success(res.warning ? `적용됨 — 경고 있음` : `적용 + 재평가 완료`);
      const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]);
      setSummary(s); setRows(q);
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  // AI 메타 적용 + 재평가 (일괄) — 곡별 파이프라인, 실패 격리, 진행률
  async function bulkApplyMeta() {
    const ids = [...selected];
    if (ids.length === 0) { toast.error('선택된 곡이 없어요.'); return; }
    setBusy(true);
    let ok = 0; let fail = 0; const acc: Record<string, RecomputeResult> = {};
    for (let i = 0; i < ids.length; i++) {
      setProgress(`AI 메타 적용 + 재평가… ${i + 1}/${ids.length} (성공 ${ok} · 실패 ${fail})`);
      try { acc[ids[i]] = await applyAiMetadataAndRecompute(ids[i], { autoResolve }); ok += 1; }
      catch { fail += 1; }
    }
    setResults((p) => ({ ...p, ...acc }));
    toast[fail ? 'error' : 'success'](`일괄 적용 완료 — 성공 ${ok} · 실패 ${fail}`);
    setProgress(null);
    try { const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]); setSummary(s); setRows(q); }
    catch { /* noop */ }
    setBusy(false);
  }
  // 선택 곡들의 "등록 매장 충돌" 태그를 곡별로 제거
  async function bulkRemoveConflicts() {
    const targets = rows.filter((r) => selected.has(r.track_id) && (r.blocked_declared_stores?.length ?? 0) > 0);
    if (targets.length === 0) { toast.error('충돌 매장이 있는 선택 곡이 없어요.'); return; }
    setBusy(true);
    try {
      let n = 0;
      for (const r of targets) {
        for (const sk of r.blocked_declared_stores ?? []) { await rereviewAction([r.track_id], 'remove_declared_store', sk); }
        n += 1;
      }
      toast.success(`충돌 태그 제거 완료 (${n}곡)`); await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id); setDetail(null); setDetailLoading(true);
    try { setDetail(await rereviewTrackDetail(id)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }

  function toggleSel(id: string) { setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selAll() { setSelected((p) => p.size === rows.length ? new Set() : new Set(rows.map((r) => r.track_id))); }
  const selIds = [...selected];

  const FILTERS: [string, string][] = [
    ['needs_re_review', '재검수 필요'], ['high_risk', '고위험'], ['quality_review_required', '품질 재검수'],
    ['guardrail_hard', '매장 차단'], ['mismatch_high', '불일치 high'], ['low_trust', '저신뢰'],
    ['metadata_cleanup_required', '메타 정리/재분류'],
    ['store:hospital', '병원 충돌'], ['store:gym', '헬스장 충돌'], ['store:yoga', '요가 충돌'], ['store:kids_cafe', '키즈카페 충돌'],
    ['all', '전체'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runFull()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '실행 중…' : '전체 재검수 실행'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
        {progress && <span className="text-xs text-ink-mute">{progress}</span>}
      </div>
      <p className="text-[11px] text-ink-dim">재검수 대상 곡을 듣고 등록 메타 vs AI 추천을 비교해 개별/일괄 처리합니다. 자동 삭제·비공개 없음 — 메타/태그/플래그만 변경. 오디오 품질/DSP 분석은 "분석 대기" 탭에서 실행.</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <PStat label="대상 곡" v={summary.total_target} />
          <PStat label="재검수 필요" v={summary.needs_re_review} />
          <PStat label="고위험" v={summary.high_risk_flags} />
          <PStat label="불일치 high" v={summary.mismatch_high} />
          <PStat label="품질 재검수" v={summary.quality_review_required} />
          <PStat label="저신뢰 업로더" v={summary.low_trust_uploaders} />
          <PStat label="수정요청 대기" v={summary.fix_requested} />
          <PStat label="처리완료" v={summary.resolved_total} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
      </div>

      {/* 일괄 처리 바 */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-bg-soft px-3 py-2 text-[11px]">
        <button onClick={selAll} className="rounded bg-bg-card px-2 py-1 font-semibold hover:bg-bg-hover">{selected.size === rows.length && rows.length > 0 ? '전체 해제' : '전체 선택'}</button>
        <span className="text-ink-dim">{selected.size}곡 선택</span>
        <label className="flex items-center gap-1 text-ink-mute"><input type="checkbox" checked={autoResolve} onChange={(e) => setAutoResolve(e.target.checked)} className="h-3 w-3 accent-accent" /> 충돌 해소 시 자동 resolve</label>
        <span className="mx-1 h-3 w-px bg-line" />
        <button disabled={busy || selected.size === 0} onClick={() => void bulkApplyMeta()} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 적용 + 재평가</button>
        <button disabled={busy || selected.size === 0} onClick={() => void bulkRemoveConflicts()} className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-600 disabled:opacity-40">충돌 매장 태그 제거</button>
        <button disabled={busy || selected.size === 0} onClick={() => void act(selIds, 'request_fix')} className="rounded bg-orange-500/15 px-2 py-1 font-semibold text-orange-600 disabled:opacity-40">수정 요청</button>
        <button disabled={busy || selected.size === 0} onClick={() => void act(selIds, 'no_problem')} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">문제 없음</button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 조건의 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.track_id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={selected.has(r.track_id)} onChange={() => toggleSel(r.track_id)} className="mt-1 h-4 w-4 accent-accent" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <b className="truncate">{r.title ?? '(제목없음)'}</b>
                    <span className="text-ink-dim">{r.artist ?? ''} · {r.release_status}</span>
                    {r.trust_score < 50 && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">trust {r.trust_score}</span>}
                    {r.needs_fix && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">수정요청</span>}
                    {r.disposition && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-mute">{r.disposition}</span>}
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-amber-600">{r.problem_summary}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {(r.open_flags ?? []).map((f) => <span key={f} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">{f}</span>)}
                  </div>
                  {r.audio_url && <audio src={r.audio_url} controls preload="none" className="mt-2 h-8 w-full" />}
                </div>
                <button onClick={() => void toggleExpand(r.track_id)} className="shrink-0 rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === r.track_id ? '접기' : '비교/상세'}</button>
              </div>

              {/* 선언 vs 차단 매장 요약 */}
              <div className="mt-2 grid grid-cols-1 gap-1.5 text-[10px] sm:grid-cols-2">
                <div><span className="text-ink-dim">등록 매장: </span>{(r.declared_stores ?? []).length ? (r.declared_stores ?? []).map((s) => <span key={s} className="mr-1 rounded bg-bg-soft px-1.5 py-0.5">{storeLabel(s)}</span>) : <span className="text-ink-dim">없음</span>}</div>
                <div><span className="text-ink-dim">차단 매장: </span>{(r.blocked_stores ?? []).length ? (r.blocked_stores ?? []).map((s) => <span key={s} className={`mr-1 rounded px-1.5 py-0.5 ${(r.blocked_declared_stores ?? []).includes(s) ? 'bg-rose-500/15 font-semibold text-rose-600' : 'bg-bg-soft text-ink-mute'}`}>{storeLabel(s)}</span>) : <span className="text-ink-dim">없음</span>}</div>
              </div>

              {/* 개별 빠른 액션 */}
              <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                <button disabled={busy} onClick={() => void applyMetaOne(r.track_id)} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 적용 + 재평가</button>
                <button disabled={busy} onClick={() => setMetaModal({ track_id: r.track_id, title: r.title, canApprove: canApproveStatus(r.release_status) })} className="rounded bg-indigo-500/15 px-2 py-1 font-semibold text-indigo-600 disabled:opacity-40">메타 수정/승인</button>
                {(r.blocked_declared_stores ?? []).map((sk) => (
                  <span key={sk} className="inline-flex items-center gap-0.5">
                    <button disabled={busy} onClick={() => void act([r.track_id], 'remove_declared_store', sk)} className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-600 disabled:opacity-40">{storeLabel(sk)} 태그 제거</button>
                    <button disabled={busy} onClick={() => void act([r.track_id], 'exclude_store', sk)} className="rounded bg-rose-500/15 px-2 py-1 font-semibold text-rose-600 disabled:opacity-40">{storeLabel(sk)} 제외</button>
                  </span>
                ))}
                <button disabled={busy} onClick={() => void act([r.track_id], 'request_fix')} className="rounded bg-orange-500/15 px-2 py-1 font-semibold text-orange-600 disabled:opacity-40">수정 요청</button>
                <button disabled={busy} onClick={() => void act([r.track_id], 'no_problem')} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">문제 없음</button>
              </div>

              {/* AI 메타 적용 후 재평가 diff */}
              {results[r.track_id] && <RecomputeDiffPanel res={results[r.track_id]} onClose={() => setResults((p) => { const n = { ...p }; delete n[r.track_id]; return n; })} />}

              {/* 확장: 등록 메타 vs AI 메타 + guardrail breakdown */}
              {expanded === r.track_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-3 text-[10px]">
                  {detailLoading || !detail ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : ''}</p> : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="mb-1 font-bold text-ink-mute">등록자 입력</p>
                          <p>장르: {(detail.declared_genres ?? []).join(', ') || '—'}</p>
                          <p>무드: {(detail.declared_moods ?? []).join(', ') || '—'}</p>
                          <p>상황: {(detail.declared_situations ?? []).join(', ') || '—'}</p>
                          <p>매장 태그: {(detail.declared_store_tags ?? []).join(', ') || '—'}</p>
                        </div>
                        <div>
                          <p className="mb-1 font-bold text-accent">AI 추천</p>
                          <p>장르: {(detail.ai_genres ?? []).join(', ') || '—'}</p>
                          <p>무드: {(detail.ai_moods ?? []).join(', ') || '—'}</p>
                          <p>상황: {(detail.ai_situations ?? []).join(', ') || '—'}</p>
                          <p>에너지: {detail.ai_energy_level ?? '—'} · 보컬: {detail.ai_vocal_type ?? '—'}</p>
                          <p>불일치: {detail.mismatch_score != null ? detail.mismatch_score.toFixed(2) : '—'}</p>
                        </div>
                      </div>
                      {detail.ai_explanation && <p className="rounded bg-bg-card px-2 py-1 text-ink-mute">{detail.ai_explanation}</p>}
                      {(detail.mismatch_reasons ?? []).length > 0 && (
                        <ul className="list-disc space-y-0.5 pl-4 text-ink-dim">{(detail.mismatch_reasons ?? []).map((m, i) => <li key={i}>{m}</li>)}</ul>
                      )}
                      {detail.guardrails.length > 0 && (
                        <div>
                          <p className="mb-1 font-bold text-ink-mute">매장별 금지규칙</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.guardrails.map((g) => (
                              <span key={g.store_key} className={`rounded px-1.5 py-0.5 ${g.is_declared && g.severity === 'hard_block' ? 'bg-rose-500/15 font-semibold text-rose-600' : g.severity === 'hard_block' ? 'bg-amber-500/10 text-amber-600' : 'bg-bg-card text-ink-mute'}`} title={(g.rules ?? []).join(', ')}>{g.store_label}{g.is_declared ? '✓' : ''} · {g.severity}</span>
                            ))}
                          </div>
                          <p className="mt-1 text-ink-dim">✓ = 등록자가 선언한 매장 · 빨강 = 선언 매장에서 hard_block(검수 필요)</p>
                        </div>
                      )}
                      {(detail.ai_exclusions ?? []).length > 0 && <p className="text-ink-dim">제외 매장: {(detail.ai_exclusions ?? []).map(storeLabel).join(', ')}</p>}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={metaModal.canApprove}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}

function RecomputeDiffPanel({ res, onClose }: { res: RecomputeResult; onClose: () => void }) {
  const arrow = (d: number) => d > 0 ? <span className="text-emerald-600">▲ +{d}</span> : d < 0 ? <span className="text-rose-600">▼ {d}</span> : <span className="text-ink-dim">―</span>;
  const changed = res.fit_diff.filter((d) => d.delta !== 0);
  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-[10px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-accent">AI 메타 적용 후 재평가 결과</span>
        <button onClick={onClose} className="rounded bg-bg-card px-2 py-0.5 text-[10px] text-ink-mute hover:bg-bg-hover">닫기</button>
      </div>
      {res.warning && <p className="mb-2 rounded bg-rose-500/10 px-2 py-1 font-semibold text-rose-600">⚠ {res.warning}</p>}
      <div className="mb-2 flex flex-wrap gap-3">
        <span>위험도: <b>{res.risk_before}</b> → <b className={res.risk_reduced ? 'text-emerald-600' : ''}>{res.risk_after}</b>{res.risk_reduced && ' ✓감소'}</span>
        <span>불일치: <b>{res.mismatch_before}</b> → <b className={res.mismatch_reduced ? 'text-emerald-600' : ''}>{res.mismatch_after}</b>{res.mismatch_reduced && ' ✓감소'}</span>
      </div>
      {res.top_gains.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-bold text-ink-mute">추천 상승 매장 TOP5</p>
          <div className="flex flex-wrap gap-1">
            {res.top_gains.map((g) => <span key={g.store_key} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">{g.store_label} {g.before ?? 0}→{g.after ?? 0} (+{g.delta})</span>)}
          </div>
        </div>
      )}
      {res.unblocked_stores.length > 0 && <p className="mb-1">차단 해제: {res.unblocked_stores.map(storeLabel).join(', ')}</p>}
      {res.newly_blocked_stores.length > 0 && <p className="mb-1 text-rose-600">신규 차단: {res.newly_blocked_stores.map(storeLabel).join(', ')}</p>}
      {res.removed_conflicts.length > 0 && <p className="mb-1 text-emerald-600">충돌 해소: {res.removed_conflicts.map(storeLabel).join(', ')}</p>}
      {changed.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ink-dim">매장별 fit 변화 ({changed.length})</summary>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            {changed.map((d) => <span key={d.store_key}>{d.store_label}: {d.before ?? 0}→{d.after ?? 0} {arrow(d.delta)}</span>)}
          </div>
        </details>
      )}
      {changed.length === 0 && res.top_gains.length === 0 && <p className="text-ink-dim">fit 변화 없음 (메타가 이미 일치) — 상태 동기화만 수행됨.</p>}
    </div>
  );
}

const FLOW_ISSUE_LABELS: Record<string, string> = {
  bpm_jump: 'BPM 급변', energy_jump: '에너지 급변', brightness_jump: '밝기 급변', vocal_collision: '보컬 충돌',
  drop_shock: '에너지 급락', mood_collision: '무드 충돌', repetitive_similarity: '과도한 유사(단조)', missing_features: '분석 결측',
};
const flowColor = (s: number | null) => s == null ? 'text-ink-dim' : s >= 80 ? 'text-emerald-600' : s >= 65 ? 'text-amber-600' : 'text-rose-600';

function FlowTab() {
  const [summary, setSummary] = useState<FlowSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<FlowTransition[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await playlistFlowSummary()); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runAll() {
    setRunning(true);
    try { const r = await computeAllPlaylistFlows(); toast.success(`흐름 분석 완료 — ${r.playlists_scored}개 플레이리스트`); await load(); }
    catch (e) { toast.error(`분석 실패: ${(e as Error).message}`); }
    finally { setRunning(false); }
  }
  async function recomputeOne(id: string) {
    setBusyId(id);
    try { await computePlaylistFlow(id); toast.success('재분석 완료'); await load(); if (expanded === id) await openDetail(id, true); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function openDetail(id: string, force = false) {
    if (expanded === id && !force) { setExpanded(null); setTransitions(null); return; }
    setExpanded(id); setTransitions(null); setDetailLoading(true);
    try { const d = await getPlaylistFlow(id); setTransitions(d.transitions); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runAll()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '분석 중…' : '전체 흐름 분석'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">곡 단위 적합도가 아닌 <b>곡↔곡 전환 흐름</b>을 평가합니다. BPM/에너지/밝기/보컬 급변, 무드 충돌, 에너지 급락, 과도한 유사(단조), 전환 피로를 계산해 playlist_flow_score(0–100)를 생성합니다. 순서/내용은 변경하지 않습니다.</p>

      {summary.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '아직 분석 결과가 없어요. "전체 흐름 분석"을 실행하세요.'}</p>
      ) : (
        <ul className="space-y-2">
          {summary.map((p) => (
            <li key={p.playlist_id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-center gap-2">
                <span className={`w-12 shrink-0 text-center text-xl font-extrabold ${flowColor(p.flow_score)}`}>{p.flow_score ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{p.title ?? '(제목없음)'}</p>
                  <p className="text-[10px] text-ink-dim">{p.n_tracks}곡 · 전환 {p.n_transitions} · 평균 {p.avg_transition ?? '—'} · 감정연속성 {p.emotional_continuity ?? '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {p.rough_transitions > 0 && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">거친 전환 {p.rough_transitions}</span>}
                    {p.repetitive_count > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">단조 {p.repetitive_count}</span>}
                    {p.drop_shock_count > 0 && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-600">급락 {p.drop_shock_count}</span>}
                    {p.mood_collision_count > 0 && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600">무드충돌 {p.mood_collision_count}</span>}
                    {p.fatigue_index > 0 && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">피로 -{p.fatigue_index}</span>}
                    {p.monotony_index > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">단조 -{p.monotony_index}</span>}
                  </div>
                </div>
                <span className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => void openDetail(p.playlist_id)} className="rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === p.playlist_id ? '접기' : '전환 상세'}</button>
                  <button disabled={busyId === p.playlist_id} onClick={() => void recomputeOne(p.playlist_id)} className="rounded bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent disabled:opacity-40">재분석</button>
                </span>
              </div>

              {expanded === p.playlist_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-2 text-[10px]">
                  {detailLoading || !transitions ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : ''}</p> : transitions.length === 0 ? (
                    <p className="text-ink-dim">전환 없음 (곡 2개 미만).</p>
                  ) : (
                    <ul className="space-y-1">
                      {transitions.map((t) => (
                        <li key={t.position} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-2 py-1 ${t.issues.length > 0 ? 'bg-bg-card' : ''}`}>
                          <span className={`w-7 text-center font-bold ${flowColor(t.transition_score)}`}>{t.transition_score}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-mute">{t.from_title ?? '?'} <span className="text-ink-dim">→</span> {t.to_title ?? '?'}</span>
                          <span className="text-ink-dim">ΔBPM {t.bpm_jump} · ΔE {t.energy_jump} · ΔB {t.brightness_jump}{t.energy_drop != null && t.energy_drop > 0.3 ? ` · 급락 ${t.energy_drop}` : ''}</span>
                          {t.issues.map((iss) => <span key={iss} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">{FLOW_ISSUE_LABELS[iss] ?? iss}</span>)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReorderTab() {
  const [proposals, setProposals] = useState<ReorderProposalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReorderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setProposals(await listReorderProposals()); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function genAll() {
    setRunning(true);
    try { const r = await generateAllReorders(); toast.success(`제안 생성 — ${r.proposals}개 (개선 ${r.with_improvement})`); await load(); }
    catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setRunning(false); }
  }
  async function openDetail(pid: string) {
    if (expanded === pid) { setExpanded(null); setDetail(null); return; }
    setExpanded(pid); setDetail(null); setDetailLoading(true);
    try { setDetail(await getReorderProposal(pid)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }
  async function approve(proposalId: string, title: string | null) {
    if (!window.confirm(`"${title ?? ''}" 곡 순서를 제안안대로 변경합니다. (곡 추가/삭제 없음, 순서만) 적용할까요?`)) return;
    setBusyId(proposalId);
    try { const r = await applyPlaylistReorder(proposalId); toast.success(`적용됨 — ${r.reordered}곡 재정렬`); setExpanded(null); setDetail(null); await load(); }
    catch (e) { toast.error(`적용 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function reject(proposalId: string) {
    setBusyId(proposalId);
    try { await rejectPlaylistReorder(proposalId); toast.success('거절됨'); setExpanded(null); setDetail(null); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  const mDelta = (b?: number, a?: number) => (b == null || a == null) ? '' : `${b}→${a}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void genAll()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '생성 중…' : '전체 제안 생성'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">Flow Score 기준으로 BPM/에너지 곡선·보컬 충돌·단조로움·전환 피로를 최소화하는 <b>추천 순서안</b>을 생성합니다. <b className="text-rose-600">자동 적용 없음</b> — 관리자가 "승인 적용"을 눌러야 순서가 반영됩니다 (곡 추가/삭제 없음).</p>

      {proposals.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '대기 중인 제안이 없어요. "전체 제안 생성"을 실행하세요.'}</p>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li key={p.id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 items-center gap-1 text-center">
                  <span className={`text-lg font-bold ${flowColor(p.current_score)}`}>{p.current_score ?? '—'}</span>
                  <span className="text-ink-dim">→</span>
                  <span className={`text-xl font-extrabold ${flowColor(p.proposed_score)}`}>{p.proposed_score ?? '—'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{p.title ?? '(제목없음)'} <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">+{p.improvement ?? 0}</span></p>
                  <p className="mt-0.5 text-[10px] text-ink-dim">
                    {p.n_tracks}곡 · 거친전환 {mDelta(p.metrics_before?.rough_transitions, p.metrics_after?.rough_transitions)} · 단조 {mDelta(p.metrics_before?.repetitive_count, p.metrics_after?.repetitive_count)} · 감정연속성 {mDelta(p.metrics_before?.emotional_continuity, p.metrics_after?.emotional_continuity)}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => void openDetail(p.playlist_id)} className="rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === p.playlist_id ? '접기' : '순서 비교'}</button>
                  <button disabled={busyId === p.id} onClick={() => void approve(p.id, p.title)} className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 disabled:opacity-40">승인 적용</button>
                  <button disabled={busyId === p.id} onClick={() => void reject(p.id)} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute disabled:opacity-40">거절</button>
                </span>
              </div>

              {expanded === p.playlist_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-2 text-[10px]">
                  {detailLoading || !detail || !detail.ok ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : (detail?.note ?? '')}</p> : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="mb-1 font-bold text-ink-mute">현재 순서</p>
                        <ol className="space-y-0.5">
                          {(detail.current_list ?? []).map((t) => <li key={t.position} className="truncate"><span className="text-ink-dim">{t.position}.</span> {t.title ?? '(제목없음)'}</li>)}
                        </ol>
                      </div>
                      <div>
                        <p className="mb-1 font-bold text-accent">제안 순서</p>
                        <ol className="space-y-0.5">
                          {(detail.proposed_list ?? []).map((t) => <li key={t.position} className={`truncate ${t.moved ? 'font-semibold text-accent' : ''}`}><span className="text-ink-dim">{t.position}.</span> {t.title ?? '(제목없음)'}{t.moved ? ' ↻' : ''}</li>)}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BusinessReactionTab() {
  const [summary, setSummary] = useState<BusinessSkipSummary | null>(null);
  const [rows, setRows] = useState<BusinessExclusionRow[]>([]);
  const [store, setStore] = useState('all');
  const [days, setDays] = useState(0);
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [s, r] = await Promise.all([businessSkipSummary(), listBusinessExclusions(store, days, status)]); setSummary(s); setRows(r); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [store, days, status]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<void>, msg: string) {
    setBusyId(id);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  const STORES: [string, string][] = [['all', '전체'], ['cafe_independent', '카페'], ['gym', '헬스장'], ['hospital', '병원'], ['cafe', '카페그룹']];
  const STATUSES: [string, string][] = [['active', '제외중'], ['restored', '복구됨'], ['ignored', '무시'], ['all', '전체']];
  const DAYS: [number, string][] = [[0, '전체기간'], [7, '최근 7일'], [30, '최근 30일']];
  const stColor = (s: string) => s === 'active' ? 'text-rose-600' : s === 'restored' ? 'text-emerald-600' : 'text-ink-mute';

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-dim">사업자(매장) 회원이 <b>30초 이내</b> 다음곡으로 넘긴 곡을 집계합니다. 같은 store_key 에서 <b>3회 이상 + 서로 다른 사업자 2명 이상</b>이면 자동 제외됩니다. 사업자 화면엔 경고가 노출되지 않으며, 관리자가 언제든 복구할 수 있습니다. (정산/차트 무관)</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <PStat label="제외중" v={summary.active} />
          <PStat label="복구됨" v={summary.restored} />
          <PStat label="무시" v={summary.ignored} />
          <PStat label="스킵 7일" v={summary.skip_events_7d} />
          <PStat label="스킵 30일" v={summary.skip_events_30d} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {STORES.map(([k, l]) => <button key={k} onClick={() => setStore(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${store === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <span className="mx-1 h-3 w-px bg-line" />
        {STATUSES.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${status === k ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <span className="mx-1 h-3 w-px bg-line" />
        {DAYS.map(([k, l]) => <button key={k} onClick={() => setDays(k)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${days === k ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 조건의 제외 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg bg-bg-card p-3 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate"><b>{r.title ?? '(제목없음)'}</b> <span className="text-ink-dim">{r.artist ?? ''}</span></span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">{r.store_group_key ? `${r.store_label}(그룹)` : r.store_label}</span>
                <span className={`text-[10px] font-bold ${stColor(r.status)}`}>{r.status}</span>
              </div>
              <p className="mt-1 text-[10px] text-ink-dim">
                스킵 {r.skip_count}회 · 고유 사업자 {r.unique_business_skip_count}명 · 최근 {r.last_detected_at ? new Date(r.last_detected_at).toLocaleDateString() : '-'} · {r.reason ?? ''}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                {r.status === 'active' ? (
                  <>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, () => restoreBusinessExclusion(r.id), '복구됨')} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">복구</button>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, () => ignoreBusinessExclusion(r.id), '무시 처리')} className="rounded bg-ink/5 px-2 py-1 font-semibold text-ink-mute disabled:opacity-40">무시</button>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, async () => { await applyAiMetadataAndRecompute(r.track_id, { autoResolve: false }); }, 'AI 메타 재적용 완료')} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 재적용</button>
                    <button disabled={busyId === r.id} onClick={() => setMetaModal({ track_id: r.track_id, title: r.title })} className="rounded bg-indigo-500/15 px-2 py-1 font-semibold text-indigo-600 disabled:opacity-40">메타 수정</button>
                    {!r.store_group_key && r.playlist_store_key.startsWith('cafe') && (
                      <button disabled={busyId === r.id} onClick={() => void act(r.id, () => excludeTrackGroup(r.track_id, 'cafe'), '카페 그룹 전체 제외')} className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-600 disabled:opacity-40">카페그룹 전체 제외</button>
                    )}
                  </>
                ) : (
                  <button disabled={busyId === r.id} onClick={() => void act(r.id, () => reactivateBusinessExclusion(r.id), '제외 유지')} className="rounded bg-rose-500/15 px-2 py-1 font-semibold text-rose-600 disabled:opacity-40">제외 유지</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={false}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}
