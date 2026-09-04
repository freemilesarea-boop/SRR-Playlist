import { usePlaybackHealthStore } from '@/store/playbackHealthStore';

/**
 * 재생 중 탭/창 닫기·새로고침 시 "음악이 중단됩니다" 경고.
 * 웹은 탭이 닫히면 오디오를 유지할 수 없으므로, 실수로 닫는 것을 막기 위한 안내.
 * 사용자가 명시적으로 정지(playing=false)했거나 로그아웃 등으로 suppress 된 경우엔 경고하지 않음.
 */
let suppressed = false;

/**
 * 로그아웃·명시적 종료·앱 자체 리로드 직전에 호출하면 다음 unload 경고를 띄우지 않는다.
 *
 * 특히 서비스워커 업데이트 리로드에서 필수다 — 이 경고가 뜨면 브라우저가
 * "사이트를 다시 로드할까요? 변경한 내용이 저장되지 않을 수 있습니다" 모달을 띄우고,
 * 무인 매장에서는 아무도 누르지 않아 그 상태로 멈춰 버린다.
 */
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
    // 실제로 **소리가 나고 있을 때만** 경고한다.
    // store.playing 은 "재생 의도" 라서, 오류로 멈춘 플레이어도 true 로 남는다
    // (매장 무인 복구를 위해 onError 가 playing 을 유지한다). 그 상태에서 경고를 띄우면
    // 지킬 음악도 없으면서 새로고침(=복구 수단)만 막게 된다.
    if (!usePlaybackHealthStore.getState().audioActive) return;
    e.preventDefault();
    // 일부 브라우저는 커스텀 문구를 무시하고 기본 문구를 보여줌
    e.returnValue = '음악 재생이 중단됩니다. 매장 재생을 계속하려면 창을 닫지 마세요.';
    return e.returnValue;
  }
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
