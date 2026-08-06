// Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-1 — 아티스트 결제 접근 상태 훅.
// 서버 RPC(get_artist_billing_access)로 실시간 판정을 조회한다. 결제·취소 Webhook
// 이후 refresh() 로 즉시 갱신(로그아웃 불필요). 실패 시 Fail-Closed.

import { useCallback, useEffect, useState } from 'react';
import { getArtistBillingAccess, type ArtistBillingAccessResult } from '@/lib/artistBillingAccess';

export interface UseArtistBillingAccess {
  access: ArtistBillingAccessResult | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useArtistBillingAccess(enabled = true): UseArtistBillingAccess {
  const [access, setAccess] = useState<ArtistBillingAccessResult | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAccess(await getArtistBillingAccess());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const a = await getArtistBillingAccess();
      if (alive) {
        setAccess(a);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, refresh]);

  return { access, loading, refresh };
}
