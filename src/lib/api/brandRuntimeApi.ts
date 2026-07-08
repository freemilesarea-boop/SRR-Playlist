// Phase ENT-OS-3 — Brand Runtime Engine RPC 래퍼.
// 0410 admin_preview_brand_runtime + runtime rule CRUD + brand health. 모두 super_admin RPC.
import { supabase } from '@/lib/supabase';

export type RuntimeRuleType =
  | 'default' | 'time' | 'daypart' | 'weekday' | 'weather' | 'season' | 'holiday' | 'campaign' | 'emergency';
export type RuntimeRuleStatus = 'active' | 'inactive';

export interface BrandRuntimeRule {
  id: string;
  name: string;
  rule_type: string;
  priority: number;
  playlist_id: string | null;
  playlist_name: string | null;
  media_asset_id: string | null;
  media_title: string | null;
  conditions: Record<string, unknown>;
  status: RuntimeRuleStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface BrandHealthCheck { key: string; label: string; passed: boolean; detail: string | null }
export interface BrandHealth { score: number; checks: BrandHealthCheck[] }

export interface RuntimeQueueTrack { id: string; title: string | null; artist: string | null; duration: number | null }

export interface RuntimeMatchedRule {
  id: string; name: string; rule_type: string; priority: number;
  playlist_id: string | null; media_asset_id: string | null; conditions: Record<string, unknown>;
}

export interface RuntimePreview {
  brand: { id: string; name: string; status: string; industry_type: string | null };
  context: Record<string, unknown>;
  evaluated_at: string;
  matched_rules: RuntimeMatchedRule[];
  selected_rule: { id: string; name: string; rule_type: string; priority: number } | null;
  selected_playlist: { id: string | null; name: string; type: string; version?: number; status: string; track_count: number } | null;
  selected_media: { id: string; title: string | null; image_url: string; status: string | null } | null;
  fallback_used: boolean;
  fallback_reason: string | null;
  explanation: string[];
  queue_preview: RuntimeQueueTrack[];
  health: BrandHealth;
}

export async function adminListBrandRuntimeRules(brandId: string, includeDeleted = false): Promise<BrandRuntimeRule[]> {
  const { data, error } = await supabase.rpc('admin_list_brand_runtime_rules', { p_brand_id: brandId, p_include_deleted: includeDeleted });
  if (error) throw error;
  return (data ?? []) as BrandRuntimeRule[];
}

export async function adminCreateBrandRuntimeRule(input: {
  brandId: string; name: string; ruleType: string; priority: number;
  playlistId?: string | null; mediaAssetId?: string | null;
  conditions?: Record<string, unknown> | null; status?: RuntimeRuleStatus;
  startsAt?: string | null; endsAt?: string | null;
}): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_create_brand_runtime_rule', {
    p_brand_id: input.brandId,
    p_name: input.name,
    p_rule_type: input.ruleType,
    p_priority: input.priority,
    p_playlist_id: input.playlistId ?? null,
    p_media_asset_id: input.mediaAssetId ?? null,
    p_conditions: input.conditions ?? {},
    p_status: input.status ?? 'active',
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; id: string };
}

export async function adminUpdateBrandRuntimeRule(input: {
  ruleId: string; name?: string | null; ruleType?: string | null; priority?: number | null;
  playlistId?: string | null; mediaAssetId?: string | null;
  conditions?: Record<string, unknown> | null; status?: RuntimeRuleStatus | null;
  startsAt?: string | null; endsAt?: string | null;
  clearPlaylist?: boolean; clearMedia?: boolean; clearStarts?: boolean; clearEnds?: boolean;
}): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_update_brand_runtime_rule', {
    p_rule_id: input.ruleId,
    p_name: input.name ?? null,
    p_rule_type: input.ruleType ?? null,
    p_priority: input.priority ?? null,
    p_playlist_id: input.playlistId ?? null,
    p_media_asset_id: input.mediaAssetId ?? null,
    p_conditions: input.conditions ?? null,
    p_status: input.status ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
    p_clear_playlist: input.clearPlaylist ?? false,
    p_clear_media: input.clearMedia ?? false,
    p_clear_starts: input.clearStarts ?? false,
    p_clear_ends: input.clearEnds ?? false,
  });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminDeleteBrandRuntimeRule(ruleId: string, deleted = true): Promise<{ success: boolean }> {
  const { data, error } = await supabase.rpc('admin_delete_brand_runtime_rule', { p_rule_id: ruleId, p_deleted: deleted });
  if (error) throw error;
  return data as { success: boolean };
}

export async function adminPreviewBrandRuntime(brandId: string, context: Record<string, unknown>): Promise<RuntimePreview> {
  const { data, error } = await supabase.rpc('admin_preview_brand_runtime', { p_brand_id: brandId, p_context: context });
  if (error) throw error;
  return data as RuntimePreview;
}

export async function adminGetBrandHealth(brandId: string): Promise<BrandHealth> {
  const { data, error } = await supabase.rpc('admin_get_brand_health', { p_brand_id: brandId });
  if (error) throw error;
  return data as BrandHealth;
}
