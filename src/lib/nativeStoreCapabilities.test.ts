// 매장·브랜드 운영에 필요한 네이티브 쉘 설정 회귀 방지.
//
// 이 값들이 빠지면 앱 빌드는 성공하지만 매장에서 음악이 멈춘다:
//   • iOS UIBackgroundModes=audio 없음 → 화면 잠금/백그라운드 전환 즉시 재생 정지
//   • Android WAKE_LOCK 권한 없음     → KeepAwake 실패 → 화면 꺼짐 → WebView 스로틀
// Info.plist / AndroidManifest.xml 은 손으로 고치는 파일이라 되돌아가기 쉬워 테스트로 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

describe('iOS Info.plist', () => {
  const plist = repoFile('ios/App/App/Info.plist');

  it('백그라운드 오디오 모드가 선언돼 있다', () => {
    expect(plist).toContain('<key>UIBackgroundModes</key>');
    const modes = plist.slice(plist.indexOf('<key>UIBackgroundModes</key>'));
    const arrayEnd = modes.indexOf('</array>');
    expect(modes.slice(0, arrayEnd)).toContain('<string>audio</string>');
  });

  it('OAuth 딥링크 스킴이 유지된다 (앱에서 구글/카카오 로그인)', () => {
    expect(plist).toContain('<string>com.deudda.app</string>');
  });
});

describe('AndroidManifest.xml', () => {
  const manifest = repoFile('android/app/src/main/AndroidManifest.xml');

  it('화면 꺼짐 방지를 위한 WAKE_LOCK 권한이 있다', () => {
    expect(manifest).toContain('android.permission.WAKE_LOCK');
  });

  it('네트워크 권한이 유지된다', () => {
    expect(manifest).toContain('android.permission.INTERNET');
  });
});

describe('백그라운드 재생', () => {
  it('iOS: UIBackgroundModes 만으로는 부족하다 — AVAudioSession .playback 이 설정돼 있다', () => {
    // 기본 카테고리(soloAmbient)는 화면 잠금/백그라운드에서 음소거된다.
    const appDelegate = repoFile('ios/App/App/AppDelegate.swift');
    expect(appDelegate).toContain('import AVFoundation');
    expect(appDelegate).toContain('AVAudioSession.sharedInstance().setCategory(.playback');
  });

  it('Android: mediaPlayback 포그라운드 서비스가 선언돼 있다', () => {
    const manifest = repoFile('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    expect(manifest).toContain('.StorePlaybackService');
    expect(manifest).toContain('android:foregroundServiceType="mediaPlayback"');
  });

  it('Android: 앱 로컬 플러그인이 MainActivity 에 등록돼 있다 (자동 검색되지 않는다)', () => {
    expect(repoFile('android/app/src/main/java/com/deudda/app/MainActivity.java'))
      .toContain('registerPlugin(StorePlaybackServicePlugin.class)');
  });

  it('Android: 서비스가 Android 14+ 의 타입 명시 startForeground 를 쓴다', () => {
    const svc = repoFile('android/app/src/main/java/com/deudda/app/StorePlaybackService.java');
    expect(svc).toContain('FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK');
  });
});

describe('푸시 알림 네이티브 설정', () => {
  it('Android: POST_NOTIFICATIONS 권한 (Android 13+ 런타임 권한)', () => {
    expect(repoFile('android/app/src/main/AndroidManifest.xml')).toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('Android: google-services.json 이 있으면 플러그인이 적용된다 (없으면 빌드는 그대로 성공)', () => {
    const gradle = repoFile('android/app/build.gradle');
    expect(gradle).toContain('com.google.gms.google-services');
    expect(gradle).toContain('google-services.json');
  });

  it('iOS: AppDelegate 가 APNs 토큰을 Capacitor 로 넘긴다', () => {
    // 이 두 콜백이 없으면 iOS 에서 registration 이벤트가 영원히 오지 않는다.
    const appDelegate = repoFile('ios/App/App/AppDelegate.swift');
    expect(appDelegate).toContain('didRegisterForRemoteNotificationsWithDeviceToken');
    expect(appDelegate).toContain('capacitorDidRegisterForRemoteNotifications');
    expect(appDelegate).toContain('didFailToRegisterForRemoteNotificationsWithError');
    expect(appDelegate).toContain('capacitorDidFailToRegisterForRemoteNotifications');
  });

  it('iOS: aps-environment 엔타이틀먼트가 있다', () => {
    expect(repoFile('ios/App/App/App.entitlements')).toContain('aps-environment');
  });
});

describe('앱 전용 셸(터치 레이아웃)', () => {
  // 매장 태블릿은 CSS 폭이 1024px 을 넘어서 Tailwind 의 lg: 분기가 그대로 걸린다.
  // 그러면 데스크톱 레이아웃(사이드바 + 1500px 본문)이 뜨는데, 손가락으로 쓰는 기기에는
  // 맞지 않는다. index.css 의 .native-shell 규칙이 이를 되돌리는데, 그 규칙은 컴포넌트에
  // 붙은 클래스 훅에 의존한다 — 한쪽만 이름이 바뀌면 조용히 깨지므로 양쪽을 함께 고정한다.
  const css = repoFile('src/index.css');

  it('네이티브 표식을 <html> 에 붙인다', () => {
    expect(repoFile('src/lib/native.ts')).toContain("classList.add('native-shell')");
  });

  it.each([
    ['app-sidebar', 'src/components/Sidebar.tsx'],
    ['app-bottom-nav', 'src/components/BottomNav.tsx'],
    ['app-player', 'src/components/player/Player.tsx'],
    ['app-main', 'src/components/AppShell.tsx'],
    ['app-footer', 'src/components/AppShell.tsx'],
  ])('%s 훅이 CSS 와 컴포넌트 양쪽에 있다', (hook, file) => {
    expect(css).toContain(`.native-shell .${hook}`);
    expect(repoFile(file)).toContain(hook);
  });

  it('본문 폭을 제한한다 — 태블릿에서 한 줄이 화면 끝까지 늘어나지 않도록', () => {
    expect(css).toContain('.native-shell .app-main > main');
  });

  it('글자 키우기는 태블릿에서만 — 폰에서 키우면 좁은 화면이 넘친다', () => {
    // 앱 하나가 아이폰(393px) · 갤럭시(412px) · 매장 태블릿(1280~2000px)에서 같이 돈다.
    // 루트 글자를 무조건 키우면 폰에서 글자가 잘리고 버튼이 겹친다.
    const media = css.slice(css.indexOf('@media (min-width: 1024px)'));
    expect(media).toContain('font-size: 17px');
    const beforeMedia = css.slice(0, css.indexOf('@media (min-width: 1024px)'));
    expect(beforeMedia).not.toContain('font-size: 17px');
    // 본문 폭 제한과 탭 높이도 태블릿 전용이어야 한다.
    expect(media).toContain('.native-shell .app-main > main');
    expect(media).toContain('min-height: 56px');
  });

  it('뼈대(사이드바·하단탭·푸터)는 폰에도 적용된다', () => {
    const beforeMedia = css.slice(0, css.indexOf('@media (min-width: 1024px)'));
    expect(beforeMedia).toContain('.native-shell .app-sidebar');
    expect(beforeMedia).toContain('.native-shell .app-bottom-nav');
    expect(beforeMedia).toContain('.native-shell .app-footer');
  });

  it.each([
    'src/pages/StorePlayerPage.tsx',
    'src/pages/BrandPlayerPage.tsx',
  ])('%s 의 전체화면이 노치/홈바를 피한다', (file) => {
    // fixed inset-0 은 화면 전체를 덮으므로, 아이폰에서는 상단 바가 노치 밑으로,
    // 하단 상태줄이 홈 인디케이터 밑으로 들어가 가려진다.
    const src = repoFile(file);
    for (const m of src.matchAll(/className="fixed inset-0 z-\[90\][^"]*"/g)) {
      expect(m[0]).toContain('pt-safe');
      expect(m[0]).toContain('pb-safe');
    }
  });

  it('앱을 켰을 때 역할에 맞는 화면으로 보내는 훅이 셸에 붙어 있다', () => {
    // 이게 빠지면 매장 태블릿이 재부팅 후 마케팅 홈에 머물고, 아무도 안 누르면 무음이 된다.
    expect(repoFile('src/components/AppShell.tsx')).toContain('useNativeLanding()');
  });

  it('사업자 정보가 앱에서도 표시된다 (전자상거래법)', () => {
    // 앱은 푸터를 숨기므로, 그 정보가 전체 메뉴로 옮겨졌는지 확인한다.
    // 값은 companyInfo.ts 한 곳에서만 관리한다 — 두 군데면 한쪽만 바뀌어 어긋난다.
    expect(repoFile('src/components/native/NativeMoreSheet.tsx')).toContain('COMPANY_INFO');
    expect(repoFile('src/components/common/Footer.tsx')).toContain("from '@/lib/companyInfo'");
    expect(repoFile('src/lib/companyInfo.ts')).toContain('사업자번호');
  });

  it('하단탭 마지막 칸이 전체 메뉴를 연다', () => {
    // 앱에는 사이드바가 없다. 이 통로가 없으면 브랜드·결제·관리자 화면에 갈 방법이 없다.
    const nav = repoFile('src/components/BottomNav.tsx');
    expect(nav).toContain('NativeMoreSheet');
    expect(nav).toContain("item.action === 'more'");
  });
});

describe('앱에서의 로그인 · 결제 경로', () => {
  it('우리 앱은 인앱 브라우저 차단 대상에서 제외된다', () => {
    // 안드로이드 WebView UA 의 "; wv)" 때문에 우리 앱이 스스로를 차단해
    // 앱으로는 Google 로그인이 아예 불가능했다.
    expect(repoFile('src/lib/inAppBrowser.ts')).toContain('if (isNativeApp())');
  });

  it.each([
    'src/pages/SubscriptionPage.tsx',
    'src/pages/PricingPage.tsx',
    'src/pages/EnterprisePayPage.tsx',
  ])('%s 는 결제창을 openExternalUrl 로 연다', (file) => {
    // 앱에서 window.location.href 로 결제창에 넘기면 WebView 가 통째로 나가버리고
    // 돌아올 길이 없다. 카드사 앱을 띄우는 intent:// 스킴도 WebView 에서는 실패한다.
    const src = repoFile(file);
    expect(src).toContain('openExternalUrl(res.payurl');
    expect(src).not.toContain('window.location.href = res.payurl');
  });
});

describe('가상기기 실행 경로', () => {
  const pkgScripts = (JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> }).scripts;

  it('에뮬레이터 실행 스크립트가 npm script 로 연결돼 있다', () => {
    expect(pkgScripts['android:emu']).toContain('scripts/run-emulator.sh');
    expect(pkgScripts['android:build']).toContain('scripts/android-build.sh');
    expect(repoFile('scripts/android-build.sh')).toContain('assembleDebug');
  });

  it('Gradle 을 돌리기 전에 쓸 수 있는 JDK 를 고른다', () => {
    // Android Studio 2026 의 번들 JDK 는 25 라서 Gradle 8.11 이 못 읽는다
    // ('Unsupported class file major version 69'). 두 진입점 모두 이 검사를 거쳐야 한다.
    expect(repoFile('scripts/run-emulator.sh')).toContain('pick-jdk.sh');
    expect(repoFile('scripts/android-build.sh')).toContain('pick-jdk.sh');
  });

  it('설치 대상 기기를 직접 넘긴다 (cap run 의 선택 프롬프트에서 멈추지 않게)', () => {
    // 부팅된 에뮬레이터와 꺼져 있는 AVD 가 같이 잡히면 cap run 이 화살표 메뉴를 띄우고
    // 멈춰서 앱이 아예 설치되지 않는다.
    const sh = repoFile('scripts/run-emulator.sh');
    expect(sh).toContain('--target "$DEVICE_ID"');
    expect(sh).toContain('install_with_gradle');
  });

  it('라이브 리로드가 가상기기·실기기 양쪽에서 붙는다 (adb reverse + localhost)', () => {
    const sh = repoFile('scripts/run-emulator.sh');
    // 10.0.2.2 는 표준 에뮬레이터에서만 통해서 실제 매장 태블릿에서는 안 붙는다.
    // adb reverse + localhost 라야 양쪽 모두 동작한다.
    expect(sh).toContain('adb');
    expect(sh).toContain('reverse tcp:5173 tcp:5173');
    expect(sh).toContain('--host localhost');
    expect(sh).not.toContain('--host 10.0.2.2');
    expect(sh).toContain('cap run android');
  });

  it('실기기 모드와 번들 빌드 모드를 지원한다', () => {
    const sh = repoFile('scripts/run-emulator.sh');
    expect(sh).toContain('--device');
    expect(sh).toContain('--apk');
  });

  it('macOS 의 Android SDK 기본 경로를 찾는다', () => {
    // 맥의 Android Studio 기본 경로는 ~/Library/Android/sdk 다.
    // 리눅스 경로(~/Android/Sdk)만 보면 맥 사용자는 SDK 를 깔아도 못 찾는다.
    const sh = repoFile('scripts/run-emulator.sh');
    expect(sh).toContain('$HOME/Library/Android/sdk');
    expect(sh).toContain('$HOME/Android/Sdk');
  });

  it('.env 가 템플릿 상태면 걸러낸다', () => {
    // 예전 검사는 '^VITE_SUPABASE_URL=https' 였는데, 템플릿의
    // your-project-ref.supabase.co 도 https 로 시작해서 그대로 통과했다.
    // 실제로 사용자 맥에서 "✓ .env 확인" 이 뜬 뒤 앱이 설정 화면만 보여줬다.
    const sh = repoFile('scripts/run-emulator.sh');
    expect(sh).toContain('your-project-ref');
    expect(sh).toContain('your-anon-key');
  });

  it('Gradle 이 SDK 를 못 찾는 흔한 실패를 미리 막는다', () => {
    // local.properties 가 없으면 assembleDebug 가 'SDK location not found' 로 죽는다.
    expect(repoFile('scripts/run-emulator.sh')).toContain('local.properties');
  });
});

describe('capacitor 의존성', () => {
  const pkg = JSON.parse(repoFile('package.json')) as {
    dependencies: Record<string, string>;
  };

  it('KeepAwake 플러그인이 런타임 의존성으로 설치돼 있다', () => {
    expect(pkg.dependencies['@capacitor-community/keep-awake']).toBeTruthy();
  });

  it('PushNotifications 플러그인이 런타임 의존성으로 설치돼 있다', () => {
    expect(pkg.dependencies['@capacitor/push-notifications']).toBeTruthy();
  });
});
