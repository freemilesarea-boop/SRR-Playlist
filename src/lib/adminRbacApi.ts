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
  id: string; action: string; target_email: string | null; detail: unknown; created_at: string; actor_email: string | null;
}

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
