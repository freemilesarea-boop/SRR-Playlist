/**
 * siteNoticesApi.ts — 다중 공지/팝업 시스템 (admin 이 임의 개수 만들고 발행).
 *
 * - site_notices 테이블 기반 (audience/기간/우선순위/dismissible)
 * - 메인 페이지 등에서 list_active_site_notices() 호출 → 사용자에게 노출
 * - admin 패널에서 CRUD + 즉시 on/off
 */
import { supabase } from './supabase';

export type NoticeAudience = 'all' | 'guest' | 'authenticated' | 'artist' | 'admin' | 'business';
export type NoticeLocation = 'home' | 'all_pages';

export interface SiteNotice {
  id: string;
  title: string;
  body: string;
  is_active: boolean;
  audience: NoticeAudience;
  display_location: NoticeLocation;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  dismissible: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveSiteNotice {
  id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  display_location: NoticeLocation;
  priority: number;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export async function listActiveSiteNotices(): Promise<ActiveSiteNotice[]> {
  const { data, error } = await supabase.rpc('list_active_site_notices');
  if (error) {
    if (import.meta.env.DEV) console.warn('[siteNotices] active fetch failed', error);
    return [];
  }
  return (data ?? []) as ActiveSiteNotice[];
}

export async function adminListSiteNotices(): Promise<SiteNotice[]> {
  const { data, error } = await supabase.rpc('admin_list_site_notices');
  if (error) throw error;
  return (data ?? []) as SiteNotice[];
}

export interface UpsertSiteNoticeInput {
  id?: string | null;
  title: string;
  body: string;
  is_active?: boolean;
  audience?: NoticeAudience;
  display_location?: NoticeLocation;
  starts_at?: string | null;
  ends_at?: string | null;
  priority?: number;
  dismissible?: boolean;
}

export async function adminUpsertSiteNotice(input: UpsertSiteNoticeInput): Promise<SiteNotice> {
  const { data, error } = await supabase.rpc('admin_upsert_site_notice', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_body: input.body,
    p_is_active: input.is_active ?? true,
    p_audience: input.audience ?? 'all',
    p_display_location: input.display_location ?? 'home',
    p_starts_at: input.starts_at ?? null,
    p_ends_at: input.ends_at ?? null,
    p_priority: input.priority ?? 0,
    p_dismissible: input.dismissible ?? true,
  });
  if (error) throw error;
  return data as SiteNotice;
}

export async function adminDeleteSiteNotice(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_site_notice', { p_id: id });
  if (error) throw error;
}

export async function adminToggleSiteNotice(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_toggle_site_notice', { p_id: id, p_active: active });
  if (error) throw error;
}
