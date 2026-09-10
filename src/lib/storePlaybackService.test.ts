// 백그라운드 재생 유지 — 서비스를 켜는 조건 단위 테스트.
import { describe, it, expect } from 'vitest';
import { shouldKeepAlive } from './storePlaybackService';

describe('shouldKeepAlive', () => {
  it('매장 모드로 재생 중일 때만 켠다', () => {
    expect(shouldKeepAlive({ storeMode: true, playing: true })).toBe(true);
  });

  it('매장 모드라도 정지 중이면 끈다 — 상태바 알림을 남기지 않는다', () => {
    expect(shouldKeepAlive({ storeMode: true, playing: false })).toBe(false);
  });

  it('개인 감상은 재생 중이어도 켜지 않는다 (불필요한 상시 알림 방지)', () => {
    expect(shouldKeepAlive({ storeMode: false, playing: true })).toBe(false);
  });

  it('둘 다 아니면 끈다', () => {
    expect(shouldKeepAlive({ storeMode: false, playing: false })).toBe(false);
  });
});
