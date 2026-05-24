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
  type AiCurationRow,
  type CurationFilter,
  type FitScoreRow,
} from '@/lib/aiCuration';
import { analyzeAudioFromUrl, generateMockFeatures } from '@/lib/audioAnalysis';
import { fetchPlaylists } from '@/lib/api';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';

type SubTab = 'pending' | 'results' | 'fit' | 'review';
const BATCH = 15;

const STORE_LABELS: Record<string, string> = {
  cafe_morning: '카페(오전)', cafe_afternoon: '카페(오후)', winebar_evening: '와인바',
  lounge: '라운지', gym: '헬스장', salon: '미용실', office: '사무실', restaurant: '식당',
};

export default function AiCurationPanel() {
  const [sub, setSub] = useState<SubTab>('pending');
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
        {([['pending', '분석 대기'], ['results', 'AI 판정 결과'], ['fit', '플레이리스트 적합도'], ['review', '위반/검토 후보']] as [SubTab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${sub === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'pending' && <PendingTab />}
      {sub === 'results' && <ResultsTab />}
      {sub === 'fit' && <FitTab />}
      {sub === 'review' && <ResultsTab reviewOnly />}
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPlaylists().then((p) => { setPlaylists(p); if (p[0]) setPid(p[0].id); }).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try { setRows(await getAiRecommendedTracksForPlaylist(pid, 100)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
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
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">fit_score ≥ 70 추천 후보만 표시됩니다. (재계산은 released/approved 곡 전체 대상)</p>
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
