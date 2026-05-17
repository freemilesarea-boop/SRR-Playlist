import { useCallback, useState } from 'react';
import { Wallet, Check, X, Clock } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPendingPayoutAccounts,
  verifyArtistPayoutAccount,
  rejectArtistPayoutAccount,
  type AdminPayoutRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: '확인 대기', tone: 'bg-yellow-500/15 text-yellow-200' },
  verified: { label: '승인됨', tone: 'bg-emerald-500/15 text-emerald-300' },
  rejected: { label: '거절됨', tone: 'bg-red-500/15 text-red-300' },
};

function maskAccount(num: string): string {
  if (!num) return '';
  const cleaned = num.replace(/\s+/g, '');
  if (cleaned.length <= 6) return cleaned;
  const head = cleaned.slice(0, 3);
  const tail = cleaned.slice(-3);
  const middle = '*'.repeat(Math.max(cleaned.length - 6, 1));
  return `${head}${middle}${tail}`;
}

export default function PayoutVerificationList() {
  const [rows, setRows] = useState<AdminPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPendingPayoutAccounts();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFreshFetch(load, []);

  async function verify(accountId: string) {
    if (!window.confirm('이 계좌를 승인 처리할까요? 승인 후 아티스트는 음원 업로드가 가능해집니다.')) return;
    setBusyId(accountId);
    const res = await verifyArtistPayoutAccount(accountId);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '승인 실패');
      return;
    }
    toast.success('계좌 승인 완료');
    await load();
  }

  async function reject(accountId: string) {
    const reason = window.prompt('거절 사유를 입력하세요') ?? '';
    if (!reason.trim()) {
      toast.error('거절 사유는 필수입니다');
      return;
    }
    setBusyId(accountId);
    const res = await rejectArtistPayoutAccount(accountId, reason.trim());
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '거절 실패');
      return;
    }
    toast.success('거절 완료');
    await load();
  }

  const pendingCount = rows.filter((r) => r.verification_status === 'pending').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Wallet size={16} className="text-accent" /> 정산 계좌 확인
          </h2>
          <p className="text-xs text-ink-mute">
            확인 대기 {pendingCount}건 · 계좌번호는 본인+관리자만 조회 가능
          </p>
        </div>
      </div>

      <Alert tone="warning">
        계좌번호는 민감정보입니다. 본인 명의 확인 후 승인해주세요. 화면에 마스킹 표시되며, 클릭
        시 일시적으로 펼쳐집니다.
      </Alert>

      <div className="overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
              <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
              <th className="px-3 py-2.5 text-left font-semibold">이메일</th>
              <th className="px-3 py-2.5 text-left font-semibold">은행</th>
              <th className="px-3 py-2.5 text-left font-semibold">계좌번호</th>
              <th className="px-3 py-2.5 text-left font-semibold">예금주</th>
              <th className="px-3 py-2.5 text-left font-semibold">상태</th>
              <th className="px-3 py-2.5 text-right font-semibold">등록일</th>
              <th className="px-3 py-2.5 text-right font-semibold">조치</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-ink-mute">
                  등록된 정산 계좌가 없어요.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const s = STATUS_LABEL[r.verification_status] ?? STATUS_LABEL.pending;
              const revealed = revealId === r.account_id;
              return (
                <tr key={r.account_id} className="border-b border-line/10 last:border-b-0">
                  <td className="px-3 py-2.5 font-medium">{r.artist_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-ink-mute">{r.email ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs">{r.bank_name}</td>
                  <td className="px-3 py-2.5 text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setRevealId(revealed ? null : r.account_id)}
                      className="rounded px-1 py-0.5 hover:bg-bg-hover"
                      title={revealed ? '마스킹' : '계좌번호 펼치기'}
                    >
                      {revealed ? r.account_number : maskAccount(r.account_number)}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{r.account_holder}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.tone}`}>
                      {r.verification_status === 'pending' && <Clock size={9} />}
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
                      {r.verification_status !== 'verified' && (
                        <button
                          onClick={() => verify(r.account_id)}
                          disabled={busyId === r.account_id}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <Check size={11} /> 승인
                        </button>
                      )}
                      {r.verification_status !== 'rejected' && (
                        <button
                          onClick={() => reject(r.account_id)}
                          disabled={busyId === r.account_id}
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
