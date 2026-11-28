import { useRef, useState } from 'react';
import { Flag, X } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { toast } from '@/store/toastStore';
import {
  REPORT_REASONS, REPORT_TARGET_LABEL, moderationErrorMessage, reportContent,
  type ReportReason, type ReportTargetType,
} from '@/lib/moderationApi';

interface Props {
  targetType: ReportTargetType;
  targetId: string;
  /** 대화상자 제목에 보일 이름(곡 제목, 플레이리스트 이름 등) */
  targetName?: string;
  /** player: 어두운 플레이어 위 원형 / chip: 글자 있는 작은 버튼 / icon: 테두리 원형 */
  variant?: 'player' | 'chip' | 'icon';
  className?: string;
}

/**
 * 콘텐츠 신고 버튼 + 사유 선택 대화상자 (App Store 지침 1.2).
 * 접수되면 관리자에게 알림이 가고, 관리자 → 신고 관리에서 처리한다.
 */
export default function ReportButton({ targetType, targetId, targetName, variant = 'chip', className }: Props) {
  const session = useAuthStore((s) => s.session);
  const [open, setOpen] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) {
      toast.info('로그인 후 신고할 수 있어요.');
      useGateStore.getState().open('login');
      return;
    }
    setOpen(true);
  }

  const cls =
    variant === 'player'
      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/15 backdrop-blur transition hover:text-white'
      : variant === 'icon'
        ? 'flex h-9 w-9 items-center justify-center rounded-full text-ink-mute ring-1 ring-line/15 transition hover:text-red-500 hover:ring-red-400/40'
        : 'inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1.5 text-xs text-ink-mute ring-1 ring-line/15 transition hover:text-red-500 hover:ring-red-400/40';

  return (
    <>
      <button type="button" onClick={onClick} className={`${cls} ${className ?? ''}`} aria-label="신고하기" title="신고하기">
        <Flag size={variant === 'chip' ? 13 : 16} />
        {variant === 'chip' && <span>신고</span>}
      </button>
      {open && (
        <ReportDialog
          targetType={targetType}
          targetId={targetId}
          targetName={targetName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReportDialog({
  targetType, targetId, targetName, onClose,
}: { targetType: ReportTargetType; targetId: string; targetName?: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await reportContent({ targetType, targetId, reason, detail });
      toast.success('신고가 접수됐어요. 운영팀이 24시간 안에 확인할게요.');
      onClose();
    } catch (e) {
      toast.error(moderationErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog" aria-modal="true" aria-labelledby="report-title"
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-bg-soft text-ink ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/10 px-5 py-3">
          <div className="min-w-0">
            <h2 id="report-title" className="text-base font-bold">{REPORT_TARGET_LABEL[targetType]} 신고</h2>
            {targetName && <p className="truncate text-xs text-ink-mute">{targetName}</p>}
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold text-ink-mute">신고 사유를 골라 주세요</legend>
            {REPORT_REASONS.map((r) => (
              <label
                key={r.value}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 transition ${
                  reason === r.value ? 'bg-accent/10 ring-accent/40' : 'bg-bg-card ring-line/10 hover:bg-bg-hover'
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-[rgb(var(--color-accent))]"
                />
                {r.label}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="report-detail" className="text-xs font-semibold text-ink-mute">자세한 내용 (선택)</label>
            <textarea
              id="report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, 1000))}
              rows={3}
              placeholder="어떤 부분이 문제인지 적어 주시면 더 빨리 처리할 수 있어요."
              className="input text-sm"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-ink-dim">
            신고는 익명으로 처리되며, 운영팀이 확인 후 운영정책에 따라 콘텐츠를 숨기거나 삭제합니다.
          </p>
        </div>

        <div className="flex gap-2 border-t border-line/10 p-4">
          <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">취소</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!reason || busy}
            className="flex-1 rounded-full bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {busy ? '접수 중…' : '신고하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
