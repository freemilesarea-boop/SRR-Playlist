import { useEffect, useState } from 'react';
import { Headphones, Play, CheckCircle, Clock } from 'lucide-react';
import { fetchTrackAnalytics, type TrackAnalytics } from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';

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

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTrackAnalytics(days)
      .then(setRows)
      .catch((e) => setError(classifyAdminError(e)))
      .finally(() => setLoading(false));
  }, [days]);

  if (error) return <AdminErrorState error={error} />;

  const totalPlays = rows.reduce((s, r) => s + Number(r.plays), 0);
  const totalCompletes = rows.reduce((s, r) => s + Number(r.completes), 0);
  const avgSeconds = rows.length
    ? rows.reduce((s, r) => s + Number(r.avg_seconds), 0) / rows.filter((r) => r.plays > 0).length || 0
    : 0;
  const completionRate = totalPlays > 0 ? (totalCompletes / totalPlays) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">스트리밍 분석</h2>
          <p className="text-xs text-ink-mute">곡별 재생/완료 통계</p>
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

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
        {icon} {label}
      </div>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
