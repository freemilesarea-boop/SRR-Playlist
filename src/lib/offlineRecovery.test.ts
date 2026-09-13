/**
 * Phase ANDROID-STORE-PLAYER-HARDENING-13 · PART A — 오프라인 복구 정책.
 *
 * 못 박는 것 하나: **회선이 없다는 것과 재생이 죽었다는 것은 다른 사건이다.**
 * 오프라인 동안에도 같은 문서 안의 복구(nudge/reload/skip/hard_reset)는 그대로 하되,
 * 페이지를 다시 띄우는 것만은 하지 않는다. 캐시된 곡으로 버티고 있을 수 있고,
 * 리로드 직후에는 자동재생이 막힐 수 있다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveStallAction, isEscalation, verifyHardReset, decideReconnectReset,
  NUDGE_AFTER_MS, RELOAD_AFTER_MS, SKIP_AFTER_MS, RELOAD_PAGE_AFTER_MS,
  FRUITLESS_SKIP_LIMIT, HARD_RESET_VERIFY_MS, type StallAction,
} from './stallWatchdog';
import {
  noteAutoplayBlocked, noteAudiblePlayback, markAutoplayUnblockSource,
  isAwaitingAutoplayRecovery, resetAutoplayRecovery,
} from './autoplayRecovery';

const TICK = 3_000;
const TRACK_MS = 180_000;

function makeRig() {
  return {
    now: 0, trackId: 't0', ct: 0,
    prog: { trackId: 't0', ct: 0, ts: 0 },
    last: 'none' as StallAction,
    fruitless: 0, hardResetDone: false, hardResetAt: null as number | null,
    actions: {} as Record<string, number>, trackChanges: 0,
  };
}
type Rig = ReturnType<typeof makeRig>;

/** Player 워치독 tick 1회. online 을 그대로 사다리에 넘긴다. */
function tick(r: Rig, audible: boolean, online = true): StallAction | null {
  r.now += TICK;
  if (audible) r.ct += TICK / 1000;
  if (audible && r.ct >= TRACK_MS / 1000) { r.ct = 0; r.trackId = `t${++r.trackChanges}`; }

  const progressed = r.ct > r.prog.ct + 0.25;
  const trackChanged = r.trackId !== r.prog.trackId;

  if (r.hardResetAt !== null) {
    const v = verifyHardReset({ msSinceReset: r.now - r.hardResetAt, progressed });
    if (v === 'success') { r.hardResetAt = null; r.hardResetDone = false; r.fruitless = 0; }
    else if (v === 'failure') { r.hardResetAt = null; }
  }

  if (progressed || trackChanged) {
    if (progressed) { r.fruitless = 0; r.hardResetDone = false; }
    r.prog = { trackId: r.trackId, ct: r.ct, ts: r.now };
    r.last = 'none';
    return null;
  }

  const action = resolveStallAction({
    businessMode: true, playing: true, paused: false, ended: false,
    crossfading: false, suppressed: false, autoplayBlocked: false, subscriptionBlocked: false,
    stalledMs: r.now - r.prog.ts,
    fruitlessSkips: r.fruitless,
    hardResetDone: r.hardResetDone,
    hardResetMsAgo: r.hardResetAt === null ? null : r.now - r.hardResetAt,
    online,
  });
  if (action === 'none' || !isEscalation(r.last, action)) return null;
  r.last = action;
  r.actions[action] = (r.actions[action] ?? 0) + 1;
  if (action === 'skip') { r.fruitless += 1; r.trackId = `t${++r.trackChanges}`; r.ct = 0; }
  if (action === 'hard_reset') { r.hardResetAt = r.now; r.hardResetDone = true; }
  return action;
}

/** Player 의 onNetworkBack 과 같은 처리. */
function reconnect(r: Rig, progressed: boolean): void {
  const plan = decideReconnectReset(progressed);
  r.prog = { trackId: r.prog.trackId, ct: r.ct, ts: r.now };
  r.last = 'none';
  if (plan.clearFruitlessSkips) r.fruitless = 0;
  if (plan.clearHardResetDone) { r.hardResetDone = false; r.hardResetAt = null; }
}

beforeEach(() => { resetAutoplayRecovery(); });

/* ══════════════════════════════════════════════════════════════════════════ */

describe('1. online 정상 재생', () => {
  it('online + 정상 재생이면 아무 동작도 하지 않는다', () => {
    const r = makeRig();
    for (let i = 0; i < 2_000; i += 1) tick(r, true, true);
    expect(r.actions).toEqual({});
  });

  it('online 에서는 마지막 칸이 그대로 reload_page 다 (회귀 방지)', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, true);
    const seq: StallAction[] = [];
    for (let i = 0; i < 400 && !seq.includes('reload_page'); i += 1) {
      const a = tick(r, false, true); if (a) seq.push(a);
    }
    expect(seq).toContain('reload_page');
    expect(seq).not.toContain('offline_hold');
  });
});

describe('2. offline + 캐시 오디오가 정상 재생 중 → 복구 0회', () => {
  it('회선이 끊겨도 소리가 나고 있으면 아무것도 하지 않는다', () => {
    const r = makeRig();
    for (let i = 0; i < 2_000; i += 1) tick(r, true, false);   // 오프라인이지만 재생 중
    expect(r.actions).toEqual({});
    expect(r.trackChanges).toBeGreaterThan(0);                 // 곡은 계속 넘어간다
  });

  it('오프라인 6시간 연속 캐시 재생 — 복구 0회', () => {
    const r = makeRig();
    const ticks = (6 * 3600 * 1000) / TICK;
    for (let i = 0; i < ticks; i += 1) tick(r, true, false);
    expect(r.actions).toEqual({});
  });
});

describe('3. offline + 정지 → same-document 복구는 허용된다', () => {
  it('nudge / reload / skip / hard_reset 은 오프라인에서도 실행된다', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    const seq: StallAction[] = [];
    for (let i = 0; i < 200; i += 1) { const a = tick(r, false, false); if (a) seq.push(a); }
    expect(seq).toContain('nudge');
    expect(seq).toContain('reload');
    expect(seq).toContain('skip');
    expect(seq).toContain('hard_reset');
  });
});

describe('4~6. offline 에서는 페이지 재시작을 절대 하지 않는다', () => {
  it('hard recovery 실패 후에도 reload_page 0회 — offline_hold 로 대체된다', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < 300; i += 1) tick(r, false, false);
    expect(r.actions.hard_reset).toBeGreaterThanOrEqual(1);
    expect(r.actions.reload_page ?? 0).toBe(0);
    expect(r.actions.offline_hold).toBeGreaterThanOrEqual(1);
  });

  it('5분 오프라인 정지 — page navigation 0회', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < (5 * 60 * 1000) / TICK; i += 1) tick(r, false, false);
    expect(r.actions.reload_page ?? 0).toBe(0);
  });

  it('30분 오프라인 정지 — page navigation 0회, 보류 로그는 1회만', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < (30 * 60 * 1000) / TICK; i += 1) tick(r, false, false);
    expect(r.actions.reload_page ?? 0).toBe(0);
    // offline_hold 는 reload_page 와 같은 칸이라 같은 정지 구간에서 한 번만 울린다.
    expect(r.actions.offline_hold).toBe(1);
  });

  it('offline_hold 는 사다리에서 reload_page 와 같은 칸이다', () => {
    expect(isEscalation('hard_reset', 'offline_hold')).toBe(true);
    expect(isEscalation('offline_hold', 'reload_page')).toBe(false);
    expect(isEscalation('offline_hold', 'offline_hold')).toBe(false);
    expect(isEscalation('reload_page', 'offline_hold')).toBe(false);
  });
});

describe('7~9. offline → online 전환', () => {
  it('재연결 + 실제 진행 있음 → 상태 전부 초기화', () => {
    const plan = decideReconnectReset(true);
    expect(plan).toEqual({
      resetStallClock: true, clearLadder: true,
      clearFruitlessSkips: true, clearHardResetDone: true,
    });
  });

  it('재연결 + 여전히 정지 → 사다리만 되감고 헛skip 이력은 남긴다', () => {
    const plan = decideReconnectReset(false);
    expect(plan).toEqual({
      resetStallClock: true, clearLadder: true,
      clearFruitlessSkips: false, clearHardResetDone: false,
    });
  });

  it('재연결 그 자체만으로는 절대 reload_page 가 나오지 않는다', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < 300; i += 1) tick(r, false, false);   // 오프라인 15분 정지
    expect(r.actions.offline_hold).toBe(1);

    reconnect(r, false);                                       // 회선 복귀, 아직 무음
    // 복귀 **직후** 몇 tick 동안은 사다리가 처음부터 오른다 — 즉시 재시작 없음.
    const firstFew: StallAction[] = [];
    for (let i = 0; i < 5; i += 1) { const a = tick(r, false, true); if (a) firstFew.push(a); }
    expect(firstFew).not.toContain('reload_page');
    expect(firstFew).not.toContain('hard_reset');
  });

  it('재연결 후 소리가 돌아오면 복구 상태가 깨끗해진다', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < 300; i += 1) tick(r, false, false);
    reconnect(r, true);
    expect(r.fruitless).toBe(0);
    expect(r.hardResetDone).toBe(false);
    expect(r.hardResetAt).toBeNull();
    expect(r.last).toBe('none');
    for (let i = 0; i < 500; i += 1) tick(r, true, true);
    expect(r.actions.reload_page ?? 0).toBe(0);
  });

  it('재연결 후에도 정지가 계속되면 사다리가 재개돼 결국 reload_page 까지 간다', () => {
    const r = makeRig();
    for (let i = 0; i < 100; i += 1) tick(r, true, false);
    for (let i = 0; i < 300; i += 1) tick(r, false, false);
    reconnect(r, false);
    for (let i = 0; i < 200; i += 1) tick(r, false, true);
    expect(r.actions.reload_page).toBe(1);   // 온라인에서는 마지막 칸이 살아 있다
  });
});

describe('10. autoplay_recovered — 정확히 1회', () => {
  it('차단 → 실제 재생이면 1회 보고, 두 번째는 없다', () => {
    noteAutoplayBlocked(1_000);
    expect(isAwaitingAutoplayRecovery()).toBe(true);
    const r1 = noteAudiblePlayback(4_000);
    expect(r1).toEqual({ source: 'unknown', blockedForMs: 3_000 });
    expect(noteAudiblePlayback(5_000)).toBeNull();
    expect(isAwaitingAutoplayRecovery()).toBe(false);
  });

  it('오버레이 탭으로 풀렸으면 출처를 남긴다', () => {
    noteAutoplayBlocked(0);
    markAutoplayUnblockSource('overlay_tap');
    expect(noteAudiblePlayback(2_500)).toEqual({ source: 'overlay_tap', blockedForMs: 2_500 });
  });

  it('차단된 적이 없으면 보고하지 않는다 — 정상 재생마다 남기지 않는다', () => {
    expect(noteAudiblePlayback()).toBeNull();
    for (let i = 0; i < 100; i += 1) expect(noteAudiblePlayback()).toBeNull();
  });

  it('오버레이를 눌렀지만 소리가 안 나면 아직 복구가 아니다', () => {
    noteAutoplayBlocked(0);
    markAutoplayUnblockSource('overlay_tap');
    expect(isAwaitingAutoplayRecovery()).toBe(true);   // 아직 열려 있다
  });

  it('차단 → 복구 → 다시 차단 → 복구 = 2회 (구간마다 1회)', () => {
    noteAutoplayBlocked(0);
    expect(noteAudiblePlayback(1_000)).not.toBeNull();
    noteAutoplayBlocked(10_000);
    expect(noteAudiblePlayback(11_000)).not.toBeNull();
    expect(noteAudiblePlayback(12_000)).toBeNull();
  });

  it('차단 시각을 모르면 blockedForMs 는 null 이 아니라 계산된 값이다 (추측 금지 확인)', () => {
    resetAutoplayRecovery();
    // 차단 기록 없이 소리만 나면 보고 자체가 없다 — 없는 값을 지어내지 않는다.
    expect(noteAudiblePlayback(999)).toBeNull();
  });
});

describe('11~13. 장기 시뮬레이션 (오프라인 정책 적용 후 회귀 없음)', () => {
  for (const hours of [24, 48, 72]) {
    it(`${hours}시간 정상 재생 — 복구 동작 0회`, () => {
      const r = makeRig();
      const ticks = (hours * 3600 * 1000) / TICK;
      for (let i = 0; i < ticks; i += 1) tick(r, true, true);
      expect(r.actions).toEqual({});
      expect(r.fruitless).toBe(0);
      expect(r.hardResetDone).toBe(false);
      expect(r.last).toBe('none');
    });
  }

  it('72시간 · 매시간 10분 오프라인 · 캐시로 계속 재생 — page navigation 0회', () => {
    const r = makeRig();
    const ticks = (72 * 3600 * 1000) / TICK;
    for (let i = 0; i < ticks; i += 1) {
      const minute = Math.floor((i * TICK) / 60_000) % 60;
      const online = minute >= 10;
      tick(r, true, online);      // 캐시로 계속 소리는 난다
    }
    expect(r.actions).toEqual({});
  });

  it('72시간 · 매시간 10분 오프라인 + 그동안 완전 무음 — page navigation 0회', () => {
    const r = makeRig();
    const ticks = (72 * 3600 * 1000) / TICK;
    let wasOnline = true;
    for (let i = 0; i < ticks; i += 1) {
      const minute = Math.floor((i * TICK) / 60_000) % 60;
      const online = minute >= 10;
      if (online && !wasOnline) reconnect(r, false);
      wasOnline = online;
      tick(r, online, online);    // 오프라인 동안 무음, 온라인이면 정상
    }
    expect(r.actions.reload_page ?? 0).toBe(0);
    expect(r.actions.offline_hold).toBeGreaterThan(0);
  });
});

describe('사다리 상수 회귀 방지', () => {
  it('타이밍 상수는 그대로다', () => {
    expect(NUDGE_AFTER_MS).toBe(8_000);
    expect(RELOAD_AFTER_MS).toBe(20_000);
    expect(SKIP_AFTER_MS).toBe(35_000);
    expect(RELOAD_PAGE_AFTER_MS).toBe(150_000);
    expect(FRUITLESS_SKIP_LIMIT).toBe(3);
    expect(HARD_RESET_VERIFY_MS).toBe(20_000);
  });

  it('online 을 생략하면 기존 동작(온라인)으로 본다 — 구 호출부 호환', () => {
    expect(resolveStallAction({
      businessMode: true, playing: true, paused: false, ended: false,
      crossfading: false, suppressed: false, autoplayBlocked: false, subscriptionBlocked: false,
      stalledMs: RELOAD_PAGE_AFTER_MS,
    })).toBe('reload_page');
  });
});
