/**
 * taxonomyApi.ts — Phase X1.0 DEUDDA DSP Taxonomy 시스템 클라이언트 API.
 *
 * 4 카테고리: genre / mood / store_type / daypart
 *  - 공개 list: 활성 항목만 (anon/authenticated 둘 다 호출 가능)
 *  - admin list/upsert/toggle/delete: admin role 만
 */
import { supabase } from './supabase';

export type TaxonomyKind = 'genre' | 'mood' | 'store_type' | 'daypart';

export interface TaxonomyItem {
  id: string;
  slug: string;
  name_ko: string;
  name_en: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export const TAXONOMY_KIND_LABEL: Record<TaxonomyKind, string> = {
  genre: '장르',
  mood: '무드',
  store_type: '매장 유형',
  daypart: '시간대',
};

const RPC_LIST: Record<TaxonomyKind, string> = {
  genre: 'list_taxonomy_genres',
  mood: 'list_taxonomy_moods',
  store_type: 'list_taxonomy_store_types',
  daypart: 'list_taxonomy_dayparts',
};

export async function listPublicTaxonomy(kind: TaxonomyKind): Promise<TaxonomyItem[]> {
  const { data, error } = await supabase.rpc(RPC_LIST[kind]);
  if (error) {
    if (import.meta.env.DEV) console.warn('[taxonomy] public list failed', kind, error);
    return [];
  }
  return (data ?? []) as TaxonomyItem[];
}

export async function listAdminTaxonomy(kind: TaxonomyKind): Promise<TaxonomyItem[]> {
  const { data, error } = await supabase.rpc('admin_list_taxonomy', { p_kind: kind });
  if (error) throw error;
  return (data ?? []) as TaxonomyItem[];
}

export interface UpsertTaxonomyInput {
  kind: TaxonomyKind;
  slug: string;
  name_ko: string;
  name_en: string;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export async function upsertTaxonomy(input: UpsertTaxonomyInput): Promise<void> {
  const { error } = await supabase.rpc('admin_upsert_taxonomy', {
    p_kind: input.kind,
    p_slug: input.slug.trim().toLowerCase(),
    p_name_ko: input.name_ko.trim(),
    p_name_en: input.name_en.trim(),
    p_description: input.description ?? null,
    p_is_active: input.is_active ?? true,
    p_sort_order: input.sort_order ?? 100,
  });
  if (error) throw error;
}

export async function toggleTaxonomy(kind: TaxonomyKind, slug: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_toggle_taxonomy', {
    p_kind: kind,
    p_slug: slug,
    p_active: active,
  });
  if (error) throw error;
}

export async function deleteTaxonomy(kind: TaxonomyKind, slug: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_taxonomy', {
    p_kind: kind,
    p_slug: slug,
  });
  if (error) throw error;
}
