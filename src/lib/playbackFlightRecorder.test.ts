import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushRing, canFlush, consumeFlush, dayKeyOf, buildFlushPayload, snapshotAudio,
  OBSERVED_MEDIA_EVENTS, RING_CAPACITY, FLUSH_MIN_INTERVAL_MS, FLUSH_MAX_PER_DAY,
  initFlightRecorder, resetFlightRecorder, setFlightContextProvider,
  recordFlightEvent, recordPauseRequest, observePlay, attachMediaEventRecorder,
  tryBuildFlush, getFlightBuffer, newPlayerInstanceId, getPlayerInstanceId,
  type FlightEntry, type FlushGuard,
} from './playbackFlightRecorder';

/**
 * 최소 HTMLMediaElement 대역. EventTarget 만 있으면 리스너 경로를 그대로 검증할 수 있다.
 * 값은 테스트가 자유롭게 바꿔 정지/버퍼 상태를 흉내낸다.
 */
class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = 180;
  paused = false;
  ended = false;
  readyState = 4;
  networkState = 1;
  volume = 1;
  muted = false;
  error: { code: number } | null = null;
  buffered = {
    length: 1,
    start: () => 0,
    end: () => 30,
  };
  fire(name: string) { this.dispatchEvent(new Event(name)); }
}

function fakeEl(over: Partial<FakeAudio> = {}): HTMLMediaElement {
  return Object.assign(new FakeAudio(), over) as unknown as HTMLMediaElement;
}

const guard = (over: Partial<FlushGuard> = {}): FlushGuard => ({
  lastFlushAt: null, dayKey: dayKeyOf(Date.now()), countToday: 0, ...over,
});

beforeEach(() => {
  resetFlightRecorder();
  try { sessionStorage.clear(); } catch { /* noop */ }
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('링버퍼', () => {
  it('용량을 넘기면 오래된 것부터 버린다 — 정지 직전이 가장 중요하다', () => {
    let buf: number[] = [];
    for (let i = 0; i < RING_CAPACITY + 25; i += 1) buf = pushRing(buf, i);
    expect(buf).toHaveLength(RING_CAPACITY);
    expect(buf[buf.length - 1]).toBe(RING_CAPACITY + 24);
    expect(buf[0]).toBe(25);
  });
});

describe('레이트 리밋', () => {
  it('10분 이내 재전송을 막는다', () => {
    const now = Date.UTC(2026, 8, 13, 5, 0, 0);
    const g = consumeFlush(guard({ dayKey: dayKeyOf(now) }), now);
    expect(canFlush(g, now + FLUSH_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(canFlush(g, now + FLUSH_MIN_INTERVAL_MS)).toBe(true);
  });

  it('하루 상한을 넘기면 막는다', () => {
    const now = Date.UTC(2026, 8, 13, 5, 0, 0);
    const g = guard({ dayKey: dayKeyOf(now), countToday: FLUSH_MAX_PER_DAY, lastFlushAt: null });
    expect(canFlush(g, now)).toBe(false);
  });

  it('날짜가 바뀌면 카운터가 풀린다', () => {
    const now = Date.UTC(2026, 8, 13, 5, 0, 0);
    const g = guard({ dayKey: '2026-09-12', countToday: FLUSH_MAX_PER_DAY, lastFlushAt: null });
    expect(canFlush(g, now)).toBe(true);
  });
});

describe('payload', () => {
  const entry = (seq: number): FlightEntry => ({
    seq, tMs: seq * 100, event: 'waiting', audioElementId: 'AO1',
    ct: 12.5, dur: 180, paused: false, ended: false, ready: 4, net: 2,
    bufLen: 1, bufStart: 0, bufEnd: 30, vol: 1, muted: false,
    trackId: 't1', queueIndex: 3, queueLength: 130,
    activeAudioElementId: 'AO1', crossfadeActive: false, recoveryLevel: null,
    vis: 'visible', online: true, standalone: false,
  });

  it('상한을 넘으면 오래된 것부터 자르고 dropped 를 남긴다', () => {
    const entries = Array.from({ length: 80 }, (_, i) => entry(i));
    const small = buildFlushPayload(entries, {
      trigger: 'recovery_level_1', playerInstanceId: 'pi', buildHash: 'abc',
    }, 2_000);
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(2_000);
    expect(small.dropped as number).toBeGreaterThan(0);
    // 남은 것은 가장 최근 구간이어야 한다.
    const kept = small.events as FlightEntry[];
    expect(kept[kept.length - 1].seq).toBe(79);
  });

  it('상한 안이면 그대로 담는다', () => {
    const payload = buildFlushPayload([entry(1), entry(2)], {
      trigger: 'media_error', playerInstanceId: 'pi', buildHash: 'abc',
    });
    expect(payload.count).toBe(2);
    expect(payload.dropped).toBe(0);
    expect(payload.trigger).toBe('media_error');
  });

  it('URL·토큰·개인정보가 들어갈 자리가 없다 — trackId 만 담는다', () => {
    const json = JSON.stringify(buildFlushPayload([entry(1)], {
      trigger: 'recovery_level_1', playerInstanceId: 'pi', buildHash: 'abc',
    }));
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toMatch(/token|jwt|bearer|email|@/i);
  });
});

describe('snapshotAudio', () => {
  it('버퍼 구간까지 읽는다 — buffer 고갈과 currentTime freeze 를 구분하기 위해', () => {
    const s = snapshotAudio(fakeEl({ currentTime: 12.3456, readyState: 4, networkState: 2 }));
    expect(s.ct).toBe(12.346);
    expect(s.ready).toBe(4);
    expect(s.net).toBe(2);
    expect(s.bufStart).toBe(0);
    expect(s.bufEnd).toBe(30);
  });

  it('엘리먼트가 없거나 접근이 실패해도 throw 하지 않는다', () => {
    expect(snapshotAudio(null).ct).toBeNull();
    const hostile = { get currentTime(): number { throw new Error('boom'); } } as unknown as HTMLMediaElement;
    expect(() => snapshotAudio(hostile)).not.toThrow();
    expect(snapshotAudio(hostile).ct).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('정상 재생 — 서버 전송 없음', () => {
  it('평상시에는 링버퍼에만 쌓이고 flush 는 호출되지 않는다', () => {
    initFlightRecorder('pi-1');
    const el = fakeEl();
    attachMediaEventRecorder(el, 'AO1');
    (el as unknown as FakeAudio).fire('loadstart');
    (el as unknown as FakeAudio).fire('loadedmetadata');
    (el as unknown as FakeAudio).fire('canplay');
    (el as unknown as FakeAudio).fire('playing');
    expect(getFlightBuffer().length).toBeGreaterThan(0);
    // 정상 흐름에서는 아무도 tryBuildFlush 를 부르지 않는다 — 여기서 확인하는 것은
    // "기록은 되지만 전송 트리거는 별개" 라는 구조 그 자체다.
    expect(getFlightBuffer().some((e) => e.event === 'playing')).toBe(true);
  });

  it('waiting → playing 을 모두 남긴다 (버퍼링 회복 추적)', () => {
    initFlightRecorder('pi-1');
    const el = fakeEl();
    attachMediaEventRecorder(el, 'AO1');
    (el as unknown as FakeAudio).fire('waiting');
    (el as unknown as FakeAudio).fire('stalled');
    (el as unknown as FakeAudio).fire('playing');
    const names = getFlightBuffer().map((e) => e.event);
    expect(names).toContain('waiting');
    expect(names).toContain('stalled');
    expect(names).toContain('playing');
  });

  it('관측 대상에 pause·suspend·abort·emptied·error 가 모두 들어 있다', () => {
    for (const n of ['waiting', 'stalled', 'pause', 'suspend', 'abort', 'emptied', 'error', 'playing']) {
      expect(OBSERVED_MEDIA_EVENTS).toContain(n);
    }
    // 고빈도 이벤트는 넣지 않는다 — 링버퍼가 순식간에 덮인다.
    expect(OBSERVED_MEDIA_EVENTS).not.toContain('timeupdate' as never);
    expect(OBSERVED_MEDIA_EVENTS).not.toContain('progress' as never);
  });
});

describe('정지 감지 → flush', () => {
  it('recovery level 1 에서 링버퍼 전체가 payload 로 나온다', () => {
    initFlightRecorder('pi-1');
    const el = fakeEl({ currentTime: 0, readyState: 2, networkState: 2 });
    attachMediaEventRecorder(el, 'AO1');
    (el as unknown as FakeAudio).fire('waiting');
    recordFlightEvent('STALL_SNAPSHOT', { el, audioElementId: 'AO1' });
    const payload = tryBuildFlush('recovery_level_1');
    expect(payload).not.toBeNull();
    expect((payload as Record<string, unknown>).trigger).toBe('recovery_level_1');
    expect((payload as { count: number }).count).toBeGreaterThanOrEqual(2);
  });

  it('두 번째 flush 는 10분 안에는 막힌다 (진단 폭주 방지)', () => {
    initFlightRecorder('pi-1');
    recordFlightEvent('STALL_SNAPSHOT');
    const t0 = Date.now();
    expect(tryBuildFlush('recovery_level_1', { now: t0 })).not.toBeNull();
    expect(tryBuildFlush('recovery_level_1', { now: t0 + 60_000 })).toBeNull();
    expect(tryBuildFlush('recovery_level_1', { now: t0 + FLUSH_MIN_INTERVAL_MS })).not.toBeNull();
  });

  it('레코더가 초기화되지 않았으면 조용히 null', () => {
    expect(tryBuildFlush('recovery_level_1')).toBeNull();
  });
});

describe('play() 계측 — 흐름 불변', () => {
  it('원본 Promise 를 그대로 돌려주고 resolve 를 기록한다', async () => {
    initFlightRecorder('pi-1');
    const original = Promise.resolve();
    const returned = observePlay(original, 'play-target');
    expect(returned).toBe(original);
    await returned;
    await Promise.resolve();
    const names = getFlightBuffer().map((e) => e.event);
    expect(names).toContain('PLAY_REQUEST');
    expect(names).toContain('PLAY_RESOLVED');
  });

  it('reject 를 기록하되 호출부의 catch 를 가로채지 않는다', async () => {
    initFlightRecorder('pi-1');
    const err = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    const original = Promise.reject(err);
    const returned = observePlay(original, 'play-target');
    expect(returned).toBe(original);
    await expect(returned).rejects.toBe(err);   // 호출부가 그대로 받는다
    await Promise.resolve();
    const rejected = getFlightBuffer().find((e) => e.event === 'PLAY_REJECTED');
    expect(rejected?.extra?.errName).toBe('NotAllowedError');
  });

  it('undefined 를 돌려주는 구형 브라우저에서도 안전하다', () => {
    initFlightRecorder('pi-1');
    expect(observePlay(undefined, 'legacy')).toBeUndefined();
  });
});

describe('pause() 호출자 추적', () => {
  it('내부 pause 는 PAUSE_REQUEST 를 남긴다', () => {
    initFlightRecorder('pi-1');
    recordPauseRequest('CROSSFADE', fakeEl(), 'AO1');
    const e = getFlightBuffer().find((x) => x.event === 'PAUSE_REQUEST');
    expect(e?.extra?.reason).toBe('CROSSFADE');
  });

  it('PAUSE_REQUEST 없이 pause 이벤트만 오면 외부 개입으로 분리된다', () => {
    initFlightRecorder('pi-1');
    const el = fakeEl();
    attachMediaEventRecorder(el, 'AO1');
    (el as unknown as FakeAudio).fire('pause');
    const buf = getFlightBuffer();
    expect(buf.some((e) => e.event === 'pause')).toBe(true);
    expect(buf.some((e) => e.event === 'PAUSE_REQUEST')).toBe(false);
  });
});

describe('인스턴스 식별', () => {
  it('Player 리마운트마다 다른 playerInstanceId', () => {
    const a = newPlayerInstanceId();
    const b = newPlayerInstanceId();
    expect(a).not.toBe(b);
    initFlightRecorder(a);
    expect(getPlayerInstanceId()).toBe(a);
    resetFlightRecorder();
    initFlightRecorder(b);
    expect(getPlayerInstanceId()).toBe(b);
  });

  it('audio A/B 는 서로 다른 audioElementId 로 기록된다', () => {
    initFlightRecorder('pi-1');
    const a = fakeEl();
    const b = fakeEl();
    attachMediaEventRecorder(a, 'AO-A');
    attachMediaEventRecorder(b, 'AO-B');
    (a as unknown as FakeAudio).fire('playing');
    (b as unknown as FakeAudio).fire('waiting');
    const ids = new Set(getFlightBuffer().map((e) => e.audioElementId));
    expect(ids.has('AO-A')).toBe(true);
    expect(ids.has('AO-B')).toBe(true);
  });

  it('detach 후에는 더 이상 기록하지 않는다 (리스너 누수 방지)', () => {
    initFlightRecorder('pi-1');
    const el = fakeEl();
    const detach = attachMediaEventRecorder(el, 'AO1');
    detach();
    const before = getFlightBuffer().length;
    (el as unknown as FakeAudio).fire('playing');
    expect(getFlightBuffer().length).toBe(before);
  });
});

describe('crossfade 시퀀스', () => {
  it('START → NEXT_PLAY_REQUEST → SWAP → COMPLETE 순서가 남는다', () => {
    initFlightRecorder('pi-1');
    recordFlightEvent('CROSSFADE_START', { extra: { fromTrackId: 't1', toTrackId: 't2' } });
    recordFlightEvent('CROSSFADE_NEXT_PLAY_REQUEST', { extra: { toTrackId: 't2' } });
    recordFlightEvent('CROSSFADE_SWAP', { extra: { toTrackId: 't2' } });
    recordFlightEvent('CROSSFADE_COMPLETE', { extra: { toTrackId: 't2' } });
    const names = getFlightBuffer().map((e) => e.event);
    expect(names).toEqual([
      'CROSSFADE_START', 'CROSSFADE_NEXT_PLAY_REQUEST', 'CROSSFADE_SWAP', 'CROSSFADE_COMPLETE',
    ]);
    // seq 는 단조 증가해야 사후 재구성이 가능하다.
    const seqs = getFlightBuffer().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});

describe('진단 실패가 재생을 막지 않는다', () => {
  it('문맥 공급자가 throw 해도 기록은 계속된다', () => {
    initFlightRecorder('pi-1');
    setFlightContextProvider(() => { throw new Error('boom'); });
    expect(() => recordFlightEvent('STALL_SNAPSHOT')).not.toThrow();
    expect(getFlightBuffer().length).toBe(1);
  });

  it('sessionStorage 가 막혀 있어도 flush 판정이 죽지 않는다', () => {
    // 사파리 프라이빗 / 저장소 차단 매장 기기를 흉내낸다.
    const g = globalThis as { sessionStorage?: unknown };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('quota'); },
        removeItem() { throw new Error('blocked'); },
        clear() { throw new Error('blocked'); },
      },
    });
    try {
      initFlightRecorder('pi-blocked-storage');
      recordFlightEvent('STALL_SNAPSHOT');
      expect(() => tryBuildFlush('recovery_level_1')).not.toThrow();
      expect(tryBuildFlush('media_error', { now: Date.now() + 1 })).toBeNull(); // 레이트 리밋은 메모리로 유지
    } finally {
      if (saved) Object.defineProperty(globalThis, 'sessionStorage', saved);
      else delete g.sessionStorage;
    }
  });

  it('리스너 부착이 실패해도 해제 함수는 안전하다', () => {
    initFlightRecorder('pi-1');
    const hostile = {
      addEventListener() { throw new Error('nope'); },
      removeEventListener() { /* noop */ },
    } as unknown as HTMLMediaElement;
    const detach = attachMediaEventRecorder(hostile, 'AO1');
    expect(() => detach()).not.toThrow();
  });
});
