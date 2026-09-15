import { describe, it, expect } from 'vitest';
import {
  sidebarNavItems,
  bottomNavItems,
  nativeMenuSections,
  type NavContext,
  type MenuContext,
} from './appNav';

const web: NavContext = { native: false, isCurator: false, storeAccount: false, hasBrand: false };

const menuBase: MenuContext = {
  ...web,
  native: true,
  signedIn: true,
  isAdmin: false,
  isArtist: false,
  isSalesAgent: false,
  isEnterpriseHq: false,
};

/** 섹션을 평평하게 편 경로 목록 — "이 화면에 닿을 수 있는가" 검사용. */
function menuPaths(ctx: MenuContext): string[] {
  return nativeMenuSections(ctx).flatMap((s) => s.items.map((i) => i.to));
}

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

  it('웹에는 더보기가 없다 — 사이드바가 전체 메뉴 역할을 한다', () => {
    expect(bottomNavItems(web).some((i) => i.action === 'more')).toBe(false);
  });

  it('앱 + 매장 계정이면 브랜드·매장이 앞에 나란히 온다', () => {
    // 브랜드 담당자가 매장을 같이 보는 경우가 많다 — 한쪽이 더보기 안에 있으면
    // 오갈 때마다 두 번 눌러야 한다.
    const items = bottomNavItems({ ...web, native: true, storeAccount: true });
    expect(items.map((i) => i.to)).toContain('/brand');
    expect(items.map((i) => i.to)).toContain('/business');
  });

  it('브랜드가 묶인 기기도 같은 목록 — 브랜드가 첫 칸', () => {
    const items = bottomNavItems({ ...web, native: true, hasBrand: true });
    expect(items[0].to).toBe('/brand');
  });

  it('매장/브랜드 하단탭에는 보관함이 없다 — 더보기로 옮겼다', () => {
    // 매장에 걸어둔 기기에서 내 보관함을 여는 일은 거의 없다.
    const items = bottomNavItems({ ...web, native: true, storeAccount: true });
    expect(items.map((i) => i.to)).not.toContain('/library');
  });

  it('빠진 보관함은 더보기 시트에 그대로 있다', () => {
    const all = nativeMenuSections({ ...menuBase, signedIn: true }).flatMap((s) => s.items);
    expect(all.map((i) => i.to)).toContain('/library');
  });

  it('앱이라도 매장/브랜드가 아니면 홈이 첫 칸 — 다만 매장은 남는다', () => {
    // 매장을 빼면 로그인 전(profile 없음) 점주가 가입 동선을 못 찾는다.
    expect(bottomNavItems({ ...web, native: true }).map((i) => i.to)).toEqual([
      '/', '/business', '/search', '/library', '#more',
    ]);
  });

  it('앱 하단탭의 마지막 칸은 항상 더보기 — 나머지 화면으로 가는 유일한 통로', () => {
    for (const storeAccount of [true, false]) {
      for (const hasBrand of [true, false]) {
        const items = bottomNavItems({ ...web, native: true, storeAccount, hasBrand });
        expect(items).toHaveLength(5);
        expect(items[items.length - 1].action).toBe('more');
      }
    }
  });

  it('항목 경로가 중복되지 않는다 (NavLink key 충돌 방지)', () => {
    for (const native of [true, false]) {
      for (const storeAccount of [true, false]) {
        for (const hasBrand of [true, false]) {
          const items = bottomNavItems({ ...web, native, storeAccount, hasBrand });
          expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
        }
      }
    }
  });
});

describe('nativeMenuSections', () => {
  it('브랜드 플레이어는 항상 닿을 수 있다', () => {
    // 앱에 사이드바가 없어서, 기기에 브랜드가 안 묶여 있으면 브랜드 화면에
    // 갈 방법이 아예 없었다. 전체 메뉴는 그 통로다.
    expect(menuPaths(menuBase)).toContain('/brand');
    expect(menuPaths({ ...menuBase, storeAccount: true })).toContain('/brand');
  });

  it('매장·결제 화면도 전체 메뉴에서 닿는다', () => {
    const paths = menuPaths({ ...menuBase, storeAccount: true });
    expect(paths).toContain('/business');
    expect(paths).toContain('/pricing');
    expect(paths).toContain('/subscription');
  });

  it('역할이 없으면 운영 섹션 자체가 없다', () => {
    expect(nativeMenuSections(menuBase).some((s) => s.title === '운영')).toBe(false);
  });

  it.each([
    ['isAdmin', '/admin'],
    ['isArtist', '/artist'],
    ['isSalesAgent', '/sales'],
    ['isEnterpriseHq', '/enterprise/hq'],
  ] as const)('%s 인 사람에게만 %s 가 보인다', (flag, path) => {
    expect(menuPaths(menuBase)).not.toContain(path);
    expect(menuPaths({ ...menuBase, [flag]: true })).toContain(path);
  });

  it('로그인 전에는 개인 영역을 감추되 음악과 안내는 남긴다', () => {
    const paths = menuPaths({ ...menuBase, signedIn: false });
    expect(paths).toContain('/business');
    expect(paths).toContain('/terms');
    expect(paths).not.toContain('/subscription');
    expect(paths).not.toContain('/library');
  });

  it('약관·개인정보 링크가 있다 (스토어 심사 요건)', () => {
    const paths = menuPaths(menuBase);
    expect(paths).toContain('/terms');
    expect(paths).toContain('/privacy');
  });

  it('같은 섹션 안에서 경로가 중복되지 않는다', () => {
    for (const section of nativeMenuSections({ ...menuBase, isAdmin: true, isArtist: true, isSalesAgent: true, isEnterpriseHq: true, isCurator: true })) {
      expect(new Set(section.items.map((i) => i.to)).size).toBe(section.items.length);
    }
  });
});

describe('하단탭 — 매장 계정은 화면 크기와 무관하게 같은 목록', () => {
  const store: NavContext = { native: true, isCurator: false, storeAccount: true, hasBrand: false };

  it('브랜드·매장이 앞, 홈은 더보기로 밀린다', () => {
    // 점주가 매장 태블릿과 자기 폰을 번갈아 쓴다 — 기기마다 탭 자리가 다르면
    // 매번 눈으로 찾아야 한다. 그래서 폰/태블릿을 일부러 같게 뒀다.
    expect(bottomNavItems(store).map((i) => i.to)).toEqual([
      '/brand', '/business', '/search', '/profile', '#more',
    ]);
  });

  it('홈은 하단탭에 없지만 더보기 시트에서 닿는다', () => {
    expect(bottomNavItems(store).map((i) => i.to)).not.toContain('/');
    const all = nativeMenuSections({ ...menuBase, storeAccount: true }).flatMap((s) => s.items);
    expect(all.map((i) => i.to)).toContain('/');
  });

  it('브랜드만 묶인 기기도 같은 목록', () => {
    const brandOnly = { ...store, storeAccount: false, hasBrand: true };
    expect(bottomNavItems(brandOnly).map((i) => i.to)).toEqual(bottomNavItems(store).map((i) => i.to));
  });

  it('5칸을 유지한다', () => {
    expect(bottomNavItems(store)).toHaveLength(5);
  });
});
