/**
 * aiLearningApi — Phase AI-LEARNING-ENGINE-1
 *
 * Runtime feedback learning RPC 래퍼.
 *   • record_store_playback_feedback  — 매장 재생 피드백 수집(fire-and-forget).
 *   • admin_ai_recompute_adaptive_scores — 배치 재계산(관리자, cron 없음).
 *   • admin_ai_learning_dashboard — 학습 현황 조회(관리자/HQ).
 *
 * SQL: supabase/migrations/0465_ai_learning_engine.sql
 *
 * 안전: 피드백 수집은 절대 재생을 방해하지 않는다. recordStorePlaybackFeedback 는
 *   실패해도 throw 하지 않고 { ok:false } 를 반환한다(fire-and-forget).
 */
import { supabase } from '@/lib/supabase';
import type {
  PlaybackFeedbackEvent,
  LearningDashboardResult,
  RecomputeResult,
} from '@/lib/aiLearningEngine';

export interface RecordFeedbackParams {
  storeId: string;
  trackId: string;
  event: PlaybackFeedbackEvent;
  playlistId?: string | null;
  completionRatio?: number | null;
  playedSeconds?: number | null;
  durationSeconds?: number | null;
  sessionId?: string | null;
}

/**
 * 매장 재생 피드백 1건 기록. fire-and-forget — 실패해도 throw 하지 않는다.
 * (플레이어 재생 안정성이 최우선. 학습 신호 누락은 허용, 재생 중단은 불허.)
 */
export async function recordStorePlaybackFeedback(
  params: RecordFeedbackParams,
): Promise<{ ok: boolean }> {
  try {
    const { error } = await supabase.rpc('record_store_playback_feedback', {
      p_store_id: params.storeId,
      p_track_id: params.trackId,
      p_event_type: params.event,
      p_playlist_id: params.playlistId ?? null,
      p_completion_ratio: params.completionRatio ?? null,
      p_played_seconds: params.playedSeconds ?? null,
      p_duration_seconds: params.durationSeconds ?? null,
      p_session_id: params.sessionId ?? null,
    });
    if (error) {
      // 조용히 삼킨다 — 재생을 방해하지 않는다.
      console.warn('[aiLearningApi] record feedback failed (ignored)', error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[aiLearningApi] record feedback threw (ignored)', e);
    return { ok: false };
  }
}

/** 배치 재계산(관리자). 한 store×playlist 의 adaptive score 를 materialize. */
export async function adminAiRecomputeAdaptiveScores(
  storeId: string,
  playlistId: string,
): Promise<RecomputeResult> {
  const { data, error } = await supabase.rpc('admin_ai_recompute_adaptive_scores', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
  });
  if (error) {
    console.error('[aiLearningApi] recompute failed', error);
    throw error;
  }
  return data as RecomputeResult;
}

/** 학습 현황 대시보드(관리자/HQ). fit vs adaptive vs 적용값 + rates + 상태. */
export async function adminAiLearningDashboard(
  storeId: string,
  playlistId: string,
): Promise<LearningDashboardResult> {
  const { data, error } = await supabase.rpc('admin_ai_learning_dashboard', {
    p_store_id: storeId,
    p_playlist_id: playlistId,
  });
  if (error) {
    console.error('[aiLearningApi] dashboard failed', error);
    throw error;
  }
  return data as LearningDashboardResult;
}
