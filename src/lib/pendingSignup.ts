/**
 * pendingSignup.ts
 *
 * 회원가입 직후 session 이 없는 환경(이메일 인증 ON) 또는 0021 트리거가 적용
 * 안 된 환경에서 가입 정보가 손실되지 않도록 localStorage 백업 → 첫 로그인 시
 * DB 에 자동 적용.
 *
 * 일반적으로는 0021 트리거가 user_metadata 를 읽어 atomic 처리하므로 이 모듈은
 * 보조 안전망. 그래도 두 경로가 충돌하지 않도록 ON CONFLICT 사용.
 */

import { supabase } from './supabase';

const LS_KEY = 'srr-pending-signup';

interface PendingProfile {
  account_type: 'individual' | 'business' | 'artist';
  full_name: string;
  birth_date: string;
  phone: string;
  address: string;
  signup_completed: true;
  artist_approval_status?: 'pending';
  // 0054 — 사업자 가입 시 영업인 코드 연결
  sales_agent_id?: string;
  sales_agent_code?: string;
}

interface PendingArtistFields {
  real_name: string;
  birth_date: string;
  artist_name: string;
  phone: string;
  address: string;
  email: string;
  approval_status: 'pending';
}

interface PendingBvpFields {
  business_number: string;
  business_name: string | null;
  representative_name: string;
  business_open_date: string;
  business_address: string;
  business_type: string | null;
  store_name: string | null;
  store_address: string | null;
  business_verified: boolean;
  verification_status: string;
  business_state: string | null;
  tax_type: string | null;
  verified_at: string | null;
}

export type PendingSignup =
  | { type: 'individual'; email: string; profile: PendingProfile }
  | { type: 'business'; email: string; profile: PendingProfile; bvp: PendingBvpFields }
  | { type: 'artist'; email: string; profile: PendingProfile; artist: PendingArtistFields };

export function readPendingSignup(): PendingSignup | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

export function clearPendingSignup(): void {
  try {
    localStorage.removeItem(LS_KEY);
    // 구버전 키도 같이 정리
    localStorage.removeItem('srr-pending-artist-signup');
  } catch {
    /* noop */
  }
}

/**
 * 첫 로그인 시 호출. localStorage 에 보관된 가입 정보를 DB 에 적용.
 * - 0021 트리거가 이미 처리했어도 ON CONFLICT 로 안전
 * - 적용 성공 시 localStorage 정리
 */
export async function applyPendingSignupOnLogin(
  userId: string,
): Promise<{ ok: boolean; type?: string; error?: string }> {
  const p = readPendingSignup();
  if (!p) return { ok: true };

  try {
    // 1) public.users 업데이트
    const { error: uErr } = await supabase
      .from('users')
      .update({
        account_type: p.profile.account_type,
        full_name: p.profile.full_name,
        birth_date: p.profile.birth_date,
        phone: p.profile.phone,
        address: p.profile.address,
        signup_completed: true,
        ...(p.profile.account_type === 'artist'
          ? { artist_approval_status: 'pending' as const }
          : {}),
        ...(p.profile.sales_agent_id
          ? {
              sales_agent_id: p.profile.sales_agent_id,
              sales_agent_code: p.profile.sales_agent_code ?? null,
            }
          : {}),
      })
      .eq('id', userId);
    if (uErr) {
      if (import.meta.env.DEV) console.error('[pendingSignup] users.update failed:', uErr);
      return { ok: false, error: uErr.message };
    }

    // 2) type 별 부가 테이블
    if (p.type === 'artist') {
      const { error: aErr } = await supabase
        .from('artist_profiles')
        .upsert({ user_id: userId, ...p.artist }, { onConflict: 'user_id' });
      if (aErr) {
        if (import.meta.env.DEV) console.error('[pendingSignup] artist_profiles.upsert failed:', aErr);
        return { ok: false, error: aErr.message };
      }
    } else if (p.type === 'business') {
      const { error: bErr } = await supabase
        .from('business_verification_profiles')
        .upsert({ user_id: userId, ...p.bvp }, { onConflict: 'user_id' });
      if (bErr) {
        if (import.meta.env.DEV) console.error('[pendingSignup] bvp.upsert failed:', bErr);
        return { ok: false, error: bErr.message };
      }
    }

    // 3) 성공 — 캐시 정리
    clearPendingSignup();
    if (import.meta.env.DEV) console.debug('[pendingSignup] applied:', p.type);
    return { ok: true, type: p.type };
  } catch (e) {
    if (import.meta.env.DEV) console.error('[pendingSignup] apply error:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
