/**
 * PayoutAccountEditDialog — 관리자가 정산 계좌를 직접 고치는 창. (0532)
 *
 * 고객센터로 "은행만 바꿔달라" 는 문의가 와도 운영자가 처리할 수단이 없어서,
 * 아티스트에게 주민번호·신분증까지 포함한 전체 재제출을 요구해야 했다. 그 길을 연다.
 *
 * 다만 이 창은 "돈이 가는 곳" 만 바꾼다. 실명·주민번호·세금 동의는 서버가 그대로 둔다.
 * 예금주가 실제로 다른 사람으로 바뀌는 건이라면 신분증을 받는 기존 재제출 경로를 써야
 * 하므로, 예금주를 바꾸려 하면 한 번 더 확인을 받는다.
 */
import { useRef, useState } from 'react';
import { Wallet, X, Loader2, AlertTriangle } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { adminUpdateArtistPayoutAccount, type AdminPayoutRow } from '@/lib/artistApi';
import { toast } from '@/store/toastStore';

export default function PayoutAccountEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: AdminPayoutRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bankName, setBankName] = useState(row.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState(row.account_holder ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  const holderChanged = accountHolder.trim() !== (row.account_holder ?? '').trim();
  const digits = accountNumber.replace(/\D/g, '');
  const canSave = !busy && bankName.trim().length > 0 && digits.length >= 6
    && accountHolder.trim().length > 0 && reason.trim().length > 0;

  async function save() {
    if (!canSave) return;
    if (holderChanged && !window.confirm(
      `예금주를 "${row.account_holder}" → "${accountHolder.trim()}" 로 바꿉니다.\n\n`
      + '명의자가 실제로 바뀌는 건이라면 신분증을 받는 재제출 경로를 쓰셔야 합니다.\n'
      + '그대로 진행할까요?',
    )) return;

    setBusy(true);
    const res = await adminUpdateArtistPayoutAccount({
      accountId: row.account_id,
      bankName: bankName.trim(),
      accountNumber: digits,
      accountHolder: accountHolder.trim(),
      reason: reason.trim(),
    });
    setBusy(false);

    if (!res.ok) {
      toast.error(res.error ?? '변경 실패');
      return;
    }
    if (res.result?.noop) {
      toast.info('바뀐 값이 없습니다.');
      onClose();
      return;
    }
    const pending = res.result?.pending_settlement_count ?? 0;
    toast.success(pending > 0
      ? `계좌 변경 완료 — 미지급 정산 ${pending}건이 새 계좌로 나갑니다.`
      : '계좌 변경 완료');
    onSaved();
    onClose();
  }

  return (
    <div
      ref={dialogRef}
      role="dialog" aria-modal="true" aria-label="정산 계좌 변경"
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-extrabold tracking-tight">
              <Wallet size={16} className="text-accent" /> 정산 계좌 변경
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              {row.artist_name ?? '—'} · {row.email ?? '—'}
            </p>
          </div>
          <button onClick={onClose} aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl bg-bg-card p-3 text-[11px] ring-1 ring-line/10">
          <p className="font-semibold text-ink-mute">현재 등록</p>
          <p className="mt-1">{row.bank_name} · 예금주 {row.account_holder}</p>
          <code className="font-mono text-[11px] text-ink-mute">{row.masked_account_number}</code>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">은행 *</span>
          <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)}
            placeholder="우리은행" className="input" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">
            계좌번호 * <span className="font-normal opacity-70">· 숫자만 저장됩니다</span>
          </span>
          <input type="text" inputMode="numeric" value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="1002-343-545816" className="input font-mono" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">예금주 *</span>
          <input type="text" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)}
            className="input" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">
            변경 사유 * <span className="font-normal opacity-70">· 감사 기록에 남습니다</span>
          </span>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="고객센터 문의 2026-09-28 · 은행 변경 요청" className="input" />
        </label>

        {holderChanged && (
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-500/25 p-2.5 text-[11px] text-amber-100 ring-1 ring-amber-400/50">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            예금주가 바뀝니다. 명의자가 실제로 다른 사람이면 신분증을 받는 재제출 경로를 쓰세요 —
            이 창은 실명·주민번호를 바꾸지 않습니다.
          </p>
        )}

        <p className="text-[10px] leading-relaxed text-ink-dim">
          실명·주민등록번호·세금 동의는 그대로 유지됩니다. 변경 전/후 값과 사유, 그 시점의
          미지급 정산 건수가 영구 기록됩니다.
        </p>

        <div className="flex gap-2 pt-1">
          <button onClick={() => void save()} disabled={!canSave} className="btn-primary flex-1 py-2.5 text-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
            {busy ? '변경 중…' : '계좌 변경'}
          </button>
          <button onClick={onClose} className="btn-ghost px-4 py-2.5 text-sm">취소</button>
        </div>
      </div>
    </div>
  );
}
