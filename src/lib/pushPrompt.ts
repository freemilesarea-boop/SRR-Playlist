/**
 * pushPrompt — 앱(iOS/Android)을 열었을 때 알림 허용을 물어볼지 정한다.
 *
 * OS 알림 권한 창은 iOS 에서 한 번밖에 못 띄운다(거절하면 설정 앱에서만 다시 켤 수 있다).
 * 그래서 바로 OS 창을 띄우지 않고, 먼저 앱 안에서 "알림 받을까요?"를 묻고
 * '알림 받기'를 누른 사람에게만 OS 창을 띄운다.
 *
 * 정하는 것 (decidePushAction):
 *   sync — 이미 허용된 기기: 조용히 토큰을 다시 등록(재설치·토큰 갱신·다른 계정 로그인 대비)
 *   ask  — 아직 묻지 않은 기기: 앱 안 안내 띄우기
 *   wait — 물어볼 차례지만 첫 방문 안내(Onboarding)가 떠 있다: 그 창을 닫은 뒤에 묻는다
 *   none — 웹, 로그아웃 상태(토큰은 계정에 묶인다), 거절됨, 사용자가 앱에서 직접 끈 경우,
 *          매장·브랜드 플레이어 화면(무인 재생 중 방해 금지), '나중에'로 미룬 기간
 */

export type PushPromptPermission = 'granted' | 'denied' | 'default';
export type PushPromptAction = 'none' | 'sync' | 'ask' | 'wait';

export interface PushPromptState {
  /** '나중에'를 누른 횟수 */
  dismissCount: number;
  /** 이 시각(ms) 전에는 다시 묻지 않는다 */
  nextAt: number;
}

/** '나중에' 뒤 다시 묻기까지 */
export const PUSH_PROMPT_SNOOZE_DAYS = 7;
/** 이만큼 '나중에'를 누르면 더 묻지 않는다(내 정보 › 알림에서 직접 켤 수 있다) */
export const PUSH_PROMPT_MAX_DISMISS = 3;

const STATE_KEY = 'deudda.pushPrompt';
const OPTED_OUT_KEY = 'deudda.push.optedOut';

/** 무인 재생 화면 — 여기서는 묻지 않는다 */
export function isDevicePlayerRoute(pathname: string): boolean {
  return pathname.startsWith('/brand/player/') || pathname.startsWith('/brand/announcer/');
}

export function decidePushAction(input: {
  native: boolean;
  loggedIn: boolean;
  permission: PushPromptPermission;
  optedOut: boolean;
  pathname: string;
  state: PushPromptState;
  /** 첫 방문 안내 창(Onboarding)을 아직 안 닫았다 — 겹쳐 띄우지 않는다 */
  onboardingPending?: boolean;
  now?: number;
}): PushPromptAction {
  const now = input.now ?? Date.now();
  if (!input.native || !input.loggedIn) return 'none';
  if (input.permission === 'granted') return input.optedOut ? 'none' : 'sync';
  if (input.permission === 'denied') return 'none';
  if (input.optedOut) return 'none';
  if (isDevicePlayerRoute(input.pathname)) return 'none';
  if (input.state.dismissCount >= PUSH_PROMPT_MAX_DISMISS) return 'none';
  if (now < input.state.nextAt) return 'none';
  return input.onboardingPending ? 'wait' : 'ask';
}

export function snoozedState(prev: PushPromptState, now = Date.now()): PushPromptState {
  return {
    dismissCount: prev.dismissCount + 1,
    nextAt: now + PUSH_PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000,
  };
}

/** OS 창까지 띄웠으면(허용이든 거절이든) 앱 안 안내는 더 띄우지 않는다. */
export const ANSWERED_STATE: PushPromptState = { dismissCount: PUSH_PROMPT_MAX_DISMISS, nextAt: 0 };

export function readPushPromptState(): PushPromptState {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return { dismissCount: 0, nextAt: 0 };
    const v = JSON.parse(raw) as Partial<PushPromptState>;
    return { dismissCount: Number(v.dismissCount) || 0, nextAt: Number(v.nextAt) || 0 };
  } catch {
    return { dismissCount: 0, nextAt: 0 };
  }
}

export function writePushPromptState(s: PushPromptState): void {
  try { window.localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* 저장 못 해도 이번 실행은 진행 */ }
}

/** 사용자가 앱(내 정보 › 알림)에서 직접 껐는지 — 자동 재등록·안내 모두 하지 않는다. */
export function readPushOptedOut(): boolean {
  try { return window.localStorage.getItem(OPTED_OUT_KEY) === '1'; } catch { return false; }
}

export function writePushOptedOut(v: boolean): void {
  try {
    if (v) window.localStorage.setItem(OPTED_OUT_KEY, '1');
    else window.localStorage.removeItem(OPTED_OUT_KEY);
  } catch { /* noop */ }
}

/** 첫 방문 안내 창(components/Onboarding)이 아직 닫히지 않았는지 — 그 창과 같은 저장 키를 본다. */
export function readOnboardingPending(): boolean {
  try { return !window.localStorage.getItem('srr-onboarding-seen'); } catch { return false; }
}
