import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { usePlayerStore, NEXT_MIN_INTERVAL_MS, resetNextThrottleForTest } from '@/store/playerStore';

/**
 * "한 곡 넘겼는데 여러 곡이 한꺼번에 넘어감" 회귀 방지.
 *
 * next() 를 부르는 곳이 여럿이라(버튼·알림 미디어 컨트롤·자연 종료·crossfade 완료·
 * 오류 자동 건너뛰기) 둘이 겹치면 index 가 두 번 올라간다.
 */
const track = (id: string) => ({ id, title: id, audio_url: `https://x/${id}.mp3` }) as never;

describe('next() 연속 호출 차단', () => {
  beforeEach(() => {
    resetNextThrottleForTest();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePlayerStore.setState({
      queue: [track('a'), track('b'), track('c'), track('d')],
      index: 0, shuffle: false, shuffleOrder: [], repeat: 'off', playing: true,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('한 번 부르면 한 곡만 넘어간다', () => {
    usePlayerStore.getState().next();
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('같은 순간에 두 번 들어오면 두 번째는 버린다', () => {
    const s = usePlayerStore.getState();
    s.next();
    s.next();
    s.next();
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('원인이 달라도 막는다 — 버튼 + 자연 종료가 겹치는 경우', () => {
    const s = usePlayerStore.getState();
    s.next({ cause: 'manual_next' });
    s.next({ cause: 'audio_ended' });
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('간격이 벌어지면 정상 동작한다', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      usePlayerStore.getState().next();
      vi.setSystemTime(new Date(Date.now() + NEXT_MIN_INTERVAL_MS + 10));
      usePlayerStore.getState().next();
      expect(usePlayerStore.getState().index).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('사람이 일부러 두 번 누를 수 있을 만큼은 짧아야 한다', () => {
    // 너무 길면 "두 곡 건너뛰기"가 막힌다. 기계 중복(수십 ms)만 걸러야 한다.
    expect(NEXT_MIN_INTERVAL_MS).toBeLessThanOrEqual(500);
    expect(NEXT_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(200);
  });
});

describe('볼륨 복구', () => {
  it('0 일 때만이 아니라 설정값과 어긋나면 되돌린다', () => {
    // crossfade 가 중간에 끊기면 0 이 아니라 0.2 같은 값으로 남는다.
    // 그러면 슬라이더는 100% 인데 소리만 작다.
    const src = readFileSync(resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf8');
    // 재생 시작 시점(play 직후)과 heartbeat 두 곳 모두에서 본다.
    expect(src).toContain('Math.abs(audio.volume - storeVol) > 0.01');
    expect(src).toContain('Math.abs(audio.volume - volume) > 0.01');
    // 0 일 때만 보던 옛 조건은 남아 있으면 안 된다.
    expect(src).not.toMatch(/if \(audio\.volume === 0 && !crossfading\)/);
  });
});
