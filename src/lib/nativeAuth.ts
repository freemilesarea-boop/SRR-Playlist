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
 * 네이티브 설정(문서 docs/APP_PACKAGING.md §6):
 *   - Android: AndroidManifest.xml 에 scheme=com.deudda.app intent-filter
 *   - iOS: Info.plist CFBundleURLTypes 에 com.deudda.app
 *   - Supabase 대시보드 Auth → URL Configuration 에 딥링크 redirect URL 허용목록 추가
 */
import { supabase } from '@/lib/supabase';
import { isNativeApp } from '@/lib/native';

/** 네이티브 OAuth 리다이렉트용 커스텀 스킴 딥링크. capacitor.config appId 와 일치. */
export const NATIVE_OAUTH_REDIRECT = 'com.deudda.app://auth/callback';

/** 딥링크 교환 실패 시 착륙 경로(웹 AuthCallback 의 에러 처리와 동일 규약). */
const FAIL_ROUTE = '/login?error=oauth_callback_failed';

/**
 * 네이티브 OAuth 로그인 시작. 시스템 브라우저를 열고, 나머지는 appUrlOpen 리스너가 처리.
 * (웹에서 호출되면 아무 것도 하지 않음 — 방어적 가드.)
 */
export async function nativeOAuthSignIn(
  provider: 'google' | 'kakao',
  scopes?: string,
): Promise<void> {
  if (!isNativeApp()) return;
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
  await Browser.open({ url: data.url });
}

let deepLinkBound = false;

/**
 * OAuth 딥링크 콜백 리스너 등록(앱 생애주기 1회). 코드 교환 후 onResult(경로) 호출.
 * onResult 는 React 라우터 navigate 로 연결(App.tsx 에서 주입) — 성공 시 /auth/callback,
 * 실패 시 /login?error=... 로 이동.
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
      onResult(FAIL_ROUTE);
      return;
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      onResult(FAIL_ROUTE);
      return;
    }
    // 세션 set 완료 → 웹과 동일하게 AuthCallback 라우트에서 account_type 첫 화면 분기.
    onResult('/auth/callback');
  });
}
