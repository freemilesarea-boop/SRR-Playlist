import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, AlertOctagon } from 'lucide-react';
import {
  adminAbuseSummary,
  adminListAbuseCandidates,
  type AbuseSummary,
  type AbuseCandidateRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '오늘' },
  { value: 7, label: '최근 7일' },
  { value: 30, label: '최근 30일' },
];

export default function AbuseMonitorTab() {
  const [days, setDays] = useState<number>(7);
  const [minRaw, setMinRaw] = useState<number>(10);
  const [minExcluded, setMinExcluded] = useState<number>(7);
  const [summary, setSummary] = useState<AbuseSummary | null>(null);
  const [rows, setRows] = useState<AbuseCandidateRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        adminAbuseSummary(days),
        adminListAbuseCandidates(days, minRaw, minExcluded, 500),
      ]);
      setSummary(sum);
      setRows(list);
    } catch (e) {
      toast.error(`어뷰징 로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [days, minRaw, minExcluded]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1 text-sm font-bold">
            <ShieldAlert size={14} className="text-rose-300" /> 어뷰징 모니터 (X6.0)
          </h3>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          KST 기준 하루 동일 user × track 최대 <b>3회</b> 유효. 초과분은 <b className="text-rose-300">daily_user_track_cap</b> 으로 표시되며 차트/정산/추천 집계에서 제외됨.
          원본 row 는 보존됨 (삭제 안 함).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">기간:</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setDays(opt.value)}
            className={`rounded-full px-3 py-1 font-semibold ${days === opt.value ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:bg-bg-hover'}`}>
            {opt.label}
          </button>
        ))}
        <span className="ml-3 font-bold">raw ≥</span>
        <input type="number" value={minRaw} onChange={(e) => setMinRaw(Math.max(1, Number(e.target.value) || 10))}
          className="w-16 rounded bg-bg-deep px-2 py-1" />
        <span className="font-bold">또는 excluded ≥</span>
        <input type="number" value={minExcluded} onChange={(e) => setMinExcluded(Math.max(1, Number(e.target.value) || 7))}
          className="w-16 rounded bg-bg-deep px-2 py-1" />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="raw" v={summary.total_raw_streams} />
          <Stat label="effective" v={summary.total_effective_streams} tone="text-emerald-300" />
          <Stat label="excluded by cap" v={summary.total_excluded_by_cap} tone="text-rose-300" />
          <Stat label="유저 (cap hit)" v={summary.distinct_users_affected} />
          <Stat label="곡 (cap hit)" v={summary.distinct_tracks_affected} />
          <Stat label="user×track×day cap" v={summary.distinct_user_track_day_caps} tone="text-amber-300" />
        </div>
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
          <AlertOctagon size={11} className="text-rose-300" /> 어뷰징 후보
          <span className="text-ink-dim font-normal">({rows.length}건)</span>
        </h4>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink-dim">
            {loading ? '로딩 중…' : '후보 없음 (정책 임계값 이하)'}
          </p>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-bg-card text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="px-1.5 py-1">date_kst</th>
                  <th className="px-1.5 py-1">user</th>
                  <th className="px-1.5 py-1">track</th>
                  <th className="px-1.5 py-1 text-right">raw</th>
                  <th className="px-1.5 py-1 text-right">effective</th>
                  <th className="px-1.5 py-1 text-right">excluded</th>
                  <th className="px-1.5 py-1">reason</th>
                  <th className="px-1.5 py-1">last_played_at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.user_id}:${r.track_id}:${r.date_kst}:${i}`}
                    className="border-b border-line/5">
                    <td className="px-1.5 py-1 font-mono">{r.date_kst}</td>
                    <td className="px-1.5 py-1 max-w-[180px]">
                      <div className="truncate" title={r.user_email ?? r.user_id}>
                        {r.user_email ?? r.user_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-1.5 py-1 max-w-[220px]">
                      <div className="truncate font-semibold" title={r.track_title ?? r.track_id}>
                        {r.track_title ?? '(제목없음)'}
                      </div>
                      <div className="truncate text-ink-dim" title={r.artist ?? ''}>
                        {r.artist ?? '—'}
                      </div>
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{r.raw_plays}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-emerald-300">
                      {r.effective_plays}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-rose-300 font-bold">
                      {r.excluded_plays}
                    </td>
                    <td className="px-1.5 py-1 font-mono text-rose-300/80">
                      {r.excluded_reason ?? '—'}
                    </td>
                    <td className="px-1.5 py-1 text-ink-dim">
                      {r.last_played_at ? new Date(r.last_played_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        정책: KST 동일 user_id + track_id + 날짜 = 하루 3회까지만 유효. 차트/정산/추천/행동 점수 모두 적용됨.
        playback_events 원본은 보존 — excluded 표시만.
      </p>
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg-card p-3 text-center ring-1 ring-line/10">
      <div className={`text-lg font-extrabold tabular-nums ${tone ?? ''}`}>{v}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}
