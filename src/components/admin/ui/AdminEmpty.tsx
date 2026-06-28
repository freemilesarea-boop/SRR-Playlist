/**
 * AdminEmpty — 결과 0건 placeholder. 아이콘 + 설명 + 선택 액션.
 *
 * 예:
 *   <AdminEmpty icon={<Inbox size={28} />} title="검색 결과 없음"
 *               description="필터를 조정해보세요." action={<AdminButton>...</AdminButton>} />
 */
import { adminTokens } from './palette';
import { adminTypography } from '@/lib/adminTypography';

interface AdminEmptyProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function AdminEmpty({ icon, title, description, action, className = '' }: AdminEmptyProps) {
  return (
    <div className={`${adminTokens.radius.xl} bg-bg-card ring-1 ring-line/10 ${adminTokens.shadow.card} px-6 py-10 text-center ${className}`}>
      {icon && <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-bg-deep text-ink-mute">{icon}</div>}
      {title && <h3 className={`${adminTypography.heading.h2} mb-1`}>{title}</h3>}
      {description && <p className={adminTypography.description}>{description}</p>}
      {action && <div className="mt-4 inline-flex">{action}</div>}
    </div>
  );
}
