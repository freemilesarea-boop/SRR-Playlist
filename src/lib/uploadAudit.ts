/**
 * uploadAudit.ts — 관리자 업로드/스토리지 점검 도구.
 * admin_upload_audit RPC(read-only) 로 orphan/missing/변환실패/오래된 pending 을 조회하고,
 * orphan storage object 는 storage API 로 명시적 선택 후 삭제한다.
 */
import { supabase } from '@/lib/supabase';

export interface OrphanAudio {
  name: string;
  size: number | null;
  created_at: string;
}
export interface OrphanCover {
  name: string;
  created_at: string;
}
export interface MissingAudioTrack {
  id: string;
  title: string | null;
  release_status: string | null;
  storage_path: string | null;
  audio_url: string | null;
}
export interface ConversionFailedTrack {
  id: string;
  title: string | null;
  artist: string | null;
  audio_health_status: string | null;
  audio_health_checked_at: string | null;
}
export interface StalePendingTrack {
  id: string;
  title: string | null;
  artist: string | null;
  release_status: string | null;
  submitted_at: string | null;
  created_at: string | null;
}

export interface UploadAudit {
  orphan_audio_count: number;
  orphan_cover_count: number;
  missing_audio_count: number;
  conversion_failed_count: number;
  stale_pending_count: number;
  orphan_audio: OrphanAudio[];
  orphan_cover: OrphanCover[];
  missing_audio: MissingAudioTrack[];
  conversion_failed: ConversionFailedTrack[];
  stale_pending: StalePendingTrack[];
}

export async function fetchUploadAudit(): Promise<UploadAudit> {
  const { data, error } = await supabase.rpc('admin_upload_audit');
  if (error) throw error;
  return data as UploadAudit;
}

// ---- 0195 업로드 무결성(batch) 조회 ----
export interface BatchIntegrityLog {
  client_track_id: string;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  sha256: string | null;
  transcode_status: string | null;
  upload_status: string | null;
  failure_reason: string | null;
  created_track_id: string | null;
  retry_count: number;
  track_title: string | null;
  track_status: string | null;
  audio_url: string | null;
  storage_path: string | null;
}
export interface BatchIntegrityDetail {
  batch: { id: string; status: string; total_tracks: number; integrity: unknown; created_at: string } | null;
  owner_email: string | null;
  logs: BatchIntegrityLog[];
}
export interface BatchListItem {
  batch_id: string; status: string; total_tracks: number; created_at: string; integrity: unknown; owner_email: string | null;
}

export async function adminFetchBatchIntegrity(opts: { batchId?: string; trackId?: string }): Promise<BatchIntegrityDetail | { batches: BatchListItem[] }> {
  const { data, error } = await supabase.rpc('admin_upload_batch_integrity', {
    p_batch_id: opts.batchId ?? null,
    p_track_id: opts.trackId ?? null,
    p_limit: 50,
  });
  if (error) throw error;
  return data as BatchIntegrityDetail | { batches: BatchListItem[] };
}

// ---- 0196 orphan storage / integrity_failed 관리 ----
export interface UploadOrphan {
  storage_path: string; batch_id: string; client_track_id: string;
  original_filename: string | null; file_size: number | null; failure_reason: string | null;
  created_at: string; owner_email: string | null;
}

export async function adminListUploadOrphans(): Promise<UploadOrphan[]> {
  const { data, error } = await supabase.rpc('admin_list_upload_orphans', { p_limit: 200 });
  if (error) throw error;
  return ((data as { orphans?: UploadOrphan[] })?.orphans ?? []) as UploadOrphan[];
}

export async function adminIntegrityFailedCount(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_integrity_failed_count');
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function adminClearBatchIntegrity(batchId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_clear_batch_integrity', { p_batch_id: batchId, p_note: note ?? null });
  if (error) throw error;
}

/**
 * orphan storage object 삭제 — 어떤 track 도 참조하지 않는 파일만 (audit 결과 기준).
 * storage API(remove)로 실제 바이너리까지 삭제. 관리자가 명시적으로 선택/확인한 것만.
 */
export async function deleteOrphanObjects(
  bucket: 'audio' | 'covers',
  names: string[],
): Promise<{ removed: number }> {
  if (names.length === 0) return { removed: 0 };
  const { error } = await supabase.storage.from(bucket).remove(names);
  if (error) throw error;
  return { removed: names.length };
}
