// Phase BRAND-1 / UX-3 — 브랜드 사이니지 미디어 업로드 (Supabase Storage 'brand-media' 버킷).
// bucket 은 0405/0453 migration 에서 mime/size 제한을 서버측에도 강제(이미지 10MB, 동영상 50MB).
// UX-3: 이미지(jpg/png/webp/gif) + 동영상(mp4/webm/mov) 지원. 동영상은 재생 길이도 추출한다.
import { supabase } from './supabase';
import {
  mediaTypeForMime, isVideoMime, maxBytesForMime, extensionForMime, MAX_VIDEO_BYTES,
} from './brandMediaType';
import type { BrandMediaType } from '@/types/brand';

export interface BrandMediaUploadResult {
  ok: boolean;
  url?: string;
  error?: string;
  assetType?: BrandMediaType;
  mimeType?: string;
  /** 동영상 재생 길이(초). 이미지/추출 실패 시 undefined. */
  durationSeconds?: number;
  /** 파일 용량(byte). */
  sizeBytes?: number;
}

/** 동영상 metadata 로부터 재생 길이(초)를 추출. 실패 시 undefined(치명적 아님). */
async function probeVideoDuration(file: File): Promise<number | undefined> {
  if (typeof document === 'undefined') return undefined;
  return new Promise<number | undefined>((resolve) => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (d: number | undefined) => { if (url) URL.revokeObjectURL(url); resolve(d); };
      v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : undefined);
      v.onerror = () => done(undefined);
      v.src = url;
    } catch { if (url) URL.revokeObjectURL(url); resolve(undefined); }
  });
}

/**
 * 이미지/동영상 검증 → 'brand-media/{brandId}/{uuid}.{ext}' 업로드 → public URL 반환.
 * 실패 시 { ok:false, error } (throw 하지 않음).
 */
export async function uploadBrandMedia(brandId: string, file: File): Promise<BrandMediaUploadResult> {
  if (!file) return { ok: false, error: '파일을 선택해주세요.' };

  const assetType = mediaTypeForMime(file.type);
  if (!assetType) {
    return { ok: false, error: '이미지(JPG/PNG/WEBP/GIF) 또는 동영상(MP4/WEBM/MOV)만 업로드할 수 있어요.' };
  }
  const maxBytes = maxBytesForMime(file.type);
  if (file.size > maxBytes) {
    const label = isVideoMime(file.type) ? '동영상' : '이미지';
    return { ok: false, error: `${label} 용량은 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB 까지예요.` };
  }
  const ext = extensionForMime(file.type);
  if (!ext) return { ok: false, error: '지원하지 않는 파일 형식이에요.' };

  // 동영상이면 업로드 전에 재생 길이 추출(실패해도 업로드는 진행).
  const durationSeconds = isVideoMime(file.type) ? await probeVideoDuration(file) : undefined;

  const path = `${brandId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('brand-media').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from('brand-media').getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, error: 'public URL 생성 실패' };

  return {
    ok: true, url: data.publicUrl, assetType, mimeType: file.type,
    durationSeconds, sizeBytes: file.size,
  };
}

export { MAX_VIDEO_BYTES };
