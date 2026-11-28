// 이루밍 2026-11-27/28 재발 방지 — 아이폰 웹에서 자동 새로고침이 다시 생기지 않게 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('아이폰 웹 자동 새로고침 방지', () => {
  it('업데이트 적용 판단에 reloadLosesAutoplay 와 재생 의도를 넘긴다', () => {
    const main = read('main.tsx');
    expect(main).toMatch(/autoplayTrusted:\s*autoplayTrusted\(\)\s*&&\s*!reloadLosesAutoplay\(\)/);
    expect(main).toMatch(/playbackIntent:\s*usePlayerStore\.getState\(\)\.playing/);
  });
  it('자동 복구의 페이지 재시작 전에 아이폰 웹은 같은 문서 안 복구를 되감는다', () => {
    const player = read('components/player/Player.tsx');
    expect(player).toMatch(/action === 'reload_page' && reloadLosesAutoplay\(\)/);
    expect(player).toContain('GESTURE_RELOAD_SUPPRESSED');
  });
  it('터치로 막힘이 풀리면 정지 시계를 되감는다', () => {
    const player = read('components/player/Player.tsx');
    expect(player).toMatch(/wasAutoplayBlockedRef\.current && !blockedNow/);
  });
});
