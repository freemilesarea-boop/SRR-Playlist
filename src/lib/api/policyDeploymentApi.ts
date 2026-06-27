/**
 * policyDeploymentApi — Enterprise Phase 1-5.
 *
 * 본사 정책 배포 성공률 (Policy Deployment Success Rate) 관측 레이어.
 *
 * 설계:
 *   - 기존 apply_franchise_policy / get_store_active_music_policy / store_heartbeat 무수정
 *   - 새 테이블 2개 (enterprise_policy_deployments / _targets) + 2 view + 7 RPC
 *   - 매장명 fallback: business_profiles → business_verification_profiles → users.full_name → nickname
 *
 * SQL: supabase/migrations/0359_policy_deployment_success.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export type PolicyDeploymentStatus =
  | 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';

export type PolicyDeploymentTargetStatus =
  | 'pending' | 'applying' | 'success' | 'failed' | 'skipped' | 'stale';

export interface PolicyDeployment {
  deployment_id: string;
  deployment_name: string;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  franchise_id: string | null;
  franchise_name: string | null;
  policy_id: string;
  policy_name: string | null;
  policy_version_number: number | null;
  target_store_count: number;
  success_count: number;
  pending_count: number;
  failed_count: number;
  skipped_count: number;
  success_rate: number;        // 0 ~ 100 (소수점 2자리)
  status: PolicyDeploymentStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
}

export interface PolicyDeploymentTarget {
  target_id: string;
  deployment_id: string;
  store_id: string;
  store_name: string;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  enterprise_region_id: string | null;
  region_name: string | null;
  region_code: string | null;
  expected_policy_id: string;
  expected_policy_name: string | null;
  expected_version_number: number | null;
  applied_policy_id: string | null;
  applied_policy_name: string | null;
  applied_version_number: number | null;
  status: PolicyDeploymentTargetStatus;
  last_attempt_at: string | null;
  applied_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  last_seen_at: string | null;
  last_synced_at: string | null;
  current_active_policy_id: string | null;
  current_active_version_number: number | null;
  current_player_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyDeploymentKpi {
  total_deployments: number;
  running: number;
  completed: number;
  partial_failed: number;
  failed: number;
  cancelled: number;
  avg_success_rate: number;
  recent_24h: number;
  computed_at: string;
}

export interface PolicyDeploymentListParams {
  search?: string | null;
  status?: PolicyDeploymentStatus | null;
  enterpriseAccountId?: string | null;
  franchiseId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface PolicyDeploymentListResponse {
  success: boolean;
  data: PolicyDeployment[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface PolicyDeploymentCreateInput {
  policyId: string;
  deploymentName?: string | null;
  storeIds?: string[] | null;                // null = 정책의 franchise 의 모든 active 매장
  enterpriseAccountId?: string | null;
}

export interface PolicyDeploymentDetail {
  success: boolean;
  deployment: PolicyDeployment;
  targets: PolicyDeploymentTarget[];
  distribution: {
    success: number;
    pending: number;
    failed: number;
    stale: number;
    skipped: number;
  };
  computed_at: string;
}

export interface PolicyDeploymentCreateResult {
  success: boolean;
  deployment_id: string;
  target_store_count: number;
  policy_version_number: number;
}

export interface PolicyDeploymentRecomputeResult {
  success: boolean;
  deployment_id: string;
  counts: { success: number; pending: number; failed: number; skipped: number };
  status: PolicyDeploymentStatus;
  computed_at: string;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function listPolicyDeployments(
  params: PolicyDeploymentListParams = {},
): Promise<PolicyDeploymentListResponse> {
  const { data, error } = await supabase.rpc('admin_list_policy_deployments', {
    p_search: params.search ?? null,
    p_status: params.status ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_franchise_id: params.franchiseId ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) { console.error('[policyDeploymentApi] list failed', error); throw error; }
  return data as PolicyDeploymentListResponse;
}

export async function getPolicyDeploymentKpi(): Promise<PolicyDeploymentKpi> {
  const { data, error } = await supabase.rpc('admin_policy_deployment_kpi');
  if (error) { console.error('[policyDeploymentApi] kpi failed', error); throw error; }
  return data as PolicyDeploymentKpi;
}

export async function getPolicyDeploymentDetail(
  deploymentId: string,
): Promise<PolicyDeploymentDetail> {
  const { data, error } = await supabase.rpc('admin_get_policy_deployment_detail', {
    p_deployment_id: deploymentId,
  });
  if (error) { console.error('[policyDeploymentApi] detail failed', error); throw error; }
  return data as PolicyDeploymentDetail;
}

export async function createPolicyDeployment(
  input: PolicyDeploymentCreateInput,
): Promise<PolicyDeploymentCreateResult> {
  const { data, error } = await supabase.rpc('admin_create_policy_deployment', {
    p_policy_id: input.policyId,
    p_deployment_name: input.deploymentName ?? null,
    p_store_ids: input.storeIds ?? null,
    p_enterprise_account_id: input.enterpriseAccountId ?? null,
  });
  if (error) { console.error('[policyDeploymentApi] create failed', error); throw error; }
  return data as PolicyDeploymentCreateResult;
}

export async function recomputePolicyDeployment(
  deploymentId: string,
): Promise<PolicyDeploymentRecomputeResult> {
  const { data, error } = await supabase.rpc('admin_recompute_policy_deployment', {
    p_deployment_id: deploymentId,
  });
  if (error) { console.error('[policyDeploymentApi] recompute failed', error); throw error; }
  return data as PolicyDeploymentRecomputeResult;
}

export async function markPolicyTargetFailed(
  deploymentId: string,
  storeId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_policy_target_failed', {
    p_deployment_id: deploymentId,
    p_store_id: storeId,
    p_reason: reason,
  });
  if (error) { console.error('[policyDeploymentApi] mark_failed failed', error); throw error; }
}

export async function retryPolicyDeploymentTargets(
  deploymentId: string,
  onlyFailed = true,
): Promise<{ success: boolean; deployment_id: string; retried_count: number }> {
  const { data, error } = await supabase.rpc('admin_retry_policy_deployment_targets', {
    p_deployment_id: deploymentId,
    p_only_failed: onlyFailed,
  });
  if (error) { console.error('[policyDeploymentApi] retry failed', error); throw error; }
  return data as { success: boolean; deployment_id: string; retried_count: number };
}
