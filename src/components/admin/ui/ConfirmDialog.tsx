/**
 * ConfirmDialog — 되돌리기 어려운 작업 앞에 세우는 확인 단계.
 *
 * 관리자 영역에는 window.confirm 이 20개 파일에 28번 있었다. 브라우저 기본
 * 다이얼로그는 (1) 대상이 무엇인지 보여줄 수 없고, (2) 위험한 작업과 그렇지 않은
 * 작업이 똑같이 생기고, (3) 진행 중 상태가 없어 같은 작업을 두 번 누를 수 있다.
 * 그 셋만 고친다.
 *
 * **UI 레이어 교체일 뿐이다.** API 호출 방식 · mutation 순서 · 권한 검사 ·
 * 성공/실패 처리는 호출부의 기존 코드를 그대로 둔다. 이 컴포넌트는 "실행할지"를
 * 묻고 onConfirm 을 부르는 것까지만 한다.
 *
 * 기존 AdminModal 위에 올린다 — 새 modal 체계를 만들지 않는다.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AdminButton } from './AdminButton';
import { AdminModal } from './AdminModal';
import { adminTypography } from '@/lib/adminTypography';

export interface ConfirmDialogProps {
  open: boolean;
  /** 무슨 작업인지. 예: '아티스트 승인' */
  title: ReactNode;
  /**
   * 누구/무엇에 하는지. 예: 아티스트명, 음원 제목.
   * 대상을 모를 때는 넘기지 않는다 — 가짜 대상을 만들지 않는다.
   */
  target?: ReactNode;
  /** 결과 설명. 되돌릴 수 없다면 여기 적는다. */
  description?: ReactNode;
  /** 대량 작업 건수. 주면 '<count>건' 으로 보인다. */
  count?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 삭제/반려 등. 확인 버튼이 danger 톤이 되고 설명이 강조된다. */
  destructive?: boolean;
  /** 실행 중. 버튼이 잠기고 배경 클릭으로 닫히지 않는다. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 사유 입력 등 추가 입력. 없으면 넣지 않는다. */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  target,
  description,
  count,
  confirmLabel = '실행',
  cancelLabel = '취소',
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  // 중복 실행 방지 — pending 이 올라오기 전의 연타까지 막는다.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) firedRef.current = false;
  }, [open]);

  const handleConfirm = () => {
    if (pending || firedRef.current) return;
    firedRef.current = true;
    onConfirm();
  };

  // 실행 중에는 배경 클릭/닫기 버튼으로 사라지지 않게 한다 — 진행 중인지 모른 채
  // 창이 닫히면 같은 작업을 다시 시도하게 된다.
  const handleClose = () => {
    if (pending) return;
    onCancel();
  };

  return (
    <AdminModal
      open={open}
      onClose={handleClose}
      title={title}
      size="sm"
      footer={
        <>
          <AdminButton tone="neutral" variant="ghost" onClick={handleClose} disabled={pending}>
            {cancelLabel}
          </AdminButton>
          <AdminButton
            tone={destructive ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={pending}
            disabled={pending}
          >
            {confirmLabel}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-2">
        {target != null && (
          <p className="text-sm font-bold text-ink">
            {target}
            {typeof count === 'number' && count > 0 && (
              <span className="ml-1 font-semibold text-ink-dim">
                {count.toLocaleString('ko-KR')}건
              </span>
            )}
          </p>
        )}
        {target == null && typeof count === 'number' && count > 0 && (
          <p className="text-sm font-bold text-ink">{count.toLocaleString('ko-KR')}건</p>
        )}
        {description && (
          <p className={destructive ? 'text-sm text-ink' : adminTypography.body}>{description}</p>
        )}
        {children}
      </div>
    </AdminModal>
  );
}
