/**
 * nativeAuth.ts — Capacitor 네이티브 앱에서의 OAuth(구글/카카오) 딥링크 처리.
 *
 * 웹은 `redirectTo`가 같은 origin(/auth/callback)이라 SDK가 URL의 ?code= 를 자동 교환한다.
 * 네이티브는 origin 이 capacitor://localhost 라 외부 브라우저가 되돌아올 수 없으므로,
 * 커스텀 스킴 딥링크(com.deudda.app://auth/callback)로 앱을 다시 깨워 코드를 교환한다.
 *
 * 흐름(PKCE):
 *   1) signInWithOAuth({ redirectTo: 딥링크, skipBrowserRedirect: true }) → provider URL 획득
 *      (이 때 PKCE code_verifier 가 WebView localStorage 에 저장됨)
 *   2) @capacitor/browser 로 시스템 브라우저(커스텀탭/SFSafariVC) 오픈
 *   3) provider→supabase→딥링크 리다이렉트 → OS 가 앱을 appUrlOpen 으로 깨움
 *   4) 딥링크의 ?code= 를 exchangeCodeForSession 으로 세션 교환(같은 WebView 라 verifier 접근 OK)
 *   5) onAuthStateChange 발화 → 프로필 로드 → /auth/callback 라우트로 이동해 첫 화면 분기
 *
 * 왕복이 "끝났다"는 신호가 반드시 온다는 보장은 없다. 딥링크가 허용목록에 없거나,
 * 기기에 브라우저가 없거나, 사용자가 그냥 탭을 닫으면 3)이 영영 오지 않는다. 예전에는
 * 그 경우 로그인 버튼이 "Google 처리 중…" 스피너로 영구히 잠겨서, 사용자는 앱을
 * 강제 종료하는 것 말고 할 수 있는 게 없었다. 그래서 이 모듈은 시작한 왕복을 항상
 * 하나의 NativeOAuthOutcome 으로 끝낸다 — 성공이든, 취소든, 시간 초과든.
 *
 * 네이티브 설정(문서 docs/APP_PACKAGING.md §6):
 *   - Android: AndroidManifest.xml 에 scheme=com.deudda.app intent-filter
 *   - iOS: Info.plist CFBundleURLTypes 에 com.deudda.app
 *   - Supabase 대시보드 Auth → URL Configuration 에 딥링크 redirect URL 허용목록 추가
 *     (이게 빠지면 Supabase 가 딥링크 대신 Site URL 로 보내서 앱이 깨어나지 않는다.
 *      증상은 'cancelled' 또는 'timeout' 으로 나타난다.)
 */
import { supabase } from '@/lib/supabase';
import { isNativeApp } from '@/lib/native';
import type { NativeOAuthOutcome } from '@/lib/oauthOutcome';

/** 왕복의 결말 타입은 oauthOutcome 이 정의한다(문구 규칙과 같은 곳). */
export type { NativeOAuthOutcome };

/** 네이티브 OAuth 리다이렉트용 커스텀 스킴 딥링크. capacitor.config appId 와 일치. */
export const NATIVE_OAUTH_REDIRECT = 'com.deudda.app://auth/callback';

/** 딥링크 교환 실패 시 착륙 경로(웹 AuthCallback 의 에러 처리와 동일 규약). */
const FAIL_ROUTE = '/login?error=oauth_callback_failed';

/**
 * 왕복 제한 시간. 사용자가 구글 계정을 고르고 2단계 인증까지 하는 시간을 넉넉히 준다.
 * 이 시간은 "아무 신호도 없는" 경우의 최후 안전망일 뿐이다 — 브라우저를 닫으면
 * browserFinished 가 훨씬 먼저 온다.
 */
const ROUND_TRIP_TIMEOUT_MS = 180_000;

/**
 * browserFinished 를 곧바로 취소로 보지 않고 기다리는 시간.
 * 딥링크로 복귀할 때 안드로이드는 browserFinished 와 appUrlOpen 을 아주 짧은 간격으로
 * 연달아 보내며 순서가 뒤집히기도 한다. 이 유예가 없으면 성공을 취소로 오판한다.
 */
const DISMISS_GRACE_MS = 1_500;

interface Pending {
  settle: (outcome: NativeOAuthOutcome) => void;
  timeoutId: number;
  dismissId: number | null;
  /** 이번 왕복에서 딥링크를 이미 봤는가 — browserFinished 오판 방지 */
  deepLinkSeen: boolean;
}

let pending: Pending | null = null;

/** 진행 중인 왕복을 주어진 결말로 끝낸다. 이미 끝났으면 아무 것도 하지 않는다. */
function settlePending(outcome: NativeOAuthOutcome): void {
  const p = pending;
  if (!p) return;
  pending = null;
  window.clearTimeout(p.timeoutId);
  if (p.dismissId !== null) window.clearTimeout(p.dismissId);
  p.settle(outcome);
}

/** 진행 중인 왕복이 있는지(테스트/진단용). */
export function isNativeOAuthPending(): boolean {
  return pending !== null;
}

/**
 * 네이티브 OAuth 로그인 시작. 시스템 브라우저를 열고 왕복이 끝날 때까지 기다린다.
 *
 * 반환값이 'success' 가 아니면 호출부가 사용자에게 이유를 알려야 한다.
 * 브라우저를 열지 못하면(기기에 브라우저 없음 등) throw — 이건 왕복을 시작조차
 * 못한 것이므로 결말이 아니라 오류다.
 *
 * 웹에서 호출되면 아무 것도 하지 않고 'success' 를 돌려준다(방어적 가드 — 웹은
 * 이 경로를 쓰지 않는다).
 */
export async function nativeOAuthSignIn(
  provider: 'google' | 'kakao',
  scopes?: string,
): Promise<NativeOAuthOutcome> {
  if (!isNativeApp()) return 'success';

  // 이전 왕복이 남아 있으면(더블탭 등) 취소로 정리하고 새로 시작한다.
  settlePending('cancelled');

  const { Browser } = await import('@capacitor/browser');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      ...(scopes ? { scopes } : {}),
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('OAuth URL 생성에 실패했습니다.');

  // 브라우저를 열기 "전에" 대기 상태를 만든다. 딥링크가 즉시(세션이 살아 있어
  // 동의 화면 없이) 돌아오는 경우에도 신호를 놓치지 않기 위해서다.
  const outcome = new Promise<NativeOAuthOutcome>((resolve) => {
    const timeoutId = window.setTimeout(() => settlePending('timeout'), ROUND_TRIP_TIMEOUT_MS);
    pending = { settle: resolve, timeoutId, dismissId: null, deepLinkSeen: false };
  });

  try {
    await Browser.open({ url: data.url });
  } catch (err) {
    settlePending('cancelled');
    throw err;
  }

  return outcome;
}

let deepLinkBound = false;

/**
 * OAuth 딥링크 콜백 리스너 등록(앱 생애주기 1회). 코드 교환 후 onResult(경로) 호출.
 * onResult 는 React 라우터 navigate 로 연결(App.tsx 에서 주입) — 성공 시 /auth/callback,
 * 실패 시 /login?error=... 로 이동.
 *
 * browserFinished 도 함께 듣는다. 사용자가 로그인 창을 그냥 닫으면 딥링크는 영영
 * 오지 않으므로, 그걸 취소로 확정해 호출부의 스피너를 풀어준다.
 */
export async function initNativeAuthDeepLink(
  onResult: (path: string) => void,
): Promise<void> {
  if (!isNativeApp() || deepLinkBound) return;
  deepLinkBound = true;

  const { App } = await import('@capacitor/app');
  const { Browser } = await import('@capacitor/browser');

  await App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(NATIVE_OAUTH_REDIRECT)) return;
    // 딥링크를 봤다는 표시를 가장 먼저 — 아래 await 사이에 browserFinished 가
    // 끼어들어 성공을 취소로 뒤집는 것을 막는다.
    if (pending) {
      pending.deepLinkSeen = true;
      if (pending.dismissId !== null) {
        window.clearTimeout(pending.dismissId);
        pending.dismissId = null;
      }
    }

    // 브라우저(커스텀탭)를 닫고 앱으로 복귀
    try {
      await Browser.close();
    } catch {
      /* 이미 닫혔을 수 있음 */
    }

    let code: string | null = null;
    let providerError: string | null = null;
    try {
      const u = new URL(url);
      code = u.searchParams.get('code');
      providerError =
        u.searchParams.get('error_description') ?? u.searchParams.get('error');
    } catch {
      /* URL 파싱 실패 → 실패 처리 */
    }

    if (providerError || !code) {
      settlePending('provider_error');
      onResult(FAIL_ROUTE);
      return;
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      settlePending('exchange_failed');
      onResult(FAIL_ROUTE);
      return;
    }
    // 세션 set 완료 → 웹과 동일하게 AuthCallback 라우트에서 account_type 첫 화면 분기.
    settlePending('success');
    onResult('/auth/callback');
  });

  // 사용자가 로그인 창을 닫음 → 딥링크는 오지 않는다. 다만 딥링크 복귀 시에도
  // 이 이벤트가 함께 오므로, 유예 시간을 두고 그 동안 딥링크가 없을 때만 취소 확정.
  await Browser.addListener('browserFinished', () => {
    const p = pending;
    if (!p || p.deepLinkSeen || p.dismissId !== null) return;
    p.dismissId = window.setTimeout(() => {
      if (pending && !pending.deepLinkSeen) settlePending('cancelled');
    }, DISMISS_GRACE_MS);
  });
}
