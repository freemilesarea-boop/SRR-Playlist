/**
 * hardRecovery.ts — 죽은 오디오 엘리먼트를 놓아주는 정리 루틴 + 세대 가드.
 *
 * Player.tsx 의 hard reset 경로가 실제로 쓰는 코드다. 여기 모아둔 이유는 두 가지:
 *   1) 진짜 HTMLMediaElement 를 상대로 테스트할 수 있게 하려고
 *   2) "무엇을 폐기하는가" 를 한 곳에서 읽을 수 있게 하려고
 *
 * 배경 — 숙대점 2026-09-13: skip 은 큐 index 만 옮기고 **같은 엘리먼트**에 새 src 를
 * 꽂는다. 엘리먼트가 죽어 있으면 74곡을 넘겨도 전부 0초다. 그래서 곡이 아니라
 * 엘리먼트를 버린다.
 */

/** 정리 과정에서 실제로 무엇이 됐는지 (테스트·진단용). */
export interface DisposeResult {
  paused: boolean;
  srcRemoved: boolean;
  loaded: boolean;
}

/**
 * 엘리먼트 하나를 놓아준다.
 *
 * pause → src 제거 → load() 순서가 중요하다. src 를 뗀 뒤 load() 를 불러야
 * 브라우저가 붙잡고 있던 미디어 리소스를 실제로 놓는다. 각 단계는 독립적으로
 * 감싸므로 하나가 실패해도 나머지는 진행된다 — 이미 망가진 엘리먼트가 대상이다.
 */
export function disposeAudioElement(el: HTMLMediaElement | null | undefined): DisposeResult {
  const result: DisposeResult = { paused: false, srcRemoved: false, loaded: false };
  if (!el) return result;
  try { el.pause(); result.paused = true; } catch { /* 이미 죽은 엘리먼트 */ }
  try { el.removeAttribute('src'); result.srcRemoved = true; } catch { /* noop */ }
  try { el.load(); result.loaded = true; } catch { /* noop */ }
  return result;
}

/** A/B 두 장을 한 번에. 하나가 실패해도 다른 하나는 진행된다. */
export function disposeAudioElements(
  els: ReadonlyArray<HTMLMediaElement | null | undefined>,
): DisposeResult[] {
  return els.map((el) => disposeAudioElement(el));
}

/**
 * 세대 가드 — 옛 세대에서 예약된 콜백이 새 세대를 건드리지 못하게 한다.
 *
 * hard reset 직전에 걸려 있던 play Promise · crossfade rAF · setTimeout · preload
 * 콜백이 뒤늦게 도착할 수 있다. 콜백이 자기가 만들어진 세대를 기억하고 있다가
 * 이 함수로 걸러내면, 새로 만든 엘리먼트를 옛 콜백이 pause/reset 하는 사고를 막는다.
 */
export function isStaleGeneration(capturedGeneration: number, currentGeneration: number): boolean {
  return capturedGeneration !== currentGeneration;
}

/**
 * 옛 세대 콜백을 감싼다. 세대가 바뀌었으면 **호출 자체가 일어나지 않는다.**
 *
 * @param capture 콜백을 만들 때의 세대
 * @param readCurrent 실행 시점의 세대를 읽는 함수(ref 를 읽는다)
 */
export function guardGeneration<A extends unknown[]>(
  capture: number,
  readCurrent: () => number,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    let current: number;
    try {
      current = readCurrent();
    } catch {
      return;   // 세대를 못 읽으면 실행하지 않는다 — 안전 쪽으로 넘어진다
    }
    if (isStaleGeneration(capture, current)) return;
    fn(...args);
  };
}
