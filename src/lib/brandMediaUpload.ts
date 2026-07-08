// Phase BRAND-1 — 브랜드 사이니지 이미지 업로드 (Supabase Storage 'brand-media' 버킷).
// bucket 은 0405 migration 에서 mime/size 제한(jpg/png/webp, 10MB) 을 서버측에도 강제.
import { supabase } from './supabase';
import { safeExtension } from './storagePath';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export interface BrandMediaUploadResult { ok: boolean; url?: string; error?: string; }

/**
 * 이미지 검증 → 'brand-media/{brandId}/{uuid}.{ext}' 업로드 → public URL 반환.
 * 실패 시 { ok:false, error } (throw 하지 않음).
 */
export async function uploadBrandMedia(brandId: string, file: File): Promise<BrandMediaUploadResult> {
  if (!file) return { ok: false, error: '파일을 선택해주세요.' };
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: 'JPG / PNG / WEBP 이미지만 업로드할 수 있어요.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `이미지 용량은 최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 까지예요.` };
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : safeExtension(file.name, 'jpg');
  const path = `${brandId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('brand-media').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from('brand-media').getPublicUrl(path);
  if (!data?.publicUrl) return { ok: false, error: 'public URL 생성 실패' };
  return { ok: true, url: data.publicUrl };
}
