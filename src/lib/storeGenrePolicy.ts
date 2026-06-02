/**
 * storeGenrePolicy.ts — 매장별 장르/보컬 배치 정책 클라이언트 API (관리자).
 * 정책 판정/백필 로직은 서버(SQL RPC)에 단일 구현. 여기서는 호출 래퍼만 제공.
 * 관련 마이그레이션: 0258_store_genre_placement_policy.sql
 */
import { supabase } from '@/lib/supabase';

export type VocalPolicy = 'vocal' | 'instrumental' | 'vocal_rap';
export type PolicyEnforcement = 'hard' | 'soft';

export interface StoreGenreRule {
  id: string;
  store_type: string;
  normalized_store_type: string;
  genre: string;
  normalized_genre: string;
  vocal_policy: VocalPolicy;
  is_allowed: boolean;
  priority: number;
  source: string;
  enforcement: PolicyEnforcement | null;
  default_severity: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreGenrePolicySummary {
  store_count: number;
  rule_count: number;
  active_count: number;
  by_store: Record<string, number>;
  by_vocal_policy: Record<string, number>;
}

export interface StoreGenreViolation {
  id: string;
  track_id: string;
  title: string | null;
  artist: string | null;
  main_genre: string | null;
  issue_type: string;
  severity: string;
  reason: string;
  evidence_json: Record<string, unknown> | null;
  status: string;
  created_at: string;
  normalized_store_type: string | null;
}

export interface BackfillResult {
  dry_run: boolean;
  checked_count: number;
  matched_count: number;
  mismatch_count: number;
  review_needed_created: number;
  qc_created: number;
  by_store: Record<string, number>;
  by_issue_type: Record<string, number>;
}

export async function listStoreGenrePolicies(
  storeType?: string,
  vocalPolicy?: VocalPolicy,
): Promise<StoreGenreRule[]> {
  const { data, error } = await supabase.rpc('admin_list_store_genre_policies', {
    p_store_type: storeType ?? null,
    p_vocal_policy: vocalPolicy ?? null,
  });
  if (error) throw error;
  return (data ?? []) as StoreGenreRule[];
}

export async function storeGenrePolicySummary(): Promise<StoreGenrePolicySummary> {
  const { data, error } = await supabase.rpc('admin_store_genre_policy_summary');
  if (error) throw error;
  return data as StoreGenrePolicySummary;
}

export async function setStoreGenreRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_store_genre_rule_enabled', {
    p_id: id, p_enabled: enabled,
  });
  if (error) throw error;
}

export async function setStoreGenreRulePriority(id: string, priority: number): Promise<void> {
  const { error } = await supabase.rpc('admin_set_store_genre_rule_priority', {
    p_id: id, p_priority: priority,
  });
  if (error) throw error;
}

export async function upsertStoreGenreRule(opts: {
  storeType: string;
  genre: string;
  vocalPolicy: VocalPolicy;
  isAllowed?: boolean;
  priority?: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_upsert_store_genre_rule', {
    p_store_type: opts.storeType,
    p_genre: opts.genre,
    p_vocal_policy: opts.vocalPolicy,
    p_is_allowed: opts.isAllowed ?? true,
    p_priority: opts.priority ?? 100,
  });
  if (error) throw error;
  return data as string;
}

export async function listStoreGenreViolations(opts: {
  storeType?: string;
  issueType?: string;
  status?: string;
  limit?: number;
} = {}): Promise<StoreGenreViolation[]> {
  const { data, error } = await supabase.rpc('admin_list_store_genre_violations', {
    p_store_type: opts.storeType ?? null,
    p_issue_type: opts.issueType ?? null,
    p_status: opts.status ?? 'open',
    p_limit: opts.limit ?? 300,
  });
  if (error) throw error;
  return (data ?? []) as StoreGenreViolation[];
}

export async function backfillStoreGenrePolicyReview(
  dryRun = true,
  limit = 1000,
): Promise<BackfillResult> {
  const { data, error } = await supabase.rpc('admin_backfill_store_genre_policy_review', {
    p_dry_run: dryRun, p_limit: limit,
  });
  if (error) throw error;
  return data as BackfillResult;
}

/** track × store 단건 정책 판정 (Inspector 용) */
export async function checkStoreGenrePolicy(
  trackId: string,
  storeLabel: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('check_store_genre_policy', {
    p_track_id: trackId, p_store_label: storeLabel,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}
