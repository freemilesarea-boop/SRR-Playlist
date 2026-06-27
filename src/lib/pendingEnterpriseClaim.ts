/**
 * pendingEnterpriseClaim — Phase 1-6 §4 보조 안전망.
 *
 * 이메일 인증 ON 환경에서는 signUp 직후 세션이 없어 claim_enterprise_*
 * RPC 를 즉시 호출할 수 없음. 가입 시점에 입력값을 localStorage 에 캐싱하고,
 * 첫 로그인 시 authStore 가 apply 함수를 호출하여 실제 claim 실행.
 *
 * - applyPendingEnterpriseClaimOnLogin: success / already_done / failed / skipped
 * - 실패해도 사용자 차단 X (toast/console 만, 사용자가 재시도 가능)
 */

import {
  claimEnterpriseHqAccount,
  claimEnterpriseStoreAccount,
  type EnterpriseHqClaimResult,
  type EnterpriseStoreClaimResult,
} from '@/lib/api/enterpriseAccountsApi';

const LS_KEY = 'srr-pending-enterprise-claim';

export type PendingEnterpriseClaim =
  | {
      type: 'hq';
      email: string;
      brandName: string;
      inviteCode: string;
      userAgent: string | null;
    }
  | {
      type: 'store';
      email: string;
      brandName: string;
      inviteCode: string;
      storeName: string;
      regionName: string;
      userAgent: string | null;
    };

export function setPendingEnterpriseClaim(claim: PendingEnterpriseClaim): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(claim));
  } catch (e) {
    console.warn('[pendingEnterpriseClaim] write failed', e);
  }
}

export function readPendingEnterpriseClaim(): PendingEnterpriseClaim | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingEnterpriseClaim;
  } catch {
    return null;
  }
}

export function clearPendingEnterpriseClaim(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

export interface ApplyResult {
  ok: boolean;
  type?: 'hq' | 'store';
  reason?: string;
  skipped?: 'no_cache' | 'email_mismatch';
}

/**
 * 첫 로그인 시 호출. localStorage 에 캐시된 enterprise claim 을 실제 RPC 로 실행.
 * - 캐시 없음 → ok=true, skipped='no_cache'
 * - 캐시 email ≠ 로그인 email → ok=false, skipped='email_mismatch' (캐시는 보존, 다른 사람 로그인)
 * - claim 성공 → ok=true + 캐시 제거
 * - claim 실패 → ok=false + 캐시 보존 (다음 로그인에서 재시도)
 */
export async function applyPendingEnterpriseClaimOnLogin(
  currentEmail: string | null | undefined,
): Promise<ApplyResult> {
  const p = readPendingEnterpriseClaim();
  if (!p) return { ok: true, skipped: 'no_cache' };

  // 다른 사용자가 로그인한 경우 — 캐시 보존, claim 안 함
  if (currentEmail && p.email && p.email.toLowerCase() !== currentEmail.toLowerCase()) {
    return { ok: false, skipped: 'email_mismatch' };
  }

  if (p.type === 'hq') {
    let res: EnterpriseHqClaimResult;
    try {
      res = await claimEnterpriseHqAccount({
        brandName: p.brandName,
        inviteCode: p.inviteCode,
        userAgent: p.userAgent,
      });
    } catch (e) {
      return { ok: false, type: 'hq', reason: (e as Error).message };
    }
    if (res.success) {
      clearPendingEnterpriseClaim();
      return { ok: true, type: 'hq' };
    }
    // 이미 본인 claim 한 경우 RPC 는 idempotent success — 여기 도달은 진짜 실패
    return { ok: false, type: 'hq', reason: res.reason };
  }

  // type === 'store'
  let res: EnterpriseStoreClaimResult;
  try {
    res = await claimEnterpriseStoreAccount({
      brandName: p.brandName,
      inviteCode: p.inviteCode,
      storeName: p.storeName,
      regionName: p.regionName,
      userAgent: p.userAgent,
    });
  } catch (e) {
    return { ok: false, type: 'store', reason: (e as Error).message };
  }
  if (res.success) {
    clearPendingEnterpriseClaim();
    return { ok: true, type: 'store' };
  }
  return { ok: false, type: 'store', reason: res.reason };
}
