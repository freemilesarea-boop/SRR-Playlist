/**
 * nativeAuth.ts — Capacitor 네이티브 앱에서의 OAuth(구글/카카오) 딥링크 처리.
 *
 * 웹은 `redirectTo`가 같은 origin(/auth/callback)이라 SDK가 URL의 ?code= 를 자동 교환한다.
 * 네이티브는 origin 이 capacitor://localhost 라 외부 브라우저가 되돌아올 수 없으므로,
 * 커스텀 스킴 딥링크(com.deudda.app://auth/callback)로 앱을 다시 깨워 코드를 교환한다.
 *
 * 흐름:
 *   1) signInWithOAuth({ redirectTo: 딥링크, skipBrowserRedirect: true }) → provider URL 획득
 *   2) @capacitor/browser 로 시스템 브라우저(커스텀탭/SFSafariVC) 오픈
 *   3) provider→supabase→딥링크 리다이렉트 → OS 가 앱을 appUrlOpen 으로 깨움
 *   4) 딥링크에 실려 온 자격증명으로 세션 수립
 *   5) onAuthStateChange 발화 → 프로필 로드 → /auth/callback 라우트로 이동해 첫 화면 분기
 *
 * 4) 에서 자격증명이 오는 형태가 두 가지다. 어느 쪽이 오는지는 supabase 클라이언트의
 * flowType 이 정한다:
 *   - implicit (supabase-js 기본값, 지금 우리 설정) → 프래그먼트에 토큰:
 *       com.deudda.app://auth/callback#access_token=...&refresh_token=...
 *   - pkce                                        → 쿼리에 코드:
 *       com.deudda.app://auth/callback?code=...
 *
 * 예전에는 ?code= 만 읽었다. 우리 클라이언트는 flowType 을 지정하지 않아 줄곧
 * implicit 이었으므로, 구글 인증이 서버에서 멀쩡히 끝나고 딥링크까지 돌아와도
 * 앱은 "코드가 없다" 며 매번 로그인 실패로 처리했다. 웹에서만 되던 이유는
 * detectSessionInUrl:true 가 /auth/callback 페이지에서 프래그먼트를 알아서
 * 읽어줬기 때문이다 — 딥링크에는 그 경로가 없다.
 *
 * 그래서 양쪽을 모두 받는다. 나중에 flowType 을 pkce 로 바꿔도 그대로 동작한다.
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

/**
 * 딥링크에 실려 온 것이 무엇인지 판별한다.
 *
 * 순수 함수로 떼어놓은 이유는, 이 판별이 틀리면 로그인이 통째로 죽는데 기기 없이는
 * 재현이 어렵기 때문이다. 여기만 테스트로 고정해두면 나머지는 배선일 뿐이다.
 */
export type OAuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

export function parseOAuthCallback(url: string): OAuthCallback {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'error', message: 'invalid_url' };
  }

  // 에러는 쿼리로도 프래그먼트로도 온다(provider 와 flowType 에 따라 다르다).
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const error =
    u.searchParams.get('error_description') ??
    u.searchParams.get('error') ??
    hash.get('error_description') ??
    hash.get('error');
  // 에러를 먼저 본다 — 에러와 자격증명이 같이 오는 경우는 없고, 섞여 있다면 에러가 진실이다.
  if (error) return { kind: 'error', message: error };

  const code = u.searchParams.get('code');
  if (code) return { kind: 'code', code };

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };

  return { kind: 'error', message: 'no_credentials' };
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

    const parsed = parseOAuthCallback(url);
    if (parsed.kind === 'error') {
      console.warn('[native-oauth] callback error', parsed.message);
      settlePending('provider_error');
      onResult(FAIL_ROUTE);
      return;
    }

    // pkce 면 코드를 교환하고, implicit 이면 받은 토큰으로 세션을 세운다.
    const { error } =
      parsed.kind === 'code'
        ? await supabase.auth.exchangeCodeForSession(parsed.code)
        : await supabase.auth.setSession({
            access_token: parsed.accessToken,
            refresh_token: parsed.refreshToken,
          });
    if (error) {
      console.warn('[native-oauth] session failed', error.message);
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
