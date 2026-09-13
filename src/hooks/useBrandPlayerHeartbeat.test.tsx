/**
 * @vitest-environment jsdom
 *
 * 11 · 12 — 두 배달 경로가 훅 안에서 실제로 어떻게 붙어 있는지 검증한다.
 *
 * 순수 함수 테스트는 "판정이 맞다" 까지만 증명한다. 여기서 못 박는 것은 배선이다:
 *   • Realtime 구독이 통째로 실패해도 재생과 heartbeat 는 계속 돈다 (control plane 분리)
 *   • Realtime 이 아무것도 배달하지 않아도 heartbeat 가 명령을 실행한다 (fallback)
 *   • 같은 명령이 양쪽에서 와도 실행은 한 번
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

const heartbeat = vi.fn();
const subscribe = vi.fn();
const ack = vi.fn();

vi.mock('@/lib/api/brandPlayerApi', () => ({
  brandPlayerHeartbeat: (...a: unknown[]) => heartbeat(...a),
  subscribeStoreRecoveryCommands: (...a: unknown[]) => subscribe(...a),
  ackStoreRecovery: (...a: unknown[]) => { ack(...a); return Promise.resolve(); },
}));

const hardRecovery = vi.fn(() => true);
vi.mock('@/lib/hardRecovery', () => ({
  runRegisteredHardRecovery: () => hardRecovery(),
}));

const controlledReload = vi.fn(() => true);
vi.mock('@/lib/playbackGuard', () => ({
  requestControlledReload: (...a: unknown[]) => controlledReload(...(a as [])),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ user: { id: 'store-sukdae' } }),
    { getState: () => ({ user: { id: 'store-sukdae' } }) },
  ),
}));

/** playerStore / playbackHealthStore 는 재생 상태를 건드리는지 감시하는 용도다. */
const playerActions: string[] = [];
const playerState = {
  queue: [{ id: 'track-1' }],
  index: 0,
  play: () => { playerActions.push('play'); },
  next: () => { playerActions.push('next'); },
};
vi.mock('@/store/playerStore', () => ({
  usePlayerStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(playerState),
    { getState: () => playerState },
  ),
}));
vi.mock('@/store/playbackHealthStore', () => ({
  usePlaybackHealthStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ audioActive: true }),
    { getState: () => ({ audioActive: true }) },
  ),
}));

import { useBrandPlayerHeartbeat } from './useBrandPlayerHeartbeat';
import { resetExecutedCommands } from '@/lib/remoteRecovery';

function Harness() {
  useBrandPlayerHeartbeat({ brandId: 'brand-1', sessionToken: 'tok', enabled: true });
  return <div data-testid="alive">ok</div>;
}

const OK = { success: true, session_id: 'sess-A' };

beforeEach(() => {
  vi.clearAllMocks();
  playerActions.length = 0;
  resetExecutedCommands();
  try { sessionStorage.clear(); } catch { /* noop */ }
  heartbeat.mockResolvedValue(OK);
  subscribe.mockReturnValue({ unsubscribe: () => {} });
});

afterEach(() => { cleanup(); });

/* ══════════════════════════════════════════════════════════════════════════ */

describe('12. Realtime 실패가 재생에 영향을 주지 않는다', () => {
  it('구독이 throw 해도 컴포넌트는 살아 있고 heartbeat 는 계속 돈다', async () => {
    subscribe.mockImplementation(() => { throw new Error('websocket refused'); });
    const r = render(<Harness />);
    expect(r.getByTestId('alive')).toBeTruthy();
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    // 재생 상태를 건드리지 않았다 — pause·queue reset·next 어느 것도 없다.
    expect(playerActions).toEqual([]);
  });

  it('구독 해제가 throw 해도 unmount 가 실패하지 않는다', async () => {
    subscribe.mockReturnValue({ unsubscribe: () => { throw new Error('already closed'); } });
    const r = render(<Harness />);
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(() => r.unmount()).not.toThrow();
  });

  it('heartbeat 가 실패해도 조용히 넘어간다', async () => {
    heartbeat.mockRejectedValue(new Error('network'));
    render(<Harness />);
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    expect(playerActions).toEqual([]);
  });

  it('구독은 내 매장으로 좁혀서 건다 — 전 매장 구독 금지', async () => {
    render(<Harness />);
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(subscribe.mock.calls[0][0]).toBe('store-sukdae');
  });
});

describe('11. Realtime 이 조용해도 heartbeat 가 명령을 실행한다', () => {
  it('heartbeat 응답의 hard_recovery 가 실행된다', async () => {
    heartbeat.mockResolvedValue({ ...OK, command: 'hard_recovery', command_id: 'cmd-hb' });
    render(<Harness />);
    await waitFor(() => expect(hardRecovery).toHaveBeenCalledTimes(1));
  });

  it('legacy reload 명령도 controlled reload 로 나간다 (raw location.reload 아님)', async () => {
    heartbeat.mockResolvedValue({ ...OK, command: 'reload', command_id: 'cmd-hb2' });
    render(<Harness />);
    await waitFor(() => expect(controlledReload).toHaveBeenCalledTimes(1));
  });

  it('서버가 모르는 명령을 줘도 실행하지 않는다', async () => {
    heartbeat.mockResolvedValue({ ...OK, command: 'device_reboot', command_id: 'cmd-x' });
    render(<Harness />);
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    expect(hardRecovery).not.toHaveBeenCalled();
    expect(controlledReload).not.toHaveBeenCalled();
  });
});

describe('7. 두 경로 동시 배달 → 정확히 1회', () => {
  it('Realtime 으로 실행한 명령을 heartbeat 가 다시 실행하지 않는다', async () => {
    let deliver: ((row: Record<string, unknown>) => void) | null = null;
    subscribe.mockImplementation((_id: string, onCommand: (r: Record<string, unknown>) => void) => {
      deliver = onCommand;
      return { unsubscribe: () => {} };
    });
    render(<Harness />);
    // 먼저 heartbeat 로 세션 id 를 배운다 — 세션 지목 명령을 받으려면 필요하다.
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    await waitFor(() => expect(deliver).not.toBeNull());

    act(() => {
      deliver!({
        id: 'cmd-both',
        command: 'hard_recovery',
        status: 'pending',
        expires_at: new Date(Date.now() + 120_000).toISOString(),
        session_id: 'sess-A',
        store_user_id: 'store-sukdae',
      });
    });
    expect(hardRecovery).toHaveBeenCalledTimes(1);

    // 이어서 heartbeat 가 같은 명령을 가져온다 (서버가 아직 종결 처리 전).
    heartbeat.mockResolvedValue({ ...OK, command: 'hard_recovery', command_id: 'cmd-both' });
    await act(async () => { await Promise.resolve(); });
    render(<Harness />);
    await waitFor(() => expect(heartbeat.mock.calls.length).toBeGreaterThan(1));
    expect(hardRecovery).toHaveBeenCalledTimes(1);
  });

  it('다른 세션을 지목한 Realtime 명령은 이 탭에서 실행되지 않는다', async () => {
    let deliver: ((row: Record<string, unknown>) => void) | null = null;
    subscribe.mockImplementation((_id: string, onCommand: (r: Record<string, unknown>) => void) => {
      deliver = onCommand;
      return { unsubscribe: () => {} };
    });
    render(<Harness />);
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    await waitFor(() => expect(deliver).not.toBeNull());

    act(() => {
      deliver!({
        id: 'cmd-other-tab',
        command: 'hard_recovery',
        status: 'pending',
        expires_at: new Date(Date.now() + 120_000).toISOString(),
        session_id: 'sess-OTHER',
        store_user_id: 'store-sukdae',
      });
    });
    expect(hardRecovery).not.toHaveBeenCalled();
  });
});
