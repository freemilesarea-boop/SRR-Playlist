// Phase BRAND-PLAYER-UX-3 — 브랜드 사이니지 미디어(이미지/동영상) 타입/검증 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  mediaTypeForMime, isVideoMime, isVideoAsset, maxBytesForMime, extensionForMime,
  formatMediaDuration, formatBytes,
  IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
} from './brandMediaType';

describe('mediaTypeForMime', () => {
  it('이미지 MIME → image', () => {
    for (const m of IMAGE_MIME_TYPES) expect(mediaTypeForMime(m)).toBe('image');
  });
  it('동영상 MIME → video', () => {
    for (const m of VIDEO_MIME_TYPES) expect(mediaTypeForMime(m)).toBe('video');
  });
  it('mov = video/quicktime → video', () => { expect(mediaTypeForMime('video/quicktime')).toBe('video'); });
  it('허용 밖 → null', () => {
    expect(mediaTypeForMime('audio/mpeg')).toBeNull();
    expect(mediaTypeForMime('application/pdf')).toBeNull();
    expect(mediaTypeForMime('')).toBeNull();
    expect(mediaTypeForMime('image/tiff')).toBeNull();
  });
});

describe('isVideoMime / isVideoAsset', () => {
  it('video MIME 판별', () => {
    expect(isVideoMime('video/mp4')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
  });
  it('asset_type 우선', () => {
    expect(isVideoAsset('video')).toBe(true);
    expect(isVideoAsset('image')).toBe(false);
    expect(isVideoAsset('image', 'video/mp4')).toBe(false); // asset_type 명시 우선
  });
  it('asset_type 없으면 mime 로 판별', () => {
    expect(isVideoAsset(null, 'video/webm')).toBe(true);
    expect(isVideoAsset(undefined, 'image/jpeg')).toBe(false);
    expect(isVideoAsset(null, null)).toBe(false);
  });
});

describe('maxBytesForMime', () => {
  it('이미지 10MB, 동영상 50MB', () => {
    expect(maxBytesForMime('image/png')).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesForMime('video/mp4')).toBe(MAX_VIDEO_BYTES);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_VIDEO_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('extensionForMime', () => {
  it('MIME → 확장자', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
    expect(extensionForMime('image/gif')).toBe('gif');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('video/webm')).toBe('webm');
    expect(extensionForMime('video/quicktime')).toBe('mov');
  });
  it('허용 밖 → null', () => { expect(extensionForMime('audio/mpeg')).toBeNull(); });
});

describe('formatMediaDuration (m:ss)', () => {
  it('정상 포맷', () => {
    expect(formatMediaDuration(30)).toBe('0:30');
    expect(formatMediaDuration(65)).toBe('1:05');
    expect(formatMediaDuration(125.4)).toBe('2:05');
    expect(formatMediaDuration(600)).toBe('10:00');
  });
  it('null/0/음수/NaN → —', () => {
    expect(formatMediaDuration(null)).toBe('—');
    expect(formatMediaDuration(undefined)).toBe('—');
    expect(formatMediaDuration(0)).toBe('—');
    expect(formatMediaDuration(-5)).toBe('—');
    expect(formatMediaDuration(NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('MB/KB 표기', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
  });
  it('null/0 → —', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(0)).toBe('—');
  });
});
