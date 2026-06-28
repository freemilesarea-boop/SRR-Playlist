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
import RevealPiiButton from './RevealPiiButton';

function taxLabel(t: string): string {
  switch (t) {
    case 'business_income_3_3': return '사업소득 3.3%';
    case 'other_income_8_8': return '기타소득 8.8%';
    case 'none': return '없음';
    default: return t || '—';
  }
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending: { label: '확인 대기', tone: 'bg-yellow-500/15 text-yellow-200' },
  verified: { label: '승인됨', tone: 'bg-emerald-500/25 text-emerald-300' },
  rejected: { label: '거절됨', tone: 'bg-rose-500/25 text-red-300' },
};

export default function PayoutVerificationList() {
  const [rows, setRows] = useState<AdminPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        주민등록번호 / 계좌번호는 민감 PII 입니다. 본인 명의 + 동의 + 13자리 검증 확인 후
        승인해주세요. 원본 보기 시 audit log 가 영구 기록됩니다.
      </Alert>

      <div className="overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
              <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
              <th className="px-3 py-2.5 text-left font-semibold">실명 / RRN</th>
              <th className="px-3 py-2.5 text-left font-semibold">은행 / 계좌</th>
              <th className="px-3 py-2.5 text-left font-semibold">세금 / 동의</th>
              <th className="px-3 py-2.5 text-left font-semibold">상태</th>
              <th className="px-3 py-2.5 text-right font-semibold">등록일</th>
              <th className="px-3 py-2.5 text-right font-semibold">조치</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                  등록된 정산 계좌가 없어요.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const s = STATUS_LABEL[r.verification_status] ?? STATUS_LABEL.pending;
              // X6.21: pending 상태에서도 reveal 가능. 운영자가 RRN/계좌를 확인해야
              // 승인 결정을 내릴 수 있으므로 verified 조건 제거. is_pii_complete 만 체크.
              const canReveal = r.is_pii_complete;
              return (
                <tr key={r.account_id} className="border-b border-line/10 last:border-b-0 align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.artist_name ?? '—'}</p>
                    <p className="text-[10px] text-ink-mute">{r.email ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <p className="font-medium">{r.legal_name ?? '—'}</p>
                    <div className="mt-1">
                      {canReveal && r.masked_rrn ? (
                        <RevealPiiButton
                          accountId={r.account_id}
                          maskedValue={r.masked_rrn}
                          piiType="resident_number"
                          className="font-mono text-[11px]"
                        />
                      ) : (
                        <code className="font-mono text-[11px] text-ink-mute">{r.masked_rrn ?? '—'}</code>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <p>{r.bank_name}</p>
                    <p className="mt-0.5 text-[10px] text-ink-mute">예금주: {r.account_holder}</p>
                    <div className="mt-1">
                      {canReveal ? (
                        <RevealPiiButton
                          accountId={r.account_id}
                          maskedValue={r.masked_account_number}
                          piiType="account_number"
                          className="font-mono text-[11px]"
                        />
                      ) : (
                        <code className="font-mono text-[11px] text-ink-mute">{r.masked_account_number}</code>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px]">
                    <p>{taxLabel(r.tax_withholding_type)}</p>
                    <p className={`mt-0.5 ${r.has_tax_consent ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {r.has_tax_consent ? '✓ 동의 완료' : '⚠ 미동의'}
                    </p>
                    {r.tax_consent_at && (
                      <p className="mt-0.5 text-[10px] text-ink-dim">
                        {new Date(r.tax_consent_at).toLocaleString('ko-KR', {
                          year: '2-digit', month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                    {!r.is_pii_complete && (
                      <p className="mt-0.5 text-[10px] font-semibold text-red-300">PII 미완료</p>
                    )}
                  </td>
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
                          disabled={busyId === r.account_id || !r.is_pii_complete}
                          title={!r.is_pii_complete ? 'PII 미완료 — 승인 불가' : '승인'}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/25 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <Check size={11} /> 승인
                        </button>
                      )}
                      {r.verification_status !== 'rejected' && (
                        <button
                          onClick={() => reject(r.account_id)}
                          disabled={busyId === r.account_id}
                          className="inline-flex items-center gap-1 rounded-md bg-rose-500/25 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
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
