/**
 * useOperatorAccess — Phase ADMIN-UX-IMPLEMENT-1
 *
 * 운영자 셸(/ops)의 역할 신호를 한곳에서 집계한다. 각 신호의 판정은 기존 훅/RPC 를 그대로
 * 재사용하며, 여기서 권한을 새로 "확대"하지 않는다 (UI 노출만 결정, 실제 접근은 서버가 판정).
 *
 *   • isSuperAdmin    ← admin_my_permissions.is_super_admin (fetchMyAdminPermissions)
 *   • isPlatformAdmin ← profile.role === 'admin' (useAuthStore)
 *   • isHq            ← getMyEnterpriseRole().is_hq || get_my_franchise_admin.is_franchise_admin
 *
 * 모든 RPC 실패/미적용 환경은 false fallback — 기존 흐름 회귀 0.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { fetchMyAdminPermissions } from '@/lib/adminRbacApi';
import { getMyFranchiseAdmin } from '@/lib/api/franchiseApi';
import { getMyEnterpriseRole } from '@/lib/api/enterpriseHqApi';
import type { OperatorAccessContext } from '@/lib/operatorNavigation';
import { isOperator as isOperatorCtx } from '@/lib/operatorNavigation';

export interface OperatorAccessResult extends OperatorAccessContext {
  loading: boolean;
  /** /ops 셸 진입 자격 (플랫폼 관리자 또는 본사). */
  isOperator: boolean;
}

export function useOperatorAccess(): OperatorAccessResult {
  const profile = useAuthStore((s) => s.profile);
  const userId = profile?.id ?? null;
  const isPlatformAdmin = profile?.role === 'admin';

  const [loading, setLoading] = useState<boolean>(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [isHq, setIsHq] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setIsSuperAdmin(false);
      setIsHq(false);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    void (async () => {
      // 각 신호를 독립적으로 조회하고, 실패해도 서로 영향 없이 false fallback.
      const superP = fetchMyAdminPermissions()
        .then((p) => p.is_super_admin === true)
        .catch(() => false);
      const hqP = Promise.all([
        getMyEnterpriseRole().then((r) => r.is_hq === true).catch(() => false),
        getMyFranchiseAdmin().then((a) => a.is_franchise_admin === true).catch(() => false),
      ]).then(([hq, fa]) => hq || fa);

      const [superAdmin, hq] = await Promise.all([superP, hqP]);
      if (cancelled) return;
      setIsSuperAdmin(superAdmin);
      setIsHq(hq);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const ctx: OperatorAccessContext = { isSuperAdmin, isPlatformAdmin, isHq };
  return { loading, isSuperAdmin, isPlatformAdmin, isHq, isOperator: isOperatorCtx(ctx) };
}
