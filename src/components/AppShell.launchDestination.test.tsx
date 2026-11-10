// @vitest-environment jsdom
/**
 * 설치형 앱 실행 목적지 — AppShell 배선 계약 테스트.
 *
 * 2026-10-06 숙대점: 매장 복귀(AppShell)와 브랜드 이동(App)이 서로 다른 effect 로 경쟁했고,
 * 먼저 실행된 매장 복귀가 이겨 브랜드 매장이 매일 아침 일반 매장 플레이어로 열렸다.
 * 순수 판정(resolveLaunchDestination)은 storePlaybackGate.test.ts 가 고정하고, 여기서는
 * 실제 AppShell 을 '/' 로 띄워 첫 이동이 그 판정 하나로만 정해지는지를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('./BottomNav', () => ({ default: () => null }));
vi.mock('./Sidebar', () => ({ default: () => null }));
vi.mock('./TopBar', () => ({ default: () => null }));
vi.mock('./TrialBanner', () => ({ default: () => null }));
vi.mock('./InstallPromptBanner', () => ({ default: () => null }));
vi.mock('./player/Player', () => ({ default: () => null }));
vi.mock('./ThemeQuickToggle', () => ({ default: () => null }));
vi.mock('./common/Footer', () => ({ default: () => null }));
vi.mock('./store/GlobalStoreAudioOverlays', () => ({ default: () => null }));
vi.mock('./RecoveryControlPlane', () => ({ default: () => null }));
vi.mock('@/lib/playerSession', () => ({
  restorePlayerSessionToStore: () => false,
  installPlayerSessionPersistence: () => () => {},
  revalidateRestoredQueue: () => Promise.resolve(),
}));
vi.mock('@/store/brandStore', () => ({
  useBrandStore: (sel: (s: { load: () => Promise<void> }) => unknown) => sel({ load: () => Promise.resolve() }),
}));
vi.mock('@/hooks/useAudioOutputAutoRestore', () => ({ useAudioOutputAutoRestore: () => {} }));

const env = { standalone: true, businessMode: true, membership: 'premium' as string };
vi.mock('@/hooks/useInstallPrompt', () => ({ isStandalone: () => env.standalone }));
vi.mock('@/store/businessStore', () => ({
  useBusinessStore: (sel: (s: { businessMode: boolean }) => unknown) => sel({ businessMode: env.businessMode }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { session: null; profile: null }) => unknown) => sel({ session: null, profile: null }),
}));
vi.mock('@/lib/membership', () => ({ resolveMembership: () => env.membership }));

import AppShell from './AppShell';

const BRAND = '682c08e1-55b7-4324-8572-39afabfe6519';

function saveBinding() {
  localStorage.setItem('srr.brand.binding.' + BRAND, 'tok');
  localStorage.setItem('srr.brand.recent', JSON.stringify([{ id: BRAND, name: '카공시대', ts: 1 }]));
}

let seen: string[] = [];
function PathProbe() {
  const { pathname } = useLocation();
  seen.push(pathname);
  return null;
}

function launch(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<PathProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return seen[seen.length - 1];
}

describe('AppShell 설치형 앱 실행 목적지', () => {
  beforeEach(() => {
    localStorage.clear();
    seen = [];
    Object.assign(env, { standalone: true, businessMode: true, membership: 'premium' });
  });
  afterEach(() => cleanup());

  it('1) 숙대점 회귀: 매장 모드 + premium + 브랜드 연결 → 브랜드 플레이어, 매장 플레이어를 거치지 않는다', () => {
    saveBinding();
    expect(launch()).toBe(`/brand/player/${BRAND}`);
    expect(seen).not.toContain('/business/player');
  });

  it('2) 매장 모드 아님 + 브랜드 연결 → 브랜드 플레이어', () => {
    saveBinding();
    env.businessMode = false;
    expect(launch()).toBe(`/brand/player/${BRAND}`);
  });

  it('3) 브랜드 연결 없음 + 매장 모드 + premium → 매장 플레이어 (기존 동작)', () => {
    expect(launch()).toBe('/business/player');
  });

  it('4) 브라우저 탭은 그대로 둔다', () => {
    saveBinding();
    env.standalone = false;
    expect(launch()).toBe('/');
  });

  it('5) "/" 가 아닌 진입은 덮어쓰지 않는다', () => {
    saveBinding();
    expect(launch('/business')).toBe('/business');
  });

  it('브랜드 연결 기록만 있고 binding 토큰이 없으면 매장 복귀로 간다', () => {
    localStorage.setItem('srr.brand.recent', JSON.stringify([{ id: BRAND, name: '카공시대', ts: 1 }]));
    expect(launch()).toBe('/business/player');
  });
});
