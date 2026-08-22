import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 설정 — 웹앱(듣다)을 iOS/Android 네이티브 쉘로 패키징.
 *
 * 데이터 파이프라인은 웹과 100% 동일한 Supabase 백엔드를 공유하므로, 앱에서의
 * 스트리밍·결제·정산이 모두 실시간으로 웹/관리자에 반영된다(0477 Realtime 참고).
 *
 * webDir: Vite 빌드 산출물(dist)을 네이티브 번들에 포함해 오프라인에서도 로드.
 * appId : 역도메인(소유 도메인 deudda.com 기준). 스토어 등록 후 변경 불가이므로 고정.
 */
const config: CapacitorConfig = {
  appId: 'com.deudda.app',
  appName: '듣다',
  webDir: 'dist',
  // 네이티브는 로컬 번들에서 로드(capacitor://localhost / https://localhost).
  // server.url 은 개발용 라이브 리로드에만 사용 — 배포 빌드에는 절대 넣지 않음.
  ios: {
    contentInset: 'always',
  },
  android: {
    // OAuth 딥링크/외부 링크가 기본 브라우저가 아닌 커스텀탭에서 열리도록 @capacitor/browser 사용.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
    Keyboard: {
      resize: 'native',
    },
  },
};

export default config;
