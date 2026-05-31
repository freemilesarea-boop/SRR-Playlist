import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Activity } from 'lucide-react';
import {
  adminPlaybackEventSummary,
  adminListEventQualityIssues,
  type PlaybackEventSummary,
  type EventQualityIssue,
} from '@/lib/playbackEventsV2';
import { toast } from '@/store/toastStore';

const ISSUE_LABEL: Record<string, string> = {
  duration_missing: '길이 정보 누락',
  completion_over_100: '완료율 100% 초과',
  listened_exceeds_duration: '청취시간 > 트랙길이',
  complete_without_start: 'play_start 없이 play_complete',
  muted_play: '음소거/저볼륨 재생',
};
const EVENT_LABEL: Record<string, string> = {
  play_start: '재생 시작',
  play_progress: '진행',
  play_25: '25%',
  play_50: '50%',
  play_75: '75%',
  play_complete: '완료',
  skip: '스킵',
  replay: '재반복',
  like: '좋아요',
  unlike: '좋아요 취소',
  volume_low: '저볼륨',
  muted: '음소거',
  player_error: '플레이어 오류',
};

export default function EventQualityTab() {
  const [days, setDays] = useState(1);
  const [summary, setSummary] = useState<PlaybackEventSummary | null>(null);
  const [issues, setIssues] = useState<EventQualityIssue[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([
        adminPlaybackEventSummary(days),
        adminListEventQualityIssues(Math.max(days, 7), 200),
      ]);
      setSummary(s);
      setIssues(q);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const issuesByType = issues.reduce((acc, i) => {
    acc[i.issue_type] = (acc[i.issue_type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1"><Activity size={14} /> 재생 이벤트 품질 (playback_events_v2)</h3>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-ink-mute">기간</span>
              <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}
                className="rounded bg-bg-deep px-2 py-1">
                <option value="1">최근 1일</option>
                <option value="7">최근 7일</option>
                <option value="30">최근 30일</option>
              </select>
            </label>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          X4.3 표준화 layer. 기존 stream_events / track_play_events 와 별도. fit/behavior 점수 영향 없음.
          이벤트 vocabulary: play_start / play_25 / play_50 / play_75 / play_complete / skip / replay / like / unlike / volume_low / muted / player_error.
        </p>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="총 이벤트" v={summary.total_events} />
            <Stat label="고유 사용자" v={summary.distinct_users} />
            <Stat label="고유 트랙" v={summary.distinct_tracks} />
            <Stat label="고유 세션" v={summary.distinct_sessions} />
          </div>

          <div className="rounded-xl bg-bg-card p-3">
            <h4 className="mb-2 text-xs font-bold">이벤트 타입별</h4>
            {Object.keys(summary.by_event_type).length === 0 ? (
              <p className="text-xs text-ink-dim">데이터 없음.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 lg:grid-cols-6">
                {Object.entries(summary.by_event_type)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="rounded bg-bg-deep p-2">
                      <div className="text-[10px] text-ink-dim">{EVENT_LABEL[k] ?? k}</div>
                      <div className="text-lg font-bold">{v}</div>
                      <div className="text-[10px] text-ink-dim/70">{k}</div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-bg-card p-3">
              <h4 className="mb-2 text-xs font-bold">매장 분포 (store_type_slug)</h4>
              {summary.by_store_slug && Object.keys(summary.by_store_slug).length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {Object.entries(summary.by_store_slug)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 12)
                    .map(([k, v]) => (
                      <li key={k} className="flex justify-between rounded bg-bg-deep px-2 py-1">
                        <span className={k === '(null)' ? 'text-rose-400' : ''}>{k}</span>
                        <span className="font-bold tabular-nums">{v}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-dim">데이터 없음.</p>
              )}
              {summary.null_store_slug_pct != null && summary.null_store_slug_pct > 0 && (
                <p className="mt-2 text-[11px] text-amber-500">
                  ⚠️ store_type_slug null: {summary.null_store_slug_pct}%
                </p>
              )}
            </div>

            <div className="rounded-xl bg-bg-card p-3">
              <h4 className="mb-2 text-xs font-bold">데이터 품질 신호</h4>
              <ul className="space-y-1.5 text-xs">
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>muted 재생</span>
                  <span className={summary.muted_events > 0 ? 'font-bold text-amber-500' : 'text-ink-mute'}>
                    {summary.muted_events}
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>volume_low 재생</span>
                  <span className={summary.volume_low_events > 0 ? 'font-bold text-amber-500' : 'text-ink-mute'}>
                    {summary.volume_low_events}
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>track_duration_seconds null</span>
                  <span className={(summary.null_duration_pct ?? 0) > 10 ? 'font-bold text-rose-500' : 'text-ink-mute'}>
                    {summary.null_duration_pct ?? 0}%
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>store_type_slug null</span>
                  <span className={(summary.null_store_slug_pct ?? 0) > 10 ? 'font-bold text-rose-500' : 'text-ink-mute'}>
                    {summary.null_store_slug_pct ?? 0}%
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
          <AlertTriangle size={12} className="text-amber-500" />
          이벤트 품질 이슈 ({issues.length})
        </h4>
        {issues.length === 0 ? (
          <p className="text-xs text-ink-dim">{loading ? '로딩 중…' : '품질 이슈 없음.'}</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
              {Object.entries(issuesByType)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <span key={k} className="rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-500">
                    {ISSUE_LABEL[k] ?? k}: {v}
                  </span>
                ))}
            </div>
            <div className="max-h-96 overflow-y-auto rounded bg-bg-deep">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-bg-card">
                  <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                    <th className="px-2 py-1.5">issue</th>
                    <th className="px-2 py-1.5">event</th>
                    <th className="px-2 py-1.5">session</th>
                    <th className="px-2 py-1.5 text-right">listened</th>
                    <th className="px-2 py-1.5 text-right">duration</th>
                    <th className="px-2 py-1.5">created</th>
                    <th className="px-2 py-1.5">evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i) => (
                    <tr key={i.event_id} className="border-b border-line/10">
                      <td className="px-2 py-1">
                        <span className="rounded bg-amber-500/15 px-1.5 font-bold text-amber-500">
                          {ISSUE_LABEL[i.issue_type] ?? i.issue_type}
                        </span>
                      </td>
                      <td className="px-2 py-1">{EVENT_LABEL[i.event_type] ?? i.event_type}</td>
                      <td className="px-2 py-1 text-[10px] text-ink-dim">{i.session_id?.slice(0, 10) ?? '—'}…</td>
                      <td className="px-2 py-1 text-right tabular-nums">{i.listened_seconds ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{i.track_duration_seconds ?? '—'}</td>
                      <td className="px-2 py-1 text-[10px] text-ink-dim">{new Date(i.created_at).toLocaleString()}</td>
                      <td className="px-2 py-1">
                        <details>
                          <summary className="cursor-pointer text-[10px] text-ink-mute">{Object.keys(i.evidence ?? {})[0] ?? '—'}</summary>
                          <pre className="mt-1 text-[10px] text-ink-dim">{JSON.stringify(i.evidence, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        ℹ️ 이번 phase 는 수집/품질 검증만 수행. behavior_score / fit_score 변경 없음.
        다음 phase 에서 playback_events_v2 기반 점수 계산으로 전환 예정.
      </p>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded bg-bg-card p-3">
      <div className="text-[10px] uppercase text-ink-dim">{label}</div>
      <div className="text-2xl font-bold">{v}</div>
    </div>
  );
}
