/**
 * EmptyState — DEUDDA §4.4
 * center icon + title + subtitle + optional CTA.
 * 사용:
 *   <EmptyState icon={<Music size={20} />} title="아직 트랙이 없어요" subtitle="첫 곡을 업로드해보세요" />
 */
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  variant?: 'default' | 'error';
  className?: string;
}

export default function EmptyState({ icon, title, subtitle, action, variant = 'default', className = '' }: Props) {
  const tone = variant === 'error' ? 'text-red-300' : 'text-ink-dim';
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-2xl bg-bg-soft px-6 py-12 text-center ring-1 ring-line/10 ${className}`}>
      {icon && (
        <div className={`flex h-11 w-11 items-center justify-center rounded-full bg-bg-card ${tone}`}>
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        {subtitle && <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-dim">{subtitle}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
