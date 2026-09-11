import { describe, it, expect } from 'vitest';
import {
  isBrowserOpenFailure,
  nativeOAuthMessage,
  NO_BROWSER_MESSAGE,
  PROVIDER_BLOCKED_MESSAGE,
  type NativeOAuthOutcome,
} from './oauthOutcome';

describe('nativeOAuthMessage', () => {
  it('성공은 알릴 게 없다', () => {
    expect(nativeOAuthMessage('success')).toBeNull();
  });

  it('성공 외의 모든 결말은 문구가 있다 — 조용히 끝나는 경로가 없어야 한다', () => {
    const outcomes: NativeOAuthOutcome[] = [
      'cancelled',
      'timeout',
      'provider_error',
      'exchange_failed',
    ];
    for (const o of outcomes) {
      const msg = nativeOAuthMessage(o);
      expect(msg, o).toBeTruthy();
      // 원인만 말하고 끝나면 사용자가 할 수 있는 게 없다. 다음 행동이 있어야 한다.
      expect(msg, o).toMatch(/다시 시도|이메일|확인/);
    }
  });

  it('취소 문구는 "창을 닫았다" 와 "딥링크가 안 돌아온다" 양쪽에 다 맞아야 한다', () => {
    // 딥링크 허용목록 누락도 같은 경로로 오므로, 사용자 탓으로 단정하면 안 된다.
    expect(nativeOAuthMessage('cancelled')).not.toMatch(/취소하셨|닫으셨/);
  });

  it('provider 차단은 기존 안내를 그대로 쓴다', () => {
    expect(nativeOAuthMessage('provider_error')).toBe(PROVIDER_BLOCKED_MESSAGE);
    expect(nativeOAuthMessage('exchange_failed')).toBe(PROVIDER_BLOCKED_MESSAGE);
  });
});

describe('isBrowserOpenFailure', () => {
  it('브라우저가 없는 기기의 오류를 알아본다', () => {
    expect(isBrowserOpenFailure('android.content.ActivityNotFoundException')).toBe(true);
    expect(isBrowserOpenFailure('No Activity found to handle Intent')).toBe(true);
  });

  it('일반 OAuth 오류를 브라우저 없음으로 오해하지 않는다', () => {
    expect(isBrowserOpenFailure('disallowed_useragent')).toBe(false);
    expect(isBrowserOpenFailure('invalid_grant')).toBe(false);
    expect(isBrowserOpenFailure('')).toBe(false);
  });

  it('브라우저 없음 문구는 계정 문제로 오해시키지 않는다', () => {
    // 에뮬레이터에서 이 오류가 났을 때 "회사/학교 계정" 안내가 뜨면 헛다리를 짚는다.
    expect(NO_BROWSER_MESSAGE).not.toMatch(/회사|학교/);
    expect(NO_BROWSER_MESSAGE).toMatch(/브라우저/);
  });
});
