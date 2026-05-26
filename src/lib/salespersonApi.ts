/**
 * salespersonApi.ts — 영업인 본인 대시보드 (매장/매출/수수료 조회).
 * 서버 RPC 가 auth.uid() → sales_agents.user_id 로 본인 매장만 노출(타 영업인 접근 금지).
 * 읽기·집계 전용. 기존 결제/정산 로직 미수정.
 */
import { supabase } from './supabase';

export interface SalespersonSummary {
  is_agent: boolean;
  agent_id?: string; agent_name?: string; code?: string; commission_rate?: number;
  total_stores?: number; active_stores?: number; play_stores_7d?: number; play_stores_30d?: number;
  total_revenue?: number; month_revenue?: number;
  est_total_commission?: number; month_commission?: number; paid_commission?: number; unsettled_commission?: number;
}
export interface SalespersonStore {
  store_user_id: string; store_name: string; owner_name: string | null; joined_at: string;
  subscription_status: string | null; payment_status: string | null;
  last_play_at: string | null; plays_30d: number; recent_playlists: string[];
  monthly_amount: number; est_commission: number;
}
export interface SalespersonStoreDetail {
  store_user_id: string; store_name: string; owner_name: string | null; business_type: string | null;
  joined_at: string; subscription_type: string | null;
  subscriptions: Array<{ plan_type: string | null; status: string | null; amount: number | null; period_start: string | null; period_end: string | null; canceled_at: string | null }>;
  payments: Array<{ order_no: string | null; amount: number | null; status: string | null; paid_at: string | null; refunded_at: string | null }>;
  plays_30d: number; last_play_at: string | null; recent_playlists: string[];
  at_risk: boolean; risk_reason: string | null;
}

export async function fetchSalespersonSummary(): Promise<SalespersonSummary> {
  const { data, error } = await supabase.rpc('salesperson_my_summary');
  if (error) throw error; return data as SalespersonSummary;
}
export async function fetchSalespersonStores(): Promise<SalespersonStore[]> {
  const { data, error } = await supabase.rpc('salesperson_my_stores');
  if (error) throw error; return (data ?? []) as SalespersonStore[];
}
export async function fetchSalespersonStoreDetail(storeUserId: string): Promise<SalespersonStoreDetail> {
  const { data, error } = await supabase.rpc('salesperson_store_detail', { p_store_user_id: storeUserId });
  if (error) throw error; return data as SalespersonStoreDetail;
}
