/**
 * siteSettingsApi.ts — 사이트 전역 설정 (싱글톤).
 *
 * 현재 관리하는 것:
 *   - distribution_enabled: 신규 음원 유통 ON/OFF (서버 트리거가 강제)
 *   - notice_enabled / title / body: 메인 페이지 공지 팝업
 */
import { supabase } from './supabase';

export interface SiteSettings {
  id: number;
  distribution_enabled: boolean;
  notice_enabled: boolean;
  notice_title: string;
  notice_body: string;
  updated_at: string;
  updated_by: string | null;
}

export async function fetchSiteSettings(): Promise<SiteSettings | null> {
  const { data, error } = await supabase.rpc('get_site_settings');
  if (error) {
    if (import.meta.env.DEV) console.warn('[siteSettings] fetch failed', error);
    return null;
  }
  return (data as SiteSettings | null) ?? null;
}

export async function adminUpdateSiteSettings(input: {
  distribution_enabled: boolean;
  notice_enabled: boolean;
  notice_title: string;
  notice_body: string;
}): Promise<SiteSettings> {
  const { data, error } = await supabase.rpc('admin_update_site_settings', {
    p_distribution_enabled: input.distribution_enabled,
    p_notice_enabled: input.notice_enabled,
    p_notice_title: input.notice_title,
    p_notice_body: input.notice_body,
  });
  if (error) throw error;
  return data as SiteSettings;
}
