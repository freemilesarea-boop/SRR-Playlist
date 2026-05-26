/**
 * imageUpload.ts — 프로필/커버 이미지 파일 업로드 (Supabase Storage 'covers' 버킷 재사용).
 * URL 입력 대신 파일 첨부 방식. 업로드 후 public URL 반환.
 */
import { supabase } from './supabase';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export interface ImageUploadResult { ok: boolean; url?: string; error?: string; }

/** 이미지 파일 검증 후 'covers' 버킷에 업로드, public URL 반환. */
export async function uploadImage(file: File, prefix = 'profile_images'): Promise<ImageUploadResult> {
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: 'JPG/PNG/WEBP 이미지만 업로드할 수 있어요' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `이미지 용량은 최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 까지예요` };
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('covers').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from('covers').getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, error: 'public URL 생성 실패' };
  return { ok: true, url: data.publicUrl };
}
