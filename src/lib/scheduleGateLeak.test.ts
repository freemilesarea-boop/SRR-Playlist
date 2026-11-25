/**
 * 재생 게이트 누수 회귀 — "홈에서 플레이리스트를 눌러도 재생이 안 되고,
 * 앱을 껐다 켜야 다시 된다" 의 원인.
 *
 * scheduleSuppressed 는 매장/브랜드 영업시간 게이트인데 playerStore 의 **전역**
 * 상태다. 영업시간 밖에 브랜드 플레이어를 열면 'closed' 로 잠기고, 그 상태로
 * 홈에 나오면 잠금이 따라나온다. 그러면:
 *   • setQueue 가 playing: !scheduleSuppressed → false 로 큐만 깔고 정지
 *   • 재생 버튼을 눌러도 play() 가 게이트에서 바로 돌아섬
 * 스토어 초기값이 false 라 앱 재시작이 곧 유일한 복구 수단이었다.
 *
 * 아래 두 가지를 못 박는다: 게이트의 동작(의도된 것)과, 페이지를 떠날 때
 * 반드시 푼다는 것(빠져 있던 것).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usePlayerStore } from '@/store/playerStore';

const repo = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const track = (id: string) => ({
  id,
  title: `t-${id}`,
  audio_url: `https://example.com/${id}.mp3`,
}) as never;

describe('게이트가 걸리면 재생이 막힌다 (의도된 동작)', () => {
  beforeEach(() => {
    usePlayerStore.getState().setScheduleSuppression(null);
    usePlayerStore.setState({ queue: [], index: 0, playing: false });
  });

  it('게이트가 없으면 setQueue 가 재생을 시작한다', () => {
    usePlayerStore.getState().setQueue([track('a'), track('b')], 0);
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it('게이트가 걸리면 큐만 깔리고 멈춰 있다', () => {
    usePlayerStore.getState().setScheduleSuppression('closed');
    usePlayerStore.getState().setQueue([track('a'), track('b')], 0);
    expect(usePlayerStore.getState().queue).toHaveLength(2);
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it('게이트가 걸린 동안에는 play() 도 먹지 않는다', () => {
    usePlayerStore.getState().setScheduleSuppression('closed');
    usePlayerStore.getState().setQueue([track('a')], 0);
    usePlayerStore.getState().play();
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it('게이트를 풀면 바로 재생된다 — 앱 재시작이 필요하지 않다', () => {
    usePlayerStore.getState().setScheduleSuppression('closed');
    usePlayerStore.getState().setQueue([track('a')], 0);
    usePlayerStore.getState().setScheduleSuppression(null);
    usePlayerStore.getState().play();
    expect(usePlayerStore.getState().playing).toBe(true);
  });
});

describe('게이트를 거는 모든 훅은 떠날 때 푼다', () => {
  // 게이트를 거는 곳은 이 둘뿐이다. 새로 생기면 아래 목록과 함께 cleanup 도 같이 와야 한다.
  const GATING_HOOKS = [
    'src/hooks/useStorePlaybackPolicy.ts',
    'src/hooks/useBrandDailyPlaylistSync.ts',
  ] as const;

  it.each(GATING_HOOKS)('%s 가 cleanup 에서 게이트를 푼다', (file) => {
    const src = repo(file);
    expect(src).toContain("setScheduleSuppression('closed')".slice(0, 22)); // 게이트를 거는 훅이 맞는지
    // () => () => { ... setScheduleSuppression(null) } 형태의 해제 cleanup 이 있어야 한다.
    expect(src).toMatch(/\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]{0,200}setScheduleSuppression\(null\)/);
  });

  // 게이트를 건드리는 파일이 늘면 사람이 한 번 봐야 한다. 거는 쪽이면 cleanup 이
  // 따라와야 하고, 푸는 쪽이면 왜 거기서 푸는지가 설명돼야 한다.
  it('게이트를 건드리는 파일이 알려진 목록 밖에 새로 생기지 않았다', () => {
    const KNOWN = [
      ...GATING_HOOKS,
      'src/pages/BrandPlayerPage.tsx',   // 진입 시 선대 게이트를 푼다
      'src/store/playerStore.ts',        // 게이트 자체의 정의
    ];
    const root = fileURLToPath(new URL('../', import.meta.url));
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = `${dir}${name}`;
        if (statSync(full).isDirectory()) { walk(`${full}/`); continue; }
        if (!/\.tsx?$/.test(name) || name.includes('.test.')) continue;
        if (/setScheduleSuppression/.test(readFileSync(full, 'utf8'))) {
          found.push(`src/${full.slice(root.length)}`);
        }
      }
    };
    walk(root);
    expect(found.sort()).toEqual(KNOWN.sort());
  });
});
