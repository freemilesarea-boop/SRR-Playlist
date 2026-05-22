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
import { useAuthStore } from '@/store/authStore';

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
    | 'review_pending'
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
  /** 0083 — 본인 트랙에 한해 안전 라벨로 표시. 원문 audio_health_error 는 노출 X */
  audio_health_status?: 'unknown' | 'ok' | 'unreachable' | 'wrong_mime' | 'empty' | 'error' | null;
  audio_health_checked_at?: string | null;
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
    | 'draft' | 'submitted' | 'review_pending' | 'changes_requested'
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

/**
 * 업로드 단계 raw 에러를 사용자 친화 메시지로 변환.
 * AbortError / "signal is aborted without reason" / 네트워크 오류가
 * 사용자에게 그대로 노출되지 않도록 한다.
 */
export function friendlyUploadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const lower = raw.toLowerCase();
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('abort')) {
    return '업로드 연결이 중단됐어요. 다시 시도해주세요.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('err_network') ||
    lower.includes('connection')
  ) {
    return '네트워크 상태를 확인해주세요. 업로드 연결이 불안정합니다.';
  }
  if (lower.includes('초과') || lower.includes('timeout') || lower.includes('오래')) {
    return '업로드 시간이 오래 걸리고 있어요. 잠시 후 네트워크가 안정되면 다시 시도해주세요.';
  }
  if (
    (lower.includes('exceeded') && (lower.includes('maximum') || lower.includes('size'))) ||
    lower.includes('too large') ||
    lower.includes('payload too large') ||
    lower.includes('413')
  ) {
    return '파일 용량이 업로드 한도를 초과했어요. (현재 플랜의 곡당 업로드 한도를 확인해주세요)';
  }
  // 의미 있는 서버 메시지는 살리되, 빈/모호한 raw 는 일반 안내로 대체
  return raw.trim() ? `업로드 실패: ${raw}` : '파일 업로드에 실패했어요. 다시 시도해주세요.';
}

/**
 * 0077-hotfix — 업로드/저장 등 user.id 만 필요한 액션에서 사용할 빠른 user 조회.
 *
 * `supabase.auth.getSession()` 이 토큰 refresh / 네트워크 지연으로 무한 pending 되면
 * 업로드 전체가 막힘. 다음 순서로 fallback:
 *   1) authStore 캐시 user (즉시, 동기)
 *   2) supabase.auth.getUser() — 5초 timeout (서버 검증 포함)
 *   3) supabase.auth.getSession() — 5초 timeout (refresh 가능)
 *
 * 각 단계마다 console.info 로그. 모두 실패 시 null 반환 — 호출자가 안내 메시지 제어.
 */
export async function getCurrentUserFast(): Promise<{ id: string; email: string | null } | null> {
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.info('[auth-fast]', msg, extra ?? '');

  // 1) authStore 캐시 — 동기, 가장 빠름
  try {
    const cached = useAuthStore.getState().user;
    if (cached?.id) {
      log('cache hit', { uid: cached.id.slice(0, 8) + '…' });
      return { id: cached.id, email: cached.email ?? null };
    }
  } catch (e) {
    log('cache read failed', { err: e instanceof Error ? e.message : String(e) });
  }

  // 2) supabase.auth.getUser() — 5초 timeout
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      5_000,
      'auth.getUser timeout',
    );
    if (!error && data.user?.id) {
      log('getUser ok', { uid: data.user.id.slice(0, 8) + '…' });
      return { id: data.user.id, email: data.user.email ?? null };
    }
    log('getUser empty', { err: error?.message });
  } catch (e) {
    log('getUser timeout/fail', { err: e instanceof Error ? e.message : String(e) });
  }

  // 3) supabase.auth.getSession() — 5초 timeout (refresh 트리거)
  try {
    const { data } = await withTimeout(
      supabase.auth.getSession(),
      5_000,
      'auth.getSession timeout',
    );
    const u = data.session?.user;
    if (u?.id) {
      log('getSession ok', { uid: u.id.slice(0, 8) + '…' });
      return { id: u.id, email: u.email ?? null };
    }
    log('getSession empty');
  } catch (e) {
    log('getSession timeout/fail', { err: e instanceof Error ? e.message : String(e) });
  }

  log('ALL fallbacks failed');
  return null;
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
  /**
   * 일괄 업로드 최적화: 호출 전에 eligibility 를 한 번 확인했으면 true.
   * 파일마다 eligibility RPC 를 반복 호출(30곡=30 RPC)하지 않도록 내부 검사를 건너뜀.
   * (submit_artist_release RPC + RLS 가 서버에서 최종 자격을 재검증하므로 안전)
   */
  skipEligibilityCheck?: boolean;
}

export interface UploadResult {
  ok: boolean;
  track_id?: string;
  track_code?: string;
  error?: string;
  /** 커버를 첨부했으나 업로드 실패 → 음원은 등록됨. UI 가 "커버 재등록 안내" 표시용 */
  cover_warning?: string;
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
  // 0077-hotfix: getSession 무한 pending 방지 — getCurrentUserFast 의 3단 fallback 사용.
  const me = await getCurrentUserFast();
  const uid = me?.id;
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
        'cover_url, audio_url, duration, created_at, ' +
        'audio_health_status, audio_health_checked_at',
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
    // 0077-hotfix — getSession 무한 pending 방지: getCurrentUserFast 가 cache→getUser→
    // getSession 3단 fallback 으로 user.id 빠르게 확보. access_token 은 필요 없음 (이후
    // supabase client 가 자동 첨부).
    const me = await getCurrentUserFast();
    const userId = me?.id;
    log('session ok', { uid: userId ? userId.slice(0, 8) + '…' : 'null' });
    if (!userId) {
      log('session fail — no user');
      return {
        ok: false,
        error: '로그인 정보 확인이 지연되고 있습니다. 새로고침 후에도 반복되면 다시 로그인해주세요.',
      };
    }

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
    if (input.skipEligibilityCheck) {
      log('eligibility skipped (batch pre-checked)');
    } else {
      log('eligibility start');
      const eligibility = await withTimeout(
        fetchArtistUploadEligibility(),
        20_000,
        '업로드 자격 확인이 지연됐어요. 다시 시도해주세요.',
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
        // 업로드는 글로벌 fetch timeout 미적용(supabase.ts) + 앱 단 상한 10분.
        // Slow 3G 대용량(100MB)도 완주하도록 넉넉히 둔다.
        audioUpRes = await withTimeout(
          supabase.storage.from('audio').upload(audioPath, input.audioFile, {
            cacheControl: '31536000', upsert: false, contentType: audioContentType,
          }),
          600_000,
          '업로드 시간이 오래 걸리고 있어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.',
        );
      } catch (e) {
        log('audio upload error', { err: e instanceof Error ? e.message : String(e) });
        return { ok: false, error: friendlyUploadError(e) };
      }
      if (audioUpRes.error) {
        log('audio upload fail', { msg: audioUpRes.error.message });
        return { ok: false, error: friendlyUploadError(audioUpRes.error) };
      }
      const { data: audioPub } = supabase.storage.from('audio').getPublicUrl(audioPath);
      audioUrl = audioPub.publicUrl;
      log('audio upload ok', { url: audioUrl });
    } else {
      audioUrl = input.existingAudioUrl ?? '';
      if (!audioUrl) return { ok: false, error: '기존 음원 URL 을 확인할 수 없어요' };
      log('audio reuse existing', { url: audioUrl });
    }

    // 2) cover 업로드 (옵션) — 실패해도 음원 등록은 진행하되, 실패 사실을 호출자에 surface
    stage = 'cover-upload';
    let coverUrl: string | null = input.existingCoverUrl ?? null;
    let coverWarning: string | undefined;
    if (input.coverFile) {
      const coverSafe = input.coverFile.name.replace(/[^\w가-힣.\-_]/g, '_').slice(0, 80);
      const coverPath = `artist_uploads/${userId}/${ts}_${rand}_cover_${coverSafe}`;
      log('cover upload start', { path: coverPath, sizeKB: (input.coverFile.size / 1024).toFixed(0) });
      try {
        const { error: coverUpErr } = await withTimeout(
          supabase.storage.from('covers').upload(coverPath, input.coverFile, {
            cacheControl: '31536000', upsert: false, contentType: input.coverFile.type || undefined,
          }),
          120_000,
          '커버 이미지 업로드 시간이 초과되었습니다.',
        );
        if (!coverUpErr) {
          const { data } = supabase.storage.from('covers').getPublicUrl(coverPath);
          coverUrl = data.publicUrl;
          log('cover upload ok', { url: coverUrl });
        } else {
          coverWarning = '커버 이미지 업로드에 실패했어요. 음원은 등록되며, 관리자/수정에서 커버를 다시 등록할 수 있어요.';
          console.warn('[uploadArtistTrack] 커버 업로드 실패 (음원은 계속 등록):', { title: input.title, msg: coverUpErr.message });
          log('cover upload skip (계속)', { msg: coverUpErr.message });
        }
      } catch (e) {
        coverWarning = '커버 이미지 업로드가 지연/실패했어요. 음원은 등록되며, 나중에 커버를 다시 등록할 수 있어요.';
        console.warn('[uploadArtistTrack] 커버 업로드 예외 (음원은 계속 등록):', { title: input.title, err: e instanceof Error ? e.message : String(e) });
        log('cover upload TIMEOUT (계속)', { err: e instanceof Error ? e.message : String(e) });
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
        supabase.from('tracks').select('track_code, cover_url').eq('id', trackId).maybeSingle(),
        10_000,
        'track_code 조회 시간이 초과되었습니다 (저장은 완료됨).',
      );
      const saved = row as { track_code?: string | null; cover_url?: string | null } | null;
      trackCode = saved?.track_code ?? undefined;
      // 커버 저장 즉시 검증: 커버를 보냈는데 DB에 cover_url 이 없으면 경고
      const savedCover = saved?.cover_url ?? null;
      if (coverUrl && !savedCover) {
        coverWarning = coverWarning ?? '커버가 저장되지 않았어요. 관리자/수정에서 커버를 다시 등록해주세요.';
        console.warn('[uploadArtistTrack] cover_url 미저장 감지:', { trackId, trackCode, sentCover: coverUrl });
      }
      log('track_code ok', { trackCode, savedCover: !!savedCover });
    } catch (e) {
      log('track_code skip', { err: e instanceof Error ? e.message : String(e) });
    }

    log('SUCCESS', { trackId, trackCode, coverWarning, elapsedMs: Date.now() - startedAt });
    return { ok: true, track_id: trackId, track_code: trackCode, cover_warning: coverWarning };
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

export async function listPendingReviewTracks(opts?: {
  limit?: number;
  offset?: number;
  artistId?: string | null;
}): Promise<PendingReviewTrackRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_pending_review_tracks', {
      p_limit: opts?.limit ?? 50,
      p_offset: opts?.offset ?? 0,
      p_artist_id: opts?.artistId ?? null,
    });
    if (error) return [];
    return (data ?? []) as PendingReviewTrackRow[];
  } catch {
    return [];
  }
}

export interface PendingReviewCounts {
  total: number;
  by_artist: Array<{ owner_user_id: string | null; artist_name: string; n: number }>;
}

/** 검수 대기 총건수 + 아티스트별 건수 (관리자 헤더/필터용). */
export async function countPendingReviewTracks(): Promise<PendingReviewCounts> {
  try {
    const { data, error } = await supabase.rpc('count_pending_review_tracks');
    if (error || !data) return { total: 0, by_artist: [] };
    return data as PendingReviewCounts;
  } catch {
    return { total: 0, by_artist: [] };
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
    | 'submitted' | 'review_pending' | 'changes_requested' | 'scheduled' | 'released' | 'removed'
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

export interface BulkDeleteResult {
  deleted_count: number;
  skipped_count: number;
  skipped: Array<{ track_id: string; reason: string }>;
  failed: Array<{ track_id: string; error: string }>;
  mode: 'soft' | 'hard';
}

/**
 * 음원 일괄 삭제 (관리자). mode='soft'(기본) = release_status='removed' 복구 가능,
 * 'hard' = row 완전 삭제 + storage cleanup 큐 적재.
 * 정산/스트리밍 연결 곡, released/scheduled/approved 곡은 서버에서 차단(skip).
 */
export async function adminBulkDeleteTracks(
  trackIds: string[],
  mode: 'soft' | 'hard' = 'soft',
  reason?: string | null,
): Promise<BulkDeleteResult> {
  const { data, error } = await supabase.rpc('admin_bulk_delete_tracks', {
    p_track_ids: trackIds,
    p_mode: mode,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data as BulkDeleteResult;
}

/** 관리자: 커버 이미지를 covers 버킷에 업로드하고 public URL 반환 */
export async function uploadAdminTrackCover(file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `admin_covers/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('covers').upload(path, file, {
      cacheControl: '31536000', upsert: false, contentType: file.type || undefined,
    });
    if (error) return { ok: false, error: error.message };
    const { data } = supabase.storage.from('covers').getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 관리자: 트랙 cover_url 설정/교체 (커버 누락 곡 복구용) */
export async function adminSetTrackCover(trackId: string, coverUrl: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_track_cover', {
    p_track_id: trackId,
    p_cover_url: coverUrl,
  });
  if (error) throw error;
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

export interface ApproveReleaseResult {
  ok: boolean;
  track_id: string;
  status: 'scheduled' | 'released';
  immediate_release: boolean;
  release_date: string;
}

/**
 * 0076 — 관리자 승인.
 * @param immediateRelease
 *   - true: 즉시 공개 (released)
 *   - false: 예약 발매 유지 (scheduled)
 *   - null/undefined: admin_settings.default_immediate_release 사용 (기본 true)
 *   release_date 가 과거인 경우 서버가 강제로 immediate=true 처리.
 */
export async function adminApproveArtistRelease(
  trackId: string,
  immediateRelease?: boolean | null,
): Promise<ApproveReleaseResult> {
  const { data, error } = await supabase.rpc('admin_approve_artist_release', {
    p_track_id: trackId,
    p_immediate_release: immediateRelease ?? null,
  });
  if (error) throw error;
  return data as ApproveReleaseResult;
}

export async function getAdminSetting<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await supabase.rpc('admin_get_setting', { p_key: key });
  if (error) throw error;
  return (data as T) ?? null;
}

export async function setAdminSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value });
  if (error) throw error;
}

export interface DueScheduledReleaseRow {
  track_id: string;
  track_code: string | null;
  status: 'released' | 'failed';
  error: string | null;
}

/** scheduled 중 release_date 도래한 트랙들 일괄 released 처리. 외부 cron / Edge Function / 관리자 수동 호출용. */
export async function processDueScheduledReleases(): Promise<DueScheduledReleaseRow[]> {
  const { data, error } = await supabase.rpc('process_due_scheduled_releases');
  if (error) throw error;
  return (data ?? []) as DueScheduledReleaseRow[];
}

export interface ReleaseFailureRow {
  id: number;
  track_id: string;
  track_code: string | null;
  title: string | null;
  kind: 'approve' | 'schedule' | 'auto_release' | 'manual_release' | 'requeue';
  error_code: string | null;
  error_message: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

export async function adminListReleaseFailures(
  trackId?: string | null,
  limit = 50,
): Promise<ReleaseFailureRow[]> {
  const { data, error } = await supabase.rpc('admin_list_release_failures', {
    p_track_id: trackId ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ReleaseFailureRow[];
}

// ============================================
// 0078 — admin streaming dashboard wrappers
// ============================================

export interface AdminStreamingDay {
  day: string;
  total_streams: number;
  eligible_streams: number;
  unique_listeners: number;
  unique_tracks: number;
}

export async function adminStreamingOverview(days = 30): Promise<AdminStreamingDay[]> {
  const { data, error } = await supabase.rpc('admin_streaming_overview', { p_days: days });
  if (error) throw error;
  return (data ?? []) as AdminStreamingDay[];
}

export interface AdminTopTrackRow {
  rank: number;
  track_id: string;
  track_code: string | null;
  title: string;
  artist: string | null;
  artist_user_id: string | null;
  stream_count: number;
  eligible_count: number;
}

export async function adminTopStreamingTracks(days = 7, limit = 20): Promise<AdminTopTrackRow[]> {
  const { data, error } = await supabase.rpc('admin_top_streaming_tracks', {
    p_days: days, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminTopTrackRow[];
}

// ============================================
// 0087 — exclusion_reason breakdown
// ============================================

export interface StreamingExclusionBreakdown {
  unreleased: number;
  admin_preview: number;
  artist_preview: number;
  self_play: number;
  daily_user_track_cap: number;
  /** 0089 — 플레이어 음소거 또는 volume=0 */
  muted_play: number;
  /** 0089 — 플레이어 볼륨 10% 미만 */
  low_player_volume: number;
  total_excluded: number;
  total_eligible: number;
  days: number;
}

export async function adminStreamingExclusionBreakdown(days = 30): Promise<StreamingExclusionBreakdown> {
  const { data, error } = await supabase.rpc('admin_streaming_exclusion_breakdown', { p_days: days });
  if (error) throw error;
  return data as StreamingExclusionBreakdown;
}

// ============================================
// 0082 — audio health 워커 + 조회
// ============================================

export interface AudioHealthSummary {
  unknown: number; ok: number; unreachable: number;
  wrong_mime: number; empty: number; error: number;
  total_with_audio: number;
  last_check_at: string | null;
}

export async function adminAudioHealthSummary(): Promise<AudioHealthSummary> {
  const { data, error } = await supabase.rpc('admin_audio_health_summary');
  if (error) throw error;
  return data as AudioHealthSummary;
}

export interface AudioHealthIssue {
  track_id: string; track_code: string | null; title: string; artist: string | null;
  release_status: string | null; visibility_status: string | null;
  audio_url: string;
  audio_health_status: 'unknown' | 'ok' | 'unreachable' | 'wrong_mime' | 'empty' | 'error';
  audio_health_checked_at: string | null;
  audio_health_error: string | null;
  audio_content_type: string | null;
  audio_content_length: number | null;
}

export async function adminAudioHealthIssues(limit = 100): Promise<AudioHealthIssue[]> {
  const { data, error } = await supabase.rpc('admin_audio_health_issues', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AudioHealthIssue[];
}

/** Edge Function `check-audio-health` 호출 — admin Bearer 인증 */
export async function runAudioHealthCheck(opts?: {
  limit?: number; recheck_after_hours?: number; track_ids?: string[];
}): Promise<{
  ok: boolean; processed?: number; updated?: number;
  summary?: Record<string, number>; error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('check-audio-health', {
      body: opts ?? {},
    });
    if (error) return { ok: false, error: error.message };
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Edge Function `process-scheduled-releases` 호출 — admin Bearer 인증 */
export async function runProcessScheduledReleases(): Promise<{
  ok: boolean; processed?: number; released?: number; failed?: number; error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('process-scheduled-releases', {
      body: {},
    });
    if (error) return { ok: false, error: error.message };
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================
// 0083 — admin_notifications wrapper
// ============================================

export interface AdminNotification {
  id: number;
  kind: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  body: string | null;
  context: Record<string, unknown> | null;
  track_id: string | null;
  track_code: string | null;
  track_title: string | null;
  read_at: string | null;
  read_by: string | null;
  created_at: string;
}

export async function adminListNotifications(
  onlyUnread = false, limit = 50,
): Promise<AdminNotification[]> {
  const { data, error } = await supabase.rpc('admin_list_notifications', {
    p_only_unread: onlyUnread, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AdminNotification[];
}

export async function adminNotificationUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_notification_unread_count');
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function adminMarkNotificationRead(id: number): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_notification_read', { p_id: id });
  if (error) throw error;
}

export async function adminMarkAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_mark_all_notifications_read');
  if (error) throw error;
  return (data as number) ?? 0;
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
