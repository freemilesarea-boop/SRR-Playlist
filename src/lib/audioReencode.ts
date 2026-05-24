import { supabase } from './supabase';

export interface ReencodeCandidate {
  track_id: string;
  title: string;
  artist: string | null;
  audio_url: string;
  release_status: string | null;
  audio_content_type: string | null;
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

/**
 * 단일 트랙 WAV→MP3 재인코딩 (비파괴):
 *  1) 원본 다운로드(storage API — CORS 안전)
 *  2) 표준 MP3 변환(libmp3lame 192k/44.1k/stereo, iOS 호환)
 *  3) audio 버킷 새 경로에 업로드 (원본 유지)
 *  4) admin_replace_track_audio 로 audio_url 교체 (released 트랙도 트리거 허용 경로)
 * 반환: 새 mp3 public URL.
 */
export async function reencodeTrackToMp3(
  c: ReencodeCandidate,
  onProgress?: (p: ReencodeProgress) => void,
): Promise<string> {
  // 1) 다운로드
  onProgress?.({ phase: 'download' });
  const path = audioObjectPath(c.audio_url);
  let blob: Blob;
  if (path) {
    const { data, error } = await supabase.storage.from('audio').download(path);
    if (error || !data) throw new Error(`다운로드 실패: ${error?.message ?? 'no data'}`);
    blob = data;
  } else {
    const res = await fetch(c.audio_url);
    if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status}`);
    blob = await res.blob();
  }

  const origName = (path ?? c.audio_url).split('/').pop() ?? `${c.track_id}.wav`;
  const file = new File([blob], origName, { type: blob.type || 'audio/wav' });

  // 2) 변환
  onProgress?.({ phase: 'transcode', ratio: 0 });
  const { transcodeToStandardMp3 } = await import('./audioTranscode');
  const mp3 = await transcodeToStandardMp3(file, {
    onProgress: (r) => onProgress?.({ phase: 'transcode', ratio: r }),
  });

  // 3) 업로드 (새 경로 — 원본 비파괴)
  onProgress?.({ phase: 'upload' });
  const newPath = `reencoded/${c.track_id}_${Date.now()}.mp3`;
  const { error: upErr } = await supabase.storage.from('audio').upload(newPath, mp3, {
    contentType: 'audio/mpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);
  const { data: pub } = supabase.storage.from('audio').getPublicUrl(newPath);
  const newUrl = pub.publicUrl;

  // 4) audio_url 교체 (관리자 RPC — 발매 트랙 불변성 트리거 허용 경로)
  onProgress?.({ phase: 'commit' });
  const { error: rpcErr } = await supabase.rpc('admin_replace_track_audio', {
    p_track_id: c.track_id,
    p_audio_url: newUrl,
    p_audio_sha256: null,
    p_content_type: 'audio/mpeg',
  });
  if (rpcErr) throw new Error(`audio_url 교체 실패: ${rpcErr.message}`);

  onProgress?.({ phase: 'done' });
  return newUrl;
}
