/**
 * @vitest-environment jsdom
 *
 * Phase 27 §7 · §9 — 플레이어 계층이 죽어도 제어면은 산다.
 *
 * 2026-09-15 숙대점의 핵심은 "무엇이 죽었나" 가 아니라 "죽었을 때 무엇이 남았나" 다.
 * 그날 남아 있던 것(AppShell 5초 폴러)은 명령을 받을 수 있는 자리였는데 수신기가
 * 없었다. 이 파일은 그 자리에 수신기가 있는지를 **실행으로** 증명한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

const heartbeat = vi.fn();
const subscribe = vi.fn();
const unsubscribe = vi.fn();

vi.mock('@/lib/api/brandPlayerApi', () => ({
  brandPlayerHeartbeat: (...a: unknown[]) => heartbeat(...a),
  subscribeStoreRecoveryCommands: (...a: unknown[]) => subscribe(...a),
  ackStoreRecovery: () => Promise.resolve(),
}));

const hardRecovery = vi.fn(() => true);
vi.mock('@/lib/hardRecovery', () => ({ runRegisteredHardRecovery: () => hardRecovery() }));
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

const playerActions: string[] = [];
const playerState = {
  queue: [{ id: 'track-1' }], index: 0,
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
import RecoveryControlPlane from '@/components/RecoveryControlPlane';
import { resetExecutedCommands } from '@/lib/remoteRecovery';
import {
  __resetControlPlaneForTest, readLayerHealth, currentCommandReceiver,
  readControlPlaneIdentity, resolveRecoveryRung,
} from '@/lib/recoveryControlPlane';

/** 플레이어 계층. token 이 falsy 가 되면 훅의 effect 들이 정리된다. */
function PlayerLayer({ token }: { token: string | null }) {
  useBrandPlayerHeartbeat({ brandId: 'brand-1', sessionToken: token, enabled: !!token });
  return <div data-testid="player">player</div>;
}

/** 실제 앱 배치: 셸이 제어면을 갖고, 플레이어 계층은 그 안에서 뜨고 진다. */
function App({ token, playerMounted }: { token: string | null; playerMounted: boolean }) {
  return (
    <div>
      {playerMounted && <PlayerLayer token={token} />}
      <RecoveryControlPlane />
    </div>
  );
}

const OK = { success: true, session_id: 'sess-A' };

beforeEach(() => {
  vi.clearAllMocks();
  playerActions.length = 0;
  resetExecutedCommands();
  __resetControlPlaneForTest();
  try { sessionStorage.clear(); } catch { /* noop */ }
  heartbeat.mockResolvedValue(OK);
  subscribe.mockReturnValue({ unsubscribe });
});
afterEach(() => { cleanup(); });

/* ═══════════════════════════════════════════════════════════════════════════
   §7 ROOT CAUSE CANDIDATE — token truthy → falsy
   ═══════════════════════════════════════════════════════════════════════════
   BrandPlayerPage 는 매 렌더마다 token = getBrandToken(brandId) 를 다시 읽고,
   enabled = !!brandId && !!token 이 heartbeat effect 의 deps 다. token 이 한 번
   falsy 가 되면 effect 가 정리되고 **다시 시작하지 않는다** — 예외도 네비게이션도
   로그도 없이. 관측된 모양과 일치한다.

   이것은 **후보일 뿐이다.** 그날 실제로 그랬다는 증거는 없다. */
describe('§7 token truthy → falsy 가 무엇을 멈추는가 (deterministic)', () => {
  it('heartbeat 가 멈추고 다시 시작하지 않는다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(heartbeat).toHaveBeenCalled());
    const before = heartbeat.mock.calls.length;

    await act(async () => { view.rerender(<App token={null} playerMounted />); });
    // 정리된 뒤에는 새 호출이 없다.
    expect(heartbeat.mock.calls.length).toBe(before);

    // 같은 상태로 다시 렌더해도 되살아나지 않는다.
    await act(async () => { view.rerender(<App token={null} playerMounted />); });
    expect(heartbeat.mock.calls.length).toBe(before);
  });

  it('★ 그래도 명령 수신기는 죽지 않는다 — 27 이 고친 것이 이것이다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

    await act(async () => { view.rerender(<App token={null} playerMounted />); });

    // 구독은 token 에 의존하지 않는다. 해제되지 않았다.
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(currentCommandReceiver()).not.toBeNull();
  });

  it('신원도 남는다 — target 대조가 계속 가능하다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(readControlPlaneIdentity().sessionId).toBe('sess-A'));
    await act(async () => { view.rerender(<App token={null} playerMounted />); });
    expect(readControlPlaneIdentity().sessionId).toBe('sess-A');
    expect(readControlPlaneIdentity().storeUserId).toBe('store-sukdae');
  });

  it('❗이 후보는 그날 관측을 **전부** 설명하지는 못한다', () => {
    // 그날은 브랜드 heartbeat 뿐 아니라 verify_stream_heartbeat_v2 (스트림 하트비트)
    // 도 같이 멎었다. 그런데 그쪽은 Player.tsx 가 보내고, Player 는 AppShell 에
    // 마운트되며 brand token 을 쓰지 않는다. token falsy 로는 Player 쪽 정지를
    // 설명할 수 없다. 그래서 이 후보의 우선순위를 낮춘다.
    const player = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');
    const shell = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/AppShell.tsx'), 'utf-8');
    expect(player).toContain('safeHeartbeatV2');          // 스트림 하트비트 주인
    expect(player).not.toContain('getBrandToken');        // brand token 과 무관
    expect(shell).toMatch(/<Player\b/);                   // 셸에 산다
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §9 SHELL HEALTH — 플레이어를 죽여도 셸은 계속 돈다
   ═══════════════════════════════════════════════════════════════════════════ */
describe('§9 플레이어 subtree 를 죽여도 제어면은 계속 돈다', () => {
  it('플레이어를 언마운트해도 구독이 유지된다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

    await act(async () => { view.rerender(<App token="tok" playerMounted={false} />); });

    expect(view.queryByTestId('player')).toBeNull();      // 플레이어는 죽었다
    expect(unsubscribe).not.toHaveBeenCalled();           // 수신기는 살아 있다
    expect(subscribe).toHaveBeenCalledTimes(1);           // 재구독도 없다(중복 금지)
  });

  it('셸 생존 신호가 플레이어 상태에 의존하지 않는다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(readLayerHealth().shellAgeMs).not.toBeNull());

    await act(async () => { view.rerender(<App token="tok" playerMounted={false} />); });

    const h = readLayerHealth();
    expect(h.shellAgeMs).not.toBeNull();                  // 셸은 여전히 살아 있다
    expect(h.shellAgeMs!).toBeLessThan(10_000);
  });

  it('그 조합이 곧 RUNG 2 다 — 플레이어만 죽고 셸은 살아 있다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(readLayerHealth().playerAgeMs).not.toBeNull());
    await act(async () => { view.rerender(<App token="tok" playerMounted={false} />); });

    // 플레이어가 2분 넘게 조용해진 상황을 그대로 계산한다.
    const h = readLayerHealth();
    expect(resolveRecoveryRung({ playerAgeMs: 17 * 60_000, shellAgeMs: h.shellAgeMs }))
      .toBe('player_subtree_recovery');
  });

  it('제어면 언마운트에서만 구독이 해제된다', async () => {
    const view = render(<App token="tok" playerMounted />);
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    await act(async () => { view.unmount(); });
    expect(unsubscribe).toHaveBeenCalled();
    expect(currentCommandReceiver()).toBeNull();          // 소유권도 반납한다
  });
});
