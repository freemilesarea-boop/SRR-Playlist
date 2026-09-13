/**
 * playbackFlightRecorder.ts — 재생이 멈추기 "직전" 을 남기는 블랙박스.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 숙대점 2026-09-13 14:48~15:59 조사에서 벽에 부딪혔다. 71분 무음이었는데
 * 서버에 남은 최초 기록은 **정지 36초 뒤의 skip** 이었다. 정상 재생이 정지로
 * 바뀌는 바로 그 순간은 아무 데도 기록되지 않았다.
 *
 * 그때 확인된 공백:
 *   • <audio> 가 waiting · stalled · pause · suspend · abort · emptied ·
 *     playing · loadstart 를 **하나도 관측하지 않는다.**
 *   • 상세 로그(audioDebugWarn)는 디버그 플래그 OFF 면 전량 폐기된다.
 *   • 복구 사다리 1칸(8초)·2칸(20초)은 서버 기록을 남기지 않는다.
 *   • play() 결과는 autoplay 차단 말고는 전부 조용히 삼켜진다.
 *   • Player/audio 인스턴스 식별자가 없어 리마운트를 사후 판별할 수 없다.
 *
 * ── 설계 ────────────────────────────────────────────────────────────────────
 * 평상시에는 **서버로 아무것도 보내지 않는다.** 메모리 링버퍼에만 쌓다가,
 * 정지가 감지되는 순간(복구 사다리 1칸 진입 등) 직전 기록을 한 번에 flush 한다.
 * 정상 매장(화정점)은 사다리에 오르지 않으므로 전송 0건이다.
 *
 * ── 이 모듈이 절대 하지 않는 것 ─────────────────────────────────────────────
 * play() · pause() · load() · currentTime · src · volume · 큐 · crossfade ·
 * 스케줄러를 **읽기만 하고 절대 건드리지 않는다.** 리스너는 순수 관측이며,
 * 기록 실패는 호출부로 전파되지 않는다(전 경로 try/catch).
 */

/** 링버퍼 크기. 60~100 권장 — 정지 직전 수 분을 담기에 충분하다. */
export const RING_CAPACITY = 80;
/** 같은 세션에서 flush 최소 간격. */
export const FLUSH_MIN_INTERVAL_MS = 10 * 60 * 1000;
/** 하루 flush 상한. */
export const FLUSH_MAX_PER_DAY = 20;
/** payload 직렬화 상한 — 넘으면 오래된 항목부터 버린다. */
export const MAX_PAYLOAD_BYTES = 48_000;

const FLUSH_GUARD_KEY = 'deudda:fr-guard';

/* ────────────────────────────────────────────────────────────────────────── */
/* 타입                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** 미디어 엘리먼트에서 직접 오는 이벤트 (active·inactive 양쪽 모두 기록). */
export type MediaEventName =
  | 'loadstart' | 'loadedmetadata' | 'canplay' | 'playing' | 'waiting'
  | 'stalled' | 'suspend' | 'pause' | 'ended' | 'emptied' | 'abort' | 'error';

/** 애플리케이션이 남기는 이벤트. */
export type AppEventName =
  | 'PLAYER_MOUNT' | 'PLAYER_UNMOUNT'
  | 'AUDIO_ATTACHED' | 'AUDIO_DETACHED'
  | 'PLAY_REQUEST' | 'PLAY_RESOLVED' | 'PLAY_REJECTED'
  | 'PAUSE_REQUEST'
  | 'CROSSFADE_START' | 'CROSSFADE_NEXT_PLAY_REQUEST' | 'CROSSFADE_NEXT_PLAYING'
  | 'CROSSFADE_SWAP' | 'CROSSFADE_COMPLETE' | 'CROSSFADE_ABORT'
  | 'RECOVERY_LEVEL_1_START' | 'RECOVERY_LEVEL_1_PLAY_RESULT'
  | 'RECOVERY_LEVEL_2_START' | 'RECOVERY_LEVEL_2_LOAD' | 'RECOVERY_LEVEL_2_PLAY_RESULT'
  | 'RECOVERY_LEVEL_3_START' | 'RECOVERY_LEVEL_4_START'
  | 'STALL_SNAPSHOT';

export type FlightEventName = MediaEventName | AppEventName;

/** 내부 pause() 호출자. 이게 없는데 pause 이벤트가 오면 외부(브라우저/OS) 개입이다. */
export type PauseReason =
  | 'CROSSFADE' | 'INACTIVE_AUDIO' | 'PLAYER_STOP' | 'RECOVERY_MANAGER'
  | 'INVALID_STATE_GUARD' | 'EMERGENCY_BROADCAST' | 'ANNOUNCEMENT'
  | 'AUDIO_OUTPUT_SYNC' | 'COMPONENT_CLEANUP' | 'OTHER_INTERNAL';

export type FlushTrigger =
  | 'recovery_level_1' | 'media_error' | 'play_rejected' | 'invalid_audio_state';

/** 엘리먼트에서 읽어낸 순간 상태. 전부 읽기 전용 접근이다. */
export interface AudioSnapshot {
  ct: number | null;
  dur: number | null;
  paused: boolean | null;
  ended: boolean | null;
  ready: number | null;
  net: number | null;
  bufLen: number | null;
  bufStart: number | null;
  bufEnd: number | null;
  vol: number | null;
  muted: boolean | null;
}

/** 이벤트 시점의 플레이어 문맥. Player 가 콜백으로 제공한다. */
export interface FlightContext {
  trackId: string | null;
  queueIndex: number | null;
  queueLength: number | null;
  activeAudioElementId: string | null;
  crossfadeActive: boolean | null;
  recoveryLevel: string | null;
}

export interface FlightEntry extends AudioSnapshot, FlightContext {
  seq: number;
  tMs: number;
  event: FlightEventName;
  audioElementId: string | null;
  vis: string | null;
  online: boolean | null;
  standalone: boolean | null;
  extra?: Record<string, string | number | boolean | null>;
}

export interface FlushGuard {
  lastFlushAt: number | null;
  dayKey: string;
  countToday: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 순수 함수 — 테스트로 고정되는 부분                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** 링버퍼에 한 건 넣는다. 넘치면 가장 오래된 것부터 버린다. */
export function pushRing<T>(buffer: readonly T[], entry: T, cap = RING_CAPACITY): T[] {
  const next = [...buffer, entry];
  return next.length <= cap ? next : next.slice(next.length - cap);
}

/** 오늘 날짜 키 (UTC 기준 — 서버 집계와 맞춘다). */
export function dayKeyOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * 지금 flush 해도 되는가.
 *  - 같은 세션에서 10분 이내 재전송 금지
 *  - 하루 20회 상한 (날짜가 바뀌면 카운터 초기화)
 */
export function canFlush(guard: FlushGuard, now: number): boolean {
  const today = dayKeyOf(now);
  const countToday = guard.dayKey === today ? guard.countToday : 0;
  if (countToday >= FLUSH_MAX_PER_DAY) return false;
  if (guard.lastFlushAt !== null && now - guard.lastFlushAt < FLUSH_MIN_INTERVAL_MS) return false;
  return true;
}

/** flush 를 한 번 소비한 뒤의 guard. */
export function consumeFlush(guard: FlushGuard, now: number): FlushGuard {
  const today = dayKeyOf(now);
  const countToday = guard.dayKey === today ? guard.countToday : 0;
  return { lastFlushAt: now, dayKey: today, countToday: countToday + 1 };
}

/**
 * 전송 payload 를 만든다. 상한을 넘으면 **오래된 항목부터** 잘라낸다
 * (정지 직전이 가장 중요하므로 최근 것을 남긴다).
 */
export function buildFlushPayload(
  entries: readonly FlightEntry[],
  meta: {
    trigger: FlushTrigger;
    playerInstanceId: string;
    buildHash: string;
    note?: string;
  },
  maxBytes = MAX_PAYLOAD_BYTES,
): Record<string, unknown> {
  let kept = entries.slice();
  const make = (list: readonly FlightEntry[]): Record<string, unknown> => ({
    fr: 1,
    trigger: meta.trigger,
    playerInstanceId: meta.playerInstanceId,
    buildHash: meta.buildHash,
    ...(meta.note ? { note: meta.note } : {}),
    dropped: entries.length - list.length,
    count: list.length,
    events: list,
  });

  let payload = make(kept);
  // 한 건씩 줄이면 느리므로 절반씩 버린다. 최소 1건은 남긴다.
  while (kept.length > 1 && JSON.stringify(payload).length > maxBytes) {
    kept = kept.slice(Math.ceil(kept.length / 2));
    payload = make(kept);
  }
  return payload;
}

/** HTMLMediaElement 에서 상태를 읽는다. 접근 실패는 null 로 떨어뜨린다. */
export function snapshotAudio(el: HTMLMediaElement | null | undefined): AudioSnapshot {
  const empty: AudioSnapshot = {
    ct: null, dur: null, paused: null, ended: null, ready: null, net: null,
    bufLen: null, bufStart: null, bufEnd: null, vol: null, muted: null,
  };
  if (!el) return empty;
  try {
    const b = el.buffered;
    const len = b ? b.length : 0;
    return {
      ct: round3(el.currentTime),
      dur: Number.isFinite(el.duration) ? round3(el.duration) : null,
      paused: el.paused,
      ended: el.ended,
      ready: el.readyState,
      net: el.networkState,
      bufLen: len,
      bufStart: len > 0 ? round3(b.start(0)) : null,
      bufEnd: len > 0 ? round3(b.end(len - 1)) : null,
      vol: round3(el.volume),
      muted: el.muted,
    };
  } catch {
    return empty;
  }
}

function round3(v: number): number | null {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

/** 관측 대상 미디어 이벤트. timeupdate/progress 처럼 고빈도인 것은 넣지 않는다. */
export const OBSERVED_MEDIA_EVENTS: readonly MediaEventName[] = [
  'loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting',
  'stalled', 'suspend', 'pause', 'ended', 'emptied', 'abort', 'error',
];

/* ────────────────────────────────────────────────────────────────────────── */
/* 레코더 (세션 단위 싱글턴)                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

interface RecorderState {
  playerInstanceId: string;
  startedAt: number;
  seq: number;
  buffer: FlightEntry[];
  guard: FlushGuard;
  getContext: () => FlightContext;
}

let state: RecorderState | null = null;

const NEUTRAL_CONTEXT: FlightContext = {
  trackId: null, queueIndex: null, queueLength: null,
  activeAudioElementId: null, crossfadeActive: null, recoveryLevel: null,
};

/** 빌드 식별자 — 어느 배포본이 도는지 판별용. Secret 아님. */
export function buildHash(): string {
  try {
    const v = (import.meta.env.VITE_BUILD_HASH as string | undefined) ?? '';
    if (v) return v;
    return (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
  } catch {
    return 'dev';
  }
}

/** Player mount 마다 새 인스턴스 id. */
export function newPlayerInstanceId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch { /* noop */ }
  return `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadGuard(now: number): FlushGuard {
  const fresh: FlushGuard = { lastFlushAt: null, dayKey: dayKeyOf(now), countToday: 0 };
  try {
    const raw = sessionStorage.getItem(FLUSH_GUARD_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<FlushGuard>;
    if (typeof p.dayKey !== 'string' || typeof p.countToday !== 'number') return fresh;
    return {
      lastFlushAt: typeof p.lastFlushAt === 'number' ? p.lastFlushAt : null,
      dayKey: p.dayKey,
      countToday: p.countToday,
    };
  } catch {
    return fresh;
  }
}

function saveGuard(g: FlushGuard): void {
  try { sessionStorage.setItem(FLUSH_GUARD_KEY, JSON.stringify(g)); } catch { /* noop */ }
}

/** Player mount 시 1회. 같은 id 로 다시 부르면 아무것도 하지 않는다. */
export function initFlightRecorder(playerInstanceId: string, getContext?: () => FlightContext): void {
  if (state?.playerInstanceId === playerInstanceId) return;
  const now = Date.now();
  state = {
    playerInstanceId,
    startedAt: now,
    seq: 0,
    buffer: [],
    guard: loadGuard(now),
    getContext: getContext ?? (() => NEUTRAL_CONTEXT),
  };
}

/** 문맥 공급자 교체 (Player 가 최신 큐/트랙을 넘겨주기 위해). */
export function setFlightContextProvider(getContext: () => FlightContext): void {
  if (state) state.getContext = getContext;
}

/** 테스트/언마운트용. */
export function resetFlightRecorder(): void {
  state = null;
}

export function getFlightBuffer(): readonly FlightEntry[] {
  return state ? state.buffer : [];
}

export function getPlayerInstanceId(): string | null {
  return state ? state.playerInstanceId : null;
}

function readContext(): FlightContext {
  if (!state) return NEUTRAL_CONTEXT;
  try { return state.getContext(); } catch { return NEUTRAL_CONTEXT; }
}

function envBits(): Pick<FlightEntry, 'vis' | 'online' | 'standalone'> {
  let vis: string | null = null;
  let online: boolean | null = null;
  let standalone: boolean | null = null;
  try { vis = typeof document !== 'undefined' ? document.visibilityState : null; } catch { /* noop */ }
  try { online = typeof navigator !== 'undefined' ? navigator.onLine : null; } catch { /* noop */ }
  try {
    standalone = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : null;
  } catch { /* noop */ }
  return { vis, online, standalone };
}

/**
 * 한 건 기록. **절대 throw 하지 않는다.**
 * el 을 주면 그 엘리먼트 상태를, 안 주면 상태 필드는 null 로 남는다.
 */
export function recordFlightEvent(
  event: FlightEventName,
  opts: {
    el?: HTMLMediaElement | null;
    audioElementId?: string | null;
    extra?: Record<string, string | number | boolean | null>;
  } = {},
): void {
  try {
    if (!state) return;
    state.seq += 1;
    const entry: FlightEntry = {
      seq: state.seq,
      tMs: Date.now() - state.startedAt,
      event,
      audioElementId: opts.audioElementId ?? null,
      ...snapshotAudio(opts.el),
      ...readContext(),
      ...envBits(),
      ...(opts.extra ? { extra: opts.extra } : {}),
    };
    state.buffer = pushRing(state.buffer, entry);
  } catch {
    /* 진단이 재생을 망가뜨리면 안 된다 */
  }
}

/** 내부 pause() 호출 직전에 남긴다. 이게 없는 pause 이벤트 = 외부 개입. */
export function recordPauseRequest(
  reason: PauseReason,
  el?: HTMLMediaElement | null,
  audioElementId?: string | null,
): void {
  recordFlightEvent('PAUSE_REQUEST', { el, audioElementId, extra: { reason } });
}

/**
 * play() 결과만 관측한다. **원본 Promise 를 그대로 돌려주므로 호출부 흐름은 불변**이다.
 * 관측용 체인은 자체 catch 를 달아 unhandled rejection 을 만들지 않는다.
 */
export function observePlay<T extends Promise<void> | undefined>(
  p: T,
  site: string,
  el?: HTMLMediaElement | null,
  audioElementId?: string | null,
): T {
  try {
    recordFlightEvent('PLAY_REQUEST', { el, audioElementId, extra: { site } });
    if (p && typeof p.then === 'function') {
      p.then(
        () => { recordFlightEvent('PLAY_RESOLVED', { el, audioElementId, extra: { site } }); },
        (e: unknown) => {
          const name = e && typeof e === 'object' && 'name' in e
            ? String((e as { name?: unknown }).name ?? 'Error')
            : 'Error';
          recordFlightEvent('PLAY_REJECTED', { el, audioElementId, extra: { site, errName: name } });
        },
      );
    }
  } catch {
    /* 관측 실패는 무시 — 원본은 그대로 반환된다 */
  }
  return p;
}

/**
 * 미디어 이벤트 리스너를 붙인다. **순수 관측** — 어떤 재생 API 도 호출하지 않는다.
 * @returns 해제 함수
 */
export function attachMediaEventRecorder(
  el: HTMLMediaElement,
  audioElementId: string,
): () => void {
  const handlers: Array<[MediaEventName, EventListener]> = [];
  try {
    for (const name of OBSERVED_MEDIA_EVENTS) {
      const h: EventListener = () => {
        const extra = name === 'error'
          ? { code: el.error?.code ?? null }
          : undefined;
        recordFlightEvent(name, { el, audioElementId, extra });
      };
      el.addEventListener(name, h);
      handlers.push([name, h]);
    }
    recordFlightEvent('AUDIO_ATTACHED', { el, audioElementId });
  } catch {
    /* noop */
  }
  return () => {
    try {
      for (const [name, h] of handlers) el.removeEventListener(name, h);
      recordFlightEvent('AUDIO_DETACHED', { audioElementId });
    } catch { /* noop */ }
  };
}

/**
 * flush 를 시도한다. 레이트 리밋에 걸리면 **null** 을 돌려준다(전송 안 함).
 * 실제 전송은 호출부가 logPlaybackDiagnostic 으로 한다 — 이 모듈은 네트워크를 모른다.
 */
export function tryBuildFlush(
  trigger: FlushTrigger,
  opts: { note?: string; now?: number } = {},
): Record<string, unknown> | null {
  try {
    if (!state) return null;
    const now = opts.now ?? Date.now();
    if (!canFlush(state.guard, now)) return null;
    const payload = buildFlushPayload(state.buffer, {
      trigger,
      playerInstanceId: state.playerInstanceId,
      buildHash: buildHash(),
      note: opts.note,
    });
    state.guard = consumeFlush(state.guard, now);
    saveGuard(state.guard);
    return payload;
  } catch {
    return null;
  }
}
