import { useCallback, useEffect, useState } from 'react';
import { Headphones, Play, CheckCircle, Clock, Users, Music, ShieldCheck, ShieldOff, CalendarRange, Coins, Wallet } from 'lucide-react';
import { fetchTrackAnalytics, type TrackAnalytics } from '@/lib/adminApi';
import {
  adminStreamingOverview, adminTopStreamingTracks,
  adminStreamingExclusionBreakdown,
  adminGetMonthlyStreamingSummary,
  getAdminSetting, setAdminSetting,
  type AdminStreamingDay, type AdminTopTrackRow,
  type StreamingExclusionBreakdown,
  type MonthlyStreamingSummary,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';
import AudioHealthPanel from './AudioHealthPanel';

const RANGES = [
  { key: 1, label: '오늘' },
  { key: 7, label: '7일' },
  { key: 30, label: '30일' },
];

function fmtAvgSec(s: number): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function StreamingAnalytics() {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<TrackAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminError | null>(null);
  // 0078 — 정산 기준 분석 (raw / eligible / excluded)
  const [overview, setOverview] = useState<AdminStreamingDay[]>([]);
  const [topTracks, setTopTracks] = useState<AdminTopTrackRow[]>([]);
  const [eligLoading, setEligLoading] = useState(true);
  const [eligError, setEligError] = useState<string | null>(null);
  // 0087 — 제외 사유별 breakdown
  const [breakdown, setBreakdown] = useState<StreamingExclusionBreakdown | null>(null);
  // 0088 — 24h cap 설정값 (admin_settings.stream_daily_user_track_cap)
  const [capValue, setCapValue] = useState<number>(3);
  const [capInput, setCapInput] = useState<string>('3');
  const [capBusy, setCapBusy] = useState(false);

  const loadCap = useCallback(async () => {
    try {
      const v = await getAdminSetting<number>('stream_daily_user_track_cap');
      const n = typeof v === 'number' && v > 0 ? v : 3;
      setCapValue(n);
      setCapInput(String(n));
    } catch {
      // admin guard 차단 등 — fallback
    }
  }, []);

  useEffect(() => { void loadCap(); }, [loadCap]);

  async function onSaveCap() {
    const n = Number(capInput);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      toast.error('1~100 사이 정수만 입력 가능합니다');
      return;
    }
    setCapBusy(true);
    try {
      await setAdminSetting('stream_daily_user_track_cap', n);
      setCapValue(n);
      toast.success(`24시간 반복 제한값 ${n}회로 변경 — 이후 신규 이벤트부터 적용`);
    } catch (e) {
      toast.error('변경 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCapBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchTrackAnalytics(days));
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  const loadEligible = useCallback(async () => {
    setEligLoading(true);
    setEligError(null);
    try {
      const [ov, top, bd] = await Promise.all([
        adminStreamingOverview(days),
        adminTopStreamingTracks(days, 20),
        adminStreamingExclusionBreakdown(days),
      ]);
      setOverview(ov);
      setTopTracks(top);
      setBreakdown(bd);
    } catch (e) {
      setEligError(e instanceof Error ? e.message : String(e));
    } finally {
      setEligLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadEligible();
  }, [loadEligible]);

  if (error) return <AdminErrorState error={error} onRetry={load} />;

  const totalPlays = rows.reduce((s, r) => s + Number(r.plays), 0);
  const totalCompletes = rows.reduce((s, r) => s + Number(r.completes), 0);
  // 평균 재생시간: 재생이 있었던(plays>0) 트랙들만으로 분자·분모를 일치시킨다.
  // (기존: 분자는 전체 합, 분모는 plays>0 개수 → 평균이 왜곡되고 0건일 때 NaN)
  const playedRows = rows.filter((r) => r.plays > 0);
  const avgSeconds = playedRows.length
    ? playedRows.reduce((s, r) => s + Number(r.avg_seconds), 0) / playedRows.length
    : 0;
  const completionRate = totalPlays > 0 ? (totalCompletes / totalPlays) * 100 : 0;

  // 0078 — 정산 기준 집계
  const sumRaw = overview.reduce((s, d) => s + Number(d.total_streams), 0);
  const sumEligible = overview.reduce((s, d) => s + Number(d.eligible_streams), 0);
  const sumExcluded = sumRaw - sumEligible;
  const eligibleRatio = sumRaw > 0 ? (sumEligible / sumRaw) * 100 : 0;
  const sumListeners = overview.reduce((s, d) => s + Number(d.unique_listeners), 0);
  const sumTracks = overview.reduce((m, d) => Math.max(m, Number(d.unique_tracks)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">스트리밍 분석</h2>
          <p className="text-xs text-ink-mute">정산 기준 + 곡별 재생/완료 통계</p>
        </div>
        <div className="flex rounded-full bg-bg-card p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setDays(r.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                days === r.key ? 'bg-accent text-black' : 'text-ink-mute hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ============================================ */}
      {/* 0119 — 이번 달 스트리밍 정산 요약 (월간 총합) */}
      {/* ============================================ */}
      <MonthlySettlementSummary />

      {/* ============================================ */}
      {/* 0078 — 정산 기준 분석 (raw / eligible / excluded) */}
      {/* ============================================ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold tracking-tight">정산 기준 스트리밍</h3>
          <span className="text-[10px] text-ink-dim">milestone_30s · eligible_for_payout 기준</span>
        </div>
        {eligError && (
          <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {eligError}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Summary icon={<Play size={14} />} label="raw milestone" value={sumRaw.toLocaleString()} />
          <Summary icon={<ShieldCheck size={14} />} label="eligible" value={sumEligible.toLocaleString()} tone="success" />
          <Summary icon={<ShieldOff size={14} />} label="제외분" value={sumExcluded.toLocaleString()} tone="warn" />
          <Summary icon={<CheckCircle size={14} />} label="eligible 비율" value={`${eligibleRatio.toFixed(1)}%`} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Summary icon={<Users size={14} />} label={`고유 청취자 (${days}d)`} value={sumListeners.toLocaleString()} />
          <Summary icon={<Music size={14} />} label="고유 트랙" value={sumTracks.toLocaleString()} />
          <Summary icon={<Clock size={14} />} label="기간" value={`${days}일`} />
        </div>

        {/* 일별 추이 */}
        <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
          <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-dim">
            일별 추이
          </div>
          {eligLoading && (
            <div className="p-6 text-center text-xs text-ink-mute">불러오는 중…</div>
          )}
          {!eligLoading && overview.length === 0 && (
            <div className="p-6 text-center text-xs text-ink-mute">
              아직 집계된 스트리밍 데이터가 없습니다.
            </div>
          )}
          {!eligLoading && overview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs">
                <thead className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 text-left">날짜</th>
                    <th className="px-3 py-2 text-right">raw</th>
                    <th className="px-3 py-2 text-right">eligible</th>
                    <th className="px-3 py-2 text-right">제외</th>
                    <th className="px-3 py-2 text-right">청취자</th>
                    <th className="px-3 py-2 text-right">트랙</th>
                    <th className="px-3 py-2 text-right">eligible %</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((d) => {
                    const raw = Number(d.total_streams);
                    const elig = Number(d.eligible_streams);
                    const excl = raw - elig;
                    const ratio = raw > 0 ? (elig / raw) * 100 : 0;
                    return (
                      <tr key={d.day} className="border-b border-line/10 last:border-b-0">
                        <td className="px-3 py-2 font-mono text-[11px]">{d.day}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{raw.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{elig.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-300">
                          {excl > 0 ? `-${excl.toLocaleString()}` : '0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(d.unique_listeners).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(d.unique_tracks).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{ratio.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 0087 — 제외 사유별 분석 */}
        <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-dim">
            <span>제외 사유별 분석 ({days}일)</span>
            <div className="flex flex-wrap items-center gap-2 normal-case tracking-normal text-ink-mute">
              {breakdown && (
                <span>
                  eligible {breakdown.total_eligible.toLocaleString()} · 제외 {breakdown.total_excluded.toLocaleString()}
                </span>
              )}
              {/* 0088 — 24h cap 설정 인풋 */}
              <label className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2 py-1 ring-1 ring-line/10">
                <span className="text-[10px] text-ink-dim">24h 반복 제한</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  className="w-12 bg-transparent text-center text-xs font-bold text-ink tabular-nums focus:outline-none"
                  aria-label="24시간 반복 제한값"
                />
                <span className="text-[10px] text-ink-dim">회</span>
                {Number(capInput) !== capValue && (
                  <button
                    type="button"
                    onClick={() => void onSaveCap()}
                    disabled={capBusy}
                    className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25 disabled:opacity-50"
                  >
                    {capBusy ? '저장 중…' : '저장'}
                  </button>
                )}
              </label>
            </div>
          </div>
          {eligLoading && (
            <div className="p-6 text-center text-xs text-ink-mute">불러오는 중…</div>
          )}
          {!eligLoading && breakdown && breakdown.total_excluded === 0 && (
            <div className="p-6 text-center text-xs text-ink-mute">
              제외된 스트림이 없어요. (해당 기간 모든 milestone 이 정산 대상)
            </div>
          )}
          {!eligLoading && breakdown && breakdown.total_excluded > 0 && (
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-7">
              <ReasonCard label="미공개" value={breakdown.unreleased} hint="release_status != released" tone="info" />
              <ReasonCard label="관리자 미리듣기" value={breakdown.admin_preview} hint="/admin* 페이지 재생" tone="info" />
              <ReasonCard label="아티스트 미리듣기" value={breakdown.artist_preview} hint="/artist* 페이지 재생" tone="info" />
              <ReasonCard label="셀프 재생" value={breakdown.self_play} hint="아티스트 본인 트랙" tone="warn" />
              <ReasonCard label="음소거 재생" value={breakdown.muted_play} hint="플레이어 음소거 상태" tone="warn" />
              <ReasonCard label="저음량 재생" value={breakdown.low_player_volume} hint="플레이어 볼륨 10% 미만" tone="warn" />
              <ReasonCard label="24시간 반복 제한" value={breakdown.daily_user_track_cap} hint={`같은 user+track 24h ${capValue}회 초과`} tone="error" />
            </div>
          )}
        </div>

        {/* TOP 트랙 */}
        <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
          <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-dim">
            TOP 트랙 ({days}일)
          </div>
          {eligLoading && (
            <div className="p-6 text-center text-xs text-ink-mute">불러오는 중…</div>
          )}
          {!eligLoading && topTracks.length === 0 && (
            <div className="p-6 text-center text-xs text-ink-mute">
              집계된 TOP 트랙이 없습니다.
            </div>
          )}
          {!eligLoading && topTracks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-xs">
                <thead className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">곡 제목</th>
                    <th className="px-3 py-2 text-left">아티스트</th>
                    <th className="px-3 py-2 text-right">raw</th>
                    <th className="px-3 py-2 text-right">eligible</th>
                    <th className="px-3 py-2 text-right">제외</th>
                    <th className="px-3 py-2 text-right">eligible %</th>
                  </tr>
                </thead>
                <tbody>
                  {topTracks.map((t) => {
                    const raw = Number(t.stream_count);
                    const elig = Number(t.eligible_count);
                    const excl = raw - elig;
                    const ratio = raw > 0 ? (elig / raw) * 100 : 0;
                    return (
                      <tr key={t.track_id} className="border-b border-line/10 last:border-b-0 hover:bg-bg-hover">
                        <td className="px-3 py-2 tabular-nums text-ink-dim">{t.rank}</td>
                        <td className="px-3 py-2 font-medium">{t.title}</td>
                        <td className="px-3 py-2 text-ink-mute">{t.artist ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{raw.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{elig.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-300">
                          {excl > 0 ? `-${excl.toLocaleString()}` : '0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{ratio.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* 0082 — 오디오 헬스 + 예약 발매 워커 */}
      <div className="border-t border-line/10 pt-4">
        <AudioHealthPanel />
      </div>

      <div className="border-t border-line/10 pt-4">
        <h3 className="text-sm font-bold tracking-tight">곡별 재생 / 완료 (legacy plays 기반)</h3>
        <p className="text-[10px] text-ink-dim">stream_events.event_type='start/complete' 기반 — 정산과 무관</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Summary icon={<Play size={14} />} label="총 재생" value={totalPlays.toLocaleString()} />
        <Summary icon={<CheckCircle size={14} />} label="완료" value={totalCompletes.toLocaleString()} />
        <Summary icon={<Clock size={14} />} label="평균 청취" value={fmtAvgSec(avgSeconds)} />
        <Summary icon={<Headphones size={14} />} label="완료율" value={`${completionRate.toFixed(1)}%`} />
      </div>

      {/* 곡별 테이블 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">곡 제목</th>
                <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
                <th className="px-3 py-2.5 text-right font-semibold">재생</th>
                <th className="px-3 py-2.5 text-right font-semibold">완료</th>
                <th className="px-3 py-2.5 text-right font-semibold">평균 청취</th>
                <th className="px-3 py-2.5 text-right font-semibold">마지막 재생</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.filter((r) => r.plays > 0).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-mute">
                    아직 재생된 곡이 없어요.
                  </td>
                </tr>
              )}
              {rows
                .filter((r) => r.plays > 0)
                .map((t) => (
                  <tr key={t.track_id} className="border-b border-line/10 hover:bg-bg-hover">
                    <td className="px-3 py-2.5 text-sm font-medium">{t.title}</td>
                    <td className="px-3 py-2.5 text-xs text-ink-mute">{t.artist ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums">{Number(t.plays).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-emerald-300">
                      {Number(t.completes).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-mute">
                      {fmtAvgSec(Number(t.avg_seconds))}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-dim">
                      {fmtDate(t.last_played_at)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Summary({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'warn';
}) {
  const valueClass =
    tone === 'success' ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'  ? 'text-amber-700 dark:text-amber-300'
    : '';
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
        {icon} {label}
      </div>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

/** KST 기준 이번 달 'YYYY-MM' */
function currentMonthKST(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' 에서 n개월 전/후 'YYYY-MM' */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function fmtKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString()}`;
}

/**
 * 0119 — 이번 달 스트리밍 정산 요약.
 * 기준: 해당 월 1일 00:00 ~ 말일 23:59:59 (Asia/Seoul). 정산 판단용 월간 총합.
 */
function MonthlySettlementSummary() {
  const thisMonth = currentMonthKST();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<MonthlyStreamingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminGetMonthlyStreamingSummary(`${month}-01`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastMonth = shiftMonth(thisMonth, -1);

  return (
    <section className="space-y-3 rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarRange size={16} className="text-accent" />
          <h3 className="text-sm font-bold tracking-tight">이번 달 스트리밍 정산 요약</h3>
          {data && (
            <span className="text-[10px] text-ink-dim">
              {data.month_start} ~ {data.month_end} · KST
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMonth(thisMonth)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              month === thisMonth ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:text-ink'
            }`}
          >
            이번 달
          </button>
          <button
            onClick={() => setMonth(lastMonth)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              month === lastMonth ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:text-ink'
            }`}
          >
            지난달
          </button>
          <input
            type="month"
            value={month}
            max={thisMonth}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="rounded-lg bg-bg-card px-2 py-1 text-xs ring-1 ring-line/10 focus:outline-none"
            aria-label="정산 기준 월 선택"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="h-24 animate-pulse rounded-xl bg-bg-card" />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Summary icon={<Play size={14} />} label="총 스트리밍" value={data.total_stream_count.toLocaleString()} />
            <Summary icon={<ShieldCheck size={14} />} label="정산 대상" value={data.eligible_stream_count.toLocaleString()} tone="success" />
            <Summary icon={<ShieldOff size={14} />} label="제외 스트리밍" value={data.excluded_stream_count.toLocaleString()} tone="warn" />
            <Summary icon={<Users size={14} />} label="참여 아티스트" value={data.unique_artists.toLocaleString()} />
            <Summary icon={<Music size={14} />} label="참여 음원" value={data.unique_tracks.toLocaleString()} />
            <Summary icon={<CheckCircle size={14} />} label="정산 풀 비율" value={`${(data.pool_revenue_ratio * 100).toFixed(0)}%`} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Summary icon={<Coins size={14} />} label="예상 정산 금액 (매출 × 풀)" value={fmtKRW(data.estimated_revenue)} tone="success" />
            <Summary icon={<Wallet size={14} />} label="지급 준비 정산액" value={fmtKRW(data.settlement_ready_amount)} />
          </div>
          <p className="text-[10px] leading-relaxed text-ink-dim">
            정산 대상 = milestone_30s · eligible_for_payout 기준. 예상 정산 금액 = 해당 월 결제 매출 × 정산 풀
            비율. 지급 준비 정산액 = 해당 월 정산건 중 지급 대상(payable/paid) 합계.
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * 0087 — 제외 사유별 분석 카드 (다섯 가지 reason 전용)
 */
function ReasonCard({
  label, value, hint, tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: 'info' | 'warn' | 'error';
}) {
  const toneClass =
    tone === 'error' ? 'bg-red-500/15 text-red-700 ring-red-400/30 dark:text-red-300'
    : tone === 'warn'  ? 'bg-amber-500/15 text-amber-700 ring-amber-400/30 dark:text-amber-300'
    : 'bg-sky-500/15 text-sky-700 ring-sky-400/30 dark:text-sky-300';
  return (
    <div className={`rounded-xl p-2.5 ring-1 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[9px] opacity-70" title={hint}>{hint}</p>
    </div>
  );
}
