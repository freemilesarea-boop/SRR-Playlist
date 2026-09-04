/**
 * stallWatchdog — BRAND-PLAYER-SELF-HEAL-1
 *
 * 무인 매장에서 소리가 조용히 멈췄을 때 **사람 없이 스스로 되살아나게** 한다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * Player 의 기존 health monitor(Phase 3-2)는 `active-stalled` 를 이미 감지하지만
 * **이벤트 기반**이다 — timeupdate / canplay / ended / visibility 안에서만 돈다.
 * 그런데 오디오가 진짜로 멈추면 그 이벤트들이 더 이상 오지 않는다. `waiting` 이
 * 한 번 튀고 네트워크가 영영 안 돌아오는 경우, 그 시점엔 아직 정지 2.5초가 안 돼서
 * 아무 문제도 잡히지 않고, 이후엔 재평가할 계기 자체가 사라진다. 서버는 stalled 로
 * 보고 알림까지 띄우는데 클라이언트는 아무것도 하지 않는 상태가 여기서 나온다.
 *
 * 그리고 Recovery Manager 는 규칙상 `active.play()` 만 한다(`load()`/src 재설정 금지).
 * play() 로 안 되는 정지 — 버퍼 고갈, 디코더 정지, 깨진 파일 — 에는 사다리의
 * 마지막 칸이 없다.
 *
 * ── 이 모듈이 하는 일 ───────────────────────────────────────────────────────
 * 정지 경과 시간만 보고 다음 칸을 고른다. 실행은 Player 가 한다.
 *
 *   8초  → nudge   재생을 다시 건다 (탭 스로틀링·일시적 정지)
 *   20초 → reload  같은 위치로 소스를 다시 잡는다 (버퍼 고갈)
 *   35초 → skip    다음 곡으로 넘긴다 (이 파일이 문제)
 *
 * 곡이 바뀌면 사다리는 처음부터 다시 시작한다 — **매장은 포기하지 않는다.**
 * 네트워크가 죽어 있으면 곡당 35초씩 넘기며 계속 시도하고, 돌아오면 저절로 낫는다.
 *
 * ⚠ 매장 모드에서만 동작한다. 일반 청취자에게는 항상 'none' 이다 —
 *   사용자가 멈춘 것을 마음대로 다시 트는 일은 없어야 한다.
 */

export type StallAction = 'none' | 'nudge' | 'reload' | 'skip';

/** 재생을 다시 건다. 가장 싸고 대부분의 일시적 정지를 고친다. */
export const NUDGE_AFTER_MS = 8_000;
/** 같은 위치로 소스를 다시 잡는다. nudge 로 안 되면 버퍼가 말라붙은 것. */
export const RELOAD_AFTER_MS = 20_000;
/** 다음 곡으로. 여기까지 왔으면 이 파일/이 위치가 문제다. */
export const SKIP_AFTER_MS = 35_000;

export interface StallInput {
  /** 매장/브랜드 플레이어인가. false 면 무조건 'none'. */
  businessMode: boolean;
  /** 재생 의도(store.playing). false = 사용자가 멈춘 것 → 건드리지 않는다. */
  playing: boolean;
  /** audio element 가 실제로 paused 인가. */
  paused: boolean;
  /** 곡이 끝난 상태인가 (ended 는 정지가 아니라 정상 종료). */
  ended: boolean;
  /** 크로스페이드 진행 중인가 (crossfade-stuck 이 따로 담당). */
  crossfading: boolean;
  /** 본사 스케줄로 재생이 억제된 상태인가. */
  suppressed: boolean;
  /** 자동재생 차단 — 사용자 제스처가 필요하므로 play() 를 눌러도 소용없다. */
  autoplayBlocked: boolean;
  /** 구독 만료로 차단된 상태 — 되살릴 대상이 아니다. */
  subscriptionBlocked: boolean;
  /** 마지막으로 재생 위치가 움직인 뒤 흐른 시간(ms). */
  stalledMs: number;
}

/**
 * 지금 어떤 복구를 해야 하는가.
 *
 * 같은 정지 구간에서 매 tick 마다 같은 값을 돌려주므로, 호출측은 **직전에 실행한
 * 칸과 다를 때만** 실행한다(중복 실행 방지). 진행이 재개되거나 곡이 바뀌면
 * 호출측이 그 기록을 지워 사다리를 처음으로 되돌린다.
 */
export function resolveStallAction(i: StallInput): StallAction {
  // 매장 모드가 아니면 아무것도 하지 않는다 — 일반 청취자 동작 변화 0.
  if (!i.businessMode) return 'none';
  // 사용자/스케줄이 멈춘 것을 되살리지 않는다.
  if (!i.playing || i.suppressed) return 'none';
  // 각각 별도 경로가 이미 처리한다. 여기서 겹쳐 손대면 서로 방해한다.
  if (i.autoplayBlocked || i.subscriptionBlocked || i.crossfading) return 'none';
  // paused/ended 는 "정지"가 아니다 — 다른 로직(neither-playing, onEnded)의 몫.
  if (i.paused || i.ended) return 'none';

  if (i.stalledMs >= SKIP_AFTER_MS) return 'skip';
  if (i.stalledMs >= RELOAD_AFTER_MS) return 'reload';
  if (i.stalledMs >= NUDGE_AFTER_MS) return 'nudge';
  return 'none';
}

/** 사다리에서 이 칸이 저 칸보다 뒤인가 (되돌아가지 않게). */
const ORDER: Record<StallAction, number> = { none: 0, nudge: 1, reload: 2, skip: 3 };
export function isEscalation(from: StallAction, to: StallAction): boolean {
  return ORDER[to] > ORDER[from];
}
