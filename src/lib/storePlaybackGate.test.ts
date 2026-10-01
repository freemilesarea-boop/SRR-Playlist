import { describe, it, expect } from 'vitest';
import {
  resolveStoreGate,
  isStorePlaybackBlocked,
  resolveBusinessToggleAction,
  type StoreGateInput,
} from './storePlaybackGate';

function input(over: Partial<StoreGateInput> = {}): StoreGateInput {
  return { membership: 'free', businessMode: true, ...over };
}

describe('resolveStoreGate', () => {
  it('유료/체험(premium)은 매장이든 개인이든 재생 가능', () => {
    expect(resolveStoreGate(input({ membership: 'premium' }))).toBe('allow');
    expect(resolveStoreGate(input({ membership: 'premium', businessMode: false }))).toBe('allow');
  });

  it('매장 모드 + 무료 등급 → 미리듣기 없이 전체화면 차단', () => {
    expect(resolveStoreGate(input())).toBe('subscription_required');
  });

  it('일반 사용자 + 무료 등급 → 기존 25초 미리듣기 유지 (결제 유도 흐름 불변)', () => {
    expect(resolveStoreGate(input({ businessMode: false }))).toBe('preview');
  });

  it('비로그인은 로그인 요구', () => {
    expect(resolveStoreGate(input({ membership: 'anonymous' }))).toBe('login_required');
    expect(resolveStoreGate(input({ membership: 'anonymous', businessMode: false }))).toBe('login_required');
  });
});

describe('isStorePlaybackBlocked', () => {
  it('매장 무료 등급에서만 true', () => {
    expect(isStorePlaybackBlocked(input())).toBe(true);
    expect(isStorePlaybackBlocked(input({ businessMode: false }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'anonymous' }))).toBe(false);
  });

  it('데모 계정은 membership 이 premium 으로 해석되므로 걸리지 않는다 (시연용 무제한 — 의도됨)', () => {
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
  });
});

// 0511/0512 — reloadApp 사유 분류. 자동재생 차단이 배포 때문인지 탭 정리 때문인지
// 구분하려면 이 분류가 맞아야 한다(숙대점 조사에서 구분 불가였던 지점).
describe('classifyReloadReason', () => {
  it('서비스워커 갱신 → sw_update', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('sw build abc123 (updatefound)')).toBe('sw_update');
    expect(classifyReloadReason('sw-cache-reset')).toBe('sw_update');
  });
  it('청크 로드 실패 → chunk_error', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('chunk-load-failed (build x, attempt 1)')).toBe('chunk_error');
  });
  it('자가 복구 → self_heal', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('route-fallback-stuck')).toBe('self_heal');
  });
  it('분류 불가 → unknown', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('something else')).toBe('unknown');
  });
});

describe('resolveBusinessToggleAction', () => {
  it('매장 모드가 켜져 있으면 재생이 멎어 있어도 끌 수 있다 (2026-10-01 데드락 회귀)', () => {
    // 무료 등급은 subscription_required 로 재생이 막혀 playing 이 영원히 false 다.
    // 예전 로직(isPlaying 기준)은 여기서 start 로 가 매장 모드를 다시 켰고,
    // 사용자는 재생도 못 하고 끄지도 못하는 상태에 갇혔다.
    expect(resolveBusinessToggleAction({ businessMode: true, hasSchedules: true })).toBe('stop');
    expect(resolveBusinessToggleAction({ businessMode: true, hasSchedules: false })).toBe('stop');
  });

  it('꺼져 있고 스케줄이 있으면 시작', () => {
    expect(resolveBusinessToggleAction({ businessMode: false, hasSchedules: true })).toBe('start');
  });

  it('꺼져 있고 스케줄이 없으면 스케줄 설정을 먼저 안내', () => {
    expect(resolveBusinessToggleAction({ businessMode: false, hasSchedules: false })).toBe('need_schedule');
  });
});
