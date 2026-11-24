import { describe, it, expect } from 'vitest';
import {
  decidePushAction, snoozedState, ANSWERED_STATE, isDevicePlayerRoute,
  PUSH_PROMPT_MAX_DISMISS, PUSH_PROMPT_SNOOZE_DAYS,
} from './pushPrompt';

const NOW = 1_800_000_000_000;
const base = {
  native: true, loggedIn: true, permission: 'default' as const, optedOut: false,
  pathname: '/', state: { dismissCount: 0, nextAt: 0 }, onboardingPending: false, now: NOW,
};

describe('decidePushAction', () => {
  it('처음 연 앱(권한 미결정) → 묻는다', () => {
    expect(decidePushAction(base)).toBe('ask');
  });
  it('웹이거나 로그아웃 상태면 아무것도 안 한다', () => {
    expect(decidePushAction({ ...base, native: false })).toBe('none');
    expect(decidePushAction({ ...base, loggedIn: false })).toBe('none');
  });
  it('이미 허용 → 조용히 토큰 재등록, 단 앱에서 직접 껐으면 안 한다', () => {
    expect(decidePushAction({ ...base, permission: 'granted' })).toBe('sync');
    expect(decidePushAction({ ...base, permission: 'granted', optedOut: true })).toBe('none');
  });
  it('거절했거나 앱에서 직접 껐으면 묻지 않는다', () => {
    expect(decidePushAction({ ...base, permission: 'denied' })).toBe('none');
    expect(decidePushAction({ ...base, optedOut: true })).toBe('none');
  });
  it('매장·브랜드 플레이어 화면에서는 묻지 않는다', () => {
    expect(decidePushAction({ ...base, pathname: '/brand/player/abc' })).toBe('none');
    expect(decidePushAction({ ...base, pathname: '/brand/announcer/abc' })).toBe('none');
    expect(decidePushAction({ ...base, pathname: '/brand' })).toBe('ask');
  });
  it('첫 방문 안내 창이 떠 있으면 기다린다', () => {
    expect(decidePushAction({ ...base, onboardingPending: true })).toBe('wait');
  });
  it('나중에 → 7일 동안 안 묻고, 3번 미루면 더 안 묻는다', () => {
    const s1 = snoozedState(base.state, NOW);
    expect(s1).toEqual({ dismissCount: 1, nextAt: NOW + PUSH_PROMPT_SNOOZE_DAYS * 86400000 });
    expect(decidePushAction({ ...base, state: s1 })).toBe('none');
    expect(decidePushAction({ ...base, state: s1, now: s1.nextAt + 1 })).toBe('ask');
    const s3 = { dismissCount: PUSH_PROMPT_MAX_DISMISS, nextAt: 0 };
    expect(decidePushAction({ ...base, state: s3 })).toBe('none');
  });
  it('OS 창까지 띄웠으면(ANSWERED) 다시 묻지 않는다 — 허용됐으면 sync 는 계속', () => {
    expect(decidePushAction({ ...base, state: ANSWERED_STATE })).toBe('none');
    expect(decidePushAction({ ...base, permission: 'granted', state: ANSWERED_STATE })).toBe('sync');
  });
  it('isDevicePlayerRoute', () => {
    expect(isDevicePlayerRoute('/brand/player/x')).toBe(true);
    expect(isDevicePlayerRoute('/business')).toBe(false);
  });
});
