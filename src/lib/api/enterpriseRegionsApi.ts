/**
 * enterpriseRegionsApi — Enterprise Phase 1-2 v2 (Region Management 완성).
 *
 * 본사별 지역 (서울/경기/부산 등) 관리.
 * - status: active / inactive / suspended / maintenance (0375)
 * - default_policy_id: 지역 기본 정책 FK (franchise_music_policies) (0375)
 * - list 응답 확장: default_policy_name/status, online_count, recent_24h_count, offline_count
 * - kpi 응답 확장: online_stores, offline_stores, maintenance_regions
 *
 * SQL: supabase/migrations/0352, 0375
 */
import { supabase } from '@/lib/supabase';

export type EnterpriseRegionStatus = 'active' | 'inactive' | 'suspended' | 'maintenance';

export interface EnterpriseRegion {
  id: string;
  enterprise_account_id: string;
  region_name: string;
  region_code: string;
  manager_name: string | null;
  manager_email: string | null;
  manager_phone: string | null;
  status: EnterpriseRegionStatus;
  store_count: number;
  last_policy_applied_at: string | null;
  notes: string | null;
  default_policy_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  // joined fields (list RPC 만)
  enterprise_name?: string | null;
  enterprise_manager_email?: string | null;
  default_policy_name?: string | null;
  default_policy_status?: string | null;
  online_count?: number;
  recent_24h_count?: number;
  offline_count?: number;
}

export interface EnterpriseRegionListParams {
  enterpriseAccountId?: string | null;
  search?: string | null;
  status?: EnterpriseRegionStatus | null;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface EnterpriseRegionListResponse {
  success: boolean;
  data: EnterpriseRegion[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface EnterpriseRegionCreateInput {
  enterpriseAccountId: string;
  regionName: string;
  regionCode: string;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  status?: EnterpriseRegionStatus;
  notes?: string | null;
}

export interface EnterpriseRegionUpdateInput {
  regionName?: string | null;
  regionCode?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  status?: EnterpriseRegionStatus | null;
  notes?: string | null;
  /** Priority 1-2 (0375) — 지역 기본 정책 변경 */
  defaultPolicyId?: string | null;
}

export interface EnterpriseRegionKpi {
  total_regions: number;
  active_regions: number;
  inactive_regions: number;
  /** 0375 — maintenance 상태 카운트 */
  maintenance_regions?: number;
  suspended_regions: number;
  total_stores: number;
  /** 0375 — sync_status JOIN 기반 (5min threshold) */
  online_stores?: number;
  /** 0375 — sync_status JOIN 기반 */
  offline_stores?: number;
  regions_with_policy_applied: number;
  computed_at: string;
}

export interface RegionRecountResult {
  success: boolean;
  updated_count: number;
  note: string;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function listEnterpriseRegions(
  params: EnterpriseRegionListParams = {},
): Promise<EnterpriseRegionListResponse> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_regions', {
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_search: params.search ?? null,
    p_status: params.status ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_include_deleted: params.includeDeleted ?? false,
  });
  if (error) { console.error('[enterpriseRegionsApi] list failed', error); throw error; }
  return data as EnterpriseRegionListResponse;
}

export async function createEnterpriseRegion(
  input: EnterpriseRegionCreateInput,
): Promise<EnterpriseRegion> {
  const { data, error } = await supabase.rpc('admin_create_enterprise_region', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_region_name: input.regionName,
    p_region_code: input.regionCode,
    p_manager_name: input.managerName ?? null,
    p_manager_email: input.managerEmail ?? null,
    p_manager_phone: input.managerPhone ?? null,
    p_status: input.status ?? 'active',
    p_notes: input.notes ?? null,
  });
  if (error) { console.error('[enterpriseRegionsApi] create failed', error); throw error; }
  return data as EnterpriseRegion;
}

export async function updateEnterpriseRegion(
  id: string, input: EnterpriseRegionUpdateInput,
): Promise<EnterpriseRegion> {
  const { data, error } = await supabase.rpc('admin_update_enterprise_region', {
    p_id: id,
    p_region_name: input.regionName ?? null,
    p_region_code: input.regionCode ?? null,
    p_manager_name: input.managerName ?? null,
    p_manager_email: input.managerEmail ?? null,
    p_manager_phone: input.managerPhone ?? null,
    p_status: input.status ?? null,
    p_notes: input.notes ?? null,
    p_default_policy_id: input.defaultPolicyId ?? null,
  });
  if (error) { console.error('[enterpriseRegionsApi] update failed', error); throw error; }
  return data as EnterpriseRegion;
}

export async function setEnterpriseRegionStatus(
  id: string, status: EnterpriseRegionStatus,
): Promise<EnterpriseRegion> {
  const { data, error } = await supabase.rpc('admin_set_enterprise_region_status', {
    p_id: id, p_status: status,
  });
  if (error) { console.error('[enterpriseRegionsApi] set_status failed', error); throw error; }
  return data as EnterpriseRegion;
}

export async function softDeleteEnterpriseRegion(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_soft_delete_enterprise_region', { p_id: id });
  if (error) { console.error('[enterpriseRegionsApi] soft_delete failed', error); throw error; }
}

export async function getEnterpriseRegionKpi(
  enterpriseAccountId?: string,
): Promise<EnterpriseRegionKpi> {
  const { data, error } = await supabase.rpc('admin_enterprise_region_kpi', {
    p_enterprise_account_id: enterpriseAccountId ?? null,
  });
  if (error) { console.error('[enterpriseRegionsApi] kpi failed', error); throw error; }
  return data as EnterpriseRegionKpi;
}

export async function recountEnterpriseRegionStores(id?: string): Promise<RegionRecountResult> {
  const { data, error } = await supabase.rpc('admin_recount_enterprise_region_stores', {
    p_id: id ?? null,
  });
  if (error) { console.error('[enterpriseRegionsApi] recount failed', error); throw error; }
  return data as RegionRecountResult;
}
