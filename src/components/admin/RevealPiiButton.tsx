/**
 * RevealPiiButton — RRN / 계좌번호 PII 일시 노출 (admin only, X6.15).
 *
 * 흐름:
 *   1. 마스킹 값 + "보기" 버튼 표시
 *   2. 클릭 → 확인 모달 (피해 확산 경고 + 사유 입력 필수)
 *   3. 확인 → admin_reveal_payout_pii RPC (pii_type 분기, audit 자동)
 *   4. 평문 + 카운트다운 (RRN 15초, 계좌 30초)
 *   5. 카운트다운 종료 / unmount → state 폐기 → 자동 재마스킹
 */
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, AlertTriangle, X } from 'lucide-react';
import { adminRevealPayoutPii, type PiiRevealType } from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

interface Props {
  accountId: string;
  maskedValue: string | null;
  piiType: Exclude<PiiRevealType, 'full'>;  // 'resident_number' | 'account_number'
  settlementId?: string | null;
  className?: string;
}

const REVEAL_MS: Record<Exclude<PiiRevealType, 'full'>, number> = {
  resident_number: 15_000,
  account_number: 30_000,
};

const LABEL: Record<Exclude<PiiRevealType, 'full'>, { title: string; warning: string }> = {
  resident_number: {
    title: '주민등록번호 원본 조회',
    warning:
      '주민등록번호는 가장 민감한 PII 입니다. 정산 신고 / 지급명세서 제출 외 사용 금지. ' +
      '조회 시점은 audit log 에 영구 기록되며 15초 후 자동 마스킹됩니다.',
  },
  account_number: {
    title: '계좌번호 원본 조회',
    warning:
      '계좌번호는 민감정보입니다. 정산 지급 목적 외 사용 금지. ' +
      '조회 시점은 audit log 에 영구 기록되며 30초 후 자동 마스킹됩니다.',
  },
};

export default function RevealPiiButton({
  accountId,
  maskedValue,
  piiType,
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
    if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
  }
  function hideNow() {
    setRevealed(null);
    setRemainingMs(0);
    clearTimers();
  }

  useEffect(() => () => clearTimers(), []);

  async function handleConfirm(reason: string) {
    if (!reason.trim()) {
      toast.error('조회 사유는 필수입니다');
      return;
    }
    setBusy(true);
    try {
      const r = await adminRevealPayoutPii({
        accountId, reason, piiType,
        settlementId: settlementId ?? null,
      });
      const value = piiType === 'resident_number'
        ? r.resident_registration_number
        : r.account_number;
      if (!value) {
        toast.error('등록된 값이 없습니다');
        setBusy(false);
        return;
      }
      // RRN 은 6-7 하이픈 포맷으로 표시
      const display = piiType === 'resident_number' && value.length === 13
        ? `${value.slice(0, 6)}-${value.slice(6)}`
        : value;
      setRevealed(display);
      setModalOpen(false);
      const duration = REVEAL_MS[piiType];
      const startedAt = Date.now();
      setRemainingMs(duration);
      intervalRef.current = window.setInterval(() => {
        const left = Math.max(duration - (Date.now() - startedAt), 0);
        setRemainingMs(left);
        if (left <= 0) hideNow();
      }, 250);
      timeoutRef.current = window.setTimeout(hideNow, duration);
      toast.warning(
        `${piiType === 'resident_number' ? '주민번호' : '계좌번호'} 원본 ${duration / 1000}초간 표시됨 — audit log 기록됨`,
      );
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
          className={`rounded bg-red-100 px-2 py-0.5 text-red-900 ring-1 ring-red-400 dark:bg-red-500/15 dark:text-red-100 ${className}`}
          title="원본 — 카운트다운 후 자동 마스킹"
        >
          {revealed}
        </code>
        <button
          onClick={hideNow}
          className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-600"
          title="즉시 마스킹"
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
          disabled={!maskedValue}
        >
          <Eye size={10} /> 보기
        </button>
      </span>

      {modalOpen && (
        <ConfirmModal
          busy={busy}
          piiType={piiType}
          onCancel={() => setModalOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

function ConfirmModal({
  busy, piiType, onCancel, onConfirm,
}: {
  busy: boolean;
  piiType: Exclude<PiiRevealType, 'full'>;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(
    piiType === 'resident_number' ? '원천징수 신고 / 지급명세서 제출' : '정산 지급 처리',
  );
  const meta = LABEL[piiType];
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <AlertTriangle size={16} className="text-red-500" />
            {meta.title}
          </h3>
          <button onClick={onCancel} className="rounded-full p-1.5 hover:bg-ink/5">
            <X size={14} />
          </button>
        </div>

        <Alert tone="error">{meta.warning}</Alert>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">조회 사유 (감사용, 필수)</span>
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
            disabled={busy || !reason.trim()}
            className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {busy ? '조회 중…' : `원본 조회 (${REVEAL_MS[piiType] / 1000}초)`}
          </button>
        </div>
      </div>
    </div>
  );
}
