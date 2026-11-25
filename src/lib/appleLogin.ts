/**
 * appleLogin.ts — "Apple로 로그인" 버튼을 보여 줄지.
 *
 * App Store 심사 지침 4.8: Google·카카오 같은 타사 로그인을 넣은 앱은 개인정보 보호형
 * 로그인(Sign in with Apple)도 함께 제공해야 한다. 그래서 **iOS 앱에서는 항상** 보인다.
 *
 * 웹·안드로이드는 의무가 아니다. Supabase 에 Apple 제공자를 켠 뒤
 * VITE_ENABLE_APPLE_LOGIN=true 로 열 수 있다(카카오의 VITE_ENABLE_KAKAO_LOGIN 과 같은 방식).
 * 로그인 흐름은 Google 과 같다: 앱은 시스템 브라우저 → 딥링크 복귀(nativeAuth), 웹은 리다이렉트.
 */
import { isNativeApp, nativePlatform } from '@/lib/native';

export function shouldShowAppleLogin(env: { native: boolean; platform: string; flag: string | undefined }): boolean {
  if (env.native && env.platform === 'ios') return true;
  return String(env.flag ?? '').toLowerCase() === 'true';
}

export function isAppleLoginEnabled(): boolean {
  return shouldShowAppleLogin({
    native: isNativeApp(),
    platform: nativePlatform(),
    flag: import.meta.env.VITE_ENABLE_APPLE_LOGIN as string | undefined,
  });
}
