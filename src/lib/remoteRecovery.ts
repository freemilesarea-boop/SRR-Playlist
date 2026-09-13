/**
 * remoteRecovery.ts — 원격 복구 명령을 "실행할지" 만 판정한다.
 *
 * 0518 의 heartbeat 배달 경로를 확장한 것이다. 병렬 시스템이 아니다.
 * 실제 부수효과(hard recovery, controlled reload, play, next)는 훅이 수행한다 —
 * 판정을 순수 함수로 떼어내야 **남의 매장 명령이 실행되지 않는다**는 것을
 * 테스트로 못 박을 수 있다.
 *
 * ── 절대 규칙 ───────────────────────────────────────────────────────────────
 *  • target 이 하나도 없는 명령은 실행하지 않는다 (broadcast 금지)
 *  • target 우선순위: player_instance_id → session_id → store_user_id
 *    가장 구체적인 target 이 지정돼 있으면 **그것만** 본다. 상위가 맞아도
 *    구체적 target 이 어긋나면 실행하지 않는다.
 *  • TTL 이 지난 명령은 실행하지 않는다 — 몇 시간 꺼져 있던 기기가 켜지면서
 *    옛 reload 를 실행하는 사고를 막는다.
 *  • 같은 command_id 는 정확히 1회. Realtime 과 heartbeat 로 중복 수신돼도 1회.
 */

/** 서버가 배달할 수 있는 명령. app_restart/device_reboot 는 웹이 실행하지 않는다. */
export type RemoteCommand = 'reload' | 'play' | 'next' | 'hard_recovery';

/** 웹 클라이언트가 실행하는 명령 화이트리스트. 이 밖의 값은 전부 무시한다. */
export const EXECUTABLE_COMMANDS: readonly string[] = ['reload', 'play', 'next', 'hard_recovery'];

/** 서버에서 온 명령 한 건 (heartbeat 응답 또는 Realtime row). */
export interface RemoteCommandEnvelope {
  commandId: string | null | undefined;
  command: string | null | undefined;
  /** TTL. 없으면(구버전 heartbeat 응답) 만료 검사를 건너뛴다. */
  expiresAt?: string | number | null;
  targetSessionId?: string | null;
  targetPlayerInstanceId?: string | null;
  storeUserId?: string | null;
}

/** 이 클라이언트가 누구인가. */
export interface ClientIdentity {
  storeUserId: string | null;
  sessionId: string | null;
  playerInstanceId: string | null;
}

export type RemoteCommandDecision =
  | { kind: 'run'; command: RemoteCommand; commandId: string }
  | { kind: 'skip'; reason: 'no_command' | 'unknown_command' | 'expired' | 'wrong_target' | 'duplicate' };

/**
 * 이 명령을 실행할 것인가.
 *
 * @param env       서버에서 온 명령
 * @param me        이 클라이언트의 신원
 * @param alreadyDone 이미 실행한 command_id 집합
 * @param nowMs     현재 시각(ms). 테스트에서 주입한다.
 */
export function decideRemoteCommand(
  env: RemoteCommandEnvelope | null | undefined,
  me: ClientIdentity,
  alreadyDone: ReadonlySet<string>,
  nowMs: number = Date.now(),
): RemoteCommandDecision {
  if (!env) return { kind: 'skip', reason: 'no_command' };

  const { commandId, command } = env;
  if (!commandId || !command) return { kind: 'skip', reason: 'no_command' };
  if (!EXECUTABLE_COMMANDS.includes(command)) return { kind: 'skip', reason: 'unknown_command' };
  if (alreadyDone.has(commandId)) return { kind: 'skip', reason: 'duplicate' };
  if (isExpired(env.expiresAt, nowMs)) return { kind: 'skip', reason: 'expired' };
  if (!matchesTarget(env, me)) return { kind: 'skip', reason: 'wrong_target' };

  return { kind: 'run', command: command as RemoteCommand, commandId };
}

/** TTL 판정. 값이 없으면 만료로 보지 않는다(구버전 응답 호환). */
export function isExpired(expiresAt: string | number | null | undefined, nowMs: number): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return false;
  const t = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;   // 파싱 실패는 만료로 취급하지 않는다
  return t <= nowMs;
}

/**
 * target 일치 판정.
 *
 * 가장 구체적인 target 하나만 본다. player_instance 가 지정됐는데 다르면,
 * session/store 가 맞아도 **실행하지 않는다** — 옛 탭에 명령이 꽂히는 사고를 막는다.
 */
export function matchesTarget(env: RemoteCommandEnvelope, me: ClientIdentity): boolean {
  const { targetPlayerInstanceId: pid, targetSessionId: sid, storeUserId: store } = env;

  if (pid) return !!me.playerInstanceId && me.playerInstanceId === pid;
  if (sid) return !!me.sessionId && me.sessionId === sid;
  if (store) return !!me.storeUserId && me.storeUserId === store;

  // target 이 하나도 없다 = broadcast. 절대 실행하지 않는다.
  return false;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 리로드 상관관계 — 명령 → 리로드 → 새 세션                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const PENDING_RELOAD_KEY = 'deudda:remote-reload-cmd';

/** 원격 reload 직전에 남긴다. 리로드 뒤 새 세션이 이걸 읽어 결과를 보고한다. */
export interface PendingRemoteReload {
  commandId: string;
  at: number;
}

export function markPendingRemoteReload(commandId: string, nowMs: number = Date.now()): void {
  try {
    sessionStorage.setItem(PENDING_RELOAD_KEY, JSON.stringify({ commandId, at: nowMs }));
  } catch { /* 저장소 차단 환경 — 상관관계만 잃는다 */ }
}

/**
 * 리로드 뒤 꺼내 본다(1회성).
 * 너무 오래된 것은 버린다 — 어제 리로드의 명령을 오늘 성공으로 보고하면 안 된다.
 */
export function takePendingRemoteReload(
  nowMs: number = Date.now(),
  maxAgeMs = 5 * 60 * 1000,
): PendingRemoteReload | null {
  try {
    const raw = sessionStorage.getItem(PENDING_RELOAD_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_RELOAD_KEY);
    const p = JSON.parse(raw) as Partial<PendingRemoteReload>;
    if (typeof p.commandId !== 'string' || typeof p.at !== 'number') return null;
    if (nowMs - p.at > maxAgeMs) return null;
    return { commandId: p.commandId, at: p.at };
  } catch {
    return null;
  }
}

/**
 * 리로드 후 결과 판정.
 *
 * **점주 터치가 필요한 상태를 성공으로 처리하지 않는다.** 자동재생이 막혔으면
 * 소리는 안 나고 있는 것이므로 실패다.
 */
export type ReloadOutcome =
  | { status: 'succeeded' }
  | { status: 'failed'; resultCode: 'REMOTE_RELOAD_AUTOPLAY_BLOCKED' | 'REMOTE_RELOAD_NO_PROGRESS' };

export function judgeReloadOutcome(i: {
  autoplayBlocked: boolean;
  /** 리로드 후 실제로 재생 위치가 움직였는가. */
  progressed: boolean;
}): ReloadOutcome {
  if (i.autoplayBlocked) {
    return { status: 'failed', resultCode: 'REMOTE_RELOAD_AUTOPLAY_BLOCKED' };
  }
  if (i.progressed) return { status: 'succeeded' };
  return { status: 'failed', resultCode: 'REMOTE_RELOAD_NO_PROGRESS' };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 클라이언트측 쿨다운 — 서버 쿨다운의 2차 방어                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const HARD_RECOVERY_COOLDOWN_MS = 60_000;

/** 마지막 실행 이후 충분히 지났는가. */
export function allowRemoteCommand(
  command: RemoteCommand,
  lastRunAtMs: number | null,
  nowMs: number,
): boolean {
  if (lastRunAtMs === null) return true;
  // reload 는 Player 의 기존 10분 controlled-reload 쿨다운이 담당한다.
  if (command !== 'hard_recovery') return true;
  return nowMs - lastRunAtMs >= HARD_RECOVERY_COOLDOWN_MS;
}
