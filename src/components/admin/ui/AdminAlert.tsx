/**
 * AdminAlert — 4종 톤 (success/warning/danger/info).
 * 좌측 아이콘 + 제목 + 설명 + 선택 action.
 *
 * 예:
 *   <AdminAlert tone="warning" title="확인 필요" description="..." action={<button>...</button>} />
 */
import { AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';
import { adminPalette, adminTokens } from './palette';

type AlertTone = 'success' | 'warning' | 'danger' | 'info';

const DEFAULT_ICONS: Record<AlertTone, React.ReactNode> = {
  success: <CheckCircle2 size={14} />,
  warning: <AlertTriangle size={14} />,
  danger:  <XCircle size={14} />,
  info:    <Info size={14} />,
};

interface AdminAlertProps {
  tone: AlertTone;
  title?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function AdminAlert({
  tone, title, description, icon, action, className = '', children,
}: AdminAlertProps) {
  const palette = adminPalette[tone];
  const displayIcon = icon ?? DEFAULT_ICONS[tone];
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 ${adminTokens.radius.lg} ${palette.softBg} ${palette.softRing} px-3 py-2.5 ${className}`}
    >
      <span className={`mt-0.5 shrink-0 ${palette.icon}`}>{displayIcon}</span>
      <div className="flex-1 min-w-0">
        {title && <p className={`text-xs font-bold ${palette.softText}`}>{title}</p>}
        {description && <p className={`mt-0.5 text-[11px] ${palette.softText}`}>{description}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
