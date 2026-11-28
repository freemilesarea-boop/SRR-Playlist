import { supabase } from '@/lib/supabase';

/** 이용 기간이 지났는데 아직 '이용 중'인 개인 구독 (migration 0569). */
export interface BillingAttentionRow {
  subscription_id: string;
  user_id: string;
  display_name: string;
  plan_type: string;
  price: number;
  current_period_end: string;
  days_overdue: number;
  last_paid_at: string | null;
  last_payapp_event_at: string | null;
  is_staff: boolean;
}

export interface BillingStaffRow {
  user_id: string;
  display_name: string;
  note: string | null;
  created_at: string;
}

export async function adminListBillingAttention(includeStaff = false): Promise<BillingAttentionRow[]> {
  const { data, error } = await supabase.rpc('admin_list_billing_attention', { p_include_staff: includeStaff });
  if (error) throw error;
  return (data ?? []) as BillingAttentionRow[];
}

export async function adminListBillingStaff(): Promise<BillingStaffRow[]> {
  const { data, error } = await supabase.rpc('admin_list_billing_staff');
  if (error) throw error;
  return (data ?? []) as BillingStaffRow[];
}

export async function adminSetBillingStaff(userId: string, isStaff: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_billing_staff', {
    p_user_id: userId,
    p_is_staff: isStaff,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
}

/** 지난 기간에 따라 묶는다 — 최근 실패(확인 급함)와 오래된 미납을 구분해서 보여 준다. */
export function overdueBucket(days: number): 'recent' | 'month' | 'old' {
  if (days <= 14) return 'recent';
  if (days <= 45) return 'month';
  return 'old';
}

export const PLAN_LABEL: Record<string, string> = {
  individual: '개인',
  artist_student: '아티스트(학생)',
  artist: '아티스트',
  business: '매장',
};
