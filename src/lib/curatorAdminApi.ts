/**
 * curatorAdminApi.ts — Phase X6.6
 *
 * 관리자 큐레이터 관리 RPC 래퍼.
 *   - 목록 / 검색 / 상태 필터
 *   - 비활성화 / soft delete / restore
 *   - 감사 로그 조회
 *
 * 정책: hard delete 없음. status='deleted' + deleted_at + delete_reason 만 기록.
 */
import { supabase } from '@/lib/supabase';

export type CuratorStatus = 'active' | 'inactive' | 'deleted';

export interface AdminCuratorRow {
  curator_id: string;
  display_name: string;
  handle: string;
  contact_email: string | null;
  user_email: string | null;
  user_id: string;
  status: CuratorStatus;
  is_verified: boolean;
  is_featured: boolean;
  created_at: string;
  last_active_at: string | null;
  deactivated_at: string | null;
  deactivate_reason: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  deleted_by: string | null;
  playlist_count: number;
  active_playlist_count: number;
}

export interface ListCuratorsFilter {
  status?: CuratorStatus | '';
  search?: string;
  limit?: number;
  offset?: number;
}

export async function adminListCurators(filter: ListCuratorsFilter = {}): Promise<AdminCuratorRow[]> {
  const { data, error } = await supabase.rpc('admin_list_curators', {
    p_status: filter.status || null,
    p_search: filter.search || null,
    p_limit: filter.limit ?? 100,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as AdminCuratorRow[];
}

export interface DeactivateResult {
  ok: true;
  curator_id: string;
  status: CuratorStatus;
  noop?: boolean;
}

export async function adminDeactivateCurator(
  curatorId: string, reason: string,
): Promise<DeactivateResult> {
  const { data, error } = await supabase.rpc('admin_deactivate_curator', {
    p_curator_id: curatorId,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data as DeactivateResult;
}

export interface SoftDeleteResult {
  ok: true;
  curator_id: string;
  status: CuratorStatus;
  archived_drafts: number;
  preserved_active_playlists: number;
  total_playlists: number;
}

export interface SoftDeleteOptions {
  reason: string;
  archiveDrafts?: boolean;
  reassignPlaylists?: boolean;
}

export async function adminSoftDeleteCurator(
  curatorId: string, opts: SoftDeleteOptions,
): Promise<SoftDeleteResult> {
  const { data, error } = await supabase.rpc('admin_soft_delete_curator', {
    p_curator_id: curatorId,
    p_reason: opts.reason || null,
    p_archive_drafts: opts.archiveDrafts ?? true,
    p_reassign_playlists: opts.reassignPlaylists ?? true,
  });
  if (error) throw error;
  return data as SoftDeleteResult;
}

export async function adminRestoreCurator(
  curatorId: string,
): Promise<{ ok: true; curator_id: string; status: CuratorStatus; noop?: boolean }> {
  const { data, error } = await supabase.rpc('admin_restore_curator', {
    p_curator_id: curatorId,
  });
  if (error) throw error;
  return data as { ok: true; curator_id: string; status: CuratorStatus; noop?: boolean };
}

export type CuratorAuditAction =
  | 'deactivate' | 'soft_delete' | 'restore'
  | 'archive_playlist' | 'reassign_playlist' | 'update';

export interface CuratorAuditLog {
  id: number;
  action: CuratorAuditAction;
  before_status: string | null;
  after_status: string | null;
  admin_user_id: string | null;
  admin_email: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export async function adminGetCuratorAuditLogs(
  curatorId: string, limit = 50,
): Promise<CuratorAuditLog[]> {
  const { data, error } = await supabase.rpc('admin_get_curator_audit_logs', {
    p_curator_id: curatorId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as CuratorAuditLog[];
}
