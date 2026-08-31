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

## 7. 인앱결제(IAP) 전략 — **후속 작업**

현재 결제는 PayApp 웹 정기결제. 스토어 정책:
- **디지털 구독**을 앱에서 판매하면 원칙적으로 Apple/Google 인앱결제(수수료 15~30%) 강제.
- 단, **한국 앱마켓(인앱결제 강제방지법)**에서는 제3자 결제 허용 여지가 있음(스토어별 정책·수수료 상이).

선택지:
- (A) 앱은 **결제 진입 없이** 스트리밍만 — 구독은 웹에서(리더 앱류 정책 활용). 심사 리스크 낮음.
- (B) 스토어 IAP 도입 — `@capacitor-community/in-app-purchases` 등으로 배선, 수수료 부담.
- (C) 한국 제3자 결제 — 정책 확인 후 PayApp 유지.

> 출시 초기엔 (A)로 심사 통과 후, 결제 정책은 별도 의사결정.

## 8. 체크리스트 (출시까지)

- [x] Capacitor 통합 + android/ios 네이티브 프로젝트 생성
- [x] 네이티브 가드(SW 미등록, 상태바/스플래시/back) 배선
- [x] 실시간 데이터 파이프라인(앱↔웹 공유, 0477)
- [x] OAuth 네이티브 딥링크 **코드 배선**(스킴/브라우저/코드교환/라우팅)
- [ ] OAuth 대시보드 설정(Supabase Redirect URL, 카카오 앱 등록) + 실기기 테스트
- [ ] 앱 아이콘/스플래시 에셋 생성
- [ ] IAP/결제 정책 결정
- [ ] 서명 키 생성 + 스토어 계정
- [ ] 내부 테스트(TestFlight / Play 내부 테스트) → 심사 제출
