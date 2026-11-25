# App Store 제출 가이드 — 듣다 iOS

안드로이드(1.0.4)와 **같은 코드·같은 버전**으로 iOS 를 낸다. 웹 코드는 그대로이고,
iOS 에서만 달라지는 것은 이 문서에 모았다. 안드로이드 쪽은 [`PLAY_SUBMISSION.md`](./PLAY_SUBMISSION.md).

순서: **§1 준비물 → §2 Apple 로그인 설정 → §3 푸시 키 → §4 Xcode → §5 App Store Connect →
§6 업로드·TestFlight → §7 심사 제출**. 막히면 그 단계 화면을 그대로 공유하면 된다.

---

## 0. 코드에 이미 된 것

| 항목 | 상태 | 위치 |
| --- | --- | --- |
| 앱 아이콘(1024) · 스플래시 · 이름 "듣다" · 번들 ID `com.deudda.app` | ✅ | `ios/App/App/Assets.xcassets`, `Info.plist` |
| 버전 1.0.4 / 빌드 번호 10004 (package.json 에서 자동) | ✅ | `scripts/ios-sync-version.mjs` |
| 백그라운드 재생(audio 모드 + AVAudioSession `.playback`) | ✅ | `Info.plist`, `AppDelegate.swift` |
| 푸시(APNs) 토큰 콜백 · `aps-environment=production` | ✅ | `AppDelegate.swift`, `App.entitlements` |
| **Apple로 로그인** (iOS 에서 항상 표시 — 지침 4.8) | ✅ 코드 / ⬜ 설정(§2) | `src/lib/appleLogin.ts`, `LoginPage.tsx` |
| 앱 안 결제 진입 전부 숨김 (지침 3.1.1) | ✅ | `src/lib/purchaseGate.ts` |
| 앱 안 회원 탈퇴 (지침 5.1.1(v)) | ✅ | 내 정보 → 회원 탈퇴 |
| 개인정보 매니페스트 `PrivacyInfo.xcprivacy` | ✅ | `ios/App/App/` |
| 수출 규정(암호화) 질문 생략 `ITSAppUsesNonExemptEncryption=false` | ✅ | `Info.plist` |
| 아이폰 + 아이패드 지원 | ✅ | `TARGETED_DEVICE_FAMILY = 1,2` |

---

## 1. 준비물

- **Mac + Xcode 26 이상** — 2026년 4월부터 App Store 업로드는 iOS 26 SDK 로 빌드해야 받는다.
  App Store 앱에서 Xcode 를 최신으로 업데이트한다.
- **CocoaPods** (한 번만):
  ```bash
  sudo gem install cocoapods
  ```
- **Apple Developer Program** 계정(있음) — https://developer.apple.com/account
- **심사용 테스트 계정** — 로그인해야 쓰는 앱이라 필수. 아래 §7 참고.

---

## 2. Apple 로그인 설정 (Apple Developer + Supabase)

코드는 끝나 있고, 아래 설정이 있어야 실제로 로그인된다. Google 과 같은 방식이다
(앱 → Safari 화면 → Apple 계정 → Supabase → `com.deudda.app://auth/callback` 으로 앱 복귀).
복귀 주소는 Supabase Redirect URLs 에 **이미 등록**돼 있다.

Supabase 프로젝트 주소(`https://<프로젝트ref>.supabase.co`)는
Supabase 대시보드 → Project Settings → API → Project URL 에서 확인한다.

**(1) App ID 에 기능 켜기** — Certificates, Identifiers & Profiles → **Identifiers** → `com.deudda.app`
- **Sign In with Apple** 체크
- **Push Notifications** 체크
- Save

> App ID 가 목록에 없으면 `+` → App IDs → App → Bundle ID `com.deudda.app`(Explicit) 로 만들고 위 두 개를 체크한다.

**(2) Services ID 만들기** — Identifiers → `+` → **Services IDs**
- Description: `듣다 로그인`, Identifier: **`com.deudda.app.signin`**
- 만든 뒤 클릭 → **Sign In with Apple** 체크 → **Configure**
  - Primary App ID: `com.deudda.app`
  - Domains and Subdomains: `<프로젝트ref>.supabase.co`
  - Return URLs: `https://<프로젝트ref>.supabase.co/auth/v1/callback`
- Save → Continue → Save

**(3) 로그인용 키 만들기** — **Keys** → `+`
- Key Name: `듣다 Apple 로그인`, **Sign in with Apple** 체크 → Configure → Primary App ID `com.deudda.app`
- Register → **`.p8` 파일 다운로드**(한 번만 받을 수 있다) · **Key ID** 메모
- 오른쪽 위 계정 이름 아래 **Team ID** 메모
- ⚠️ `.p8` 은 비밀키다. 저장소에 커밋하거나 채팅에 붙여넣지 않는다.

**(4) Supabase 에 켜기** — Authentication → **Sign In / Providers** → **Apple**
- Enable
- Client IDs: `com.deudda.app.signin`
- Secret Key: `.p8` · Key ID · Team ID · Services ID 로 만든 JWT.
  Supabase 문서의 Apple 로그인 페이지에 있는 **secret 생성 도구**를 쓰면 된다.
- Save

> ⏰ **Apple secret 은 최대 6개월마다 만료된다.** 만료되면 Apple 로그인만 조용히 실패한다.
> 만든 날짜 + 5개월에 캘린더 알림을 걸고, 같은 방법으로 새로 만들어 교체한다.

**(5) 웹에도 열려면(선택)** — Vercel 환경변수 `VITE_ENABLE_APPLE_LOGIN=true` 후 재배포.
iOS 앱은 이 값과 상관없이 항상 보인다.

---

## 3. 푸시 키 (APNs)

**Keys** → `+` → **Apple Push Notifications service (APNs)** 체크 → Register → `.p8` 다운로드 · Key ID 메모.
(§2 의 키에 APNs 를 같이 체크해도 되지만, 따로 두면 하나를 교체할 때 다른 쪽이 안전하다.)

Supabase → Edge Functions → **Secrets** 에 추가(자세한 설명: [`APP_PACKAGING.md`](./APP_PACKAGING.md) §7-4):

| 이름 | 값 |
| --- | --- |
| `APNS_KEY_P8` | `.p8` 파일 내용 전체 |
| `APNS_KEY_ID` | Key ID |
| `APNS_TEAM_ID` | Team ID |
| `APNS_BUNDLE_ID` | `com.deudda.app` |

TestFlight·App Store 빌드는 production APNs 를 쓴다. `APNS_ENV` 는 넣지 않는다(기본 production).

---

## 4. Xcode

```bash
cd ~/Desktop/SRR-Playlist
```

```bash
git pull && npm install
```

```bash
npm run cap:ios
```

처음 한 번은 Pod 설치가 필요하다(이후 플러그인이 바뀔 때만 다시):

```bash
cd ios/App && pod install && cd ../..
```

Xcode 에서 **`ios/App/App.xcworkspace`** 를 연다(`.xcodeproj` 가 아니다 — `npm run cap:ios` 가 알아서 연다).

1. 왼쪽 **App** 프로젝트 → TARGETS **App** → **Signing & Capabilities**
   - **Automatically manage signing** 체크, **Team** 에서 개발자 계정 선택
   - Bundle Identifier 가 `com.deudda.app` 인지 확인
2. `+ Capability` → **Push Notifications** 추가 (이미 있으면 그대로)
3. **Background Modes** 에 **Audio, AirPlay, and Picture in Picture** 가 체크돼 있는지 확인
4. **General** 탭에서 Version `1.0.4`, Build `10004` 확인

먼저 실기기(아이폰을 케이블로 연결)에서 ▶ 로 실행해 보고 §6 의 확인 목록을 본다.

---

## 5. App Store Connect — 앱 등록

https://appstoreconnect.apple.com → **앱** → `+` → **신규 앱**

| 항목 | 값 |
| --- | --- |
| 플랫폼 | iOS |
| 이름 | `듣다` (이미 쓰는 이름이면 `듣다 - 매장 음악` 처럼 부제를 붙인다) |
| 기본 언어 | 한국어 |
| 번들 ID | `com.deudda.app` |
| SKU | `deudda-ios` |
| 사용자 액세스 | 전체 액세스 |

### 앱 정보 / 가격
- 카테고리: **음악** (보조: 비즈니스)
- 가격: **무료** (앱 안에서 판매하는 것이 없다)
- 개인정보처리방침 URL: `https://www.deudda.com/privacy`
- 지원 URL: `https://www.deudda.com/support`
- 연령 등급: 설문에서 전부 "없음" — 음원 가사에 성인 내용이 있을 수 있으면 "가끔/약하게 성적·선정적 내용" 등 해당 항목 체크

### 스크린샷 (필수 크기)
| 기기 | 크기(세로) | 장수 |
| --- | --- | --- |
| iPhone 6.9형 | 1320 × 2868 (또는 6.5형 1284 × 2778) | 3~10 |
| **iPad 13형** (아이패드 지원이라 필수) | 2064 × 2752 | 3~10 |

시뮬레이터(Xcode → iPhone 17 Pro Max / iPad Pro 13-inch)에서 앱을 띄우고 `⌘S` 로 찍으면 정확한 크기로 저장된다.
홈 · 재생 화면 · 매장 플레이어 · 플레이리스트 · 공지 화면을 추천한다. **가격·결제 화면은 넣지 않는다.**

### 설명 문구
[`PLAY_SUBMISSION.md`](./PLAY_SUBMISSION.md) §6 "문구 초안"을 그대로 쓰되, **가격·구독·결제 언급은 뺀다**
(지침 3.1.1 — 앱 밖 결제를 유도하는 문구로 본다).

### 앱 개인정보 보호 (데이터 수집 답변)
"데이터를 수집함" → 아래를 체크한다. 모두 **사용자와 연결됨 / 추적 안 함 / 목적: 앱 기능**
(`PrivacyInfo.xcprivacy` 와 같아야 한다):

- 연락처 정보: 이름, 이메일 주소, 전화번호, 물리적 주소
- 사용자 콘텐츠: 기타 사용자 콘텐츠(아티스트 업로드 음원·커버)
- 식별자: 사용자 ID
- 사용 데이터: 제품 상호작용 (목적에 **분석**도 추가)
- 검색 기록
- 진단: 충돌 데이터(**사용자와 연결 안 됨**), 기타 진단 데이터
- 기타 데이터 유형(생년월일 · 사업자 정보)

---

## 6. 업로드 · TestFlight

Xcode 위쪽 기기 선택에서 **Any iOS Device (arm64)** → 메뉴 **Product → Archive**
→ Organizer 창이 뜨면 **Distribute App → App Store Connect → Upload** → 기본값으로 진행.

10~30분 뒤 App Store Connect → **TestFlight** 에 빌드가 보인다.
내부 테스터에 본인을 추가하고, 아이폰·아이패드의 **TestFlight 앱**으로 설치해 확인한다:

- [ ] 아이콘 · 첫 화면(흰 화면 없이 어두운 화면)
- [ ] **Apple로 로그인** → Safari 화면 → Apple 계정 → 앱으로 돌아와 로그인됨
- [ ] Google 로그인도 같은 방식으로 됨
- [ ] 결제·요금제 버튼이 어디에도 없음 (내 정보, 체험 배너, 재생 제한 안내, 아티스트 화면)
- [ ] 매장 재생 → 홈 버튼 / 화면 잠금 → 음악 계속
- [ ] 알림 허용 → 공지 푸시 수신 (§3 설정 후)
- [ ] 아이패드 가로·세로 화면이 깨지지 않음
- [ ] 내 정보 → 회원 탈퇴 버튼이 보임(실제로 누르지는 않는다)

같은 버전을 다시 올려야 하면 `npm version patch`(→ 1.0.5 / 10005) 후 다시 Archive.
App Store Connect 는 같은 빌드 번호를 두 번 받지 않는다.

---

## 7. 심사 제출

App Store Connect → 앱 → **iOS 앱 1.0.4** → 빌드 선택 → 아래를 채우고 **심사에 추가**.

### 앱 심사 정보 — 로그인 정보 (필수)
심사 전용 계정을 만들어 적는다. **실제 고객 계정·관리자 계정은 쓰지 않는다.**
- 일반 회원 1개 (음악 재생 가능한 상태 — 체험 또는 구독 활성)
- 가능하면 매장(사업자) 회원 1개 — 매장 플레이어·백그라운드 재생 확인용

### 심사 메모 (복사해서 쓰세요)
```
듣다는 매장 배경음악과 개인 감상을 위한 음악 스트리밍 서비스입니다.

- 로그인: 이메일, Apple로 로그인, Google로 로그인을 지원합니다.
  심사용 계정은 위 로그인 정보를 사용해 주세요.
- 앱 안에서 판매하는 디지털 상품은 없습니다. 앱에는 구매·가격·결제 화면이 없으며,
  이미 이용권이 있는 회원이 로그인해 이용하는 방식입니다.
- 백그라운드 오디오: 매장에서 화면이 꺼지거나 다른 앱을 사용할 때도
  배경음악이 계속 재생되어야 하므로 audio 백그라운드 모드를 사용합니다.
  (매장 회원 로그인 → 매장 → 재생 후 홈 화면으로 이동하면 확인할 수 있습니다)
- 음원: 듣다와 계약한 아티스트가 직접 업로드하고 검수를 거친 음원만 제공합니다.
- 회원 탈퇴: 내 정보 → 회원 탈퇴
```

### 반려되기 쉬운 지점과 대응
| 지침 | 내용 | 대응 |
| --- | --- | --- |
| 4.8 | 타사 로그인 있으면 Apple 로그인 필수 | ✅ 반영. §2 설정이 안 돼 있으면 버튼이 실패해서 **같은 이유로 반려**된다 — 제출 전 TestFlight 로 꼭 확인 |
| 3.1.1 / 3.1.3 | 앱 밖 결제 유도 금지 | ✅ 결제 진입 숨김. 설명·스크린샷·심사 메모에도 가격/웹 결제 언급 금지 |
| 4.2 | 웹사이트를 감싼 것뿐인 앱 | 백그라운드 재생·푸시·잠금화면 재생 등 네이티브 기능을 심사 메모에 명시(위 문구) |
| 5.2.3 | 음원 권리 | 요청이 오면 아티스트 계약서(`docs/ARTIST_CONTRACT_DRAFT_v1.md` 기반) 와 업로드 검수 절차로 답변 |
| 5.1.1(v) | 계정 삭제 | ✅ 앱 안에서 가능. ⚠️ Apple 로 가입한 회원이 탈퇴할 때 Apple 토큰 철회(REST API)까지는 아직 하지 않는다 — 심사에서 지적되면 후속 작업으로 추가 |
| 2.1 | 로그인 정보 누락·동작 안 함 | 심사용 계정이 실제로 재생까지 되는지 제출 직전에 확인 |

---

## 8. 업데이트할 때

```bash
npm version patch
```
`package.json` · 안드로이드 versionCode · iOS 버전/빌드 번호가 함께 올라간다
(`scripts/ios-sync-version.mjs`). 그다음 `npm run cap:ios` → Archive → Upload → 심사 제출.
안드로이드는 `npm run aab`. **두 플랫폼을 같은 커밋에서 빌드**해야 버전이 갈라지지 않는다.
