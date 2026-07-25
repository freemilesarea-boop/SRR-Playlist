/**
 * franchiseApi — X6.89 / B2B Franchise Music Policy MVP.
 *
 * 본사가 음악 정책 (시간대별 플레이리스트 슬롯) 을 정의하고
 * 연결된 매장에 자동 동기화. 매장 플레이어는 60s 폴링.
 *
 * SQL: supabase/migrations/0349_b2b_franchise_music_policy.sql
 */
import { supabase } from '@/lib/supabase';

// =============================================================================
// Types
// =============================================================================

export type FranchiseStatus = 'active' | 'inactive' | 'archived';
export type FranchisePolicyStatus = 'draft' | 'active' | 'archived';
export type FranchiseStoreStatus = 'active' | 'inactive' | 'suspended';
export type FranchiseAdminRole = 'owner' | 'admin' | 'viewer';
export type PolicyTargetType = 'all' | 'region' | 'store';
export type PlayerStatus = 'playing' | 'paused' | 'stopped' | 'offline' | 'unknown';

export interface Franchise {
  id: string;
  name: string;
  slug: string | null;
  status: FranchiseStatus;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FranchiseListRow {
  id: string;
  name: string;
  slug: string | null;
  status: FranchiseStatus;
  store_count: number;
  online_store_count: number;
  active_policy_count: number;
  created_at: string;
}

export interface FranchiseRegion {
  id: string;
  franchise_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface FranchiseRegionDashboard {
  id: string;
  name: string;
  sort_order: number;
  store_count: number;
}

export interface FranchiseStore {
  id: string;
  franchise_id: string;
  region_id: string | null;
  store_id: string;
  store_name: string | null;
  status: FranchiseStoreStatus;
  joined_at: string;
  created_at: string;
}

export interface FranchiseMusicPolicy {
  id: string;
  franchise_id: string;
  name: string;
  description: string | null;
  status: FranchisePolicyStatus;
  effective_from: string | null;
  effective_until: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FranchiseMusicPolicySlot {
  id: string;
  policy_id: string;
  slot_name: string;
  start_time: string;  // 'HH:MM:SS'
  end_time: string;
  playlist_id: string | null;   // null for break slots (0459)
  days_of_week: number[];  // 1=월 ... 7=일
  sort_order: number;
  created_at: string;
  // 0459 additive columns (default-inert for pre-existing slots)
  slot_type?: 'playlist' | 'break';
  playlist_set_id?: string | null;
}

export interface FranchiseDashboard {
  franchise: Franchise | null;
  total_stores: number;
  online_stores: number;
  offline_stores: number;
  regions: FranchiseRegionDashboard[];
  active_policies: Array<{
    id: string;
    name: string;
    is_default: boolean;
    effective_from: string | null;
    effective_until: string | null;
  }>;
  recent_assignments: Array<{
    id: string;
    policy_id: string;
    policy_name: string | null;
    target_type: PolicyTargetType;
    target_id: string | null;
    applied_at: string;
  }>;
  computed_at: string;
  offline_threshold_seconds: number;
}

export interface ApplyPolicyResult {
  ok: boolean;
  assignment_id: string;
  policy_id: string;
  version_number: number;
  applied_store_count: number;
  target_type: PolicyTargetType;
}

export interface StoreActiveMusicPolicy {
  has_franchise_policy: boolean;
  franchise_id?: string;
  policy_id?: string;
  policy_name?: string;
  version_number?: number;
  matched_slot?: {
    id: string;
    slot_name: string;
    start_time: string;
    end_time: string;
    days_of_week: number[];
    playlist_id: string;
  } | null;
  playlist?: {
    id: string;
    title: string;
    category: string;
    thumbnail_url: string | null;
    business_category: string | null;
  };
  kst_now?: string;
  kst_dow?: number;
  message?: string;
  computed_at?: string;
}

export interface FranchiseSyncStatusRow {
  store_id: string;
  store_name: string | null;
  region_id: string | null;
  region_name: string | null;
  active_policy_id: string | null;
  active_policy_name: string | null;
  active_version_number: number;
  last_seen_at: string | null;
  last_synced_at: string | null;
  current_track_id: string | null;
  current_track_title: string | null;
  player_status: PlayerStatus;
  is_offline: boolean;
}

// =============================================================================
// Admin RPCs
// =============================================================================

export async function adminListFranchises(): Promise<FranchiseListRow[]> {
  const { data, error } = await supabase.rpc('admin_list_franchises');
  if (error) { console.error('[franchiseApi] list failed', error); throw error; }
  return (data ?? []) as FranchiseListRow[];
}

export async function adminCreateFranchise(
  name: string, slug?: string | null, description?: string | null,
): Promise<Franchise> {
  const { data, error } = await supabase.rpc('admin_create_franchise', {
    p_name: name, p_slug: slug ?? null, p_description: description ?? null,
  });
  if (error) { console.error('[franchiseApi] create failed', error); throw error; }
  return data as Franchise;
}

export async function adminCreateRegion(
  franchiseId: string, name: string, sortOrder = 0,
): Promise<FranchiseRegion> {
  const { data, error } = await supabase.rpc('admin_create_franchise_region', {
    p_franchise_id: franchiseId, p_name: name, p_sort_order: sortOrder,
  });
  if (error) { console.error('[franchiseApi] create region failed', error); throw error; }
  return data as FranchiseRegion;
}

export async function adminLinkStore(
  franchiseId: string, storeId: string, regionId?: string | null, storeName?: string | null,
): Promise<FranchiseStore> {
  const { data, error } = await supabase.rpc('admin_link_franchise_store', {
    p_franchise_id: franchiseId, p_store_id: storeId,
    p_region_id: regionId ?? null, p_store_name: storeName ?? null,
  });
  if (error) { console.error('[franchiseApi] link store failed', error); throw error; }
  return data as FranchiseStore;
}

export async function adminUnlinkStore(franchiseId: string, storeId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_unlink_franchise_store', {
    p_franchise_id: franchiseId, p_store_id: storeId,
  });
  if (error) { console.error('[franchiseApi] unlink store failed', error); throw error; }
}

export interface UpsertPolicyParams {
  franchiseId: string;
  name: string;
  description?: string | null;
  status?: FranchisePolicyStatus;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  isDefault?: boolean;
  policyId?: string | null;
}

export async function adminUpsertPolicy(params: UpsertPolicyParams): Promise<FranchiseMusicPolicy> {
  const { data, error } = await supabase.rpc('admin_upsert_franchise_policy', {
    p_franchise_id: params.franchiseId,
    p_name: params.name,
    p_description: params.description ?? null,
    p_status: params.status ?? 'draft',
    p_effective_from: params.effectiveFrom ?? null,
    p_effective_until: params.effectiveUntil ?? null,
    p_is_default: params.isDefault ?? false,
    p_policy_id: params.policyId ?? null,
  });
  if (error) { console.error('[franchiseApi] upsert policy failed', error); throw error; }
  return data as FranchiseMusicPolicy;
}

export interface UpsertSlotParams {
  policyId: string;
  slotName: string;
  startTime: string;  // 'HH:MM'
  endTime: string;
  playlistId: string;
  daysOfWeek?: number[];
  sortOrder?: number;
  slotId?: string | null;
}

export async function adminUpsertSlot(params: UpsertSlotParams): Promise<FranchiseMusicPolicySlot> {
  const { data, error } = await supabase.rpc('admin_upsert_franchise_slot', {
    p_policy_id: params.policyId,
    p_slot_name: params.slotName,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_playlist_id: params.playlistId,
    p_days_of_week: params.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7],
    p_sort_order: params.sortOrder ?? 0,
    p_slot_id: params.slotId ?? null,
  });
  if (error) { console.error('[franchiseApi] upsert slot failed', error); throw error; }
  return data as FranchiseMusicPolicySlot;
}

export async function adminDeleteSlot(slotId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_franchise_slot', { p_slot_id: slotId });
  if (error) { console.error('[franchiseApi] delete slot failed', error); throw error; }
}

export interface ApplyPolicyParams {
  franchiseId: string;
  policyId: string;
  targetType: PolicyTargetType;
  targetId?: string | null;
  effectiveFrom?: string | null;
}

export async function applyFranchisePolicy(params: ApplyPolicyParams): Promise<ApplyPolicyResult> {
  const { data, error } = await supabase.rpc('apply_franchise_policy', {
    p_franchise_id: params.franchiseId,
    p_policy_id: params.policyId,
    p_target_type: params.targetType,
    p_target_id: params.targetId ?? null,
    p_effective_from: params.effectiveFrom ?? null,
  });
  if (error) { console.error('[franchiseApi] apply policy failed', error); throw error; }
  return data as ApplyPolicyResult;
}

export async function getFranchiseDashboard(franchiseId: string): Promise<FranchiseDashboard> {
  const { data, error } = await supabase.rpc('get_franchise_dashboard', { p_franchise_id: franchiseId });
  if (error) { console.error('[franchiseApi] dashboard failed', error); throw error; }
  return data as FranchiseDashboard;
}

export async function adminListSyncStatus(franchiseId: string): Promise<FranchiseSyncStatusRow[]> {
  const { data, error } = await supabase.rpc('admin_list_franchise_sync_status', { p_franchise_id: franchiseId });
  if (error) { console.error('[franchiseApi] sync status failed', error); throw error; }
  return (data ?? []) as FranchiseSyncStatusRow[];
}

// =============================================================================
// Direct table reads (RLS 보호) — UI 보조
// =============================================================================

export async function listFranchiseRegions(franchiseId: string): Promise<FranchiseRegion[]> {
  const { data, error } = await supabase
    .from('franchise_regions')
    .select('*')
    .eq('franchise_id', franchiseId)
    .order('sort_order', { ascending: true });
  if (error) { console.error('[franchiseApi] regions read failed', error); throw error; }
  return (data ?? []) as FranchiseRegion[];
}

export async function listFranchiseStores(franchiseId: string): Promise<FranchiseStore[]> {
  const { data, error } = await supabase
    .from('franchise_stores')
    .select('*')
    .eq('franchise_id', franchiseId)
    .order('created_at', { ascending: false });
  if (error) { console.error('[franchiseApi] stores read failed', error); throw error; }
  return (data ?? []) as FranchiseStore[];
}

export async function listFranchisePolicies(franchiseId: string): Promise<FranchiseMusicPolicy[]> {
  const { data, error } = await supabase
    .from('franchise_music_policies')
    .select('*')
    .eq('franchise_id', franchiseId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('[franchiseApi] policies read failed', error); throw error; }
  return (data ?? []) as FranchiseMusicPolicy[];
}

export async function listPolicySlots(policyId: string): Promise<FranchiseMusicPolicySlot[]> {
  const { data, error } = await supabase
    .from('franchise_music_policy_slots')
    .select('*')
    .eq('policy_id', policyId)
    .order('sort_order', { ascending: true });
  if (error) { console.error('[franchiseApi] slots read failed', error); throw error; }
  return (data ?? []) as FranchiseMusicPolicySlot[];
}

// =============================================================================
// Store player RPCs (매장 플레이어가 호출)
// =============================================================================

export async function getStoreActiveMusicPolicy(storeId: string): Promise<StoreActiveMusicPolicy> {
  const { data, error } = await supabase.rpc('get_store_active_music_policy', { p_store_id: storeId });
  if (error) {
    console.warn('[franchiseApi] active policy fetch failed', error);
    return { has_franchise_policy: false };
  }
  return data as StoreActiveMusicPolicy;
}

export async function updateStorePlayerHeartbeat(
  storeId: string, playerStatus: PlayerStatus, currentTrackId?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('update_store_player_heartbeat', {
    p_store_id: storeId, p_player_status: playerStatus,
    p_current_track_id: currentTrackId ?? null,
  });
  if (error) {
    // heartbeat 실패는 silent — 재생을 막지 않음
    console.warn('[franchiseApi] heartbeat failed', error);
  }
}

// =============================================================================
// X6.90 — Franchise admin gating + Enterprise dashboards
// =============================================================================

export interface MyFranchiseAdmin {
  is_franchise_admin: boolean;
  franchise_id?: string;
  franchise_name?: string;
  franchise_slug?: string | null;
  franchise_status?: FranchiseStatus;
  admin_role?: FranchiseAdminRole;
}

export interface EnterpriseOverview {
  total_franchises: number;
  total_brands: number;
  total_linked_stores: number;
  online_stores: number;
  offline_stores: number;
  active_policies: number;
  recent_policy_updates: Array<{
    policy_id: string;
    policy_name: string;
    franchise_id: string;
    franchise_name: string | null;
    updated_at: string;
  }>;
  per_franchise: Array<{
    franchise_id: string;
    name: string;
    slug: string | null;
    status: FranchiseStatus;
    store_count: number;
    online_count: number;
    active_policy_count: number;
    current_default_policy: { id: string; name: string } | null;
    estimated_monthly_revenue: number;
  }>;
  offline_threshold_seconds: number;
  computed_at: string;
}

export async function getMyFranchiseAdmin(): Promise<MyFranchiseAdmin> {
  const { data, error } = await supabase.rpc('get_my_franchise_admin');
  if (error) {
    console.warn('[franchiseApi] my_franchise_admin failed', error);
    return { is_franchise_admin: false };
  }
  return data as MyFranchiseAdmin;
}

export async function adminEnterpriseOverview(): Promise<EnterpriseOverview> {
  const { data, error } = await supabase.rpc('admin_enterprise_overview');
  if (error) { console.error('[franchiseApi] enterprise overview failed', error); throw error; }
  return data as EnterpriseOverview;
}

export async function getMyFranchiseHqDashboard(): Promise<FranchiseDashboard & { admin_role: FranchiseAdminRole }> {
  const { data, error } = await supabase.rpc('get_my_franchise_hq_dashboard');
  if (error) { console.error('[franchiseApi] hq dashboard failed', error); throw error; }
  return data as FranchiseDashboard & { admin_role: FranchiseAdminRole };
}

export async function getMyFranchiseSyncStatus(): Promise<FranchiseSyncStatusRow[]> {
  const { data, error } = await supabase.rpc('get_my_franchise_sync_status');
  if (error) { console.error('[franchiseApi] my sync status failed', error); throw error; }
  return (data ?? []) as FranchiseSyncStatusRow[];
}

export async function getMyFranchisePolicies(): Promise<FranchiseMusicPolicy[]> {
  const { data, error } = await supabase.rpc('get_my_franchise_policies');
  if (error) { console.error('[franchiseApi] my policies failed', error); throw error; }
  return (data ?? []) as FranchiseMusicPolicy[];
}

// =============================================================================
// BRAND-PLAYLIST-ROTATION-1 — curated playlist sets, break-aware slots, store overrides
// Migrations: 0459_brand_playback_schedule.sql (tables/resolver),
//             0460_brand_playlist_management_access.sql (RLS + admin RPCs).
// All additive; existing policies/slots keep their exact prior behavior.
// =============================================================================

export type PlaylistSetStatus = 'active' | 'inactive' | 'scheduled' | 'expired' | 'deleted';

export interface FranchisePlaylistSet {
  id: string;
  franchise_id: string;
  playlist_id: string;
  playlist_title: string | null;
  name: string;
  description: string | null;
  rotation_order: number;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  status: PlaylistSetStatus;
}

export async function adminListFranchisePlaylistSets(
  franchiseId: string, includeDeleted = false,
): Promise<FranchisePlaylistSet[]> {
  const { data, error } = await supabase.rpc('admin_list_franchise_playlist_sets', {
    p_franchise_id: franchiseId, p_include_deleted: includeDeleted,
  });
  if (error) { console.error('[franchiseApi] list playlist sets failed', error); throw error; }
  return ((data as { data?: FranchisePlaylistSet[] })?.data ?? []) as FranchisePlaylistSet[];
}

export interface UpsertPlaylistSetParams {
  franchiseId: string;
  playlistId: string;
  name: string;
  description?: string | null;
  rotationOrder?: number;
  isActive?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  setId?: string | null;
}

export async function adminUpsertFranchisePlaylistSet(
  params: UpsertPlaylistSetParams,
): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_upsert_franchise_playlist_set', {
    p_franchise_id: params.franchiseId,
    p_playlist_id: params.playlistId,
    p_name: params.name,
    p_description: params.description ?? null,
    p_rotation_order: params.rotationOrder ?? 0,
    p_is_active: params.isActive ?? true,
    p_valid_from: params.validFrom ?? null,
    p_valid_until: params.validUntil ?? null,
    p_set_id: params.setId ?? null,
  });
  if (error) { console.error('[franchiseApi] upsert playlist set failed', error); throw error; }
  return data as { success: boolean; id: string };
}

export async function adminArchiveFranchisePlaylistSet(setId: string): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_archive_franchise_playlist_set', { p_set_id: setId });
  if (error) { console.error('[franchiseApi] archive playlist set failed', error); throw error; }
  return data as { success: boolean; id: string };
}

export async function adminRestoreFranchisePlaylistSet(setId: string): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_restore_franchise_playlist_set', { p_set_id: setId });
  if (error) { console.error('[franchiseApi] restore playlist set failed', error); throw error; }
  return data as { success: boolean; id: string };
}

// ---- Break-aware slot editor (v2). Superset of adminUpsertSlot: adds slot_type + playlist_set_id.
export type SlotType = 'playlist' | 'break';

export interface UpsertSlotV2Params {
  policyId: string;
  slotName: string;
  startTime: string;   // 'HH:MM'
  endTime: string;
  slotType: SlotType;
  playlistId?: string | null;      // required for 'playlist', must be null for 'break'
  playlistSetId?: string | null;   // optional; when set, must match the playlist and franchise
  daysOfWeek?: number[];
  sortOrder?: number;
  slotId?: string | null;
}

export async function adminUpsertFranchiseSlotV2(
  params: UpsertSlotV2Params,
): Promise<{ success: boolean; id: string }> {
  const { data, error } = await supabase.rpc('admin_upsert_franchise_slot_v2', {
    p_policy_id: params.policyId,
    p_slot_name: params.slotName,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_slot_type: params.slotType,
    p_playlist_id: params.slotType === 'break' ? null : (params.playlistId ?? null),
    p_playlist_set_id: params.slotType === 'break' ? null : (params.playlistSetId ?? null),
    p_days_of_week: params.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7],
    p_sort_order: params.sortOrder ?? 0,
    p_slot_id: params.slotId ?? null,
  });
  if (error) { console.error('[franchiseApi] upsert slot v2 failed', error); throw error; }
  return data as { success: boolean; id: string };
}

export interface FranchisePolicySlotV2 {
  slot_id: string;
  slot_name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  slot_type: SlotType;
  playlist_id: string | null;
  playlist_title: string | null;
  playlist_set_id: string | null;
  playlist_set_name: string | null;
  sort_order: number;
  created_at: string;
}

export async function adminListFranchisePolicySlots(policyId: string): Promise<FranchisePolicySlotV2[]> {
  const { data, error } = await supabase.rpc('admin_list_franchise_policy_slots', { p_policy_id: policyId });
  if (error) { console.error('[franchiseApi] list policy slots v2 failed', error); throw error; }
  return ((data as { data?: FranchisePolicySlotV2[] })?.data ?? []) as FranchisePolicySlotV2[];
}

// ---- Store playback overrides (per-store timezone + follow-brand-schedule flag).
export interface StorePlaybackOverrideRow {
  store_id: string;
  store_name: string | null;
  region_id: string | null;
  use_brand_schedule: boolean | null;
  timezone: string | null;
  is_active: boolean | null;
  updated_at: string | null;
  has_override: boolean;
}

export async function adminListStorePlaybackOverrides(franchiseId: string): Promise<StorePlaybackOverrideRow[]> {
  const { data, error } = await supabase.rpc('admin_list_store_playback_overrides', { p_franchise_id: franchiseId });
  if (error) { console.error('[franchiseApi] list store overrides failed', error); throw error; }
  return ((data as { data?: StorePlaybackOverrideRow[] })?.data ?? []) as StorePlaybackOverrideRow[];
}

export async function adminUpsertStorePlaybackOverride(input: {
  storeId: string; useBrandSchedule: boolean; timezone: string; isActive?: boolean;
}): Promise<{ success: boolean; store_id: string }> {
  const { data, error } = await supabase.rpc('admin_upsert_store_playback_override', {
    p_store_id: input.storeId,
    p_use_brand_schedule: input.useBrandSchedule,
    p_timezone: input.timezone,
    p_is_active: input.isActive ?? true,
  });
  if (error) { console.error('[franchiseApi] upsert store override failed', error); throw error; }
  return data as { success: boolean; store_id: string };
}

// ---- Store-side self-service (a store manages only its own override).
export interface MyStorePlaybackOverride {
  success: boolean;
  store_id: string;
  override: { use_brand_schedule: boolean; timezone: string; is_active: boolean; updated_at: string } | null;
}

export async function getMyStorePlaybackOverride(): Promise<MyStorePlaybackOverride> {
  const { data, error } = await supabase.rpc('get_my_store_playback_override');
  if (error) { console.error('[franchiseApi] my store override failed', error); throw error; }
  return data as MyStorePlaybackOverride;
}

export async function upsertMyStorePlaybackOverride(input: {
  useBrandSchedule: boolean; timezone: string;
}): Promise<{ success: boolean; store_id: string }> {
  const { data, error } = await supabase.rpc('upsert_my_store_playback_override', {
    p_use_brand_schedule: input.useBrandSchedule,
    p_timezone: input.timezone,
  });
  if (error) { console.error('[franchiseApi] upsert my store override failed', error); throw error; }
  return data as { success: boolean; store_id: string };
}

// ---- Runtime resolver (store player asks "what should I be doing right now?").
export interface StorePlaybackResolution {
  mode: PlaybackMode;
  source: PolicySource | null;
  has_franchise_policy: boolean;
  franchise_id?: string;
  policy_id?: string;
  policy_name?: string;
  timezone: string;
  matched_slot: {
    id: string; slot_name: string; slot_type: SlotType;
    start_time: string; end_time: string; days_of_week: number[];
  } | null;
  playlist_set_id: string | null;
  playlist_id: string | null;
  effective_from?: string | null;
  effective_until?: string | null;
  next_transition_at: string | null;
  computed_at: string;
}

export type PlaybackMode = 'play' | 'break' | 'closed';
export type PolicySource = 'store_override' | 'brand_schedule' | 'fallback';

export async function resolveStorePlaybackPolicy(
  storeId: string, at?: string | null,
): Promise<StorePlaybackResolution> {
  const { data, error } = await supabase.rpc('resolve_store_playback_policy', {
    p_store_id: storeId, p_at: at ?? null,
  });
  if (error) { console.error('[franchiseApi] resolve playback policy failed', error); throw error; }
  return data as StorePlaybackResolution;
}
