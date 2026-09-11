#!/usr/bin/env node
/**
 * push-doctor — 푸시 알림 설정이 어디까지 됐는지 점검한다.
 *
 *   npm run push:doctor
 *
 * 푸시는 조각이 여러 개라(앱 파일 · 서버 시크릿 · 권한) 하나만 빠져도 조용히
 * 아무 일도 일어나지 않는다. 무엇이 빠졌는지 한 번에 보여준다.
 *
 * 로컬에서 확인 가능한 것만 검사한다. 서버 시크릿(Supabase Edge Secrets)은
 * 여기서 볼 수 없으므로 목록만 안내한다.
 */
import { readFileSync, existsSync } from 'node:fs';

const APP_ID = 'com.deudda.app';
let fail = 0;
let warn = 0;

const ok = (m) => console.log(`  [OK] ${m}`);
const bad = (m, how) => {
  fail++;
  console.log(`  [빠짐] ${m}`);
  if (how) console.log(`         → ${how}`);
};
const note = (m) => {
  warn++;
  console.log(`  [확인] ${m}`);
};

function read(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

console.log('\n안드로이드 앱 (FCM)');

const gsPath = 'android/app/google-services.json';
if (!existsSync(gsPath)) {
  bad(
    `${gsPath} 없음 — 푸시만 비활성 (빌드는 성공)`,
    'Firebase 콘솔 → 프로젝트 설정 → 내 앱 → Android 앱 추가 → google-services.json 을 android/app/ 에 저장',
  );
} else {
  let gs = null;
  try {
    gs = JSON.parse(read(gsPath));
  } catch {
    /* 아래에서 처리 */
  }
  if (!gs) {
    bad(`${gsPath} 가 올바른 JSON 이 아님`, '파일을 다시 내려받으세요');
  } else {
    const projectId = gs.project_info?.project_id;
    if (projectId) ok(`Firebase 프로젝트: ${projectId}`);
    else bad('project_info.project_id 없음', '파일을 다시 내려받으세요');

    const pkgs = (gs.client ?? [])
      .map((c) => c.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    if (pkgs.includes(APP_ID)) {
      ok(`패키지명 일치: ${APP_ID}`);
    } else {
      bad(
        `패키지명 불일치 — 파일에 있는 것: ${pkgs.join(', ') || '(없음)'}`,
        `Firebase 에서 패키지명을 ${APP_ID} 로 해서 Android 앱을 추가하세요`,
      );
    }
  }
}

const buildGradle = read('android/app/capacitor.build.gradle') ?? '';
if (buildGradle.includes('capacitor-push-notifications')) ok('push-notifications 플러그인이 gradle 에 연결됨');
else bad('gradle 에 push-notifications 없음', 'npx cap sync android 를 실행하세요');

const manifest = read('android/app/src/main/AndroidManifest.xml') ?? '';
if (manifest.includes('POST_NOTIFICATIONS')) ok('POST_NOTIFICATIONS 권한 선언됨 (Android 13+)');
else bad('POST_NOTIFICATIONS 권한 없음', 'AndroidManifest.xml 에 추가하세요');

console.log('\niOS 앱 (APNs)');
const plist = read('ios/App/App/Info.plist') ?? '';
const entitlements = read('ios/App/App/App.entitlements') ?? '';
if (entitlements.includes('aps-environment')) ok('aps-environment 엔타이틀먼트 있음');
else bad('aps-environment 없음', 'ios/App/App/App.entitlements 에 추가하세요');
if (plist.includes('UIBackgroundModes')) ok('UIBackgroundModes 선언됨');
else note('UIBackgroundModes 확인 필요');

console.log('\n서버 (Supabase Edge Secrets)');
console.log('  여기서는 볼 수 없습니다. 대시보드 → Edge Functions → Secrets 에서 확인하세요.');
console.log('    안드로이드  FCM_SERVICE_ACCOUNT_JSON   (Firebase → 서비스 계정 → 새 비공개 키 JSON 전체)');
console.log('    iOS         APNS_KEY_P8 · APNS_KEY_ID · APNS_TEAM_ID');
console.log('    웹(PWA)     VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT');
console.log('  설정 여부는 앱에서 "테스트 알림" 을 눌렀을 때 응답의 ready 값으로 확인됩니다.');

console.log('');
if (fail > 0) {
  console.log(`${fail}개 항목이 빠졌습니다. 위 안내대로 채운 뒤 다시 실행하세요.\n`);
  process.exit(1);
}
console.log(`앱 쪽 설정은 준비됐습니다.${warn ? ` (확인 권장 ${warn}건)` : ''} 남은 것은 서버 시크릿뿐입니다.\n`);
