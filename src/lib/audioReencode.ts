import { supabase } from './supabase';

export interface ReencodeCandidate {
  track_id: string;
  title: string;
  artist: string | null;
  audio_url: string;
  release_status: string | null;
  audio_content_type: string | null;
  audio_health_status?: string | null;
  audio_health_error?: string | null;
}

function log(trackId: string, title: string, step: string, data?: unknown) {
  // 단계별 상세 로그 — iOS/변환 디버깅용 (프로덕션 포함)
  // eslint-disable-next-line no-console
  console.info(`[reencode ${trackId.slice(0, 8)} "${title}"] ${step}`, data ?? '');
}

/** 변환 실패를 DB 에 영속화 (사용자 노출 제외 + 관리자 사유 표시). best-effort + 상세 로깅. */
export async function markConversionFailed(trackId: string, reason: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('admin_mark_audio_conversion_failed', {
      p_track_id: trackId,
      p_reason: reason.slice(0, 480),
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[reencode:markFailed] RPC error', {
        track_id: trackId, code: error.code, message: error.message, details: error.details, hint: error.hint,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[reencode:markFailed] threw', e);
  }
}

/** iOS 비호환(.wav 등 non-mp3) 트랙 목록 — 관리자 전용. */
export async function listReencodeCandidates(): Promise<ReencodeCandidate[]> {
  const { data, error } = await supabase.rpc('admin_list_reencode_candidates');
  if (error) throw error;
  return (data ?? []) as ReencodeCandidate[];
}

/** 공개 audio URL → 버킷 내부 object path 추출 (storage download 용). */
function audioObjectPath(audioUrl: string): string | null {
  const marker = '/storage/v1/object/public/audio/';
  const i = audioUrl.indexOf(marker);
  if (i < 0) return null;
  try {
    return decodeURIComponent(audioUrl.slice(i + marker.length).split('?')[0]);
  } catch {
    return audioUrl.slice(i + marker.length).split('?')[0];
  }
}

export interface ReencodeProgress {
  phase: 'download' | 'transcode' | 'upload' | 'commit' | 'done';
  ratio?: number;
}

// ── 단계별 함수 (각자 명확한 Error message throw) ──────────────────────────

/** 1) 원본 오디오 다운로드 → File. storage API(우선) + fetch(폴백). */
async function downloadAudio(c: ReencodeCandidate): Promise<File> {
  const path = audioObjectPath(c.audio_url);
  log(c.track_id, c.title, 'get source url', { audio_url: c.audio_url, object_path: path, signed: c.audio_url.includes('token=') });
  log(c.track_id, c.title, 'download start', { via: path ? 'storage.download' : 'fetch' });

  let blob: Blob;
  if (path) {
    const { data, error } = await supabase.storage.from('audio').download(path);
    if (error) throw new Error(`다운로드 실패(storage): ${error.message}`);
    if (!data) throw new Error('다운로드 실패: 응답 본문 없음');
    blob = data;
    log(c.track_id, c.title, 'download response', { status: 'ok(storage)', contentType: data.type, blobSize: data.size });
  } else {
    let res: Response;
    try {
      res = await fetch(c.audio_url);
    } catch (e) {
      throw new Error(`다운로드 실패(fetch/CORS): ${e instanceof Error ? e.message : String(e)}`);
    }
    log(c.track_id, c.title, 'download response', {
      status: res.status,
      contentType: res.headers.get('content-type'),
      contentLength: res.headers.get('content-length'),
      acceptRanges: res.headers.get('accept-ranges'),
    });
    if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status}`);
    blob = await res.blob();
  }

  log(c.track_id, c.title, 'download blob', { size: blob.size, type: blob.type });
  if (!blob || blob.size === 0) throw new Error('다운로드 실패: 파일 크기 0 (storage 파일 누락 가능)');

  const origName = (path ?? c.audio_url).split('/').pop() ?? `${c.track_id}.wav`;
  return new File([blob], origName, { type: blob.type || 'audio/wav' });
}

/** 2) MP3 변환. ffmpeg load → transcode → output 검증. */
async function transcodeToMp3(c: ReencodeCandidate, file: File, onRatio: (r: number) => void): Promise<File> {
  log(c.track_id, c.title, 'ffmpeg load start');
  let transcodeToStandardMp3: typeof import('./audioTranscode').transcodeToStandardMp3;
  try {
    ({ transcodeToStandardMp3 } = await import('./audioTranscode'));
  } catch (e) {
    throw new Error(`ffmpeg 모듈 import 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  log(c.track_id, c.title, 'transcode start', { inputSize: file.size });
  let mp3: File;
  try {
    mp3 = await transcodeToStandardMp3(file, {
      onProgress: onRatio,
      onLog: (m) => { if (/error|fail|invalid|unable/i.test(m)) log(c.track_id, c.title, 'ffmpeg log', m); },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ffmpeg core 로드 실패는 메시지에 'load'/'core'/'network' 가 흔히 포함됨
    throw new Error(`MP3 변환 실패(ffmpeg): ${msg}`);
  }

  log(c.track_id, c.title, 'transcode success', { outputSize: mp3.size });
  if (!mp3 || mp3.size === 0) throw new Error('MP3 변환 실패: 출력 파일 크기 0');
  return mp3;
}

/** 3) MP3 업로드 → public URL. */
async function uploadMp3(c: ReencodeCandidate, mp3: File): Promise<string> {
  const newPath = `reencoded/${c.track_id}_${Date.now()}.mp3`;
  log(c.track_id, c.title, 'upload start', { path: newPath, size: mp3.size });
  const { error: upErr } = await supabase.storage.from('audio').upload(newPath, mp3, {
    contentType: 'audio/mpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);
  const { data: pub } = supabase.storage.from('audio').getPublicUrl(newPath);
  log(c.track_id, c.title, 'upload success', { url: pub.publicUrl });
  return pub.publicUrl;
}

/** 4) audio_url 교체 (관리자 RPC). */
async function replaceTrackAudio(c: ReencodeCandidate, newUrl: string): Promise<void> {
  log(c.track_id, c.title, 'replace RPC start', { newUrl });
  const { error } = await supabase.rpc('admin_replace_track_audio', {
    p_track_id: c.track_id,
    p_audio_url: newUrl,
    p_audio_sha256: null,
    p_content_type: 'audio/mpeg',
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[reencode:replaceAudio] RPC error', {
      track_id: c.track_id, code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    throw new Error(`audio_url 교체 실패: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
  }
  log(c.track_id, c.title, 'replace RPC success');
}

/**
 * 단일 트랙 WAV→MP3 재인코딩 (비파괴). 단계별 try/catch 로 분리되어 명확한 실패 사유를 throw.
 * 호출자(panel)가 catch 하여 markConversionFailed + 다음 곡 진행.
 */
export async function reencodeTrackToMp3(
  c: ReencodeCandidate,
  onProgress?: (p: ReencodeProgress) => void,
): Promise<string> {
  log(c.track_id, c.title, 'start');

  onProgress?.({ phase: 'download' });
  const file = await downloadAudio(c);

  onProgress?.({ phase: 'transcode', ratio: 0 });
  const mp3 = await transcodeToMp3(c, file, (r) => onProgress?.({ phase: 'transcode', ratio: r }));

  onProgress?.({ phase: 'upload' });
  const newUrl = await uploadMp3(c, mp3);

  onProgress?.({ phase: 'commit' });
  await replaceTrackAudio(c, newUrl);

  onProgress?.({ phase: 'done' });
  log(c.track_id, c.title, 'done', { newUrl });
  return newUrl;
}
