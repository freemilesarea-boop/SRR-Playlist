/**
 * trialApi.ts — 영업인 코드 3일 무료 체험 (0195).
 *
 * 체험 판정/시작/만료는 모두 서버 RPC 가 책임진다 (서버 기준).
 *   - startSalesAgentTrial: 사업자 본인이 유효 코드로 체험 시작
 *   - getMyTrialStatus: 본인 체험 상태 (만료 시 서버가 lazy-expire 후 반환)
 *   - maybeAutoStartTrial: 로그인/프로필 로드 후 사업자에 한해 1회 자동 시작
 *       (영업인 코드 있으면 코드 경로, 없으면 사업자등록 경로)
 *   - startVerifiedBusinessTrial: 사업자등록 완료 시 영업인 코드 없이 3일 개방 (0530)
 *   - getBusinessTrialGate: 재생 차단 안내 문구 선택용 게이트 상태 (0530)
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
 * 로그인/프로필 로드 직후 호출. 사업자 + 아직 체험 시작 전 + 무료 회원인 경우에
 * 체험을 자동으로 시작한다. (이미 사용/유료 등은 서버가 차단.)
 *
 * 경로 2개 — 둘 다 자격 판정은 서버가 한다:
 *   1) 영업인 코드가 연결돼 있으면 기존 start_sales_agent_trial (실적 귀속 O)
 *   2) 코드가 없으면 사업자등록 기반 start_verified_business_trial
 *      (0530 · 영업인 귀속/할인 없음. 사업자등록 미완료면 서버가 거부하므로
 *       등록 전에 호출돼도 안전하다.)
 *
 * 성공 시 onStarted 콜백으로 프로필 갱신 트리거.
 */
export async function maybeAutoStartTrial(
  profile: UserRow | null,
  onStarted?: (endsAt: string) => void,
): Promise<void> {
  if (!profile) return;
  if (profile.account_type !== 'business') return;
  if (profile.free_trial_started_at) return; // 이미 시작했음
  const tier = profile.membership_tier ?? null;
  if (tier === 'individual' || tier === 'business') return; // 이미 유료
  if (autoStartAttempted.has(profile.id)) return;
  autoStartAttempted.add(profile.id);

  if (profile.sales_agent_code) {
    const r = await startSalesAgentTrial(profile.sales_agent_code);
    if (r.ok && r.free_trial_ends_at) {
      onStarted?.(r.free_trial_ends_at);
      return;
    }
  }

  const v = await startVerifiedBusinessTrial();
  if (v.ok && v.free_trial_ends_at) onStarted?.(v.free_trial_ends_at);
}

// ---------- 사업자등록 기반 체험 (0530, 영업인 코드 없음) ----------

export type BusinessTrialGateReason =
  | 'login_required' | 'not_business' | 'already_paid'
  | 'trial_active' | 'trial_used' | 'registration_required' | 'ok';

export interface BusinessTrialGate {
  signed_in: boolean;
  is_business: boolean;
  /** 사업자등록 접수 완료 (verified | manual_review) */
  registered: boolean;
  registration_status: 'verified' | 'manual_review' | 'rejected' | 'none' | string;
  business_verified: boolean;
  paid: boolean;
  trial_active: boolean;
  trial_used: boolean;
  free_trial_ends_at: string | null;
  can_start_trial: boolean;
  reason: BusinessTrialGateReason;
}

/** 재생 차단 안내 문구를 고르기 위한 게이트 상태. 판정은 서버가 한다. */
export async function getBusinessTrialGate(): Promise<BusinessTrialGate | null> {
  const { data, error } = await supabase.rpc('get_business_trial_gate');
  if (error) return null;
  return (data ?? null) as BusinessTrialGate | null;
}

/**
 * 사업자등록을 마친 사업자 회원에게 영업인 코드 없이 3일 체험을 연다.
 * 자격·중복·1회 제한은 서버가 판정하므로 호출은 안전하다(멱등).
 */
export async function startVerifiedBusinessTrial(): Promise<{
  ok: boolean; free_trial_ends_at?: string; reason?: string; error?: string;
}> {
  const { data, error } = await supabase.rpc('start_verified_business_trial');
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { ok?: boolean; free_trial_ends_at?: string; reason?: string; message?: string };
  return r.ok
    ? { ok: true, free_trial_ends_at: r.free_trial_ends_at }
    : { ok: false, reason: r.reason, error: r.message };
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
