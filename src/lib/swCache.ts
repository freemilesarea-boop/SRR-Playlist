/**
 * swCache.ts — Service Worker / Cache 정리 유틸.
 * 과거 SW 의 supabase storage CacheFirst 규칙이 오디오 Range 요청을 opaque 로 캐싱해
 * 모바일 재생을 깨뜨렸다. 새 SW 는 오디오를 가로채지 않지만, 기존 사용자 기기에 남은
 * 잘못된 캐시/SW 를 정리해야 한다.
 */

const BAD_AUDIO_CACHE_RE = /audio|supabase-audio|runtime/i;

/** 잘못 캐시된 오디오 관련 캐시만 삭제 (앱 시작 시 1회, best-effort). 다른 캐시는 보존. */
export async function purgeBadAudioCaches(): Promise<string[]> {
  if (typeof caches === 'undefined') return [];
  try {
    const keys = await caches.keys();
    const targets = keys.filter((k) => BAD_AUDIO_CACHE_RE.test(k));
    await Promise.all(targets.map((k) => caches.delete(k)));
    if (targets.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[swCache] purged bad audio caches', targets);
    }
    return targets;
  } catch {
    return [];
  }
}

export interface SwDiagnostics {
  supported: boolean;
  controlled: boolean; // navigator.serviceWorker.controller 존재
  controllerScriptURL: string | null;
  registrations: number;
  cacheKeys: string[];
  hasAudioCache: boolean;
}

/** SW/캐시 상태 진단 (오디오 진단 패널 표시용). */
export async function getSwDiagnostics(): Promise<SwDiagnostics> {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  let registrations = 0;
  let cacheKeys: string[] = [];
  try {
    if (supported) registrations = (await navigator.serviceWorker.getRegistrations()).length;
  } catch { /* noop */ }
  try {
    if (typeof caches !== 'undefined') cacheKeys = await caches.keys();
  } catch { /* noop */ }
  const controller = supported ? navigator.serviceWorker.controller : null;
  return {
    supported,
    controlled: !!controller,
    controllerScriptURL: controller?.scriptURL ?? null,
    registrations,
    cacheKeys,
    hasAudioCache: cacheKeys.some((k) => BAD_AUDIO_CACHE_RE.test(k)),
  };
}

/** SW 등록 해제 + 모든 캐시 삭제 후 새로고침 (관리자 "캐시/SW 초기화" 버튼). */
export async function resetServiceWorkerAndCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* noop */ }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* noop */ }
  try { window.sessionStorage.removeItem('sw-reloaded'); } catch { /* noop */ }
  // 강제 새로고침 (캐시 우회)
  window.location.reload();
}
