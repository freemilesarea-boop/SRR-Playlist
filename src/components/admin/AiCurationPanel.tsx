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

type SubTab = 'perf' | 'pending' | 'results' | 'fit' | 'review';
const BATCH = 15;

const STORE_LABELS: Record<string, string> = {
  cafe_morning: '카페(오전)', cafe_afternoon: '카페(오후)', winebar_evening: '와인바',
  lounge: '라운지', gym: '헬스장', salon: '미용실', office: '사무실', restaurant: '식당',
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
        {([['perf', '운영 성과'], ['pending', '분석 대기'], ['results', 'AI 판정 결과'], ['fit', '플레이리스트 적합도'], ['review', '위반/검토 후보']] as [SubTab, string][]).map(([k, label]) => (
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
    : [['analyzed', '분석됨'], ['mismatch_high', '불일치 높음'], ['gym_unfit', '헬스장 부적합'], ['cafe_fit', '카페 적합'], ['failed', '실패'], ['all', '전체']];

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
                      {r.analyzer && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{r.analyzer}</span>}
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
                  </div>
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPlaylists().then((p) => { setPlaylists(p); if (p[0]) setPid(p[0].id); }).catch(() => {}); }, []);

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
