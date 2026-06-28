/**
 * LastLoginBadge — last_login_at 자동 분류 표시.
 *   - null         → '로그인 전' (neutral italic)
 *   - 24시간 내    → success badge "24시간"
 *   - 7일 내       → success badge "7일"
 *   - 30일 내      → info badge "30일"
 *   - 그 외        → 단순 텍스트 (yyyy.MM.dd HH:mm)
 *
 * 예:
 *   <LastLoginBadge iso={user.last_login_at} layout="desktop" />
 */
import { AdminBadge } from './AdminBadge';

interface LastLoginBadgeProps {
  iso: string | null;
  layout?: 'desktop' | 'mobile';
  className?: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

function classify(iso: string): { tone: 'success' | 'info' | 'neutral'; label: string } | null {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  const dh = (Date.now() - d) / (1000 * 60 * 60);
  if (dh < 24)        return { tone: 'success', label: '24시간' };
  if (dh < 24 * 7)    return { tone: 'success', label: '7일' };
  if (dh < 24 * 30)   return { tone: 'info',    label: '30일' };
  return null;
}

export function LastLoginBadge({ iso, layout = 'desktop', className = '' }: LastLoginBadgeProps) {
  if (!iso) {
    return (
      <span className={`text-[11px] italic text-ink-dim ${className}`}>로그인 전</span>
    );
  }
  const cls = classify(iso);
  const dt = formatDateTime(iso);
  if (!cls) {
    return (
      <span className={`text-[11px] text-ink-mute tabular-nums ${className}`}>{dt}</span>
    );
  }
  if (layout === 'mobile') {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <span className="text-[11px] text-ink-mute tabular-nums">{dt}</span>
        <AdminBadge tone={cls.tone} size="sm">{cls.label}</AdminBadge>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center justify-end gap-1.5 ${className}`}>
      <span className="text-[11px] text-ink-mute tabular-nums">{dt}</span>
      <AdminBadge tone={cls.tone} size="sm">{cls.label}</AdminBadge>
    </span>
  );
}
