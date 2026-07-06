import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  playEventStats,
  trackPerformance,
  playlistPerformance,
  registerSkipViolations,
  recomputeTrackFitScores,
  type PlayEventStats,
  type TrackPerformanceRow,
  type PlaylistPerformanceRow,
  type PerfSort,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { PStat } from './shared';

export default function PerformanceTab() {
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
        <button onClick={() => void register()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-amber-500/25 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-amber-200 hover:bg-amber-500/25 disabled:opacity-50">검토 후보 자동 등록</button>
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
                    <td className={`tabular-nums ${r.skip_rate >= 40 ? 'font-bold text-rose-300' : ''}`}>{r.skip_rate}%</td>
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
                    <td className={`tabular-nums ${r.avg_skip_rate >= 40 ? 'font-bold text-rose-300' : ''}`}>{r.avg_skip_rate}%</td>
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
