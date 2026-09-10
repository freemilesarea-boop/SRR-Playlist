import { describe, it, expect } from 'vitest';
import {
  resolveStallAction, isEscalation,
  NUDGE_AFTER_MS, RELOAD_AFTER_MS, SKIP_AFTER_MS, RELOAD_PAGE_AFTER_MS,
  type StallInput,
} from './stallWatchdog';

/** 매장에서 소리가 나고 있는 정상 상태 — 여기서 한 필드씩만 바꿔 테스트한다. */
function healthy(over: Partial<StallInput> = {}): StallInput {
  return {
    businessMode: true,
    playing: true,
    paused: false,
    ended: false,
    crossfading: false,
    suppressed: false,
    autoplayBlocked: false,
    subscriptionBlocked: false,
    stalledMs: 0,
    ...over,
  };
}

describe('resolveStallAction — 복구 사다리', () => {
  it('진행 중이면 아무것도 하지 않는다', () => {
    expect(resolveStallAction(healthy())).toBe('none');
    expect(resolveStallAction(healthy({ stalledMs: NUDGE_AFTER_MS - 1 }))).toBe('none');
  });

  it('8초 정지 → 재생을 다시 건다', () => {
    expect(resolveStallAction(healthy({ stalledMs: NUDGE_AFTER_MS }))).toBe('nudge');
    expect(resolveStallAction(healthy({ stalledMs: RELOAD_AFTER_MS - 1 }))).toBe('nudge');
  });

  it('20초 정지 → 소스를 다시 잡는다', () => {
    expect(resolveStallAction(healthy({ stalledMs: RELOAD_AFTER_MS }))).toBe('reload');
    expect(resolveStallAction(healthy({ stalledMs: SKIP_AFTER_MS - 1 }))).toBe('reload');
  });

  it('35초 정지 → 다음 곡으로 넘긴다', () => {
    expect(resolveStallAction(healthy({ stalledMs: SKIP_AFTER_MS }))).toBe('skip');
    expect(resolveStallAction(healthy({ stalledMs: RELOAD_PAGE_AFTER_MS - 1 }))).toBe('skip');
  });

  it('10분 정지는 더 이상 skip 에 머물지 않는다 — 페이지 재시작', () => {
    // 이전에는 아무리 오래 멈춰도 skip 을 돌려줬고, 호출측의 재실행 가드 때문에
    // 실제로는 그 뒤로 아무 일도 없었다(숙대점 34분 정지).
    expect(resolveStallAction(healthy({ stalledMs: 10 * 60_000 }))).toBe('reload_page');
  });
});

describe('resolveStallAction — 손대면 안 되는 상황', () => {
  const stuck = { stalledMs: SKIP_AFTER_MS };

  it('일반 청취자에게는 절대 개입하지 않는다', () => {
    expect(resolveStallAction(healthy({ ...stuck, businessMode: false }))).toBe('none');
  });

  it('사용자가 멈춘 것을 되살리지 않는다', () => {
    expect(resolveStallAction(healthy({ ...stuck, playing: false }))).toBe('none');
  });

  it('본사 스케줄로 억제된 동안에는 조용히 있는다', () => {
    expect(resolveStallAction(healthy({ ...stuck, suppressed: true }))).toBe('none');
  });

  it('자동재생 차단은 사용자 제스처가 필요하므로 건드리지 않는다', () => {
    expect(resolveStallAction(healthy({ ...stuck, autoplayBlocked: true }))).toBe('none');
  });

  it('구독 만료 차단은 되살릴 대상이 아니다', () => {
    expect(resolveStallAction(healthy({ ...stuck, subscriptionBlocked: true }))).toBe('none');
  });

  it('크로스페이드 중에는 crossfade-stuck 경로에 맡긴다', () => {
    expect(resolveStallAction(healthy({ ...stuck, crossfading: true }))).toBe('none');
  });

  it('paused / ended 는 정지가 아니다 (다른 로직의 몫)', () => {
    expect(resolveStallAction(healthy({ ...stuck, paused: true }))).toBe('none');
    expect(resolveStallAction(healthy({ ...stuck, ended: true }))).toBe('none');
  });
});

describe('isEscalation — 사다리를 되돌아가지 않는다', () => {
  it('앞으로만 올라간다', () => {
    expect(isEscalation('none', 'nudge')).toBe(true);
    expect(isEscalation('nudge', 'reload')).toBe(true);
    expect(isEscalation('reload', 'skip')).toBe(true);
  });
  it('같은 칸을 다시 실행하지 않는다', () => {
    expect(isEscalation('nudge', 'nudge')).toBe(false);
    expect(isEscalation('skip', 'skip')).toBe(false);
  });
  it('뒤로 내려가지 않는다', () => {
    expect(isEscalation('skip', 'nudge')).toBe(false);
    expect(isEscalation('reload', 'none')).toBe(false);
  });
});

// ── 숙대점 34분 정지 회귀 방지 ────────────────────────────────────────────────
// 2026-09-10, 르하임스터디카페s 숙대점이 "At Midnight" 곡에서 34분간 멈췄다.
// 사다리가 skip 까지 올라간 뒤 곡이 바뀌지 않자, isEscalation 이 재실행을 막아
// 그 뒤로 아무 일도 일어나지 않았다. 사다리 끝에 칸을 하나 더 둬서 막는다.
describe('사다리 끝 — skip 이 듣지 않을 때', () => {
  const stalled = (ms: number): StallInput => ({
    businessMode: true,
    playing: true,
    paused: false,
    ended: false,
    crossfading: false,
    suppressed: false,
    autoplayBlocked: false,
    subscriptionBlocked: false,
    stalledMs: ms,
  });

  it('150초를 넘기면 페이지 재시작으로 올라간다', () => {
    expect(resolveStallAction(stalled(RELOAD_PAGE_AFTER_MS))).toBe('reload_page');
    expect(resolveStallAction(stalled(RELOAD_PAGE_AFTER_MS + 60_000))).toBe('reload_page');
  });

  it('150초 전까지는 기존 사다리를 유지한다 (동작 변화 없음)', () => {
    expect(resolveStallAction(stalled(SKIP_AFTER_MS))).toBe('skip');
    expect(resolveStallAction(stalled(RELOAD_PAGE_AFTER_MS - 1))).toBe('skip');
  });

  it('reload_page 는 skip 보다 상위 칸이라 재실행 가드를 통과한다', () => {
    // 이게 false 면 숙대점처럼 skip 에서 영원히 멈춘다.
    expect(isEscalation('skip', 'reload_page')).toBe(true);
    expect(isEscalation('reload_page', 'skip')).toBe(false);
  });

  it('매장 모드가 아니면 페이지 재시작도 하지 않는다', () => {
    expect(resolveStallAction({ ...stalled(RELOAD_PAGE_AFTER_MS), businessMode: false })).toBe('none');
  });

  it('자동재생 차단·구독 차단 상태에서는 재시작하지 않는다 (리로드해도 소용없음)', () => {
    expect(resolveStallAction({ ...stalled(RELOAD_PAGE_AFTER_MS), autoplayBlocked: true })).toBe('none');
    expect(resolveStallAction({ ...stalled(RELOAD_PAGE_AFTER_MS), subscriptionBlocked: true })).toBe('none');
  });
});
