/**
 * AdminBadge — solid 또는 subtle 톤의 status chip.
 * 6개 톤 (primary/success/warning/danger/info/neutral).
 *
 * 예:
 *   <AdminBadge tone="success">완료</AdminBadge>
 *   <AdminBadge tone="warning" variant="subtle" icon={<Clock size={10} />}>대기</AdminBadge>
 */
import { adminPalette, adminTokens, type AdminToneName } from './palette';

interface AdminBadgeProps {
  tone?: AdminToneName;
  variant?: 'solid' | 'subtle';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function AdminBadge({
  tone = 'neutral', variant = 'subtle', size = 'sm', icon, className = '', children,
}: AdminBadgeProps) {
  const palette = adminPalette[tone];
  const tone_cls = variant === 'solid' ? palette.badgeSolid : palette.badgeSubtle;
  const size_cls = size === 'sm'
    ? 'px-2 py-0.5 text-[10px] font-bold'
    : 'px-2.5 py-1 text-[11px] font-semibold';
  return (
    <span className={`inline-flex items-center gap-1 ${adminTokens.radius.pill} ${size_cls} ${tone_cls} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
