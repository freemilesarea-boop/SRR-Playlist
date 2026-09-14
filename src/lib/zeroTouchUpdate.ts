/**
 * zeroTouchUpdate.ts — 24시간 매장이 **사람 없이** 새 빌드를 받는 결정 로직.
 *
 * ── 왜 지금 안 되는가 (2026-09-14 실측) ─────────────────────────────────────
 *
 * 오늘 프로덕션에 6번 배포했는데 숙대점은 **하나도 활성화하지 않았다.**
 * 화정점은 그보다 더 오래 뒤처져 있다. OS 도 브라우저도 다른 두 매장이 똑같이
 * 멈춰 있다 — 기기 문제가 아니다.
 *
 * 현재 구조(main.tsx + swUpdateGate)는 이렇다:
 *   새 SW 감지 → requestReload() → 재생 중이면 미룸 → **30초마다 다시 물어봄**
 *
 * 30초 폴링이 노리는 창은 트랙 전환 때 audioActive 가 false 로 떨어지는 순간인데,
 * 그 창은 `emptied` 에서 `playing` 까지 수백 밀리초다. 30초 샘플링이 그 창에
 * 들어갈 확률은 한 번에 2% 남짓이다. 확률에 기대는 설계이고, 실제로 하루 종일
 * 한 번도 못 맞췄다.
 *
 * ── 이 모듈이 바꾸는 것 ────────────────────────────────────────────────────
 *
 * 확률을 **사건**으로 바꾼다. 트랙 경계는 우리가 정확히 아는 순간이다 —
 * 곡이 끝나고 다음 곡이 시작하기 전. 그때 물어보면 된다.
 *
 * ── 그런데 리로드는 공짜가 아니다 ──────────────────────────────────────────
 *
 * 문서를 새로 띄우면 **사용자 제스처가 사라진다.** 2026-09-14 18:03 숙대점이
 * 정확히 그랬다: 복구 직후 autoplay_blocked, 11초 뒤 점주가 화면을 눌러서야 소리가
 * 났다. 무인 매장에서 그 11초는 운이 좋았던 것이다 — 사람이 없었으면 아침까지
 * 조용했다.
 *
 * 그래서 이 모듈은 **자동재생이 된다는 증거가 있을 때만** 자동 활성화한다.
 * 증거는 하나뿐이다: 지금 이 문서가 **제스처 없이 소리를 시작했는가.**
 * 그랬다면 이 기기/오리진에는 자동재생 권한이 있다. 아니었다면 없다 —
 * 그때는 자동으로 리로드하지 않고 사람이 있는 시점으로 미룬다.
 *
 * 관측이 재생을 이기지 않는다. 업데이트도 마찬가지다.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* 상한                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 트랙 경계를 못 잡아도 이 시간을 넘기면 적용한다.
 *
 * 왜 2시간인가 — 숙대점 실측에서 2시간에 트랙 전환이 45회였다. 즉 경계 기회가
 * 45번 있었다는 뜻이고, 그걸 전부 놓칠 확률은 사실상 0 이다. 이 상한은 "경계
 * 감지가 어떤 이유로든 안 돌았을 때" 만 쓰이는 뒷문이다.
 *
 * 기존 12시간은 너무 길었다 — 안정성 수정이 반나절을 기다린다는 뜻이었다.
 */
export const MAX_DEFER_MS = 2 * 60 * 60 * 1000;

/**
 * 배포 직후 전 매장이 동시에 origin 을 때리지 않도록 매장별로 흩뿌리는 창.
 *
 * 매장이 1000곳이 되면 배포 한 번에 1000개의 문서가 동시에 같은 번들과 음원을
 * 요청한다. 10분 창에 결정적으로 흩으면 초당 2건 수준으로 눌린다.
 * 결정적(deterministic)인 이유는 재시도마다 값이 흔들리면 흩뿌리는 의미가 없어서다.
 */
export const STAGGER_WINDOW_MS = 10 * 60 * 1000;

/* ────────────────────────────────────────────────────────────────────────── */
/* 결정                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export type ActivationBlocker =
  /** 적용할 새 빌드가 없다. */
  | 'no_update'
  /** 소리가 나는 중인데 트랙 경계가 아니다 — 곡 중간을 끊지 않는다. */
  | 'mid_track'
  /** 크로스페이드 임계 구간. 두 엘리먼트가 겹쳐 도는 중이다. */
  | 'crossfading'
  /** 복구 사다리가 도는 중이다. 복구와 업데이트가 겹치면 둘 다 망친다. */
  | 'recovering'
  /** 회선이 끊겼다. 리로드하면 셸은 떠도 음원을 못 받는다. */
  | 'offline'
  /**
   * **이 문서는 제스처 없이 소리를 시작하지 못했다.**
   * 리로드하면 다시 막힐 것이고, 무인 매장에서는 그대로 무음이 된다.
   * 사람이 있는 시점에 활성화해야 한다.
   */
  | 'autoplay_not_trusted'
  /** 매장 모드가 아니다 — 일반 사용자는 기존대로 즉시 리로드된다. */
  | 'not_business'
  /** 안전하지만 아직 내 차례가 아니다(stagger). */
  | 'stagger';

export type ActivationReason = 'track_boundary' | 'audio_idle' | 'max_defer';

export type UpdateDecision =
  | { kind: 'wait'; blocker: ActivationBlocker; retryInMs?: number }
  | { kind: 'activate'; reason: ActivationReason };

export interface UpdateDecisionInput {
  /** 새 빌드가 준비돼 적용을 기다리는가. */
  updatePending: boolean;
  businessMode: boolean;
  /** 지금 실제로 소리가 나는가(audioActive — playing 의도가 아니다). */
  audioActive: boolean;
  /** 방금 곡이 끝나고 다음 곡이 아직 시작하지 않은 순간인가. */
  atTrackBoundary: boolean;
  crossfading: boolean;
  /** 복구 사다리가 돌고 있는가. */
  recovering: boolean;
  online: boolean;
  /**
   * 이 문서가 **사용자 제스처 없이** 소리를 시작했는가.
   * false 면 리로드 후 자동재생이 막힐 것으로 보고 자동 활성화하지 않는다.
   */
  autoplayTrusted: boolean;
  /** 처음 미룬 시각(ms). 아직 미룬 적 없으면 null. */
  deferredSince: number | null;
  /** 이 매장의 stagger 지연(ms). 0 이면 흩뿌리지 않는다. */
  staggerMs?: number;
  now: number;
  maxDeferMs?: number;
}

/**
 * 지금 새 빌드를 적용해도 되는가.
 *
 * 순서가 곧 안전 규칙이다 — 적용하면 안 되는 이유부터 전부 걸러낸다.
 */
export function decideUpdateActivation(i: UpdateDecisionInput): UpdateDecision {
  if (!i.updatePending) return { kind: 'wait', blocker: 'no_update' };
  // 일반 사용자는 이 경로를 타지 않는다(main.tsx 가 즉시 적용한다).
  if (!i.businessMode) return { kind: 'wait', blocker: 'not_business' };

  const maxDefer = i.maxDeferMs ?? MAX_DEFER_MS;
  const deferredFor = i.deferredSince === null ? 0 : Math.max(0, i.now - i.deferredSince);
  const expired = i.deferredSince !== null && deferredFor >= maxDefer;

  // 상한을 넘겨도 **회선이 없으면** 적용하지 않는다. 리로드하면 셸은 precache 로
  // 뜨지만 음원은 네트워크가 돌아와야 받는다 — offline_hold 와 같은 이유다.
  if (!i.online) return { kind: 'wait', blocker: 'offline' };

  // 복구 중에는 절대 끼어들지 않는다. 사다리가 만든 새 엘리먼트를 리로드가 부순다.
  if (i.recovering) return { kind: 'wait', blocker: 'recovering' };
  // 크로스페이드 임계 구간도 마찬가지다.
  if (i.crossfading) return { kind: 'wait', blocker: 'crossfading' };

  // 자동재생 신뢰가 없으면 **상한을 넘겨도** 자동으로 리로드하지 않는다.
  // 무인 매장을 조용하게 만드는 것보다 옛 빌드로 도는 편이 낫다.
  if (!i.autoplayTrusted) return { kind: 'wait', blocker: 'autoplay_not_trusted' };

  // 여기서부터는 "적용해도 안전한 상태" 다. 언제 할지만 남았다.
  const safeNow = !i.audioActive || i.atTrackBoundary;
  if (!safeNow && !expired) return { kind: 'wait', blocker: 'mid_track' };

  // 흩뿌리기 — 안전 창에 들어왔더라도 내 차례를 기다린다.
  const stagger = i.staggerMs ?? 0;
  if (stagger > 0 && deferredFor < stagger && !expired) {
    return { kind: 'wait', blocker: 'stagger', retryInMs: stagger - deferredFor };
  }

  if (expired && !safeNow) return { kind: 'activate', reason: 'max_defer' };
  if (i.atTrackBoundary) return { kind: 'activate', reason: 'track_boundary' };
  return { kind: 'activate', reason: 'audio_idle' };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 흩뿌리기                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 매장 키 → [0, windowMs) 의 **결정적** 지연.
 *
 * 같은 매장은 언제 계산해도 같은 값이 나온다. 재시도마다 값이 흔들리면 흩뿌리는
 * 의미가 없고, 랜덤이면 재현도 안 된다. FNV-1a 32bit — 암호용이 아니라 분산용이다.
 */
export function deterministicStaggerMs(storeKey: string, windowMs = STAGGER_WINDOW_MS): number {
  if (!storeKey || windowMs <= 0) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < storeKey.length; i++) {
    h ^= storeKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % windowMs;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 빌드당 1회 보장                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/** 같은 빌드로 두 번 활성화하지 않기 위한 키. */
export function activationMarkerKey(buildId: string): string {
  return `deudda:update-activated-${buildId}`;
}

/**
 * 이 빌드를 이미 적용하려 시도했는가.
 *
 * 저장소를 못 읽으면(프라이빗 모드 등) **false** 를 돌려준다 — 표식을 못 읽는다고
 * 업데이트를 영영 막으면 그게 더 나쁘다. 대신 리로드 루프는 상위의 세션 표식과
 * 트랙 경계 조건이 함께 막는다.
 */
export function alreadyActivated(buildId: string, storage?: Storage | null): boolean {
  try {
    const s = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
    return s?.getItem(activationMarkerKey(buildId)) === '1';
  } catch {
    return false;
  }
}

/** 활성화 시도를 기록한다. 실패해도 조용히 넘어간다. */
export function markActivated(buildId: string, storage?: Storage | null): void {
  try {
    const s = storage ?? (typeof sessionStorage === 'undefined' ? null : sessionStorage);
    s?.setItem(activationMarkerKey(buildId), '1');
  } catch {
    /* noop */
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 자동재생 신뢰 — 이 문서가 제스처 없이 소리를 냈는가                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 왜 모듈이 상태를 갖는가 — 이 판정의 근거는 **문서가 살아온 이력**이지 지금
 * 한 순간의 값이 아니다. "지금 소리가 난다" 는 제스처로 살아난 것일 수도 있어서
 * 그것만으로는 신뢰가 되지 않고, "지금 막혀 있지 않다" 도 아까 막혔다가 사람이
 * 눌러준 것일 수 있다. 그래서 두 사실을 문서 수명 동안 **누적**한다.
 *
 * 23 — 예전에는 이 누적을 업데이트가 감지된 **뒤에야** 구독으로 시작했다.
 * 그래서 이미 재생 중이던 문서는 첫 트랙 경계에서 audioEverActive 가 아직
 * false 라 autoplay_not_trusted 로 버려지고, 두 번째 경계에야 적용됐다 —
 * 한 곡(약 3분)이 이유 없이 늦었다. 관측은 처음부터 켜져 있어야 한다.
 */
let autoplayEverBlocked = false;
let audioEverActive = false;

export interface AutoplaySignals {
  /** 지금 실제로 소리가 나는가. */
  audioActive: boolean;
  /** 지금 자동재생 정책에 막혀 있는가. */
  autoplayBlocked: boolean;
}

/**
 * 관측 한 틱을 누적한다. 구독 콜백에서도, 구독을 걸기 전의 현재 상태로도 부른다.
 * 되돌리지 않는다 — 한 번 막혔던 사실은 그 문서가 사는 동안 사라지지 않는다.
 */
export function noteAutoplaySignals(s: AutoplaySignals): void {
  if (s.autoplayBlocked) autoplayEverBlocked = true;
  if (s.audioActive) audioEverActive = true;
}

/**
 * 리로드 후에도 자동재생이 될 것으로 믿을 근거가 있는가.
 *
 * 브라우저 정책을 우회하지 않는다 — 정책이 이미 허락했다는 **증거**만 본다.
 * 증거가 없으면 자동 활성화하지 않는다(상한을 넘겨도).
 */
export function autoplayTrusted(): boolean {
  return audioEverActive && !autoplayEverBlocked;
}

/** 관측 누적의 현재 모양. 보고·진단용이며 판정에 쓰지 않는다. */
export type AutoplayTrustState =
  | 'AUTOPLAY_UNKNOWN'
  | 'AUTOPLAY_BLOCKED'
  | 'AUTOPLAY_RECOVERED_BY_GESTURE'
  | 'AUTOPLAY_TRUSTED_FOR_RELOAD';

export function autoplayTrustState(now: AutoplaySignals): AutoplayTrustState {
  if (now.autoplayBlocked) return 'AUTOPLAY_BLOCKED';
  if (autoplayEverBlocked) {
    return audioEverActive ? 'AUTOPLAY_RECOVERED_BY_GESTURE' : 'AUTOPLAY_BLOCKED';
  }
  return audioEverActive ? 'AUTOPLAY_TRUSTED_FOR_RELOAD' : 'AUTOPLAY_UNKNOWN';
}

/** 테스트 전용 — 문서 수명 누적을 비운다. */
export function __resetAutoplayTrustForTest(): void {
  autoplayEverBlocked = false;
  audioEverActive = false;
}
