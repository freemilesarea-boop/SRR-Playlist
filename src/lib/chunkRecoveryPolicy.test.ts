import { describe, it, expect } from 'vitest';
import {
  decideChunkRecovery,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  type ChunkRecoveryInput,
} from './chunkRecoveryPolicy';

const base: ChunkRecoveryInput = {
  attempts: 0,
  businessMode: false,
  audioActive: false,
  lastAttemptAt: null,
  now: 1_000_000,
};

describe('decideChunkRecovery', () => {
  it('첫 실패는 개인/매장 모두 즉시 리로드', () => {
    expect(decideChunkRecovery(base)).toEqual({ action: 'reload' });
    expect(decideChunkRecovery({ ...base, businessMode: true })).toEqual({ action: 'reload' });
  });

  it('개인 사용자는 1회 복구 후 포기(기존 동작 유지)', () => {
    expect(decideChunkRecovery({ ...base, attempts: 1 })).toEqual({ action: 'give-up' });
  });

  it('매장은 포기하지 않고 60초 뒤 재시도', () => {
    const i = { ...base, businessMode: true, attempts: 1, lastAttemptAt: base.now - 10_000 };
    expect(decideChunkRecovery(i)).toEqual({ action: 'wait', delayMs: RETRY_DELAY_MS - 10_000 });
    expect(decideChunkRecovery({ ...i, lastAttemptAt: base.now - RETRY_DELAY_MS })).toEqual({
      action: 'reload',
    });
  });

  it('매장이라도 소리가 나고 있으면 리로드하지 않는다', () => {
    const i = {
      ...base,
      businessMode: true,
      attempts: 1,
      audioActive: true,
      lastAttemptAt: base.now - 10 * RETRY_DELAY_MS,
    };
    expect(decideChunkRecovery(i)).toEqual({ action: 'wait', delayMs: RETRY_DELAY_MS });
  });

  it('매장도 빌드당 상한을 넘으면 포기 — 무한 리로드 루프 방지', () => {
    const i = {
      ...base,
      businessMode: true,
      attempts: MAX_ATTEMPTS,
      lastAttemptAt: base.now - 10 * RETRY_DELAY_MS,
    };
    expect(decideChunkRecovery(i)).toEqual({ action: 'give-up' });
  });
});
