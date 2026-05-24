import { usePlayerStore } from '@/store/playerStore';

/**
 * 재생 중 탭/창 닫기·새로고침 시 "음악이 중단됩니다" 경고.
 * 웹은 탭이 닫히면 오디오를 유지할 수 없으므로, 실수로 닫는 것을 막기 위한 안내.
 * 사용자가 명시적으로 정지(playing=false)했거나 로그아웃 등으로 suppress 된 경우엔 경고하지 않음.
 */
let suppressed = false;

/** 로그아웃·명시적 종료 직전에 호출하면 다음 unload 경고를 띄우지 않는다. */
export function suppressUnloadWarningOnce(): void {
  suppressed = true;
  // 안전장치: 실제 페이지 이탈이 없으면 잠시 후 해제
  window.setTimeout(() => {
    suppressed = false;
  }, 4000);
}

export function installUnloadGuard(): () => void {
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (suppressed) return;
    // 실제로 재생 중일 때만 경고 (명시적 정지 시 playing=false → 경고 없음)
    if (!usePlayerStore.getState().playing) return;
    e.preventDefault();
    // 일부 브라우저는 커스텀 문구를 무시하고 기본 문구를 보여줌
    e.returnValue = '음악 재생이 중단됩니다. 매장 재생을 계속하려면 창을 닫지 마세요.';
    return e.returnValue;
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
