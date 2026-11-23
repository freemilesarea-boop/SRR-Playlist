/**
 * enterpriseGuideApi — 엔터프라이즈 가이드 (0565).
 *
 * 공개: 누구나(비로그인 포함) 공개된 글만 읽는다.
 * 관리자: 작성·수정·공개 전환·순서·삭제(숨김), 이미지·PDF 업로드(storage 'enterprise-guides').
 */
import { supabase } from './supabase';
import { uploadPostFile, type PostAttachment } from './postFiles';

export const ENTERPRISE_GUIDE_BUCKET = 'enterprise-guides';
export { safeStorageName, formatFileSize } from './postFiles';
export type EnterpriseGuideAttachment = PostAttachment;

export interface EnterpriseGuideSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: string;
  cover_image_url: string | null;
  attachment_count: number;
  published_at: string | null;
  updated_at: string;
}

export interface EnterpriseGuide {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: string;
  cover_image_url: string | null;
  body_md: string;
  attachments: EnterpriseGuideAttachment[];
  published_at: string | null;
  updated_at: string;
}

export interface AdminEnterpriseGuide extends EnterpriseGuide {
  is_published: boolean;
  sort_order: number;
  created_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface EnterpriseGuideInput {
  id: string | null;
  slug: string;
  title: string;
  summary: string;
  category: string;
  cover_image_url: string | null;
  body_md: string;
  attachments: EnterpriseGuideAttachment[];
  is_published: boolean;
}

// ---- 공개 ----

export async function listEnterpriseGuides(): Promise<EnterpriseGuideSummary[]> {
  const { data, error } = await supabase.rpc('list_enterprise_guides');
  if (error) throw error;
  return (data ?? []) as EnterpriseGuideSummary[];
}

/** 없거나 비공개면 null. */
export async function getEnterpriseGuide(slug: string): Promise<EnterpriseGuide | null> {
  const { data, error } = await supabase.rpc('get_enterprise_guide', { p_slug: slug });
  if (error) throw error;
  return (data ?? null) as EnterpriseGuide | null;
}

/** 카테고리별로 묶되, 서버가 정한 순서(관리자가 정한 순서)를 그대로 지킨다. */
export function groupGuidesByCategory<T extends { category: string }>(rows: T[]): { category: string; items: T[] }[] {
  const groups: { category: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const r of rows) {
    const key = r.category || '일반';
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ category: key, items: [] });
    }
    groups[i].items.push(r);
  }
  return groups;
}

// ---- 관리자 ----

export async function adminListEnterpriseGuides(): Promise<AdminEnterpriseGuide[]> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_guides');
  if (error) throw error;
  return (data ?? []) as AdminEnterpriseGuide[];
}

export async function adminUpsertEnterpriseGuide(input: EnterpriseGuideInput): Promise<AdminEnterpriseGuide> {
  const { data, error } = await supabase.rpc('admin_upsert_enterprise_guide', {
    p_id: input.id,
    p_slug: input.slug.trim() || null,
    p_title: input.title,
    p_summary: input.summary,
    p_category: input.category,
    p_cover_image_url: input.cover_image_url,
    p_body_md: input.body_md,
    p_attachments: input.attachments,
    p_is_published: input.is_published,
  });
  if (error) throw error;
  return data as AdminEnterpriseGuide;
}

export async function adminSetEnterpriseGuidePublished(id: string, published: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_enterprise_guide_published', { p_id: id, p_published: published });
  if (error) throw error;
}

export async function adminReorderEnterpriseGuides(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('admin_reorder_enterprise_guides', { p_ids: ids });
  if (error) throw error;
}

export async function adminDeleteEnterpriseGuide(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_enterprise_guide', { p_id: id });
  if (error) throw error;
}

/** 이미지·PDF 업로드 → 공개 주소. kind 는 저장 폴더(cover / inline / attachment). */
export function adminUploadEnterpriseGuideFile(
  file: File,
  kind: 'cover' | 'inline' | 'attachment',
): Promise<EnterpriseGuideAttachment> {
  return uploadPostFile(ENTERPRISE_GUIDE_BUCKET, file, kind);
}
