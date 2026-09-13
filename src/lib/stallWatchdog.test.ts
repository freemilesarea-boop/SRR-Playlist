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

  it('ended 는 정지가 아니라 정상 종료 — onEnded 의 몫', () => {
    expect(resolveStallAction(healthy({ ...stuck, ended: true }))).toBe('none');
  });
});

// ── 숙대점 14분 무음 회귀 방지 (BRAND-PLAYER-SELF-HEAL-2) ────────────────────
// 2026-09-11, 하트비트는 살아 있는데 같은 곡에서 14분간 소리가 안 났다. 이틀간 6번.
// 원인: paused 로 굳은 정지를 워치독이 checkAudioHealth 에 넘겼는데, 그 점검은
// 이벤트에서만 불린다(timeupdate·canplay·ended·visibility·focus·online·pageshow).
// 오디오가 멈춰 있으면 그 이벤트가 하나도 오지 않아 되살릴 계기가 사라진다.
// 증거: store_playback_diagnostics 전체 이력에 playback_stalled·track_cut_short 0건
//       — 사다리를 단 한 번도 올라간 적이 없었다.
describe('paused 고착 — playing 의도는 살아 있는데 엘리먼트만 멈춘 경우', () => {
  /** 재생 의도는 true 인데 audio element 가 paused 로 굳은 상태. */
  const pausedStuck = (ms: number): StallInput =>
    healthy({ playing: true, paused: true, stalledMs: ms });

  it('8초 넘게 paused 면 재생을 다시 건다 — 이게 이 상태의 정답', () => {
    expect(resolveStallAction(pausedStuck(NUDGE_AFTER_MS))).toBe('nudge');
  });

  it('nudge 로 안 풀리면 사다리를 끝까지 올라간다', () => {
    expect(resolveStallAction(pausedStuck(RELOAD_AFTER_MS))).toBe('reload');
    expect(resolveStallAction(pausedStuck(SKIP_AFTER_MS))).toBe('skip');
    // 여기까지 와야 페이지가 강제로 다시 뜬다. 이게 없으면 14분 무음이 반복된다.
    expect(resolveStallAction(pausedStuck(RELOAD_PAGE_AFTER_MS))).toBe('reload_page');
    expect(resolveStallAction(pausedStuck(30 * 60_000))).toBe('reload_page');
  });

  it('8초 전에는 손대지 않는다 — 곡 전환 중 잠깐 paused 인 순간을 건드리면 안 된다', () => {
    expect(resolveStallAction(pausedStuck(NUDGE_AFTER_MS - 1))).toBe('none');
  });

  it('사용자가 직접 누른 일시정지는 그대로 둔다 (playing=false)', () => {
    // 이게 깨지면 손님이 멈춘 음악을 앱이 제멋대로 다시 튼다.
    expect(resolveStallAction({ ...pausedStuck(RELOAD_PAGE_AFTER_MS), playing: false })).toBe('none');
  });

  it('일반 청취자에게는 여전히 아무 일도 없다 (businessMode=false)', () => {
    expect(resolveStallAction({ ...pausedStuck(RELOAD_PAGE_AFTER_MS), businessMode: false })).toBe('none');
  });

  it('자동재생 차단·구독차단·스케줄 억제·크로스페이드는 paused 여도 건드리지 않는다', () => {
    // 각각 별도 경로가 처리한다. 여기서 겹쳐 손대면 서로 방해한다.
    expect(resolveStallAction({ ...pausedStuck(SKIP_AFTER_MS), autoplayBlocked: true })).toBe('none');
    expect(resolveStallAction({ ...pausedStuck(SKIP_AFTER_MS), subscriptionBlocked: true })).toBe('none');
    expect(resolveStallAction({ ...pausedStuck(SKIP_AFTER_MS), suppressed: true })).toBe('none');
    expect(resolveStallAction({ ...pausedStuck(SKIP_AFTER_MS), crossfading: true })).toBe('none');
  });

  it('곡이 끝나서 paused 인 것은 정지가 아니다', () => {
    expect(resolveStallAction({ ...pausedStuck(SKIP_AFTER_MS), ended: true })).toBe('none');
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
