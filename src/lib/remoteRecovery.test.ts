/** @vitest-environment jsdom */
// sessionStorage 상관관계(리로드 전/후)를 실제 저장소로 검증하기 위해 jsdom 을 쓴다.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideRemoteCommand, matchesTarget, isExpired, judgeReloadOutcome,
  allowRemoteCommand, markPendingRemoteReload, takePendingRemoteReload,
  parseRealtimeCommandRow, isTerminalStatus,
  executedCommandIds, rememberExecutedCommand, resetExecutedCommands,
  EXECUTABLE_COMMANDS, HARD_RECOVERY_COOLDOWN_MS,
  type ClientIdentity, type RemoteCommandEnvelope,
} from './remoteRecovery';

const ME: ClientIdentity = {
  storeUserId: 'store-sukdae',
  sessionId: 'sess-A',
  playerInstanceId: 'pi-A',
};

const NOW = Date.UTC(2026, 8, 14, 0, 0, 0);
const none = new Set<string>();

function cmd(over: Partial<RemoteCommandEnvelope> = {}): RemoteCommandEnvelope {
  return {
    commandId: 'c1',
    command: 'hard_recovery',
    expiresAt: new Date(NOW + 120_000).toISOString(),
    storeUserId: 'store-sukdae',
    ...over,
  };
}

beforeEach(() => {
  resetExecutedCommands();
  try { sessionStorage.clear(); } catch { /* noop */ }
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('타게팅 — 남의 매장에 절대 닿지 않는다', () => {
  it('store 만 지정: 같은 매장이면 실행', () => {
    expect(decideRemoteCommand(cmd(), ME, none, NOW)).toEqual({
      kind: 'run', command: 'hard_recovery', commandId: 'c1',
    });
  });

  it('store 만 지정: 다른 매장이면 실행하지 않는다', () => {
    const d = decideRemoteCommand(cmd({ storeUserId: 'store-hwajeong' }), ME, none, NOW);
    expect(d).toEqual({ kind: 'skip', reason: 'wrong_target' });
  });

  it('session 지정: 같은 세션이면 실행', () => {
    expect(decideRemoteCommand(cmd({ targetSessionId: 'sess-A' }), ME, none, NOW).kind).toBe('run');
  });

  it('session 지정: 다른 세션이면 실행하지 않는다 — 옛 탭 사고 방지', () => {
    const d = decideRemoteCommand(cmd({ targetSessionId: 'sess-OLD' }), ME, none, NOW);
    expect(d).toEqual({ kind: 'skip', reason: 'wrong_target' });
  });

  it('player_instance 지정: 같으면 실행', () => {
    expect(decideRemoteCommand(cmd({ targetPlayerInstanceId: 'pi-A' }), ME, none, NOW).kind).toBe('run');
  });

  it('player_instance 지정: 다르면 store/session 이 맞아도 실행하지 않는다', () => {
    const d = decideRemoteCommand(
      cmd({ targetPlayerInstanceId: 'pi-OLD', targetSessionId: 'sess-A', storeUserId: 'store-sukdae' }),
      ME, none, NOW,
    );
    expect(d).toEqual({ kind: 'skip', reason: 'wrong_target' });
  });

  it('우선순위: player_instance > session > store', () => {
    // session 은 어긋나지만 player_instance 가 맞으면 실행한다.
    expect(matchesTarget(
      { commandId: 'x', command: 'play', targetPlayerInstanceId: 'pi-A', targetSessionId: 'sess-OLD' },
      ME,
    )).toBe(true);
    // store 는 맞지만 session 이 어긋나면 실행하지 않는다.
    expect(matchesTarget(
      { commandId: 'x', command: 'play', targetSessionId: 'sess-OLD', storeUserId: 'store-sukdae' },
      ME,
    )).toBe(false);
  });

  it('target 이 하나도 없으면 실행하지 않는다 — broadcast 금지', () => {
    const d = decideRemoteCommand(
      { commandId: 'c1', command: 'reload', storeUserId: null }, ME, none, NOW,
    );
    expect(d).toEqual({ kind: 'skip', reason: 'wrong_target' });
  });

  it('내 신원이 비어 있으면 어떤 명령도 실행하지 않는다', () => {
    const blank: ClientIdentity = { storeUserId: null, sessionId: null, playerInstanceId: null };
    expect(decideRemoteCommand(cmd(), blank, none, NOW).kind).toBe('skip');
  });
});

describe('TTL', () => {
  it('만료된 명령은 실행하지 않는다 — 몇 시간 뒤 켜진 기기가 옛 reload 를 돌리면 안 된다', () => {
    const d = decideRemoteCommand(
      cmd({ command: 'reload', expiresAt: new Date(NOW - 1).toISOString() }), ME, none, NOW,
    );
    expect(d).toEqual({ kind: 'skip', reason: 'expired' });
  });

  it('만료 직전은 실행한다', () => {
    expect(decideRemoteCommand(cmd({ expiresAt: NOW + 1 }), ME, none, NOW).kind).toBe('run');
  });

  it('expiresAt 이 없거나 못 읽으면 만료로 보지 않는다 (구버전 heartbeat 응답 호환)', () => {
    expect(isExpired(undefined, NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired('', NOW)).toBe(false);
    expect(isExpired('not-a-date', NOW)).toBe(false);
    expect(decideRemoteCommand(cmd({ expiresAt: null }), ME, none, NOW).kind).toBe('run');
  });
});

describe('idempotency — Realtime + heartbeat 중복 수신', () => {
  it('같은 command_id 는 정확히 1회만 실행한다', () => {
    const done = new Set<string>();
    const first = decideRemoteCommand(cmd(), ME, done, NOW);
    expect(first.kind).toBe('run');
    if (first.kind === 'run') done.add(first.commandId);

    // Realtime 으로 한 번 더, heartbeat 로 또 한 번 들어와도
    expect(decideRemoteCommand(cmd(), ME, done, NOW)).toEqual({ kind: 'skip', reason: 'duplicate' });
    expect(decideRemoteCommand(cmd(), ME, done, NOW)).toEqual({ kind: 'skip', reason: 'duplicate' });
    expect(done.size).toBe(1);
  });

  it('command_id 가 없으면 실행하지 않는다 — 중복 방지가 불가능하다', () => {
    expect(decideRemoteCommand(cmd({ commandId: null }), ME, none, NOW))
      .toEqual({ kind: 'skip', reason: 'no_command' });
  });
});

describe('명령 화이트리스트', () => {
  it('웹이 실행하는 것은 4종뿐이다', () => {
    expect([...EXECUTABLE_COMMANDS].sort()).toEqual(['hard_recovery', 'next', 'play', 'reload']);
  });

  it('device_reboot / app_restart 는 웹에서 실행하지 않는다', () => {
    for (const c of ['device_reboot', 'app_restart']) {
      expect(decideRemoteCommand(cmd({ command: c }), ME, none, NOW))
        .toEqual({ kind: 'skip', reason: 'unknown_command' });
    }
  });

  it('legacy reload/play/next 는 그대로 동작한다 (회귀 방지)', () => {
    for (const c of ['reload', 'play', 'next'] as const) {
      expect(decideRemoteCommand(cmd({ command: c }), ME, none, NOW).kind).toBe('run');
    }
  });

  it('모르는 명령은 조용히 무시한다', () => {
    expect(decideRemoteCommand(cmd({ command: 'self_destruct' }), ME, none, NOW))
      .toEqual({ kind: 'skip', reason: 'unknown_command' });
  });

  it('null/undefined 봉투도 안전하다', () => {
    expect(decideRemoteCommand(null, ME, none, NOW)).toEqual({ kind: 'skip', reason: 'no_command' });
    expect(decideRemoteCommand(undefined, ME, none, NOW)).toEqual({ kind: 'skip', reason: 'no_command' });
  });
});

describe('리로드 결과 상관관계', () => {
  it('리로드 직전 표시 → 리로드 후 1회 회수', () => {
    markPendingRemoteReload('c-reload', NOW);
    expect(takePendingRemoteReload(NOW + 1_000)).toEqual({ commandId: 'c-reload', at: NOW });
    // 1회성 — 두 번째는 없다
    expect(takePendingRemoteReload(NOW + 1_000)).toBeNull();
  });

  it('너무 오래된 표시는 버린다 — 어제 리로드를 오늘 성공으로 보고하지 않는다', () => {
    markPendingRemoteReload('c-old', NOW);
    expect(takePendingRemoteReload(NOW + 6 * 60 * 1000)).toBeNull();
  });

  it('저장소가 막혀 있어도 throw 하지 않는다', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
        clear() { throw new Error('blocked'); },
      },
    });
    try {
      expect(() => markPendingRemoteReload('c', NOW)).not.toThrow();
      expect(takePendingRemoteReload(NOW)).toBeNull();
    } finally {
      if (saved) Object.defineProperty(globalThis, 'sessionStorage', saved);
    }
  });
});

describe('리로드 결과 판정 — 점주 터치가 필요한 상태는 성공이 아니다', () => {
  it('자동재생이 막혔으면 FAILED + REMOTE_RELOAD_AUTOPLAY_BLOCKED', () => {
    expect(judgeReloadOutcome({ autoplayBlocked: true, progressed: false })).toEqual({
      status: 'failed', resultCode: 'REMOTE_RELOAD_AUTOPLAY_BLOCKED',
    });
  });

  it('자동재생이 막혔으면 진행이 있어 보여도 실패로 본다 (오버레이가 떠 있는 상태)', () => {
    expect(judgeReloadOutcome({ autoplayBlocked: true, progressed: true }).status).toBe('failed');
  });

  it('실제 재생 진행이 있어야만 SUCCEEDED', () => {
    expect(judgeReloadOutcome({ autoplayBlocked: false, progressed: true })).toEqual({ status: 'succeeded' });
  });

  it('진행이 없으면 FAILED + REMOTE_RELOAD_NO_PROGRESS', () => {
    expect(judgeReloadOutcome({ autoplayBlocked: false, progressed: false })).toEqual({
      status: 'failed', resultCode: 'REMOTE_RELOAD_NO_PROGRESS',
    });
  });
});

describe('클라이언트 쿨다운 (서버 쿨다운의 2차 방어)', () => {
  it('hard_recovery 는 60초 이내 재실행을 막는다', () => {
    expect(allowRemoteCommand('hard_recovery', null, NOW)).toBe(true);
    expect(allowRemoteCommand('hard_recovery', NOW, NOW + 1_000)).toBe(false);
    expect(allowRemoteCommand('hard_recovery', NOW, NOW + HARD_RECOVERY_COOLDOWN_MS - 1)).toBe(false);
    expect(allowRemoteCommand('hard_recovery', NOW, NOW + HARD_RECOVERY_COOLDOWN_MS)).toBe(true);
  });

  it('reload 는 Player 의 기존 10분 controlled-reload 쿨다운이 담당한다', () => {
    expect(allowRemoteCommand('reload', NOW, NOW + 1)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* 0520 — Realtime row 해석 · 상태 · 영속 중복방지                              */
/* ══════════════════════════════════════════════════════════════════════════ */

describe('Realtime row 해석', () => {
  it('snake_case row 를 봉투로 옮긴다', () => {
    expect(parseRealtimeCommandRow({
      id: 'c9', command: 'reload', status: 'pending',
      expires_at: '2026-09-14T00:02:00Z',
      session_id: 'sess-A', store_user_id: 'store-sukdae',
      target_player_instance_id: 'pi-A',
    })).toEqual({
      commandId: 'c9', command: 'reload', status: 'pending',
      expiresAt: '2026-09-14T00:02:00Z',
      targetSessionId: 'sess-A', targetPlayerInstanceId: 'pi-A',
      storeUserId: 'store-sukdae',
    });
  });

  it('id 나 command 가 없으면 봉투를 만들지 않는다', () => {
    expect(parseRealtimeCommandRow({ command: 'reload' })).toBeNull();
    expect(parseRealtimeCommandRow({ id: 'c1' })).toBeNull();
    expect(parseRealtimeCommandRow(null)).toBeNull();
    expect(parseRealtimeCommandRow(undefined)).toBeNull();
  });

  it('빈 문자열은 null 로 떨어뜨린다 — session_id="" 를 target 으로 오해하지 않는다', () => {
    const env = parseRealtimeCommandRow({ id: 'c1', command: 'play', session_id: '' });
    expect(env?.targetSessionId).toBeNull();
  });

  it('Realtime row 에는 serverTargeted 가 절대 붙지 않는다 — target 대조가 유일한 방어선', () => {
    const env = parseRealtimeCommandRow({ id: 'c1', command: 'play', store_user_id: 'store-x' });
    expect(env?.serverTargeted).toBeUndefined();
  });
});

describe('종결 상태', () => {
  it('종결된 명령은 실행 대상이 아니다', () => {
    for (const s of ['succeeded', 'failed', 'expired', 'rejected']) {
      expect(isTerminalStatus(s), s).toBe(true);
    }
  });

  it('pending / received 는 아직 살아 있다', () => {
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('received')).toBe(false);
    expect(isTerminalStatus('executing')).toBe(false);
  });

  it('status 가 없으면 종결로 보지 않는다 — 구버전 heartbeat 응답 호환', () => {
    expect(isTerminalStatus(null)).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
    expect(isTerminalStatus('')).toBe(false);
  });

  it('decideRemoteCommand 가 종결 상태를 걸러낸다', () => {
    expect(decideRemoteCommand(cmd({ status: 'succeeded' }), ME, none, NOW))
      .toEqual({ kind: 'skip', reason: 'terminal' });
  });
});

describe('서버가 대상을 확정한 명령 (heartbeat 경로)', () => {
  it('target 필드가 없어도 실행한다', () => {
    expect(decideRemoteCommand(
      { commandId: 'c1', command: 'hard_recovery', serverTargeted: true }, ME, none, NOW,
    ).kind).toBe('run');
  });

  it('그래도 TTL·화이트리스트·중복 검사는 그대로 받는다', () => {
    expect(decideRemoteCommand(
      { commandId: 'c1', command: 'device_reboot', serverTargeted: true }, ME, none, NOW,
    )).toEqual({ kind: 'skip', reason: 'unknown_command' });
    expect(decideRemoteCommand(
      { commandId: 'c1', command: 'reload', serverTargeted: true, expiresAt: NOW - 1 }, ME, none, NOW,
    )).toEqual({ kind: 'skip', reason: 'expired' });
  });
});

describe('영속 중복방지 — 페이지 리로드를 건너간다', () => {
  it('기록한 id 가 sessionStorage 에 남는다', () => {
    rememberExecutedCommand('c-abc');
    expect(executedCommandIds().has('c-abc')).toBe(true);
    expect(sessionStorage.getItem('deudda:remote-cmd-done')).toContain('c-abc');
  });

  it('용량을 넘으면 오래된 것부터 버린다 (무한 증가 방지)', () => {
    for (let i = 0; i < 60; i += 1) rememberExecutedCommand(`c${i}`);
    const stored = JSON.parse(sessionStorage.getItem('deudda:remote-cmd-done') ?? '[]') as string[];
    expect(stored.length).toBeLessThanOrEqual(40);
    expect(stored).toContain('c59');
    expect(stored).not.toContain('c0');
  });

  it('저장소가 막혀 있어도 throw 하지 않는다', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); },
               removeItem() { throw new Error('x'); }, clear() { throw new Error('x'); } },
    });
    try {
      resetExecutedCommands();
      expect(() => rememberExecutedCommand('c')).not.toThrow();
      expect(executedCommandIds().has('c')).toBe(true);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'sessionStorage', saved);
      resetExecutedCommands();
    }
  });
});
