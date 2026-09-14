/**
 * frozenAudioState.ts — 정지의 **모양**을 이름 붙여 가른다.
 *
 * 왜 — stallWatchdog 은 "얼마나 오래 멈췄나"(stalledMs) 하나로 사다리를 태운다.
 * 그건 복구에는 충분하지만 **부검에는 부족하다.** 숙대점에서 우리가 실제로 겪은
 * 정지는 최소 세 가지였고 서로 원인이 다르다:
 *
 *   · paused 로 굳음        (2026-09-11, 14분) — 엘리먼트만 멈춤, 의도는 재생
 *   · 버퍼 고갈             — readyState 가 떨어지고 waiting 이 뜬다
 *   · **paused=false 인데 위치가 안 움직임** — readyState 는 멀쩡하고 error 도 없다.
 *     `waiting` 도 `stalled` 도 안 뜬다. 이벤트 기반 감시가 영영 못 보는 모양이다.
 *
 * 세 번째가 가장 고약하다. 모든 표면 신호가 "정상 재생"이라고 말하기 때문이다 —
 * `paused === false`, `readyState >= 2`, `error === null`. 소리만 안 난다.
 * 그래서 이름을 붙인다: **FROZEN_AUDIO_STATE.**
 *
 * ── 이 모듈이 하지 않는 것 ─────────────────────────────────────────────────
 * 복구를 결정하지 않는다. 사다리는 stallWatchdog 이 그대로 소유한다. 여기서는
 * **분류만** 한다 — 관측이 재생 로직을 바꾸면 안 된다. 순수 함수다.
 */

/** HTMLMediaElement.readyState — HAVE_CURRENT_DATA 이상이면 "지금 틀 데이터는 있다". */
export const HAVE_CURRENT_DATA = 2;

/**
 * 위치가 이만큼 안 움직이면 정지로 본다.
 *
 * 사다리의 첫 칸(nudge, 8초)보다 짧게 잡는다 — 복구가 시작되기 **전에** 어떤
 * 모양이었는지 기록해야 부검에 쓸모가 있다. 곡 전환·크로스페이드의 짧은 공백을
 * 정지로 세지 않을 만큼은 길다.
 */
export const FREEZE_AFTER_MS = 4_000;

export type AudioFreezeKind =
  /** 정지가 아니다. */
  | 'NONE'
  /** 사용자가/스케줄이 멈춘 것 — 되살릴 대상이 아니다. */
  | 'INTENT_STOPPED'
  /** 곡이 정상 종료됐다. onEnded 가 다음 곡을 건다. */
  | 'ENDED'
  /** 디코딩/네트워크 오류가 실제로 보고됐다. */
  | 'MEDIA_ERROR'
  /** 재생 의도는 있는데 엘리먼트만 paused 로 굳었다. */
  | 'PAUSED_FREEZE'
  /** 틀 데이터가 모자란다(readyState < 2). 버퍼가 말랐다. */
  | 'BUFFER_STARVED'
  /**
   * **표면상 전부 정상인데 위치만 안 움직인다.**
   * paused=false · readyState>=2 · error 없음 · currentTime 정지.
   * 이벤트 기반 감시가 구조적으로 못 보는 모양이다.
   */
  | 'FROZEN_AUDIO_STATE';

export interface AudioFreezeInput {
  /** 재생 의도(store.playing). */
  playing: boolean;
  /** 본사 스케줄 억제 / 구독 차단 등으로 멈춰 있는가. */
  suppressed?: boolean;
  /** 자동재생 차단 — 제스처가 필요한 상태다. 정지로 분류하지 않는다. */
  autoplayBlocked?: boolean;
  /** 크로스페이드 중인가. 두 엘리먼트가 동시에 도는 구간은 따로 본다. */
  crossfading?: boolean;
  paused: boolean;
  ended: boolean;
  readyState: number;
  /** el.error 가 있으면 그 code. 없으면 null. */
  errorCode: number | null;
  /** 마지막으로 currentTime 이 실제로 움직인 뒤 흐른 시간(ms). */
  stalledMs: number;
  /** 정지 판정 임계(테스트에서 조절). */
  freezeAfterMs?: number;
}

/**
 * 지금 정지인가, 정지라면 어떤 모양인가.
 *
 * 순서가 중요하다 — 되살릴 대상이 아닌 것부터 걸러야 오탐이 없다.
 */
export function classifyAudioFreeze(i: AudioFreezeInput): AudioFreezeKind {
  // 1) 되살릴 대상이 아닌 것들부터.
  if (!i.playing || i.suppressed) return 'INTENT_STOPPED';
  if (i.ended) return 'ENDED';
  // 자동재생 차단은 제스처 문제다. play() 를 눌러도 소용없으므로 정지로 세지 않는다.
  if (i.autoplayBlocked) return 'INTENT_STOPPED';

  // 2) 오류가 **보고된** 경우는 추측할 필요가 없다.
  if (i.errorCode !== null) return 'MEDIA_ERROR';

  // 3) 아직 정지라고 부를 만큼 지나지 않았다.
  //    크로스페이드 구간은 두 엘리먼트가 겹쳐 도는 정상 상태라 세지 않는다.
  const threshold = i.freezeAfterMs ?? FREEZE_AFTER_MS;
  if (i.crossfading) return 'NONE';
  if (i.stalledMs < threshold) return 'NONE';

  // 4) 여기서부터는 진짜 정지다. 모양을 가른다.
  if (i.paused) return 'PAUSED_FREEZE';
  if (i.readyState < HAVE_CURRENT_DATA) return 'BUFFER_STARVED';

  // paused=false · readyState>=2 · error 없음 · 위치 정지.
  // 표면 신호가 전부 "정상" 이라고 말하는 바로 그 상태다.
  return 'FROZEN_AUDIO_STATE';
}

/** 복구 사다리를 태워야 하는 모양인가. (관측 분류 → 조치 여부 매핑) */
export function freezeNeedsRecovery(kind: AudioFreezeKind): boolean {
  return kind === 'PAUSED_FREEZE'
    || kind === 'BUFFER_STARVED'
    || kind === 'FROZEN_AUDIO_STATE'
    || kind === 'MEDIA_ERROR';
}

/**
 * 이벤트 기반 감시로는 **원리적으로 못 잡는** 모양인가.
 *
 * FROZEN_AUDIO_STATE 는 waiting 도 stalled 도 error 도 뜨지 않는다. timeupdate 는
 * 재생이 멈췄으니 더 이상 오지 않는다. 즉 타이머로 주기적으로 보지 않으면
 * 되살릴 계기 자체가 없다. 이 함수가 true 를 돌려주는 모양은 타이머 감시가
 * 유일한 방어선이라는 뜻이다.
 */
export function requiresTimerDetection(kind: AudioFreezeKind): boolean {
  return kind === 'FROZEN_AUDIO_STATE' || kind === 'PAUSED_FREEZE';
}
