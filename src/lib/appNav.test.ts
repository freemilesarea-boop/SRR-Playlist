import { describe, it, expect } from 'vitest';
import { sidebarNavItems, bottomNavItems, type NavContext } from './appNav';

const web: NavContext = { native: false, isCurator: false, storeAccount: false, hasBrand: false };

describe('sidebarNavItems', () => {
  it('웹 메뉴는 그대로다 (회귀 0)', () => {
    expect(sidebarNavItems(web).map((i) => i.to)).toEqual([
      '/', '/search', '/charts', '/library', '/my/playlists', '/pricing', '/business', '/brand', '/profile',
    ]);
  });

  it('큐레이터에게만 스튜디오가 붙는다', () => {
    expect(sidebarNavItems(web).some((i) => i.to === '/curator/studio')).toBe(false);
    expect(sidebarNavItems({ ...web, isCurator: true }).some((i) => i.to === '/curator/studio')).toBe(true);
  });
});

describe('bottomNavItems', () => {
  it('웹 하단탭은 그대로다 (회귀 0)', () => {
    expect(bottomNavItems(web).map((i) => i.to)).toEqual(['/', '/charts', '/library', '/business', '/profile']);
  });

  it('앱 + 매장 계정이면 매장이 첫 칸', () => {
    // 태블릿을 켠 사람이 가장 먼저 누르는 것이 매장이다.
    const items = bottomNavItems({ ...web, native: true, storeAccount: true });
    expect(items[0].to).toBe('/business');
  });

  it('앱에서 브랜드가 묶여 있으면 브랜드 탭이 생긴다', () => {
    const items = bottomNavItems({ ...web, native: true, storeAccount: true, hasBrand: true });
    expect(items.map((i) => i.to)).toContain('/brand');
    expect(items[0].to).toBe('/business');
  });

  it('앱이라도 매장/브랜드가 아니면 홈이 첫 칸 — 다만 매장은 남는다', () => {
    // 앱을 개인 감상용으로 깐 사람에게 매장을 첫 칸에 두면 헷갈린다.
    // 그렇다고 매장을 빼면, 로그인 전(profile 없음) 점주가 가입 동선을 못 찾는다.
    expect(bottomNavItems({ ...web, native: true }).map((i) => i.to)).toEqual([
      '/', '/business', '/search', '/library', '/profile',
    ]);
  });

  it('어떤 조합에서도 매장 탭은 사라지지 않는다', () => {
    for (const native of [true, false]) {
      for (const storeAccount of [true, false]) {
        for (const hasBrand of [true, false]) {
          const items = bottomNavItems({ native, storeAccount, hasBrand, isCurator: false });
          expect(items.map((i) => i.to)).toContain('/business');
        }
      }
    }
  });

  it('하단탭은 어떤 조합에서도 5칸을 넘지 않는다', () => {
    for (const native of [true, false]) {
      for (const storeAccount of [true, false]) {
        for (const hasBrand of [true, false]) {
          for (const isCurator of [true, false]) {
            const n = bottomNavItems({ native, storeAccount, hasBrand, isCurator }).length;
            expect(n).toBeGreaterThan(0);
            expect(n).toBeLessThanOrEqual(5);
          }
        }
      }
    }
  });

  it('항목 경로가 중복되지 않는다 (NavLink key 충돌 방지)', () => {
    const items = bottomNavItems({ ...web, native: true, storeAccount: true, hasBrand: true });
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
  });
});
