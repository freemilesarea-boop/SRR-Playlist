/**
 * AudioDistributionStatsCard — 음원 검수/유통 KPI (X6.31)
 *
 * 위치: TrackReviewList 상단 (관리자 > 음원 검수 탭 진입 시 첫 화면)
 *
 * 표시:
 *   - 7개 KPI: 총 등록, 검수 대기, 검수 통과, 유통, 탈락, 반려율, 유통률
 *   - 기간 프리셋: 전체 / 이번 달 / 지난달 / 사용자 지정
 *   - 아티스트 선택 (선택사항)
 *   - 반려 사유 상위 10건 (free text — 카테고리화 없이 그대로)
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import {
  fetchAudioDistributionStats,
  fetchTrackArtistOwners,
  type AudioDistributionStats,
  type TrackArtistOwner,
} from '@/lib/audioDistributionStatsApi';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

type RangePreset = 'all' | 'this_month' | 'last_month' | 'custom';

function kstMonthBounds(month: string): { start: string; end: string } {
  // month = 'YYYY-MM' → KST 1일 00:00 ~ 다음 달 1일 00:00 (ISO)
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  // KST = UTC+9, KST 자정의 UTC 시각
  const startUtcMs = Date.UTC(y, m - 1, 1) - 9 * 3600 * 1000;
  const endUtcMs = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 9 * 3600 * 1000;
  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(endUtcMs).toISOString(),
  };
}

function currentKstMonth(): string {
  const now = new Date();
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now);
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit' }).format(now);
  return `${y}-${m}`;
}

function lastKstMonth(): string {
  const cur = currentKstMonth();
  const [y, m] = cur.split('-').map((n) => parseInt(n, 10));
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

export default function AudioDistributionStatsCard() {
  const [preset, setPreset] = useState<RangePreset>('all');
  const [customMonth, setCustomMonth] = useState<string>(currentKstMonth());
  const [artistFilter, setArtistFilter] = useState<string>(''); // owner_user_id (빈 문자열 = 전체)
  const [data, setData] = useState<AudioDistributionStats | null>(null);
  const [owners, setOwners] = useState<TrackArtistOwner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const window = useMemo(() => {
    if (preset === 'all') return { start: null as string | null, end: null as string | null };
    if (preset === 'this_month') return kstMonthBounds(currentKstMonth());
    if (preset === 'last_month') return kstMonthBounds(lastKstMonth());
    return kstMonthBounds(customMonth);
  }, [preset, customMonth]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const stats = await fetchAudioDistributionStats(
        window.start,
        window.end,
        artistFilter || null,
      );
      setData(stats);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customMonth, artistFilter]);

  useEffect(() => {
    fetchTrackArtistOwners()
      .then(setOwners)
      .catch(() => {
        /* owner 목록 fetch 실패해도 KPI 자체는 살아있음 */
      });
  }, []);

  const periodLabel = useMemo(() => {
    if (preset === 'all') return '전체 기간';
    if (preset === 'this_month') return `이번 달 (${currentKstMonth()}) KST`;
    if (preset === 'last_month') return `지난달 (${lastKstMonth()}) KST`;
    return `${customMonth} KST`;
  }, [preset, customMonth]);

  return (
    <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold tracking-tight">음원 검수/유통 현황</h3>
          <p className="text-[11px] text-ink-mute">
            {periodLabel}
            {artistFilter && owners.length > 0 && (
              <>
                {' · '}
                {owners.find((o) => o.owner_user_id === artistFilter)?.nickname || artistFilter.slice(0, 8)}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-bg-soft p-0.5 text-[11px] ring-1 ring-line/10">
            {(['all', 'this_month', 'last_month', 'custom'] as RangePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  preset === p ? 'bg-accent text-black' : 'text-ink-mute hover:text-ink'
                }`}
              >
                {p === 'all' ? '전체' : p === 'this_month' ? '이번 달' : p === 'last_month' ? '지난달' : '월 지정'}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <input
              type="month"
              value={customMonth}
              onChange={(e) => setCustomMonth(e.target.value || currentKstMonth())}
              className="input w-auto text-xs"
            />
          )}
          <select
            value={artistFilter}
            onChange={(e) => setArtistFilter(e.target.value)}
            className="input w-auto text-xs"
            title="아티스트 필터 (트랙 보유자)"
          >
            <option value="">전체 아티스트</option>
            {owners.map((o) => (
              <option key={o.owner_user_id} value={o.owner_user_id}>
                {(o.nickname || o.email || o.owner_user_id.slice(0, 8))} ({o.track_count})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2 py-1 text-[10px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50"
            title="새로고침"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="통계 조회 실패">
          <pre className="whitespace-pre-wrap break-all text-[11px]">{error}</pre>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="총 등록 요청" value={data?.total_submitted ?? 0} unit="곡" tone="ink" />
        <Kpi label="검수 대기" value={data?.pending_review ?? 0} unit="곡" tone="yellow" />
        <Kpi label="검수 통과" value={data?.approved ?? 0} unit="곡" tone="sky" />
        <Kpi label="총 유통" value={data?.distributed ?? 0} unit="곡" tone="emerald" />
        <Kpi label="총 탈락" value={data?.rejected ?? 0} unit="곡" tone="red" />
        <Kpi label="반려율" value={data?.rejection_rate_pct ?? 0} unit="%" tone="red" decimal />
        <Kpi label="유통률" value={data?.distribution_rate_pct ?? 0} unit="%" tone="emerald" decimal />
      </div>

      {data && data.rejection_breakdown.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowBreakdown((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-mute hover:text-ink"
          >
            {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            반려 사유 상위 ({data.rejection_breakdown.length}) — 운영 입력값 그대로
          </button>
          {showBreakdown && (
            <ul className="mt-2 space-y-0.5 rounded-lg bg-bg-soft px-3 py-2 text-[11px]">
              {data.rejection_breakdown.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 border-b border-line/10 py-1 last:border-b-0">
                  <span className="truncate text-ink-mute" title={r.reason}>{r.reason}</span>
                  <span className="shrink-0 font-mono font-semibold text-ink">{r.n.toLocaleString()}곡</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="flex items-center gap-1 text-[10px] text-ink-dim">
        <AlertCircle size={10} />
        대기 = draft/submitted/review_pending · 통과 = approved/scheduled/released · 유통 = released+released_at · 탈락 = rejected/removed
      </p>
    </div>
  );
}

function Kpi({
  label, value, unit, tone, decimal,
}: {
  label: string; value: number; unit: string;
  tone: 'ink' | 'yellow' | 'sky' | 'emerald' | 'red';
  decimal?: boolean;
}) {
  const toneClass: Record<typeof tone, string> = {
    ink: 'text-ink',
    yellow: 'text-yellow-700 dark:text-yellow-300',
    sky: 'text-sky-200 dark:text-sky-300',
    emerald: 'text-emerald-200 dark:text-emerald-300',
    red: 'text-rose-200 dark:text-red-300',
  };
  const formatted = decimal ? value.toFixed(1) : value.toLocaleString();
  return (
    <div className="rounded-lg bg-bg-soft px-2.5 py-2 ring-1 ring-line/10">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-bold ${toneClass[tone]}`}>
        {formatted}
        <span className="ml-0.5 text-[10px] font-normal text-ink-dim">{unit}</span>
      </p>
    </div>
  );
}
