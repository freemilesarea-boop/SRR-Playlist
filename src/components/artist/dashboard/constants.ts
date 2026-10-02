/**
 * 대시보드에서 공유하는 상수. 컴포넌트 파일에서 분리해 둔다 —
 * 컴포넌트와 상수를 한 파일에서 같이 export 하면 fast refresh 가 깨진다.
 */
import { Clock, CheckCircle2, XCircle, EyeOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// 긴급 hotfix — /15 alpha + text-*-200 는 WCAG AA fail. /25 + text-*-100 으로 강화.
export const STATUS_LABEL: Record<string, { label: string; tone: string; Icon: LucideIcon }> = {
  pending_review: { label: '심사 대기', tone: 'bg-yellow-500/25 text-slate-900 dark:text-yellow-100 ring-1 ring-yellow-400/40', Icon: Clock },
  approved: { label: '승인됨', tone: 'bg-emerald-500/25 text-slate-900 dark:text-emerald-100 ring-1 ring-emerald-400/40', Icon: CheckCircle2 },
  rejected: { label: '거절됨', tone: 'bg-red-500/25 text-slate-900 dark:text-red-100 ring-1 ring-red-400/40', Icon: XCircle },
  hidden: { label: '숨김', tone: 'bg-ink/15 text-ink ring-1 ring-line/20', Icon: EyeOff },
};
