/**
 * oauthOutcome.ts — 네이티브 OAuth 왕복의 결말과, 그걸 사용자 문구로 바꾸는 규칙.
 *
 * nativeAuth.ts 에서 분리한 이유는 두 가지다. 하나는 supabase 클라이언트를 끌고
 * 오지 않고 문구 규칙만 테스트하기 위해서고, 다른 하나는 "왜 로그인이 안 됐는지"를
 * 한 곳에서만 정하기 위해서다.
 *
 * 문구를 고를 때의 기준: 사용자가 다음에 무엇을 하면 되는지가 항상 들어가야 한다.
 * 원인만 말하고 끝나면(예: "실패했습니다") 앱을 껐다 켜는 것 말고 할 수 있는 게 없다.
 */

/**
 * 네이티브 OAuth 왕복의 결말.
 *
 * - success        딥링크가 돌아왔고 세션 교환까지 끝남
 * - cancelled      사용자가 브라우저를 닫음(또는 딥링크 없이 앱으로 복귀)
 * - provider_error provider/Supabase 가 error 를 붙여 되돌려줌
 * - exchange_failed 코드는 받았지만 세션 교환이 실패
 * - timeout        아무 신호 없이 제한 시간 경과
 */
export type NativeOAuthOutcome =
  | 'success'
  | 'cancelled'
  | 'provider_error'
  | 'exchange_failed'
  | 'timeout';

/** 브라우저를 여는 것 자체가 실패했을 때(기기에 브라우저 없음 등). */
export const NO_BROWSER_MESSAGE =
  '이 기기에서 로그인 창을 열 수 없습니다. Chrome 등 브라우저를 설치했는지 확인하거나, 이메일로 로그인해주세요.';

/** provider 가 막았을 때의 기존 안내(웹/앱 공통). */
export const PROVIDER_BLOCKED_MESSAGE =
  '앱 내 브라우저 또는 회사/학교 Google 계정에서는 로그인이 제한될 수 있습니다. ' +
  'Chrome 또는 Safari에서 다시 시도하거나, 이메일로 가입/로그인해주세요.';

/**
 * 결말 → 사용자 문구. 'success' 는 알릴 게 없으므로 null.
 */
export function nativeOAuthMessage(outcome: NativeOAuthOutcome): string | null {
  switch (outcome) {
    case 'success':
      return null;
    case 'cancelled':
      // 창을 직접 닫은 경우가 대부분이지만, 딥링크 허용목록이 빠져서 로그인 창이
      // 앱으로 못 돌아오는 경우도 여기로 온다. 양쪽 모두에게 말이 되는 문구여야 한다.
      return '로그인 창이 앱으로 돌아오지 않았습니다. 다시 시도하거나, 이메일로 로그인해주세요.';
    case 'timeout':
      return '구글 응답을 기다리다 시간이 초과됐습니다. 네트워크를 확인하고 다시 시도해주세요.';
    case 'provider_error':
    case 'exchange_failed':
      return PROVIDER_BLOCKED_MESSAGE;
  }
}

/**
 * Browser.open() 이 던진 오류가 "열 브라우저가 없다" 인지.
 *
 * Capacitor 의 Browser 플러그인은 커스텀탭을 띄울 앱이 하나도 없으면 ActivityNotFound
 * 계열 오류를 던진다. 구글 Play 이미지가 아닌 에뮬레이터에서 특히 자주 본다 — 브라우저가
 * 아예 깔려 있지 않기 때문이다. 이때 "회사 계정이라 제한됐다" 는 안내는 완전히 헛다리라,
 * 사용자가 계정을 바꿔가며 시간을 버리게 된다.
 */
export function isBrowserOpenFailure(raw: string): boolean {
  return /ActivityNotFound|No Activity found|no browser|CustomTabs|ERR_UNKNOWN_URL_SCHEME/i.test(raw);
}
