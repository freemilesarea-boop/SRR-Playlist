/**
 * volumeTrace.ts — "슬라이더는 100 인데 소리가 작다" 를 기기에서 잡는 관찰 장치.
 *
 * 증상은 Player.tsx 의 기존 주석이 이미 설명해 둔 그대로다:
 *   crossfade 가 중간에 끊기면 audio.volume 이 0 이 아니라 0.2 같은 값으로 남고,
 *   스토어와 슬라이더는 1.0 을 가리킨다. 복구 가드는 visibility 이벤트나
 *   30초 하트비트에만 도니까, 그 사이에는 작은 소리가 계속 난다.
 *
 * 그래서 두 가지를 기록한다:
 *   1. 지금 두 <audio> 의 volume / muted / paused 와 스토어 volume (주기적으로)
 *   2. audio.volume 을 **누가** 마지막에 썼는지 (매 쓰기마다)
 *
 * 2번이 핵심이다. 값만 보면 "작다" 까지만 알고, 범인은 모른다.
 *
 * ── 동작을 바꾸지 않는다 ──
 * 프로토타입의 volume/muted 접근자를 감싸되 원본 setter 를 그대로 호출한다.
 * 값을 바꾸지도, 막지도, 미루지도 않는다. 읽고 지나간다.
 *
 * 기본은 꺼져 있다. 매장 태블릿은 이 코드를 한 줄도 실행하지 않는다.
 *
 * 켜는 법 (아무거나):
 *   • URL `?volumeTrace=1`
 *   • localStorage `deudda.volumeTrace` = `'1'`
 *   • 빌드 시 `VITE_VOLUME_TRACE=1`   ← 주소창이 없는 APK 는 이것
 *   • `?audioDebug=1` 세션이면 자동으로 켜진다
 */
import { isAudioDebugEnabled } from './audioDebug';

export const VOLUME_TRACE_STORAGE_KEY = 'deudda.volumeTrace';
export const VOLUME_TRACE_QUERY_KEY = 'volumeTrace';

export interface VolumeTraceGateInput {
  search?: string;
  storage?: Pick<Storage, 'getItem'> | null;
  buildFlag?: string | undefined;
  audioDebug?: boolean;
}

/** 순수 판정 — window 없이 테스트에서 그대로 부를 수 있게 분리. */
export function resolveVolumeTraceEnabled(input: VolumeTraceGateInput = {}): boolean {
  const truthy = (v: string | null | undefined) => v === '1' || v === 'true';
  if (input.audioDebug) return true;
  if (truthy(input.buildFlag)) return true;
  try {
    if (truthy(new URLSearchParams(input.search ?? '').get(VOLUME_TRACE_QUERY_KEY))) return true;
  } catch { /* 이상한 search 문자열 */ }
  try {
    if (truthy(input.storage?.getItem(VOLUME_TRACE_STORAGE_KEY))) return true;
  } catch { /* 저장소 접근이 막힌 브라우저 */ }
  return false;
}

export function isVolumeTraceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  let storage: Pick<Storage, 'getItem'> | null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolveVolumeTraceEnabled({
    search: window.location?.search ?? '',
    storage,
    buildFlag: import.meta.env?.VITE_VOLUME_TRACE as string | undefined,
    audioDebug: isAudioDebugEnabled(),
  });
}

/* ────────── Player 가 알려주는 상태 ────────── */

export interface PlayerDiagState {
  activeIdx: number;
  crossfading: boolean;
  storeVolume: number;
}

let diag: PlayerDiagState = { activeIdx: 0, crossfading: false, storeVolume: 1 };

/** Player 가 자기 로컬 state(activeIdx/crossfading)를 여기로 흘려보낸다. */
export function publishPlayerDiagState(next: PlayerDiagState): void {
  diag = next;
}

export function readPlayerDiagState(): PlayerDiagState {
  return diag;
}

/* ────────── 쓰기 기록 ────────── */

export interface VolumeWrite {
  /** 쓰려고 한 값. */
  value: number;
  /** performance.now() 기준 시각. */
  at: number;
  /** 그 순간 crossfade 중이었는가 — 범인을 가르는 핵심 신호. */
  whileCrossfading: boolean;
  /** 스택에서 뽑은 호출 위치 힌트(미니파이된 빌드에서도 파일:줄은 남는다). */
  from: string;
}

const writes = new WeakMap<object, VolumeWrite>();

export function lastVolumeWrite(el: object | null | undefined): VolumeWrite | null {
  if (!el) return null;
  return writes.get(el) ?? null;
}

/** 스택 첫 줄 중 이 파일이 아닌 프레임을 하나 집어낸다. */
export function callerFromStack(stack: string | undefined): string {
  if (!stack) return '?';
  const lines = stack.split('\n').slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes('volumeTrace')) continue;
    // "at fn (url:12:34)" / "fn@url:12:34" 양쪽 모두에서 꼬리만 남긴다.
    return line.replace(/^at\s+/, '').slice(0, 120);
  }
  return '?';
}

let installed = false;

/**
 * HTMLMediaElement.prototype 의 volume/muted 접근자를 감싼다.
 *
 * 프로토타입을 건드리는 건 가벼운 일이 아니라서, 게이트가 꺼져 있으면
 * 아무것도 하지 않고 돌아간다. 두 번 불러도 한 번만 설치된다.
 */
export function installVolumeTrace(): boolean {
  if (installed) return true;
  if (typeof HTMLMediaElement === 'undefined') return false;
  if (!isVolumeTraceEnabled()) return false;

  const proto = HTMLMediaElement.prototype;
  const volDesc = Object.getOwnPropertyDescriptor(proto, 'volume');
  if (!volDesc?.get || !volDesc.set) return false;
  const origGet = volDesc.get;
  const origSet = volDesc.set;

  Object.defineProperty(proto, 'volume', {
    configurable: true,
    enumerable: volDesc.enumerable,
    get(this: HTMLMediaElement) {
      return origGet.call(this);
    },
    set(this: HTMLMediaElement, v: number) {
      try {
        writes.set(this, {
          value: v,
          at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
          whileCrossfading: diag.crossfading,
          from: callerFromStack(new Error().stack),
        });
      } catch { /* 기록 실패가 재생을 막아서는 안 된다 */ }
      origSet.call(this, v);   // 원본 그대로 — 값도 순서도 바꾸지 않는다
    },
  });

  installed = true;
  return true;
}

/* ────────── 한 줄 보고 ────────── */

const n3 = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—';

/**
 * logcat 한 줄. 프로덕션은 console.log/debug/info 를 지우므로 warn 으로 내보낸다.
 *
 * 판정(CASE A/B)을 사람이 눈으로 하지 않도록 줄 앞머리에 박아준다.
 */
export function formatVolumeTraceLine(
  a: HTMLMediaElement | null,
  b: HTMLMediaElement | null,
  state: PlayerDiagState = diag,
): string {
  const active = state.activeIdx === 0 ? a : b;
  const inactive = state.activeIdx === 0 ? b : a;
  const av = active ? active.volume : null;
  const drift = av !== null && Math.abs(av - state.storeVolume) > 0.01;
  const verdict = drift
    ? (state.crossfading ? 'CASE-A?(crossfade중)' : 'CASE-A(스토어와 불일치)')
    : 'CASE-B(앱 단계 정상)';
  const w = lastVolumeWrite(active);

  return [
    `[볼륨추적:${verdict}]`,
    `store=${n3(state.storeVolume)}`,
    `active[${state.activeIdx}].volume=${n3(av)}`,
    `inactive.volume=${n3(inactive ? inactive.volume : null)}`,
    `muted=${active ? active.muted : '—'}/${inactive ? inactive.muted : '—'}`,
    `paused=${active ? active.paused : '—'}/${inactive ? inactive.paused : '—'}`,
    `crossfading=${state.crossfading}`,
    w
      ? `마지막쓰기=${n3(w.value)}(crossfade중=${w.whileCrossfading}, ${Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - w.at,
        )}ms전, ${w.from})`
      : '마지막쓰기=(설치 후 없음)',
  ].join(' · ');
}

/** 주기 로거. 반환값을 부르면 멈춘다. */
export function startVolumeTraceLogger(intervalMs = 3000): () => void {
  if (!isVolumeTraceEnabled()) return () => {};
  if (typeof document === 'undefined') return () => {};

  const tick = (): void => {
    const els = Array.from(document.querySelectorAll('audio'));
    if (els.length === 0) return;
    console.warn(formatVolumeTraceLine(els[0] ?? null, els[1] ?? null));
  };

  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
