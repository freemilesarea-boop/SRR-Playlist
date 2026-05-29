/**
 * adminTrackApi.ts — admin 트랙 관리 (메타데이터 수정 + 완전 삭제).
 */
import { supabase } from './supabase';

export interface AdminTrackPurgeResult {
  track_id: string;
  audio_bucket: string;
  audio_path: string | null;
  cover_bucket: string;
  cover_path: string | null;
  mode: 'hard' | 'soft_due_to_revenue';
}

/**
 * 트랙 삭제 — 두 가지 모드:
 *   - 'hard': 정산/수익 기록 없음 → DB row + storage 파일 완전 제거
 *   - 'soft_due_to_revenue': 정산 보존 필요 → tracks row 는 hidden + removed_at,
 *     audio/cover URL 제거 + storage 파일 삭제 → 사이트 어디서도 재생 불가
 * 어느 모드든 호출 후 사이트에서 재생 / 노출 불가능.
 */
export async function adminHardDeleteTrack(trackId: string): Promise<AdminTrackPurgeResult> {
  const { data, error } = await supabase.rpc('admin_hard_delete_track', { p_track_id: trackId });
  if (error) throw error;
  const row = (data as AdminTrackPurgeResult[] | null)?.[0];
  if (!row) throw new Error('삭제 응답이 비어있어요.');

  // best-effort: storage 파일 제거. DB 작업은 이미 완료됐으므로 storage 실패해도 진행.
  if (row.audio_path) {
    try { await supabase.storage.from(row.audio_bucket).remove([row.audio_path]); } catch { /* ignore */ }
  }
  if (row.cover_path) {
    try { await supabase.storage.from(row.cover_bucket).remove([row.cover_path]); } catch { /* ignore */ }
  }
  return row;
}

export interface AdminTrackMetadataInput {
  title?: string | null;
  artist?: string | null;
  main_genre?: string | null;
  sub_genre?: string | null;
  mood?: string | null;
  energy_level?: number | null;
  bpm?: number | null;
  tempo_feel?: string | null;
  instrumental?: boolean | null;
}

export async function adminUpdateTrackMetadata(
  trackId: string,
  input: AdminTrackMetadataInput,
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_track_metadata', {
    p_track_id: trackId,
    p_title: input.title ?? null,
    p_artist: input.artist ?? null,
    p_main_genre: input.main_genre ?? null,
    p_sub_genre: input.sub_genre ?? null,
    p_mood: input.mood ?? null,
    p_energy_level: input.energy_level ?? null,
    p_bpm: input.bpm ?? null,
    p_tempo_feel: input.tempo_feel ?? null,
    p_instrumental: input.instrumental ?? null,
  });
  if (error) throw error;
}
