import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Activity, AlertOctagon, Store, Music, AlertTriangle, ChevronRight } from 'lucide-react';
import {
  adminListActiveBusinesses,
  adminBusinessLiveDetail,
  type ActiveBusinessRow,
  type BusinessLiveDetail,
} from '@/lib/adminBusinessLiveApi';
import { toast } from '@/store/toastStore';

const WINDOW_OPTIONS = [
  { minutes: 10, label: '10분' },
  { minutes: 30, label: '30분' },
  { minutes: 60, label: '1시간' },
  { minutes: 360, label: '6시간' },
  { minutes: 1440, label: '24시간' },
];

const EVENT_TONE: Record<string, string> = {
  play_start: 'bg-emerald-500/25 text-emerald-300',
  play_complete: 'bg-emerald-500/25 text-emerald-300',
  play_25: 'bg-sky-500/25 text-sky-300',
  play_50: 'bg-sky-500/25 text-sky-300',
  play_75: 'bg-sky-500/20 text-sky-300',
  skip: 'bg-amber-500/25 text-amber-300',
  player_error: 'bg-rose-500/20 text-rose-300',
  muted: 'bg-ink/15 text-ink-mute',
  volume_low: 'bg-ink/10 text-ink-mute',
  like: 'bg-pink-500/15 text-pink-500',
  unlike: 'bg-pink-500/10 text-pink-500/70',
  replay: 'bg-violet-500/15 text-violet-500',
};

const NULL_BUSINESS_ID = '00000000-0000-0000-0000-000000000000';

export default function BusinessLivePanel() {
  const [windowMin, setWindowMin] = useState<number>(60);
  const [businesses, setBusinesses] = useState<ActiveBusinessRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BusinessLiveDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const rows = await adminListActiveBusinesses(windowMin, 100);
      setBusinesses(rows);
      if (!selected && rows.length > 0) setSelected(rows[0].business_id);
    } catch (e) {
      toast.error(`매장 목록 로딩 실패: ${(e as Error).message}`);
    } finally { setLoadingList(false); }
  }, [windowMin, selected]);

  const loadDetail = useCallback(async () => {
    if (selected === null) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const businessId = selected === NULL_BUSINESS_ID ? null : selected;
      const d = await adminBusinessLiveDetail(businessId, windowMin);
      setDetail(d);
    } catch (e) {
      toast.error(`매장 상세 로딩 실패: ${(e as Error).message}`);
    } finally { setLoadingDetail(false); }
  }, [selected, windowMin]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void loadList();
      void loadDetail();
    }, 15000);
    return () => clearInterval(id);
  }, [autoRefresh, loadList, loadDetail]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-bold">
            <Activity size={14} className="text-emerald-300" /> 매장 실시간 진단 (X6.0.1)
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span>15초 자동 새로고침</span>
            </label>
            <button onClick={() => { void loadList(); void loadDetail(); }}
              disabled={loadingList || loadingDetail}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loadingList || loadingDetail ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          사업자 "음악이 안 나와요" 신고 시 즉시 진단. playback_events_v2 기반.
          오른쪽에서 매장 선택, 최근 이벤트 / TOP 곡 / 에러 로그 확인.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">기간:</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button key={opt.minutes} onClick={() => setWindowMin(opt.minutes)}
            className={`rounded-full px-3 py-1 font-semibold ${windowMin === opt.minutes ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:bg-bg-hover'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        {/* 매장 목록 */}
        <div className="rounded-xl bg-bg-card p-3">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold">
            <Store size={11} /> 활동 매장 ({businesses.length})
          </h3>
          {businesses.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-ink-dim">
              {loadingList ? '로딩…' : `최근 ${windowMin}분 활동 없음`}
            </p>
          ) : (
            <ul className="max-h-[600px] space-y-1 overflow-y-auto text-[11px]">
              {businesses.map((b) => {
                const isAnon = b.business_id === NULL_BUSINESS_ID;
                const isSelected = selected === b.business_id;
                return (
                  <li key={`${b.business_id}:${b.store_type_slug ?? ''}`}>
                    <button onClick={() => setSelected(b.business_id)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left ${isSelected ? 'bg-accent/20 ring-1 ring-accent' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">
                          {isAnon ? '(익명/비등록)' : (b.store_name ?? b.business_id.slice(0, 8))}
                        </div>
                        <div className="truncate text-ink-dim">
                          {b.store_type_slug ?? b.business_type ?? '—'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold tabular-nums">{b.recent_events}</div>
                        <div className="flex gap-1 text-[10px] text-ink-dim">
                          {b.skips > 0 && <span className="text-amber-300">스킵{b.skips}</span>}
                          {b.errors > 0 && <span className="text-rose-300">err{b.errors}</span>}
                        </div>
                      </div>
                      <ChevronRight size={10} className="shrink-0 text-ink-dim" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 매장 상세 */}
        <div className="space-y-3">
          {!detail ? (
            <div className="rounded-xl bg-bg-card p-6 text-center text-[11px] text-ink-dim">
              {loadingDetail ? '로딩…' : '왼쪽에서 매장 선택'}
            </div>
          ) : (
            <>
              {/* 매장 정보 + 요약 */}
              <div className="rounded-xl bg-bg-card p-3">
                <h4 className="mb-2 text-xs font-bold">
                  {(detail.business as { store_name?: string } | null)?.store_name ?? '(익명/비등록 매장)'}
                  {detail.business_id && <span className="ml-2 font-mono text-[10px] text-ink-dim">{detail.business_id.slice(0, 8)}</span>}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <Stat label="총 이벤트" v={detail.summary.total_events} />
                  <Stat label="세션" v={detail.summary.unique_sessions} />
                  <Stat label="재생 곡" v={detail.summary.unique_tracks} />
                  <Stat label="플리" v={detail.summary.unique_playlists} />
                </div>
                {Object.keys(detail.summary.event_breakdown ?? {}).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(detail.summary.event_breakdown).map(([t, n]) => (
                      <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${EVENT_TONE[t] ?? 'bg-ink/5 text-ink-dim'}`}>
                        {t} {n}
                      </span>
                    ))}
                  </div>
                )}
                {detail.summary.last_event_at && (
                  <p className="mt-1 text-[10px] text-ink-dim">
                    마지막 이벤트: {new Date(detail.summary.last_event_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </p>
                )}
              </div>

              {/* 에러 (있을 때만) */}
              {detail.errors.length > 0 && (
                <div className="rounded-xl bg-rose-500/5 p-3 ring-1 ring-rose-500/50">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-bold text-rose-300">
                    <AlertOctagon size={11} /> player_error ({detail.errors.length})
                  </h4>
                  <ul className="space-y-1 text-[11px]">
                    {detail.errors.slice(0, 10).map((err, i) => (
                      <li key={`${err.session_id}:${i}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {err.track_title ?? '(곡 미상)'} <span className="text-ink-dim">· {err.device_type ?? ''} {err.browser ?? ''}</span>
                        </span>
                        <span className="shrink-0 font-mono text-ink-dim">
                          {new Date(err.created_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* TOP 곡 */}
              <div className="rounded-xl bg-bg-card p-3">
                <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
                  <Music size={11} /> 자주 재생된 곡 ({detail.top_tracks.length})
                </h4>
                {detail.top_tracks.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-ink-dim">데이터 없음</p>
                ) : (
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-ink-dim">
                      <tr><th className="px-1 py-1">곡</th><th className="px-1 py-1 text-right">plays</th><th className="px-1 py-1 text-right">skip%</th></tr>
                    </thead>
                    <tbody>
                      {detail.top_tracks.map((t) => (
                        <tr key={t.track_id} className="border-b border-line/5">
                          <td className="px-1 py-1 max-w-[260px]">
                            <div className="truncate font-semibold">{t.title ?? '(제목없음)'}</div>
                            <div className="truncate text-ink-dim">{t.artist ?? ''}</div>
                          </td>
                          <td className="px-1 py-1 text-right tabular-nums">{t.plays}</td>
                          <td className={`px-1 py-1 text-right tabular-nums ${(t.skip_rate ?? 0) >= 50 ? 'text-rose-300 font-bold' : (t.skip_rate ?? 0) >= 25 ? 'text-amber-300' : ''}`}>
                            {t.skip_rate != null ? `${t.skip_rate}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 최근 이벤트 */}
              <div className="rounded-xl bg-bg-card p-3">
                <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
                  <AlertTriangle size={11} /> 최근 이벤트 ({detail.recent_events.length})
                </h4>
                {detail.recent_events.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-ink-dim">데이터 없음</p>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-bg-card text-ink-dim">
                        <tr>
                          <th className="px-1 py-1">시간</th>
                          <th className="px-1 py-1">이벤트</th>
                          <th className="px-1 py-1">곡</th>
                          <th className="px-1 py-1">플리</th>
                          <th className="px-1 py-1 text-right">완성%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.recent_events.map((e, i) => (
                          <tr key={`${e.session_id}:${e.created_at}:${i}`} className="border-b border-line/5">
                            <td className="px-1 py-1 font-mono text-ink-dim">
                              {new Date(e.created_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}
                            </td>
                            <td className="px-1 py-1">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${EVENT_TONE[e.event_type] ?? 'bg-ink/5'}`}>
                                {e.event_type}
                              </span>
                            </td>
                            <td className="px-1 py-1 max-w-[180px] truncate" title={e.track_title ?? ''}>
                              {e.track_title ?? '—'}
                            </td>
                            <td className="px-1 py-1 max-w-[140px] truncate text-ink-dim" title={e.playlist_title ?? ''}>
                              {e.playlist_title ?? '—'}
                            </td>
                            <td className="px-1 py-1 text-right tabular-nums">
                              {e.completion_percent != null ? `${Math.round(e.completion_percent)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded bg-bg-deep p-2 text-center">
      <div className="text-base font-extrabold tabular-nums">{v}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}
