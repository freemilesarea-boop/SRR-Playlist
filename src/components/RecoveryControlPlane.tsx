/**
 * RecoveryControlPlane — 복구 명령 수신기. **AppShell 계층에 산다.**
 *
 * 2026-09-15 14:06:16 KST 숙대점에서 플레이어 계층이 멈춘 뒤에도 셸은 26분 38초
 * 동안 5초마다 서버와 200 OK 로 왕복하고 있었다. 그런데 14:23:35 에 발행한 복구
 * 명령은 배달되지 않았다 — 수신기가 **죽은 쪽**에 있었기 때문이다.
 *
 * 그래서 수신기를 여기로 옮긴다. 이 컴포넌트는:
 *   • 오디오를 건드리지 않는다.
 *   • 큐·재생 상태를 읽지도 쓰지도 않는다.
 *   • 라우트에 의존하지 않는다(AppShell 이 사는 동안 산다).
 *   • 실패해도 재생을 막지 않는다.
 *
 * 명령의 target·TTL·중복·쿨다운 계약은 그대로 remoteRecovery / remoteRecoveryExecutor
 * 가 판정한다. 여기서 바뀐 것은 **어디서 받는가** 하나뿐이다.
 */
import { useEffect, useId, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { subscribeStoreRecoveryCommands } from '@/lib/api/brandPlayerApi';
import { parseRealtimeCommandRow, type ClientIdentity } from '@/lib/remoteRecovery';
import { handleRemoteCommand } from '@/lib/remoteRecoveryExecutor';
import { getPlayerInstanceId } from '@/lib/playbackFlightRecorder';
import { recordFlightEvent } from '@/lib/playbackFlightRecorder';
import { setRealtimeStatus } from '@/lib/clientLiveness';
import {
  acquireCommandReceiver, releaseCommandReceiver,
  noteShellLayerAlive, readLayerHealth, readControlPlaneIdentity,
  publishControlPlaneIdentity, shouldPollForCommands,
  readPlayerRuntimeAge, beginRecovery, endRecovery, isRecoveryInProgress,
  DEGRADED_POLL_INTERVAL_MS,
} from '@/lib/recoveryControlPlane';
import {
  resolveShellWatchdogAction, describeShellWatchdogAction,
} from '@/lib/shellWatchdog';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { logPlaybackDiagnostic } from '@/lib/playbackDiagnostics';
import { requestControlledReload } from '@/lib/playbackGuard';

/** 셸 생존 표시 주기. 네트워크를 쓰지 않는 로컬 표시라 비용이 없다. */
const SHELL_TICK_MS = 5_000;

/**
 * 플레이어가 멈춘 동안에만 도는 폴백 폴러.
 *
 * 왜 상시가 아닌가 — 정상일 때 명령은 Realtime 으로 1초 안에 닿는다. 거기에 상시
 * 5초 폴링을 얹으면 매장당 하루 17,280 회의 서버 쓰기가 아무 이득 없이 늘어난다.
 * 우리가 필요한 것은 **Realtime 이 못 받는 상황에서의 픽업 시간**이고, 그 상황은
 * 플레이어 계층이 멈췄을 때다. 그때만 켠다.
 *
 * 서버 RPC(brand_player_shell_poll)는 0528 마이그레이션에 있고 **아직 미적용**이다.
 * 적용 전까지 이 폴러는 조용히 아무것도 하지 않는다 — 기능이 없다고 재생이
 * 나빠지지는 않는다.
 */
export interface ShellPollDeps {
  poll: (brandId: string) => Promise<Record<string, unknown> | null>;
}

export interface RecoveryControlPlaneProps {
  deps?: ShellPollDeps;
  /**
   * 29 — 플레이어 subtree 를 새 세대로 다시 띄운다. AppShell 이 `key` 를 올린다.
   *
   * 페이지 재시작보다 **먼저** 쓴다. 문서가 유지되므로 Samsung Internet 의
   * 자동재생 정책을 다시 만나지 않는다(리로드하면 제스처를 요구받을 수 있다).
   */
  onRemountPlayer?: () => void;
}

export default function RecoveryControlPlane({ deps, onRemountPlayer }: RecoveryControlPlaneProps) {
  const storeUserId = useAuthStore((s) => s.user?.id ?? null);
  const ownerId = useId();
  const pollRef = useRef(deps?.poll ?? null);
  pollRef.current = deps?.poll ?? null;
  const remountRef = useRef(onRemountPlayer ?? null);
  remountRef.current = onRemountPlayer ?? null;

  /** 29 — 셸 주도 복구 예산. 문서 수명 동안만 유지된다. */
  const recoveriesUsedRef = useRef(0);
  const lastRecoveryAtRef = useRef<number | null>(null);
  const remountTriedRef = useRef(false);

  /**
   * PLAYER EXECUTION STALE + SHELL ALIVE 를 판정하고, 맞으면 되살린다.
   *
   * 여기서 currentTime 을 폴링하지 않는다 — 그건 플레이어 워치독의 일이고
   * 저사양 Android 에서 CPU 를 쓸 이유가 없다. 이 함수가 보는 것은 **실행 신호의
   * 부재**뿐이다.
   */
  function runShellWatchdog() {
    if (!remountRef.current) return;                 // 되살릴 수단이 없으면 판정도 하지 않는다
    const health = readLayerHealth();
    const p = usePlayerStore.getState();
    const h = usePlaybackHealthStore.getState();
    const now = Date.now();

    const action = resolveShellWatchdogAction({
      playerRuntimeAgeMs: readPlayerRuntimeAge(now),
      shellAgeMs: health.shellAgeMs,
      playing: p.playing,
      hasQueue: p.queue.length > 0,
      suppressed: !!p.scheduleSuppressed,
      autoplayBlocked: h.autoplayBlocked,
      recoveryInProgress: isRecoveryInProgress(),
      recoveriesUsed: recoveriesUsedRef.current,
      msSinceLastRecovery: lastRecoveryAtRef.current === null
        ? null : now - lastRecoveryAtRef.current,
      remountTried: remountTriedRef.current,
      canNavigate: h.online !== false,
    });
    if (action === 'none') return;

    // 조정자 — 플레이어 사다리나 원격 명령이 이미 잡고 있으면 이번 차례를 넘긴다.
    if (!beginRecovery('shell_watchdog')) return;
    try {
      recoveriesUsedRef.current += 1;
      lastRecoveryAtRef.current = now;
      void logPlaybackDiagnostic('player_execution_stale', {
        reason: 'self_heal',
        playerMode: 'brand',
        context: {
          action,
          note: describeShellWatchdogAction(action),
          playerRuntimeAgeMs: readPlayerRuntimeAge(now),
          shellAgeMs: health.shellAgeMs,
          recoveriesUsed: recoveriesUsedRef.current,
        },
      });
      if (action === 'remount_player') {
        remountTriedRef.current = true;
        remountRef.current?.();
      } else if (action === 'reload_page') {
        requestControlledReload('self_heal');
      }
      // 'exhausted' — 기록만 남긴다. 운영자 버튼의 몫이다.
    } finally {
      // 리마운트는 다음 렌더에서 일어난다. 소유권은 쿨다운 뒤에 자연히 풀리도록
      // 여기서 바로 놓는다 — 잡은 채로 두면 플레이어 사다리까지 막힌다.
      endRecovery('shell_watchdog');
    }
  }

  // 타이머가 **최신** 워치독을 부르도록 ref 로 건넨다. 타이머 자체는 한 번만 만든다.
  const runWatchdogRef = useRef<() => void>(() => {});
  runWatchdogRef.current = runShellWatchdog;

  // 셸이 살아 있다는 표시 + 29 워치독.
  // **새 타이머를 만들지 않는다** — 원래 있던 5초 틱 하나에 얹는다.
  useEffect(() => {
    noteShellLayerAlive();
    const id = window.setInterval(() => {
      noteShellLayerAlive();
      runWatchdogRef.current();
    }, SHELL_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // 로그인 사용자를 제어면 신원에 싣는다. 플레이어가 죽어도 남는다.
  useEffect(() => {
    if (storeUserId) publishControlPlaneIdentity({ storeUserId });
  }, [storeUserId]);

  // Realtime 수신 — 여기가 유일한 수신기다(단일 소유권 보장).
  useEffect(() => {
    if (!storeUserId) return;
    if (!acquireCommandReceiver(ownerId)) return;   // 중복 구독 금지
    let sub: { unsubscribe: () => void } | null = null;
    try {
      sub = subscribeStoreRecoveryCommands(
        storeUserId,
        (row) => {
          const id = readControlPlaneIdentity();
          const me: ClientIdentity = {
            // storeUserId 를 빼면 store 단위로 지목된 명령의 target 대조가 틀어진다.
            storeUserId: id.storeUserId,
            sessionId: id.sessionId,
            playerInstanceId: getPlayerInstanceId(),
          };
          handleRemoteCommand(parseRealtimeCommandRow(row), me, 'realtime');
        },
        (status) => {
          recordFlightEvent('REALTIME_CHANNEL_STATUS', { extra: { status, owner: 'shell' } });
          setRealtimeStatus(status);
        },
      );
    } catch {
      /* 구독 실패해도 폴백 폴링과 재생은 그대로 간다 */
    }
    return () => {
      try { sub?.unsubscribe(); } catch { /* noop */ }
      releaseCommandReceiver(ownerId);
    };
  }, [storeUserId, ownerId]);

  // 성능 저하 구간 폴링 — 플레이어가 멈춘 동안에만.
  useEffect(() => {
    if (!storeUserId) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const health = readLayerHealth();
      if (!shouldPollForCommands(health)) return;
      const id = readControlPlaneIdentity();
      const poll = pollRef.current;
      if (!poll || !id.brandId) return;            // 0528 미적용 구간 — 조용히 no-op
      try {
        const row = await poll(id.brandId);
        if (stopped || !row) return;
        const me: ClientIdentity = {
          storeUserId: id.storeUserId,
          sessionId: id.sessionId,
          playerInstanceId: getPlayerInstanceId(),
        };
        handleRemoteCommand(parseRealtimeCommandRow(row), me, 'heartbeat');
      } catch {
        /* 폴링 실패는 조용히 — 다음 tick 이 다시 본다 */
      }
    };
    const timer = window.setInterval(() => { void tick(); }, DEGRADED_POLL_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [storeUserId]);

  return null;
}
