/**
 * artistApi.ts
 *
 * 아티스트 업로드/검수 관련 클라이언트 API.
 *   - fetchMyArtistProfile: 로그인 사용자의 아티스트 프로필
 *   - fetchMyArtistTracks: 본인 업로드 곡 (모든 visibility)
 *   - uploadArtistTrack: storage 업로드 + tracks INSERT
 *   - admin: approveArtistTrack / rejectArtistTrack / hideArtistTrack / listPendingReviewTracks
 */

import { supabase, supabaseProjectRef } from './supabase';
import { useAuthStore } from '@/store/authStore';
import { uploadDebug } from '@/store/uploadDebugStore';
import { generateSafeStoragePath, safeExtension } from './storagePath';
import { fetchQualityThresholds, analyzeAudioQuality, recordAudioQuality, type QualityResult } from './qualityGate';
import { fetchSiteSettings } from './siteSettingsApi';

export interface UploadQuotaInfo {
  used: number;
  quota: number;
  remaining: number;
  period_start: string;
  period_end: string;
}

export async function fetchMyUploadQuota(): Promise<UploadQuotaInfo | null> {
  const { data, error } = await supabase.rpc('get_my_upload_quota');
  if (error) {
    if (import.meta.env.DEV) console.warn('[uploadQuota] fetch failed', error);
    return null;
  }
  const row = (data as UploadQuotaInfo[] | null)?.[0];
  return row ?? null;
}

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
  /** 0155 — 검수 페이지 재생 가능/발매 게이트 진단용 audio 메타 */
  storage_path?: string | null;
  audio_content_type?: string | null;
  duration?: number | null;
  audio_content_length?: number | null;
  audio_health_status?: string | null;
  /** 0161 — AI 큐레이션 판정 (검수 화면 연결) */
  ai_status?: string | null;
  ai_energy_level?: string | null;
  ai_store_fit?: Record<string, number> | null;
  ai_moods?: string[] | null;
  mismatch_score?: number | null;
  mismatch_reasons?: string[] | null;
  ai_explanation?: string | null;
  /** 0167 — Loudness 품질 게이트 측정값 */
  q_integrated_lufs?: number | null;
  q_true_peak?: number | null;
  q_loudness_range?: number | null;
  q_clipping?: boolean | null;
  q_passed?: boolean | null;
  /** 0175 — 업로더 metadata 신뢰도 */
  owner_trust_score?: number | null;
  owner_trust_tier?: 'high' | 'medium' | 'low' | null;
}

/**
 * 0155 — 관리자 검수 self-heal: 브라우저에서 추출한 duration/content_type 을 트랙에 백필.
 * duration 미기록으로 발매 게이트에 막힌 곡을 검수 페이지에서 자동 복구한다.
 */
export async function adminBackfillTrackAudioMeta(input: {
  trackId: string;
  duration?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
  health?: string | null;
}): Promise<{ ok: boolean; duration: number | null; content_type: string | null; audio_health_status: string | null }> {
  const { data, error } = await supabase.rpc('admin_backfill_track_audio_meta', {
    p_track_id: input.trackId,
    p_duration: input.duration ?? null,
    p_content_type: input.contentType ?? null,
    p_content_length: input.contentLength ?? null,
    p_health: input.health ?? null,
  });
  if (error) throw error;
  return data as { ok: boolean; duration: number | null; content_type: string | null; audio_health_status: string | null };
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
 * 일시적 지연/네트워크 오류로 실패하면 1회(기본 2회 시도) 재시도.
 * 마지막 시도까지 실패하면 마지막 에러를 그대로 throw (friendly 메시지 유지).
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
  // storage key/path 관련 오류는 사용자에게 원인을 노출하지 않고 자연스럽게 안내.
  // (정상 흐름에서는 path 를 UUID 로 생성하므로 발생하지 않지만, 안전망으로 둔다.)
  if (lower.includes('invalid key') || lower.includes('invalid_key') || lower.includes('key is not valid')) {
    return '파일 업로드에 실패했어요. 잠시 후 다시 시도해주세요.';
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
  /** 0194 — 업로드 무결성 추적: 배치 ID / 불변 client_track_id / 파일 fingerprint */
  batchId?: string | null;
  clientTrackId?: string | null;
  sourceFingerprint?: string | null;
  /**
   * 0196 — 호출 전에 원본 파일 SHA-256 을 미리 계산했으면 전달.
   * 일괄 업로드에서 batch 내 동일 콘텐츠 사전 차단에 사용한 값을 재사용 → 중복 해싱 방지.
   */
  precomputedAudioSha256?: string | null;
  /**
   * 일괄 업로드 최적화: 호출 전에 eligibility 를 한 번 확인했으면 true.
   * 파일마다 eligibility RPC 를 반복 호출(30곡=30 RPC)하지 않도록 내부 검사를 건너뜀.
   * (submit_artist_release RPC + RLS 가 서버에서 최종 자격을 재검증하므로 안전)
   */
  skipEligibilityCheck?: boolean;
  /**
   * 일괄 업로드 최적화: 업로드 시작 시 1회 조회한 아티스트 프로필을 넘기면
   * 곡마다 fetchMyArtistProfile 를 재호출하지 않는다 (대량 동시 업로드 시 연결 경합 → timeout 방지).
   */
  prefetchedProfile?: ArtistProfile | null;
  /**
   * 일괄 업로드 최적화: 시작 시 eligibility(get_artist_upload_eligibility, payout 검증 포함)를
   * 1회 확인했으면 곡별 payout 계좌 재조회를 생략. (서버 RPC/RLS 가 최종 재검증)
   */
  skipPayoutCheck?: boolean;
}

export interface UploadResult {
  ok: boolean;
  track_id?: string;
  track_code?: string;
  error?: string;
  /** 커버를 첨부했으나 업로드 실패 → 음원은 등록됨. UI 가 "커버 재등록 안내" 표시용 */
  cover_warning?: string;
}

/**
 * 로그인 사용자가 아티스트로 지원(전환). 신규 auth 가입 없이 본인 계정에
 * artist_profiles(pending) 생성 + users.account_type='artist' 설정. 멱등.
 */
export async function submitArtistSignupProfile(input: {
  realName: string;
  birthDate: string;
  artistName: string;
  phone: string;
  address: string;
  email: string;
  inviteCode: string;
}): Promise<void> {
  const { error } = await supabase.rpc('submit_artist_signup_profile', {
    p_real_name: input.realName,
    p_birth_date: input.birthDate,
    p_artist_name: input.artistName,
    p_phone: input.phone,
    p_address: input.address,
    p_email: input.email,
    p_invite_code: input.inviteCode,
  });
  if (error) throw error;
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
const ALLOWED_AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac'];
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB

// 확장자 ↔ 허용 MIME 매핑 (불일치 검사용). 빈 type 은 브라우저가 못 정한 것이므로 통과.
const EXT_MIME_OK: Record<string, RegExp> = {
  mp3: /^audio\/(mpeg|mp3)$/i,
  wav: /^audio\/(wav|x-wav|wave|vnd\.wave)$/i,
  m4a: /^audio\/(mp4|x-m4a|m4a|aac)$/i,
  aac: /^audio\/(aac|mp4|x-aac)$/i,
  flac: /^audio\/(flac|x-flac)$/i,
};

export function validateArtistAudioFile(file: File): { ok: boolean; error?: string } {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_AUDIO_EXT.includes(ext)) {
    return { ok: false, error: `허용된 확장자: ${ALLOWED_AUDIO_EXT.join(', ')}` };
  }
  if (file.size === 0) {
    return { ok: false, error: '빈 파일(0바이트)입니다. 다른 파일을 선택해주세요.' };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, error: '파일 크기는 100MB 이하여야 합니다' };
  }
  // MIME/확장자 불일치 — type 이 비어있으면(브라우저가 모름) 통과, 명백히 다르면 차단.
  const expect = EXT_MIME_OK[ext];
  if (file.type && expect && !expect.test(file.type)) {
    return {
      ok: false,
      error: `파일 형식이 확장자(.${ext})와 일치하지 않아요 (감지된 형식: ${file.type}). 올바른 파일인지 확인해주세요.`,
    };
  }
  return { ok: true };
}

/**
 * 오디오 파일의 재생 길이(초)를 브라우저에서 추출. 추출 불가/손상 파일이면 null.
 * 발매 게이트(duration 필수)에 사용. best-effort — 10초 timeout.
 */
export async function extractAudioDuration(file: File): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  return new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    let done = false;
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
      audio.removeAttribute('src');
    };
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), 10_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    audio.src = url;
  });
}

/**
 * 아티스트 업로드:
 *   1) audio bucket 에 artist_uploads/{user_id}/{uuid}.{ext} 경로로 업로드 (URL-safe)
 *   2) cover image 있으면 covers bucket 에 동일 패턴 ({uuid}_cover.{ext})
 *   3) tracks INSERT — RLS 가 owner_user_id/source_type/visibility_status/승인상태 모두 검증
 */
/**
 * 0196 — 업로드 실패를 무결성 로그에 기록 (best-effort, fire-and-forget).
 * 운영 이상징후 집계(failed uploads / transcoding 실패)와 사후 추적에 사용.
 */
async function logUploadFailure(
  input: UploadInput,
  opts: {
    trackId?: string | null; storagePath?: string | null; originalSha?: string | null;
    finalSha?: string | null; duration?: number | null; transcoded?: boolean;
    transcodingStatus?: string | null; originalFilesize?: number | null; finalFilesize?: number | null;
    error: string;
  },
): Promise<void> {
  try {
    await supabase.rpc('record_upload_integrity2', {
      p_batch_id: input.batchId ?? null,
      p_client_track_id: input.clientTrackId ?? null,
      p_track_id: opts.trackId ?? null,
      p_original_filename: input.audioFile?.name ?? null,
      p_source_fingerprint: input.sourceFingerprint ?? null,
      p_original_sha256: opts.originalSha ?? null,
      p_final_sha256: opts.finalSha ?? null,
      p_storage_path: opts.storagePath ?? null,
      p_duration: opts.duration ?? null,
      p_transcoded: opts.transcoded ?? false,
      p_status: 'failed',
      p_error: opts.error ? opts.error.slice(0, 500) : null,
      p_original_filesize: opts.originalFilesize ?? input.audioFile?.size ?? null,
      p_final_filesize: opts.finalFilesize ?? null,
      p_transcoding_status: opts.transcodingStatus ?? null,
    });
  } catch { /* best-effort */ }
}

export async function uploadArtistTrack(input: UploadInput): Promise<UploadResult> {
  // ============================================
  // 0074-hotfix: 단계별 console.info + 모든 await timeout + finally 안전 보장
  // ============================================
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.info('[UploadTrack]', msg, extra ?? '');
  const startedAt = Date.now();
  const fileMeta = (f?: File | null) =>
    f ? { name: f.name, size: f.size, type: f.type } : null;
  uploadDebug.begin({ title: input.title, audio: fileMeta(input.audioFile), cover: fileMeta(input.coverFile) });
  log('started', {
    projectRef: supabaseProjectRef,
    isResubmit: !!input.trackId,
    title: input.title,
    audio: fileMeta(input.audioFile) ?? 'none',
    cover: fileMeta(input.coverFile) ?? 'none',
  });

  let stage = 'init';
  try {
    stage = 'distribution_kill_switch';
    const _siteSettings = await fetchSiteSettings().catch(() => null);
    if (_siteSettings && _siteSettings.distribution_enabled === false) {
      throw new Error(
        '현재 과도한 음원 등록으로 인해 신규 음원 유통 접수가 일시 중지되었습니다.\n' +
        '메타데이터 및 음원 품질 검수 완료 후 다시 이용하실 수 있습니다.',
      );
    }

    stage = 'session';
    log('session start');
    // 0077-hotfix — getSession 무한 pending 방지: getCurrentUserFast 가 cache→getUser→
    // getSession 3단 fallback 으로 user.id 빠르게 확보. access_token 은 필요 없음 (이후
    // supabase client 가 자동 첨부).
    const me = await getCurrentUserFast();
    const userId = me?.id;
    log('session ok', { uid: userId ? userId.slice(0, 8) + '…' : 'null' });

    // 월 50곡 한도 사전 차단 (서버 트리거가 최종 가드 — 여기서는 빠른 실패 + 친절한 안내)
    if (!input.trackId && !input.skipEligibilityCheck) {
      stage = 'monthly_upload_quota';
      const quota = await fetchMyUploadQuota().catch(() => null);
      if (quota && quota.remaining <= 0) {
        throw new Error(
          `이번 달 음원 등록 한도 ${quota.quota}곡을 모두 사용하셨습니다.\n` +
          '다음 달 1일부터 다시 등록 가능합니다.',
        );
      }
    }
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
    const titleTrim = input.title.trim();
    if (!titleTrim) return { ok: false, error: '곡 제목을 입력하세요' };
    // placeholder/미입력 방지 — "<...>" 형태(예: "<곡 제목>")는 실제 제목이 아님
    if (/^<.*>$/.test(titleTrim)) {
      return { ok: false, error: '곡 제목을 실제 제목으로 입력해주세요 (예시 텍스트는 사용할 수 없어요).' };
    }
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
    // 일괄 업로드는 시작 시 1회 조회한 프로필을 재사용 (곡별 재조회로 인한 연결 경합/timeout 방지)
    let profile = input.prefetchedProfile ?? null;
    if (!profile) {
      log('profile fetch start');
      profile = await withRetry(() =>
        withTimeout(
          fetchMyArtistProfile(userId),
          15_000,
          '계정 상태 확인이 지연되었습니다. 다시 시도해주세요.',
        ),
      );
    }
    log('profile fetch done', { hasProfile: !!profile, status: profile?.approval_status, prefetched: !!input.prefetchedProfile });
    if (!profile || profile.approval_status !== 'approved') {
      return { ok: false, error: '승인된 아티스트만 업로드할 수 있습니다' };
    }

    // 1) audio 업로드 — 새 파일이 있을 때만 + SHA-256 계산 (중복 방지)
    let audioUrl: string;
    let audioSha256: string | null = null;
    // 0153 — 원본 파일명/실제 storage key 분리 기록 (storage key 에는 한국어 미포함)
    let audioStoragePath: string | null = null;
    let coverStoragePathVal: string | null = null;
    // 0194 — 업로드 무결성: 최종 업로드(변환 후) 바이트 sha + 변환 여부
    let finalAudioSha: string | null = null;
    let wasTranscoded = false;
    // 0196 — 변환 상태/파일 크기 추적 (감사 로그)
    let transcodingStatus: 'none' | 'transcoded' | 'failed' = 'none';
    const originalFilesize: number | null = input.audioFile?.size ?? null;
    let finalFilesize: number | null = null;
    const originalFilename = input.audioFile?.name ?? null;
    // 0154 — 발매 게이트(duration 필수)용 메타. 업로드 후 set_artist_track_audio_meta 로 기록.
    let audioDurationVal: number | null = null;
    let audioContentTypeVal: string | null = null;
    let audioContentLengthVal: number | null = null;
    // 0167 — Loudness 품질 게이트 결과(통과 시 insert 후 track_id 와 함께 기록)
    let qualityResult: QualityResult | null = null;
    if (input.audioFile) {
      stage = 'sha256';
      // 0196 — 폼에서 batch 사전 중복검사 시 계산한 sha 를 재사용 (중복 해싱 방지)
      if (input.precomputedAudioSha256) {
        audioSha256 = input.precomputedAudioSha256;
        log('sha256 reuse (precomputed)', { sha: audioSha256.slice(0, 10) + '…' });
      } else {
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
      // iOS Safari 는 비압축 WAV/FLAC(특히 24/32bit·float PCM)을 스트리밍 재생하지 못하는 경우가 많다
      // (Chrome 데스크탑은 디코딩 가능 → "PC는 되는데 아이폰만 안됨"의 전형). 전 기기 호환을 위해
      // 업로드 전 mp3 가 아니면 표준 MP3(libmp3lame 192k/44.1k/stereo)로 변환한다.
      let fileToUpload: File = input.audioFile;
      const origExt = input.audioFile.name.split('.').pop()?.toLowerCase() ?? '';
      const isMp3 = origExt === 'mp3' || input.audioFile.type === 'audio/mpeg';
      if (!isMp3) {
        stage = 'transcode';
        log('transcode→mp3 start', { from: origExt || input.audioFile.type });
        uploadDebug.step('transcode', 'info', `mp3 변환 (${origExt || 'unknown'})`);
        try {
          const { transcodeToStandardMp3 } = await import('@/lib/audioTranscode');
          fileToUpload = await withTimeout(
            transcodeToStandardMp3(input.audioFile),
            600_000,
            'MP3 변환 시간이 초과되었습니다.',
          );
          log('transcode→mp3 ok', { sizeMB: (fileToUpload.size / 1024 / 1024).toFixed(2) });
          uploadDebug.step('transcode', 'ok', `${(fileToUpload.size / 1024 / 1024).toFixed(1)}MB`);
          transcodingStatus = 'transcoded';
        } catch (e) {
          // 변환 실패 시 업로드 자체는 막지 않고 원본 업로드(추후 재인코딩 필요). 콘솔/디버그에 기록.
          log('transcode→mp3 FAIL (원본 업로드)', { err: e instanceof Error ? e.message : String(e) });
          uploadDebug.step('transcode', 'warn', e instanceof Error ? e.message : String(e));
          fileToUpload = input.audioFile;
          transcodingStatus = 'failed';
        }
      }
      // 0194 — 최종 업로드 바이트(변환 후) 무결성 sha. 변환 race 검출/감사용. best-effort.
      wasTranscoded = fileToUpload !== input.audioFile;
      finalFilesize = fileToUpload.size || null;
      try { finalAudioSha = await withTimeout(computeAudioSha256(fileToUpload), 45_000, 'final sha timeout'); }
      catch { finalAudioSha = null; }
      // storage key 는 URL-safe ASCII 만 허용 — 사용자 파일명(한국어/공백/특수문자)은
      // 절대 path 에 넣지 않고 UUID 기반으로 생성. 제목은 DB(title)로만 관리.
      const audioExt = safeExtension(fileToUpload.name, 'mp3');
      const audioPath = generateSafeStoragePath({ prefix: 'artist_uploads', userId, ext: audioExt });
      audioStoragePath = audioPath;
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac',
      };
      const audioContentType = mimeMap[audioExt] ?? fileToUpload.type ?? 'application/octet-stream';
      audioContentTypeVal = audioContentType;
      audioContentLengthVal = fileToUpload.size || null;
      // 재생 길이 추출 (best-effort) — 발매 게이트(duration 필수)에 사용
      try {
        audioDurationVal = await withTimeout(extractAudioDuration(fileToUpload), 12_000, 'duration 추출 시간 초과');
      } catch {
        audioDurationVal = null;
      }
      log('audio meta', { durationSec: audioDurationVal, contentType: audioContentType });

      // 0167 — Loudness 품질 게이트: "분석 → 통과 → 업로드". 미달 시 storage 업로드/insert 차단.
      // 자동 normalize 금지. 통과 음원만 등록·검수 진입.
      stage = 'quality-gate';
      try {
        const th = await fetchQualityThresholds();
        if (th.enabled) {
          uploadDebug.step('quality-gate', 'info', 'loudness 분석 중…');
          const q = await withTimeout(
            analyzeAudioQuality(fileToUpload, th),
            75_000,
            '음질 분석 시간이 초과되었어요. 잠시 후 다시 시도해주세요.',
          );
          log('quality gate', { lufs: q.integrated_lufs, tp: q.true_peak_dbtp, grade: q.grade, reasons: q.reasons });
          if (q.grade === 'reject') {
            // REJECT: storage 업로드 전 차단 — 로그만 남김(track_id 없음)
            void recordAudioQuality({ originalFilename, result: q });
            uploadDebug.step('quality-gate', 'error', `reject: ${q.reasons.join(',') || '?'} (LUFS ${q.integrated_lufs ?? '?'} / TP ${q.true_peak_dbtp ?? '?'})`);
            uploadDebug.finish({ ok: false, audioStatus: 'error', error: `quality-gate: ${q.failure_reason}` });
            void logUploadFailure(input, { originalSha: audioSha256, transcodingStatus, originalFilesize, finalFilesize, error: `quality-gate: ${q.failure_reason}` });
            return { ok: false, error: q.message ?? '음질 기준 미달로 등록할 수 없어요.' };
          }
          qualityResult = q; // pass/warning — 업로드 허용, insert 후 track_id 와 함께 기록
          if (q.grade === 'warning') {
            uploadDebug.step('quality-gate', 'warn', `warning: ${q.reasons.join(',')} (LUFS ${q.integrated_lufs} · TP ${q.true_peak_dbtp})`);
          } else {
            uploadDebug.step('quality-gate', 'ok', `LUFS ${q.integrated_lufs} · TP ${q.true_peak_dbtp}`);
          }
        }
      } catch (e) {
        // 분석 자체 timeout/예외 — 통과 음원을 막지 않도록 게이트는 통과시키되 경고 로그.
        log('quality gate skip (분석 예외, 통과 처리)', { err: e instanceof Error ? e.message : String(e) });
        uploadDebug.step('quality-gate', 'warn', '분석 지연/예외 — 게이트 우회');
      }

      log('audio upload start', { path: audioPath, sizeMB: (fileToUpload.size / 1024 / 1024).toFixed(2), contentType: audioContentType });
      let audioUpRes;
      try {
        // 업로드는 글로벌 fetch timeout 미적용(supabase.ts) + 앱 단 상한 10분.
        // Slow 3G 대용량(100MB)도 완주하도록 넉넉히 둔다.
        audioUpRes = await withTimeout(
          supabase.storage.from('audio').upload(audioPath, fileToUpload, {
            cacheControl: '31536000', upsert: false, contentType: audioContentType,
          }),
          600_000,
          '업로드 시간이 오래 걸리고 있어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.',
        );
      } catch (e) {
        const msg = friendlyUploadError(e);
        log('audio upload error', { err: e instanceof Error ? e.message : String(e) });
        uploadDebug.finish({ ok: false, audioStatus: 'error', error: `audio-upload: ${msg}` });
        uploadDebug.step('audio-upload', 'error', msg);
        void logUploadFailure(input, { storagePath: audioStoragePath, originalSha: audioSha256, transcodingStatus, originalFilesize, finalFilesize, error: `audio-upload: ${e instanceof Error ? e.message : String(e)}` });
        return { ok: false, error: msg };
      }
      if (audioUpRes.error) {
        const msg = friendlyUploadError(audioUpRes.error);
        log('audio upload fail', { msg: audioUpRes.error.message });
        uploadDebug.finish({ ok: false, audioStatus: 'error', error: `audio-upload: ${audioUpRes.error.message}` });
        uploadDebug.step('audio-upload', 'error', audioUpRes.error.message);
        void logUploadFailure(input, { storagePath: audioStoragePath, originalSha: audioSha256, transcodingStatus, originalFilesize, finalFilesize, error: `audio-upload: ${audioUpRes.error.message}` });
        return { ok: false, error: msg };
      }
      const { data: audioPub } = supabase.storage.from('audio').getPublicUrl(audioPath);
      audioUrl = audioPub.publicUrl;
      log('audio upload ok', { url: audioUrl });
      uploadDebug.patch({ audioStatus: 'ok' });
      uploadDebug.step('audio-upload', 'ok', audioPath);
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
      const coverExt = safeExtension(input.coverFile.name, 'jpg');
      const coverPath = generateSafeStoragePath({ prefix: 'artist_uploads', userId, ext: coverExt, suffix: 'cover' });
      coverStoragePathVal = coverPath;
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
          uploadDebug.patch({ coverStatus: 'ok' });
          uploadDebug.step('cover-upload', 'ok', coverPath);
        } else {
          coverWarning = '커버 이미지 업로드에 실패했어요. 음원은 등록되며, 관리자/수정에서 커버를 다시 등록할 수 있어요.';
          console.warn('[uploadArtistTrack] 커버 업로드 실패 (음원은 계속 등록):', { title: input.title, msg: coverUpErr.message });
          log('cover upload skip (계속)', { msg: coverUpErr.message });
          uploadDebug.patch({ coverStatus: 'error' });
          uploadDebug.step('cover-upload', 'warn', coverUpErr.message);
        }
      } catch (e) {
        coverWarning = '커버 이미지 업로드가 지연/실패했어요. 음원은 등록되며, 나중에 커버를 다시 등록할 수 있어요.';
        console.warn('[uploadArtistTrack] 커버 업로드 예외 (음원은 계속 등록):', { title: input.title, err: e instanceof Error ? e.message : String(e) });
        log('cover upload TIMEOUT (계속)', { err: e instanceof Error ? e.message : String(e) });
        uploadDebug.patch({ coverStatus: 'error' });
        uploadDebug.step('cover-upload', 'warn', e instanceof Error ? e.message : String(e));
      }
    } else {
      log('cover none');
      uploadDebug.patch({ coverStatus: 'none' });
      uploadDebug.step('cover-upload', 'info', '커버 미첨부');
    }

    // 3) verified payout account 조회 — 일괄 업로드는 시작 시 eligibility 로 1회 검증했으면 생략
    stage = 'payout-check';
    if (input.skipPayoutCheck) {
      log('payout check skipped (batch pre-checked via eligibility)');
    } else {
      log('payout check start');
      let payoutOk = false;
      try {
        const { data: payout } = await withRetry(() =>
          withTimeout(
            supabase.from('artist_payout_accounts').select('id, verification_status').eq('user_id', userId).maybeSingle(),
            15_000,
            '정산 계좌 정보 확인이 지연되었습니다. 잠시 후 다시 시도해주세요.',
          ),
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
          originalFilename,
          storagePath: audioStoragePath,
          coverStoragePath: coverStoragePathVal,
        }),
        45_000,
        '음원 등록 서버 응답 시간이 초과되었습니다 (45초). 잠시 후 다시 시도해주세요.',
      );
      log('submit_artist_release RPC ok', { trackId });
      uploadDebug.patch({ rpcStatus: 'ok', trackId });
      uploadDebug.step('submit-rpc', 'ok', trackId);

      // 0154 — duration / content_type 기록 (발매 게이트). best-effort, 실패해도 업로드는 성공.
      if (trackId && (audioDurationVal != null || audioContentTypeVal)) {
        try {
          await withTimeout(
            supabase.rpc('set_artist_track_audio_meta', {
              p_track_id: trackId,
              p_duration: audioDurationVal,
              p_content_type: audioContentTypeVal,
              p_content_length: audioContentLengthVal,
            }),
            10_000,
            'audio meta 저장 시간 초과',
          );
          log('audio meta saved', { trackId, duration: audioDurationVal });
        } catch (e) {
          log('audio meta save skip (계속)', { err: e instanceof Error ? e.message : String(e) });
        }
      }
      // 0167 — 통과한 품질 측정값을 track_id 와 함께 기록(검수 화면 표시용)
      if (trackId && qualityResult) {
        void recordAudioQuality({ trackId, originalFilename, result: qualityResult });
      }
      // 0194/0196 — 업로드 무결성 로그(최종 업로드 콘텐츠 sha + filesize/변환상태). best-effort, 실패해도 업로드 성공 유지.
      if (trackId) {
        try {
          await supabase.rpc('record_upload_integrity2', {
            p_batch_id: input.batchId ?? null, p_client_track_id: input.clientTrackId ?? null, p_track_id: trackId,
            p_original_filename: originalFilename, p_source_fingerprint: input.sourceFingerprint ?? null,
            p_original_sha256: audioSha256, p_final_sha256: finalAudioSha, p_storage_path: audioStoragePath,
            p_duration: audioDurationVal, p_transcoded: wasTranscoded, p_status: 'success', p_error: null,
            p_original_filesize: originalFilesize, p_final_filesize: finalFilesize, p_transcoding_status: transcodingStatus,
          });
        } catch (e) { log('integrity log skip', { err: e instanceof Error ? e.message : String(e) }); }
      }
    } catch (e) {
      const err = e as { message?: string; hint?: string; details?: string; code?: string };
      const msg = err.message ?? String(e);
      log('submit_artist_release RPC FAIL', {
        code: err.code, message: err.message, details: err.details, hint: err.hint,
      });
      const tailDbg = [err.code, err.details, err.hint].filter(Boolean).join(' | ');
      uploadDebug.finish({ ok: false, rpcStatus: 'error', error: `submit-rpc: ${msg}${tailDbg ? ` (${tailDbg})` : ''}` });
      uploadDebug.step('submit-rpc', 'error', `${msg}${tailDbg ? ` (${tailDbg})` : ''}`);
      // 0196 — track row 생성 실패 → 방금 업로드한 storage object 격리 정리 (orphan 방지). 신규 업로드에만 적용.
      if (!input.trackId && audioStoragePath) {
        try { await supabase.storage.from('audio').remove([audioStoragePath]); log('orphan audio removed', { path: audioStoragePath }); }
        catch (ce) { log('orphan audio cleanup skip', { err: ce instanceof Error ? ce.message : String(ce) }); }
      }
      if (!input.trackId && coverStoragePathVal) {
        try { await supabase.storage.from('covers').remove([coverStoragePathVal]); } catch { /* best-effort */ }
      }
      void logUploadFailure(input, { storagePath: audioStoragePath, originalSha: audioSha256, finalSha: finalAudioSha, duration: audioDurationVal, transcoded: wasTranscoded, transcodingStatus, originalFilesize, finalFilesize, error: `submit-rpc: ${msg}` });
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
        supabase.from('tracks').select('track_code, cover_url, release_status').eq('id', trackId).maybeSingle(),
        10_000,
        'track_code 조회 시간이 초과되었습니다 (저장은 완료됨).',
      );
      const saved = row as { track_code?: string | null; cover_url?: string | null; release_status?: string | null } | null;
      trackCode = saved?.track_code ?? undefined;
      // 커버 저장 즉시 검증: 커버를 보냈는데 DB에 cover_url 이 없으면 경고
      const savedCover = saved?.cover_url ?? null;
      if (coverUrl && !savedCover) {
        coverWarning = coverWarning ?? '커버가 저장되지 않았어요. 관리자/수정에서 커버를 다시 등록해주세요.';
        console.warn('[UploadTrack] cover_url 미저장 감지:', { trackId, trackCode, sentCover: coverUrl });
      }
      log('saved row verified', {
        trackId, trackCode, release_status: saved?.release_status ?? null, cover_url: savedCover,
      });
      uploadDebug.patch({ coverUrl: savedCover, releaseStatus: saved?.release_status ?? null });
      uploadDebug.step('verify', savedCover ? 'ok' : 'warn', `cover_url=${savedCover ?? 'NULL'} · status=${saved?.release_status ?? '?'}`);
    } catch (e) {
      log('track_code skip', { err: e instanceof Error ? e.message : String(e) });
    }

    log('SUCCESS', { trackId, trackCode, coverWarning, elapsedMs: Date.now() - startedAt });
    uploadDebug.finish({ ok: true, trackId, error: coverWarning });
    uploadDebug.step('done', coverWarning ? 'warn' : 'ok', coverWarning ?? '업로드 완료');
    return { ok: true, track_id: trackId, track_code: trackCode, cover_warning: coverWarning };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('FATAL at stage=' + stage, { err: msg });
    uploadDebug.finish({ ok: false, error: `${stage} 단계 실패 — ${msg}` });
    uploadDebug.step(stage, 'error', msg);
    // 0196 — 파일이 관여한 단계 실패만 무결성 로그에 failed 로 기록 (이상징후 집계용).
    if (input.audioFile) void logUploadFailure(input, { error: `${stage}: ${msg}` });
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

/** 동일 필터 기준 전체 곡 수 (페이지네이션 표시용). */
export async function adminCountArtistTracks(opts?: {
  status?: Parameters<typeof adminListArtistTracks>[0] extends { status?: infer S } | undefined ? S : never;
  search?: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('admin_artist_tracks_count', {
    p_status: opts?.status || null,
    p_search: opts?.search || null,
  });
  if (error) throw error;
  return Number(data ?? 0);
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
    const ext = safeExtension(file.name, 'jpg');
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
  /** 0153 — 원본 파일명(표시용). storage key 와 분리 저장. */
  originalFilename?: string | null;
  /** 0153 — audio 버킷 실제 object key (ASCII-safe UUID). */
  storagePath?: string | null;
  /** 0153 — covers 버킷 실제 object key (ASCII-safe UUID). */
  coverStoragePath?: string | null;
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
    p_original_filename: input.originalFilename ?? null,
    p_storage_path: input.storagePath ?? null,
    p_cover_storage_path: input.coverStoragePath ?? null,
  });
  if (error) {
    // 트리거가 던지는 RAW 메시지를 친절한 한국어로 변환
    const msg = (error.message || '') + ' ' + ((error as { hint?: string }).hint ?? '');
    if (msg.includes('distribution_disabled')) {
      throw new Error(
        '현재 과도한 음원 등록으로 인해 신규 음원 유통 접수가 일시 중지되었습니다.\n' +
        '메타데이터 및 음원 품질 검수 완료 후 다시 이용하실 수 있습니다.',
      );
    }
    if (msg.includes('monthly_upload_quota_exceeded')) {
      throw new Error(
        '이번 달 음원 등록 한도 50곡을 모두 사용하셨습니다.\n' +
        '다음 달 1일부터 다시 등록 가능합니다.',
      );
    }
    throw error;
  }
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
// 0119 — 월간 스트리밍 정산 요약 (관리자)
// ============================================

export interface MonthlyStreamingSummary {
  month_start: string;   // YYYY-MM-DD (해당 월 1일)
  month_end: string;     // YYYY-MM-DD (해당 월 말일)
  total_stream_count: number;
  eligible_stream_count: number;
  excluded_stream_count: number;
  unique_tracks: number;
  unique_artists: number;
  estimated_revenue: number;        // 월간 매출 × 정산 풀 비율 (정산 대상 풀, 원)
  settlement_ready_amount: number;  // 해당 월 지급 준비(payable/paid) 정산액 합 (원)
  pool_revenue_ratio: number;
}

/**
 * 관리자 월간 스트리밍 정산 요약.
 * @param monthStart YYYY-MM-DD (해당 월 아무 날짜나 가능 — 서버가 1일로 정규화). 미지정 시 이번 달.
 */
export async function adminGetMonthlyStreamingSummary(
  monthStart?: string | null,
): Promise<MonthlyStreamingSummary> {
  const { data, error } = await supabase.rpc('admin_get_monthly_streaming_summary', {
    p_month_start: monthStart ?? undefined,
  });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    month_start: (d.month_start as string) ?? '',
    month_end: (d.month_end as string) ?? '',
    total_stream_count: Number(d.total_stream_count ?? 0),
    eligible_stream_count: Number(d.eligible_stream_count ?? 0),
    excluded_stream_count: Number(d.excluded_stream_count ?? 0),
    unique_tracks: Number(d.unique_tracks ?? 0),
    unique_artists: Number(d.unique_artists ?? 0),
    estimated_revenue: Number(d.estimated_revenue ?? 0),
    settlement_ready_amount: Number(d.settlement_ready_amount ?? 0),
    pool_revenue_ratio: Number(d.pool_revenue_ratio ?? 0.5),
  };
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

/** 0175 — 아티스트 본인 metadata 신뢰도(업로드 화면 안내). */
export async function getMyMetadataTrust(): Promise<{ trust_score: number; tier: 'high' | 'medium' | 'low'; guidance: string } | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_metadata_trust');
    if (error || !data) return null;
    return data as { trust_score: number; tier: 'high' | 'medium' | 'low'; guidance: string };
  } catch {
    return null;
  }
}
