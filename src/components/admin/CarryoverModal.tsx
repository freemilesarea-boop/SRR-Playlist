/**
 * CarryoverModal — 정산 수동 이월 (X6.25)
 *
 * 정책:
 *   - 허용 상태: pending, payable
 *   - 이월 사유 필수, 다음 정산월/예상 금액 미리보기
 *   - admin_carryover_settlement RPC 호출 — DB 가 status='carried_over',
 *     is_manual_carryover=true, carried_over_amount = 예상 금액 으로 설정
 *   - settlement_admin_audit_logs 에 audit 기록
 */
import { useState } from 'react';
import { X, ArrowRightCircle, AlertTriangle } from 'lucide-react';
import {
  adminCarryoverSettlement,
  type AdminSettlementRow,
} from '@/lib/artistSettlementApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

function fmtKrw(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}
function fmtMonth(d: string | Date): string {
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 7);
}

function nextMonth(month: string): string {
  // month: 'YYYY-MM-DD' (1일)
  const [y, m] = month.slice(0, 7).split('-').map((n) => parseInt(n, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

interface Props {
  row: AdminSettlementRow;
  onClose: () => void;
  onApplied: () => void;
}

export default function CarryoverModal({ row, onClose, onApplied }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // X6.27: held 도 pending 과 동일하게 total_settlement_amount 사용
  // (held 는 finalize 전이라 final_payout=0 인 게 일반적).
  const expectedAmount =
    row.status === 'payable' ? row.final_payout_amount : row.total_settlement_amount;
  const toMonth = nextMonth(row.settlement_month);
  const isHeld = row.status === 'held';

  async function handleConfirm() {
    if (!reason.trim()) {
      toast.error('이월 사유는 필수예요');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await adminCarryoverSettlement(row.id, reason.trim());
      toast.success(
        `이월 처리됨 — ${fmtKrw(res.carryover_amount)} → ${fmtMonth(res.carried_over_to_month)}`,
      );
      onApplied();
    } catch (e) {
      const msg = friendlyError(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <ArrowRightCircle size={16} className="text-amber-500" />
            정산 이월 신청
          </h3>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/5">
            <X size={14} />
          </button>
        </div>

        {isHeld ? (
          <Alert tone="warning">
            현재 보류 중인 정산입니다. 이월 처리하면 다음 달 이월금으로 합산됩니다.
          </Alert>
        ) : (
          <Alert tone="warning">
            이 정산금을 다음 달 정산으로 이월합니다. 지급하지 않은 금액은 다음 달 이월금으로 합산됩니다.
          </Alert>
        )}

        {isHeld && row.held_reason && (
          <div className="rounded-xl bg-amber-500/5 px-3 py-2 text-xs ring-1 ring-amber-500/30">
            <p className="font-semibold text-ink">현재 보류 사유</p>
            <p className="mt-0.5 font-mono text-ink-mute">{row.held_reason}</p>
            <p className="mt-1 text-[10px] text-ink-dim">
              ※ 이월 후 audit log 의 detail.previous_held_reason 에 보존됩니다.
            </p>
          </div>
        )}

        <div className="space-y-2 rounded-xl bg-bg-card p-3 text-sm ring-1 ring-line/10">
          <Row label="대상 아티스트" value={row.artist_nickname || row.artist_email || row.artist_user_id} />
          <Row label="현재 정산월" value={fmtMonth(row.settlement_month)} />
          <Row label="현재 상태" value={row.status} mono />
          <Row label="다음 정산월" value={fmtMonth(toMonth)} accent />
          <hr className="my-1 border-line/20" />
          <Row label="예상 이월 금액" value={fmtKrw(expectedAmount)} bold accent />
          <p className="text-[10px] text-ink-mute">
            {row.status === 'payable'
              ? '※ payable → 최종 지급액 (원천징수 후) 을 이월'
              : '※ pending → 총 정산액 (원천징수 전) 을 이월'}
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">이월 사유 (필수)</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input"
            placeholder="예: 정산 계좌 확인 보류 → 6월로 이월"
            autoFocus
          />
        </label>

        {error && (
          <Alert tone="error" title="이월 실패">
            {error}
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !reason.trim() || expectedAmount <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            <AlertTriangle size={12} />
            {busy ? '처리 중…' : '확인 — 이월 신청'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, value, mono, bold, accent,
}: {
  label: string; value: string | number; mono?: boolean; bold?: boolean; accent?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-bold' : ''}`}>
      <span className="text-ink-mute">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${accent ? 'text-accent' : ''}`}>{value}</span>
    </div>
  );
}
