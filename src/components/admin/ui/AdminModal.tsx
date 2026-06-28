/**
 * AdminModal — header / scrollable body / sticky footer 3-zone.
 * 모바일 bottom-sheet + iOS safe-area.
 *
 * 예:
 *   <AdminModal open={open} onClose={...} title="월 정산 상세"
 *               headerExtra={<StatusBadge .../>}
 *               footer={<><AdminButton tone="neutral">취소</AdminButton><AdminButton tone="primary">저장</AdminButton></>}>
 *     <div>body</div>
 *   </AdminModal>
 */
import { X } from 'lucide-react';
import { adminTokens } from './palette';
import { adminTypography } from '@/lib/adminTypography';

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLS: Record<NonNullable<AdminModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

export function AdminModal({
  open, onClose, title, headerExtra, footer, size = 'md', className = '', children,
}: AdminModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full ${SIZE_CLS[size]} flex-col max-h-[95vh] sm:max-h-[90vh] ${adminTokens.radius.xl} sm:rounded-2xl rounded-t-2xl bg-bg-card ring-1 ring-line/15 ${adminTokens.shadow.modal} ${className}`}
      >
        {(title || headerExtra) && (
          <header className="shrink-0 flex items-center justify-between gap-2 border-b border-line/10 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              {title && <h3 className={adminTypography.heading.h2}>{title}</h3>}
              {headerExtra}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`shrink-0 rounded p-1 text-ink-mute hover:bg-bg-hover ${adminTokens.focusRing}`}
              aria-label="닫기"
            >
              <X size={14} />
            </button>
          </header>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer && (
          <footer
            className="shrink-0 flex items-center justify-end gap-2 border-t border-line/10 bg-bg-card/95 px-4 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
