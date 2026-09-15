// 릴리스 서명 · 실기기 배포 경로 회귀 방지.
//
// 여기 있는 것들은 "빌드는 성공하는데 결과물이 쓸모없는" 실수만 모아놓은 것이다:
//   • 서명 키가 저장소에 들어감        → 키가 유출되면 누구나 우리 앱을 사칭해 배포할 수 있다
//   • 키 없이 릴리스 빌드가 나감        → 서명 안 된 APK 는 기기가 설치를 거부한다
//   • .env 없이 APK 가 나감            → 기기에서 '설정 필요' 화면만 뜬다
// 셋 다 빌드 로그에는 아무 경고가 없어서, 폰에 넣어보고서야 안다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

const pkgScripts = (JSON.parse(repoFile('package.json')) as { scripts: Record<string, string> }).scripts;

describe('릴리스 서명 배선', () => {
  const gradle = repoFile('android/app/build.gradle');

  it('키는 android/keystore.properties 에서만 읽는다 (build.gradle 에 비밀번호가 없다)', () => {
    expect(gradle).toContain("rootProject.file('keystore.properties')");
    // storePassword 는 프로퍼티 참조여야 한다 — 따옴표로 박힌 문자열이면 커밋된 비밀번호다.
    expect(gradle).toContain("storePassword keystoreProps['storePassword']");
    expect(gradle).not.toMatch(/storePassword\s+["'][^"']+["']/);
    expect(gradle).not.toMatch(/keyPassword\s+["'][^"']+["']/);
  });

  it('키가 없으면 release 에 서명 설정을 붙이지 않는다', () => {
    // 붙여두면 "키 없음" 이 빌드 실패가 아니라 서명 없는 APK 로 조용히 나온다.
    expect(gradle).toContain('if (hasReleaseKey)');
    expect(gradle).toContain('signingConfig signingConfigs.release');
  });

  it('키와 설정 파일이 .gitignore 에 있다', () => {
    const ignore = repoFile('.gitignore');
    expect(ignore).toContain('android/keystore.properties');
    expect(ignore).toContain('*.jks');
    expect(ignore).toContain('*.keystore');
  });
});

describe('키 생성 스크립트', () => {
  const sh = repoFile('scripts/android-keystore.sh');

  it('npm script 로 연결돼 있다', () => {
    expect(pkgScripts['keystore']).toContain('scripts/android-keystore.sh');
  });

  it('이미 있는 키를 덮어쓰지 않는다', () => {
    // 이 키를 잃으면 같은 앱으로 업데이트를 영영 올릴 수 없다. 덮어쓰기는 복구 불가다.
    expect(sh).toContain('[[ -f "$KEYSTORE" ]] && die');
    expect(sh).toContain('[[ -f "$PROPS" ]] && die');
  });

  it('비밀번호를 두 번 받아 확인하고, 화면에 남기지 않는다', () => {
    expect(sh).toContain('read -r -s -p');
    expect(sh).toContain('[[ "$PW1" == "$PW2" ]] || die');
  });

  it('설정 파일 권한을 600 으로 좁힌다', () => {
    expect(sh).toContain('chmod 600 "$PROPS"');
  });

  it('카카오 키 해시를 뽑아준다 (손으로 base64 변환하면 꼭 틀린다)', () => {
    expect(sh).toContain('openssl sha1 -binary | openssl base64');
  });
});

describe('실기기 배포 스크립트', () => {
  const sh = repoFile('scripts/android-apk.sh');

  it('npm script 로 연결돼 있다', () => {
    expect(pkgScripts['apk']).toContain('scripts/android-apk.sh');
    expect(pkgScripts['aab']).toContain('--aab');
  });

  it('키 없이도 디버그 APK 는 만들어진다 (실기기 확인이 키를 기다리지 않게)', () => {
    expect(sh).toContain('MODE=debug');
    expect(sh).toContain('assembleDebug');
  });

  it('릴리스를 요청했는데 키가 없으면 빌드 전에 끊는다', () => {
    expect(sh).toContain('if [[ "$MODE" == release && ! -f android/keystore.properties ]]');
  });

  it('빌드 전에 JDK 와 .env 를 확인한다', () => {
    expect(sh).toContain('pick-jdk.sh');
    expect(sh).toContain('require-env.sh');
  });

  it('서명이 다른 버전이 깔려 있으면 지우고 다시 설치한다', () => {
    // 디버그 키와 릴리스 키는 서명이 달라 adb install -r 이 INSTALL_FAILED_UPDATE_INCOMPATIBLE 로 죽는다.
    expect(sh).toContain('uninstall com.deudda.app');
  });

  it('산출물은 커밋되지 않는다', () => {
    expect(sh).toContain('dist-apk');
    expect(repoFile('.gitignore')).toContain('dist-apk/');
  });
});

// 버전이 갈라지면 "폰에 깔린 게 어느 빌드인지" 를 아무도 모르게 된다.
// Play 는 같은 versionCode 를 두 번 받지 않으므로 올릴 때마다 증가해야 한다.
describe('버전 단일 진실 원천', () => {
  const gradle = repoFile('android/app/build.gradle');
  const pkgVersion = (JSON.parse(repoFile('package.json')) as { version: string }).version;

  it('package.json 의 version 이 x.y.z 형식이다', () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('build.gradle 이 버전을 박아두지 않고 package.json 에서 읽는다', () => {
    expect(gradle).toContain("rootProject.file('../package.json')");
    expect(gradle).toContain('versionName deuddaVersionName');
    expect(gradle).toContain('versionCode deuddaVersionCode');
    // 상수로 되돌아가면 두 곳을 따로 고치게 된다.
    expect(gradle).not.toMatch(/versionName\s+"/);
    expect(gradle).not.toMatch(/versionCode\s+\d/);
  });

  it('versionCode 공식이 단조 증가한다', () => {
    // build.gradle 과 같은 공식. 여기서 깨지면 Play 업로드가 거부된다.
    const code = (v: string) => {
      const [a, b, c] = v.split('.').map(Number);
      return a * 10000 + b * 100 + c;
    };
    expect(code('1.0.0')).toBe(10000);
    expect(code('1.0.1')).toBeGreaterThan(code('1.0.0'));
    expect(code('1.1.0')).toBeGreaterThan(code('1.0.99'));
    expect(code('2.0.0')).toBeGreaterThan(code('1.99.99'));
  });

  it('iOS MARKETING_VERSION 이 package.json 과 같다', () => {
    const pbx = repoFile('ios/App/App.xcodeproj/project.pbxproj');
    const found = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
    expect(found.length).toBeGreaterThan(0);
    for (const v of found) expect(v).toBe(pkgVersion);
  });

  it('apk 스크립트도 같은 곳에서 버전을 읽는다', () => {
    // build.gradle 만 바꾸고 스크립트를 놔두면 파일 이름이 deudda-0-debug.apk 가 된다.
    expect(repoFile('scripts/android-apk.sh')).toContain("require('./package.json').version");
  });
});
