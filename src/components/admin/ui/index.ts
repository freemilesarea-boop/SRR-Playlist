/**
 * Admin UI Design System — barrel export.
 *
 * 신규 admin 컴포넌트는:
 *   import { AdminBadge, AdminAlert, AdminCard, AdminButton } from '@/components/admin/ui';
 *
 * 직접 hardcode 색상 (text-rose-500 / bg-red-500 등) 금지 — lint:tones 차단.
 * 6 톤 (primary/success/warning/danger/info/neutral) 만 사용.
 */
export * from './palette';
export { AdminBadge } from './AdminBadge';
export { AdminAlert } from './AdminAlert';
export { AdminButton } from './AdminButton';
export { AdminCard, AdminStatCard } from './AdminCard';
export { AdminSection } from './AdminSection';
export { AdminEmpty } from './AdminEmpty';
export { AdminSkeleton } from './AdminSkeleton';
export { AdminTooltip } from './AdminTooltip';
export { AdminSearch } from './AdminSearch';
export { AdminModal } from './AdminModal';
export { LastLoginBadge } from './LastLoginBadge';
