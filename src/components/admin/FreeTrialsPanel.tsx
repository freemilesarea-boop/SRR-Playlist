import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Gift, CheckCircle2, XCircle, Clock } from 'lucide-react';
import {
  adminListFreeTrials, adminExtendTrial, adminEndTrial, type AdminFreeTrialRow,
} from '@/lib/trialApi';
import { toast } from '@/store/toastStore';

const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

type Filter = 'all' | 'active' | 'expired' | 'revoked';

export default function FreeTrialsPanel() {
  const [rows, setRows] = useState<AdminFreeTrialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminListFreeTrials(filter === 'all' ? undefined : filter, 500));
    } catch (e) {
      toast.error(`불러오기 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active').length;
    const converted = rows.filter((r) => r.converted).length;
    const started = rows.length;
    return {
      active, converted, started,
      rate: started ? Math.round((converted / started) * 100) : 0,
    };
  }, [rows]);

  async function onExtend(r: AdminFreeTrialRow) {
    if (!r.user_id) return;
    setBusyId(r.id);
    const res = await adminExtendTrial(r.user_id, 3);
    if (res.ok) { toast.success('체험을 3일 연장했어요.'); await load(); }
    else toast.error(res.error ?? '연장 실패');
    setBusyId(null);
  }
  async function onEnd(r: AdminFreeTrialRow) {
    if (!r.user_id) return;
    if (!confirm('이 매장의 무료 체험을 강제 종료할까요?')) return;
    setBusyId(r.id);
    const res = await adminEndTrial(r.user_id, 'admin_manual');
    if (res.ok) { toast.success('체험을 종료했어요.'); await load(); }
    else toast.error(res.error ?? '종료 실패');
    setBusyId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Gift size={18} className="text-accent" /> 무료 체험 관리
          </h2>
          <p className="text-xs text-ink-mute">영업인 코드 기반 3일 무료 체험 — 연장 / 강제 종료 / 전환 현황</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="체험중" value={`${stats.active}개`} />
        <Stat label="누적 체험 시작" value={`${stats.started}개`} />
        <Stat label="유료 전환" value={`${stats.converted}개`} />
        <Stat label="전환율" value={`${stats.rate}%`} />
      </div>

      <div className="flex gap-1.5">
        {(['all', 'active', 'expired', 'revoked'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
              filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'
            }`}
          >
            {f === 'all' ? '전체' : f === 'active' ? '체험중' : f === 'expired' ? '만료' : '강제종료'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-card" />)}</div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-bg-card p-10 text-center text-sm text-ink-dim ring-1 ring-line/10">체험 내역이 없어요.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-line/10 text-[10px] uppercase tracking-wide text-ink-dim">
              <tr>
                <th className="px-3 py-2">매장 / 이메일</th>
                <th className="px-3 py-2">사업자번호</th>
                <th className="px-3 py-2">영업인</th>
                <th className="px-3 py-2">시작</th>
                <th className="px-3 py-2">종료</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">전환</th>
                <th className="px-3 py-2 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/40">
                  <td className="px-3 py-2">
                    <p className="font-semibold">{r.store_name ?? '—'}</p>
                    <p className="text-[10px] text-ink-dim">{r.email ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-ink-mute">{r.business_number ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-mute">{r.sales_agent_name ?? '—'}<br /><span className="text-[10px] text-ink-dim">{r.sales_agent_code ?? ''}</span></td>
                  <td className="px-3 py-2 text-ink-mute">{dt(r.started_at)}</td>
                  <td className="px-3 py-2 text-ink-mute">
                    {dt(r.ends_at)}
                    {r.status === 'active' && <span className="ml-1 text-[10px] text-accent">(D-{r.days_left})</span>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">
                    {r.converted
                      ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={12} /> 결제</span>
                      : <span className="text-ink-dim">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => void onExtend(r)}
                        disabled={busyId === r.id || !r.user_id}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                      >
                        <Clock size={11} /> +3일
                      </button>
                      <button
                        onClick={() => void onEnd(r)}
                        disabled={busyId === r.id || !r.user_id || r.status !== 'active'}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-500/25 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                      >
                        <XCircle size={11} /> 종료
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-dim">
        ※ 특정 영업인 코드를 비활성화하려면 <b>영업인 관리</b> 탭에서 해당 영업인의 활성 상태를 끄면 됩니다.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <p className="text-[10px] text-ink-dim">{label}</p>
      <p className="mt-1 text-lg font-extrabold">{value}</p>
    </div>
  );
}
function StatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  if (status === 'active') return <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">체험중</span>;
  if (status === 'revoked') return <span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-semibold text-rose-300">강제종료</span>;
  return <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-mute">만료</span>;
}
