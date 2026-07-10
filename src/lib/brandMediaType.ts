// Phase BRAND-PLAYER-UX-3 — 브랜드 사이니지 미디어(이미지/동영상) 타입/검증 순수 로직.
// 서버(0453 brand-media 버킷 allowed_mime_types) 및 asset_type CHECK 와 1:1 대응.
import type { BrandMediaType } from '@/types/brand';

/** 허용 이미지 MIME (기존 + gif). */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** 허용 동영상 MIME (mov = video/quicktime, 브라우저 지원 범위). */
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB (버킷 file_size_limit 와 일치)

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/** MIME → 미디어 종류. 허용 목록 밖이면 null. */
export function mediaTypeForMime(mime: string): BrandMediaType | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return 'image';
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(mime)) return 'video';
  return null;
}

export function isVideoMime(mime: string): boolean {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(mime);
}

/** asset_type 이 video 인지(렌더 분기용). mime 없으면 asset_type 우선. */
export function isVideoAsset(assetType: string | null | undefined, mime?: string | null): boolean {
  if (assetType === 'video') return true;
  if (assetType === 'image') return false;
  return !!mime && isVideoMime(mime);
}

/** 종류별 최대 용량(byte). */
export function maxBytesForMime(mime: string): number {
  return isVideoMime(mime) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** MIME 에 대응하는 저장 확장자(허용 밖이면 null). */
export function extensionForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

/** 초 → "m:ss" 표시(관리자 재생시간 표기). null/0 은 '—'. */
export function formatMediaDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** byte → "N.N MB" 표시. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
