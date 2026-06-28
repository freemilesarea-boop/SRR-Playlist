/**
 * RevealAccountButton — 정산 계좌 원본 노출 (마스킹 ↔ 원본 토글).
 *
 * 흐름:
 *   1. 마스킹 상태로 표시 + "보기" 버튼
 *   2. 클릭 → 확인 모달 ("정산 지급 목적 외 사용 금지")
 *   3. 확인 → admin_reveal_payout_account RPC 호출 (audit log INSERT)
 *   4. 원본 표시 + 30초 카운트다운 + "다시 숨기기" 버튼
 *   5. 30초 후 / 컴포넌트 unmount / 페이지 이탈 시 자동 재마스킹
 *
 * 보안:
 *   - audit log 는 RPC 트랜잭션 내에서 atomic
 *   - 클라이언트는 원본을 ref 가 아닌 state 에만 보관 (30초 후 setState(null))
 *   - 새로고침/페이지 이탈 시 state 사라짐 — 자동 재마스킹
 */
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, AlertTriangle, X } from 'lucide-react';
import { adminRevealPayoutAccount } from '@/lib/artistApi';
import { useModalA11y } from '@/hooks/useModalA11y';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

const REVEAL_DURATION_MS = 30_000;

interface Props {
  accountId: string;
  maskedValue: string | null;
  settlementId?: string | null;
  /** 표시 폰트 클래스 (기본 font-mono) */
  className?: string;
}

export default function RevealAccountButton({
  accountId,
  maskedValue,
  settlementId,
  className = 'font-mono',
}: Props) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  function clearTimers() {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function hideNow() {
    setRevealed(null);
    setRemainingMs(0);
    clearTimers();
  }

  // unmount / 페이지 이탈 시 자동 재마스킹
  useEffect(() => {
    return () => {
      clearTimers();
      // state 는 어차피 사라짐 — 원본 메모리에서 제거됨
    };
  }, []);

  async function handleConfirm(reason: string) {
    setBusy(true);
    try {
      const r = await adminRevealPayoutAccount({
        accountId,
        reason: reason || null,
        settlementId: settlementId ?? null,
      });
      setRevealed(r.account_number);
      setModalOpen(false);
      // 30초 카운트다운
      const startedAt = Date.now();
      setRemainingMs(REVEAL_DURATION_MS);
      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const left = Math.max(REVEAL_DURATION_MS - elapsed, 0);
        setRemainingMs(left);
        if (left <= 0) {
          hideNow();
        }
      }, 250);
      timeoutRef.current = window.setTimeout(hideNow, REVEAL_DURATION_MS);
      toast.warning('계좌번호 원본 30초간 표시됨 — audit log 기록됨');
    } catch (e) {
      toast.error(friendlyError(e, '원본 조회 실패'));
    } finally {
      setBusy(false);
    }
  }

  if (revealed) {
    const seconds = Math.ceil(remainingMs / 1000);
    return (
      <div className="inline-flex items-center gap-2">
        <code
          className={`rounded bg-red-100 px-2 py-0.5 text-rose-200 ring-1 ring-red-400 dark:bg-rose-500/25 dark:text-red-100 ${className}`}
          title="원본 — 30초 후 자동 마스킹"
        >
          {revealed}
        </code>
        <button
          onClick={hideNow}
          className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-600"
          title="다시 마스킹"
        >
          <EyeOff size={10} /> 숨기기 ({seconds}s)
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <code className={className}>{maskedValue ?? '—'}</code>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-ink-mute hover:bg-ink/10"
          title="원본 보기 (audit log)"
        >
          <Eye size={10} /> 보기
        </button>
      </span>

      {modalOpen && (
        <ConfirmModal busy={busy} onCancel={() => setModalOpen(false)} onConfirm={handleConfirm} />
      )}
    </>
  );
}

function ConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('정산 지급 처리');
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose: onCancel });
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <AlertTriangle size={16} className="text-rose-300" />
            계좌번호 원본 조회
          </h3>
          <button onClick={onCancel} className="rounded-full p-1.5 hover:bg-ink/5">
            <X size={14} />
          </button>
        </div>

        <Alert tone="error">
          계좌번호는 <strong>민감정보</strong> 입니다. 정산 지급 목적 외 사용하지 마세요.
          조회 시점은 <strong>audit log 에 영구 기록</strong> 되며 30초 후 자동 마스킹됩니다.
        </Alert>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">조회 사유 (감사용)</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input"
            placeholder="예: 2026-04 정산 송금 처리"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {busy ? '조회 중…' : '원본 조회 (30초)'}
          </button>
        </div>
      </div>
    </div>
  );
}
