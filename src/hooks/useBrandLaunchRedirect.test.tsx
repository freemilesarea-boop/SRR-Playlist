// @vitest-environment jsdom
/**
 * 설치형 앱 실행 시 브랜드 플레이어 자동 진입 — 계약 테스트.
 * 배경: 숙대점 PC 에서 설치형 앱이 '/' 로 떠 일반 재생이 브랜드 재생을 밀어냈다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

const standaloneMock = vi.fn(() => true);
vi.mock('@/lib/inAppBrowser', () => ({ isPwaStandalone: () => standaloneMock() }));

const BRAND = '682c08e1-55b7-4324-8572-39afabfe6519';

function saveBinding() {
  localStorage.setItem('srr.brand.binding.' + BRAND, 'tok');
  localStorage.setItem('srr.brand.recent', JSON.stringify([{ id: BRAND, name: '카공시대', ts: 1 }]));
}

async function loadHook(path: string) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  return (await import('./useBrandLaunchRedirect')).useBrandLaunchRedirect;
}

describe('useBrandLaunchRedirect', () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockReset();
    standaloneMock.mockReturnValue(true);
  });
  afterEach(() => cleanup());

  it('설치형 앱이 / 로 뜨고 binding 이 있으면 브랜드 플레이어로 보낸다', async () => {
    saveBinding();
    const hook = await loadHook('/');
    renderHook(() => hook(true));
    expect(navigateMock).toHaveBeenCalledWith(`/brand/player/${BRAND}`, { replace: true });
  });

  it('auth 준비 전에는 기다렸다가 준비되면 한 번만 보낸다', async () => {
    saveBinding();
    const hook = await loadHook('/');
    const { rerender } = renderHook(({ ready }) => hook(ready), { initialProps: { ready: false } });
    expect(navigateMock).not.toHaveBeenCalled();
    rerender({ ready: true });
    rerender({ ready: true });
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it('binding 이 없으면 그대로 둔다', async () => {
    localStorage.setItem('srr.brand.recent', JSON.stringify([{ id: BRAND, name: '카공시대', ts: 1 }]));
    const hook = await loadHook('/');
    renderHook(() => hook(true));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('브라우저 탭에서는 보내지 않는다', async () => {
    saveBinding();
    standaloneMock.mockReturnValue(false);
    const hook = await loadHook('/');
    renderHook(() => hook(true));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('/ 가 아닌 경로로 실행되면 보내지 않는다', async () => {
    saveBinding();
    const hook = await loadHook('/business');
    renderHook(() => hook(true));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
