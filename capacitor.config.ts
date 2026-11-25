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
    // 웹 화면이 그려지기 전 WebView 기본 흰 배경이 번쩍이지 않게 앱 배경색으로 칠한다.
    backgroundColor: '#0a0a0a',
    // targetSdk 35 앱은 Android 15+ 에서 화면이 상태바·내비게이션바 밑까지 강제로 늘어난다
    // (edge-to-edge). 'auto' 면 그 기기에서만 WebView 에 시스템 바 만큼 여백을 줘서
    // 상단 메뉴·하단 플레이어가 가려지지 않게 한다. Android 14 이하는 그대로.
    adjustMarginsForEdgeToEdge: 'auto',
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
