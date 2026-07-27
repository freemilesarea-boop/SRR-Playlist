/**
 * playbackFeedbackCollector.ts — Phase AI-LEARNING-ENGINE-1
 *
 * PURE playback-event derivation (no network, no DOM, fully unit-testable).
 *
 * 역할: 플레이어 상태 스냅샷의 "직전 → 현재" 전이를 보고, 어떤 학습 피드백
 *   이벤트(play/complete/skip/next/pause/resume/previous)를 기록할지 결정한다.
 *   실제 기록(RPC)·구독(hook)은 여기서 하지 않는다 — service/hook 레이어 담당.
 *
 * 판정 규칙 (재생 방해 없이, 스냅샷만으로 결정론적):
 *   • 트랙이 바뀌면 → 떠나는 트랙의 진행률로 등급 분류:
 *       ratio ≥ COMPLETE_THRESHOLD  → 'complete'  (자연 종료)
 *       ratio ≥ NEXT_THRESHOLD      → 'next'      (절반 이상 듣고 넘김)
 *       그 외                        → 'skip'      (초반 스킵 = 강한 부정)
 *     그리고 새 트랙에 대해 → 'play'.
 *   • 같은 트랙에서 playing true→false → 'pause', false→true → 'resume'.
 *   • prev 로 인덱스가 뒤로 가면(트랙 변경) → 떠나는 트랙 등급 + 'previous'(새 트랙 play 대신).
 *   • completionRatio 는 duration>0 일 때 currentTime/duration, 아니면 null.
 *
 * DB reaction 모델(0465)과 정합: complete(+), next(−15), skip(−50).
 */
import type { PlaybackFeedbackEvent } from '@/lib/aiLearningEngine';

/** 완곡 판정 임계(이 이상이면 complete). */
export const COMPLETE_THRESHOLD = 0.9;
/** next(mild) 판정 임계(이 이상~complete 미만이면 next). */
export const NEXT_THRESHOLD = 0.5;

/** 플레이어에서 뽑아낸 최소 스냅샷(순수 값만). */
export interface PlaybackSnapshot {
  trackId: string | null;
  /** 현재 큐 세대(setQueue 마다 증가). 세대가 바뀌면 트랙 변경을 skip 으로 오판하지 않는다. */
  queueGeneration: number;
  index: number;
  playing: boolean;
  currentTime: number;
  duration: number;
}

/** 기록 대상 피드백 1건. */
export interface DerivedFeedback {
  event: PlaybackFeedbackEvent;
  trackId: string;
  completionRatio: number | null;
  playedSeconds: number | null;
  durationSeconds: number | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** 진행률(0..1). duration ≤ 0 이면 null(알 수 없음). */
export function progressRatio(currentTime: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return clamp01(currentTime / duration);
}

/** 떠나는 트랙의 진행률 → complete / next / skip 등급. */
export function classifyDeparture(ratio: number | null): PlaybackFeedbackEvent {
  const r = ratio ?? 0;
  if (r >= COMPLETE_THRESHOLD) return 'complete';
  if (r >= NEXT_THRESHOLD) return 'next';
  return 'skip';
}

/**
 * 직전 → 현재 스냅샷 전이에서 기록할 피드백 이벤트들을 도출한다.
 * 순수 함수 — 부작용 없음. 빈 배열이면 기록할 것 없음.
 *
 * 규칙 상세:
 *   - prev == null (첫 관측): 재생 중이면 현재 트랙에 'play' 1건.
 *   - queueGeneration 변경: 새 큐 → 떠나는 트랙 판정 생략(오판 방지), 새 트랙 'play' 만.
 *   - 트랙 동일:
 *       playing false→true → 'resume'
 *       playing true→false → 'pause'
 *   - 트랙 변경(같은 세대):
 *       떠나는 트랙: classifyDeparture(직전 진행률)
 *       새 트랙: index 가 감소했으면 'previous', 아니면 'play'
 */
export function deriveFeedback(
  prev: PlaybackSnapshot | null,
  curr: PlaybackSnapshot,
): DerivedFeedback[] {
  const out: DerivedFeedback[] = [];

  // 첫 관측: 재생 중인 트랙만 play 기록.
  if (!prev) {
    if (curr.trackId && curr.playing) {
      out.push(playEvent('play', curr.trackId, curr));
    }
    return out;
  }

  const trackChanged = prev.trackId !== curr.trackId;

  // 큐 세대 변경 → 새 플레이리스트 로드. 떠나는 트랙 판정 안 함(자연스러운 교체).
  if (curr.queueGeneration !== prev.queueGeneration) {
    if (curr.trackId && curr.playing) {
      out.push(playEvent('play', curr.trackId, curr));
    }
    return out;
  }

  if (!trackChanged) {
    // 같은 트랙: 재생/일시정지 전이만.
    if (curr.trackId) {
      if (!prev.playing && curr.playing) {
        out.push(playEvent('resume', curr.trackId, curr));
      } else if (prev.playing && !curr.playing) {
        out.push(playEvent('pause', prev.trackId ?? curr.trackId, prev));
      }
    }
    return out;
  }

  // 트랙 변경(같은 세대): 떠나는 트랙 등급 + 새 트랙 진입.
  if (prev.trackId) {
    const ratio = progressRatio(prev.currentTime, prev.duration);
    out.push({
      event: classifyDeparture(ratio),
      trackId: prev.trackId,
      completionRatio: ratio,
      playedSeconds: Number.isFinite(prev.currentTime) ? prev.currentTime : null,
      durationSeconds: prev.duration > 0 ? prev.duration : null,
    });
  }
  if (curr.trackId) {
    const goingBack = curr.index < prev.index;
    out.push(playEvent(goingBack ? 'previous' : 'play', curr.trackId, curr));
  }
  return out;
}

function playEvent(
  event: PlaybackFeedbackEvent,
  trackId: string,
  snap: PlaybackSnapshot,
): DerivedFeedback {
  return {
    event,
    trackId,
    completionRatio: progressRatio(snap.currentTime, snap.duration),
    playedSeconds: Number.isFinite(snap.currentTime) ? snap.currentTime : null,
    durationSeconds: snap.duration > 0 ? snap.duration : null,
  };
}
