import { useCallback, useState } from 'react';
import { Mic2, Check, X, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { toast } from '@/store/toastStore';

interface ArtistRow {
  user_id: string;
  real_name: string;
  artist_name: string;
  phone: string;
  email: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  rejected_reason: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: '심사 대기', tone: 'bg-yellow-500/15 text-yellow-200' },
  approved: { label: '승인됨', tone: 'bg-emerald-500/15 text-emerald-300' },
  rejected: { label: '거절됨', tone: 'bg-red-500/15 text-red-300' },
};

export default function ArtistApprovalList() {
  const [rows, setRows] = useState<ArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_pending_artists', { p_limit: 100 });
      if (error) throw error;
      setRows((data ?? []) as ArtistRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '아티스트 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useFreshFetch(load, []);

  async function approve(userId: string) {
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc('approve_artist_profile', { p_user_id: userId });
      if (error) throw error;
      toast.success('승인 완료');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '승인 실패');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(userId: string) {
    const reason = window.prompt('거절 사유를 입력하세요 (선택)') ?? '';
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc('reject_artist_profile', {
        p_user_id: userId,
        p_reason: reason,
      });
      if (error) throw error;
      toast.success('거절 완료');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '거절 실패');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Mic2 size={16} className="text-accent" /> 아티스트 승인
          </h2>
          <p className="text-xs text-ink-mute">
            심사 대기 {rows.filter((r) => r.approval_status === 'pending').length}건
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
              <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
              <th className="px-3 py-2.5 text-left font-semibold">연락처</th>
              <th className="px-3 py-2.5 text-left font-semibold">상태</th>
              <th className="px-3 py-2.5 text-right font-semibold">가입일</th>
              <th className="px-3 py-2.5 text-right font-semibold">조치</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-xs text-ink-mute">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-xs text-ink-mute">
                  아티스트 신청이 없어요.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const s = STATUS_LABEL[r.approval_status] ?? STATUS_LABEL.pending;
              return (
                <tr key={r.user_id} className="border-b border-line/10 last:border-b-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.artist_name}</p>
                    <p className="text-xs text-ink-mute">{r.real_name}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-mute">
                    {r.email}
                    <br />
                    <span className="text-ink-dim">{r.phone}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.tone}`}>
                      {r.approval_status === 'pending' && <Clock size={9} />}
                      {s.label}
                    </span>
                    {r.rejected_reason && (
                      <p className="mt-1 text-[10px] text-red-300">{r.rejected_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {new Date(r.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {r.approval_status !== 'approved' && (
                        <button
                          onClick={() => approve(r.user_id)}
                          disabled={busyId === r.user_id}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <Check size={11} /> 승인
                        </button>
                      )}
                      {r.approval_status !== 'rejected' && (
                        <button
                          onClick={() => reject(r.user_id)}
                          disabled={busyId === r.user_id}
                          className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                        >
                          <X size={11} /> 거절
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
