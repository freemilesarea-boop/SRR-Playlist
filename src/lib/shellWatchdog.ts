/**
 * shellWatchdog.ts — "플레이어가 실행 자체를 멈췄는가" 를 셸이 판정한다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * Phase 28 의 failure matrix 에서 유일하게 닫히지 않은 칸이 **I — Player timer
 * loss** 였다. 플레이어 내부 워치독이 플레이어와 같은 실행 도메인에 있으므로,
 * 그 도메인이 통째로 멎으면 워치독도 같이 멎는다. 스스로를 감시할 수 없다.
 *
 * 2026-09-15 14:06:16 KST 숙대점이 정확히 그 모양이었다:
 *   브랜드 heartbeat(60초)와 스트림 heartbeat(10초)가 **동시에** 멎었고,
 *   같은 문서의 AppShell 폴러는 26분 38초 동안 5초마다 200 OK 였다.
 *   플레이어 실행만 사라졌고 셸은 멀쩡했다.
 *
 * 그래서 감시자를 셸에 둔다. 규칙은 Phase 27 과 같다 —
 * **감시자는 감시 대상과 같은 failure domain 에 두지 않는다.**
 *
 * ── 하지 않는 것 ────────────────────────────────────────────────────────────
 *   • currentTime 을 매초 폴링하지 않는다. 그건 플레이어 워치독의 일이고,
 *     저사양 Android 에서 CPU 를 쓸 이유가 없다(Phase 25 사다리가 이미 한다).
 *   • 서버 RPC 를 추가하지 않는다.
 *   • localStorage 에 주기적으로 쓰지 않는다.
 *   • 새 타이머를 만들지 않는다 — 제어면의 기존 5초 틱에 얹는다.
 *
 * 이 파일은 순수 판정만 한다. 신호 수집은 recoveryControlPlane, 실행은
 * RecoveryControlPlane 컴포넌트가 한다.
 */
import { RELOAD_PAGE_AFTER_MS } from '@/lib/stallWatchdog';

/**
 * 플레이어 런타임이 "멎었다" 고 볼 시간.
 *
 * 런타임 생존 신호는 플레이어의 3초 워커 티커가 찍는다(backgroundTicker).
 * 새 숫자를 만들지 않고 이 프로젝트가 이미 쓰는 값을 그대로 쓴다 —
 * RELOAD_PAGE_AFTER_MS(150초)는 **플레이어가 자기 사다리를 끝까지 다 쓰는 데
 * 걸리는 시간**이다. 그만큼 조용하면 3초 티커를 50번 연속 놓친 것이고,
 * 사다리가 돌고 있을 가능성도 없다(사다리는 그 티커 위에서 돈다).
 *
 * 더 짧게 잡지 않는 이유: 저사양 Android 가 CPU 압박으로 워커 틱을 잠깐
 * 굶길 수 있다. 멀쩡한 플레이어를 리마운트하는 것이 무음보다 낫지 않다.
 */
export const PLAYER_RUNTIME_STALE_MS = RELOAD_PAGE_AFTER_MS;

/**
 * 한 문서 수명 동안 허용하는 셸 주도 복구 횟수.
 *
 * 무한 복구 루프를 막는다. 3번이면 remount 2회 + 페이지 재시작 1회가 되고,
 * 그래도 안 살아나면 웹이 할 수 있는 일은 끝났다 — 운영자 버튼의 몫이다.
 */
export const SHELL_RECOVERY_BUDGET = 3;

/** 복구 시도 사이 최소 간격. 리마운트가 자리 잡을 시간을 준다. */
export const SHELL_RECOVERY_COOLDOWN_MS = 60_000;

export interface ShellWatchdogInput {
  /** 플레이어 런타임 티커가 마지막으로 찍은 뒤 경과(ms). null = 한 번도 못 받음. */
  playerRuntimeAgeMs: number | null;
  /** 셸 자신이 마지막으로 돈 뒤 경과(ms). */
  shellAgeMs: number | null;

  /* ── 정상 상태와 구분하기 위한 맥락 (§9 오탐 방지) ── */
  /** 스토어가 재생 중이라고 말하는가. 의도적 일시정지면 false. */
  playing: boolean;
  /** 큐에 틀 곡이 있는가. */
  hasQueue: boolean;
  /** 영업 종료 등으로 스케줄이 재생을 막고 있는가. */
  suppressed: boolean;
  /** 브라우저 자동재생 정책에 막혀 제스처를 기다리는가. */
  autoplayBlocked: boolean;
  /** 이미 다른 주체가 복구를 돌리고 있는가(플레이어 사다리·원격 명령·이전 셸 복구). */
  recoveryInProgress: boolean;

  /* ── 예산 ── */
  recoveriesUsed: number;
  msSinceLastRecovery: number | null;
  /** 리마운트를 이미 써봤는가. 그러면 다음 칸은 페이지 재시작이다. */
  remountTried: boolean;
  /** 페이지 이동이 가능한 상태인가(오프라인이면 재시작이 더 위험하다). */
  canNavigate: boolean;
}

export type ShellWatchdogAction =
  /** 아무것도 하지 않는다. */
  | 'none'
  /** 플레이어 subtree 를 새 세대로 리마운트한다. 문서는 유지되므로 자동재생 정책을 다시 만나지 않는다. */
  | 'remount_player'
  /** 리마운트로도 안 살아났다. 문서를 다시 띄운다. */
  | 'reload_page'
  /** 웹이 할 수 있는 것을 다 썼다. 운영자 버튼의 몫이다. */
  | 'exhausted';

/**
 * 지금 셸이 개입해야 하는가.
 *
 * 판정 순서가 곧 안전 순서다 — 먼저 "개입하면 안 되는 이유" 를 전부 거른 뒤에야
 * 사다리를 본다.
 */
export function resolveShellWatchdogAction(i: ShellWatchdogInput): ShellWatchdogAction {
  // 셸 자신이 안 돌면 이 판정 자체가 의미 없다.
  if (i.shellAgeMs === null) return 'none';

  // ── §9 오탐 방지 — 이 중 하나라도 참이면 플레이어는 "죽은" 것이 아니다.
  if (!i.playing) return 'none';            // 의도적 정지
  if (!i.hasQueue) return 'none';           // 틀 곡이 없다
  if (i.suppressed) return 'none';          // 영업 종료
  if (i.autoplayBlocked) return 'none';     // 제스처 대기 — 리마운트로 못 푼다
  if (i.recoveryInProgress) return 'none';  // 남이 이미 고치는 중

  // 런타임이 살아 있으면 끝. 소리가 안 나는 문제라면 플레이어 사다리의 일이다.
  if (i.playerRuntimeAgeMs === null) return 'none';   // 아직 한 번도 못 받았다 = 모른다
  if (i.playerRuntimeAgeMs < PLAYER_RUNTIME_STALE_MS) return 'none';

  // ── 여기부터 PLAYER EXECUTION STALE + SHELL ALIVE
  if (i.recoveriesUsed >= SHELL_RECOVERY_BUDGET) return 'exhausted';
  if (i.msSinceLastRecovery !== null && i.msSinceLastRecovery < SHELL_RECOVERY_COOLDOWN_MS) {
    return 'none';                          // 방금 고쳤다. 자리 잡을 시간을 준다.
  }

  // §17 — 리마운트를 먼저 쓴다. 문서가 유지되므로 Samsung Internet 의 자동재생
  // 정책을 다시 만나지 않는다. 페이지 재시작은 그 뒤다.
  if (!i.remountTried) return 'remount_player';
  return i.canNavigate ? 'reload_page' : 'none';
}

/** 사람에게 보여줄 한 줄. 되는 척하지 않는다. */
export function describeShellWatchdogAction(a: ShellWatchdogAction): string {
  switch (a) {
    case 'none': return '정상';
    case 'remount_player': return '플레이어 실행이 멎어 새로 띄웁니다';
    case 'reload_page': return '플레이어를 다시 띄워도 살아나지 않아 페이지를 재시작합니다';
    case 'exhausted': return '웹으로 복구할 수 있는 것을 모두 시도했습니다 — 운영자 확인 필요';
  }
}

/**
 * 셸 복구가 성공했다고 말할 수 있는 조건.
 *
 * remount 했다 / heartbeat 가 돌아왔다 는 성공이 아니다. One-Click 과 같은 계약이다.
 */
export interface ShellRecoveryVerdictInput {
  /** 복구 뒤 런타임 신호가 돌아왔는가. */
  playerRuntimeAgeMs: number | null;
  /** 복구 뒤 관측한 **실제** currentTime 진행 표본 수. */
  progressSamples: number;
}

export const REQUIRED_PROGRESS_SAMPLES = 2;

export function isShellRecoveryVerified(i: ShellRecoveryVerdictInput): boolean {
  if (i.playerRuntimeAgeMs === null) return false;
  if (i.playerRuntimeAgeMs >= PLAYER_RUNTIME_STALE_MS) return false;
  return i.progressSamples >= REQUIRED_PROGRESS_SAMPLES;
}
