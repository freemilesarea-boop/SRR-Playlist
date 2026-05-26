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
  last_play_at: string | null; plays_30d: number; plays_14d: number; plays_prev_14d: number; recent_playlists: string[];
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

export interface MySalespersonProfile {
  is_salesperson: boolean;
  sales_agent_id?: string; code?: string; commission_rate?: number; name?: string;
}
/** 영업인 여부 식별 + (미연결 시) 이메일 기준 자동 연결. 메뉴 노출/대시보드 게이트에 사용. */
export async function fetchMySalespersonProfile(): Promise<MySalespersonProfile> {
  const { data, error } = await supabase.rpc('get_my_salesperson_profile');
  if (error) throw error; return data as MySalespersonProfile;
}
export async function fetchSalespersonStores(): Promise<SalespersonStore[]> {
  const { data, error } = await supabase.rpc('salesperson_my_stores');
  if (error) throw error; return (data ?? []) as SalespersonStore[];
}
export async function fetchSalespersonStoreDetail(storeUserId: string): Promise<SalespersonStoreDetail> {
  const { data, error } = await supabase.rpc('salesperson_store_detail', { p_store_user_id: storeUserId });
  if (error) throw error; return data as SalespersonStoreDetail;
}

export interface SalespersonTrends {
  daily_plays: Array<{ d: string; n: number }>;
  monthly: Array<{ m: string; revenue: number; commission: number; new_stores: number; cumulative_stores: number }>;
}
export async function fetchSalespersonTrends(): Promise<SalespersonTrends> {
  const { data, error } = await supabase.rpc('salesperson_my_trends');
  if (error) throw error; return data as SalespersonTrends;
}

export interface SalespersonTrialStats {
  is_agent: boolean;
  trial_active?: number;
  trial_started_this_month?: number;
  trial_total_started?: number;
  converted?: number;
  converted_this_month?: number;
  conversion_rate?: number;
  ending_soon?: number;
  trial_unpaid?: number;
}
/** 영업인 본인 무료 체험 통계 (0195). 체험중/이번달 시작/유료전환/전환율/종료예정/미결제. */
export async function fetchSalespersonTrialStats(): Promise<SalespersonTrialStats> {
  const { data, error } = await supabase.rpc('salesperson_my_trial_stats');
  if (error) throw error;
  return data as SalespersonTrialStats;
}

/** 매장 위험도 계산 (최근 14일 급감/무사용/결제문제/0회). 클라이언트 파생. */
export function storeRisk(s: SalespersonStore): { level: 'risk' | 'warn' | 'ok'; reason: string | null } {
  const payBad = s.payment_status === 'failed' || s.payment_status === 'canceled' || s.subscription_status === 'canceled';
  if (s.plays_30d === 0) return { level: 'risk', reason: '30일 재생 없음' };
  if (payBad) return { level: 'risk', reason: '결제/구독 문제' };
  if (s.plays_14d === 0) return { level: 'risk', reason: '최근 14일 사용 없음' };
  if (s.plays_prev_14d >= 4 && s.plays_14d < s.plays_prev_14d * 0.5) return { level: 'warn', reason: '사용량 급감' };
  if (s.subscription_status === 'pending') return { level: 'warn', reason: '결제 대기' };
  return { level: 'ok', reason: null };
}
