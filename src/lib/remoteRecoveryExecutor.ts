/**
 * remoteRecoveryExecutor.ts — 원격 복구 명령의 **단일 실행부**.
 *
 * 배달 경로는 둘이다:
 *   • Realtime  (postgres_changes, 기본 경로 — 1초 내)
 *   • heartbeat (60초 폴링, fallback — WebSocket 이 죽어도 닿는다)
 *
 * 두 경로는 **반드시 이 파일 하나를 통과한다.** 실행부가 갈라지면 한쪽만 고쳐지고
 * 다른 쪽이 남는다. 여기 모아두면 "같은 명령이 두 번 실행되지 않는다" 를 경로 조합과
 * 무관하게 한 번만 증명하면 된다.
 *
 * ── 실행하지 않는 경우 (decideRemoteCommand 가 판정) ────────────────────────
 *   target 불일치 · TTL 만료 · 종결 상태 · 중복 command_id · 미지의 명령
 *
 * ── exactly once ────────────────────────────────────────────────────────────
 *   실행 **직전**에 command_id 를 기록한다. 실행 도중 페이지가 리로드되어도
 *   기록이 남아 새 페이지가 같은 명령을 다시 실행하지 않는다.
 */
import { usePlayerStore } from '@/store/playerStore';
import { ackStoreRecovery } from '@/lib/api/brandPlayerApi';
import { runRegisteredHardRecovery } from '@/lib/hardRecovery';
import { requestControlledReload } from '@/lib/playbackGuard';
import { restartNativeApp } from '@/lib/storePlaybackService';
import {
  decideRemoteCommand, markPendingRemoteReload,
  executedCommandIds, rememberExecutedCommand,
  type ClientIdentity, type RemoteCommand, type RemoteCommandDecision,
  type RemoteCommandEnvelope,
} from '@/lib/remoteRecovery';
import { recordFlightEvent, buildHash, getPlayerInstanceId } from '@/lib/playbackFlightRecorder';

/** 이 명령이 어느 경로로 닿았는가. 사후에 Realtime 이 실제로 도는지 판별한다. */
export type DeliverySource = 'realtime' | 'heartbeat';

/** 실행부가 건드리는 바깥 세계. 테스트에서 통째로 갈아끼운다. */
export interface ExecutorDeps {
  ack: (commandId: string, status: 'executing' | 'succeeded' | 'failed' | 'rejected', resultCode?: string) => void;
  markPendingReload: (commandId: string) => void;
  controlledReload: (reason: string) => boolean;
  hardRecovery: () => boolean;
  play: () => void;
  next: () => void;
  /** 네이티브 쉘에서 WebView/Activity 를 다시 만든다. 웹에서는 호출되지 않는다. */
  restartApp: () => Promise<boolean>;
}

export const defaultExecutorDeps: ExecutorDeps = {
  ack: (commandId, status, resultCode) => {
    // fire-and-forget. ACK 실패가 복구를 막으면 안 된다.
    void ackStoreRecovery(
      commandId, status, resultCode,
      buildHash(), getPlayerInstanceId() ?? undefined,
    );
  },
  markPendingReload: (commandId) => markPendingRemoteReload(commandId),
  controlledReload: (reason) => requestControlledReload(reason),
  hardRecovery: () => runRegisteredHardRecovery(),
  play: () => usePlayerStore.getState().play(),
  next: () => usePlayerStore.getState().next({ cause: 'manual_next' }),
  restartApp: () => restartNativeApp(),
};

/**
 * 판정된 명령을 실행한다. 부수효과만 담당한다 — 실행 여부 판단은 호출자가 끝냈다.
 * 어떤 예외도 밖으로 던지지 않는다: 명령 실패가 재생을 멈추면 안 된다.
 */
export function executeRemoteCommand(
  command: RemoteCommand,
  commandId: string,
  source: DeliverySource,
  deps: ExecutorDeps = defaultExecutorDeps,
): void {
  try {
    if (command === 'reload') {
      // ⚠ window.location.reload() 를 직접 부르지 않는다.
      // 직접 호출하면 markReloadReason(사유 기록) · 10분 쿨다운 · Flight Recorder
      // 상관관계를 전부 우회한다. 반드시 controlled reload 경로를 쓴다.
      deps.ack(commandId, 'executing');
      deps.markPendingReload(commandId);
      const started = deps.controlledReload(`remote recovery reload (${source})`);
      // 쿨다운에 막혔다 — 성공처럼 보고하지 않는다.
      if (!started) deps.ack(commandId, 'rejected', 'REMOTE_RELOAD_COOLDOWN');
      return;
    }
    if (command === 'hard_recovery') {
      // 프로덕션에 이미 배포된 Hard Recovery 경로를 그대로 부른다.
      // 성공 판정(실제 currentTime 진행)은 Player 의 verifyHardReset 이 담당한다.
      deps.ack(commandId, 'executing');
      const ok = deps.hardRecovery();
      if (!ok) deps.ack(commandId, 'failed', 'HARD_RECOVERY_UNAVAILABLE');
      return;
    }
    if (command === 'app_restart') {
      // 네이티브 전용. 여기까지 왔다는 것은 decideRemoteCommand 가 네이티브임을
      // 확인했다는 뜻이다. **기기 재부팅이 아니라 WebView/Activity 재생성이다.**
      // 성공 판정은 재시작 후 새 세션의 실제 재생 진행이 담당한다 — 여기서
      // succeeded 로 닫지 않는다.
      deps.ack(commandId, 'executing');
      void deps.restartApp().then((started) => {
        if (!started) deps.ack(commandId, 'failed', 'APP_RESTART_UNAVAILABLE');
      });
      return;
    }
    if (command === 'play') { deps.play(); deps.ack(commandId, 'succeeded'); return; }
    if (command === 'next') { deps.next(); deps.ack(commandId, 'succeeded'); }
  } catch {
    /* silent — 명령 실패가 재생을 망가뜨리면 안 된다 */
  }
}

/**
 * 배달된 명령 하나를 처리한다. **두 경로의 유일한 진입점.**
 *
 * 반환값은 판정 결과다(테스트·관측용). 실행했으면 kind === 'run'.
 */
export function handleRemoteCommand(
  env: RemoteCommandEnvelope | null | undefined,
  me: ClientIdentity,
  source: DeliverySource,
  deps: ExecutorDeps = defaultExecutorDeps,
  nowMs: number = Date.now(),
): RemoteCommandDecision {
  const decision = decideRemoteCommand(env, me, executedCommandIds(), nowMs);

  if (decision.kind !== 'run') {
    // no_command 는 대부분의 heartbeat 응답이라 기록하지 않는다(링버퍼 낭비).
    if (decision.reason !== 'no_command') {
      recordFlightEvent('REMOTE_COMMAND_SKIPPED', {
        extra: { source, reason: decision.reason, commandId: env?.commandId ?? null },
      });
    }
    // 이 런타임이 못 하는 명령은 **조용히 무시하지 않고 거부로 보고한다.**
    // 그래야 운영자가 "보냈는데 아무 일도 안 일어난다" 로 시간을 쓰지 않는다.
    if (decision.reason === 'unsupported_runtime' && env?.commandId) {
      rememberExecutedCommand(env.commandId);   // 같은 명령을 반복해 거부하지 않는다
      deps.ack(env.commandId, 'rejected', decision.resultCode ?? 'UNSUPPORTED_RUNTIME');
    }
    return decision;
  }

  // 실행 **직전**에 기록한다. reload 는 이 줄 다음에 페이지가 사라진다.
  rememberExecutedCommand(decision.commandId);
  recordFlightEvent('REMOTE_COMMAND_RECEIVED', {
    extra: { source, command: decision.command, commandId: decision.commandId },
  });

  executeRemoteCommand(decision.command, decision.commandId, source, deps);
  return decision;
}
