/**
 * clientLiveness.ts — **죽기 직전의 마지막 정상 상태**를 서버에 남긴다.
 *
 * 왜 — 2026-09-14 숙대점. 17:29:15 에 heartbeat 가 끊기고 34분간 완전 침묵했다.
 * 그 사이 우리가 서버에서 본 것은 `last_seen_at` 하나뿐이었다. 화면이 꺼져
 * 있었는지, 오프라인이었는지, Realtime 이 이미 끊겨 있었는지, 소리는 나고
 * 있었는지 — 아무것도 알 수 없었다.
 *
 * 그리고 이게 핵심인데: **프로세스가 OS 에 죽는 순간에는 클라이언트가 아무것도
 * 보낼 수 없다.** page_frozen 도 page_hidden 도 그날 한 줄도 남지 않았다
 * (listener 는 멀쩡히 달려 있었고 다른 날엔 5번 기록됐다). 그러니 "죽을 때
 * 신고하게 만들자" 는 설계는 원리적으로 틀렸다.
 *
 * 대신 **매 heartbeat 가 그 순간의 스냅샷을 남긴다.** 죽으면 마지막 heartbeat 가
 * 곧 부검 소견서가 된다 — 최대 60초 전의 상태지만, 지금은 그 60초가 전부다.
 *
 * 설계 규칙:
 *   • 값은 전부 **읽기만** 한다. 이 모듈은 재생을 건드리지 않는다.
 *   • React state 를 쓰지 않는다 — timeupdate 는 초당 4회 온다. 모듈 변수로
 *     받아 heartbeat 때만 읽는다(리렌더 0회).
 *   • 문자열은 화이트리스트만 통과시킨다. 클라이언트 자유 텍스트를 서버에
 *     쌓지 않는다.
 *   • PII 없음 — 시각·불리언·열거값뿐이다.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* 1) 실제 오디오 진행 시각                                                    */
/*                                                                            */
/*    paused=false 도 audioActive 도 아니다. currentTime 이 **실제로 늘어난**   */
/*    마지막 순간이다. 멈춘 채 paused=false 인 플레이어를 살아있다고 세지        */
/*    않기 위해서다(그게 오늘 하루 종일 우리를 속인 신호였다).                   */
/* ────────────────────────────────────────────────────────────────────────── */

let lastAudioProgressAtMs: number | null = null;

/** currentTime 이 실제로 늘어난 순간에만 호출한다. */
export function noteAudioProgress(nowMs: number = Date.now()): void {
  lastAudioProgressAtMs = nowMs;
}

/** 마지막 실제 진행 시각(epoch ms). 한 번도 진행한 적 없으면 null. */
export function lastAudioProgressAt(): number | null {
  return lastAudioProgressAtMs;
}

/**
 * 지금 **실제로** 소리가 나고 있다고 볼 수 있는가.
 *
 * 네이티브 워치독(StorePlaybackService.lastAudibleAt)이 먹어야 하는 신호가
 * 바로 이것이다. 지금 네이티브 쉘 브랜치는 `audioActive` 를 넘기는데, 그 값은
 * Player.tsx 에서 audio element 의 `playing` 이벤트 + `!el.paused` 로 세워진다.
 * 즉 **currentTime 이 얼어붙은 채 paused=false 인 플레이어**도 계속 "들린다"
 * 로 보고된다 — 워치독이 잡으라고 만들어진 바로 그 상태에서 눈이 먼다.
 *
 * windowMs 기본값은 네이티브 heartbeat 주기(60s)의 1.5배다. 곡 전환·크로스페이드
 * 로 생기는 몇 초의 공백에는 반응하지 않고, 진짜 정지만 false 로 떨어진다.
 */
export function isAudiblyProgressing(nowMs: number = Date.now(), windowMs = 90_000): boolean {
  const at = lastAudioProgressAt();
  if (at == null) return false;      // 한 번도 진행한 적 없다 = 들린다고 할 수 없다
  const age = nowMs - at;
  if (age < 0) return true;          // 시계 역행 — 방금 진행한 것으로 본다
  return age <= windowMs;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 2) Realtime 채널 상태                                                       */
/*                                                                            */
/*    control plane 이 살아 있었는지. 오늘 reload 명령이 배달되지 않은 것이      */
/*    "채널이 끊겨 있어서" 인지 "프로세스가 없어서" 인지 지금은 구분할 수 없다.  */
/* ────────────────────────────────────────────────────────────────────────── */

const REALTIME_STATUSES: ReadonlySet<string> = new Set([
  'SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR',
]);

let realtimeStatusValue: string | null = null;

/** 모르는 문자열은 저장하지 않는다 — supabase-js 가 상태 이름을 바꿔도 오염되지 않는다. */
export function normalizeRealtimeStatus(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return REALTIME_STATUSES.has(s) ? s : null;
}

export function setRealtimeStatus(v: unknown): void {
  const s = normalizeRealtimeStatus(v);
  if (s) realtimeStatusValue = s;
}

export function realtimeStatus(): string | null {
  return realtimeStatusValue;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 3) 문서 상태                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const VISIBILITY_STATES: ReadonlySet<string> = new Set([
  'visible', 'hidden', 'prerender', 'unloaded',
]);

export function normalizeVisibility(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return VISIBILITY_STATES.has(s) ? s : null;
}

export function readVisibilityState(): string | null {
  if (typeof document === 'undefined') return null;
  return normalizeVisibility(document.visibilityState);
}

export function readOnline(): boolean | null {
  if (typeof navigator === 'undefined') return null;
  return typeof navigator.onLine === 'boolean' ? navigator.onLine : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 4) heartbeat 에 실을 스냅샷                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ClientLivenessSnapshot {
  /** 이 문서에서 돌고 있는 플레이어 인스턴스. 원격 복구의 가장 구체적인 target. */
  playerInstanceId: string | null;
  /** 마지막으로 currentTime 이 실제로 늘어난 시각(ISO). */
  lastAudioProgressAt: string | null;
  visibilityState: string | null;
  online: boolean | null;
  realtimeStatus: string | null;
  wakeLockActive: boolean | null;
}

/** 서버 RPC 로 나가는 키 — 늘어나면 여기부터 늘어난다(회귀 테스트가 고정한다). */
export const LIVENESS_PAYLOAD_KEYS: readonly (keyof ClientLivenessSnapshot)[] = [
  'playerInstanceId', 'lastAudioProgressAt', 'visibilityState',
  'online', 'realtimeStatus', 'wakeLockActive',
];

export function readLivenessSnapshot(opts: {
  playerInstanceId: string | null;
  wakeLockActive: boolean | null;
}): ClientLivenessSnapshot {
  const ms = lastAudioProgressAt();
  return {
    playerInstanceId: opts.playerInstanceId,
    lastAudioProgressAt: ms == null ? null : new Date(ms).toISOString(),
    visibilityState: readVisibilityState(),
    online: readOnline(),
    realtimeStatus: realtimeStatus(),
    wakeLockActive: opts.wakeLockActive,
  };
}

/** 테스트용 — 모듈 수준 상태를 비운다. */
export function __resetClientLivenessForTest(): void {
  lastAudioProgressAtMs = null;
  realtimeStatusValue = null;
}
