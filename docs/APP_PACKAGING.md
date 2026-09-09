# 앱 패키징 가이드 — 듣다 (iOS / Android)

웹앱(Vite + React PWA)을 **Capacitor 7**로 감싸 App Store · Google Play에 출시하기 위한 문서.
웹과 **동일한 Supabase 백엔드**를 공유하므로, 앱에서의 스트리밍·결제·정산이 실시간으로
웹/관리자에 반영된다(실시간 파이프라인은 `migrations/0477` + 대시보드 `LiveStreamMonitor` 참고).

---

## 1. 구조 요약

```
웹 코드(src/) ──vite build──▶ dist/ ──cap sync──▶ android/  (Android Studio → .aab)
                                          └────────▶ ios/      (Xcode → .ipa)
```

- **하나의 코드베이스**가 웹/PWA/iOS/Android에서 함께 실행된다.
- 네이티브 전용 분기는 `src/lib/native.ts` 한 곳에 모임(`isNativeApp()` 가드).
  - 네이티브에서는 **Service Worker 미등록**(Capacitor가 로컬 번들 직접 서빙 → SW와 충돌 방지).
  - 상태바/스플래시/안드로이드 하드웨어 back 을 `initNativeShell()`에서 제어.
- `capacitor.config.ts` — appId `com.deudda.app`, appName `듣다`, webDir `dist`.

## 2. 저장소에 커밋되는 것 / 안 되는 것

- **커밋**: `capacitor.config.ts`, `android/`, `ios/` 네이티브 프로젝트(설정·매니페스트·아이콘 자리).
- **커밋 제외**(`cap sync`로 재생성 — 각 `.gitignore` 반영):
  - `android/app/src/main/assets/public`, `ios/App/App/public` (복사된 웹 빌드)
  - 생성된 `capacitor.config.json`, `capacitor.plugins.json`
  - `android/app/build`, `ios/App/Pods`, `DerivedData` 등 빌드 산출물

> 클론 후 네이티브를 열기 전 **반드시** `npm run cap:sync`로 웹 자산을 채운다.

## 3. 로컬 개발 워크플로

```bash
npm install
npm run cap:sync        # vite build(:no-lint) + cap sync — dist를 android/ios에 복사
npm run cap:android     # cap:sync 후 Android Studio 오픈
npm run cap:ios         # cap:sync 후 Xcode 오픈 (macOS 필요)
```

개별 명령:
```bash
npm run build:no-lint   # 웹 빌드만
npx cap sync            # 네이티브에 자산+플러그인 반영
npx cap copy            # 자산만 빠르게 복사(플러그인 변경 없을 때)
```

## 4. 필수 도구 (이 저장소/원격 환경에서는 설치 불가 — 로컬에서 수행)

| 플랫폼 | 필요 도구 |
|---|---|
| Android | JDK 17, Android Studio, Android SDK(API 34+), Gradle(래퍼 포함) |
| iOS | **macOS**, Xcode 15+, CocoaPods (`sudo gem install cocoapods` → `cd ios/App && pod install`) |

> 원격 세션에서 `cap add ios` 시 `pod install`이 스킵됨(CocoaPods 없음) — 정상. macOS에서 `pod install` 1회 실행 필요.

## 5. 스토어 제출 전 채워야 할 항목

### 공통
- [ ] **앱 아이콘 / 스플래시** 생성: `@capacitor/assets` 권장
  ```bash
  npm i -D @capacitor/assets
  # resources/icon.png(1024²), resources/splash.png(2732²) 준비 후:
  npx capacitor-assets generate
  ```
- [ ] 개인정보처리방침 URL, 지원 URL (스토어 심사 필수)
- [ ] 앱 버전/빌드번호 (`android` versionCode / `ios` CFBundleVersion)

### Android (Google Play)
- [ ] Google Play Console 계정(등록비 $25 1회)
- [ ] 릴리스 서명 키(keystore) 생성 → `android/app` 서명 설정, **키는 커밋 금지**
- [ ] `.aab`(Android App Bundle) 빌드: Android Studio → Build → Generate Signed Bundle

### iOS (App Store)
- [ ] Apple Developer Program(연 $99)
- [ ] App ID(`com.deudda.app`) + 프로비저닝 프로파일
- [ ] Xcode → Archive → App Store Connect 업로드

## 6. OAuth(구글/카카오) 네이티브 연동 — **코드 배선 완료 ✅ / 대시보드 설정 필요**

이메일/비밀번호 로그인은 네이티브에서 **바로 동작**한다(리다이렉트 불필요).
구글/카카오 OAuth는 커스텀 스킴 딥링크로 왕복하도록 **코드 배선이 완료**되어 있다:

### 배선된 것 (코드)
- **딥링크 스킴** `com.deudda.app://auth/callback`
  - Android: `android/app/src/main/AndroidManifest.xml` intent-filter (scheme=`com.deudda.app`)
  - iOS: `ios/App/App/Info.plist` `CFBundleURLTypes`
- **`src/lib/nativeAuth.ts`**
  - `nativeOAuthSignIn(provider, scopes?)`: `signInWithOAuth({ redirectTo: 딥링크, skipBrowserRedirect: true })` →
    `@capacitor/browser`로 시스템 브라우저 오픈.
  - `initNativeAuthDeepLink(onResult)`: `@capacitor/app` `appUrlOpen` 리스너 → `?code=` 추출 →
    `exchangeCodeForSession(code)` → 성공 시 `/auth/callback` 라우팅(웹과 동일한 첫 화면 분기).
- **`authStore.signInWithGoogle/Kakao`**: `isNativeApp()`이면 위 네이티브 경로, 아니면 기존 웹 경로.
- **`App.tsx`**: 마운트 시 `initNativeAuthDeepLink`를 라우터 `navigate`에 연결(웹은 no-op).

### 출시 전 수동 설정 (대시보드 — 코드 아님)
1. **Supabase** → Auth → URL Configuration → **Redirect URLs**에 `com.deudda.app://auth/callback` 추가.
2. **카카오** 개발자 콘솔: 플랫폼에 앱 등록(패키지명/번들ID) — Supabase 콜백은 그대로, 네이티브 앱 등록만.
3. **구글**: OAuth 클라이언트의 authorized redirect는 **Supabase 콜백 URL** 그대로 사용(딥링크는 Supabase→앱 단계라 구글 콘솔 변경 불필요).

> ⚠️ 실기기(또는 시뮬레이터) 테스트 필요: 브라우저→딥링크 복귀는 에뮬레이터/디바이스에서만 확인 가능.
> 웹 OAuth 동작은 **무변경**(가드로 분리).

## 7. 매장·브랜드 운영 기능의 네이티브 지원 — **배선 완료 ✅**

앱은 웹과 **같은 번들**을 로드하므로 `/business`, `/business/player`, `/brand`,
`/brand/player/:brandId`, `/enterprise/*`, `/ops/*` 등 **모든 라우트가 앱에 그대로 들어 있다**
(플랫폼으로 화면을 잘라내는 분기는 없다 — `isNativeApp()` 사용처는 SW/OAuth/셸 초기화뿐).

다만 매장 24시간 무인 재생은 **네이티브 쉘 설정이 없으면 앱에서만 조용히 깨진다.**
아래는 그 설정과 근거다. 회귀는 `src/lib/nativeStoreCapabilities.test.ts` 가 막는다.

| 항목 | 설정 | 없으면 생기는 일 |
| --- | --- | --- |
| 백그라운드 오디오(iOS) | `Info.plist` `UIBackgroundModes: [audio]` **+ AVAudioSession `.playback`** | 둘 중 하나만 있으면 화면 잠금·홈 이동 시 **재생 정지** (§7-5) |
| 백그라운드 오디오(Android) | `mediaPlayback` 포그라운드 서비스 | 백그라운드 프로세스 오디오가 시스템에 의해 중단됨 (§7-5) |
| 화면 꺼짐 방지 | `@capacitor-community/keep-awake` + Android `WAKE_LOCK` 권한 | 화면 꺼짐 → WebView 스로틀 → 재생 끊김 |
| 자동재생 | Capacitor 기본값 (`setMediaPlaybackRequiresUserGesture(false)`, `mediaTypesRequiringUserActionForPlayback = []`) | — (웹의 autoplay 차단 이슈가 앱에선 발생하지 않음) |

### 7-1. 화면 꺼짐 방지 드라이버 (`src/lib/screenAwake.ts`)

iOS WKWebView 에는 **Screen Wake Lock API(`navigator.wakeLock`) 자체가 없다.** 그래서 웹 API 만
쓰면 아이패드 매장에서 화면이 꺼진다. `screenAwake.ts` 가 실행 환경별로 드라이버를 고른다:

- 네이티브 쉘 → `KeepAwake` 플러그인
- 웹/PWA → `navigator.wakeLock`
- 둘 다 없음 → `unsupported` (UI 가 "기기 자동 잠금 해제" 안내)

`useWakeLock()` 은 이 드라이버만 쓰고, 상태는 `playbackHealthStore` 로 흘러
매장 플레이어의 **화면 꺼짐 방지** 표시에 그대로 반영된다.

### 7-2. 앱에서 동작이 다른 지점 (의도된 차이)

| 기능 | 웹/PWA | 네이티브 앱 |
| --- | --- | --- |
| "홈 화면에 추가" 설치 배너 | 표시 | **숨김** (`isStandalone()` 이 네이티브에서 true) |
| 푸시 알림 | Web Push (VAPID) | **OS 푸시**(FCM/APNs) — SW 가 없어 Web Push 불가. 같은 토글 UI 로 내부 경로만 갈린다 (§7-4) |
| 브랜드 프레젠테이션 전체화면 | Fullscreen API | CSS 폴백(iOS 는 Fullscreen API 없음) + 화면 내 종료 버튼 |
| 오프라인 음원 저장 | IndexedDB (SW 아님) | **동일하게 동작** — 하나의 구현으로 웹·앱 공통 |

### 7-3. 오프라인 음원 저장 (`src/lib/audioCache/`)

**Service Worker 로 오디오를 캐시하지 않는다** — 의도된 정책이다. SW 가 Range 요청을
가로채면 206 부분응답이 깨져 시킹이 망가진다(`src/sw.ts`, `vite.config.ts` 주석 참고).
그래서 웹에도 오디오 캐시는 원래 없었다.

대신 **파일 전체를 IndexedDB 에 받아두고 재생 시 object URL 로 물리는** 방식을 쓴다:

- SW 가 필요 없다 → SW 를 등록하지 않는 **네이티브 앱에서도 그대로 동작**한다.
- Cache API 를 쓰지 않으므로 `purgeBadAudioCaches()` / "캐시·SW 초기화" 에 지워지지 않고,
  진단 패널의 "⚠ 오디오 관련 캐시 존재" 경고에도 걸리지 않는다.
- object URL 은 Range 시킹이 로컬에서 정상 동작한다.

동작:

1. 매장·브랜드 플레이어가 `useAudioCachePrefetch` 로 **앞으로 나올 곡을 미리 받는다**
   (온라인일 때만·한 번에 하나씩). 매장은 같은 로테이션을 반복하므로 한 바퀴면 전곡이 로컬에 남는다.
2. 재생 시 `playbackSrcFor(audio_url)` 가 **동기로** 조회 — 준비된 곡은 object URL,
   아니면 원본 URL(= 캐시 도입 전과 동일). 트랙 전환 hot path 에 await 를 넣지 않는다.
3. 상한(기본 1GB, 기기 quota 의 절반 이내) 초과 시 **오래 안 쓴 곡부터 자동 삭제**.
   재생 중인 곡은 삭제 대상에서 제외된다.
4. 캐시본으로 재생하다 media error 가 나면 그 곡의 캐시를 **폐기**해 다음 차례에
   네트워크로 다시 받는다(무인 매장에서 손상 캐시가 영구 고착되는 것 방지).

> ⚠️ Player 의 `timeupdate`/`loadedmetadata`/`durationchange` 가드는 `currentSrc` 와
> `audio_url` 의 **경로 비교**에 걸려 있었다. 캐시 적중 시 src 는 `blob:` 이라 경로 비교가
> 불가능하므로, 판정을 `audioSourceMatch()` 한 곳으로 모았다(3-상태: match/mismatch/unknown,
> unknown 은 기존 `activeRef` 폴백). 이 판정이 틀리면 **진행률·duration·자동재생이 통째로 죽는다** —
> 수정 시 `audioCachePolicy.test.ts` 를 반드시 확인할 것.

관리: 운영 콘솔 → 오디오 진단 패널에 저장 곡 수·용량·상한과 "오프라인 저장 음원 비우기" 버튼.
매장 플레이어 하단에는 저장 상태가 읽기 전용으로 표시된다.

### 7-5. 백그라운드 재생 — 플랫폼별로 요구사항이 다르다

앱을 닫거나 화면을 잠가도 매장 음악이 계속 나와야 한다. **플랫폼마다 필요한 것이 다르고,
하나라도 빠지면 조용히 멈춘다.**

#### iOS — 두 가지가 모두 필요하다

1. `Info.plist` → `UIBackgroundModes: [audio]`
2. `AppDelegate` → `AVAudioSession.setCategory(.playback)`

**1번만으로는 동작하지 않는다.** iOS 의 기본 오디오 세션 카테고리(`soloAmbient`)는
앱이 백그라운드로 가거나 화면이 잠기면 음소거되고, 무음 스위치에도 꺼진다.
`.playback` 이라야 두 경우 모두에서 재생이 이어진다(매장 BGM 에 맞는 카테고리).

`setActive(true)` 는 호출하지 않는다 — 카테고리만 지정해두면 WKWebView 가 실제 재생을
시작할 때 iOS 가 세션을 활성화한다. 실행 즉시 활성화하면 재생도 하기 전에 다른 앱의
오디오를 끊는다.

#### Android — 포그라운드 서비스가 필요하다

안드로이드는 백그라운드 프로세스의 오디오를 언제든 중단시킨다(메모리 압박 · Doze).
`mediaPlayback` 타입 포그라운드 서비스가 떠 있으면 프로세스가 보호된다.

- `StorePlaybackService` — 상태바 알림(중요도 LOW)을 띄우고 프로세스를 살려둔다.
  **소리는 그대로 WebView 의 `<audio>` 가 낸다** — 서비스는 오디오 파이프라인을 건드리지 않는다.
- `StorePlaybackServicePlugin` — JS 다리. 앱 로컬 플러그인은 자동 검색되지 않으므로
  `MainActivity.onCreate` 에서 `registerPlugin()` 으로 등록한다(빠지면 호출이 무시된다).
- `storePlaybackService.ts` — **매장 모드 + 재생 중**일 때만 켠다(`shouldKeepAlive`).
  개인 감상까지 상시 알림을 띄우지 않기 위한 제한이다.
- Android 14(API 34)+ 는 `startForeground` 에 서비스 타입을 명시해야 한다 — 처리됨.

> 📋 **Play Console**: `mediaPlayback` 은 포그라운드 서비스 타입 신고 대상이다.
> 앱 콘텐츠 → 포그라운드 서비스 권한에서 "매장 배경음악 재생"으로 용도를 신고해야 심사를 통과한다.

#### 웹 / PWA

브라우저 탭이 살아 있는 동안만 재생된다. 앱과 달리 OS 차원의 보장이 없다 —
매장은 앱 설치를 권장한다.

### 7-4. 푸시 알림 — 웹은 Web Push, 앱은 OS 푸시

앱은 Service Worker 를 등록하지 않으므로 Web Push 를 쓸 수 없다. 대신 OS 푸시를 쓰고,
**토글 UI(`PushNotificationToggle`)와 훅(`usePushSubscription`)은 그대로 공유**한다 — 내부 경로만 갈린다.

| | 토큰 | 전송 |
| --- | --- | --- |
| 웹 / PWA | Web Push 구독(endpoint·p256dh·auth) | `web-push` + VAPID |
| Android | FCM 등록 토큰 | FCM HTTP v1 (서비스 계정 OAuth2) |
| iOS | APNs 디바이스 토큰 | APNs HTTP/2 (p8 키 ES256 JWT) |

iOS 에 Firebase SDK 를 넣지 않고 **APNs 를 직접** 쓴다 — `GoogleService-Info.plist` 나
Firebase pod 없이 동작하고 전송 경로가 짧다.

**구성**

- 토큰 저장: `public.device_push_tokens` (migration `0510`). `unique(token)` 에
  `user_id` 갱신을 걸어, 같은 기기에서 계정을 바꾸면 **주인이 옮겨간다**
  (안 그러면 이전 사용자에게 알림이 계속 간다).
- 클라이언트: `src/lib/nativePush.ts` — 권한 요청 → `register()` → `registration`
  이벤트로 토큰 수신(15초 타임아웃) → `save_device_push_token` RPC.
- 알림 탭: payload 의 `url` 로 앱 내부 라우팅. **`safeInAppPath()` 가 내부 경로만 허용**한다
  (외부 URL·커스텀 스킴·프로토콜 상대 URL 은 홈으로 — 알림 payload 를 믿고 아무 데나 보내지 않는다).
- 서버: `send-push` 가 웹 구독과 네이티브 토큰에 **동시 발송**하고, 만료 토큰
  (FCM `UNREGISTERED` / APNs `410`·`BadDeviceToken`)은 즉시 정리한다.
  자격증명이 없는 플랫폼은 `skipped` — 에러가 아니라 미설정이며 나머지 경로는 정상 발송된다.

**출시 전 수동 설정 (자격증명 — 코드 아님)**

1. **Android**: Firebase 프로젝트 생성 → Android 앱(`com.deudda.app`) 등록 →
   `google-services.json` 을 `android/app/` 에 저장.
   Gradle 은 파일이 있을 때만 플러그인을 적용하므로, **없어도 빌드는 그대로 성공**한다(푸시만 비활성).
2. **iOS**: Xcode → Signing & Capabilities → **+ Push Notifications** 추가
   (`ios/App/App/App.entitlements` 가 타깃에 연결된다).
   Apple Developer → Keys 에서 APNs 키(.p8) 발급.
   > `AppDelegate.swift` 의 `didRegisterForRemoteNotificationsWithDeviceToken` /
   > `didFailToRegisterForRemoteNotificationsWithError` 는 이미 배선돼 있다.
   > **이 두 콜백이 없으면 iOS 에서 토큰이 영원히 오지 않는다**(앱 푸시가 조용히 동작 안 함) —
   > 회귀는 `src/lib/nativeStoreCapabilities.test.ts` 가 막는다.
3. **Edge Function Secrets** (`.env.example` 의 "네이티브 앱 푸시" 항목 참고):
   ```bash
   supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
   supabase secrets set APNS_KEY_P8="$(cat AuthKey_XXXX.p8)" \
     APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY APNS_BUNDLE_ID=com.deudda.app
   # 개발(TestFlight 이전) 빌드로 테스트할 때만:
   supabase secrets set APNS_ENV=sandbox   # + App.entitlements 를 development 로
   ```

> ⚠️ 실기기 테스트 필수 — 시뮬레이터는 APNs 토큰을 받지 못한다.
> `send-push` 응답의 `ready` / `native_results` 로 어느 경로가 설정됐고 무엇이 실패했는지 확인할 수 있다.

## 8. 인앱결제(IAP) 전략 — **후속 작업**

현재 결제는 PayApp 웹 정기결제. 스토어 정책:
- **디지털 구독**을 앱에서 판매하면 원칙적으로 Apple/Google 인앱결제(수수료 15~30%) 강제.
- 단, **한국 앱마켓(인앱결제 강제방지법)**에서는 제3자 결제 허용 여지가 있음(스토어별 정책·수수료 상이).

선택지:
- (A) 앱은 **결제 진입 없이** 스트리밍만 — 구독은 웹에서(리더 앱류 정책 활용). 심사 리스크 낮음.
- (B) 스토어 IAP 도입 — `@capacitor-community/in-app-purchases` 등으로 배선, 수수료 부담.
- (C) 한국 제3자 결제 — 정책 확인 후 PayApp 유지.

> 출시 초기엔 (A)로 심사 통과 후, 결제 정책은 별도 의사결정.

## 9. 체크리스트 (출시까지)

- [x] Capacitor 통합 + android/ios 네이티브 프로젝트 생성
- [x] 네이티브 가드(SW 미등록, 상태바/스플래시/back) 배선
- [x] 실시간 데이터 파이프라인(앱↔웹 공유, 0477)
- [x] OAuth 네이티브 딥링크 **코드 배선**(스킴/브라우저/코드교환/라우팅)
- [x] 매장/브랜드 네이티브 지원(백그라운드 오디오·화면 꺼짐 방지·설치 배너/푸시 가드)
- [x] 오프라인 음원 저장(IndexedDB 선반입 · LRU · 손상 캐시 자가 폐기)
- [x] 네이티브 푸시 **코드 배선**(토큰 저장 · FCM/APNs 발송 · 탭 라우팅)
- [ ] 푸시 자격증명 설정(google-services.json · APNs p8 · Edge Secrets) + 실기기 테스트
- [x] 백그라운드 재생(iOS AVAudioSession `.playback` · Android mediaPlayback 포그라운드 서비스)
- [ ] Play Console 포그라운드 서비스 타입 신고(mediaPlayback)
- [ ] 실기기에서 매장 24시간 재생 검증(화면 잠금 · 백그라운드 · 야간 무인 · **회선 차단 재생**)
- [ ] OAuth 대시보드 설정(Supabase Redirect URL, 카카오 앱 등록) + 실기기 테스트
- [ ] 앱 아이콘/스플래시 에셋 생성
- [ ] IAP/결제 정책 결정
- [ ] 서명 키 생성 + 스토어 계정
- [ ] 내부 테스트(TestFlight / Play 내부 테스트) → 심사 제출
