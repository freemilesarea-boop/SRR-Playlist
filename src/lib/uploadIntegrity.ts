/**
 * uploadIntegrity.ts — 업로드 무결성 레이어 클라이언트.
 *
 * - 곡별 immutable client_track_id (crypto.randomUUID) 로 시작~종료까지 추적.
 * - 서버 upload_integrity_logs / upload_batches 에 단계별 기록(record_upload_integrity).
 * - 배치 제출 후 서버 자가점검(artist_batch_integrity_check).
 * - 브라우저 refresh 복구: localStorage 스냅샷 + 서버 batch reconcile(get_my_upload_batch).
 *
 * submit_artist_release 는 절대 변경하지 않는다(별도 레이어).
 */
import { supabase } from './supabase';

/** 곡별 업로드 상태머신 — index 기반 key 금지, client_track_id 로만 식별. */
export type UploadStatus =
  | 'queued'
  | 'preparing'        // preflight + sha256 + dup pre-check
  | 'transcoding'      // ffmpeg (non-mp3 또는 비표준 mp3)
  | 'quality_checking' // LUFS gate
  | 'uploading'        // storage upload
  | 'submitting'       // submit_artist_release RPC + metadata
  | 'submitted'        // 성공 (track 생성)
  | 'failed'
  | 'needs_reselect'   // refresh 후 파일 유실 — 재선택 필요
  | 'cancelled';

export type TranscodeStatus = 'pending' | 'skipped' | 'passthrough' | 'transcoded' | 'failed';

export type FailureReason =
  | 'ffmpeg_timeout'
  | 'unsupported_codec'
  | 'decode_failed'
  | 'transcoding_failed'
  | 'corrupted_audio'
  | 'quality_failed'
  | 'duplicate'
  | 'upload_failed'
  | 'submit_failed'
  | 'preflight_failed'
  | 'unknown';

export const FAILURE_REASON_LABELS: Record<string, string> = {
  ffmpeg_timeout: '변환 시간 초과(ffmpeg timeout)',
  unsupported_codec: '지원하지 않는 코덱',
  decode_failed: '오디오 디코드 실패',
  transcoding_failed: 'MP3 변환 실패',
  corrupted_audio: '손상된 오디오 파일',
  quality_failed: '음질(LUFS) 기준 미달',
  duplicate: '중복 음원',
  upload_failed: '스토리지 업로드 실패',
  submit_failed: '음원 등록(서버) 실패',
  preflight_failed: '사전 검사 실패',
  unknown: '알 수 없는 오류',
};

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  queued: '대기',
  preparing: '준비 중',
  transcoding: '변환 중',
  quality_checking: '음질 검사 중',
  uploading: '업로드 중',
  submitting: '등록 중',
  submitted: '제출 완료',
  failed: '실패',
  needs_reselect: '파일 재선택 필요',
  cancelled: '취소됨',
};

export type BatchStatus = 'active' | 'integrity_failed' | 'completed';

export interface IntegrityIssue {
  severity: 'hard' | 'warning';
  type: string;
  [k: string]: unknown;
}
export interface BatchIntegrityResult {
  ok: boolean;
  hard: number;
  issues: IntegrityIssue[];
}

// ---- browser session id (refresh 간 유지, 탭 단위) ----
const SESSION_KEY = 'srr_upload_session_id';
export function getBrowserSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'no-session';
  }
}

export function newClientTrackId(): string {
  return crypto.randomUUID();
}

export interface RecordIntegrityInput {
  batchId: string;
  clientTrackId: string;
  browserSessionId?: string;
  originalFilename?: string | null;
  normalizedFilename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  sha256?: string | null;
  transcodeStatus?: TranscodeStatus | null;
  uploadStatus?: UploadStatus | null;
  failureReason?: FailureReason | null;
  createdTrackId?: string | null;
  storagePath?: string | null;
  coverStoragePath?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function recordUploadIntegrity(input: RecordIntegrityInput): Promise<void> {
  try {
    await supabase.rpc('record_upload_integrity', {
      p_batch_id: input.batchId,
      p_client_track_id: input.clientTrackId,
      p_browser_session_id: input.browserSessionId ?? getBrowserSessionId(),
      p_original_filename: input.originalFilename ?? null,
      p_normalized_filename: input.normalizedFilename ?? null,
      p_file_size: input.fileSize ?? null,
      p_mime_type: input.mimeType ?? null,
      p_sha256: input.sha256 ?? null,
      p_transcode_status: input.transcodeStatus ?? null,
      p_upload_status: input.uploadStatus ?? null,
      p_failure_reason: input.failureReason ?? null,
      p_created_track_id: input.createdTrackId ?? null,
      p_detail: input.detail ?? null,
      p_storage_path: input.storagePath ?? null,
      p_cover_storage_path: input.coverStoragePath ?? null,
    });
  } catch (e) {
    // best-effort — 무결성 로깅 실패가 업로드 자체를 막지 않는다.
    console.warn('[uploadIntegrity] record 실패(계속):', e);
  }
}

export async function runBatchIntegrityCheck(batchId: string): Promise<BatchIntegrityResult> {
  const { data, error } = await supabase.rpc('artist_batch_integrity_check', { p_batch_id: batchId });
  if (error) throw error;
  return data as BatchIntegrityResult;
}

export interface ServerBatchLog {
  client_track_id: string;
  original_filename: string | null;
  upload_status: UploadStatus | null;
  transcode_status: TranscodeStatus | null;
  failure_reason: string | null;
  created_track_id: string | null;
  sha256: string | null;
  retry_count: number;
  track_status: string | null;
  updated_at: string;
}
export interface ServerBatch {
  batch: { id: string; status: BatchStatus; total_tracks: number; integrity: unknown } | null;
  logs: ServerBatchLog[];
}

export async function fetchMyUploadBatch(batchId: string): Promise<ServerBatch | null> {
  const { data, error } = await supabase.rpc('get_my_upload_batch', { p_batch_id: batchId });
  if (error) throw error;
  return (data as ServerBatch | null) ?? null;
}

// ---- localStorage 스냅샷 (refresh 복구용) ----
const SNAPSHOT_KEY = 'srr_upload_batch_snapshot';

export interface SnapshotRow {
  clientTrackId: string;
  originalFilename: string;
  uploadStatus: UploadStatus;
  transcodeStatus: TranscodeStatus | null;
  failureReason: string | null;
  createdTrackId: string | null;
  sha256: string | null;
}
export interface BatchSnapshot {
  batchId: string;
  browserSessionId: string;
  updatedAt: number;
  rows: SnapshotRow[];
}

export function saveBatchSnapshot(snap: BatchSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...snap, updatedAt: Date.now() }));
  } catch {
    /* quota/serialize 실패는 무시 */
  }
}

export function loadBatchSnapshot(): BatchSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as BatchSnapshot;
    if (!snap.batchId || !Array.isArray(snap.rows)) return null;
    // 24시간 지난 스냅샷은 폐기
    if (Date.now() - (snap.updatedAt ?? 0) > 24 * 60 * 60 * 1000) {
      clearBatchSnapshot();
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export function clearBatchSnapshot(): void {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* noop */ }
}
