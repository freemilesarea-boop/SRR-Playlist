/** @vitest-environment jsdom */
//
// Phase STORE-REMOTE-RECOVERY-REALTIME-SLACK-11 — 두 배달 경로가 만나는 지점의 계약.
//
// 여기서 못 박는 것은 하나다: **같은 명령은 정확히 한 번만 실행된다.**
// Realtime 과 heartbeat 는 거의 동시에 같은 명령을 가져올 수 있고, reload 는
// 실행 도중 페이지를 날려버린다. 이 세 가지가 겹치면 무한 리로드가 된다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleRemoteCommand, executeRemoteCommand, type ExecutorDeps,
} from './remoteRecoveryExecutor';
import {
  resetExecutedCommands, parseRealtimeCommandRow,
  type ClientIdentity, type RemoteCommandEnvelope,
} from './remoteRecovery';

const NOW = Date.UTC(2026, 8, 14, 3, 0, 0);
const FUTURE = new Date(NOW + 120_000).toISOString();

const ME: ClientIdentity = {
  storeUserId: 'store-sukdae',
  sessionId: 'sess-A',
  playerInstanceId: 'pi-A',
};

function spyDeps(): ExecutorDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ack: (id, status, code) => { calls.push(`ack:${status}${code ? `:${code}` : ''}`); },
    markPendingReload: (id) => { calls.push(`mark:${id}`); },
    controlledReload: () => { calls.push('reload'); return true; },
    hardRecovery: () => { calls.push('hard'); return true; },
    play: () => { calls.push('play'); },
    next: () => { calls.push('next'); },
    restartApp: () => { calls.push('restartApp'); return Promise.resolve(true); },
  };
}

/** Realtime 이 실제로 주는 모양의 row. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cmd-1',
    command: 'hard_recovery',
    status: 'pending',
    expires_at: FUTURE,
    session_id: 'sess-A',
    store_user_id: 'store-sukdae',
    target_player_instance_id: null,
    ...over,
  };
}

/** heartbeat 가 배달한 명령 — 서버가 세션으로 대상을 이미 확정했다. */
function hb(id: string, command: string): RemoteCommandEnvelope {
  return { commandId: id, command, serverTargeted: true };
}

beforeEach(() => {
  resetExecutedCommands();
  try { sessionStorage.clear(); } catch { /* noop */ }
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe('1. Realtime 정상 명령', () => {
  it('내 매장·내 세션 명령은 실행된다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW);
    expect(r).toEqual({ kind: 'run', command: 'hard_recovery', commandId: 'cmd-1' });
    expect(d.calls).toEqual(['ack:executing', 'hard']);
  });

  it('네 종류 전부 같은 실행부를 탄다', () => {
    for (const [command, tail] of [
      ['play', ['play', 'ack:succeeded']],
      ['next', ['next', 'ack:succeeded']],
      ['hard_recovery', ['ack:executing', 'hard']],
      ['reload', ['ack:executing', 'mark:c', 'reload']],
    ] as const) {
      const d = spyDeps();
      executeRemoteCommand(command, 'c', 'realtime', d);
      expect(d.calls, command).toEqual(tail);
    }
  });
});

describe('2~4. 잘못된 target 은 실행하지 않는다', () => {
  it('다른 매장 row 는 무시한다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(
      parseRealtimeCommandRow(row({ store_user_id: 'store-hwajeong', session_id: null })),
      ME, 'realtime', d, NOW,
    );
    expect(r).toEqual({ kind: 'skip', reason: 'wrong_target' });
    expect(d.calls).toEqual([]);
  });

  it('같은 매장의 다른 세션(옛 탭) 명령은 무시한다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(
      parseRealtimeCommandRow(row({ session_id: 'sess-OLD' })), ME, 'realtime', d, NOW,
    );
    expect(r).toEqual({ kind: 'skip', reason: 'wrong_target' });
    expect(d.calls).toEqual([]);
  });

  it('다른 player_instance 를 지목하면 세션이 맞아도 무시한다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(
      parseRealtimeCommandRow(row({ target_player_instance_id: 'pi-OLD' })), ME, 'realtime', d, NOW,
    );
    expect(r).toEqual({ kind: 'skip', reason: 'wrong_target' });
    expect(d.calls).toEqual([]);
  });

  it('세션을 아직 모르면(heartbeat 전) 세션 지목 명령을 실행하지 않는다 — 추측하지 않는다', () => {
    const d = spyDeps();
    const blind: ClientIdentity = { ...ME, sessionId: null };
    const r = handleRemoteCommand(parseRealtimeCommandRow(row()), blind, 'realtime', d, NOW);
    expect(r).toEqual({ kind: 'skip', reason: 'wrong_target' });
  });
});

describe('5~6. TTL / 종결 상태', () => {
  it('만료된 명령은 실행하지 않는다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(
      parseRealtimeCommandRow(row({ expires_at: new Date(NOW - 1).toISOString() })),
      ME, 'realtime', d, NOW,
    );
    expect(r).toEqual({ kind: 'skip', reason: 'expired' });
    expect(d.calls).toEqual([]);
  });

  it('이미 종결된 명령은 실행하지 않는다 — 재연결 후 흘러든 옛 row 방어', () => {
    for (const status of ['succeeded', 'failed', 'expired', 'rejected']) {
      const d = spyDeps();
      const r = handleRemoteCommand(
        parseRealtimeCommandRow(row({ status })), ME, 'realtime', d, NOW,
      );
      expect(r, status).toEqual({ kind: 'skip', reason: 'terminal' });
      expect(d.calls).toEqual([]);
    }
  });

  it('received 는 아직 실행 전이므로 실행한다', () => {
    const d = spyDeps();
    expect(handleRemoteCommand(
      parseRealtimeCommandRow(row({ status: 'received' })), ME, 'realtime', d, NOW,
    ).kind).toBe('run');
  });
});

describe('7. Realtime + heartbeat 동시 배달 → exactly once', () => {
  it('hard_recovery 는 한 번만 실행된다', () => {
    const d = spyDeps();
    handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW);
    // 30초 뒤 heartbeat 가 같은 명령을 또 가져온다
    const second = handleRemoteCommand(hb('cmd-1', 'hard_recovery'), ME, 'heartbeat', d, NOW + 30_000);
    expect(second).toEqual({ kind: 'skip', reason: 'duplicate' });
    expect(d.calls.filter((c) => c === 'hard')).toHaveLength(1);
  });

  it('heartbeat 가 먼저여도 마찬가지다 (순서 무관)', () => {
    const d = spyDeps();
    handleRemoteCommand(hb('cmd-1', 'hard_recovery'), ME, 'heartbeat', d, NOW);
    handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW + 500);
    expect(d.calls.filter((c) => c === 'hard')).toHaveLength(1);
  });
});

describe('8. 재연결 중복 → exactly once', () => {
  it('같은 INSERT 가 몇 번 다시 들어와도 1회', () => {
    const d = spyDeps();
    for (let i = 0; i < 5; i += 1) {
      handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW + i * 1000);
    }
    expect(d.calls.filter((c) => c === 'hard')).toHaveLength(1);
  });
});

describe('9~10. 리로드/하드복구 중복 금지 — 페이지가 새로 떠도', () => {
  it('reload 는 실행 직전에 기록되어 리로드 후 재실행되지 않는다', () => {
    const d1 = spyDeps();
    handleRemoteCommand(
      parseRealtimeCommandRow(row({ id: 'cmd-reload', command: 'reload' })), ME, 'realtime', d1, NOW,
    );
    expect(d1.calls).toEqual(['ack:executing', 'mark:cmd-reload', 'reload']);

    // ── 여기서 페이지가 리로드된다. 메모리 Set 은 사라지고 sessionStorage 만 남는다.
    resetMemoryOnly();

    // 새 페이지의 첫 heartbeat 가 같은 명령을 다시 가져온다(서버가 아직 종결 처리 전).
    const d2 = spyDeps();
    const again = handleRemoteCommand(hb('cmd-reload', 'reload'), ME, 'heartbeat', d2, NOW + 3_000);
    expect(again).toEqual({ kind: 'skip', reason: 'duplicate' });
    expect(d2.calls).toEqual([]);
  });

  it('hard_recovery 도 리로드를 건너 중복 실행되지 않는다', () => {
    const d1 = spyDeps();
    handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d1, NOW);
    resetMemoryOnly();
    const d2 = spyDeps();
    expect(handleRemoteCommand(hb('cmd-1', 'hard_recovery'), ME, 'heartbeat', d2, NOW + 1_000))
      .toEqual({ kind: 'skip', reason: 'duplicate' });
  });

  it('쿨다운에 막힌 reload 를 성공으로 보고하지 않는다', () => {
    const d = spyDeps();
    d.controlledReload = () => { d.calls.push('reload-blocked'); return false; };
    executeRemoteCommand('reload', 'c', 'realtime', d);
    expect(d.calls).toEqual(['ack:executing', 'mark:c', 'reload-blocked', 'ack:rejected:REMOTE_RELOAD_COOLDOWN']);
  });

  it('Hard Recovery 실행부가 아직 등록되지 않았으면 실패로 보고한다', () => {
    const d = spyDeps();
    d.hardRecovery = () => false;
    executeRemoteCommand('hard_recovery', 'c', 'realtime', d);
    expect(d.calls).toEqual(['ack:executing', 'ack:failed:HARD_RECOVERY_UNAVAILABLE']);
  });
});

describe('11. Realtime 이 죽어 있으면 heartbeat 가 받는다', () => {
  it('Realtime 이 한 건도 배달하지 않아도 폴링 경로로 실행된다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(hb('cmd-hb', 'hard_recovery'), ME, 'heartbeat', d, NOW);
    expect(r.kind).toBe('run');
    expect(d.calls).toEqual(['ack:executing', 'hard']);
  });

  it('세션·인스턴스를 아직 모르는 상태에서도 heartbeat 경로는 동작한다 (서버가 대상 확정)', () => {
    const d = spyDeps();
    const blank: ClientIdentity = { storeUserId: null, sessionId: null, playerInstanceId: null };
    expect(handleRemoteCommand(hb('cmd-hb', 'reload'), blank, 'heartbeat', d, NOW).kind).toBe('run');
  });
});

describe('12. 실행부 실패가 재생을 건드리지 않는다', () => {
  it('deps 가 전부 throw 해도 예외가 새어나가지 않는다', () => {
    const boom = () => { throw new Error('boom'); };
    const d: ExecutorDeps = {
      ack: boom, markPendingReload: boom, controlledReload: boom,
      hardRecovery: boom, play: boom, next: boom, restartApp: boom,
    };
    for (const c of ['reload', 'hard_recovery', 'play', 'next'] as const) {
      expect(() => executeRemoteCommand(c, 'c', 'realtime', d)).not.toThrow();
    }
  });

  it('망가진 Realtime payload 도 조용히 무시한다', () => {
    const d = spyDeps();
    for (const bad of [null, undefined, {}, { id: 'x' }, { command: 'play' }, 'nope' as unknown]) {
      expect(() => handleRemoteCommand(
        parseRealtimeCommandRow(bad as never), ME, 'realtime', d, NOW,
      )).not.toThrow();
    }
    expect(d.calls).toEqual([]);
  });

  it('모르는 명령은 실행하지 않는다', () => {
    const d = spyDeps();
    expect(handleRemoteCommand(parseRealtimeCommandRow(row({ command: 'self_destruct' })), ME, 'realtime', d, NOW))
      .toEqual({ kind: 'skip', reason: 'unknown_command' });
    expect(d.calls).toEqual([]);
  });

  it('device_reboot 는 어디서도 실행하지 않고 거부로 보고한다', () => {
    const d = spyDeps();
    const r = handleRemoteCommand(
      parseRealtimeCommandRow(row({ id: 'c-reboot', command: 'device_reboot' })), ME, 'realtime', d, NOW,
    );
    expect(r).toEqual({
      kind: 'skip', reason: 'unsupported_runtime', resultCode: 'DEVICE_REBOOT_UNSUPPORTED',
    });
    expect(d.calls).toEqual(['ack:rejected:DEVICE_REBOOT_UNSUPPORTED']);
  });

  it('app_restart 는 웹에서 거부, 네이티브에서만 실행한다', () => {
    const web = spyDeps();
    expect(handleRemoteCommand(
      parseRealtimeCommandRow(row({ id: 'c-web', command: 'app_restart' })), ME, 'realtime', web, NOW,
    )).toEqual({
      kind: 'skip', reason: 'unsupported_runtime', resultCode: 'APP_RESTART_WEB_UNSUPPORTED',
    });
    expect(web.calls).toEqual(['ack:rejected:APP_RESTART_WEB_UNSUPPORTED']);

    const nat = spyDeps();
    const native = { ...ME, nativeShell: true };
    expect(handleRemoteCommand(
      parseRealtimeCommandRow(row({ id: 'c-nat', command: 'app_restart' })), native, 'realtime', nat, NOW,
    ).kind).toBe('run');
    expect(nat.calls).toEqual(['ack:executing', 'restartApp']);
  });
});

/**
 * "페이지가 리로드됐다" 를 흉내낸다 — 메모리 Set 만 비우고 sessionStorage 는 남긴다.
 * resetExecutedCommands 는 저장소까지 지우므로 여기서는 쓸 수 없다.
 */
function resetMemoryOnly(): void {
  const saved = sessionStorage.getItem('deudda:remote-cmd-done');
  resetExecutedCommands();
  if (saved !== null) sessionStorage.setItem('deudda:remote-cmd-done', saved);
}

describe('저장소가 막힌 환경', () => {
  it('sessionStorage 가 throw 해도 같은 페이지 안에서는 중복을 막는다', () => {
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
      resetExecutedCommands();
      const d = spyDeps();
      handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW);
      handleRemoteCommand(parseRealtimeCommandRow(row()), ME, 'realtime', d, NOW + 100);
      expect(d.calls.filter((c) => c === 'hard')).toHaveLength(1);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'sessionStorage', saved);
    }
  });
});

describe('관측 — 어느 경로로 왔는지 남는다', () => {
  it('reload 사유 문자열에 배달 경로가 들어간다', () => {
    const d = spyDeps();
    const reload = vi.fn(() => true);
    d.controlledReload = reload;
    executeRemoteCommand('reload', 'c', 'heartbeat', d);
    expect(reload).toHaveBeenCalledWith(expect.stringContaining('heartbeat'));
  });
});
