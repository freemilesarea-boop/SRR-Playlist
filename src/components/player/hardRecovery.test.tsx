/**
 * @vitest-environment jsdom
 *
 * HARD RECOVERY — React DOM 통합 검증.
 *
 * 순수 함수 테스트(stallWatchdog.test.ts)로는 증명할 수 없는 네 가지를 못 박는다.
 * Player 전체를 마운트하려면 zustand·supabase·router 를 전부 세워야 하므로,
 * **Player.tsx 와 동일한 패턴**(두 개의 <audio key={`audio-X-${generation}`}> +
 * ref 콜백 + 세대 증가)만 최소 harness 로 재현한다. 폐기 루틴과 세대 가드는
 * Player 가 실제로 쓰는 모듈(@/lib/hardRecovery)을 그대로 부른다.
 *
 * 검증 대상:
 *   1. hard recovery 전후 HTMLAudioElement object identity 가 실제로 달라지는가
 *   2. 옛 세대의 이벤트/콜백이 새 세대 상태를 바꾸지 못하는가
 *   3. crossfade 진행 중이어도 timer/rAF 가 정리되고 큐·현재 곡이 보존되는가
 *   4. hard reset 후에도 진행이 없으면 reload_page 까지 실제로 도달하는가
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useRef, useState, useCallback, useEffect } from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { disposeAudioElement, guardGeneration, isStaleGeneration } from '@/lib/hardRecovery';
import {
  resolveStallAction, verifyHardReset,
  SKIP_AFTER_MS, FRUITLESS_SKIP_LIMIT, HARD_RESET_VERIFY_MS,
  type StallAction,
} from '@/lib/stallWatchdog';

/* ────────────────────────────────────────────────────────────────────────── */
/* Player.tsx 의 dual-audio + generation 패턴만 떼어낸 harness                  */
/* ────────────────────────────────────────────────────────────────────────── */

interface Harness {
  getA: () => HTMLAudioElement | null;
  getB: () => HTMLAudioElement | null;
  getGeneration: () => number;
  /** Player.runHardReset 과 같은 순서: 타이머 정리 → 엘리먼트 폐기 → 세대 증가 */
  hardReset: () => void;
  /** 큐 보존 확인용 — hard reset 이 건드리지 않아야 한다. */
  getQueue: () => string[];
  getCurrentTrackId: () => string | null;
  cancelledTimers: number[];
  /** crossfade 타이머를 흉내내기 위해 테스트가 직접 예약한다. */
  schedule: (fn: () => void, ms: number) => number;
  /** 세대 가드 테스트용 — Player 의 audioGenerationRef 에 해당. */
  generationRef: { current: number };
}

let harness: Harness;

function DualAudio({ queue, currentTrackId }: { queue: string[]; currentTrackId: string }) {
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  generationRef.current = generation;

  // crossfade 가 걸어둔 rAF/timeout 을 흉내낸다.
  const pendingTimersRef = useRef<number[]>([]);
  const cancelledRef = useRef<number[]>([]);

  const cancelCrossfade = useCallback(() => {
    for (const id of pendingTimersRef.current) {
      window.clearTimeout(id);
      cancelledRef.current.push(id);
    }
    pendingTimersRef.current = [];
  }, []);

  const hardReset = useCallback(() => {
    // 1) 옛 콜백이 새 세대를 건드리지 못하게 타이머부터 끊는다
    cancelCrossfade();
    // 2) 엘리먼트를 놓아준다 (Player 와 동일한 모듈)
    disposeAudioElement(audioARef.current);
    disposeAudioElement(audioBRef.current);
    // 3) 세대 교체 → React 가 <audio> 를 언마운트/재생성
    setGeneration((g) => g + 1);
  }, [cancelCrossfade]);

  // 렌더 중에 모듈 변수를 건드리면 side effect 다 — effect 에서 노출한다.
  useEffect(() => {
    harness = {
      getA: () => audioARef.current,
      getB: () => audioBRef.current,
      getGeneration: () => generationRef.current,
      hardReset,
      getQueue: () => queue,
      getCurrentTrackId: () => currentTrackId,
      cancelledTimers: cancelledRef.current,
      // 테스트가 crossfade 타이머를 걸 수 있게 노출한다.
      schedule: (fn: () => void, ms: number) => {
        const id = window.setTimeout(fn, ms);
        pendingTimersRef.current.push(id);
        return id;
      },
      generationRef,
    };
  });

  return (
    <>
      <audio key={`audio-A-${generation}`} ref={audioARef} preload="metadata" />
      <audio key={`audio-B-${generation}`} ref={audioBRef} preload="metadata" />
    </>
  );
}

const QUEUE = ['t1', 't2', 't3'];

beforeEach(() => {
  // jsdom 은 load()/play() 를 구현하지 않는다 — 호출 여부만 관측한다.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true, writable: true, value: vi.fn(),
  });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true, writable: true, value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 엘리먼트 identity 가 실제로 바뀌는가
 * ══════════════════════════════════════════════════════════════════════════ */

describe('1. HTMLAudioElement object identity', () => {
  it('hard recovery 후 A/B 모두 다른 객체가 된다 — 죽은 엘리먼트 재사용이 불가능해진다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);

    const oldA = harness.getA();
    const oldB = harness.getB();
    expect(oldA).toBeInstanceOf(window.HTMLAudioElement);
    expect(oldB).toBeInstanceOf(window.HTMLAudioElement);
    expect(oldA).not.toBe(oldB);

    act(() => { harness.hardReset(); });

    const newA = harness.getA();
    const newB = harness.getB();

    expect(newA).not.toBe(oldA);   // ← 이게 이번 Phase 의 핵심
    expect(newB).not.toBe(oldB);
    expect(newA).toBeInstanceOf(window.HTMLAudioElement);
    expect(newB).toBeInstanceOf(window.HTMLAudioElement);
    expect(harness.getGeneration()).toBe(1);
  });

  it('폐기된 엘리먼트는 DOM 에서 빠지고 src 가 떨어져 있다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const oldA = harness.getA()!;
    oldA.setAttribute('src', 'blob:fake-old');

    act(() => { harness.hardReset(); });

    expect(oldA.isConnected).toBe(false);            // DOM 에서 제거됨
    expect(oldA.getAttribute('src')).toBeNull();     // src 해제됨
    expect(oldA.pause).toHaveBeenCalled();
    expect(oldA.load).toHaveBeenCalled();
    expect(harness.getA()!.isConnected).toBe(true);  // 새 엘리먼트는 살아 있음
  });

  it('세대를 여러 번 올려도 매번 새 객체다 (identity 재사용 없음)', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const seen = new Set<HTMLAudioElement>();
    seen.add(harness.getA()!);
    for (let i = 0; i < 3; i += 1) {
      act(() => { harness.hardReset(); });
      const a = harness.getA()!;
      expect(seen.has(a)).toBe(false);
      seen.add(a);
    }
    expect(seen.size).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 옛 세대 콜백이 새 세대를 건드리지 못하는가
 * ══════════════════════════════════════════════════════════════════════════ */

describe('2. stale generation 보호', () => {
  it('옛 엘리먼트에 남은 리스너가 발화해도 새 엘리먼트에는 닿지 않는다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const oldA = harness.getA()!;
    const hits: string[] = [];
    oldA.addEventListener('pause', () => hits.push('old-pause'));

    act(() => { harness.hardReset(); });
    const newA = harness.getA()!;

    // 폐기된 엘리먼트에서 이벤트를 강제로 쏴본다.
    oldA.dispatchEvent(new Event('pause'));

    expect(hits).toEqual(['old-pause']);  // 옛 엘리먼트에서만 발화
    expect(newA).not.toBe(oldA);          // 새 엘리먼트는 별개 객체
  });

  it('세대 가드가 옛 콜백의 실행 자체를 막는다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const genRef = harness.generationRef;

    const effect = vi.fn();
    // 세대 0 에서 만들어진 콜백 (crossfade 완료 / play 프로미스 등)
    const staleCallback = guardGeneration(0, () => genRef.current, effect);

    staleCallback();                       // 아직 같은 세대 → 실행됨
    expect(effect).toHaveBeenCalledTimes(1);

    act(() => { harness.hardReset(); });

    staleCallback();                       // 세대가 바뀜 → 실행 안 됨
    expect(effect).toHaveBeenCalledTimes(1);
    expect(isStaleGeneration(0, genRef.current)).toBe(true);
  });

  it('세대를 읽지 못하면(예외) 옛 콜백은 실행하지 않는다 — 안전 쪽으로 넘어진다', () => {
    const effect = vi.fn();
    const cb = guardGeneration(0, () => { throw new Error('gone'); }, effect);
    cb();
    expect(effect).not.toHaveBeenCalled();
  });

  it('뒤늦게 도착한 옛 세대 setTimeout 이 새 세대 상태를 바꾸지 못한다', () => {
    vi.useFakeTimers();
    try {
      render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
      const genRef = harness.generationRef;
      let newGenTouched = false;
      const late = guardGeneration(0, () => genRef.current, () => { newGenTouched = true; });
      window.setTimeout(late, 5_000);

      act(() => { harness.hardReset(); });
      act(() => { vi.advanceTimersByTime(6_000); });

      expect(newGenTouched).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. crossfade 진행 중 hard recovery
 * ══════════════════════════════════════════════════════════════════════════ */

describe('3. crossfade 진행 중 hard recovery', () => {
  it('걸려 있던 crossfade 타이머가 정리되고 콜백이 실행되지 않는다', () => {
    vi.useFakeTimers();
    try {
      render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
      const { schedule } = harness;

      const fired: string[] = [];
      const id1 = schedule(() => fired.push('fade-tick'), 1_000);
      const id2 = schedule(() => fired.push('fade-complete'), 2_000);

      act(() => { harness.hardReset(); });
      act(() => { vi.advanceTimersByTime(5_000); });

      expect(fired).toEqual([]);                       // 하나도 실행되지 않음
      expect(harness.cancelledTimers).toContain(id1);
      expect(harness.cancelledTimers).toContain(id2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('crossfade 중 재생성돼도 큐와 현재 곡은 그대로다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const queueBefore = harness.getQueue();
    const trackBefore = harness.getCurrentTrackId();

    act(() => { harness.hardReset(); });

    expect(harness.getQueue()).toEqual(QUEUE);         // 큐 재생성/재조회 없음
    expect(harness.getQueue()).toBe(queueBefore);      // 같은 배열 그대로
    expect(harness.getCurrentTrackId()).toBe(trackBefore);
    expect(harness.getGeneration()).toBe(1);           // 바뀐 건 엘리먼트뿐
  });

  it('양쪽 엘리먼트가 모두 폐기된다 — 한쪽만 남아 오염을 이어가지 않는다', () => {
    render(<DualAudio queue={QUEUE} currentTrackId="t2" />);
    const oldA = harness.getA()!;
    const oldB = harness.getB()!;

    act(() => { harness.hardReset(); });

    expect(oldA.pause).toHaveBeenCalled();
    expect(oldB.pause).toHaveBeenCalled();
    expect(oldA.isConnected).toBe(false);
    expect(oldB.isConnected).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. reload_page fallback 이 실제로 도달 가능한가
 *    — Player 가 refs 를 갱신하는 순서를 그대로 재현해 사다리를 끝까지 태운다.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('4. hard reset 실패 시 reload_page 도달', () => {
  /** Player 의 워치독 tick 이 refs 를 갱신하는 순서를 그대로 흉내낸다. */
  function driveLadder(opts: { progressAfterHardReset: boolean }) {
    const TICK = 3_000;
    let stalledMs = 0;
    let fruitless = 0;
    let hardResetDone = false;
    let hardResetAt: number | null = null;
    let elapsed = 0;
    const actions: StallAction[] = [];
    const verdicts: string[] = [];

    for (let i = 0; i < 200; i += 1) {
      elapsed += TICK;
      stalledMs += TICK;

      // Player: hard reset 검증을 진행 판정 직후, 사다리 앞에서 수행
      if (hardResetAt !== null) {
        const progressed = opts.progressAfterHardReset;
        const v = verifyHardReset({ msSinceReset: elapsed - hardResetAt, progressed });
        if (v === 'success') { verdicts.push('success'); break; }
        if (v === 'failure') { verdicts.push('failure'); hardResetAt = null; }
      }

      const action = resolveStallAction({
        businessMode: true, playing: true, paused: false, ended: false,
        crossfading: false, suppressed: false, autoplayBlocked: false,
        subscriptionBlocked: false,
        stalledMs,
        fruitlessSkips: fruitless,
        hardResetDone,
        hardResetMsAgo: hardResetAt === null ? null : elapsed - hardResetAt,
      });
      if (action === 'none') continue;
      actions.push(action);

      if (action === 'skip') {
        fruitless += 1;          // playedSeconds=0 → 헛skip
        stalledMs = 0;           // 곡이 바뀌어 사다리 초기화 (Player 와 동일)
      } else if (action === 'hard_reset') {
        hardResetAt = elapsed;
        hardResetDone = true;
      } else if (action === 'reload_page') {
        break;                   // 마지막 칸 도달
      }
    }
    return { actions, verdicts, elapsedMs: elapsed };
  }

  it('진행이 회복되지 않으면 skip×3 → hard_reset → reload_page 까지 도달한다', () => {
    const { actions, verdicts } = driveLadder({ progressAfterHardReset: false });

    expect(actions.filter((a) => a === 'skip')).toHaveLength(FRUITLESS_SKIP_LIMIT);
    expect(actions.filter((a) => a === 'hard_reset')).toHaveLength(1);   // 정확히 1회
    expect(verdicts).toContain('failure');
    expect(actions[actions.length - 1]).toBe('reload_page');             // 실제 도달
  });

  it('hard reset 으로 소리가 돌아오면 페이지 재시작까지 가지 않는다', () => {
    const { actions, verdicts } = driveLadder({ progressAfterHardReset: true });

    expect(actions).toContain('hard_reset');
    expect(verdicts).toEqual(['success']);
    expect(actions).not.toContain('reload_page');
  });

  it('사다리 전체 소요 시간이 3분 안쪽이다 — 장시간 무음으로 고착되지 않는다', () => {
    const { elapsedMs } = driveLadder({ progressAfterHardReset: false });
    expect(elapsedMs).toBeLessThanOrEqual(3 * 60 * 1000);
    expect(elapsedMs).toBeGreaterThan(SKIP_AFTER_MS * 3);   // 성급하게 발동하지도 않는다
  });

  it('hard reset 검증 창 동안에는 사다리가 멈춰 새 엘리먼트를 다시 부수지 않는다', () => {
    const mid = resolveStallAction({
      businessMode: true, playing: true, paused: false, ended: false,
      crossfading: false, suppressed: false, autoplayBlocked: false,
      subscriptionBlocked: false, stalledMs: SKIP_AFTER_MS * 5,
      fruitlessSkips: FRUITLESS_SKIP_LIMIT, hardResetDone: true,
      hardResetMsAgo: HARD_RESET_VERIFY_MS - 1,
    });
    expect(mid).toBe('none');
  });
});
