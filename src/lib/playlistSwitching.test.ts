/**
 * 플레이리스트 전환 시나리오 — 스토어 수준 불변식.
 *
 * 실기기에서만 나는 오디오 엘리먼트 경합은 여기서 재현할 수 없다. 하지만
 * "큐·인덱스·재생의도" 가 전환 과정에서 어긋나는지는 여기서 전부 잡을 수 있고,
 * 어긋난 적이 있다면 엘리먼트 쪽 증상의 절반은 여기서 시작된 것이다.
 *
 * 불변식 (매 단계 후):
 *   • index 가 큐 범위 안에 있다
 *   • queue[index] 가 존재한다 (currentTrack 이 undefined 가 아니다)
 *   • 재생 의도가 있으면 큐가 비어 있지 않다
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '@/store/playerStore';

const mk = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} ${i}`,
    audio_url: `https://example.com/${prefix}-${i}.mp3`,
  })) as never[];

const A = mk('a', 5);
const B = mk('b', 4);
const C = mk('c', 3);

function invariants(label: string): void {
  const s = usePlayerStore.getState();
  expect(s.index, `${label}: index >= 0`).toBeGreaterThanOrEqual(0);
  if (s.queue.length > 0) {
    expect(s.index, `${label}: index 가 큐 범위 안`).toBeLessThan(s.queue.length);
    expect(s.queue[s.index], `${label}: currentTrack 존재`).toBeDefined();
  }
  if (s.playing) {
    expect(s.queue.length, `${label}: 재생 의도가 있는데 큐가 비었다`).toBeGreaterThan(0);
  }
}

describe('플레이리스트 전환', () => {
  beforeEach(() => {
    usePlayerStore.getState().setScheduleSuppression(null);
    usePlayerStore.setState({ queue: [], index: 0, playing: false, shuffle: false });
  });

  it('1. 홈 플레이리스트 A 재생', () => {
    usePlayerStore.getState().setQueue(A, 0);
    invariants('A');
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(usePlayerStore.getState().queue[0].id).toBe('a-0');
  });

  it('2. A → B', () => {
    usePlayerStore.getState().setQueue(A, 0); invariants('A');
    usePlayerStore.getState().setQueue(B, 0); invariants('B');
    expect(usePlayerStore.getState().queue[0].id).toBe('b-0');
    // 이전 플레이리스트가 큐에 남으면 안 된다.
    expect(usePlayerStore.getState().queue.some((t) => t.id.startsWith('a-'))).toBe(false);
  });

  it('3. A → B → C 빠른 전환', () => {
    for (const [n, q] of [['A', A], ['B', B], ['C', C]] as const) {
      usePlayerStore.getState().setQueue(q as never[], 0);
      invariants(n);
    }
    expect(usePlayerStore.getState().queue).toHaveLength(C.length);
    expect(usePlayerStore.getState().index).toBe(0);
  });

  it('4. 재생 중 다른 화면을 거쳐 다른 플레이리스트', () => {
    usePlayerStore.getState().setQueue(A, 2); invariants('A@2');
    // 라우트 이동은 스토어를 건드리지 않는다 — 큐가 그대로 살아 있어야 한다.
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('a-2');
    usePlayerStore.getState().setQueue(B, 1); invariants('B@1');
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('b-1');
  });

  it('6. pause → 다른 플레이리스트면 다시 재생 의도가 선다', () => {
    usePlayerStore.getState().setQueue(A, 0);
    usePlayerStore.getState().pause();
    expect(usePlayerStore.getState().playing).toBe(false);
    usePlayerStore.getState().setQueue(B, 0);
    expect(usePlayerStore.getState().playing).toBe(true);
    invariants('B after pause');
  });

  it('11. 게이트가 걸렸다 풀리면 일반 플레이리스트가 정상 재생된다', () => {
    usePlayerStore.getState().setScheduleSuppression('closed');
    usePlayerStore.getState().setQueue(A, 0);
    expect(usePlayerStore.getState().playing).toBe(false);   // 게이트 중
    usePlayerStore.getState().setScheduleSuppression(null);  // 페이지 이탈 cleanup
    usePlayerStore.getState().setQueue(B, 0);
    expect(usePlayerStore.getState().playing).toBe(true);
    invariants('after gate release');
  });

  it('12. 20회 연속 교체 후에도 상태가 어긋나지 않는다', () => {
    const sets = [A, B, C];
    for (let i = 0; i < 20; i++) {
      const q = sets[i % sets.length];
      usePlayerStore.getState().setQueue(q, i % q.length);
      invariants(`switch#${i}`);
    }
    const s = usePlayerStore.getState();
    expect(s.queue[s.index]).toBeDefined();
    expect(s.playing).toBe(true);
  });

  it('큐 세대(generation)가 교체마다 올라간다 — 이전 큐의 지연 콜백 무효화', () => {
    const g0 = usePlayerStore.getState().queueGeneration;
    usePlayerStore.getState().setQueue(A, 0);
    usePlayerStore.getState().setQueue(B, 0);
    expect(usePlayerStore.getState().queueGeneration).toBe(g0 + 2);
  });

  it('재생 불가 트랙만 있는 플레이리스트는 큐를 망가뜨리지 않는다', () => {
    usePlayerStore.getState().setQueue(A, 0);
    const before = usePlayerStore.getState().queue;
    usePlayerStore.getState().setQueue([{ id: 'x', title: 'x', audio_url: null }] as never[], 0);
    // 큐 변경 없이 정지만 — 빈 큐로 덮어쓰면 플레이어가 통째로 죽는다.
    expect(usePlayerStore.getState().queue).toBe(before);
    expect(usePlayerStore.getState().playing).toBe(false);
    invariants('unplayable');
  });
});
