// @vitest-environment jsdom
// 앱에서 알림을 직접 끄면: 이 기기의 마지막 토큰을 서버에서 지우고, 다시 자동 등록·안내하지 않게 표시한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/native', () => ({ isNativeApp: () => true, nativePlatform: () => 'android' }));
const plugin = {
  checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  register: vi.fn(async () => { listeners.registration?.({ value: 'tok-123' }); }),
  unregister: vi.fn(async () => {}),
  addListener: vi.fn(async (ev: string, cb: (x: { value: string }) => void) => { listeners[ev] = cb; return { remove: () => {} }; }),
};
const listeners: Record<string, ((x: { value: string }) => void) | undefined> = {};
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));

const { enableNativePush, disableNativePush, nativePushSupported } = await import('./nativePush');
const { readPushOptedOut } = await import('./pushPrompt');

beforeEach(() => {
  vi.stubEnv('VITE_ANDROID_PUSH_READY', '1');
  window.localStorage.clear();
  rpc.mockReset().mockResolvedValue({ error: null });
});

describe('알림 켜기/끄기 — 이 기기 토큰 기억', () => {
  it('켜면 토큰 저장·끈 표시 해제, 끄면 다음 실행에서도 그 토큰을 서버에서 지운다', async () => {
    window.localStorage.setItem('deudda.push.optedOut', '1');
    const r = await enableNativePush();
    expect(r).toEqual({ ok: true, token: 'tok-123' });
    expect(rpc).toHaveBeenCalledWith('save_device_push_token', expect.objectContaining({ p_token: 'tok-123', p_platform: 'android' }));
    expect(readPushOptedOut()).toBe(false);

    // 다른 실행(토큰을 메모리에 안 들고 있음)에서 끄기
    expect(await disableNativePush(null)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('delete_device_push_token', { p_token: 'tok-123' });
    expect(plugin.unregister).toHaveBeenCalled();
    expect(readPushOptedOut()).toBe(true);
    expect(window.localStorage.getItem('deudda.push.lastToken')).toBeNull();
  });
});

describe('Android — google-services.json 없이 빌드한 앱', () => {
  it('푸시를 아예 쓰지 않는다(register 를 부르면 앱이 꺼지므로)', async () => {
    vi.stubEnv('VITE_ANDROID_PUSH_READY', '0');
    expect(nativePushSupported()).toBe(false);
    plugin.register.mockClear();
    expect(await enableNativePush()).toEqual({ ok: false, error: 'not_native' });
    expect(plugin.register).not.toHaveBeenCalled();
    vi.stubEnv('VITE_ANDROID_PUSH_READY', '1');
    expect(nativePushSupported()).toBe(true);
  });
});
