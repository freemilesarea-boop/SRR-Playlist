/**
 * useEnterpriseSelfRole — Phase 1-7
 *
 * 로그인 사용자의 enterprise 역할 판별:
 *   - is_hq:    enterprise_accounts.auth_user_id = auth.uid()
 *   - is_store: account_type='business' + franchise_stores.store_id = auth.uid()
 *               + enterprise_franchises 매핑 존재
 *
 * ProfilePage 가 mount 시 1회 호출하여 카드 분기 사용.
 * RPC 실패 / 미적용 환경은 모두 false fallback — 기존 흐름 회귀 0.
 */
import { useEffect, useState } from 'react';
import {
  getMyEnterpriseRole,
  getMyEnterpriseStoreInfo,
  type EnterpriseHqRole,
  type EnterpriseStoreInfo,
} from '@/lib/api/enterpriseHqApi';

export interface EnterpriseSelfRoleResult {
  loading: boolean;
  role: EnterpriseHqRole;
  storeInfo: EnterpriseStoreInfo;
}

export function useEnterpriseSelfRole(userId: string | null | undefined): EnterpriseSelfRoleResult {
  const [loading, setLoading] = useState<boolean>(true);
  const [role, setRole] = useState<EnterpriseHqRole>({ is_hq: false });
  const [storeInfo, setStoreInfo] = useState<EnterpriseStoreInfo>({ is_store: false });

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setLoading(false);
      setRole({ is_hq: false });
      setStoreInfo({ is_store: false });
      return () => { cancelled = true; };
    }
    setLoading(true);
    void (async () => {
      const [r, s] = await Promise.all([
        getMyEnterpriseRole(),
        getMyEnterpriseStoreInfo(),
      ]);
      if (cancelled) return;
      setRole(r);
      setStoreInfo(s);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { loading, role, storeInfo };
}
