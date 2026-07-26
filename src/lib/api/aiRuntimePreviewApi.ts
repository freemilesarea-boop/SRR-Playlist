/**
 * aiRuntimePreviewApi — Phase AI-PIPELINE-CONNECTION-1
 *
 * "AI 런타임 프리뷰"(관리자 전용, READ-ONLY) RPC 래퍼.
 *   Store Fit → Candidate Pool → AI Candidate Queue  를 조회만 한다.
 *   실 재생/큐/스케줄러/로테이션에는 전혀 쓰지 않는다(read-only preview).
 *
 * SQL: supabase/migrations/0463_ai_candidate_pool_preview.sql
 *   admin_ai_store_candidate_pool(p_store_id, p_playlist_id)
 *   admin_ai_build_store_queue(p_store_id, p_playlist_id, p_limit)
 */
import { supabase } from '@/lib/supabase';
import type { CandidatePoolResult, StoreQueueResult } from '@/lib/aiRuntimePreview';

/** 후보 풀(eligible/penalized/blocked 분류) 조회. admin 전용. */
export async function adminAiStoreCandidatePool(
  storeId: string,
  playlistId: string,
): Promise<CandidatePoolResult> {
  const { data, error } = await supabase.rpc('admin_ai_store_candidate_pool', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
  });
  if (error) {
    console.error('[aiRuntimePreviewApi] candidate_pool failed', error);
    throw error;
  }
  return data as CandidatePoolResult;
}

/** Fit → Queue 프리뷰(차단 제외, fit_score desc 정렬). admin 전용. read-only. */
export async function adminAiBuildStoreQueue(
  storeId: string,
  playlistId: string,
  limit = 50,
): Promise<StoreQueueResult> {
  const { data, error } = await supabase.rpc('admin_ai_build_store_queue', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
    p_limit: limit,
  });
  if (error) {
    console.error('[aiRuntimePreviewApi] build_queue failed', error);
    throw error;
  }
  return data as StoreQueueResult;
}
