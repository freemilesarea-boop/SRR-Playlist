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

describe('가상기기 실행 경로', () => {
  const pkgScripts = (JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> }).scripts;

  it('에뮬레이터 실행 스크립트가 npm script 로 연결돼 있다', () => {
    expect(pkgScripts['android:emu']).toContain('scripts/run-emulator.sh');
    expect(pkgScripts['android:build']).toContain('assembleDebug');
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
