// 네이티브 푸시 — 순수 로직 단위 테스트.
// 알림 payload 는 서버에서 오는 값이므로 라우팅 경로 검증이 중요하다.
import { describe, it, expect } from 'vitest';
import { normalizePermission, safeInAppPath } from './nativePush';

describe('normalizePermission', () => {
  it('Capacitor 권한 상태를 Web Push 어휘로 맞춘다', () => {
    expect(normalizePermission('granted')).toBe('granted');
    expect(normalizePermission('denied')).toBe('denied');
  });
  it('아직 안 물어본 상태는 default', () => {
    expect(normalizePermission('prompt')).toBe('default');
    expect(normalizePermission('prompt-with-rationale')).toBe('default');
    expect(normalizePermission('')).toBe('default');
  });
});

describe('safeInAppPath', () => {
  it('앱 내부 경로는 그대로 통과', () => {
    expect(safeInAppPath('/business/player')).toBe('/business/player');
    expect(safeInAppPath('/brand/player/abc?x=1')).toBe('/brand/player/abc?x=1');
  });

  it('외부 URL 은 홈으로 — 알림 payload 를 믿고 아무 데나 보내지 않는다', () => {
    expect(safeInAppPath('https://evil.example/steal')).toBe('/');
    expect(safeInAppPath('http://evil.example')).toBe('/');
  });

  it('프로토콜 상대 URL(//host)도 외부 이동이므로 차단', () => {
    expect(safeInAppPath('//evil.example/x')).toBe('/');
  });

  it('커스텀 스킴 차단', () => {
    expect(safeInAppPath('com.deudda.app://auth/callback')).toBe('/');
    expect(safeInAppPath('javascript:alert(1)')).toBe('/');
  });

  it('빈 값/비정상 입력은 홈', () => {
    expect(safeInAppPath('')).toBe('/');
    expect(safeInAppPath(undefined as unknown as string)).toBe('/');
    expect(safeInAppPath(123 as unknown as string)).toBe('/');
  });
});

describe('플러그인 로더는 플러그인을 그대로 반환하면 안 된다', () => {
  // 실제 앱에서 이걸로 푸시가 통째로 죽었다. logcat 에 남은 흔적:
  //   Uncaught (in promise) Error: "PushNotifications.then()" is not implemented on android
  //
  // Capacitor 플러그인 프록시를 흉내낸다 — 어떤 속성을 읽어도 "네이티브 호출" 을
  // 돌려주므로 `.then` 도 함수로 보이고, 그래서 thenable 로 오인된다.
  function makePluginProxy(onNativeCall: (name: string) => void) {
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          return (...args: unknown[]) => {
            onNativeCall(prop);
            // 안드로이드는 모르는 메서드를 거절한다.
            if (prop === 'then') {
              const reject = args[1];
              if (typeof reject === 'function') {
                reject(new Error(`"PushNotifications.${prop}()" is not implemented on android`));
              }
              return undefined;
            }
            return Promise.resolve();
          };
        },
      },
    );
  }

  it('async 함수가 플러그인을 그대로 반환하면 then() 이 네이티브로 새어나간다', async () => {
    const calls: string[] = [];
    const proxy = makePluginProxy((n) => calls.push(n));
    const bad = async () => proxy;

    await expect(bad()).rejects.toThrow(/then\(\)" is not implemented/);
    expect(calls).toContain('then');
  });

  it('객체에 담아 반환하면 then() 이 호출되지 않는다 — 지금 쓰는 방식', async () => {
    const calls: string[] = [];
    const proxy = makePluginProxy((n) => calls.push(n));
    const good = async () => ({ push: proxy });

    const { push } = await good();
    expect(push).toBe(proxy);
    expect(calls).not.toContain('then');
  });
});
