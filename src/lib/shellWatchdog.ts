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
import { RELOAD_PAGE_AFTER_MS, SKIP_AFTER_MS } from '@/lib/stallWatchdog';

/**
 * ── 30 — 왜 임계값이 둘인가 (타이머 구조의 비대칭) ─────────────────────────
 *
 * 두 계층의 타이머는 성질이 다르다:
 *
 *   플레이어 런타임 신호 : 3초 **Web Worker** 티커 (backgroundTicker)
 *                          → 백그라운드 스로틀링을 훨씬 덜 받는다.
 *   셸 판정 틱          : 5초 **메인 스레드** window.setInterval
 *                          → 문서가 hidden 이면 브라우저가 분당 1회까지 줄인다.
 *
 * 그래서 문서가 보이는가에 따라 신뢰할 수 있는 지터 폭이 다르다. 하나의 숫자로
 * 덮으면 둘 중 하나가 틀린다 — 빠르게 잡으면 hidden 에서 오탐이 나고,
 * 느리게 잡으면 kiosk 에서 무음이 길어진다.
 *
 * 숙대는 wake lock 을 잡은 kiosk 라 visible 이 정상 상태다(2026-09-15 14:05:19
 * 마지막 스냅샷도 visibility=visible 이었다). 그쪽을 빠르게, hidden 은 보수적으로.
 */

/**
 * visible 일 때 "의심" 으로 넘어가는 시간. **새 숫자를 만들지 않는다** —
 * SKIP_AFTER_MS(35초)는 플레이어 사다리가 세 번째 칸(건너뛰기)까지 가는 시간이다.
 * 런타임 티커가 35초를 놓쳤다면 3초 티커를 **11번 연속** 놓친 것이고, 사다리는
 * 그 티커 위에서 도므로 한 칸도 올라가지 못했다는 뜻이다.
 *
 * 메인 스레드가 GC·긴 렌더로 잠깐 막히는 정도(보통 1초 미만, 드물게 수 초)와는
 * 한 자릿수 이상 차이가 난다.
 */
export const PLAYER_RUNTIME_SUSPECT_MS = SKIP_AFTER_MS;

/**
 * hidden 일 때의 임계값. 보수적으로 간다 — 메인 스레드 틱이 분당 1회까지
 * 줄어들면 우리가 보는 "나이" 자체가 거칠어지고, 워커 티커도 브라우저에 따라
 * 백그라운드에서 함께 눌릴 수 있다. 29 에서 쓰던 150초를 그대로 유지한다.
 */
export const PLAYER_RUNTIME_SUSPECT_HIDDEN_MS = RELOAD_PAGE_AFTER_MS;

/**
 * 의심을 확정으로 바꾸는 연속 관측 횟수.
 *
 * 한 번의 관측으로 리마운트하지 않는다 — 셸 틱(5초) 두 번을 더 기다려서
 * **10초 이상 계속** 낡아 있는지 본다. 잠깐의 워커 굶주림은 그 사이에 풀린다.
 * 새 타이머를 만들지 않는다. 기존 5초 틱에 카운터 하나가 얹힐 뿐이다.
 */
export const CONFIRM_OBSERVATIONS = 3;

/** 29 호환 — 이제는 visible 기준값을 가리킨다. */
export const PLAYER_RUNTIME_STALE_MS = PLAYER_RUNTIME_SUSPECT_MS;

/** 지금 상태에서 쓸 의심 임계값. */
export function suspectThresholdMs(documentHidden: boolean): number {
  return documentHidden ? PLAYER_RUNTIME_SUSPECT_HIDDEN_MS : PLAYER_RUNTIME_SUSPECT_MS;
}

/**
 * 최악 감지 지연 = 임계값 + 셸 틱 정렬 1회 + 확정까지 남은 틱.
 * visible 기준 35 + 5 + 10 = 50초.
 */
export function worstCaseDetectionMs(documentHidden: boolean, shellTickMs = 5_000): number {
  return suspectThresholdMs(documentHidden) + shellTickMs * CONFIRM_OBSERVATIONS;
}

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
  /** 문서가 숨겨져 있는가. 임계값이 달라진다(위 비대칭 설명 참고). */
  documentHidden: boolean;
  /** 지금까지 **연속으로** 낡아 있다고 본 횟수. 정상으로 돌아오면 0 으로 리셋된다. */
  staleObservations: number;

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
  /** 낡았지만 아직 확정이 아니다. 다음 틱에서 다시 본다(복구하지 않는다). */
  | 'observe'
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
  if (i.playerRuntimeAgeMs < suspectThresholdMs(i.documentHidden)) return 'none';

  // ── 2단계: 의심 → 확정. 한 번의 관측으로 리마운트하지 않는다.
  if (i.staleObservations + 1 < CONFIRM_OBSERVATIONS) return 'observe';

  // ── 여기부터 PLAYER EXECUTION STALE (확정) + SHELL ALIVE
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
    case 'observe': return '플레이어 신호가 낡았습니다 — 다음 확인까지 지켜봅니다';
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
  if (i.playerRuntimeAgeMs >= PLAYER_RUNTIME_SUSPECT_MS) return false;
  return i.progressSamples >= REQUIRED_PROGRESS_SAMPLES;
}
