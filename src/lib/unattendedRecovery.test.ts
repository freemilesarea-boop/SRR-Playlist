import { describe, it, expect } from 'vitest';
import {
  isPermanentMediaError, shouldAutoSkipUnattended, autoSkipDelayMs,
  AUTO_SKIP_DELAY_MS, AUTO_SKIP_BACKOFF_DELAY_MS,
  MEDIA_ERR_ABORTED, MEDIA_ERR_NETWORK, MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED,
  type AutoSkipInput,
} from './unattendedRecovery';

function input(over: Partial<AutoSkipInput> = {}): AutoSkipInput {
  return { businessMode: true, playing: true, errorCode: MEDIA_ERR_NETWORK, retryCount: 3, maxRetries: 3, ...over };
}

describe('isPermanentMediaError', () => {
  it('DECODE / SRC_NOT_SUPPORTED 만 영구 오류', () => {
    expect(isPermanentMediaError(MEDIA_ERR_DECODE)).toBe(true);
    expect(isPermanentMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED)).toBe(true);
    expect(isPermanentMediaError(MEDIA_ERR_NETWORK)).toBe(false);
    expect(isPermanentMediaError(MEDIA_ERR_ABORTED)).toBe(false);
    expect(isPermanentMediaError(null)).toBe(false);
    expect(isPermanentMediaError(undefined)).toBe(false);
  });
});

describe('shouldAutoSkipUnattended', () => {
  it('네트워크 오류는 재시도를 다 쓴 뒤에만 넘긴다 (매장에서 가장 흔한 실패)', () => {
    expect(shouldAutoSkipUnattended(input({ retryCount: 0 }))).toBe(false);
    expect(shouldAutoSkipUnattended(input({ retryCount: 2 }))).toBe(false);
    expect(shouldAutoSkipUnattended(input({ retryCount: 3 }))).toBe(true);
    expect(shouldAutoSkipUnattended(input({ retryCount: 9 }))).toBe(true);
  });

  it('영구 오류는 재시도 횟수와 무관하게 즉시 넘긴다', () => {
    expect(shouldAutoSkipUnattended(input({ errorCode: MEDIA_ERR_DECODE, retryCount: 0 }))).toBe(true);
    expect(shouldAutoSkipUnattended(input({ errorCode: MEDIA_ERR_SRC_NOT_SUPPORTED, retryCount: 0 }))).toBe(true);
  });

  it('매장모드가 아니면 개입하지 않는다 (일반 사용자는 기존 동작 유지)', () => {
    expect(shouldAutoSkipUnattended(input({ businessMode: false }))).toBe(false);
    expect(shouldAutoSkipUnattended(input({ businessMode: false, errorCode: MEDIA_ERR_DECODE }))).toBe(false);
  });

  it('사용자가 직접 멈춘 상태면 개입하지 않는다', () => {
    expect(shouldAutoSkipUnattended(input({ playing: false }))).toBe(false);
    expect(shouldAutoSkipUnattended(input({ playing: false, errorCode: MEDIA_ERR_DECODE }))).toBe(false);
  });

  it('ABORTED / 알 수 없는 코드는 넘기지 않는다', () => {
    expect(shouldAutoSkipUnattended(input({ errorCode: MEDIA_ERR_ABORTED }))).toBe(false);
    expect(shouldAutoSkipUnattended(input({ errorCode: null }))).toBe(false);
  });
});

describe('autoSkipDelayMs', () => {
  it('평상시 3초, 연속 5회부터는 30초로 물러난다 (전면 장애 시 큐 무한 순회 방지)', () => {
    expect(autoSkipDelayMs(0)).toBe(AUTO_SKIP_DELAY_MS);
    expect(autoSkipDelayMs(4)).toBe(AUTO_SKIP_DELAY_MS);
    expect(autoSkipDelayMs(5)).toBe(AUTO_SKIP_BACKOFF_DELAY_MS);
    expect(autoSkipDelayMs(50)).toBe(AUTO_SKIP_BACKOFF_DELAY_MS);
  });
});
