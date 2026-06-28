import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Activity } from 'lucide-react';
import {
  adminPlaybackEventSummary,
  adminListEventQualityIssues,
  adminRecentPlayerErrors,
  adminBehaviorDualRunSummary,
  adminCompareBehaviorV1V2,
  adminRecomputeBehaviorV2,
  type PlaybackEventSummary,
  type EventQualityIssue,
  type PlayerErrorRow,
  type BehaviorDualRunSummary,
  type BehaviorComparisonV1V2Row,
} from '@/lib/playbackEventsV2';
import { Calculator } from 'lucide-react';
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
  const [errors, setErrors] = useState<PlayerErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  // X4.4 — dual-run
  const [dualSummary, setDualSummary] = useState<BehaviorDualRunSummary | null>(null);
  const [dualCompare, setDualCompare] = useState<BehaviorComparisonV1V2Row[]>([]);
  const [dualBusy, setDualBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q, e, ds, dc] = await Promise.all([
        adminPlaybackEventSummary(days),
        adminListEventQualityIssues(Math.max(days, 7), 200),
        adminRecentPlayerErrors(Math.max(days, 7), 50),
        adminBehaviorDualRunSummary(30),
        adminCompareBehaviorV1V2(30),
      ]);
      setSummary(s);
      setIssues(q);
      setErrors(e);
      setDualSummary(ds);
      setDualCompare(dc);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days]);

  const recomputeV2 = async () => {
    if (!confirm('playback_events_v2 기반으로 모든 트랙 behavior_score_v2 재계산? (v1 변경 없음)')) return;
    setDualBusy(true);
    try {
      const r = await adminRecomputeBehaviorV2(30);
      toast.success(`v2 ${r.rows_upserted} 행 (${(r.elapsed_ms / 1000).toFixed(1)}s)`);
      await load();
    } catch (e) {
      toast.error(`v2 재계산 실패: ${(e as Error).message}`);
    } finally { setDualBusy(false); }
  };

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

          {/* X4.3.1 — 신규 이벤트 타입 강조 카드 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="like" v={summary.by_event_type?.like ?? 0} />
            <Stat label="unlike" v={summary.by_event_type?.unlike ?? 0} />
            <Stat label="replay" v={summary.by_event_type?.replay ?? 0} />
            <Stat label="player_error" v={summary.by_event_type?.player_error ?? 0} />
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
                        <span className={k === '(null)' ? 'text-rose-300' : ''}>{k}</span>
                        <span className="font-bold tabular-nums">{v}</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-dim">데이터 없음.</p>
              )}
              {summary.null_store_slug_pct != null && summary.null_store_slug_pct > 0 && (
                <p className="mt-2 text-[11px] text-amber-300">
                  ⚠️ store_type_slug null: {summary.null_store_slug_pct}%
                </p>
              )}
            </div>

            <div className="rounded-xl bg-bg-card p-3">
              <h4 className="mb-2 text-xs font-bold">데이터 품질 신호</h4>
              <ul className="space-y-1.5 text-xs">
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>muted 재생</span>
                  <span className={summary.muted_events > 0 ? 'font-bold text-amber-300' : 'text-ink-mute'}>
                    {summary.muted_events}
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>volume_low 재생</span>
                  <span className={summary.volume_low_events > 0 ? 'font-bold text-amber-300' : 'text-ink-mute'}>
                    {summary.volume_low_events}
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>track_duration_seconds null</span>
                  <span className={(summary.null_duration_pct ?? 0) > 10 ? 'font-bold text-rose-300' : 'text-ink-mute'}>
                    {summary.null_duration_pct ?? 0}%
                  </span>
                </li>
                <li className="flex justify-between rounded bg-bg-deep px-2 py-1">
                  <span>store_type_slug null</span>
                  <span className={(summary.null_store_slug_pct ?? 0) > 10 ? 'font-bold text-rose-300' : 'text-ink-mute'}>
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
          <AlertTriangle size={12} className="text-amber-300" />
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
                  <span key={k} className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-300">
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
                        <span className="rounded bg-amber-500/25 px-1.5 font-bold text-amber-300">
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

      {/* X4.3.1 — player_error 상세 리스트 */}
      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
          <AlertTriangle size={12} className="text-rose-300" />
          player_error 최근 목록 ({errors.length})
        </h4>
        {errors.length === 0 ? (
          <p className="text-xs text-ink-dim">player_error 이벤트 없음.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded bg-bg-deep">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-2 py-1.5">시각</th>
                  <th className="px-2 py-1.5">track / session</th>
                  <th className="px-2 py-1.5">user/anon</th>
                  <th className="px-2 py-1.5">device / browser</th>
                  <th className="px-2 py-1.5">code</th>
                  <th className="px-2 py-1.5">evidence</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id} className="border-b border-line/10">
                    <td className="px-2 py-1 text-[10px] text-ink-dim">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-2 py-1">
                      <div className="text-[10px]">{e.track_id?.slice(0, 8) ?? '—'}…</div>
                      <div className="text-[10px] text-ink-dim">{e.session_id?.slice(0, 10) ?? '—'}…</div>
                    </td>
                    <td className="px-2 py-1 text-[10px] text-ink-dim">{e.user_or_anon.slice(0, 12)}…</td>
                    <td className="px-2 py-1 text-[10px] text-ink-mute">
                      {e.device_type ?? '—'} · {e.browser ?? '—'} · {e.os ?? '—'}
                    </td>
                    <td className="px-2 py-1">
                      <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                        {(e.evidence_json as { code_name?: string })?.code_name ?? '?'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <details>
                        <summary className="cursor-pointer text-[10px] text-ink-mute">
                          {(e.evidence_json as { message?: string })?.message?.slice(0, 30) ?? 'detail'}…
                        </summary>
                        <pre className="mt-1 max-w-md whitespace-pre-wrap break-all text-[10px] text-ink-dim">
                          {JSON.stringify(e.evidence_json, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* X4.4 — Behavior v1/v2 Dual-Run 비교 */}
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold">Behavior v1 vs v2 비교 (Dual-Run, window 30d)</h4>
          <button onClick={() => void recomputeV2()} disabled={dualBusy}
            className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-bold text-black disabled:opacity-50">
            <Calculator size={11} className={dualBusy ? 'animate-spin' : ''} /> v2 재계산
          </button>
        </div>
        {dualSummary && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div className="rounded bg-bg-deep p-2">
                <div className="text-[10px] text-ink-dim">v1 rows</div>
                <div className="text-xl font-bold">{dualSummary.v1_rows}</div>
              </div>
              <div className="rounded bg-bg-deep p-2">
                <div className="text-[10px] text-ink-dim">v2 rows</div>
                <div className="text-xl font-bold">{dualSummary.v2_rows}</div>
              </div>
              <div className="rounded bg-bg-deep p-2">
                <div className="text-[10px] text-ink-dim">both</div>
                <div className="text-xl font-bold text-emerald-300">{dualSummary.both_rows}</div>
              </div>
              <div className="rounded bg-bg-deep p-2">
                <div className="text-[10px] text-ink-dim">avg |score Δ|</div>
                <div className="text-xl font-bold">{dualSummary.avg_score_delta ?? '—'}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {dualSummary.drift_high_count > 0 && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 font-bold text-rose-300">score Δ≥10: {dualSummary.drift_high_count}</span>}
              {dualSummary.completion_drift_count > 0 && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-300">완료 Δ≥0.2: {dualSummary.completion_drift_count}</span>}
              {dualSummary.skip_drift_count > 0 && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-300">skip Δ≥0.2: {dualSummary.skip_drift_count}</span>}
              {dualSummary.play_count_drift_count > 0 && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-300">plays Δ≥30%: {dualSummary.play_count_drift_count}</span>}
              {dualSummary.v2_missing_count > 0 && <span className="rounded bg-gray-500/15 px-1.5 py-0.5 font-bold text-gray-400">v2 missing: {dualSummary.v2_missing_count}</span>}
              {dualSummary.v1_missing_count > 0 && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-bold text-blue-500">v1 missing: {dualSummary.v1_missing_count}</span>}
            </div>
            <p className="mt-2 text-[11px] text-ink-dim">
              <b>Cutover 조건</b>: v2 이벤트 7일+ 누적 / track당 평균 play_count 충분 / drift_high 원인 확인 / like·replay·player_error 정상 누적.
              현재 {dualSummary.both_rows < 10 ? '⚠️ both_rows 부족 — cutover 불가' : dualSummary.drift_high_count > dualSummary.both_rows * 0.3 ? '⚠️ drift 비율 30% 초과 — cutover 불가' : '✓ cutover 검토 가능'}.
            </p>
          </>
        )}

        {dualCompare.length > 0 && (
          <div className="mt-3 max-h-96 overflow-y-auto rounded bg-bg-deep">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-bg-card">
                <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <th className="px-2 py-1.5">곡</th>
                  <th className="px-2 py-1.5 text-right">v1 plays</th>
                  <th className="px-2 py-1.5 text-right">v2 plays</th>
                  <th className="px-2 py-1.5 text-right">v1 comp</th>
                  <th className="px-2 py-1.5 text-right">v2 comp</th>
                  <th className="px-2 py-1.5 text-right">v1 skip</th>
                  <th className="px-2 py-1.5 text-right">v2 skip</th>
                  <th className="px-2 py-1.5 text-right">v1 score</th>
                  <th className="px-2 py-1.5 text-right">v2 score</th>
                  <th className="px-2 py-1.5 text-right">Δ</th>
                  <th className="px-2 py-1.5">flags</th>
                </tr>
              </thead>
              <tbody>
                {dualCompare.slice(0, 100).map((r, idx) => (
                  <tr key={`${r.track_id}-${idx}`} className="border-b border-line/10">
                    <td className="px-2 py-1">
                      <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                      <div className="text-[10px] text-ink-dim">{r.artist ?? ''}</div>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.v1_play_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.v2_play_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-mute">{(r.v1_completion_rate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{(r.v2_completion_rate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-mute">{(r.v1_skip_rate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{(r.v2_skip_rate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink-mute">{r.v1_behavior_score.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.v2_behavior_score.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      <span className={Math.abs(r.score_delta) >= 10 ? 'font-bold text-rose-300' : ''}>
                        {r.score_delta > 0 ? '+' : ''}{r.score_delta.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex flex-wrap gap-1">
                        {r.issue_flags.map((f) => (
                          <span key={f} className={`rounded px-1 text-[10px] font-bold ${f.includes('missing') ? 'bg-gray-500/20 text-gray-400' : 'bg-amber-500/25 text-amber-300'}`}>
                            {f}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dualCompare.length > 100 && (
              <p className="px-2 py-1 text-[10px] text-ink-dim">… 처음 100건만 표시 (총 {dualCompare.length})</p>
            )}
          </div>
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
