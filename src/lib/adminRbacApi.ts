/**
 * adminRbacApi.ts — 역할 기반 관리자 권한(RBAC) 클라이언트.
 * 권한 체크는 서버 RPC 가 최종 판정. UI 게이트용으로 myPermissions 사용.
 */
import { supabase } from './supabase';

export type AdminRole = 'super_admin' | 'content_admin' | 'curator_admin' | 'sales_admin' | 'reviewer';
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: '슈퍼관리자', content_admin: '콘텐츠 관리자', curator_admin: '큐레이션 관리자',
  sales_admin: '영업 관리자', reviewer: '검수자',
};

export interface AdminPermissions {
  role: AdminRole | null;
  is_super_admin: boolean; can_manage_admins: boolean; can_override_guardrails: boolean;
  can_manage_tracks: boolean; can_manage_sales: boolean; can_manage_curation: boolean; can_review_tracks: boolean;
}
export interface AdminUserRow {
  id: string; user_id: string | null; email: string; role: AdminRole; is_active: boolean;
  created_at: string; invited_by: string | null; linked: boolean; last_action_at: string | null;
}
export interface AdminActionLogRow {
  id: string; action: string; target_email: string | null; target_id: string | null;
  target_title: string | null; detail: unknown; created_at: string; actor_email: string | null;
}

export const ADMIN_ACTION_LABELS: Record<string, string> = {
  settlement_generate: '정산서 생성', settlement_finalize: '정산 확정', settlement_mark_paid: '정산 지급 완료',
  settlement_mark_held: '정산 보류', track_takedown: '음원 공개중단', track_approve: '음원 승인',
  track_force_approve: '음원 강제 승인', guardrail_override: 'Guardrail override',
  guardrail_bulk_override: 'Guardrail 일괄 override', commission_payout: '수수료 정산 지급',
  sales_agent_upsert: '영업인 등록/수정', add_admin: '관리자 추가', update_role: '관리자 역할 변경',
  activate: '관리자 활성화', deactivate: '관리자 비활성화',
};

export async function fetchMyAdminPermissions(): Promise<AdminPermissions> {
  const { data, error } = await supabase.rpc('admin_my_permissions');
  if (error) throw error; return data as AdminPermissions;
}
export async function listAdmins(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc('admin_list_admins');
  if (error) throw error; return (data ?? []) as AdminUserRow[];
}
export async function addAdmin(email: string, role: AdminRole): Promise<{ ok: boolean; linked: boolean }> {
  const { data, error } = await supabase.rpc('admin_add_admin', { p_email: email, p_role: role });
  if (error) throw error; return data as { ok: boolean; linked: boolean };
}
export async function updateAdminRole(id: string, role: AdminRole): Promise<void> {
  const { error } = await supabase.rpc('admin_update_admin_role', { p_id: id, p_role: role });
  if (error) throw error;
}
export async function setAdminActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_admin_active', { p_id: id, p_active: active });
  if (error) throw error;
}
export async function fetchAdminActionLog(limit = 100): Promise<AdminActionLogRow[]> {
  const { data, error } = await supabase.rpc('admin_recent_action_log', { p_limit: limit });
  if (error) throw error; return (data ?? []) as AdminActionLogRow[];
}
