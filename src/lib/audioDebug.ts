/**
 * audioDebug — Phase 3-4 debug flag gate.
 *
 * Production 콘솔에서 audio 관련 진단 로그를 기본 OFF 로 하고, debug flag 를
 * 켠 세션에서만 출력. 기능 로직은 무변경 · 로그만 gate.
 *
 * 활성화 (둘 중 하나):
 *   • URL query `?audioDebug=1`
 *   • localStorage `deudda.audioDebug` = `'1'`
 *
 * long-run harness (`deudda.audioLongRun` / `?audioLongRun=1`) 활성화 시에도
 * audioDebug 는 자동 true 로 간주. 별도 flag 조작 불필요.
 *
 * 비활성화:
 *   localStorage.removeItem('deudda.audioDebug')
 */

const STORAGE_KEY_DEBUG = 'deudda.audioDebug';
const STORAGE_KEY_LONGRUN = 'deudda.audioLongRun';
const QUERY_DEBUG = 'audioDebug';
const QUERY_LONGRUN = 'audioLongRun';

export function isAudioDebugEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get(QUERY_DEBUG) === '1') return true;
    if (params.get(QUERY_LONGRUN) === '1') return true;
    const ls = window.localStorage;
    if (!ls) return false;
    if (ls.getItem(STORAGE_KEY_DEBUG) === '1') return true;
    if (ls.getItem(STORAGE_KEY_LONGRUN) === '1') return true;
  } catch { /* silent */ }
  return false;
}

export function audioDebugWarn(...args: unknown[]): void {
  if (!isAudioDebugEnabled()) return;
  console.warn(...args);
}

export function audioDebugLog(...args: unknown[]): void {
  if (!isAudioDebugEnabled()) return;
  console.log(...args);
}

export function audioDebugError(...args: unknown[]): void {
  if (!isAudioDebugEnabled()) return;
  console.error(...args);
}

export function audioDebugInfo(...args: unknown[]): void {
  if (!isAudioDebugEnabled()) return;
  console.info(...args);
}
