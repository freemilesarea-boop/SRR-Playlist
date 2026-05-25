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
  type EmbeddingPendingRow,
  type EmbeddingImportResult,
  type EmbeddingReviewRow,
  type EmbeddingComparison,
  type GuardrailStoreResult,
  type GuardrailDashboard,
  type GuardrailViolationTrack,
  type HighRiskTrack,
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

type SubTab = 'perf' | 'pending' | 'results' | 'fit' | 'review' | 'embedding' | 'embed_review' | 'guardrail' | 'highrisk';
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
        {([['perf', '운영 성과'], ['pending', '분석 대기'], ['results', 'AI 판정 결과'], ['fit', '플레이리스트 적합도'], ['review', '위반/검토 후보'], ['guardrail', 'Guardrail 대시보드'], ['highrisk', '고위험 검수'], ['embed_review', '임베딩 검증'], ['embedding', '임베딩(PoC)']] as [SubTab, string][]).map(([k, label]) => (
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

  const loadPending = useCallback(async () => {
    setLoading(true);
    try { setPending(await exportEmbeddingPending('openl3', 500)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HighRiskTab() {
  const [rows, setRows] = useState<HighRiskTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        <p className="text-[11px] text-ink-dim">trust&lt;50 · guardrail hard · AI 불일치 · 임베딩 불일치 · LUFS 경계 곡을 위험도순으로. (추천/정산 미반영)</p>
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
                {r.lufs_boundary && <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-yellow-700">LUFS 경계</span>}
                <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-dim">{r.owner_name ?? ''} ({r.trust_tier})</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => void act(r.track_id, () => applyAiMetadata(r.track_id, {}), 'AI 메타 적용')} disabled={busyId === r.track_id}
                  className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent disabled:opacity-50">AI 메타 적용</button>
                {r.guardrail_hard && (
                  <button onClick={() => void act(r.track_id, () => bulkGuardrailClear([r.track_id], '고위험 검수 - 문제없음'), '문제 없음(차단 해제)')} disabled={busyId === r.track_id}
                    className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 disabled:opacity-50">문제 없음</button>
                )}
                <button onClick={() => void copyNotice(r.owner_user_id)} className="rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">업로더 안내문구 복사</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
