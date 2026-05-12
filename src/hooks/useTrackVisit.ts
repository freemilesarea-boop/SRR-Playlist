import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { trackVisit } from '@/lib/analytics';

/** 라우트 변경마다 visitor_events 에 한 줄 기록 */
export function useTrackVisit() {
  const location = useLocation();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    void trackVisit(location.pathname, userId);
  }, [location.pathname, userId]);
}
