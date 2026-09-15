/**
 * mediaProgress.ts — "재생 위치가 실제로 나아갔는가" 의 유일한 기준.
 *
 * ── 왜 이 파일이 생겼는가 (2026-09-15 숙대점 실측) ─────────────────────────
 *
 * 27분 동안 26곡이 연속으로 얼었다. 매 곡이 이렇게 죽었다:
 *
 *   playing 이벤트 발생 · paused=false · readyState=4 · networkState=1
 *   그런데 currentTime 은 **0.02초에서 한 번도 움직이지 않음**
 *
 * 클라이언트의 FROZEN_AUDIO_STATE 분류기는 이걸 정확히 잡아냈다. 그런데 복구
 * 사다리는 마지막 칸(fresh element hard reset)까지 **한 번도 올라가지 못했고**,
 * 서버는 27분 내내 "정상 재생"으로 봤다. 원인은 한 곳이었다:
 *
 *   진행 판정이 `|Δct| >= 0.01` 이었다.
 *
 * 엘리먼트가 새 소스를 물고 `playing` 을 쏘면 currentTime 은 0 → 0.02 로 한 번
 * 튄다. 그 **0.02초의 초기화 지터**가 0.01 문턱을 넘는다. 그래서:
 *
 *   · 사다리:   "진행했다" → fruitlessSkips 0 으로 리셋 → 곡을 26번 건너뛰어도
 *               카운터가 3(FRUITLESS_SKIP_LIMIT)에 닿지 못함 → hard_reset 미발동
 *   · 서버:     noteAudioProgress 가 갱신 → last_audio_progress_at 이 계속 신선
 *               → 무음 27분을 정상으로 보고
 *   · hard reset 검증: 같은 플래그를 쓰므로 지터만으로 "성공" 판정 가능
 *
 * 하나의 잘못된 가정("아주 작은 delta 도 재생이다")이 세 곳을 동시에 속였다.
 *
 * ── 이 모듈이 주장하지 않는 것 ─────────────────────────────────────────────
 *
 * **소리가 실제로 들렸는지는 브라우저 JS 로 증명할 수 없다.** 여기서 재는 것은
 * "미디어 타임라인이 의미 있게 나아갔는가" 뿐이다. 스피커가 뽑혀 있거나 음량이
 * 0이면 이 값은 여전히 참이다. 그 한계를 지운 척하지 않는다.
 */

/**
 * 이만큼은 나아가야 "진행" 으로 센다.
 *
 * 임의로 고른 값이 아니다 — 이 프로젝트가 **이미** 네트워크 재접속 경로에서
 * 실제 진행을 가릴 때 쓰던 문턱이 0.25초다(Player.tsx onNetworkBack:
 * `ct > stallProgressRef.current.ct + 0.25`). 두 경로가 같은 기준을 쓰게 맞춘다.
 *
 * 관측된 지터의 최댓값은 0.05초였고(0.02~0.05), 사다리 틱은 3초·heartbeat 는
 * 60초다. 정상 재생이면 3초 틱에서 약 3초가 진행되므로 이 문턱에 여유가 크다.
 */
export const MEANINGFUL_PROGRESS_SEC = 0.25;

/**
 * 두 관측 사이에 미디어 타임라인이 의미 있게 나아갔는가.
 *
 * 뒤로 간 경우(시킹)는 진행으로 세지 않는다 — 사용자가 되감은 것을 "재생이
 * 살아 있다" 는 증거로 쓰면, 되감기 직후 얼어붙은 상태를 정상으로 읽게 된다.
 */
export function isMeaningfulProgress(
  prevCt: number,
  nextCt: number,
  thresholdSec: number = MEANINGFUL_PROGRESS_SEC,
): boolean {
  if (!Number.isFinite(prevCt) || !Number.isFinite(nextCt)) return false;
  return nextCt - prevCt >= thresholdSec;
}

/** 진행 기준점. 곡이 바뀌면 새 곡의 위치로 옮기되 **진행으로 세지 않는다.** */
export interface ProgressAnchor {
  trackId: string | null;
  ct: number;
}

export type ProgressVerdict =
  /** 의미 있는 진행. 기준점을 옮기고 "소리가 났다" 로 센다. */
  | { kind: 'progress'; anchor: ProgressAnchor }
  /**
   * 곡이 바뀌었다 — 기준점만 옮긴다.
   * **진행이 아니다.** 26곡이 연속으로 얼었을 때 곡 전환만으로 진행을 인정하면
   * 무음이 영원히 정상으로 보인다(2026-09-15).
   */
  | { kind: 'track_change'; anchor: ProgressAnchor }
  /** 되감기/재로드 — 기준점만 내린다. 진행이 아니다. */
  | { kind: 'rewind'; anchor: ProgressAnchor }
  /** 아직 문턱을 못 넘었다. 기준점 그대로. */
  | { kind: 'idle'; anchor: ProgressAnchor };

/**
 * 관측 하나를 기준점에 적용한다.
 *
 * 순수 함수다 — 호출측이 돌려받은 anchor 를 그대로 저장하면 된다.
 */
export function advanceProgressAnchor(
  anchor: ProgressAnchor,
  trackId: string | null,
  ct: number,
  thresholdSec: number = MEANINGFUL_PROGRESS_SEC,
): ProgressVerdict {
  if (!Number.isFinite(ct)) return { kind: 'idle', anchor };
  if (anchor.trackId !== trackId) {
    return { kind: 'track_change', anchor: { trackId, ct } };
  }
  if (ct < anchor.ct) {
    return { kind: 'rewind', anchor: { trackId, ct } };
  }
  if (isMeaningfulProgress(anchor.ct, ct, thresholdSec)) {
    return { kind: 'progress', anchor: { trackId, ct } };
  }
  return { kind: 'idle', anchor };
}

/** 이 판정이 "실제로 소리가 나고 있다" 의 증거로 쓸 수 있는가. */
export function countsAsPlayback(v: ProgressVerdict): boolean {
  return v.kind === 'progress';
}
