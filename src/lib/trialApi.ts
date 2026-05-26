/**
 * trialApi.ts — 영업인 코드 3일 무료 체험 (0195).
 *
 * 체험 판정/시작/만료는 모두 서버 RPC 가 책임진다 (서버 기준).
 *   - startSalesAgentTrial: 사업자 본인이 유효 코드로 체험 시작
 *   - getMyTrialStatus: 본인 체험 상태 (만료 시 서버가 lazy-expire 후 반환)
 *   - maybeAutoStartTrial: 로그인/프로필 로드 후, 코드 연결된 사업자에 한해 1회 자동 시작
 *   - admin_*: 관리자 연장/강제종료/목록
 */

import { supabase } from './supabase';
import type { UserRow } from '@/types/db';

export type SubscriptionStatus = 'anonymous' | 'active' | 'trial' | 'expired' | 'free';

export interface TrialStatus {
  subscription_status: SubscriptionStatus;
  has_trial: boolean;
  is_trial_active: boolean;
  playback_enabled: boolean;
  free_trial_started_at: string | null;
  free_trial_ends_at: string | null;
  remaining_seconds: number;
}

export interface StartTrialResult {
  ok: boolean;
  error?: string;
  free_trial_ends_at?: string;
  sales_agent_name?: string;
}

/** 사업자 본인이 영업인 코드로 무료 체험 시작. 모든 검증/악용방지는 서버에서. */
export async function startSalesAgentTrial(code: string): Promise<StartTrialResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: '영업인 코드를 입력해주세요.' };
  const { data, error } = await supabase.rpc('start_sales_agent_trial', { p_code: trimmed });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; free_trial_ends_at?: string; sales_agent_name?: string };
  return r.ok
    ? { ok: true, free_trial_ends_at: r.free_trial_ends_at, sales_agent_name: r.sales_agent_name }
    : { ok: false, error: '체험 시작에 실패했어요.' };
}

export async function getMyTrialStatus(): Promise<TrialStatus | null> {
  const { data, error } = await supabase.rpc('get_my_trial_status');
  if (error) return null;
  return (data ?? null) as TrialStatus | null;
}

// 자동 시작 중복 호출 방지 (한 세션에서 user 당 1회만 시도)
const autoStartAttempted = new Set<string>();

/**
 * 로그인/프로필 로드 직후 호출. 사업자 + 영업인 코드 연결 + 아직 체험 시작 전 +
 * 무료 회원인 경우에만 체험을 자동으로 시작한다. (이미 사용/유료 등은 서버가 차단.)
 * 성공 시 onStarted 콜백으로 프로필 갱신 트리거.
 */
export async function maybeAutoStartTrial(
  profile: UserRow | null,
  onStarted?: (endsAt: string) => void,
): Promise<void> {
  if (!profile) return;
  if (profile.account_type !== 'business') return;
  if (!profile.sales_agent_code) return;
  if (profile.free_trial_started_at) return; // 이미 시작했음
  const tier = profile.membership_tier ?? null;
  if (tier === 'individual' || tier === 'business') return; // 이미 유료
  if (autoStartAttempted.has(profile.id)) return;
  autoStartAttempted.add(profile.id);

  const r = await startSalesAgentTrial(profile.sales_agent_code);
  if (r.ok && r.free_trial_ends_at) onStarted?.(r.free_trial_ends_at);
}

// ---------- 관리자 ----------

export interface AdminFreeTrialRow {
  id: string;
  user_id: string | null;
  email: string | null;
  store_name: string | null;
  business_number: string | null;
  phone: string | null;
  sales_agent_code: string | null;
  sales_agent_name: string | null;
  started_at: string;
  ends_at: string;
  status: 'active' | 'expired' | 'revoked';
  membership_tier: string | null;
  converted: boolean;
  days_left: number;
}

export async function adminListFreeTrials(
  status?: 'active' | 'expired' | 'revoked',
  limit = 200,
): Promise<AdminFreeTrialRow[]> {
  const { data, error } = await supabase.rpc('admin_list_free_trials', {
    p_limit: limit,
    p_status: status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as AdminFreeTrialRow[];
}

export async function adminExtendTrial(userId: string, days = 3): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_extend_trial', { p_user_id: userId, p_days: days });
  if (error) return { ok: false, error: error.message };
  return { ok: !!(data as { ok?: boolean })?.ok };
}

export async function adminEndTrial(userId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_end_trial', { p_user_id: userId, p_reason: reason ?? null });
  if (error) return { ok: false, error: error.message };
  return { ok: !!(data as { ok?: boolean })?.ok };
}
