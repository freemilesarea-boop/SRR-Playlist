# 가상기기(에뮬레이터)에서 확인하기 — 백그라운드 재생 중심

앱의 네이티브 동작을 **본인 컴퓨터의 안드로이드 에뮬레이터**로 확인하는 절차.

> iOS 시뮬레이터는 macOS + Xcode 가 필요하고, **푸시는 시뮬레이터에서 확인 불가**
> (APNs 토큰을 발급받지 못함 — 실기기 필요). 아래는 안드로이드 기준.

---

## 0. 준비 (최초 1회)

1. **Android Studio** 설치 → SDK Manager 에서
   - `Android SDK Platform 35`
   - `Android SDK Platform-Tools`
   - `Android Emulator`
2. **JDK 21 설치** — Android Studio 가 들고 오는 JDK 는 버전이 너무 높아 Gradle 이 못 쓴다.
   ```bash
   brew install --cask temurin@21
   ```
   > 설치만 해두면 된다. 실행 스크립트가 알아서 찾아 쓴다.
   > `JAVA_HOME` 을 직접 잡아둔 게 있어도 맞는 버전이 아니면 스크립트가 무시한다.
3. **Device Manager → Create Device**
   - 권장: **Pixel 7 / API 34 이상**
   - 이미지는 **Google Play** 버전으로 (푸시까지 확인하려면 필수)
4. 저장소 준비
   ```bash
   npm ci
   cp .env.example .env     # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 채우기
   ```
   > `.env` 가 비어 있으면 앱이 "설정 필요" 안내 화면만 보여준다.

SDK 경로가 기본값(`~/Android/Sdk`)이 아니면:
```bash
export ANDROID_HOME=/path/to/Sdk
```

## 1. 실행

```bash
npm run android:emu              # 가상기기 + 라이브 리로드 (코드 고치면 즉시 반영)
npm run android:emu -- --apk     # 가상기기 + 번들 빌드 (배포본과 동일 조건)
npm run android:emu -- --device  # USB 로 연결한 실제 태블릿에 설치
```

가상기기가 꺼져 있으면 스크립트가 첫 번째 AVD 를 자동으로 켠다.
`android/local.properties` 가 없으면 자동 생성한다(Gradle 의 `SDK location not found` 방지).
설치 대상 기기도 스크립트가 직접 지정하므로 "Please choose a target device" 메뉴에서 멈추지 않는다.

**백그라운드 재생·오프라인 캐시는 `--apk` 또는 `--device` 로 확인한다.**
라이브 리로드는 PC 의 개발 서버에 의존하므로 "회선 차단" 상황을 재현할 수 없다.

> 라이브 리로드는 `adb reverse` + `localhost` 를 쓴다. 흔히 쓰는 `10.0.2.2` 는
> **표준 에뮬레이터에서만** 통해서 실제 매장 태블릿에서는 안 붙는다.

### 매장 태블릿에 직접 넣기

```bash
# 태블릿: 설정 → 휴대전화 정보 → 빌드번호 7번 탭 → 개발자 옵션 → USB 디버깅 ON
adb devices                      # 기기가 보이는지 확인 (허용 팝업 수락)
npm run android:emu -- --device
```

빌드만 따로 돌리려면:
```bash
npm run android:build            # JDK 선택 → 웹 빌드 → cap sync → ./gradlew assembleDebug
```

---

## 2. 확인 항목

### 2-1. 백그라운드 재생 ★ 핵심

1. 로그인 → `/business` → **매장 음악 켜기** (또는 주소창에 `/business/player`)
2. 음악이 나오는 것 확인
3. **홈 버튼**을 눌러 앱을 백그라운드로 보낸다
   - ✅ **음악이 계속 나와야 한다**
   - ✅ 상태바에 **"매장 음악 재생 중"** 알림이 떠 있어야 한다
4. **전원 버튼으로 화면을 끈다**
   - ✅ 음악이 계속 나와야 한다
5. 알림을 탭 → 앱으로 돌아온다

> 알림이 안 뜨면 포그라운드 서비스가 시작되지 않은 것이다.
> `adb logcat | grep -i StorePlaybackService` 로 확인.
> 매장 모드가 아니면(개인 감상) 의도적으로 알림을 띄우지 않는다.

### 2-2. 오프라인 재생 (`--apk` 모드)

1. 매장 플레이어에서 **5분 이상** 재생 — 하단에 `오프라인 저장 N곡` 표시가 늘어난다
2. 에뮬레이터 설정 → 네트워크 끄기 (또는 `adb shell svc wifi disable && adb shell svc data disable`)
3. ✅ 저장된 곡은 계속 재생돼야 한다

### 2-3. 화면 꺼짐 방지

- 매장 플레이어 하단 **"화면 꺼짐 방지"** 가 `켜짐` 이면 정상
- (에뮬레이터에서는 체감이 어렵다 — 표시만 확인)

### 2-4. 푸시 (자격증명 설정 후에만)

`google-services.json` 을 `android/app/` 에 넣고 Edge Secrets 를 설정한 뒤:
1. 프로필 → 알림 켜기 → 권한 허용
2. 테스트 알림 발송 → ✅ 수신 확인

미설정 상태에서는 알림 토글이 "쓸 수 없음"으로 표시되는 것이 정상이다.

---

## 3. 문제 해결

| 증상 | 확인 |
| --- | --- |
| `Android SDK 를 찾을 수 없습니다` | `export ANDROID_HOME=/path/to/Sdk` |
| `생성된 가상기기(AVD)가 없습니다` | Android Studio → Device Manager → Create Device |
| 앱이 "설정 필요" 화면만 | `.env` 의 Supabase 값 확인 |
| 라이브 리로드에서 화면이 안 뜸 | 방화벽이 5173 포트를 막는지 확인. `--apk` 모드로 우회 |
| 백그라운드에서 음악이 끊김 | 상태바 알림 유무 확인 → 없으면 서비스 미시작 (logcat 확인) |
| 빌드 실패 `SDK location not found` | `android/local.properties` 에 `sdk.dir=/path/to/Sdk` |
| 빌드 실패 `Unsupported class file major version 69` | JDK 25 를 쓰고 있다. `brew install --cask temurin@21` 후 재실행 |
| 빌드 실패 `invalid source release: 21` | JDK 17 이하를 쓰고 있다. 위와 같이 JDK 21 설치 |
| `Please choose a target device` 에서 멈춤 | 스크립트 대신 `npx cap run` 을 직접 돌린 경우다. `npm run android:emu` 로 실행 |
| 앱 목록에 "듣다" 가 없음 | 설치가 안 된 것이다. `adb shell pm list packages \| grep deudda` 로 확인 후 `npm run android:emu -- --apk` 재실행 |

로그 보기:
```bash
adb logcat | grep -iE "deudda|StorePlaybackService|Capacitor"
```


---

## 4. 출시까지 남은 것 (스토어 제출)

앱 코드는 준비돼 있다. 아래는 **사람만 할 수 있는 것**들이다.

### 4-1. 지금 바로 가능 (자격증명 불필요)

```bash
npm run android:emu -- --device   # 매장 태블릿에 설치해서 실사용 검증
```

이 상태로도 **백그라운드 재생 · 오프라인 음원 저장 · 화면 꺼짐 방지**가 전부 동작한다.
푸시만 빠진다. 회선 문제로 급하다면 이 debug 빌드를 매장에 먼저 넣어도 된다.

### 4-2. Play 스토어 제출

| 항목 | 필요한 것 |
| --- | --- |
| 서명 키 | `keytool` 로 keystore 생성 → `android/app` 서명 설정. **키는 커밋 금지** |
| 앱 아이콘/스플래시 | `npm i -D @capacitor/assets` → `npx capacitor-assets generate` |
| 릴리스 빌드 | Android Studio → Build → Generate Signed Bundle (`.aab`) |
| 개발자 계정 | Google Play Console (등록비 $25 1회) |
| **포그라운드 서비스 신고** | 앱 콘텐츠 → 포그라운드 서비스 권한 → `mediaPlayback` 을 "매장 배경음악 재생" 으로 신고. **미신고 시 반려** |
| 푸시(선택) | Firebase 프로젝트 → `google-services.json` 을 `android/app/` 에 저장 |

> `google-services.json` 이 없어도 빌드는 성공한다(푸시만 비활성).

### 4-3. iOS

macOS + Xcode 필요. `npm run cap:ios` → Signing & Capabilities 에서
**Push Notifications** 추가 → Archive → App Store Connect.
APNs 키(.p8)는 Apple Developer → Keys 에서 발급.

자세한 절차는 [`APP_PACKAGING.md`](./APP_PACKAGING.md) §5~§7.
