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
2. **Device Manager → Create Device**
   - 권장: **Pixel 7 / API 34 이상**
   - 이미지는 **Google Play** 버전으로 (푸시까지 확인하려면 필수)
3. 저장소 준비
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
npm run android:emu           # 라이브 리로드 — 코드 고치면 바로 반영
npm run android:emu -- --apk  # 번들 빌드 — 배포본과 같은 조건
```

가상기기가 꺼져 있으면 스크립트가 첫 번째 AVD 를 자동으로 켠다.

**백그라운드 재생·오프라인 캐시는 `--apk` 모드로 확인한다.** 라이브 리로드는 PC 의
개발 서버에 의존하므로 "회선 차단" 상황을 재현할 수 없다.

빌드만 따로 돌리려면:
```bash
npm run android:build         # ./gradlew assembleDebug
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

로그 보기:
```bash
adb logcat | grep -iE "deudda|StorePlaybackService|Capacitor"
```
