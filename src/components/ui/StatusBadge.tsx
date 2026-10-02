/**
 * StatusBadge — 상태 한 단어를 색으로 구분해 보여준다.
 *
 * tone 은 의미 기준으로만 고른다(성공/주의/실패/진행/중립). 화면마다 색을 새로
 * 고르면 같은 상태가 다른 색으로 보이게 되므로 여기서 묶는다.
 * 대비는 admin tones 린트 기준(alpha /20 이상)에 맞췄다.
 */
import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'progress' | 'neutral';

const TONE: Record<BadgeTone, string> = {
  success: 'bg-emerald-500/25 text-emerald-700 dark:text-emerald-200',
  warning: 'bg-amber-500/25 text-amber-900 dark:text-amber-100',
  danger: 'bg-rose-500/25 text-rose-800 dark:text-red-200',
  progress: 'bg-sky-500/25 text-sky-900 dark:text-sky-100',
  neutral: 'bg-bg-soft text-ink-mute ring-1 ring-line/15',
};

export default function StatusBadge({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
