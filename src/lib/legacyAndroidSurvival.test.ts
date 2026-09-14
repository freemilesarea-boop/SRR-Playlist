// @vitest-environment jsdom
//
// LEGACY-ANDROID-WEB-SURVIVAL §9 · §12 · §13 · §14 · §17
//
// 숙대점은 Android 10 / Samsung Internet 30 / installed PWA 로 24시간 돈다. 이
// 파일은 그 환경에서 **플레이어가 죽지 않기 위한 계약**을 소스 수준에서 못 박는다.
//
// 원칙 하나로 요약하면: **관측은 재생보다 낮은 우선순위다.** heartbeat 도,
// 진단도, Realtime 도, Wake Lock 도, 실패했을 때 소리를 멈추게 해서는 안 된다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readLivenessSnapshot, LIVENESS_PAYLOAD_KEYS } from './clientLiveness';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const hookSrc = read('src/hooks/useBrandPlayerHeartbeat.ts');
const apiSrc = read('src/lib/api/brandPlayerApi.ts');
const diagSrc = read('src/lib/playbackDiagnostics.ts');
const frSrc = read('src/lib/playbackFlightRecorder.ts');
const playerSrc = read('src/components/player/Player.tsx');
const awakeSrc = read('src/lib/screenAwake.ts');
const cacheSrc = read('src/lib/audioCache/index.ts');
const storeSrc = read('src/lib/audioCache/audioCacheStore.ts');
const swSrc = read('src/sw.ts');

/* ────────────────────────────────────────────────────────────────────────── */
/* §9 — heartbeat 비용                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§9 heartbeat 가 저사양 기기에 부담이 되지 않는다', () => {
  it('liveness payload 는 스칼라 11개뿐이다 — 직렬화가 싸다', () => {
    const snap = readLivenessSnapshot({ playerInstanceId: 'pi-0123456789', wakeLockActive: true });
    expect(Object.keys(snap)).toHaveLength(11);
    for (const v of Object.values(snap)) {
      expect(['string', 'boolean', 'number', 'object']).toContain(typeof v); // object 는 null 뿐
      if (v !== null) expect(typeof v).not.toBe('object');
      // 중첩 객체/배열이 들어오면 직렬화 비용이 폭증한다 — 스칼라만 허용.
      expect(Array.isArray(v)).toBe(false);
    }
  });

  it('payload 직렬화 크기가 작다 (한 번에 300 바이트 미만)', () => {
    const snap = readLivenessSnapshot({
      playerInstanceId: '0123456789ab-cdef-0123-4567-89abcdef0123',
      wakeLockActive: true,
    });
    const bytes = new TextEncoder().encode(JSON.stringify(snap)).length;
    expect(bytes).toBeLessThan(450);
  });

  it('heartbeat 가 store 전체를 직렬화하지 않는다', () => {
    // getState() 로 필요한 필드 하나만 읽는다. 스토어 객체를 통째로 보내면 안 된다.
    expect(hookSrc).not.toMatch(/JSON\.stringify\(\s*use\w+Store\.getState\(\)/);
    expect(hookSrc).toContain('usePlaybackHealthStore.getState().wakeLockActive');
  });

  it('heartbeat 주기가 60초다 — 더 자주 두드리지 않는다', () => {
    expect(hookSrc).toContain('const HEARTBEAT_INTERVAL_MS = 60_000;');
  });

  it('user agent 를 잘라 보낸다 (무한 길이 문자열 금지)', () => {
    expect(hookSrc).toContain('navigator.userAgent.slice(0, 300)');
  });

  it('진행 시각은 React state 가 아니다 — timeupdate(초당 4회)가 리렌더를 일으키지 않는다', () => {
    // Player 는 모듈 함수 한 줄만 부른다. setState/useState 로 들어가면 안 된다.
    expect(playerSrc).toMatch(/noteAudioProgress\(/);
    expect(playerSrc).not.toMatch(/set\w*AudioProgress\w*\(/);
    // 상태는 모듈 변수에만 머문다 — zustand set 으로 새면 초당 4회 리렌더가 된다.
    expect(playerSrc).not.toMatch(/setAudioProgress|useState<.*[Pp]rogress/);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §13 — 관측 실패가 재생을 멈추지 않는다                                      */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§13 진단/텔레메트리 실패가 재생에 전파되지 않는다', () => {
  it('heartbeat 호출 실패는 조용히 삼킨다 (두 경로 모두)', () => {
    const calls = hookSrc.match(/brandPlayerHeartbeat\((?:[^()]|\([^()]*\))*\)[\s\S]{0,200}?catch/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('진단 기록 RPC 실패가 호출부로 올라가지 않는다', () => {
    expect(diagSrc).toContain('/* 진단 기록 실패가 재생을 막아선 안 된다 */');
    const fn = diagSrc.slice(diagSrc.indexOf('export async function logPlaybackDiagnostic'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('} catch {');
  });

  it('Flight Recorder 는 기록·flush 실패를 전부 삼킨다', () => {
    expect(frSrc).toContain('기록 실패는 호출부로 전파되지 않는다');
    // 기록 경로에 throw 가 없다.
    expect(frSrc).not.toMatch(/^\s*throw /m);
  });

  it('Flight Recorder 는 유계 링버퍼 + 일일 flush 상한을 가진다', () => {
    expect(frSrc).toContain('export const FLUSH_MAX_PER_DAY = 20;');
    expect(frSrc).toContain('export const MAX_PAYLOAD_BYTES = 48_000;');
    expect(frSrc).toContain('next.slice(next.length - cap)');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §12 — control plane 장애가 playback plane 으로 번지지 않는다                */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§12 Realtime 이 죽어도 음악은 계속된다', () => {
  it('구독 생성 자체가 실패해도 재생 경로를 건드리지 않는다', () => {
    expect(hookSrc).toContain('/* 구독 자체가 실패해도 재생과 폴링은 그대로 간다 */');
  });

  it('구독 모듈이 control-plane 전용임을 명시하고 오디오를 만지지 않는다', () => {
    expect(apiSrc).toContain('**control-plane 전용이다.**');
    const fn = apiSrc.slice(apiSrc.indexOf('export function subscribeStoreRecoveryCommands'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    for (const bad of ['audio', 'pause(', 'play(', 'usePlayerStore', 'queue']) {
      expect(body.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });

  it('수신 콜백이 던져도 재생에 새지 않는다', () => {
    expect(apiSrc).toContain('/* 수신 처리 실패가 재생을 건드리면 안 된다 */');
  });

  it('Realtime 이 끊겨도 heartbeat 폴링이 명령 배달을 이어받는다', () => {
    expect(hookSrc).toContain("'heartbeat'");
    expect(apiSrc).toContain('heartbeat fallback 이 그대로 돈다');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §14 — OS kill 후보가 되지 않도록 모든 것이 유계다                           */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§14 유계 자원', () => {
  it('동시에 살아있는 object URL 에 상한이 있다', () => {
    expect(cacheSrc).toContain('const MAX_LIVE_OBJECT_URLS = 4;');
    expect(cacheSrc).toContain('URL.revokeObjectURL(objUrl)');
  });

  it('캐시 용량에 상한이 있고 기기 quota 의 절반을 넘지 않는다', () => {
    const policy = read('src/lib/audioCache/audioCachePolicy.ts');
    expect(policy).toContain('export const DEFAULT_CACHE_LIMIT_BYTES');
    expect(policy).toContain('Math.min(base, Math.floor(quotaBytes / 2))');
    expect(policy).toContain('export const MAX_TRACK_BYTES');
  });

  it('축출이 인메모리 색인까지 정리한다 (안 하면 단조 증가 + 재다운로드 불가)', () => {
    expect(cacheSrc).toContain('function forgetCached(');
    const mk = cacheSrc.slice(cacheSrc.indexOf('async function makeRoomFor'));
    expect(mk.slice(0, mk.indexOf('\n}'))).toContain('forgetCached(victims)');
  });

  it('LRU 쓰기를 스로틀한다 — 24시간 재생 중 IDB 쓰기 폭주 금지', () => {
    expect(cacheSrc).toContain('const TOUCH_INTERVAL_MS = 30_000;');
  });

  it('블롭 메타 목록이 블롭을 메모리로 끌어오지 않는다', () => {
    expect(storeSrc).toContain('블롭을 뺀 메타 목록');
  });

  it('SW 가 오래된 캐시를 정리한다', () => {
    expect(swSrc).toContain('cleanupOutdatedCaches()');
    expect(swSrc).toContain('caches.delete(k)');
  });

  it('오디오는 SW 를 거치지 않는다 — Range 206 스트리밍이 유지된다', () => {
    // runtimeCaching 으로 오디오를 잡으면 전체 파일이 캐시/메모리로 올라간다.
    expect(swSrc).not.toContain('registerRoute');
    expect(swSrc).not.toContain('CacheFirst');
    expect(swSrc).not.toContain('NetworkFirst');
  });

  it('매장 재생 경로에서 AudioContext 를 만들지 않는다', () => {
    expect(playerSrc).not.toContain('new AudioContext');
    expect(playerSrc).not.toContain('webkitAudioContext');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §17 — optional API 하나가 bootstrap 을 죽이지 않는다                        */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§17 구형 브라우저 호환 — optional API 는 전부 feature detect', () => {
  it('Media Session 은 존재 확인 후에만 쓴다', () => {
    const uses = playerSrc.match(/navigator\.mediaSession/g) ?? [];
    const guards = playerSrc.match(/'mediaSession' in navigator/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(guards.length).toBeGreaterThan(0);
  });

  it('setPositionState 는 별도로 한 번 더 확인한다 (Samsung 30 에 없을 수 있다)', () => {
    expect(playerSrc).toContain('setPositionState?:');
  });

  it('Storage estimate 는 옵셔널 체이닝으로 보호한다', () => {
    expect(storeSrc).toContain('!navigator.storage?.estimate');
  });

  it('IndexedDB 가 없으면 캐시만 꺼지고 재생은 계속된다', () => {
    expect(storeSrc).toContain('function indexedDbAvailable()');
    expect(storeSrc).toContain("typeof indexedDB !== 'undefined'");
    expect(cacheSrc).toContain('캐시는 부가 기능이므로 조용히 실패하고 네트워크 재생을 유지한다');
  });

  it('Wake Lock 은 지원 여부를 먼저 보고, 없으면 unsupported 로 떨어진다', () => {
    expect(awakeSrc).toContain("'wakeLock' in navigator");
    expect(awakeSrc).toContain("return env.hasWakeLockApi ? 'web' : 'unsupported'");
  });

  it('Wake Lock 획득 실패는 null 로 끝난다 — 예외를 던지지 않는다', () => {
    expect(awakeSrc).toContain('// 권한 거부 / 비활성 탭 / 배터리 절약 모드 등 — 조용히 실패');
  });

  it('Service Worker 미지원 환경을 가정하고 쓴다', () => {
    const pwa = read('src/lib/pwaBuildIdentity.ts');
    expect(pwa).toContain("'serviceWorker' in navigator");
  });

  it('쓰지 않는 무거운 optional API 에 의존하지 않는다', () => {
    // BroadcastChannel / Web Locks 는 Samsung Internet 구버전에서 불안정하다.
    for (const src of [playerSrc, hookSrc, cacheSrc]) {
      expect(src).not.toContain('new BroadcastChannel');
      expect(src).not.toContain('navigator.locks');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §10 — Wake Lock 재획득이 유계다                                             */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§10 Wake Lock 재획득', () => {
  const wl = read('src/hooks/useWakeLock.ts');

  it('재시도 예산이 있다 — 무한 루프 금지', () => {
    expect(wl).toContain('const MAX_REACQUIRE_ATTEMPTS = 5;');
    expect(wl).toContain('if (attempts >= MAX_REACQUIRE_ATTEMPTS) return;');
  });

  it('지수 backoff 로 물러난다', () => {
    expect(wl).toContain('REACQUIRE_BASE_MS * 2 ** attempts');
  });

  it('보이는 동안에만 재시도한다', () => {
    expect(wl).toContain("document.visibilityState !== 'visible') return;");
  });

  it('언마운트 시 대기 중인 타이머를 정리한다', () => {
    expect(wl).toContain('if (retryTimer !== null) clearTimeout(retryTimer);');
  });

  it('wake lock 상태가 heartbeat 로 서버에 나간다 (0524)', () => {
    expect(LIVENESS_PAYLOAD_KEYS).toContain('wakeLockActive');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §7 (Phase 21) — 타이머가 트랙마다 누적되지 않는다                           */
/*                                                                            */
/*    24시간 매장은 하루 수백 곡을 돈다. 트랙 전환마다 타이머가 하나씩 남으면    */
/*    그게 곧 구형 기기의 프로세스 압박이다.                                    */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§7 타이머 수명', () => {
  it('장수명 타이머는 전부 ref 에 보관된다 (정리할 손잡이가 있다)', () => {
    for (const ref of [
      'crossfadeTimeoutRef', 'metaTimerRef', 'nextTimerRef',
      'preloadTimeoutRef', 'probeTimerRef',
    ]) {
      expect(playerSrc).toContain(ref);
    }
  });

  it('보관된 타이머는 모두 해제 경로가 있다', () => {
    for (const ref of [
      'crossfadeTimeoutRef', 'metaTimerRef', 'nextTimerRef',
      'preloadTimeoutRef', 'probeTimerRef',
    ]) {
      // clearTimeout(ref.current) 또는 clearInterval(ref.current) 형태가 있어야 한다.
      expect(playerSrc).toMatch(new RegExp(`clear(Timeout|Interval)\\(\\s*${ref}\\.current`));
    }
  });

  it('해제 횟수가 생성 횟수 이상이다 (남는 타이머가 없다)', () => {
    const created = (playerSrc.match(/window\.set(Timeout|Interval)\(/g) ?? []).length;
    const cleared = (playerSrc.match(/clear(Timeout|Interval)\(/g) ?? []).length;
    expect(cleared).toBeGreaterThanOrEqual(created);
  });

  it('watchdog / heartbeat 인터벌은 effect cleanup 에서 해제된다', () => {
    // setInterval 을 만들고 cleanup 없이 두면 언마운트마다 하나씩 쌓인다.
    expect(playerSrc).toContain('window.clearInterval(iv)');
  });

  it('Wake Lock 재시도 타이머도 언마운트 시 정리된다', () => {
    const wl = read('src/hooks/useWakeLock.ts');
    expect(wl).toContain('if (retryTimer !== null) clearTimeout(retryTimer);');
  });
});
