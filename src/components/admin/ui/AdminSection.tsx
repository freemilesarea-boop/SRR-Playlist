/**
 * AdminSection — 페이지 상단 헤더 + 설명 + 액션.
 *
 * 예:
 *   <AdminSection title="본사 계정 관리" description="..." action={...}>
 *     <AdminCard>...</AdminCard>
 *   </AdminSection>
 */
import { adminTypography } from '@/lib/adminTypography';

interface AdminSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function AdminSection({ title, description, badge, action, className = '', children }: AdminSectionProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={`flex items-center gap-2 ${adminTypography.heading.h1}`}>
            {title}
            {badge}
          </h2>
          {description && <p className={`mt-1 ${adminTypography.description}`}>{description}</p>}
        </div>
        {/* max-w-full 이 없으면 shrink-0 탓에 액션 묶음이 max-content 폭을 그대로 쓴다.
            버튼이 몇 개만 늘어도 폰에서 화면 밖으로 나간다(정산 V2 가 390px 화면에서 147px 넘쳤다). */}
        {action && <div className="max-w-full shrink-0">{action}</div>}
      </header>
      {children}
    </div>
  );
}
