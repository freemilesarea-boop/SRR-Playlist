// iOS: 이전 로그인 창 기록이 남아 있으면 Browser.open 이 "Unable to display URL" 로 거절한다
// (2026-11-27 실기기). 열기 전에 반드시 close 로 정리하는지 고정한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
const browser = {
  close: vi.fn(async () => { calls.push('close'); throw new Error('No active window to close!'); }),
  open: vi.fn(async () => { calls.push('open'); }),
};
vi.mock('@capacitor/browser', () => ({ Browser: browser }));
vi.mock('@/lib/native', () => ({ isNativeApp: () => true, nativePlatform: () => 'ios' }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://example.supabase.co/auth/v1/authorize' }, error: null })) } },
}));

const { nativeOAuthSignIn } = await import('./nativeAuth');

beforeEach(() => {
  calls.length = 0;
  browser.close.mockClear();
  browser.open.mockClear();
});

describe('nativeOAuthSignIn — 로그인 창 열기', () => {
  it('열기 전에 남은 창을 닫는다(닫을 창이 없어 실패해도 계속 진행)', async () => {
    void nativeOAuthSignIn('google');
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalled());
    expect(calls).toEqual(['close', 'open']);
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://example.supabase.co/auth/v1/authorize' });
  });

  it('여러 번 눌러도 매번 정리 후 연다', async () => {
    void nativeOAuthSignIn('apple');
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalledTimes(1));
    void nativeOAuthSignIn('google');
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalledTimes(2));
    expect(calls).toEqual(['close', 'open', 'close', 'open']);
  });
});
