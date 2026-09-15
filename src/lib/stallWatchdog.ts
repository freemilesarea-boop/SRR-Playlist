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
 *   8초   → nudge        재생을 다시 건다 (탭 스로틀링·일시적 정지·paused 고착)
 *   20초  → reload       같은 위치로 소스를 다시 잡는다 (버퍼 고갈)
 *   35초  → skip         다음 곡으로 넘긴다 (이 파일이 문제)
 *   150초 → reload_page  페이지를 다시 띄운다 (skip 조차 듣지 않는 상태)
 *
 * 정지의 두 얼굴을 모두 본다:
 *   • 재생 중인데 위치가 안 움직임 (버퍼·디코더)
 *   • paused 로 굳음 — playing 의도는 살아 있는데 엘리먼트만 멈춤
 *     (SELF-HEAL-2, 숙대점 2026-09-11. 아래 resolveStallAction 주석 참고)
 *
 * 곡이 바뀌면 사다리는 처음부터 다시 시작한다 — **매장은 포기하지 않는다.**
 * 네트워크가 죽어 있으면 곡당 35초씩 넘기며 계속 시도하고, 돌아오면 저절로 낫는다.
 *
 * 단, 넘긴 곡마저 한 마디도 안 나는 상태가 이어지면(FRUITLESS_SKIP_LIMIT) 곡 탓이
 * 아니므로 skip 을 멈추고 곧장 페이지를 다시 띄운다 — 그러지 않으면 사다리 초기화가
 * 반복되며 마지막 칸에 영영 못 간다(숙대점 2026-09-13, 71분/74회).
 *
 * ⚠ 매장 모드에서만 동작한다. 일반 청취자에게는 항상 'none' 이다 —
 *   사용자가 멈춘 것을 마음대로 다시 트는 일은 없어야 한다.
 */

export type StallAction =
  | 'none' | 'nudge' | 'reload' | 'skip' | 'hard_reset'
  /**
   * 회선이 끊긴 동안 마지막 칸을 **보류**한다. 페이지를 다시 띄우지 않는다.
   *
   * 오프라인에서 페이지를 재시작하면 얻는 것보다 잃는 것이 크다:
   *   • IndexedDB 에 받아둔 곡으로 버티고 있었을 수도 있는데 그 재생을 끊는다.
   *   • 리로드 직후에는 사용자 제스처가 없어 자동재생이 막힐 수 있다.
   *   • 셸은 서비스워커 precache 로 뜨지만 오디오는 네트워크가 돌아와야 받는다.
   * 회선이 없다는 것과 재생이 죽었다는 것은 **다른 사건**이다.
   */
  | 'offline_hold'
  | 'reload_page';

/** 재생을 다시 건다. 가장 싸고 대부분의 일시적 정지를 고친다. */
export const NUDGE_AFTER_MS = 8_000;
/** 같은 위치로 소스를 다시 잡는다. nudge 로 안 되면 버퍼가 말라붙은 것. */
export const RELOAD_AFTER_MS = 20_000;
/** 다음 곡으로. 여기까지 왔으면 이 파일/이 위치가 문제다. */
export const SKIP_AFTER_MS = 35_000;
/**
 * 페이지를 통째로 다시 띄운다 — 마지막 칸.
 *
 * 왜 필요한가: 숙대점(2026-09-10)에서 skip 까지 올라간 뒤 곡이 바뀌지 않아
 * **34분간 같은 곡에 멈춰 있었다.** 사다리 끝에 도달하면 isEscalation 이 재실행을
 * 막기 때문에, skip 이 듣지 않는 상황에서는 그 뒤로 아무 일도 일어나지 않는다.
 * 매장은 조용해지고 사람이 올 때까지 그대로다.
 *
 * 리로드는 오디오 엘리먼트·큐·워커를 전부 새로 만든다. 무인 매장에서 가장 확실한
 * 복구 수단이다. 자동재생이 막히면 전체화면 안내(PlaybackBlockedOverlay)가 뜨므로
 * 최소한 "화면을 누르면 된다" 는 상태까지는 간다 — 조용한 정지보다 낫다.
 */
export const RELOAD_PAGE_AFTER_MS = 150_000;

/**
 * HARD RESET — 오디오 엘리먼트 자체를 버리고 새로 만든다.
 *
 * 왜 skip 으로는 안 되는가(숙대점 2026-09-13, 71분/74곡):
 *   skip 은 큐 index 만 옮긴다. 그 다음 트랙 전환은 **같은 HTMLMediaElement** 에
 *   새 src 를 꽂고 load() 할 뿐이다(Player.tsx 트랙 전환 effect). activeIdx 도
 *   바뀌지 않는다. 그래서 엘리먼트/미디어 파이프라인이 죽은 상태라면 곡을 몇 개를
 *   넘기든 같은 죽은 엘리먼트를 계속 쓰게 되고, 74곡 연속 playedSeconds=0 이 된다.
 *
 * 그래서 마지막 칸(페이지 재시작) 앞에 "엘리먼트만 새로 만드는" 칸을 하나 넣는다.
 * 페이지 리로드보다 파급이 훨씬 작고(큐·세션·스케줄러 보존), 리로드 직후
 * 자동재생 차단에 걸릴 위험도 없다.
 */
export const HARD_RESET_VERIFY_MS = 20_000;

/**
 * "곡을 넘겨도 소용없다" 고 판단하는 연속 헛skip 횟수.
 *
 * 왜 필요한가 — 숙대점 2026-09-13. 14:48~15:59 **71분 동안 stall_skip 74건**,
 * 전부 playedSeconds=0 이었다. 즉 넘긴 곡도 한 마디도 소리가 안 났다.
 * 그런데 그동안 reload_page 는 **단 한 번도 실행되지 않았다.**
 *
 * 사다리가 "곡이 바뀌면 처음부터" 로 되어 있기 때문이다. 36초에 skip →
 * 곡이 바뀜 → 사다리 초기화 → 36초 뒤 또 skip. 150초 칸에 영영 도달하지 못한다.
 * 한 곡이 안 되는 상황(원래 의도한 시나리오)에는 맞지만, **오디오 파이프라인
 * 자체가 죽어 모든 곡이 0초인 상황**에서는 매장이 조용한 채로 무한히 돈다.
 *
 * 그래서 실제 소리가 난 적 없는 skip 을 세고, 이만큼 쌓이면 곡 탓이 아니라고
 * 보고 곧장 마지막 칸(페이지 재시작)으로 간다. 3회면 약 2분 — 그 사이 한 곡이라도
 * 실제로 재생되면 카운터는 0 으로 돌아간다.
 */
export const FRUITLESS_SKIP_LIMIT = 3;

/**
 * 25 — "얼었다" 를 서버로 보내는 최소 간격.
 *
 * heartbeat 가 60초다. 관측 보고가 그보다 잦아질 이유가 없다 — 더 잦게 보낸다고
 * 더 빨리 알 수 있는 것도 아니고(서버 감지 주기도 1분), 무인 매장에서 24시간
 * 도는 클라이언트가 서버에 쓰는 양만 늘어난다. 정지 구간당 1회가 기본이고
 * 이 값은 얼었다 풀렸다를 반복하는 경우의 바닥이다.
 */
export const FROZEN_REPORT_MIN_INTERVAL_MS = 60_000;

export interface StallInput {
  /** 매장/브랜드 플레이어인가. false 면 무조건 'none'. */
  businessMode: boolean;
  /** 재생 의도(store.playing). false = 사용자가 멈춘 것 → 건드리지 않는다. */
  playing: boolean;
  /**
   * audio element 가 실제로 paused 인가.
   * playing(재생 의도)이 true 인데 이게 true 면 버그 상태다 — 사다리를 태운다.
   */
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
  /**
   * 연속으로 "한 마디도 못 듣고" 넘긴 곡 수. 실제 재생이 한 번이라도 되면 0.
   * 생략하면 0 — 기존 호출부 동작 그대로.
   */
  fruitlessSkips?: number;
  /** 이번 정지 구간에서 hard reset 을 이미 써봤는가. 썼는데도 안 되면 페이지 재시작. */
  hardResetDone?: boolean;
  /** hard reset 이 실행된 뒤 흐른 시간(ms). 아직 안 했으면 null. */
  hardResetMsAgo?: number | null;
  /**
   * 지금 네트워크가 붙어 있는가(navigator.onLine).
   *
   * 생략하면 online 으로 본다 — 기존 호출부 동작 그대로다. false 일 때만 마지막 칸
   * (페이지 재시작)을 보류한다. 같은 문서 안에서 끝나는 복구(nudge/reload/skip/
   * hard_reset)는 오프라인에서도 그대로 한다 — 캐시된 곡으로 되살아날 수 있다.
   */
  online?: boolean;
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
  // ended 는 정지가 아니라 정상 종료 — onEnded 가 다음 곡을 건다.
  if (i.ended) return 'none';
  // paused 는 여기서 함께 본다(BRAND-PLAYER-SELF-HEAL-2).
  //
  // 예전에는 paused 도 'none' 으로 넘기고 checkAudioHealth 의
  // neither-playing-while-playing-state 에 맡겼다. 그런데 그 점검은 **이벤트에서만**
  // 불린다(timeupdate · canplay · ended · visibility · focus · online · pageshow ·
  // crossfade). 오디오가 paused 로 굳으면 그 이벤트가 하나도 오지 않는다 —
  // timeupdate 는 재생 중에만 오고, 매장 화면은 계속 떠 있어 visibility/focus 도
  // 안 바뀐다. 결국 되살릴 계기가 영영 사라진다. 이 파일 맨 위가 경고한 바로 그
  // 함정인데, paused 분기만 그 이벤트 경로로 되돌려 보내고 있었다.
  //
  // 숙대점 2026-09-11: 하트비트는 살아 있는데 같은 곡에 14분 정지. 이틀간 6번.
  // store_playback_diagnostics 전체 이력에 playback_stalled·track_cut_short 가
  // 0건이었다 — 사다리를 단 한 번도 올라간 적이 없다는 뜻이다.
  //
  // 되살려도 안전한 이유: 위에서 businessMode 와 playing 을 이미 걸렀다.
  // playing 은 **재생 의도**다. 의도는 재생인데 엘리먼트만 paused 면 버그 상태다.
  // 사용자가 직접 누른 일시정지는 playing=false 라 여기까지 오지 않는다.
  // 첫 칸(nudge = play())이 이 상태의 정답이기도 하다.

  // hard reset 직후 검증 창 — 새 엘리먼트가 로드·재생할 시간을 준다.
  // 이때 사다리를 계속 태우면 방금 만든 엘리먼트를 또 부순다.
  const hr = i.hardResetMsAgo;
  if (hr !== null && hr !== undefined && hr < HARD_RESET_VERIFY_MS) return 'none';

  // 넘겨도 넘겨도 소리가 안 나면 곡 탓이 아니다 — 오디오 파이프라인이 죽은 것이다.
  // skip 을 한 번 더 해봐야 사다리만 초기화되고 매장은 계속 조용하다(숙대점 71분/74회).
  // 곡이 아니라 **엘리먼트**를 버린다. 그래도 안 되면 그때 페이지를 다시 띄운다.
  // 오프라인이면 마지막 칸을 보류한다. 같은 문서 안의 복구는 그대로 진행한다.
  const canNavigate = i.online !== false;

  if ((i.fruitlessSkips ?? 0) >= FRUITLESS_SKIP_LIMIT && i.stalledMs >= SKIP_AFTER_MS) {
    if (!i.hardResetDone) return 'hard_reset';
    return canNavigate ? 'reload_page' : 'offline_hold';
  }

  if (i.stalledMs >= RELOAD_PAGE_AFTER_MS) return canNavigate ? 'reload_page' : 'offline_hold';
  if (i.stalledMs >= SKIP_AFTER_MS) return 'skip';
  if (i.stalledMs >= RELOAD_AFTER_MS) return 'reload';
  if (i.stalledMs >= NUDGE_AFTER_MS) return 'nudge';
  return 'none';
}

/** 사다리에서 이 칸이 저 칸보다 뒤인가 (되돌아가지 않게). */
// offline_hold 는 reload_page 와 같은 칸이다 — 마지막 칸에 도달했으나 보류한 상태.
// 같은 순위로 두면 (a) 오프라인 동안 보류 로그가 매 tick 반복되지 않고,
// (b) 회선이 돌아왔다고 곧바로 reload_page 로 넘어가지도 않는다.
// 재개는 아래 decideReconnectReset 이 사다리를 되감아서 처리한다.
const ORDER: Record<StallAction, number> = {
  none: 0, nudge: 1, reload: 2, skip: 3, hard_reset: 4, offline_hold: 5, reload_page: 5,
};
export function isEscalation(from: StallAction, to: StallAction): boolean {
  return ORDER[to] > ORDER[from];
}

/* ────────────────────────────────────────────────────────────────────────── */

/** hard reset 결과 판정. */
export type HardResetVerdict = 'pending' | 'success' | 'failure';

/**
 * hard reset 이 실제로 소리를 되살렸는가.
 *
 * **play() 가 resolve 됐다는 것만으로 성공 처리하지 않는다.** 숙대점 장애가 바로
 * paused=false 인데 소리가 안 나던 상태였다. 판정 기준은 오직 **재생 위치가 실제로
 * 움직였는가** 하나다.
 */
export function verifyHardReset(i: {
  /** hard reset 이후 흐른 시간(ms). */
  msSinceReset: number;
  /** 그 사이 재생 위치가 실제로 움직였는가. */
  progressed: boolean;
}): HardResetVerdict {
  if (i.progressed) return 'success';
  if (i.msSinceReset >= HARD_RESET_VERIFY_MS) return 'failure';
  return 'pending';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 회선 복귀 처리                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * offline → online 전환 시 복구 상태를 어떻게 되돌릴지.
 *
 * **재연결 자체는 절대 페이지를 다시 띄우는 이유가 되지 않는다.** 어느 경우에도
 * 정지 시계를 지금으로 리셋하므로, 회선이 돌아온 직후에 마지막 칸이 곧바로 터지는
 * 일이 없다. 사다리는 평소 간격(8초 → 20초 → 35초 → …)으로 처음부터 다시 오른다.
 *
 * 차이는 "얼마나 깨끗하게 지우는가" 뿐이다:
 *   • 실제로 소리가 돌아왔다면 → 전부 초기화(정상 상태로 복귀).
 *   • 아직 소리가 없다면 → 헛skip·hard reset 이력은 남긴다. 같은 정지가 이어지는
 *     것이므로, 다시 조용히 처음부터 기어오르게 만들면 아까 도달했던 지점까지
 *     또 오래 걸린다.
 */
export interface ReconnectReset {
  /** 정지 시계를 지금으로 옮긴다 — 항상 true. 재연결 직후 즉시 재시작 금지. */
  resetStallClock: true;
  /** 사다리 진행 기록(마지막 실행 칸)을 지운다 — 항상 true. */
  clearLadder: true;
  /** 헛skip 카운터를 0 으로 되돌리는가. */
  clearFruitlessSkips: boolean;
  /** hard reset 사용 이력을 지우는가. */
  clearHardResetDone: boolean;
}

export function decideReconnectReset(progressed: boolean): ReconnectReset {
  return {
    resetStallClock: true,
    clearLadder: true,
    clearFruitlessSkips: progressed,
    clearHardResetDone: progressed,
  };
}
