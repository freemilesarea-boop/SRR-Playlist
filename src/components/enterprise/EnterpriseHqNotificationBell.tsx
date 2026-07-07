/**
 * EnterpriseHqNotificationBell — Phase 3-5
 *
 * HQ 전용 Bell CTA. unread count 30s polling.
 * 클릭 시 /enterprise/notifications 로 이동.
 * Drawer 로 확장 가능한 구조 (onClick 를 prop 으로 받음).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import {
  getMyEnterpriseNotifications,
} from '@/lib/api/enterpriseHqNotificationsApi';

const POLL_MS = 30_000;

interface Props {
  /** 다크/라이트 컨텍스트에 맞게 배경 톤 오버라이드 (기본 bg-bg-deep). */
  className?: string;
  /** 커스텀 onClick (없으면 /enterprise/notifications 링크). */
  onClick?: () => void;
}

export default function EnterpriseHqNotificationBell({ className, onClick }: Props) {
  const [unread, setUnread] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await getMyEnterpriseNotifications(1, 0, true);
      setUnread(r.unread_count);
    } catch {
      // 조용히 fail — HQ 아닌 사용자는 이 컴포넌트를 안 보여야 하지만 방어적으로 사일런트.
      setUnread(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const badgeCls = 'absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-bg-card';
  const base = `relative inline-flex items-center justify-center gap-1 rounded-full ${className ?? 'bg-bg-deep hover:bg-bg-hover'} p-2`;

  const inner = (
    <>
      <Bell size={14} className="text-slate-700 dark:text-ink" />
      {!loading && unread > 0 && (
        <span className={badgeCls}>{unread > 99 ? '99+' : unread}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base} aria-label={`알림센터${unread > 0 ? ` (${unread}개 미확인)` : ''}`}>
        {inner}
      </button>
    );
  }
  return (
    <Link to="/enterprise/notifications" className={base} aria-label={`알림센터${unread > 0 ? ` (${unread}개 미확인)` : ''}`}>
      {inner}
    </Link>
  );
}
