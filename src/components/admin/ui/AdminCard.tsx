/**
 * AdminCard — 표준 카드 (제목 + 본문 + 선택 액션).
 * AdminStatCard — KPI 카드 (큰 숫자 + 라벨 + 아이콘 + 증감).
 */
import { adminTokens, adminPalette, type AdminToneName } from './palette';
import { adminTypography } from '@/lib/adminTypography';

interface AdminCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function AdminCard({ title, subtitle, action, className = '', bodyClassName = '', children }: AdminCardProps) {
  return (
    <section className={`${adminTokens.radius.xl} bg-bg-card ring-1 ring-line/10 ${adminTokens.shadow.card} ${className}`}>
      {(title || subtitle || action) && (
        <header className="flex items-start justify-between gap-2 border-b border-line/10 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className={adminTypography.heading.h2}>{title}</h3>}
            {subtitle && <p className={`mt-0.5 ${adminTypography.description}`}>{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-4 py-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}


interface AdminStatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: AdminToneName;
  delta?: { value: string; tone?: 'success' | 'danger' | 'neutral'; label?: string };
  hint?: string;
  className?: string;
}

export function AdminStatCard({
  label, value, icon, tone = 'neutral', delta, hint, className = '',
}: AdminStatCardProps) {
  const palette = adminPalette[tone];
  return (
    <div
      className={`${adminTokens.radius.xl} bg-bg-card ring-1 ring-line/10 ${adminTokens.shadow.card} px-4 py-3 ${adminTokens.transition} hover:ring-line/20 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={adminTypography.caption}>{label}</p>
        {icon && (
          <span className={`inline-flex h-7 w-7 items-center justify-center ${adminTokens.radius.md} ${palette.softBg} ${palette.icon}`}>
            {icon}
          </span>
        )}
      </div>
      <div className={`mt-2 ${adminTypography.number.large}`}>{value}</div>
      {(delta || hint) && (
        <div className="mt-1 flex items-center gap-2">
          {delta && (
            <span className={`text-[11px] font-semibold ${
              delta.tone === 'success' ? adminPalette.success.softText :
              delta.tone === 'danger'  ? adminPalette.danger.softText :
                                          'text-ink-mute'
            }`}>
              {delta.value}{delta.label ? ` ${delta.label}` : ''}
            </span>
          )}
          {hint && <span className={adminTypography.hint}>{hint}</span>}
        </div>
      )}
    </div>
  );
}
