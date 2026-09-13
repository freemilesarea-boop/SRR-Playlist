import { describe, it, expect } from 'vitest';
import {
  routeTransitionClass,
  shouldScrollToTop,
  PUSH_CLASS,
  POP_CLASS,
} from '@/lib/routeTransition';

describe('routeTransitionClass', () => {
  it('앱에서 앞으로 가면 오른쪽에서 들어온다', () => {
    expect(routeTransitionClass({ navigationType: 'PUSH', native: true })).toBe(PUSH_CLASS);
  });

  it('앱에서 뒤로 가면 왼쪽에서 들어온다', () => {
    expect(routeTransitionClass({ navigationType: 'POP', native: true })).toBe(POP_CLASS);
  });

  it('REPLACE 는 움직이지 않는다 — 방향이 없는 이동이라 흔들림으로만 보인다', () => {
    expect(routeTransitionClass({ navigationType: 'REPLACE', native: true })).toBeNull();
  });

  it('웹에서는 붙이지 않는다 — 브라우저 뒤로가기와 충돌한다', () => {
    expect(routeTransitionClass({ navigationType: 'PUSH', native: false })).toBeNull();
    expect(routeTransitionClass({ navigationType: 'POP', native: false })).toBeNull();
  });

  it('애니메이션 줄이기를 켠 사용자에게는 붙이지 않는다', () => {
    expect(
      routeTransitionClass({ navigationType: 'PUSH', native: true, reducedMotion: true }),
    ).toBeNull();
  });
});

describe('shouldScrollToTop', () => {
  it('새 화면으로 갈 때만 맨 위로 올린다', () => {
    expect(shouldScrollToTop('PUSH')).toBe(true);
  });

  it('뒤로 갈 때는 올리지 않는다 — 보던 목록의 자리를 잃으면 안 된다', () => {
    expect(shouldScrollToTop('POP')).toBe(false);
  });

  it('REPLACE 도 올리지 않는다 — 같은 화면을 갈아끼우는 것이다', () => {
    expect(shouldScrollToTop('REPLACE')).toBe(false);
  });
});
