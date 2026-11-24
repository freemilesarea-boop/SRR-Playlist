// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const push = {
  nativePushSupported: vi.fn(() => true),
  checkNativePushPermission: vi.fn(),
  enableNativePush: vi.fn(),
};
vi.mock('@/lib/nativePush', () => push);
let user: { id: string } | null = { id: 'u1' };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user }),
}));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/store/toastStore', () => ({ toast: toastMock }));

const { default: NativePushPrompt } = await import('./NativePushPrompt');
const { readPushPromptState, ANSWERED_STATE } = await import('@/lib/pushPrompt');

function mount(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><NativePushPrompt /></MemoryRouter>);
}
async function flush(ms = 1600) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.localStorage.setItem('srr-onboarding-seen', 'true');
  user = { id: 'u1' };
  push.nativePushSupported.mockReturnValue(true);
  push.checkNativePushPermission.mockReset().mockResolvedValue('default');
  push.enableNativePush.mockReset().mockResolvedValue({ ok: true, token: 't' });
  Object.values(toastMock).forEach((f) => f.mockReset());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('NativePushPrompt', () => {
  it('처음 연 앱 → 잠깐 뒤 안내, 알림 받기 → OS 권한 요청·더 묻지 않음', async () => {
    mount();
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
    await flush();
    expect(screen.getByText('알림을 받아 보세요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '알림 받기' }));
    await flush(0);
    expect(push.enableNativePush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
    expect(readPushPromptState()).toEqual(ANSWERED_STATE);
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('OS 창에서 거절해도 앱 안 안내는 끝, 설정 안내', async () => {
    push.enableNativePush.mockResolvedValue({ ok: false, error: 'permission_denied' });
    mount();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '알림 받기' }));
    await flush(0);
    expect(toastMock.info).toHaveBeenCalled();
    expect(readPushPromptState()).toEqual(ANSWERED_STATE);
  });

  it('나중에 → OS 창 없이 닫고 7일 미룸', async () => {
    mount();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(push.enableNativePush).not.toHaveBeenCalled();
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
    expect(readPushPromptState().dismissCount).toBe(1);
  });

  it('이미 허용된 기기 → 안내 없이 토큰만 다시 등록', async () => {
    push.checkNativePushPermission.mockResolvedValue('granted');
    mount();
    await flush();
    expect(push.enableNativePush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
  });

  it('첫 방문 안내 창이 닫힐 때까지 기다렸다 묻는다', async () => {
    window.localStorage.removeItem('srr-onboarding-seen');
    mount();
    await flush();
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
    window.localStorage.setItem('srr-onboarding-seen', 'true');
    await flush(2100);
    expect(screen.getByText('알림을 받아 보세요')).toBeTruthy();
  });

  it('웹·로그아웃·브랜드 플레이어 화면에서는 아무것도 안 한다', async () => {
    push.nativePushSupported.mockReturnValue(false);
    mount();
    await flush();
    expect(push.checkNativePushPermission).not.toHaveBeenCalled();
    cleanup();

    push.nativePushSupported.mockReturnValue(true);
    user = null;
    mount();
    await flush();
    expect(push.checkNativePushPermission).not.toHaveBeenCalled();
    cleanup();

    user = { id: 'u1' };
    window.history.pushState({}, '', '/brand/player/abc');
    mount('/brand/player/abc');
    await flush();
    expect(screen.queryByText('알림을 받아 보세요')).toBeNull();
    window.history.pushState({}, '', '/');
  });
});
