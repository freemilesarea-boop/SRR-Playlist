import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { useBusinessStore } from '@/store/businessStore';
import { shouldWarnBeforeUnload } from '@/lib/unloadWarningPolicy';
import { markReloadReason, type DiagnosticReason } from '@/lib/playbackDiagnostics';

/**
 * 재생 중 탭/창 닫기·새로고침 시 "음악이 중단됩니다" 경고.
 * 웹은 탭이 닫히면 오디오를 유지할 수 없으므로, 개인 사용자가 실수로 닫는 것을 막기 위한 안내.
 *
 * 무인 매장(브랜드/매장 플레이어)에서는 **경고를 띄우지 않는다** — 판단 근거는
 * unloadWarningPolicy.ts 참고. 요약: 아무도 없는 매장에 뜬 브라우저 모달은 자동 복구
 * 리로드를 영구히 막아, 그 자체가 무음 장애의 원인이 된다.
 */
let suppressed = false;

/**
 * 로그아웃·명시적 종료·앱 자체 리로드 직전에 호출하면 다음 unload 경고를 띄우지 않는다.
 *
 * 앱이 스스로 일으키는 리로드는 반드시 이 함수를 거쳐야 한다(=아래 reloadApp 사용).
 * 이 경고가 뜨면 브라우저가 "사이트를 다시 로드할까요? 변경한 내용이 저장되지 않을 수
 * 있습니다" 모달을 띄우고, 무인 매장에서는 아무도 누르지 않아 그 상태로 멈춰 버린다.
 */
export function suppressUnloadWarningOnce(): void {
  suppressed = true;
  // 안전장치: 실제 페이지 이탈이 없으면 잠시 후 해제
  window.setTimeout(() => {
    suppressed = false;
  }, 4000);
}

/**
 * 앱이 스스로 페이지를 리로드할 때 쓰는 **유일한** 진입점.
 *
 * window.location.reload() 를 직접 부르면 beforeunload 경고가 그대로 떠서,
 * 무인 매장에서는 리로드가 모달에 막힌 채 음악이 끊긴다. 배포 적용 · chunk 로드 실패
 * 복구 · 캐시 초기화 등 모든 자동/수동 리로드는 이 함수를 통해야 한다.
 */
export function reloadApp(reason: string): void {
  suppressUnloadWarningOnce();
  if (reason) console.warn(`[reloadApp] ${reason}`);
  // 리로드 사유를 다음 페이지 로드로 넘긴다 — 자동재생 차단/무음이 생겼을 때
  // "왜 리로드됐나" 를 되짚을 수 있게(숙대점 조사에서 이걸 몰라 원인 추정에 시간을 썼다).
  markReloadReason(classifyReloadReason(reason));
  window.location.reload();
}

/** reloadApp 의 자유 문자열 사유 → 진단용 분류. */
export function classifyReloadReason(reason: string): DiagnosticReason {
  const r = (reason || '').toLowerCase();
  if (r.includes('sw ') || r.includes('sw-') || r.includes('service worker')) return 'sw_update';
  if (r.includes('chunk')) return 'chunk_error';
  if (r.includes('heal') || r.includes('recovery') || r.includes('stuck')) return 'self_heal';
  return 'unknown';
}

export function installUnloadGuard(): () => void {
  function onBeforeUnload(e: BeforeUnloadEvent) {
    const warn = shouldWarnBeforeUnload({
      suppressed,
      businessMode: useBusinessStore.getState().businessMode,
      audioActive: usePlaybackHealthStore.getState().audioActive,
    });
    if (!warn) return;
    e.preventDefault();
    // 일부 브라우저는 커스텀 문구를 무시하고 기본 문구를 보여줌
    e.returnValue = '음악 재생이 중단됩니다. 매장 재생을 계속하려면 창을 닫지 마세요.';
    return e.returnValue;
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
