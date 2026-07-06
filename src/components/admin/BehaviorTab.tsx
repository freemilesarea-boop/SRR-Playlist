import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Calculator, ExternalLink } from 'lucide-react';
import {
  adminRecomputeBehaviorScores,
  adminListBehaviorOutliers,
  type BehaviorOutlier,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';

const RISK_LABEL: Record<string, string> = {
  high_skip: 'skip > 60%',
  low_completion: 'completion < 30%',
  low_score_high_volume: '점수 낮음 (≥50 plays)',
  no_likes_despite_plays: '좋아요 0 (≥30 plays)',
  no_replays: '재생 반복 거의 없음',
};

export default function BehaviorTab() {
  const [windowDays, setWindowDays] = useState(30);
  const [minPlay, setMinPlay] = useState(20);
  const [outliers, setOutliers] = useState<BehaviorOutlier[]>([]);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [lastResult, setLastResult] = useState<{ tracks: number; ms: number } | null>(null);
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOutliers(await adminListBehaviorOutliers(windowDays, minPlay, 200));
    } catch (e) {
      toast.error(`outlier 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [windowDays, minPlay]);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    if (!confirm(`최근 ${windowDays}일 윈도우 기준으로 모든 트랙 behavior_score 를 재계산하시겠어요?`)) return;
    setRecomputing(true);
    try {
      const r = await adminRecomputeBehaviorScores(windowDays);
      setLastResult({ tracks: r.tracks_computed, ms: r.elapsed_ms });
      toast.success(`${r.tracks_computed} 트랙 재계산 (${(r.elapsed_ms / 1000).toFixed(1)}s)`);
      await load();
    } catch (e) {
      toast.error(`재계산 실패: ${(e as Error).message}`);
    } finally { setRecomputing(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">행동 지표 (Behavior Score)</h3>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-ink-mute">window</span>
              <select value={windowDays} onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
                className="rounded bg-bg-deep px-2 py-1">
                <option value="7">7d</option>
                <option value="30">30d</option>
                <option value="90">90d</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-ink-mute">min plays</span>
              <input type="number" value={minPlay} min={1} max={500}
                onChange={(e) => setMinPlay(parseInt(e.target.value, 10) || 20)}
                className="w-16 rounded bg-bg-deep px-2 py-1 text-right" />
            </label>
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
          stream_events / track_play_events / playlist_track_skip_events / liked_tracks 기반.
          behavior_score = completion×35 + replay×20 + like×20 + save×15 − skip×25 + plays×0.1 (max +10).
          play_count {minPlay} 미만은 confidence 낮음 (참고용).
          ⚠️ 이 점수는 fit_score 에 직접 반영되지 않습니다 — foundation only.
        </p>
        {lastResult && (
          <p className="mt-1 text-[11px] text-emerald-300">
            마지막 재계산: {lastResult.tracks} 트랙 · {(lastResult.ms / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      {outliers.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : `play_count ≥ ${minPlay} 위험 신호 트랙 없음 (윈도우 ${windowDays}일).`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2">곡</th>
                <th className="px-2 py-2 text-right">plays</th>
                <th className="px-2 py-2 text-right">listeners</th>
                <th className="px-2 py-2 text-right">completion</th>
                <th className="px-2 py-2 text-right">skip</th>
                <th className="px-2 py-2 text-right">replay</th>
                <th className="px-2 py-2 text-right">like</th>
                <th className="px-2 py-2 text-right">score</th>
                <th className="px-2 py-2">위험</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {outliers.map((o) => (
                <tr key={o.track_id} className="border-b border-line/10">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{o.title ?? '(제목없음)'}</div>
                    <div className="text-ink-dim">{o.artist ?? ''} · {o.main_genre ?? '—'}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{o.play_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{o.unique_listener_count}</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={o.completion_rate < 0.3 ? 'text-rose-300 font-bold' : ''}>
                      {(o.completion_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={o.skip_rate > 0.6 ? 'text-rose-300 font-bold' : ''}>
                      {(o.skip_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-ink-mute">{(o.replay_rate * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right text-ink-mute">{(o.like_rate * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`font-bold ${o.behavior_score < 30 ? 'text-rose-300' : o.behavior_score < 60 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {o.behavior_score.toFixed(1)}
                    </span>
                    <div className="text-[10px] text-ink-dim/70">conf {(o.confidence * 100).toFixed(0)}%</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {o.risk_signals.map((s) => (
                        <span key={s} className="rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                          {RISK_LABEL[s] ?? s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setEditorTrackId(o.track_id)}
                      className="inline-flex items-center gap-1 rounded bg-indigo-500/25 px-2 py-0.5 font-semibold text-indigo-500">
                      <ExternalLink size={10} /> 편집기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
