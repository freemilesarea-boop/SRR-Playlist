/**
 * policyAutomationApi — Enterprise Priority 3 (Policy Automation Engine V1).
 *
 * 예약(scheduled) / 반복(recurring) / 시즌(season) / 이벤트(event) 정책 자동화.
 * 9 RPC wrapper. 기존 정책 배포 RPC (admin_create_policy_deployment 등) 무수정.
 *
 * SQL: supabase/migrations/0378_policy_automation_engine_v1.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Enums
// =============================================================================

export type AutomationRuleType   = 'scheduled' | 'recurring' | 'event' | 'season';
export type AutomationRuleStatus = 'active' | 'paused' | 'expired' | 'disabled';
export type AutomationScopeType  = 'enterprise' | 'region' | 'store';
export type AutomationEventType  = 'rain' | 'snow' | 'holiday' | 'opening' | 'closing' | 'custom';
export type AutomationSeason     = 'spring' | 'summer' | 'autumn' | 'winter' | 'christmas';
export type AutomationRunStatus  = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// =============================================================================
// Interfaces
// =============================================================================

export interface PolicyAutomationRule {
  id: string;
  enterprise_account_id: string;
  enterprise_name: string | null;
  region_id: string | null;
  region_name: string | null;
  region_code: string | null;
  policy_id: string;
  policy_name: string | null;
  policy_status: string | null;
  rule_type: AutomationRuleType;
  name: string;
  description: string | null;
  status: AutomationRuleStatus;
  priority: number;
  scope_type: AutomationScopeType;
  scope_store_ids: string[] | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  recurrence_rule: string | null;        // 'daily:18:00' | 'weekly:FRI:18:00' | 'monthly:01:09:00'
  event_type: AutomationEventType | null;
  season: AutomationSeason | null;
  condition_json: Record<string, unknown>;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyAutomationKpi {
  total_rules: number;
  active_rules: number;
  paused_rules: number;
  disabled_rules: number;
  expired_rules: number;
  upcoming_24h: number;
  recent_7d_runs: number;
  failed_runs_7d: number;
  next_run_at: string | null;
  computed_at: string;
}

export interface PolicyAutomationListParams {
  search?: string | null;
  ruleType?: AutomationRuleType | null;
  status?: AutomationRuleStatus | null;
  scopeType?: AutomationScopeType | null;
  enterpriseAccountId?: string | null;
  regionId?: string | null;
  limit?: number;
  offset?: number;
}

export interface PolicyAutomationListResponse {
  success: boolean;
  data: PolicyAutomationRule[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface PolicyAutomationRuleCreateInput {
  enterpriseAccountId: string;
  policyId: string;
  name: string;
  ruleType: AutomationRuleType;
  scopeType: AutomationScopeType;
  regionId?: string | null;
  scopeStoreIds?: string[] | null;
  description?: string | null;
  status?: AutomationRuleStatus;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string;
  recurrenceRule?: string | null;
  eventType?: AutomationEventType | null;
  season?: AutomationSeason | null;
  conditionJson?: Record<string, unknown>;
}

export interface PolicyAutomationRuleUpdateInput {
  id: string;
  name?: string | null;
  description?: string | null;
  priority?: number | null;
  status?: AutomationRuleStatus | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  recurrenceRule?: string | null;
  eventType?: AutomationEventType | null;
  season?: AutomationSeason | null;
  regionId?: string | null;
  scopeType?: AutomationScopeType | null;
  scopeStoreIds?: string[] | null;
  policyId?: string | null;
  conditionJson?: Record<string, unknown> | null;
  clearRegion?: boolean;
  clearScopeStores?: boolean;
}

export interface PolicyAutomationRun {
  id: string;
  rule_id: string;
  rule_name: string | null;
  rule_type: AutomationRuleType | null;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  deployment_id: string | null;
  deployment_name: string | null;
  deployment_status: string | null;
  deployment_target_count: number | null;
  deployment_success_count: number | null;
  deployment_failed_count: number | null;
  status: AutomationRunStatus;
  target_store_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  dry_run: boolean;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  details: Record<string, unknown>;
}

export interface PolicyAutomationRunsListParams {
  ruleId?: string | null;
  status?: AutomationRunStatus | null;
  enterpriseAccountId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface PolicyAutomationRunsListResponse {
  success: boolean;
  data: PolicyAutomationRun[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

export interface PolicyAutomationEvaluateResultItem {
  rule_id: string;
  rule_name: string;
  rule_type: AutomationRuleType;
  next_run_at: string | null;
  status: 'preview' | 'executed' | 'skipped' | 'failed';
  target_count?: number;
  deployment_id?: string;
  run_id?: string;
  sample_store_ids?: string[];
  reason?: string;
  error?: string;
}

export interface PolicyAutomationEvaluateResult {
  success: boolean;
  dry_run: boolean;
  now_at: string;
  processed: number;
  executed: number;
  skipped: number;
  failed: number;
  results: PolicyAutomationEvaluateResultItem[];
}

export interface PolicyAutomationRunNowResult {
  success: boolean;
  rule_id: string;
  rule_type?: AutomationRuleType;
  dry_run?: boolean;
  target_count?: number;
  sample_store_ids?: string[];
  would_create_deployment?: boolean;
  run_id?: string;
  status?: AutomationRunStatus;
  deployment_id?: string | null;
  next_run_at?: string | null;
}

// =============================================================================
// RPC wrappers
// =============================================================================

export async function listPolicyAutomationRules(
  params: PolicyAutomationListParams = {},
): Promise<PolicyAutomationListResponse> {
  const { data, error } = await supabase.rpc('admin_list_policy_automation_rules', {
    p_search:                params.search ?? null,
    p_rule_type:             params.ruleType ?? null,
    p_status:                params.status ?? null,
    p_scope_type:            params.scopeType ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_region_id:             params.regionId ?? null,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[policyAutomationApi] list failed', error); throw error; }
  return data as PolicyAutomationListResponse;
}

export async function getPolicyAutomationKpi(): Promise<PolicyAutomationKpi> {
  const { data, error } = await supabase.rpc('admin_policy_automation_kpi');
  if (error) { console.error('[policyAutomationApi] kpi failed', error); throw error; }
  return data as PolicyAutomationKpi;
}

export async function createPolicyAutomationRule(
  input: PolicyAutomationRuleCreateInput,
): Promise<{ success: boolean; rule_id: string; next_run_at: string | null }> {
  const { data, error } = await supabase.rpc('admin_create_policy_automation_rule', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_policy_id:             input.policyId,
    p_name:                  input.name,
    p_rule_type:             input.ruleType,
    p_scope_type:            input.scopeType,
    p_region_id:             input.regionId ?? null,
    p_scope_store_ids:       input.scopeStoreIds ?? null,
    p_description:           input.description ?? null,
    p_status:                input.status ?? 'active',
    p_priority:              input.priority ?? 100,
    p_starts_at:             input.startsAt ?? null,
    p_ends_at:               input.endsAt ?? null,
    p_timezone:              input.timezone ?? 'Asia/Seoul',
    p_recurrence_rule:       input.recurrenceRule ?? null,
    p_event_type:            input.eventType ?? null,
    p_season:                input.season ?? null,
    p_condition_json:        input.conditionJson ?? {},
  });
  if (error) { console.error('[policyAutomationApi] create failed', error); throw error; }
  return data as { success: boolean; rule_id: string; next_run_at: string | null };
}

export async function updatePolicyAutomationRule(
  input: PolicyAutomationRuleUpdateInput,
): Promise<{ success: boolean; rule_id: string; next_run_at: string | null }> {
  const { data, error } = await supabase.rpc('admin_update_policy_automation_rule', {
    p_id:                input.id,
    p_name:              input.name ?? null,
    p_description:       input.description ?? null,
    p_priority:          input.priority ?? null,
    p_status:            input.status ?? null,
    p_starts_at:         input.startsAt ?? null,
    p_ends_at:           input.endsAt ?? null,
    p_timezone:          input.timezone ?? null,
    p_recurrence_rule:   input.recurrenceRule ?? null,
    p_event_type:        input.eventType ?? null,
    p_season:            input.season ?? null,
    p_region_id:         input.regionId ?? null,
    p_scope_type:        input.scopeType ?? null,
    p_scope_store_ids:   input.scopeStoreIds ?? null,
    p_policy_id:         input.policyId ?? null,
    p_condition_json:    input.conditionJson ?? null,
    p_clear_region:      input.clearRegion ?? false,
    p_clear_scope_stores:input.clearScopeStores ?? false,
  });
  if (error) { console.error('[policyAutomationApi] update failed', error); throw error; }
  return data as { success: boolean; rule_id: string; next_run_at: string | null };
}

export async function setPolicyAutomationStatus(
  id: string, status: AutomationRuleStatus,
): Promise<{ success: boolean; rule_id: string; status: AutomationRuleStatus; previous_status: AutomationRuleStatus }> {
  const { data, error } = await supabase.rpc('admin_set_policy_automation_status', {
    p_id: id, p_status: status,
  });
  if (error) { console.error('[policyAutomationApi] set_status failed', error); throw error; }
  return data as { success: boolean; rule_id: string; status: AutomationRuleStatus; previous_status: AutomationRuleStatus };
}

export async function softDeletePolicyAutomationRule(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_soft_delete_policy_automation_rule', { p_id: id });
  if (error) { console.error('[policyAutomationApi] soft_delete failed', error); throw error; }
}

export async function listPolicyAutomationRuns(
  params: PolicyAutomationRunsListParams = {},
): Promise<PolicyAutomationRunsListResponse> {
  const { data, error } = await supabase.rpc('admin_list_policy_automation_runs', {
    p_rule_id:               params.ruleId ?? null,
    p_status:                params.status ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_from:                  params.from ?? null,
    p_to:                    params.to ?? null,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[policyAutomationApi] runs failed', error); throw error; }
  return data as PolicyAutomationRunsListResponse;
}

export async function evaluatePolicyAutomationRules(
  dryRun = true, nowAt?: string | null,
): Promise<PolicyAutomationEvaluateResult> {
  const { data, error } = await supabase.rpc('admin_evaluate_policy_automation_rules', {
    p_dry_run: dryRun,
    p_now_at:  nowAt ?? new Date().toISOString(),
  });
  if (error) { console.error('[policyAutomationApi] evaluate failed', error); throw error; }
  return data as PolicyAutomationEvaluateResult;
}

export async function runPolicyAutomationRuleNow(
  ruleId: string, dryRun = false,
): Promise<PolicyAutomationRunNowResult> {
  const { data, error } = await supabase.rpc('admin_run_policy_automation_rule_now', {
    p_rule_id: ruleId, p_dry_run: dryRun,
  });
  if (error) { console.error('[policyAutomationApi] run_now failed', error); throw error; }
  return data as PolicyAutomationRunNowResult;
}
