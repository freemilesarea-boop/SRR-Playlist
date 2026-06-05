/**
 * salesAgentApi.ts
 *
 * 영업인(sales agent) 관련 API.
 *   - verifySalesAgentCode: 사업자 가입 폼에서 호출 (비로그인 가능)
 *   - 그 외 admin_* RPC 들은 관리자 페이지 전용
 *
 * 0054_sales_agents.sql 가 적용되지 않은 환경에서는 RPC 가 존재하지 않아
 * supabase 가 PGRST202(function not found) 를 던짐. 호출부에서 catch 하여
 * "마이그레이션 미적용" 안내로 폴백 처리 권장.
 */

import { supabase } from './supabase';

export interface SalesAgentListRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  code: string;
  commission_rate: number;
  is_active: boolean;
  linked_business_count: number;
  paid_business_count: number;
  total_paid_amount: number;
  total_commission_amount: number;
  /** @deprecated 0055 이후 total_commission_amount 와 동일. 호환성용. */
  estimated_commission: number;
  monthly_paid_amount: number;
  monthly_commission_amount: number;
  monthly_paid_count: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
}

export interface SalesAgentDetail {
  agent: {
    id: string;
    user_id: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    code: string;
    commission_rate: number;
    is_active: boolean;
    note: string | null;
    created_at: string;
    updated_at: string;
  };
  businesses: Array<{
    user_id: string;
    email: string | null;
    nickname: string | null;
    full_name: string | null;
    phone: string | null;
    account_type: string | null;
    membership_tier: string | null;
    subscription_type: string | null;
    business_number: string | null;
    store_name: string | null;
    created_at: string;
  }>;
  payments: Array<{
    id: string;
    user_id: string;
    order_no: string;
    plan_type: string;
    amount: number;
    status: string;
    paid_at: string | null;
    created_at: string;
  }>;
  summary: {
    linked_business_count: number;
    paid_business_count: number;
    total_paid_amount: number;
    total_commission_amount: number;
    /** @deprecated 0055 이후 total_commission_amount 와 동일. */
    estimated_commission: number;
    monthly_paid_amount: number;
    monthly_commission_amount: number;
    monthly_paid_count: number;
    month_window_start?: string;
    month_window_end?: string;
  };
}

export interface VerifiedSalesAgent {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  // X6.12 — 서버가 코드별 plan 정보 직접 제공 (클라이언트가 코드 매핑을 알 필요 없음)
  plan_type: 'general_artist' | 'student_artist' | 'legacy_student' | null;
  plan_label: string;
  monthly_quota: number;
}

/**
 * 영업인 코드 검증 — 가입 단계에서 호출. 활성 코드만 매칭.
 * 결과:
 *   - 입력 비어있음 → null (검증 안 한 것과 동일 취급)
 *   - 코드 존재 + 활성 → VerifiedSalesAgent
 *   - 존재하지 않거나 비활성 → null
 */
export async function verifySalesAgentCode(
  code: string,
): Promise<VerifiedSalesAgent | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.rpc('verify_sales_agent_code', { p_code: trimmed });
  if (error) throw error;
  const rows = (data ?? []) as VerifiedSalesAgent[];
  return rows[0] ?? null;
}

export async function fetchSalesAgentList(): Promise<SalesAgentListRow[]> {
  const { data, error } = await supabase.rpc('admin_sales_agent_list');
  if (error) throw error;
  return (data ?? []) as SalesAgentListRow[];
}

export async function fetchSalesAgentDetail(id: string): Promise<SalesAgentDetail | null> {
  const { data, error } = await supabase.rpc('admin_sales_agent_detail', { p_id: id });
  if (error) throw error;
  return (data ?? null) as SalesAgentDetail | null;
}

export interface UpsertSalesAgentInput {
  id?: string | null;
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  code?: string | null;
  commission_rate?: number | null;
  is_active?: boolean | null;
  note?: string | null;
}

export async function upsertSalesAgent(input: UpsertSalesAgentInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_sales_agent_upsert', {
    p_id: input.id ?? null,
    p_user_id: input.user_id ?? null,
    p_name: input.name ?? null,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_code: input.code ?? null,
    p_commission_rate: input.commission_rate ?? null,
    p_is_active: input.is_active ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function generateSalesAgentCode(): Promise<string> {
  const { data, error } = await supabase.rpc('admin_generate_sales_agent_code');
  if (error) throw error;
  return data as string;
}
