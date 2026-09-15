/**
 * recoveryControlPlane.ts — 복구 제어면(control plane)의 상태와 판정.
 *
 * ── 왜 이 파일이 생겼나 ──────────────────────────────────────────────────────
 * 2026-09-15 14:06:16 KST 숙대점. Supabase edge 로그가 남긴 사실:
 *
 *   14:05:19  brand_player_heartbeat 200        ← 마지막
 *   14:06:16  start_stream_session_v2 200       ← 플레이어 계층 마지막 호출
 *   14:06:16 ~ 14:32:54  브랜드/스트림 하트비트 0건
 *             그동안 store_get_active_emergency_broadcasts 가 **5초마다 200 OK**
 *             (167건). 같은 문서, 같은 IP, 라우트 변경 0건(visitor_events 1건뿐).
 *
 * 즉 **브라우저도 네트워크도 멀쩡했다.** 26분 38초 동안 서버와 5초마다 왕복하는
 * 살아 있는 실행 컨텍스트가 있었다. 그런데 14:23:35 에 발행한 원격 복구 명령은
 * 배달되지 않고 TTL 만료됐다.
 *
 * 이유는 구조였다. 명령 수신기가 **복구 대상과 같은 failure domain** 에 있었다:
 *
 *   BrandPlayerPage                      AppShell
 *     ├─ useBrandPlayerHeartbeat           ├─ <Player/>
 *     │    ├─ 60s heartbeat  (fallback)    └─ GlobalStoreAudioOverlays (5s poll)
 *     │    └─ Realtime 구독  (주 경로)          ↑ 26분간 살아 있었다
 *     └─ …                                     ↓
 *          ↑ 둘 다 여기서 죽었다              여기서 받았어야 했다
 *
 * 그래서 규칙을 하나 세운다:
 *
 *   **복구 시스템은 복구 대상과 같은 failure domain 에 두지 않는다.**
 *
 * 이 파일은 그 제어면의 "머리"다 — DOM·React·네트워크를 모르고, 사실만 받아
 * 판정만 한다. 실제 구독과 폴링은 RecoveryControlPlane.tsx 가, 명령 실행은
 * remoteRecoveryExecutor 가 한다.
 *
 * ── 이 파일이 하지 않는 것 ──────────────────────────────────────────────────
 *   • 오디오를 건드리지 않는다.
 *   • 명령을 스스로 만들지 않는다. 운영자가 발행한 것만 판정한다.
 *   • target/TTL/중복/쿨다운 계약을 다시 쓰지 않는다 — remoteRecovery.ts 가 정본이고
 *     여기서는 **어느 계층이 살아 있는가**만 답한다.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* 신원 — 플레이어 계층이 죽어도 남아 있어야 하는 값                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 제어면이 명령을 받고 target 을 대조하려면 세 가지가 필요하다:
 *   storeUserId — Realtime 필터 키(brand_player_commands.store_user_id)
 *   sessionId   — 이 install 의 안정적 식별자. heartbeat 응답이 알려준다.
 *   brandId     — 폴백 폴링이 세션 토큰을 찾을 때 쓴다.
 *
 * ★ 이 값들은 **모듈 스코프에 남는다.** 플레이어 계층이 죽어도 지워지지 않는다.
 *   그것이 요점이다 — 2026-09-15 에 신원은 끝까지 유효했고, 그 신원을 들고 있던
 *   훅만 죽었다.
 */
export interface ControlPlaneIdentity {
  storeUserId: string | null;
  sessionId: string | null;
  brandId: string | null;
}

let identity: ControlPlaneIdentity = { storeUserId: null, sessionId: null, brandId: null };

/** 알게 된 값만 갱신한다. null 로 지우지 않는다 — 플레이어가 죽으며 신원을 지우면 안 된다. */
export function publishControlPlaneIdentity(next: Partial<ControlPlaneIdentity>): void {
  identity = {
    storeUserId: next.storeUserId ?? identity.storeUserId,
    sessionId: next.sessionId ?? identity.sessionId,
    brandId: next.brandId ?? identity.brandId,
  };
}

export function readControlPlaneIdentity(): ControlPlaneIdentity {
  return identity;
}

/** 로그아웃·기기 연결 해제 등 **명시적** 종료에서만 부른다. */
export function clearControlPlaneIdentity(): void {
  identity = { storeUserId: null, sessionId: null, brandId: null };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 계층별 생존 — PLAYER HEALTH vs SHELL HEALTH                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 2026-09-15 에 서버는 "클라이언트가 죽었다"고 판단했다. 틀렸다. 셸은 살아 있었다.
 * 서버가 그걸 알 방법이 없었던 이유는 **두 계층이 같은 신호를 공유했기 때문**이다.
 * heartbeat 하나가 멈추면 전부 죽은 것처럼 보였다.
 *
 * 여기서 두 신호를 나눈다:
 *   player — 플레이어 계층(BrandPlayerPage/heartbeat)이 마지막으로 돈 시각
 *   shell  — 셸 계층(AppShell 폴러/제어면)이 마지막으로 돈 시각
 *
 * 둘의 조합이 곧 복구 사다리의 칸이다.
 */
let lastPlayerTickAt = 0;
let lastShellTickAt = 0;
/**
 * 29 — 플레이어 **런타임** 생존. 위의 lastPlayerTickAt(60초 heartbeat)과 다르다.
 *
 * 플레이어의 3초 워커 티커가 찍는다. 2026-09-15 에 멎은 것이 바로 이 층이고,
 * 60초 heartbeat 보다 20배 촘촘해서 실행 상실을 훨씬 빨리 드러낸다.
 * 모듈 변수 한 줄 대입이라 렌더도 네트워크도 저장소도 건드리지 않는다.
 */
let lastPlayerRuntimeTickAt = 0;

export function notePlayerLayerAlive(nowMs: number = Date.now()): void {
  if (nowMs > lastPlayerTickAt) lastPlayerTickAt = nowMs;
}

export function noteShellLayerAlive(nowMs: number = Date.now()): void {
  if (nowMs > lastShellTickAt) lastShellTickAt = nowMs;
}

/** 플레이어 런타임 티커가 한 바퀴 돌았다. 플레이어의 3초 티커에서만 부른다. */
export function notePlayerRuntimeAlive(nowMs: number = Date.now()): void {
  if (nowMs > lastPlayerRuntimeTickAt) lastPlayerRuntimeTickAt = nowMs;
}

/** 런타임 신호 나이(ms). 한 번도 못 받았으면 null — "모른다" 이지 "죽었다" 가 아니다. */
export function readPlayerRuntimeAge(nowMs: number = Date.now()): number | null {
  return lastPlayerRuntimeTickAt === 0 ? null : Math.max(0, nowMs - lastPlayerRuntimeTickAt);
}

/** 테스트 전용 — 모듈 상태를 되돌린다. */
export function __resetControlPlaneForTest(): void {
  identity = { storeUserId: null, sessionId: null, brandId: null };
  lastPlayerTickAt = 0;
  lastShellTickAt = 0;
  lastPlayerRuntimeTickAt = 0;
  receiverOwner = null;
  recoveryOwner = null;
}

export interface LayerHealth {
  /** 마지막 신호 이후 경과(ms). 한 번도 받은 적 없으면 null — "모른다"이지 "죽었다"가 아니다. */
  playerAgeMs: number | null;
  shellAgeMs: number | null;
}

export function readLayerHealth(nowMs: number = Date.now()): LayerHealth {
  return {
    playerAgeMs: lastPlayerTickAt === 0 ? null : Math.max(0, nowMs - lastPlayerTickAt),
    shellAgeMs: lastShellTickAt === 0 ? null : Math.max(0, nowMs - lastShellTickAt),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 임계값 — 새 숫자를 만들지 않는다                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 플레이어 계층이 "멈췄다"고 볼 시간.
 *
 * heartbeat 주기가 60초(useBrandPlayerHeartbeat.HEARTBEAT_INTERVAL_MS)다.
 * 2회 결측 = 120초면 주기 지터나 한 번의 네트워크 실패로는 설명되지 않는다.
 * 서버 쪽 SUSPECTED_DOWN(180초, playerDownDetection.SUSPECTED_DOWN_AFTER_S)보다
 * **앞선다** — 클라이언트가 서버보다 먼저 알아채고 스스로 폴백을 켜야,
 * 운영자가 버튼을 누르는 그 순간에는 이미 받을 준비가 되어 있다.
 */
export const PLAYER_LAYER_STALE_MS = 120_000;

/**
 * 셸 계층이 "멈췄다"고 볼 시간.
 *
 * 셸 폴러 주기는 5초다(AnnouncementOverlay.POLL_INTERVAL_MS 계열, 2026-09-15
 * 실기기에서 26분 38초 동안 5초 간격 유지가 실측됨). 그 12배를 넘게 조용하면
 * 문서 자체가 사라졌다고 본다. 이 값은 셸이 죽었을 때만 참이어야 하므로
 * 넉넉하게 잡는다 — 여기서 성급하면 멀쩡한 셸을 "웹 복구 불가"로 오분류한다.
 */
export const SHELL_LAYER_STALE_MS = 60_000;

/* ────────────────────────────────────────────────────────────────────────── */
/* 복구 사다리 — 운영자는 종류를 고르지 않는다                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * RUNG 1 player_recovery        플레이어가 살아 있다 → 기존 경로(play/next/hard_recovery)
 * RUNG 2 player_subtree_recovery 플레이어는 죽고 셸은 살아 있다 → 제어면이 받아서 되살린다
 * RUNG 3 web_client_unreachable  셸도 조용하다 → 웹으로 할 수 있는 것이 없다
 *
 * RUNG 3 에서 이번 Phase 는 **아무것도 시도하지 않는다.** 네이티브 supervisor 가
 * 없으면 죽은 브라우저 프로세스를 되살릴 수 없고(플랫폼 제약), 되는 척하면
 * 운영자가 버튼을 누르고 기다리다 매장을 더 오래 조용하게 만든다.
 */
export type RecoveryRung = 'player_recovery' | 'player_subtree_recovery' | 'web_client_unreachable';

export interface RungInput {
  playerAgeMs: number | null;
  shellAgeMs: number | null;
}

export function resolveRecoveryRung(
  i: RungInput,
  playerStaleMs: number = PLAYER_LAYER_STALE_MS,
  shellStaleMs: number = SHELL_LAYER_STALE_MS,
): RecoveryRung {
  const shellDead = i.shellAgeMs === null || i.shellAgeMs >= shellStaleMs;
  if (shellDead) return 'web_client_unreachable';
  const playerFresh = i.playerAgeMs !== null && i.playerAgeMs < playerStaleMs;
  return playerFresh ? 'player_recovery' : 'player_subtree_recovery';
}

/** 사람에게 보여줄 문구. 되는 척하지 않는다. */
export function describeRung(rung: RecoveryRung): string {
  switch (rung) {
    case 'player_recovery':
      return '플레이어 응답 중 — 재생 복구를 시도합니다';
    case 'player_subtree_recovery':
      return '플레이어만 멈춤 — 앱은 살아 있어 복구를 시도합니다';
    case 'web_client_unreachable':
      return '기기 응답 없음 — 웹 복구 불가';
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 폴백 폴링 — 필요할 때만 켠다                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 왜 상시 5초 폴링을 넣지 않는가.
 *
 * 정상일 때 명령은 Realtime 으로 1초 안에 닿는다. 거기에 5초 폴링을 상시로 얹으면
 * 매장 수 x 17,280회/일 의 서버 쓰기가 아무 이득 없이 늘어난다. 우리가 필요한 것은
 * **Realtime 이 못 받는 상황에서의 픽업 시간**이고, 그 상황은 플레이어 계층이
 * 멈췄을 때다(2026-09-15 가 정확히 그랬다).
 *
 * 그래서: 평소 0회, 플레이어가 멈춘 동안만 5초. 필요할 때만 비용을 낸다.
 */
export const DEGRADED_POLL_INTERVAL_MS = 5_000;

export function shouldPollForCommands(
  i: RungInput,
  playerStaleMs: number = PLAYER_LAYER_STALE_MS,
): boolean {
  if (i.shellAgeMs === null) return false;           // 셸이 안 돌면 폴링할 주체도 없다
  return i.playerAgeMs === null || i.playerAgeMs >= playerStaleMs;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 단일 수신기 보장                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 같은 문서에 Realtime 구독이 두 개 생기면 명령이 두 번 실행될 수 있다.
 * (실행부의 executedCommandIds 가 막아주지만, 거기까지 가기 전에 막는 편이 낫다.)
 *
 * 플레이어 계층에서 구독을 떼어내는 이번 변경에서 특히 중요하다 — 옮기는 도중
 * 양쪽이 다 구독하는 순간이 생기면 안 된다.
 */
let receiverOwner: string | null = null;

export function acquireCommandReceiver(ownerId: string): boolean {
  if (receiverOwner !== null && receiverOwner !== ownerId) return false;
  receiverOwner = ownerId;
  return true;
}

export function releaseCommandReceiver(ownerId: string): void {
  if (receiverOwner === ownerId) receiverOwner = null;
}

export function currentCommandReceiver(): string | null {
  return receiverOwner;
}


/* ────────────────────────────────────────────────────────────────────────── */
/* 복구 조정자 — 셋이 동시에 고치려 들지 않게                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 29 — 복구 주체가 셋이 됐다:
 *   • 플레이어 사다리(25)      — nudge / reload / skip / hard_reset
 *   • 원격 복구 명령(27)       — 운영자 [매장 긴급 복구]
 *   • 셸 워치독(29)            — 플레이어 실행 상실
 *
 * 이들이 동시에 움직이면 중복 reload · 중복 skip · 중복 remount 가 난다.
 * 하나만 잡도록 최소한의 소유권을 둔다. 실패해도 재생을 막지 않는다 —
 * 잡지 못한 쪽은 그냥 이번 차례를 건너뛴다.
 */
export type RecoveryOwner = 'player_ladder' | 'remote_command' | 'shell_watchdog';

let recoveryOwner: RecoveryOwner | null = null;

/** 복구를 시작한다. 이미 남이 잡고 있으면 false — 그때는 아무것도 하지 않는다. */
export function beginRecovery(owner: RecoveryOwner): boolean {
  if (recoveryOwner !== null && recoveryOwner !== owner) return false;
  recoveryOwner = owner;
  return true;
}

/** 자기가 잡은 것만 놓는다. */
export function endRecovery(owner: RecoveryOwner): void {
  if (recoveryOwner === owner) recoveryOwner = null;
}

export function isRecoveryInProgress(): boolean {
  return recoveryOwner !== null;
}

export function currentRecoveryOwner(): RecoveryOwner | null {
  return recoveryOwner;
}
