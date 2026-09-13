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
