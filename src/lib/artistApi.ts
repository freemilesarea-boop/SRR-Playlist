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
  track_code: string | null;
  title: string;
  artist: string | null;
  album_name: string | null;
  release_title: string | null;
  release_type: 'single' | 'ep' | 'album' | null;
  release_date: string | null;
  release_status:
    | 'draft'
    | 'submitted'
    | 'changes_requested'
    | 'approved'
    | 'scheduled'
    | 'released'
    | 'rejected'
    | null;
  audio_review_status: 'pending' | 'approved' | 'rejected' | null;
  cover_review_status: 'pending' | 'approved' | 'rejected' | null;
  metadata_review_status: 'pending' | 'approved' | 'rejected' | null;
  admin_review_note: string | null;
  changes_requested_reason: string | null;
  submission_version: number | null;
  submitted_at: string | null;
  resubmitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  scheduled_at: string | null;
  released_at: string | null;
  visibility_status: 'pending_review' | 'approved' | 'rejected' | 'hidden';
  rejected_reason: string | null;
  rights_holder_name: string | null;
  isrc: string | null;
  explicit_content: boolean | null;
  instrumental: boolean | null;
  genre: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  suitable_store: string | null;
  lyrics: string | null;
  cover_url: string | null;
  audio_url: string;
  duration: number | null;
  created_at: string;
}

export interface PendingReviewTrackRow {
  track_id: string;
  track_code: string | null;
  title: string;
  artist: string | null;
  artist_name: string | null;
  album_name: string | null;
  release_title: string | null;
  isrc: string | null;
  rights_holder_name: string | null;
  rights_confirmed_at: string | null;
  main_genre: string | null;
  sub_genre: string | null;
  mood: string | null;
  suitable_store: string | null;
  lyrics: string | null;
  audio_url: string;
  cover_url: string | null;
  payout_verification_status: 'pending' | 'verified' | 'rejected' | null;
  payout_bank_name: string | null;
  admin_note: string | null;
  created_at: string;
  /** 0075 — DSP release_status / 발매일 / 검수 시작 / 수정 사유 */
  release_status?: string | null;
  release_date?: string | null;
  submitted_at?: string | null;
  review_started_at?: string | null;
  changes_requested_reason?: string | null;
}

export interface AdminTrackRow {
  track_id: string;
  track_code: string | null;
  title: string;
  artist: string | null;
  artist_name: string | null;
  artist_email: string | null;
  album_name: string | null;
  release_title: string | null;
  isrc: string | null;
  rights_holder_name: string | null;
  rights_confirmed_at: string | null;
  visibility_status: 'pending_review' | 'approved' | 'rejected' | 'hidden';
  /** 0074 — DSP 검수 파이프라인 (release_status / release_date / removed_reason) */
  release_status?:
    | 'draft' | 'submitted' | 'changes_requested'
    | 'approved' | 'scheduled' | 'released'
    | 'rejected' | 'removed' | null;
  release_date?: string | null;
  removed_reason?: string | null;
  rejected_reason: string | null;
  admin_note: string | null;
  payout_verification_status: 'pending' | 'verified' | 'rejected' | null;
  contract_status: string | null;
  audio_url: string;
  cover_url: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

/**
 * 0074-hotfix — Promise 에 타임아웃을 강제. 무한 대기로 "업로드 중…" 가 멈추는 문제 방지.
 * timeoutMessage 는 사용자 toast 에 그대로 노출되는 한국어 메시지.
 */
export async function withTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export interface UploadInput {
  title: string;
  album_name: string;
  release_title?: string;
  release_type: ReleaseType;       // 0063 — single / ep / album
  release_date: string;            // 0063 — YYYY-MM-DD, today + 3 days 이상
  isrc?: string;
  rights_holder_name?: string;
  rightsConfirmed: boolean;
  artist?: string;
  genre?: string;
  main_genre?: string;
  sub_genre?: string;
  mood?: string;
  suitable_store?: string;
  description?: string;
  lyrics?: string;
  explicit_content?: boolean;      // 0063
  instrumental?: boolean;          // 0063
  external_link?: string;
  /** 신규 제출 시 필수. 재제출 (trackId) 시 새 파일 업로드만 옵션 */
  audioFile?: File | null;
  coverFile?: File | null;
  trackId?: string | null;         // 0063 — 재제출 시 기존 ID
  /** 재제출 시 기존 audio_url (새 파일 미업로드 시 그대로 유지) */
  existingAudioUrl?: string | null;
  existingCoverUrl?: string | null;
}

export interface UploadResult {
  ok: boolean;
  track_id?: string;
  track_code?: string;
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
  // 0064: RLS tracks_select_owner 정책으로 본인 트랙 직접 조회 (release_* 컬럼 포함).
  // 기존 list_my_artist_tracks RPC 는 release_status / changes_requested_reason 미반환이므로 우회.
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('tracks')
    .select(
      'id, track_code, title, artist, album_name, release_title, release_type, release_date, ' +
        'release_status, audio_review_status, cover_review_status, metadata_review_status, ' +
        'admin_review_note, changes_requested_reason, submission_version, submitted_at, ' +
        'resubmitted_at, reviewed_at, approved_at, scheduled_at, released_at, ' +
        'visibility_status, rejected_reason, rights_holder_name, isrc, explicit_content, ' +
        'instrumental, genre, main_genre, sub_genre, mood, suitable_store, lyrics, ' +
        'cover_url, audio_url, duration, created_at',
    )
    .eq('owner_user_id', uid)
    .eq('source_type', 'artist_upload')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if (import.meta.env.DEV) console.error('[fetchMyArtistTracks] failed:', error);
    return [];
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
  return rows.map((row) => ({ ...row, track_id: row.id })) as unknown as MyArtistTrackRow[];
}

/** 0062 — eligibility reasons 를 사용자에게 보일 한국어 메시지로 변환 */
export function formatEligibilityError(reasons: string[]): string {
  if (!reasons || reasons.length === 0) return '업로드 자격 미달';
  const labels: Record<string, string> = {
    login_required: '로그인이 필요해요',
    not_artist: '아티스트 계정이 아니에요',
    no_artist_profile: '아티스트 프로필이 없어요',
    artist_not_approved: '아티스트 승인 대기 중 — 관리자 승인 후 가능',
    approval_sync_broken:
      '계정 상태 동기화 오류 — 관리자에게 문의해주세요 (artist_approval_status sync)',
    no_paid_membership:
      '음원 업로드는 월 4,900원 정기이용권(individual) 결제 후 가능해요',
    no_signed_contract:
      '음원 유통 계약서 서명이 필요해요 (마이페이지 → 아티스트 → 계약서)',
    no_payout_account: '정산 계좌 등록이 필요해요',
    payout_not_verified: '정산 계좌 승인 대기 중',
  };
  const msgs = reasons.map((r) => labels[r] ?? r);
  return msgs.join(' / ');
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
  // ============================================
  // 0074-hotfix: 단계별 console.info + 모든 await timeout + finally 안전 보장
  // ============================================
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.info('[upload]', msg, extra ?? '');
  const startedAt = Date.now();
  log('start', { isResubmit: !!input.trackId, hasAudio: !!input.audioFile, hasCover: !!input.coverFile });

  let stage = 'init';
  try {
    stage = 'session';
    log('session start');
    const { data: sess } = await withTimeout(
      supabase.auth.getSession(),
      10_000,
      '세션 확인 시간이 초과되었습니다. 새로고침 후 다시 시도해주세요.',
    );
    const userId = sess.session?.user?.id;
    if (!userId) {
      log('session fail — no user');
      return { ok: false, error: '로그인이 필요합니다' };
    }
    log('session ok', { userId });

    // 입력 검증 — 신규 업로드는 audioFile 필수. 재제출(trackId+existingAudioUrl)은 audioFile 옵션.
    stage = 'validate';
    const isResubmit = !!input.trackId;
    if (!isResubmit && !input.audioFile) {
      return { ok: false, error: '음원 파일을 선택해주세요' };
    }
    if (input.audioFile) {
      const v = validateArtistAudioFile(input.audioFile);
      if (!v.ok) return { ok: false, error: v.error };
    }
    if (!input.title.trim()) return { ok: false, error: '곡 제목을 입력하세요' };
    if (!input.rightsConfirmed) {
      return { ok: false, error: '권리 확인 체크박스를 동의해주세요' };
    }

    stage = 'eligibility';
    log('eligibility start');
    const eligibility = await withTimeout(
      fetchArtistUploadEligibility(),
      15_000,
      '업로드 자격 확인 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해주세요.',
    );
    log('eligibility done', { can_upload: eligibility.can_upload });
    if (!eligibility.can_upload) {
      const rpcErr = getLastEligibilityError();
      if (rpcErr) {
        return {
          ok: false,
          error: `업로드 자격 확인 실패 (${rpcErr.code ?? 'RPC'}) — ${rpcErr.message ?? '잠시 후 다시 시도해주세요'}. 문제 지속 시 새로고침 또는 관리자 문의.`,
        };
      }
      return { ok: false, error: formatEligibilityError(eligibility.reasons) };
    }

    stage = 'profile';
    log('profile fetch start');
    const profile = await withTimeout(
      fetchMyArtistProfile(userId),
      10_000,
      '아티스트 프로필 확인 시간이 초과되었습니다.',
    );
    log('profile fetch done', { hasProfile: !!profile, status: profile?.approval_status });
    if (!profile || profile.approval_status !== 'approved') {
      return { ok: false, error: '승인된 아티스트만 업로드할 수 있습니다' };
    }

    // 1) audio 업로드 — 새 파일이 있을 때만 + SHA-256 계산 (중복 방지)
    let audioUrl: string;
    let audioSha256: string | null = null;
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    if (input.audioFile) {
      stage = 'sha256';
      log('sha256 start', { sizeMB: (input.audioFile.size / 1024 / 1024).toFixed(2) });
      try {
        audioSha256 = await withTimeout(
          computeAudioSha256(input.audioFile),
          45_000,
          'SHA-256 계산 시간이 초과되었습니다 — 파일 크기를 줄이거나 다른 브라우저에서 시도해주세요.',
        );
        log('sha256 ok', { sha: audioSha256?.slice(0, 10) + '…' });
      } catch (e) {
        log('sha256 fail (계속)', { err: e instanceof Error ? e.message : String(e) });
      }
      // 사전 중복 확인
      if (audioSha256) {
        stage = 'dup-check';
        log('dup-check start');
        try {
          const { data: existing } = await withTimeout(
            supabase
              .from('tracks')
              .select('id, track_code, release_status')
              .eq('owner_user_id', userId)
              .eq('source_type', 'artist_upload')
              .eq('audio_sha256', audioSha256)
              .maybeSingle(),
            10_000,
            '중복 확인 시간이 초과되었습니다.',
          );
          if (existing && !input.trackId) {
            log('dup-check found', { id: existing.id });
            return {
              ok: false,
              error: `이미 같은 음원 파일을 업로드하셨어요 (${(existing as { track_code?: string | null }).track_code ?? existing.id.slice(0, 8)}). 내 음원 목록에서 수정해주세요.`,
            };
          }
          log('dup-check none');
        } catch (e) {
          log('dup-check skip (계속)', { err: e instanceof Error ? e.message : String(e) });
        }
      }

      stage = 'audio-upload';
      const audioExt = input.audioFile.name.split('.').pop()?.toLowerCase() ?? 'mp3';
      const safeName = input.audioFile.name.replace(/[^\w가-힣.\-_]/g, '_').slice(0, 80);
      const audioPath = `artist_uploads/${userId}/${ts}_${rand}_${safeName}`;
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
      };
      const audioContentType = mimeMap[audioExt] ?? input.audioFile.type ?? 'application/octet-stream';
      log('audio upload start', { path: audioPath, sizeMB: (input.audioFile.size / 1024 / 1024).toFixed(2), contentType: audioContentType });
      let audioUpRes;
      try {
        audioUpRes = await withTimeout(
          supabase.storage.from('audio').upload(audioPath, input.audioFile, {
            cacheControl: '31536000', upsert: false, contentType: audioContentType,
          }),
          120_000,
          '오디오 업로드 시간이 초과되었습니다 (2분). 파일 크기 또는 네트워크 상태를 확인한 뒤 다시 시도해주세요.',
        );
      } catch (e) {
        log('audio upload TIMEOUT', { err: e instanceof Error ? e.message : String(e) });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (audioUpRes.error) {
        log('audio upload fail', { msg: audioUpRes.error.message });
        return { ok: false, error: `오디오 업로드 실패: ${audioUpRes.error.message}` };
      }
      const { data: audioPub } = supabase.storage.from('audio').getPublicUrl(audioPath);
      audioUrl = audioPub.publicUrl;
      log('audio upload ok', { url: audioUrl });
    } else {
      audioUrl = input.existingAudioUrl ?? '';
      if (!audioUrl) return { ok: false, error: '기존 음원 URL 을 확인할 수 없어요' };
      log('audio reuse existing', { url: audioUrl });
    }

    // 2) cover 업로드 (옵션)
    stage = 'cover-upload';
    let coverUrl: string | null = input.existingCoverUrl ?? null;
    if (input.coverFile) {
      const coverSafe = input.coverFile.name.replace(/[^\w가-힣.\-_]/g, '_').slice(0, 80);
      const coverPath = `artist_uploads/${userId}/${ts}_${rand}_cover_${coverSafe}`;
      log('cover upload start', { path: coverPath, sizeKB: (input.coverFile.size / 1024).toFixed(0) });
      try {
        const { error: coverUpErr } = await withTimeout(
          supabase.storage.from('covers').upload(coverPath, input.coverFile, {
            cacheControl: '31536000', upsert: false, contentType: input.coverFile.type || undefined,
          }),
          45_000,
          '커버 이미지 업로드 시간이 초과되었습니다 (45초).',
        );
        if (!coverUpErr) {
          const { data } = supabase.storage.from('covers').getPublicUrl(coverPath);
          coverUrl = data.publicUrl;
          log('cover upload ok', { url: coverUrl });
        } else {
          log('cover upload skip (계속)', { msg: coverUpErr.message });
        }
      } catch (e) {
        log('cover upload TIMEOUT (계속)', { err: e instanceof Error ? e.message : String(e) });
        // cover 실패해도 진행 (선택 항목)
      }
    } else {
      log('cover none');
    }

    // 3) verified payout account 조회
    stage = 'payout-check';
    log('payout check start');
    let payoutOk = false;
    try {
      const { data: payout } = await withTimeout(
        supabase.from('artist_payout_accounts').select('id, verification_status').eq('user_id', userId).maybeSingle(),
        10_000,
        '정산 계좌 확인 시간이 초과되었습니다.',
      );
      payoutOk = !!payout && payout.verification_status === 'verified';
      log('payout check done', { verified: payoutOk });
    } catch (e) {
      log('payout check TIMEOUT', { err: e instanceof Error ? e.message : String(e) });
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!payoutOk) {
      return { ok: false, error: '정산 계좌 등록/승인 완료 후 업로드 가능합니다' };
    }

    // 4) submit_artist_release RPC
    stage = 'submit-rpc';
    log('submit_artist_release RPC start');
    let trackId: string;
    try {
      trackId = await withTimeout(
        submitArtistRelease({
          trackId: input.trackId ?? null,
          title: input.title.trim(),
          artist: input.artist?.trim() || profile.artist_name,
          albumName: input.album_name.trim(),
          releaseTitle: input.release_title?.trim() || input.album_name.trim(),
          releaseType: input.release_type,
          releaseDate: input.release_date,
          mainGenre: input.main_genre?.trim() || input.genre?.trim() || null,
          subGenre: input.sub_genre?.trim() || null,
          mood: input.mood?.trim() || null,
          suitableStore: input.suitable_store?.trim() || null,
          lyrics: input.lyrics?.trim() || null,
          isrc: input.isrc?.trim().toUpperCase() || null,
          rightsHolderName:
            input.rights_holder_name?.trim() || profile.real_name || profile.artist_name || null,
          explicitContent: input.explicit_content ?? false,
          instrumental: input.instrumental ?? false,
          audioUrl,
          coverUrl,
          rightsConfirmed: input.rightsConfirmed,
        }),
        45_000,
        '음원 등록 서버 응답 시간이 초과되었습니다 (45초). 잠시 후 다시 시도해주세요.',
      );
      log('submit_artist_release RPC ok', { trackId });
    } catch (e) {
      const err = e as { message?: string; hint?: string; details?: string; code?: string };
      const msg = err.message ?? String(e);
      log('submit_artist_release RPC FAIL', {
        code: err.code, message: err.message, details: err.details, hint: err.hint,
      });
      if (msg.includes('row-level security') || err.code === '42501') {
        const recheck = await fetchArtistUploadEligibility().catch(() => null);
        if (recheck && !recheck.can_upload) {
          return { ok: false, error: `트랙 저장 실패 — ${formatEligibilityError(recheck.reasons)}` };
        }
      }
      if (err.code === 'PGRST203' || err.code === 'PGRST202') {
        return {
          ok: false,
          error: '음원 등록 함수 호출 실패 (서버 함수 시그니처 불일치). 잠시 후 다시 시도해주시고, 문제가 지속되면 관리자에게 문의해주세요.',
        };
      }
      const tail = err.hint ?? err.details;
      return { ok: false, error: tail ? `${msg} (${tail})` : msg };
    }

    // 5) track_code 조회 — 실패해도 OK, 트랙 저장은 이미 성공
    stage = 'fetch-track-code';
    log('track_code fetch start');
    let trackCode: string | undefined;
    try {
      const { data: row } = await withTimeout(
        supabase.from('tracks').select('track_code').eq('id', trackId).maybeSingle(),
        10_000,
        'track_code 조회 시간이 초과되었습니다 (저장은 완료됨).',
      );
      trackCode = (row as { track_code?: string | null } | null)?.track_code ?? undefined;
      log('track_code ok', { trackCode });
    } catch (e) {
      log('track_code skip', { err: e instanceof Error ? e.message : String(e) });
    }

    log('SUCCESS', { trackId, trackCode, elapsedMs: Date.now() - startedAt });
    return { ok: true, track_id: trackId, track_code: trackCode };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('FATAL at stage=' + stage, { err: msg });
    return { ok: false, error: `${stage} 단계 실패 — ${msg}` };
  } finally {
    log('finally', { stage, elapsedMs: Date.now() - startedAt });
  }
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

export async function approveArtistTrack(
  trackId: string,
  adminNote?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('approve_artist_track', {
    p_track_id: trackId,
    p_admin_note: adminNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function rejectArtistTrack(
  trackId: string,
  reason: string | null,
  adminNote?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('reject_artist_track', {
    p_track_id: trackId,
    p_reason: reason,
    p_admin_note: adminNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function hideArtistTrack(
  trackId: string,
  adminNote?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('hide_artist_track', {
    p_track_id: trackId,
    p_admin_note: adminNote ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function adminListArtistTracks(opts?: {
  /** visibility_status 또는 release_status 의 값 (서버 RPC 가 둘 다 매칭) */
  status?:
    | 'pending_review' | 'approved' | 'rejected' | 'hidden'
    | 'submitted' | 'changes_requested' | 'scheduled' | 'released' | 'removed'
    | '';
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminTrackRow[]> {
  const { data, error } = await supabase.rpc('admin_artist_tracks_list', {
    p_status: opts?.status || null,
    p_search: opts?.search || null,
    p_limit: opts?.limit ?? 100,
    p_offset: opts?.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as AdminTrackRow[];
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
  | 'approval_sync_broken'    // 0062
  | 'no_paid_membership'
  | 'no_signed_contract'      // 0057
  | 'no_payout_account'
  | 'payout_not_verified';

export type ReleaseStatus =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'released'
  | 'rejected';

export type ReleaseType = 'single' | 'ep' | 'album';

export interface UploadEligibility {
  can_upload: boolean;
  is_artist: boolean;
  approval_status: string;
  has_paid_membership: boolean;
  contract_status?: 'not_created' | 'pending_signature' | 'signed' | 'rejected' | 'expired';
  has_signed_contract?: boolean;
  pending_contract_id?: string | null;
  payout_status: string;
  payout_account_id: string | null;
  min_release_date?: string; // 0063 — YYYY-MM-DD (today + 3 days)
  reasons: EligibilityReason[];
}

export interface SubmitReleaseInput {
  trackId?: string | null;
  title: string;
  artist?: string | null;
  albumName: string;
  releaseTitle?: string | null;
  releaseType: ReleaseType;
  releaseDate: string; // YYYY-MM-DD
  mainGenre?: string | null;
  subGenre?: string | null;
  mood?: string | null;
  suitableStore?: string | null;
  lyrics?: string | null;
  isrc?: string | null;
  rightsHolderName?: string | null;
  explicitContent: boolean;
  instrumental: boolean;
  audioUrl: string;
  coverUrl?: string | null;
  rightsConfirmed: boolean;
  /** 0065 — 클라이언트가 계산한 audio 파일 SHA-256 (hex). 중복 업로드 방지용 */
  audioSha256?: string | null;
}

/** Web Crypto API 로 파일 SHA-256 hex 계산. 대용량 파일 안전. */
export async function computeAudioSha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function submitArtistRelease(input: SubmitReleaseInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_artist_release', {
    p_track_id: input.trackId ?? null,
    p_title: input.title,
    p_artist: input.artist ?? null,
    p_album_name: input.albumName,
    p_release_title: input.releaseTitle ?? null,
    p_release_type: input.releaseType,
    p_release_date: input.releaseDate,
    p_main_genre: input.mainGenre ?? null,
    p_sub_genre: input.subGenre ?? null,
    p_mood: input.mood ?? null,
    p_suitable_store: input.suitableStore ?? null,
    p_lyrics: input.lyrics ?? null,
    p_isrc: input.isrc ?? null,
    p_rights_holder_name: input.rightsHolderName ?? null,
    p_explicit_content: input.explicitContent,
    p_instrumental: input.instrumental,
    p_audio_url: input.audioUrl,
    p_cover_url: input.coverUrl ?? null,
    p_rights_confirmed: input.rightsConfirmed,
    p_audio_sha256: input.audioSha256 ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminApproveArtistRelease(trackId: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_approve_artist_release', { p_track_id: trackId });
  if (error) throw error;
  return (data as { status: string }).status;
}

export async function adminRequestTrackChanges(
  trackId: string,
  note: string,
  target: 'audio' | 'cover' | 'metadata' | 'all' = 'all',
): Promise<void> {
  const { error } = await supabase.rpc('admin_request_track_changes', {
    p_track_id: trackId,
    p_note: note,
    p_target: target,
  });
  if (error) throw error;
}

export async function adminReleaseNow(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_release_now', { p_track_id: trackId });
  if (error) throw error;
}

export async function adminRejectArtistRelease(trackId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_artist_release', {
    p_track_id: trackId,
    p_note: note,
  });
  if (error) throw error;
}

export async function adminStartTrackReview(trackId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_start_track_review', { p_track_id: trackId });
  if (error) throw error;
}

// ============================================
// 0074 — DSP 검수 파이프라인 wrapper
// ============================================

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

/**
 * 마지막 fetchArtistUploadEligibility 호출의 raw error (사용자 toast 보강용).
 * production 빌드에서도 노출 — 운영 진단 시 정확한 메시지 확보.
 */
let _lastEligibilityError: { code?: string; message?: string; details?: string } | null = null;
export function getLastEligibilityError() { return _lastEligibilityError; }

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
      _lastEligibilityError = {
        code: (error as { code?: string }).code,
        message: error.message,
        details: (error as { details?: string }).details,
      };
      // 항상 출력 (production 운영 진단 가능하게)
      // eslint-disable-next-line no-console
      console.error('[eligibility] rpc error:', _lastEligibilityError);
      return errFallback();
    }
    _lastEligibilityError = null;
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
  /** 0061 — 항상 마스킹된 값만 RPC 에서 반환 (원본은 admin_reveal_payout_account 로) */
  masked_account_number: string;
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

/** 0061 — admin 만 호출. 원본 계좌번호 반환 + audit log INSERT. verified 상태만 허용. */
export interface RevealedPayoutAccount {
  account_id: string;
  account_number: string;
  bank_name: string;
  account_holder: string;
  artist_user_id: string;
  log_id: string;
  viewed_at: string;
}

export async function adminRevealPayoutAccount(opts: {
  accountId: string;
  reason?: string | null;
  settlementId?: string | null;
}): Promise<RevealedPayoutAccount> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_reveal_payout_account', {
    p_account_id: opts.accountId,
    p_reason: opts.reason ?? null,
    p_settlement_id: opts.settlementId ?? null,
    p_user_agent: ua,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RevealedPayoutAccount | undefined;
  if (!row) throw new Error('empty response');
  return row;
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
