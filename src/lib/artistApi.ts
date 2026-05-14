/**
 * artistApi.ts
 *
 * 아티스트 업로드/검수 관련 클라이언트 API.
 *   - fetchMyArtistProfile: 로그인 사용자의 아티스트 프로필
 *   - fetchMyArtistTracks: 본인 업로드 곡 (모든 visibility)
 *   - uploadArtistTrack: storage 업로드 + tracks INSERT
 *   - admin: approveArtistTrack / rejectArtistTrack / hideArtistTrack / listPendingReviewTracks
 */

import { supabase } from './supabase';

export interface ArtistProfile {
  user_id: string;
  real_name: string;
  birth_date: string;
  artist_name: string;
  phone: string;
  address: string;
  email: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
  id: string;
}

export interface MyArtistTrackRow {
  track_id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  visibility_status: 'pending_review' | 'approved' | 'rejected' | 'hidden';
  rejected_reason: string | null;
  created_at: string;
}

export interface PendingReviewTrackRow {
  track_id: string;
  title: string;
  artist: string | null;
  album_name: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  suitable_store: string | null;
  lyrics: string | null;
  audio_url: string;
  cover_url: string | null;
  duration: number | null;
  owner_user_id: string | null;
  artist_profile_id: string | null;
  uploaded_by_account_type: string | null;
  source_type: string | null;
  visibility_status: string;
  artist_name: string | null;
  payout_verification_status: 'pending' | 'verified' | 'rejected' | null;
  payout_bank_name: string | null;
  created_at: string;
}

export interface UploadInput {
  title: string;
  album_name?: string;
  artist?: string;
  genre?: string;       // 메인 장르 (기존 컬럼)
  main_genre?: string;
  sub_genre?: string;
  mood?: string;
  suitable_store?: string;
  description?: string;
  lyrics?: string;
  external_link?: string;
  audioFile: File;
  coverFile?: File | null;
}

export interface UploadResult {
  ok: boolean;
  track_id?: string;
  error?: string;
}

/** 본인 아티스트 프로필 조회 (없으면 null) */
export async function fetchMyArtistProfile(userId: string): Promise<ArtistProfile | null> {
  try {
    const { data, error } = await supabase
      .from('artist_profiles')
      .select(
        'id, user_id, real_name, birth_date, artist_name, phone, address, email, ' +
          'approval_status, approved_by, approved_at, rejected_reason, created_at, updated_at',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return (data as unknown as ArtistProfile) ?? null;
  } catch {
    return null;
  }
}

export async function fetchMyArtistTracks(): Promise<MyArtistTrackRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_my_artist_tracks', { p_limit: 200 });
    if (error) return [];
    return (data ?? []) as MyArtistTrackRow[];
  } catch {
    return [];
  }
}

/** 파일 확장자 검증 */
const ALLOWED_AUDIO_EXT = ['mp3', 'wav', 'm4a', 'flac'];
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB

export function validateArtistAudioFile(file: File): { ok: boolean; error?: string } {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_AUDIO_EXT.includes(ext)) {
    return { ok: false, error: `허용된 확장자: ${ALLOWED_AUDIO_EXT.join(', ')}` };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, error: '파일 크기는 100MB 이하여야 합니다' };
  }
  return { ok: true };
}

/**
 * 아티스트 업로드:
 *   1) audio bucket 에 artist_uploads/{user_id}/{ts}_{filename} 경로로 업로드
 *   2) cover image 있으면 covers bucket 에 동일 패턴
 *   3) tracks INSERT — RLS 가 owner_user_id/source_type/visibility_status/승인상태 모두 검증
 */
export async function uploadArtistTrack(input: UploadInput): Promise<UploadResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: '로그인이 필요합니다' };

  // 검증
  const v = validateArtistAudioFile(input.audioFile);
  if (!v.ok) return { ok: false, error: v.error };
  if (!input.title.trim()) return { ok: false, error: '곡 제목을 입력하세요' };

  // 아티스트 프로필 확인
  const profile = await fetchMyArtistProfile(userId);
  if (!profile || profile.approval_status !== 'approved') {
    return { ok: false, error: '승인된 아티스트만 업로드할 수 있습니다' };
  }

  // 1) audio 업로드
  const audioExt = input.audioFile.name.split('.').pop()?.toLowerCase() ?? 'mp3';
  const safeName = input.audioFile.name.replace(/[^\w가-힣.\-_]/g, '_').slice(0, 80);
  const ts = Date.now();
  const audioPath = `artist_uploads/${userId}/${ts}_${safeName}`;

  // 정규 MIME 강제
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    flac: 'audio/flac',
  };
  const audioContentType = mimeMap[audioExt] ?? input.audioFile.type ?? 'application/octet-stream';

  const { error: audioUpErr } = await supabase.storage
    .from('audio')
    .upload(audioPath, input.audioFile, {
      cacheControl: '31536000',
      upsert: false,
      contentType: audioContentType,
    });
  if (audioUpErr) return { ok: false, error: `오디오 업로드 실패: ${audioUpErr.message}` };

  const { data: audioPub } = supabase.storage.from('audio').getPublicUrl(audioPath);
  const audioUrl = audioPub.publicUrl;

  // 2) cover 업로드 (옵션)
  let coverUrl: string | null = null;
  if (input.coverFile) {
    const coverExt = input.coverFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const coverSafe = input.coverFile.name.replace(/[^\w가-힣.\-_]/g, '_').slice(0, 80);
    const coverPath = `artist_uploads/${userId}/${ts}_cover_${coverSafe}`;
    const { error: coverUpErr } = await supabase.storage
      .from('covers')
      .upload(coverPath, input.coverFile, {
        cacheControl: '31536000',
        upsert: false,
        contentType: input.coverFile.type || undefined,
      });
    if (!coverUpErr) {
      const { data } = supabase.storage.from('covers').getPublicUrl(coverPath);
      coverUrl = data.publicUrl;
    }
  }

  // 3) verified payout account 조회 (RLS 가 검증하지만 클라이언트 측 빠른 가드)
  const { data: payout } = await supabase
    .from('artist_payout_accounts')
    .select('id, verification_status')
    .eq('user_id', userId)
    .maybeSingle();
  if (!payout || payout.verification_status !== 'verified') {
    return { ok: false, error: '정산 계좌 등록/승인 완료 후 업로드 가능합니다' };
  }

  // 4) tracks INSERT — RLS 검증 통과해야 성공
  const { data: trackRow, error: trackErr } = await supabase
    .from('tracks')
    .insert({
      title: input.title.trim(),
      artist: (input.artist?.trim() || profile.artist_name),
      album_name: input.album_name?.trim() || null,
      genre: input.genre?.trim() || input.main_genre?.trim() || null,
      main_genre: input.main_genre?.trim() || input.genre?.trim() || null,
      sub_genre: input.sub_genre?.trim() || null,
      mood: input.mood?.trim() || null,
      suitable_store: input.suitable_store?.trim() || null,
      lyrics: input.lyrics?.trim() || null,
      audio_url: audioUrl,
      cover_url: coverUrl,
      owner_user_id: userId,
      artist_profile_id: profile.id,
      payout_account_id: payout.id,
      uploaded_by_account_type: 'artist',
      source_type: 'artist_upload',
      visibility_status: 'pending_review',
    })
    .select('id')
    .single();

  if (trackErr) {
    return { ok: false, error: `트랙 저장 실패: ${trackErr.message}` };
  }

  return { ok: true, track_id: trackRow.id };
}

/** 아티스트가 본인 pending_review 곡 삭제 */
export async function deleteMyArtistTrack(trackId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('tracks').delete().eq('id', trackId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- ADMIN ----------

export async function listPendingReviewTracks(): Promise<PendingReviewTrackRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_pending_review_tracks', { p_limit: 200 });
    if (error) return [];
    return (data ?? []) as PendingReviewTrackRow[];
  } catch {
    return [];
  }
}

export async function approveArtistTrack(trackId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('approve_artist_track', { p_track_id: trackId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function rejectArtistTrack(
  trackId: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('reject_artist_track', {
    p_track_id: trackId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function hideArtistTrack(trackId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('hide_artist_track', { p_track_id: trackId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------- STREAMING ANALYTICS (0019) ----------

export interface ArtistStreamingSummaryRow {
  track_id: string;
  title: string;
  visibility_status: 'pending_review' | 'approved' | 'rejected' | 'hidden';
  total_streams: number;
  today_streams: number;
  last_7d_streams: number;
  last_30d_streams: number;
  last_played_at: string | null;
}

export interface ArtistDailyStreamRow {
  day: string;
  track_id: string;
  title: string;
  daily_streams: number;
}

export async function fetchArtistStreamingSummary(): Promise<ArtistStreamingSummaryRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_artist_streaming_summary');
    if (error) return [];
    return ((data ?? []) as ArtistStreamingSummaryRow[]).map((r) => ({
      ...r,
      total_streams: Number(r.total_streams ?? 0),
      today_streams: Number(r.today_streams ?? 0),
      last_7d_streams: Number(r.last_7d_streams ?? 0),
      last_30d_streams: Number(r.last_30d_streams ?? 0),
    }));
  } catch {
    return [];
  }
}

export interface RepairArtistSignupsResult {
  ok: boolean;
  scanned?: number;
  users_updated?: number;
  profiles_created?: number;
  skipped?: number;
  error?: string;
}

/**
 * 기존 가입자 중 artist_profiles 가 누락된 행을 일괄 보정 (admin only).
 * 멱등 — 여러 번 실행해도 중복/덮어쓰기 없음.
 */
export async function repairArtistSignups(): Promise<RepairArtistSignupsResult> {
  try {
    const { data, error } = await supabase.rpc('repair_artist_signups');
    if (error) {
      if (import.meta.env.DEV) console.error('[repairArtistSignups]', error);
      return { ok: false, error: error.message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { scanned: number; users_updated: number; profiles_created: number; skipped: number }
      | undefined;
    return {
      ok: true,
      scanned: Number(row?.scanned ?? 0),
      users_updated: Number(row?.users_updated ?? 0),
      profiles_created: Number(row?.profiles_created ?? 0),
      skipped: Number(row?.skipped ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- PAYOUT ACCOUNT (0025) ----------

export interface PayoutAccount {
  id: string;
  user_id: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  verification_status: 'pending' | 'verified' | 'rejected';
  verified_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchMyPayoutAccount(userId: string): Promise<PayoutAccount | null> {
  try {
    const { data, error } = await supabase
      .from('artist_payout_accounts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return (data as unknown as PayoutAccount) ?? null;
  } catch {
    return null;
  }
}

export async function submitArtistPayoutAccount(payload: {
  bank_name: string;
  account_number: string;
  account_holder: string;
}): Promise<{ ok: boolean; account_id?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('submit_artist_payout_account', {
      p_bank_name: payload.bank_name,
      p_account_number: payload.account_number,
      p_account_holder: payload.account_holder,
    });
    if (error) return { ok: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, account_id: row?.account_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

// ---------- UPLOAD ELIGIBILITY ----------

export type EligibilityReason =
  | 'login_required'
  | 'not_artist'
  | 'no_artist_profile'
  | 'artist_not_approved'
  | 'no_paid_membership'
  | 'no_payout_account'
  | 'payout_not_verified';

export interface UploadEligibility {
  can_upload: boolean;
  is_artist: boolean;
  approval_status: string;
  has_paid_membership: boolean;
  payout_status: string;
  payout_account_id: string | null;
  reasons: EligibilityReason[];
}

export async function fetchArtistUploadEligibility(): Promise<UploadEligibility> {
  // RPC 실패 시 fallback 은 항상 can_upload=false 로 가드. UI 는 이 외에도
  // payout 상태를 직접 봐서 결정하므로, reasons 빈 배열이 곧 통과로 해석되지 않게 한다.
  const errFallback = (): UploadEligibility => ({
    can_upload: false,
    is_artist: false,
    approval_status: 'unknown',
    has_paid_membership: false,
    payout_status: 'unknown',
    payout_account_id: null,
    reasons: [],
  });
  try {
    const { data, error } = await supabase.rpc('get_artist_upload_eligibility');
    if (error) {
      if (import.meta.env.DEV) console.error('[eligibility] rpc error:', error);
      return errFallback();
    }
    const row = (Array.isArray(data) ? data[0] : data) as UploadEligibility | undefined;
    return row ?? errFallback();
  } catch (e) {
    if (import.meta.env.DEV) console.error('[eligibility] throw:', e);
    return errFallback();
  }
}

// ---------- ADMIN PAYOUT ----------

export interface AdminPayoutRow {
  account_id: string;
  user_id: string;
  artist_name: string | null;
  email: string | null;
  bank_name: string;
  account_number: string;
  account_holder: string;
  verification_status: 'pending' | 'verified' | 'rejected';
  rejected_reason: string | null;
  created_at: string;
}

export async function listPendingPayoutAccounts(): Promise<AdminPayoutRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_pending_payout_accounts', { p_limit: 200 });
    if (error) return [];
    return (data ?? []) as AdminPayoutRow[];
  } catch {
    return [];
  }
}

export async function verifyArtistPayoutAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('verify_artist_payout_account', { p_account_id: accountId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function rejectArtistPayoutAccount(
  accountId: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('reject_artist_payout_account', {
    p_account_id: accountId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchArtistDailyStreams(days = 30): Promise<ArtistDailyStreamRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_artist_daily_streams', { p_days: days });
    if (error) return [];
    return ((data ?? []) as ArtistDailyStreamRow[]).map((r) => ({
      ...r,
      daily_streams: Number(r.daily_streams ?? 0),
    }));
  } catch {
    return [];
  }
}
