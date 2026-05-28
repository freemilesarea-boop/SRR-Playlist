import { supabase } from '@/lib/supabase';

export interface BrandSettings {
  logo_url: string | null;
  updated_at: string | null;
}

/** 공개 — anon/authenticated 모두 호출 가능. */
export async function fetchBrandSettings(): Promise<BrandSettings> {
  try {
    const { data, error } = await supabase.rpc('get_brand_settings');
    if (error) throw error;
    const d = (data ?? {}) as Partial<BrandSettings>;
    return { logo_url: d.logo_url ?? null, updated_at: d.updated_at ?? null };
  } catch {
    return { logo_url: null, updated_at: null };
  }
}

/** 관리자 전용 — storage 업로드 + brand_settings 행 URL 갱신. */
export async function adminUploadBrandLogo(file: File): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!file) return { ok: false, error: '파일을 선택해주세요.' };
  if (!/^image\/(svg\+xml|png|jpeg|webp)$/.test(file.type)) {
    return { ok: false, error: 'SVG / PNG / JPEG / WebP 만 가능합니다.' };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: '파일은 2MB 이하만 가능합니다.' };
  }
  const ext = file.type === 'image/svg+xml' ? 'svg'
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : 'jpg';
  const path = `logo-${Date.now()}.${ext}`;
  const up = await supabase.storage.from('brand-assets').upload(path, file, {
    cacheControl: '300', upsert: false, contentType: file.type,
  });
  if (up.error) return { ok: false, error: up.error.message };
  const { data: pub } = supabase.storage.from('brand-assets').getPublicUrl(path);
  const url = pub.publicUrl;
  const { error: rpcErr } = await supabase.rpc('admin_update_brand_logo', { p_logo_url: url });
  if (rpcErr) return { ok: false, error: rpcErr.message };
  return { ok: true, url };
}

/** 관리자 전용 — 업로드된 로고 제거 (DB URL 만 비움, storage 파일은 그대로 보관). */
export async function adminClearBrandLogo(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('admin_update_brand_logo', { p_logo_url: null });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
