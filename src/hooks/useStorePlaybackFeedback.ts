/**
 * useStorePlaybackFeedback — Phase AI-LEARNING-ENGINE-1
 *
 * 매장 플레이어의 재생 전이를 관찰해 학습 피드백(play/complete/skip/next/prev/pause/resume)
 * 을 수집한다. 순수 판정은 playbackFeedbackCollector.deriveFeedback 가 담당하고,
 * 이 hook 은 구독·세션·fire-and-forget RPC 만 붙인다.
 *
 * 안전 규칙 (재생 최우선):
 *   • 절대 재생을 방해하지 않는다. RPC 는 fire-and-forget, 실패는 silent.
 *   • 기본 OFF. 명시적으로 켠 환경에서만 수집(localStorage flag). 큐/정렬은 손대지 않는다.
 *   • currentTime tick 마다 판정하지 않는다 — trackId/playing/queueGeneration/index
 *     전이에서만 derive. 떠나는 트랙 진행률은 직전 tick 값(prevSnapRef)에서 가져온다
 *     (next() 가 index 변경과 동시에 currentTime=0 으로 리셋하기 때문).
 *
 * SQL: supabase/migrations/0465_ai_learning_engine.sql (record_store_playback_feedback)
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { recordStorePlaybackFeedback } from '@/lib/api/aiLearningApi';
import {
  deriveFeedback,
  type PlaybackSnapshot,
} from '@/lib/playbackFeedbackCollector';

// ---------------------------------------------------------------------------
// Feature flag (OFF by default) — 수집은 옵트인. 큐에 영향 없음(learning-only).
// ---------------------------------------------------------------------------
export const AI_FEEDBACK_COLLECT_FLAG_KEY = 'ai.learning.collect.enabled';

function safeStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 피드백 수집이 켜져 있는가. 기본 OFF — 오직 '1' 만 ON. */
export function isFeedbackCollectionEnabled(storage?: Storage): boolean {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    return s.getItem(AI_FEEDBACK_COLLECT_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 피드백 수집 ON/OFF 저장. */
export function setFeedbackCollectionEnabled(on: boolean, storage?: Storage): void {
  const s = safeStorage(storage);
  if (!s) return;
  try {
    if (on) s.setItem(AI_FEEDBACK_COLLECT_FLAG_KEY, '1');
    else s.removeItem(AI_FEEDBACK_COLLECT_FLAG_KEY);
  } catch {
    /* ignore quota / unavailable */
  }
}

// ---------------------------------------------------------------------------

interface UseStorePlaybackFeedbackOptions {
  storeId: string | null;
  /** false 면 hook 비활성(개인 사용자/관리자 페이지 등). */
  enabled: boolean;
}

function makeSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `sess-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function snapshotFromState(s: ReturnType<typeof usePlayerStore.getState>): PlaybackSnapshot {
  return {
    trackId: s.queue[s.index]?.id ?? null,
    queueGeneration: s.queueGeneration,
    index: s.index,
    playing: s.playing,
    currentTime: s.currentTime,
    duration: s.duration,
  };
}

/**
 * 매장 재생 피드백 수집 hook. StorePlayerPage 에서만 활성.
 * 반환값 없음 — 부작용(구독 + fire-and-forget)만.
 */
export function useStorePlaybackFeedback({
  storeId,
  enabled,
}: UseStorePlaybackFeedbackOptions): void {
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !storeId) return;
    if (!isFeedbackCollectionEnabled()) return;

    if (!sessionIdRef.current) sessionIdRef.current = makeSessionId();
    const sessionId = sessionIdRef.current;

    const emit = (
      events: ReturnType<typeof deriveFeedback>,
      playlistId: string | null,
    ) => {
      for (const ev of events) {
        void recordStorePlaybackFeedback({
          storeId,
          trackId: ev.trackId,
          event: ev.event,
          playlistId,
          completionRatio: ev.completionRatio,
          playedSeconds: ev.playedSeconds,
          durationSeconds: ev.durationSeconds,
          sessionId,
        });
      }
    };

    // 초기 상태: 재생 중이면 play 1건.
    const init = usePlayerStore.getState();
    let prevSnap = snapshotFromState(init);
    emit(deriveFeedback(null, prevSnap), init.playlist?.id ?? null);

    const unsub = usePlayerStore.subscribe((state) => {
      const curr = snapshotFromState(state);
      const triggerChanged =
        curr.trackId !== prevSnap.trackId ||
        curr.playing !== prevSnap.playing ||
        curr.queueGeneration !== prevSnap.queueGeneration ||
        curr.index !== prevSnap.index;

      if (!triggerChanged) {
        // currentTime/duration 만 갱신 — 떠나는 트랙 진행률 계산용으로 최신값 유지.
        prevSnap = { ...prevSnap, currentTime: curr.currentTime, duration: curr.duration };
        return;
      }

      const events = deriveFeedback(prevSnap, curr);
      prevSnap = curr;
      emit(events, state.playlist?.id ?? null);
    });

    return () => {
      unsub();
    };
  }, [enabled, storeId]);
}
