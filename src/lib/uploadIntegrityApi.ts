/** uploadIntegrityApi.ts — 업로드 무결성 감사 (관리자). 실제 업로드 콘텐츠 sha 기반. */
import { supabase } from './supabase';

export interface IntegrityLogRow {
  id: string; batch_id: string | null; user_id: string | null; artist_email: string | null;
  client_track_id: string | null; track_id: string | null; original_filename: string | null;
  final_audio_sha256: string | null; final_storage_path: string | null; audio_duration: number | null;
  transcoded: boolean | null; upload_status: string | null; created_at: string; same_sha_count: number;
}
export interface DuplicateShaGroup {
  sha: string; user_id: string; artist_email: string | null; n: number;
  items: Array<{ filename: string | null; track_id: string | null; batch_id: string | null; path: string | null; at: string }>;
}
export interface LegacyCorruptionGroup {
  owner_user_id: string; audio_content_length: number | null; duration: number | null; n: number;
  suspected_reason: string; tracks: Array<{ track_id: string; title: string | null; filename: string | null; audio_url: string | null; created_at: string }>;
}

export async function listIntegrityLogs(days = 7, filter = 'all', limit = 300): Promise<IntegrityLogRow[]> {
  const { data, error } = await supabase.rpc('admin_list_integrity_logs', { p_days: days, p_filter: filter, p_limit: limit });
  if (error) throw error; return (data ?? []) as IntegrityLogRow[];
}
export async function integrityDuplicateSha(days = 30): Promise<DuplicateShaGroup[]> {
  const { data, error } = await supabase.rpc('admin_integrity_duplicate_sha', { p_days: days });
  if (error) throw error; return (data ?? []) as DuplicateShaGroup[];
}
export async function scanLegacyCorruption(limit = 200): Promise<LegacyCorruptionGroup[]> {
  const { data, error } = await supabase.rpc('admin_scan_legacy_corruption', { p_limit: limit });
  if (error) throw error; return (data ?? []) as LegacyCorruptionGroup[];
}
