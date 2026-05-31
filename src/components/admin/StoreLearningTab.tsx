import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Calculator, Sparkles, ExternalLink, Store } from 'lucide-react';
import {
  adminRecomputeTrackStoreBehaviorScores,
  adminListTrackStoreScores,
  adminStoreLearningSummary,
  listTaxonomyStoreTypes,
  type TrackStoreScoreRow,
  type StoreLearningSummary,
  type StoreTypeOption,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';
import BulkActionsModal from '@/components/admin/BulkActionsModal';

export default function StoreLearningTab() {
  const [storeFilter, setStoreFilter] = useState<string>('');
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);
  const [summary, setSummary] = useState<StoreLearningSummary | null>(null);
  const [rows, setRows] = useState<TrackStoreScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ rows: number; ms: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        adminStoreLearningSummary(30),
        adminListTrackStoreScores(storeFilter || undefined, 30, 200),
      ]);
      setSummary(sum);
      setRows(list);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listTaxonomyStoreTypes().then(setStoreTypes).catch((e) => toast.error(`store 로딩 실패: ${e.message}`));
  }, []);

  const recompute = async () => {
    if (!confirm('최근 30일 데이터로 모든 (트랙 × 매장) 행을 재계산하시겠어요?')) return;
    setRecomputing(true);
    try {
      const r = await adminRecomputeTrackStoreBehaviorScores(30);
      setLastResult({ rows: r.rows_upserted, ms: r.elapsed_ms });
      toast.success(`${r.rows_upserted} 행 재계산 (${(r.elapsed_ms / 1000).toFixed(1)}s)`);
      await load();
    } catch (e) {
      toast.error(`재계산 실패: ${(e as Error).message}`);
    } finally { setRecomputing(false); }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.track_id)));
  };

  const selectedTrackIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1"><Store size={14} /> 매장 학습 (Store Learning)</h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => void recompute()} disabled={recomputing}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black disabled:opacity-50">
              <Calculator size={11} className={recomputing ? 'animate-spin' : ''} /> 전체 재계산
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          score = completion×40 + replay×20 + like×20 − skip×30 + min(plays/10, 10) · confidence = min(plays/50, 1.0).
          playlist.business_category 는 normalize_store_label() 로 taxonomy slug 변환. <b>fit_score 미반영 — 인사이트만 제공</b>.
        </p>
        {lastResult && (
          <p className="mt-1 text-[11px] text-emerald-500">
            마지막 재계산: {lastResult.rows} 행 · {(lastResult.ms / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      {summary && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold">매장별 분포</h4>
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3 lg:grid-cols-4">
            <div className="rounded bg-bg-deep p-2 col-span-2 md:col-span-3 lg:col-span-4 md:flex md:items-center md:gap-3">
              <span className="font-bold">총 {summary.total_rows} 행</span>
              <span className="text-ink-mute">· {summary.distinct_tracks} 트랙</span>
              <span className="text-ink-mute">· {Object.keys(summary.by_store ?? {}).length} 매장</span>
            </div>
            {summary.by_store && Object.entries(summary.by_store)
              .sort((a, b) => b[1].rows - a[1].rows)
              .map(([slug, info]) => (
                <button key={slug} onClick={() => setStoreFilter(storeFilter === slug ? '' : slug)}
                  className={`rounded p-2 text-left transition ${storeFilter === slug ? 'bg-accent/15 ring-1 ring-accent' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                  <div className="font-bold text-[11px]">{slug}</div>
                  <div className="text-[10px] text-ink-dim">{info.rows} rows · {info.distinct_tracks} tracks</div>
                  <div className="text-[10px]">avg score <b>{info.avg_score}</b></div>
                  {(info.promotion_candidates > 0 || info.demotion_candidates > 0) && (
                    <div className="mt-1 flex gap-1 text-[10px]">
                      {info.promotion_candidates > 0 && <span className="rounded bg-emerald-500/20 px-1 text-emerald-500">↑{info.promotion_candidates}</span>}
                      {info.demotion_candidates > 0 && <span className="rounded bg-rose-500/20 px-1 text-rose-500">↓{info.demotion_candidates}</span>}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">필터:</span>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 매장</option>
          {storeTypes.map((s) => <option key={s.slug} value={s.slug}>{s.name_ko} ({s.slug})</option>)}
        </select>
        <span className="text-ink-dim">{rows.length} 행</span>
        {selected.size > 0 && (
          <>
            <span className="ml-auto rounded bg-accent/15 px-2 py-0.5 font-bold text-accent">Selected: {selected.size}</span>
            <button onClick={() => setSelected(new Set())} className="text-ink-dim hover:underline">해제</button>
            <button onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1 rounded bg-indigo-500 px-2 py-1 font-bold text-white">
              <Sparkles size={11} /> Bulk Actions
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '데이터 없음. "전체 재계산" 을 실행하세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={toggleAll} />
                </th>
                <th className="px-2 py-2">곡</th>
                <th className="px-2 py-2">매장</th>
                <th className="px-2 py-2 text-right">plays</th>
                <th className="px-2 py-2 text-right">conf</th>
                <th className="px-2 py-2 text-right">완료%</th>
                <th className="px-2 py-2 text-right">skip%</th>
                <th className="px-2 py-2 text-right">replay%</th>
                <th className="px-2 py-2 text-right">like%</th>
                <th className="px-2 py-2 text-right">score</th>
                <th className="px-2 py-2">신호</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.track_id}-${r.store_type_slug}-${idx}`} className="border-b border-line/10">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(r.track_id)} onChange={() => toggleOne(r.track_id)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                    <div className="text-ink-dim">{r.artist ?? ''} · {r.main_genre ?? '—'}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.store_name_ko ?? r.store_type_slug}</div>
                    <div className="text-[10px] text-ink-dim">{r.store_type_slug}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.play_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{(r.confidence * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.completion_rate < 0.3 && r.play_count >= 5 ? 'text-rose-500 font-bold' : ''}>
                      {(r.completion_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.skip_rate >= 0.6 && r.play_count >= 5 ? 'text-rose-500 font-bold' : ''}>
                      {(r.skip_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-ink-mute">{(r.replay_rate * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.like_rate > 0 ? 'text-emerald-500' : 'text-ink-mute'}>
                      {(r.like_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`font-bold ${r.store_behavior_score >= 70 ? 'text-emerald-500' : r.store_behavior_score <= 30 ? 'text-rose-500' : ''}`}>
                      {r.store_behavior_score.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.is_promotion_candidate && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">승격</span>}
                      {r.is_demotion_candidate && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-500">강등</span>}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setEditorTrackId(r.track_id)}
                      className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-500">
                      <ExternalLink size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        ⚠️ 자동 삭제/차단/반려/승격/강등 금지. fit_score 절대 변경 안 됨. 추천/인사이트/QC 큐만 생성.
        QC 큐의 store_behavior_high_skip / store_behavior_low_completion / store_behavior_mismatch 룰과 연동.
      </p>

      {editorTrackId && (
        <TrackPlacementEditor trackId={editorTrackId} onClose={() => setEditorTrackId(null)} onMutated={() => { void load(); }} />
      )}
      {bulkOpen && selectedTrackIds.length > 0 && (
        <BulkActionsModal trackIds={selectedTrackIds} onClose={() => setBulkOpen(false)} onCompleted={() => { void load(); }} />
      )}
    </div>
  );
}
