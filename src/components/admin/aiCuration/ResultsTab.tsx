import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import {
  listAiCuration,
  applyAiMetadata,
  recomputeTrackAiMetadata,
  markAnalysisFailed,
  type AiCurationRow,
  type CurationFilter,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';
import BulkActionsModal from '@/components/admin/BulkActionsModal';
import { Metric, GuardrailBadges, STORE_LABELS, analyzeOne } from './shared';

export default function ResultsTab({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const [rows, setRows] = useState<AiCurationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<CurationFilter>(reviewOnly ? 'review_needed' : 'analyzed');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.track_id)));
  };
  const clearSelection = () => setSelected(new Set());

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

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length}
            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
            onChange={toggleAll} />
          <span>전체 선택 ({rows.length})</span>
        </label>
        {selected.size > 0 && (
          <>
            <span className="rounded bg-accent/15 px-2 py-0.5 font-bold text-accent">Selected: {selected.size}</span>
            <button onClick={clearSelection} className="text-ink-dim hover:underline">해제</button>
            <button onClick={() => setBulkOpen(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-600">
              <Sparkles size={12} /> Bulk Actions
            </button>
          </>
        )}
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
                      <input type="checkbox" checked={selected.has(r.track_id)} onChange={() => toggleOne(r.track_id)}
                        className="shrink-0" />
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
                  <button onClick={() => setEditorTrackId(r.track_id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-500 hover:bg-indigo-500/25">
                    <Sparkles size={12} /> AI 메타/배치 관리
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editorTrackId && (
        <TrackPlacementEditor
          trackId={editorTrackId}
          onClose={() => setEditorTrackId(null)}
          onMutated={() => { void load(); }}
        />
      )}
      {bulkOpen && selected.size > 0 && (
        <BulkActionsModal
          trackIds={Array.from(selected)}
          onClose={() => setBulkOpen(false)}
          onCompleted={() => { void load(); }}
        />
      )}
    </div>
  );
}
