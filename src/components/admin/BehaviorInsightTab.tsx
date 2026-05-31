import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Calculator, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import {
  adminRecomputeBehaviorBoosts,
  adminListPromotionCandidates,
  adminListDemotionCandidates,
  adminListBehaviorComparison,
  type PromotionDemotionCandidate,
  type BehaviorComparisonRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';

export default function BehaviorInsightTab() {
  const [comparison, setComparison] = useState<BehaviorComparisonRow[]>([]);
  const [promotions, setPromotions] = useState<PromotionDemotionCandidate[]>([]);
  const [demotions, setDemotions] = useState<PromotionDemotionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ rows: number; ms: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cmp, prom, dem] = await Promise.all([
        adminListBehaviorComparison(50),
        adminListPromotionCandidates(70, 0.30, 50),
        adminListDemotionCandidates(30, 0.30, 50),
      ]);
      setComparison(cmp);
      setPromotions(prom);
      setDemotions(dem);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    if (!confirm('모든 playlist_track_fit_scores 행에 behavior_boost / final_fit_score 를 재계산하시겠어요? (fit_score 는 변경 안 함)')) return;
    setBusy(true);
    try {
      const r = await adminRecomputeBehaviorBoosts(30);
      setLastResult({ rows: r.rows_updated, ms: r.elapsed_ms });
      toast.success(`${r.rows_updated} 행 갱신 (${(r.elapsed_ms / 1000).toFixed(1)}s)`);
      await load();
    } catch (e) {
      toast.error(`재계산 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  // boost 분포 집계
  const stats = comparison.reduce((acc, r) => {
    const b = r.avg_boost;
    if (b > 0) acc.positive++;
    else if (b < 0) acc.negative++;
    else acc.zero++;
    if (b > acc.max) acc.max = b;
    if (b < acc.min) acc.min = b;
    acc.sum += b;
    return acc;
  }, { positive: 0, negative: 0, zero: 0, sum: 0, max: -Infinity, min: Infinity });
  const avg = comparison.length > 0 ? stats.sum / comparison.length : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">행동 인사이트 (Behavior Feedback Engine)</h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => void recompute()} disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black disabled:opacity-50">
              <Calculator size={11} className={busy ? 'animate-spin' : ''} /> behavior_boost 재계산
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          behavior_boost = (behavior_score − 50)/50 × cap(confidence). cap: &lt;0.20 ±2, &lt;0.40 ±4, &lt;0.60 ±6, &lt;0.80 ±8, ≥0.80 ±10.
          final_fit_score = fit_score + boost (0~100 clamp). <b>fit_score 는 절대 변경 안 됨</b>.
        </p>
        {lastResult && (
          <p className="mt-1 text-[11px] text-emerald-500">
            마지막 재계산: {lastResult.rows} 행 · {(lastResult.ms / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded bg-emerald-500/10 p-3">
          <div className="text-[10px] uppercase text-ink-dim">승격 후보</div>
          <div className="text-2xl font-bold text-emerald-500">{promotions.length}</div>
          <div className="text-[10px] text-ink-dim">score ≥ 70 · conf ≥ 0.30</div>
        </div>
        <div className="rounded bg-rose-500/10 p-3">
          <div className="text-[10px] uppercase text-ink-dim">강등 후보</div>
          <div className="text-2xl font-bold text-rose-500">{demotions.length}</div>
          <div className="text-[10px] text-ink-dim">score ≤ 30 · conf ≥ 0.30</div>
        </div>
        <div className="rounded bg-blue-500/10 p-3">
          <div className="text-[10px] uppercase text-ink-dim">avg boost</div>
          <div className="text-2xl font-bold text-blue-500">{avg.toFixed(2)}</div>
          <div className="text-[10px] text-ink-dim">{stats.min === Infinity ? '—' : `${stats.min.toFixed(1)} ~ ${stats.max.toFixed(1)}`}</div>
        </div>
        <div className="rounded bg-gray-500/10 p-3">
          <div className="text-[10px] uppercase text-ink-dim">boost 분포</div>
          <div className="text-[11px] mt-1">
            <span className="text-emerald-500">+{stats.positive}</span> ·{' '}
            <span className="text-gray-400">={stats.zero}</span> ·{' '}
            <span className="text-rose-500">−{stats.negative}</span>
          </div>
          <div className="text-[10px] text-ink-dim">{comparison.length} 트랙</div>
        </div>
      </div>

      {promotions.length > 0 && (
        <CandidatePanel title="승격 후보" icon={<TrendingUp size={14} />} color="emerald"
          rows={promotions} onEdit={setEditorTrackId} />
      )}
      {demotions.length > 0 && (
        <CandidatePanel title="강등 후보" icon={<TrendingDown size={14} />} color="rose"
          rows={demotions} onEdit={setEditorTrackId} />
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 text-xs font-bold">대표 트랙 비교 (play_count desc · 상위 {Math.min(50, comparison.length)})</h4>
        {comparison.length === 0 ? (
          <p className="text-xs text-ink-dim">{loading ? '로딩 중…' : '데이터 없음. behavior_boost 재계산을 먼저 실행하세요.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                  <th className="px-2 py-1.5">곡</th>
                  <th className="px-2 py-1.5 text-right">plays</th>
                  <th className="px-2 py-1.5 text-right">conf</th>
                  <th className="px-2 py-1.5 text-right">behavior</th>
                  <th className="px-2 py-1.5 text-right">avg fit</th>
                  <th className="px-2 py-1.5 text-right">boost</th>
                  <th className="px-2 py-1.5 text-right">final fit</th>
                  <th className="px-2 py-1.5">신호</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.track_id} className="border-b border-line/10">
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                      <div className="text-ink-dim">{r.artist ?? ''} · {r.main_genre ?? '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.play_count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">
                      {(r.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className={r.behavior_score >= 70 ? 'font-bold text-emerald-500' : r.behavior_score <= 30 ? 'font-bold text-rose-500' : ''}>
                        {r.behavior_score.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">
                      {r.avg_fit_score > 0 ? r.avg_fit_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className={r.avg_boost > 0 ? 'text-emerald-500' : r.avg_boost < 0 ? 'text-rose-500' : 'text-ink-dim'}>
                        {r.avg_boost > 0 ? '+' : ''}{r.avg_boost.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                      {r.avg_final_fit_score > 0 ? r.avg_final_fit_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {r.is_promotion_candidate && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">승격</span>
                        )}
                        {r.is_demotion_candidate && (
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-500">강등</span>
                        )}
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
      </div>

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        ⚠️ 자동 삭제/차단/반려/승격/강등 금지. 이 패널은 운영자 검토 추천만 제공.
        승격/강등 후보는 QC 큐 (behavior_positive_outlier / behavior_negative_outlier) 에도 등록됩니다.
      </p>

      {editorTrackId && (
        <TrackPlacementEditor
          trackId={editorTrackId}
          onClose={() => setEditorTrackId(null)}
          onMutated={() => { void load(); }}
        />
      )}
    </div>
  );
}

function CandidatePanel({
  title, icon, color, rows, onEdit,
}: {
  title: string; icon: React.ReactNode; color: 'emerald' | 'rose';
  rows: PromotionDemotionCandidate[]; onEdit: (id: string) => void;
}) {
  const colorClass = color === 'emerald' ? 'text-emerald-500' : 'text-rose-500';
  return (
    <div className="rounded-xl bg-bg-card p-3">
      <h4 className={`mb-2 flex items-center gap-1 text-xs font-bold ${colorClass}`}>
        {icon} {title} ({rows.length})
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
              <th className="px-2 py-1.5">곡</th>
              <th className="px-2 py-1.5 text-right">behavior</th>
              <th className="px-2 py-1.5 text-right">conf</th>
              <th className="px-2 py-1.5 text-right">plays</th>
              <th className="px-2 py-1.5 text-right">완료%</th>
              <th className="px-2 py-1.5 text-right">skip%</th>
              <th className="px-2 py-1.5 text-right">like%</th>
              <th className="px-2 py-1.5 text-right">placements</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.track_id} className="border-b border-line/10">
                <td className="px-2 py-1.5">
                  <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                  <div className="text-ink-dim">{r.artist ?? ''} · {r.main_genre ?? '—'}</div>
                </td>
                <td className={`px-2 py-1.5 text-right font-bold ${colorClass}`}>{r.behavior_score.toFixed(1)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(r.confidence * 100).toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.play_count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(r.completion_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(r.skip_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(r.like_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{r.current_placement_count}</td>
                <td className="px-2 py-1.5">
                  <button onClick={() => onEdit(r.track_id)}
                    className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-500">
                    <ExternalLink size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
