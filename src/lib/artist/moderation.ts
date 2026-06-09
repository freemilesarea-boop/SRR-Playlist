// Artist moderation API (X6.50 — extracted from artistApi.ts)
// 트랙 takedown/restore/hide, 모더레이션 이메일 dispatch, 일괄 승인/거절.
import { supabase } from '../supabase';

export type TrackReleaseStatus =
  | 'draft' | 'submitted' | 'changes_requested'
  | 'approved' | 'scheduled' | 'released'
  | 'rejected' | 'removed';

export interface TrackModerationEvent {
  event_id: number;
  actor_user_id: string | null;
  action: string;
  from_release_status: string | null;
  to_release_status: string | null;
  from_visibility_status: string | null;
  to_visibility_status: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TrackModerationEmailJob {
  job_id: string;
  recipient_email: string;
  kind: 'approved' | 'rejected' | 'revision_requested' | 'removed' | 'released';
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  sent_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export async function adminTakedownTrack(trackId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_takedown_track', {
    p_track_id: trackId, p_reason: reason,
  });
  if (error) throw error;
}

export async function adminRestoreTrack(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_restore_track', { p_track_id: trackId });
  if (error) throw error;
}

export async function adminHideReleasedTrack(trackId: string, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_hide_released_track', {
    p_track_id: trackId, p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function adminUnhideReleasedTrack(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_unhide_released_track', { p_track_id: trackId });
  if (error) throw error;
}

export async function adminListTrackModerationEvents(trackId: string): Promise<TrackModerationEvent[]> {
  const { data, error } = await supabase.rpc('admin_list_track_moderation_events', {
    p_track_id: trackId,
  });
  if (error) throw error;
  return (data ?? []) as TrackModerationEvent[];
}

export async function adminListTrackModerationEmailJobs(trackId: string): Promise<TrackModerationEmailJob[]> {
  const { data, error } = await supabase.rpc('admin_list_track_moderation_email_jobs', {
    p_track_id: trackId,
  });
  if (error) throw error;
  return (data ?? []) as TrackModerationEmailJob[];
}

export async function adminRequeueTrackModerationEmails(
  trackId: string,
  onlyFailed = false,
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_requeue_track_moderation_emails', {
    p_track_id: trackId, p_only_failed: onlyFailed,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function dispatchTrackModerationEmails(
  trackId: string,
): Promise<{ ok: boolean; sent?: number; failed?: number; processed?: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('dispatch-moderation-emails', {
      body: { track_id: trackId },
    });
    if (error) return { ok: false, error: error.message };
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 묶음/전체 승인 후 1회 호출 — 모든 pending 메일 job 을 drain (묶음당 1통). */
export async function dispatchAllModerationEmails(): Promise<{
  ok: boolean; sent?: number; failed?: number; processed?: number; error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('dispatch-moderation-emails', {
      body: { drain: true },
    });
    if (error) return { ok: false, error: error.message };
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BulkModerationResult {
  ok: boolean;
  approved?: number;
  rejected?: number;
  remaining?: number;
  failed: Array<{ track_id: string; error: string }>;
}

export async function adminBulkApproveTracks(
  trackIds: string[],
  immediate: boolean | null = null,
): Promise<BulkModerationResult> {
  const { data, error } = await supabase.rpc('admin_bulk_approve_tracks', {
    p_track_ids: trackIds,
    p_immediate: immediate,
  });
  if (error) throw error;
  return data as BulkModerationResult;
}

export async function adminBulkRejectTracks(
  trackIds: string[],
  reason: string,
): Promise<BulkModerationResult> {
  const { data, error } = await supabase.rpc('admin_bulk_reject_tracks', {
    p_track_ids: trackIds,
    p_reason: reason,
  });
  if (error) throw error;
  return data as BulkModerationResult;
}

/** 전체(필터) 승인 — 서버가 pending 을 chunk(p_limit)로 승인하고 remaining 반환. */
export async function adminApproveAllPending(
  artistId: string | null = null,
  immediate: boolean | null = null,
  limit = 200,
): Promise<BulkModerationResult> {
  const { data, error } = await supabase.rpc('admin_approve_all_pending', {
    p_artist_id: artistId,
    p_immediate: immediate,
    p_limit: limit,
  });
  if (error) throw error;
  return data as BulkModerationResult;
}
