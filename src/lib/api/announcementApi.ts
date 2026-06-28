/**
 * announcementApi — Enterprise Announcement Audio Scheduler V1 (Priority 5).
 *
 * 광고/안내 음원 업로드 + 매장 예약 재생 wrapper.
 * SQL: supabase/migrations/0381_announcement_audio_scheduler_v1.sql
 */
import { supabase } from '@/lib/supabase';

export const ANNOUNCEMENT_BUCKET = 'enterprise-announcements';
export const ANNOUNCEMENT_MAX_BYTES = 20 * 1024 * 1024; // 20MB
export const ANNOUNCEMENT_ALLOWED_MIME = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a',
];

// =============================================================================
// Types
// =============================================================================

export type AnnouncementAssetStatus    = 'active' | 'archived' | 'disabled';
export type AnnouncementScheduleStatus = 'active' | 'paused' | 'expired' | 'disabled';
export type AnnouncementScopeType      = 'enterprise' | 'region' | 'store';
export type AnnouncementPlayMode       = 'after_current_track' | 'between_tracks';
export type AnnouncementLogStatus      = 'queued' | 'played' | 'skipped' | 'failed';

export interface AnnouncementAsset {
  id: string;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  title: string;
  description: string | null;
  file_url: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  status: AnnouncementAssetStatus;
  schedule_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementSchedule {
  id: string;
  asset_id: string;
  asset_title: string | null;
  asset_duration: number | null;
  enterprise_account_id: string | null;
  enterprise_name: string | null;
  region_id: string | null;
  region_name: string | null;
  region_code: string | null;
  scope_type: AnnouncementScopeType;
  scope_store_ids: string[] | null;
  name: string;
  description: string | null;
  status: AnnouncementScheduleStatus;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  recurrence_rule: string | null;
  play_mode: AnnouncementPlayMode;
  max_plays_per_day: number;
  last_triggered_at: string | null;
  next_run_at: string | null;
  plays_7d: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DueAnnouncement {
  schedule_id: string;
  asset_id: string;
  schedule_name: string;
  asset_title: string;
  asset_file_url: string;
  asset_duration: number | null;
  asset_mime_type: string | null;
  play_mode: AnnouncementPlayMode;
  today_count: number;
  max_plays_per_day: number;
  last_played_at: string | null;
}

export interface AnnouncementAssetCreateInput {
  title: string;
  fileUrl: string;
  filePath: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  durationSeconds?: number | null;
  description?: string | null;
  enterpriseAccountId?: string | null;
  status?: AnnouncementAssetStatus;
}

export interface AnnouncementScheduleCreateInput {
  assetId: string;
  name: string;
  scopeType: AnnouncementScopeType;
  enterpriseAccountId?: string | null;
  regionId?: string | null;
  scopeStoreIds?: string[] | null;
  description?: string | null;
  status?: AnnouncementScheduleStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string;
  recurrenceRule?: string | null;
  playMode?: AnnouncementPlayMode;
  maxPlaysPerDay?: number;
}

export interface AnnouncementScheduleUpdateInput {
  id: string;
  name?: string | null;
  description?: string | null;
  status?: AnnouncementScheduleStatus | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string | null;
  recurrenceRule?: string | null;
  playMode?: AnnouncementPlayMode | null;
  maxPlaysPerDay?: number | null;
  regionId?: string | null;
  scopeType?: AnnouncementScopeType | null;
  scopeStoreIds?: string[] | null;
  clearRegion?: boolean;
  clearScopeStores?: boolean;
}

interface ListResponse<T> {
  success: boolean;
  data: T[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  computed_at: string;
}

// =============================================================================
// Storage upload helper
// =============================================================================

export async function uploadAnnouncementFile(
  file: File,
  enterpriseAccountId?: string | null,
): Promise<{ path: string; publicUrl: string; sizeBytes: number; mimeType: string }> {
  if (!file) throw new Error('파일이 비어 있습니다.');
  if (file.size > ANNOUNCEMENT_MAX_BYTES) {
    throw new Error(`파일이 20MB 를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
  }
  if (file.type && !ANNOUNCEMENT_ALLOWED_MIME.includes(file.type)) {
    throw new Error(`허용되지 않는 형식입니다: ${file.type}`);
  }
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  const uuid = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const ownerSeg = enterpriseAccountId ?? 'shared';
  const path = `enterprise/${ownerSeg}/announcements/${uuid}-${safeName || `audio.${ext}`}`;

  const { error } = await supabase.storage
    .from(ANNOUNCEMENT_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'audio/mpeg',
      upsert: false,
    });
  if (error) throw new Error(`storage upload 실패: ${error.message}`);

  const { data } = supabase.storage.from(ANNOUNCEMENT_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('public URL 생성 실패');

  return {
    path,
    publicUrl: data.publicUrl,
    sizeBytes: file.size,
    mimeType: file.type || 'audio/mpeg',
  };
}

// =============================================================================
// Assets RPC
// =============================================================================

export async function listAnnouncementAssets(params: {
  search?: string | null;
  status?: AnnouncementAssetStatus | null;
  enterpriseAccountId?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ListResponse<AnnouncementAsset>> {
  const { data, error } = await supabase.rpc('admin_list_announcement_assets', {
    p_search:                params.search ?? null,
    p_status:                params.status ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[announcementApi] list assets failed', error); throw error; }
  return data as ListResponse<AnnouncementAsset>;
}

export async function createAnnouncementAsset(
  input: AnnouncementAssetCreateInput,
): Promise<{ success: boolean; asset_id: string }> {
  const { data, error } = await supabase.rpc('admin_create_announcement_asset', {
    p_title:                 input.title,
    p_file_url:              input.fileUrl,
    p_file_path:             input.filePath,
    p_file_name:             input.fileName ?? null,
    p_mime_type:             input.mimeType ?? null,
    p_file_size_bytes:       input.fileSizeBytes ?? null,
    p_duration_seconds:      input.durationSeconds ?? null,
    p_description:           input.description ?? null,
    p_enterprise_account_id: input.enterpriseAccountId ?? null,
    p_status:                input.status ?? 'active',
  });
  if (error) { console.error('[announcementApi] create asset failed', error); throw error; }
  return data as { success: boolean; asset_id: string };
}

export async function updateAnnouncementAsset(
  id: string,
  patch: { title?: string; description?: string | null; status?: AnnouncementAssetStatus },
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_announcement_asset', {
    p_id:          id,
    p_title:       patch.title ?? null,
    p_description: patch.description ?? null,
    p_status:      patch.status ?? null,
  });
  if (error) { console.error('[announcementApi] update asset failed', error); throw error; }
}

export async function softDeleteAnnouncementAsset(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_soft_delete_announcement_asset', { p_id: id });
  if (error) { console.error('[announcementApi] soft delete asset failed', error); throw error; }
}

// =============================================================================
// Schedules RPC
// =============================================================================

export async function listAnnouncementSchedules(params: {
  search?: string | null;
  status?: AnnouncementScheduleStatus | null;
  scopeType?: AnnouncementScopeType | null;
  enterpriseAccountId?: string | null;
  regionId?: string | null;
  assetId?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ListResponse<AnnouncementSchedule>> {
  const { data, error } = await supabase.rpc('admin_list_announcement_schedules', {
    p_search:                params.search ?? null,
    p_status:                params.status ?? null,
    p_scope_type:            params.scopeType ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_region_id:             params.regionId ?? null,
    p_asset_id:              params.assetId ?? null,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[announcementApi] list schedules failed', error); throw error; }
  return data as ListResponse<AnnouncementSchedule>;
}

export async function createAnnouncementSchedule(
  input: AnnouncementScheduleCreateInput,
): Promise<{ success: boolean; schedule_id: string }> {
  const { data, error } = await supabase.rpc('admin_create_announcement_schedule', {
    p_asset_id:              input.assetId,
    p_name:                  input.name,
    p_scope_type:            input.scopeType,
    p_enterprise_account_id: input.enterpriseAccountId ?? null,
    p_region_id:             input.regionId ?? null,
    p_scope_store_ids:       input.scopeStoreIds ?? null,
    p_description:           input.description ?? null,
    p_status:                input.status ?? 'active',
    p_starts_at:             input.startsAt ?? null,
    p_ends_at:               input.endsAt ?? null,
    p_timezone:              input.timezone ?? 'Asia/Seoul',
    p_recurrence_rule:       input.recurrenceRule ?? null,
    p_play_mode:             input.playMode ?? 'after_current_track',
    p_max_plays_per_day:     input.maxPlaysPerDay ?? 10,
  });
  if (error) { console.error('[announcementApi] create schedule failed', error); throw error; }
  return data as { success: boolean; schedule_id: string };
}

export async function updateAnnouncementSchedule(
  input: AnnouncementScheduleUpdateInput,
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_announcement_schedule', {
    p_id:                  input.id,
    p_name:                input.name ?? null,
    p_description:         input.description ?? null,
    p_status:              input.status ?? null,
    p_starts_at:           input.startsAt ?? null,
    p_ends_at:             input.endsAt ?? null,
    p_timezone:            input.timezone ?? null,
    p_recurrence_rule:     input.recurrenceRule ?? null,
    p_play_mode:           input.playMode ?? null,
    p_max_plays_per_day:   input.maxPlaysPerDay ?? null,
    p_region_id:           input.regionId ?? null,
    p_scope_type:          input.scopeType ?? null,
    p_scope_store_ids:     input.scopeStoreIds ?? null,
    p_clear_region:        input.clearRegion ?? false,
    p_clear_scope_stores:  input.clearScopeStores ?? false,
  });
  if (error) { console.error('[announcementApi] update schedule failed', error); throw error; }
}

export async function setAnnouncementScheduleStatus(
  id: string, status: AnnouncementScheduleStatus,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_announcement_schedule_status', {
    p_id: id, p_status: status,
  });
  if (error) { console.error('[announcementApi] set status failed', error); throw error; }
}

export async function deleteAnnouncementSchedule(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_announcement_schedule', { p_id: id });
  if (error) { console.error('[announcementApi] delete schedule failed', error); throw error; }
}

// =============================================================================
// Store RPC — Player overlay 가 호출
// =============================================================================

export async function getDueAnnouncements(
  storeId?: string | null,
): Promise<{ success: boolean; store_id: string; now_at: string; data: DueAnnouncement[] }> {
  const { data, error } = await supabase.rpc('store_get_due_announcements', {
    p_store_id: storeId ?? null,
  });
  if (error) { console.error('[announcementApi] get due failed', error); throw error; }
  return data as { success: boolean; store_id: string; now_at: string; data: DueAnnouncement[] };
}

export async function markAnnouncementPlayed(
  scheduleId: string, assetId: string,
  status: AnnouncementLogStatus = 'played',
  errorMessage?: string | null,
): Promise<{ success: boolean; log_id: string; status: AnnouncementLogStatus }> {
  const { data, error } = await supabase.rpc('store_mark_announcement_played', {
    p_schedule_id:   scheduleId,
    p_asset_id:      assetId,
    p_status:        status,
    p_error_message: errorMessage ?? null,
  });
  if (error) { console.error('[announcementApi] mark played failed', error); throw error; }
  return data as { success: boolean; log_id: string; status: AnnouncementLogStatus };
}
