import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  listEmbeddingReviewTracks,
  getEmbeddingComparison,
  markEmbeddingReviewed,
  markEmbeddingReanalysisNeeded,
  addStoreSeedCandidate,
  applyEmbeddingToAiMetadata,
  type EmbeddingReviewRow,
  type EmbeddingComparison,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { PStat, STORE_LABELS } from './shared';

const ISSUE_LABELS: Record<string, string> = {
  gym_false_positive: '헬스장 오판 의심', cafe_winebar_missed: '카페/와인바 누락', store_conflict: '등록매장 충돌',
  old_model: '구버전 모델', missing_archetype: '매장 기준 임베딩 없음',
};

export default function EmbeddingReviewTab() {
  const [rows, setRows] = useState<EmbeddingReviewRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cmp, setCmp] = useState<EmbeddingComparison | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listEmbeddingReviewTracks(filter, 'laion-clap-music-v1', 150)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(tid: string) {
    if (openId === tid) { setOpenId(null); setCmp(null); return; }
    setOpenId(tid); setCmp(null); setCmpLoading(true);
    try { setCmp(await getEmbeddingComparison(tid, 'laion-clap-music-v1')); }
    catch (e) { toast.error(`비교 실패: ${(e as Error).message}`); }
    finally { setCmpLoading(false); }
  }
  async function act(fn: () => Promise<void>, msg: string, tid: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); if (openId === tid) setCmp(await getEmbeddingComparison(tid, 'laion-clap-music-v1')); await load(); }
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
            const badge = r.embedding_status === 'done' ? 'bg-emerald-500/25 text-emerald-300'
              : r.embedding_status === 'failed' ? 'bg-rose-500/25 text-rose-300'
              : 'bg-ink/10 text-ink-mute';
            return (
              <li key={r.track_id} className="rounded-xl bg-bg-card ring-1 ring-line/10">
                <button onClick={() => void toggle(r.track_id)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
                  <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''}</span></span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.disagreement_score != null && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.disagreement_score >= 50 ? 'bg-rose-500/25 text-rose-300' : 'bg-ink/5 text-ink-dim'}`}>불일치 {r.disagreement_score}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge}`}>{r.embedding_status}</span>
                    {r.review_status && r.review_status !== 'pending' && <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-[10px] text-sky-300">{r.review_status}</span>}
                  </span>
                </button>

                {openId === r.track_id && (
                  <div className="border-t border-line/10 p-3">
                    {cmpLoading || !cmp ? (
                      <p className="py-3 text-center text-xs text-ink-dim">불러오는 중…</p>
                    ) : !cmp.has_embedding ? (
                      <p className="rounded-lg bg-bg-soft/40 px-3 py-3 text-xs text-ink-mute">아직 임베딩 분석 전입니다. Colab 또는 worker 로 분석 후 import 해주세요. (model={cmp.model_name ?? 'laion-clap-music-v1'})</p>
                    ) : (
                      <div className="space-y-3">
                        {cmp.suspected_issues.length > 0 && (
                          <div className="rounded-lg bg-amber-500/25 p-2 text-[11px] text-amber-200 ring-1 ring-amber-400/50">
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
                            className="rounded-lg bg-emerald-500/25 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">문제 없음</button>
                          <button onClick={() => void act(() => markEmbeddingReanalysisNeeded(r.track_id), '재분석 필요로 표시(다음 export 포함)', r.track_id)} disabled={busy}
                            className="rounded-lg bg-amber-500/25 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">재분석 필요</button>
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
