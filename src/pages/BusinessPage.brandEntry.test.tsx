// @vitest-environment jsdom
/**
 * 브랜드 플레이어 진입 동선 — hotfix 계약 테스트.
 *
 * 배경: '브랜드' 항목은 데스크톱 Sidebar(lg 이상)에만 있었고 BottomNav 에는 없다.
 * 그래서 모바일/태블릿을 쓰는 매장 점주에게는 /brand 로 갈 UI 동선이 아예 없었다.
 * 이 테스트는 새로 넣은 /business CTA 와, 손대지 않기로 한 기존 동선 둘 다를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

// --- BusinessPage 의 무거운 자식/외부 의존은 전부 끊는다 (진입 CTA 만 검증한다) ---
vi.mock('@/components/BusinessScheduler', () => ({ default: () => null }));
vi.mock('@/components/BusinessQRSection', () => ({ default: () => null }));
vi.mock('@/components/HomeRecommendation', () => ({ default: () => null }));
vi.mock('@/components/PlaylistRow', () => ({ default: () => null }));
vi.mock('@/components/AutoCover', () => ({ default: () => null }));
vi.mock('@/components/SupportInquiryButton', () => ({ default: () => null }));
vi.mock('@/components/ThemeQuickToggle', () => ({ default: () => null }));
vi.mock('@/lib/api', () => ({ fetchPlaylistCounts: () => Promise.resolve(new Map()) }));
vi.mock('@/lib/businessSchedulerApi', () => ({
  getCurrentSchedule: () => null,
  getNextSchedule: () => null,
  formatSlotTime: () => '',
}));
vi.mock('@/lib/kakao', () => ({
  isKakaoChannelConfigured: () => false,
  openKakaoChannelChat: () => Promise.resolve(),
}));
vi.mock('@/store/toastStore', () => ({ toast: { info: () => {}, error: () => {} } }));
vi.mock('@/hooks/useBusinessAutoSwitch', () => ({ useBusinessAutoSwitch: () => {} }));
vi.mock('@/hooks/useStartBusinessMode', () => ({
  useStartBusinessMode: () => () => Promise.resolve(),
}));

/** zustand 훅 흉내 — `useX()` 와 `useX(selector)` 두 호출 형태를 모두 받는다. */
function storeHook<T>(state: T) {
  return (sel?: (s: T) => unknown) => (sel ? sel(state) : state);
}
vi.mock('@/store/businessStore', () => ({
  useBusinessStore: storeHook({
    businessMode: false,
    selectedCategory: null,
    setCategory: () => {},
    setBusinessMode: () => {},
  }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: storeHook({
    profile: { subscription_type: 'business', is_curator: false },
    user: { id: 'u1' },
  }),
}));
vi.mock('@/store/playerStore', () => ({
  usePlayerStore: storeHook({ playing: false, pause: () => {}, queue: [] }),
}));
vi.mock('@/store/businessScheduleStore', () => ({
  useBusinessScheduleStore: storeHook({
    schedules: [],
    profile: null,
    playlists: [],
    loading: false,
    tick: 0,
    tracksLoading: false,
    refresh: () => Promise.resolve(),
  }),
}));

const { default: BusinessPage } = await import('./BusinessPage');
const { default: Sidebar } = await import('@/components/Sidebar');
const { default: BottomNav } = await import('@/components/BottomNav');
const { default: TopBar } = await import('@/components/TopBar');

beforeEach(() => navigateMock.mockReset());
afterEach(() => cleanup());

function renderAt(ui: React.ReactElement, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('/business 브랜드 플레이어 CTA', () => {
  it('매장 화면에 브랜드 플레이어 진입 CTA 가 있다', () => {
    renderAt(<BusinessPage />, '/business');
    expect(screen.getByRole('button', { name: /브랜드 플레이어 열기/ })).toBeTruthy();
  });

  it('CTA 를 누르면 /brand 로 간다 — 다른 경로를 만들지 않는다', () => {
    renderAt(<BusinessPage />, '/business');
    fireEvent.click(screen.getByRole('button', { name: /브랜드 플레이어 열기/ }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/brand');
  });

  it('CTA 가 뷰포트 폭으로 숨겨지지 않는다 — 모바일/태블릿에서 보여야 한다', () => {
    renderAt(<BusinessPage />, '/business');
    const cta = screen.getByRole('button', { name: /브랜드 플레이어 열기/ });
    const cls = cta.className;
    expect(cls).not.toMatch(/(^|\s)hidden(\s|$)/);
    // sm:/md:/lg:/xl: 접두 responsive 표시 전환이 걸려 있으면 폭에 따라 사라질 수 있다.
    expect(cls).not.toMatch(/(sm|md|lg|xl|2xl):(hidden|block|flex|inline-flex)/);
  });
});

describe('기존 진입 동선 — 이번 hotfix 에서 건드리지 않는다', () => {
  it('데스크톱 Sidebar 의 브랜드 → /brand 링크가 그대로 있다', () => {
    renderAt(<Sidebar />, '/');
    const link = screen.getByRole('link', { name: /브랜드/ });
    expect(link.getAttribute('href')).toBe('/brand');
  });

  it('BottomNav 는 5개 항목 그대로이고 브랜드를 추가하지 않는다', () => {
    renderAt(<BottomNav />, '/');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/', '/charts', '/library', '/business', '/profile',
    ]);
    expect(screen.queryByRole('link', { name: /브랜드/ })).toBeNull();
  });
});

describe('TopBar breadcrumb 매핑', () => {
  it('/brand 에서 제목이 브랜드 로 나온다', () => {
    renderAt(<TopBar />, '/brand');
    expect(screen.getByText('브랜드')).toBeTruthy();
  });

  it('/business 매핑은 그대로 매장 모드 다', () => {
    renderAt(<TopBar />, '/business');
    expect(screen.getByText('매장 모드')).toBeTruthy();
  });
});
