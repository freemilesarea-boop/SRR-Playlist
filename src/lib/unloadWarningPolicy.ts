/**
 * unloadWarningPolicy.ts — "창을 닫으면 음악이 끊깁니다" 경고를 띄울지 결정하는 순수 정책.
 *
 * 배경 (프로덕션 장애):
 *   무인 매장 모니터에 Chrome 의 **"사이트를 다시 로드할까요? / 변경한 내용이 저장되지
 *   않을 수 있습니다"** 모달이 뜬 채로 멈춰 있고 음악이 나오지 않는 사례가 반복 보고됐다.
 *   이 모달은 beforeunload 경고 때문에 뜬다. 매장에는 아무도 없으므로 [다시 로드]/[취소]
 *   중 어느 것도 눌리지 않고, 그 순간부터 앱의 **자동 복구(리로드)가 영구히 차단**된다.
 *   즉 이 경고는 매장에서 음악을 지켜주는 게 아니라, 음악을 되살릴 유일한 수단을 막는다.
 *
 * 정책:
 *   1. 앱이 스스로 일으킨 리로드(배포 적용 · chunk 복구 · 캐시 초기화 · 로그아웃) 직전이면
 *      경고하지 않는다 — 우리가 의도한 이동이다.
 *   2. **매장/브랜드 플레이어 모드에서는 절대 경고하지 않는다.** 무인 키오스크에 뜬 모달은
 *      아무도 못 누르는 영구 차단이다. 실수로 창을 닫는 것보다, 자동 복구가 막혀 무음으로
 *      방치되는 쪽의 피해가 압도적으로 크다.
 *   3. 개인 사용자는 기존과 동일 — **실제로 소리가 나고 있을 때만** 경고한다.
 *      store.playing 은 "재생 의도"라서 오류로 멈춘 플레이어도 true 로 남는다. 그 상태에서
 *      경고하면 지킬 음악도 없이 새로고침(=복구 수단)만 막게 된다.
 */

export interface UnloadWarningInput {
  /** 앱이 스스로 일으킨 리로드/이동 직전인가 (suppressUnloadWarningOnce 호출됨). */
  suppressed: boolean;
  /** 매장/브랜드 플레이어(무인 키오스크) 모드인가. */
  businessMode: boolean;
  /** 오디오가 **실제로** 소리를 내고 있는가 (재생 "의도"가 아니라 playing/pause 이벤트 기준). */
  audioActive: boolean;
}

/** 지금 beforeunload 경고를 띄워야 하는가. */
export function shouldWarnBeforeUnload(i: UnloadWarningInput): boolean {
  if (i.suppressed) return false;
  // 무인 매장: 누를 사람이 없는 모달 = 자동 복구 영구 차단. 절대 띄우지 않는다.
  if (i.businessMode) return false;
  return i.audioActive;
}
