#!/usr/bin/env bash
#
# run-emulator.sh — 안드로이드에서 "듣다" 앱 실행 (가상기기 또는 실제 태블릿).
#
#   npm run android:emu              가상기기 + 라이브 리로드 (코드 고치면 즉시 반영)
#   npm run android:emu -- --apk     가상기기 + 번들 빌드 (배포본과 동일 조건)
#   npm run android:emu -- --device  USB 로 연결한 실제 태블릿에 설치
#
# 매장 검증(백그라운드 재생 · 오프라인 재생)은 --apk 또는 --device 로 해야 한다.
# 라이브 리로드는 PC 의 개발 서버에 의존하므로 "회선 차단" 을 재현할 수 없다.
set -euo pipefail

MODE="live"        # live | apk
TARGET="emulator"  # emulator | device
for arg in "$@"; do
  case "$arg" in
    --apk)    MODE="apk" ;;
    --device) TARGET="device" ;;
    *) echo "알 수 없는 옵션: $arg (사용 가능: --apk, --device)" >&2; exit 2 ;;
  esac
done

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
die() { echo "${RED}✗ $1${OFF}" >&2; shift; for l in "$@"; do echo "  ${DIM}$l${OFF}" >&2; done; exit 1; }
ok()  { echo "${GRN}✓${OFF} $1"; }

# ---------- 1. 사전 점검 ----------
command -v node >/dev/null || die "Node.js 가 필요합니다 (>=20)."

# SDK 위치 — OS 마다 기본 경로가 다르다.
#   macOS : ~/Library/Android/sdk   (Android Studio 기본값)
#   Linux : ~/Android/Sdk
# 환경변수가 있으면 그걸 우선하고, 없으면 후보를 순서대로 찾는다.
SDK=""
for candidate in \
  "${ANDROID_HOME:-}" \
  "${ANDROID_SDK_ROOT:-}" \
  "$HOME/Library/Android/sdk" \
  "$HOME/Android/Sdk" \
  "/usr/local/share/android-sdk" \
  "/opt/homebrew/share/android-sdk"
do
  if [[ -n "$candidate" && -d "$candidate" ]]; then SDK="$candidate"; break; fi
done

if [[ -z "$SDK" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    die "Android SDK 를 찾을 수 없습니다." \
      "맥에서 가장 빠른 설치:" \
      "  brew install --cask android-studio" \
      "설치 후 Android Studio 를 한 번 실행해 초기 마법사를 끝내면 SDK 가 받아집니다." \
      "(기본 위치: ~/Library/Android/sdk)" \
      "이미 있다면: export ANDROID_HOME=/path/to/sdk"
  fi
  die "Android SDK 를 찾을 수 없습니다." \
    "Android Studio 설치 후 SDK Manager 에서 'Android SDK Platform 35' 를 받으세요." \
    "다른 위치라면: export ANDROID_HOME=/path/to/Sdk"
fi

ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
[[ -x "$ADB" ]] || die "adb 가 없습니다: $ADB" "SDK Manager → SDK Tools → 'Android SDK Platform-Tools' 설치."
ok "Android SDK: $SDK"

# Gradle 이 SDK 위치를 못 찾는 흔한 실패를 미리 막는다.
if [[ ! -f android/local.properties ]]; then
  echo "sdk.dir=$SDK" > android/local.properties
  ok "android/local.properties 생성 (sdk.dir=$SDK)"
fi

[[ -f .env ]] || die ".env 가 없습니다." \
  "cp .env.example .env  후 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 채우세요." \
  "(값이 없으면 앱이 '설정 필요' 화면만 보여줍니다)"
grep -q '^VITE_SUPABASE_URL=https' .env \
  || echo "${YEL}!${OFF} .env 의 VITE_SUPABASE_URL 이 비어 보입니다 — 앱이 설정 안내 화면을 띄울 수 있습니다."
ok ".env 확인"

# ---------- 2. 기기 준비 ----------
running_devices() { "$ADB" devices | awk '/\tdevice$/ {print $1}'; }

if [[ "$TARGET" == "device" ]]; then
  if [[ -z "$(running_devices)" ]]; then
    die "연결된 기기가 없습니다." \
      "태블릿에서 개발자 옵션 → USB 디버깅을 켜고 USB 로 연결하세요." \
      "연결 후 태블릿 화면의 '이 컴퓨터를 허용하시겠습니까?' 를 허용해야 합니다." \
      "확인: $ADB devices"
  fi
  ok "실제 기기: $(running_devices | head -1)"
elif [[ -z "$(running_devices)" ]]; then
  echo "${YEL}실행 중인 가상기기가 없습니다. 사용 가능한 목록:${OFF}"
  AVDS="$("$EMULATOR" -list-avds 2>/dev/null || true)"
  if [[ -z "$AVDS" ]]; then
    die "생성된 가상기기(AVD)가 없습니다." \
      "Android Studio → Device Manager → Create Device 로 하나 만드세요." \
      "권장: Pixel Tablet 또는 Pixel 7 / API 34 이상 (Google Play 이미지 — 푸시까지 보려면 필수)"
  fi
  echo "$AVDS" | sed 's/^/  - /'
  AVD="$(echo "$AVDS" | head -1)"
  echo "${DIM}첫 번째 기기로 부팅합니다: $AVD${OFF}"
  nohup "$EMULATOR" -avd "$AVD" -netdelay none -netspeed full >/dev/null 2>&1 &
  echo -n "부팅 대기 중"
  "$ADB" wait-for-device
  until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    echo -n "."; sleep 2
  done
  echo
  ok "가상기기 준비됨: $(running_devices | head -1)"
else
  ok "가상기기 준비됨: $(running_devices | head -1)"
fi

# ---------- 3. 빌드 & 설치 ----------
if [[ "$MODE" == "live" ]]; then
  echo "${DIM}라이브 리로드 — 개발 서버를 띄우고 앱이 그걸 바라봅니다.${OFF}"
  npm run build:no-lint     # 네이티브 자산을 한 번 채운다(첫 실행 대비)
  npx cap sync android

  npx vite --host 0.0.0.0 --port 5173 &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT

  # 개발 서버가 실제로 뜬 뒤에 진행한다(고정 sleep 은 느린 PC 에서 실패한다).
  echo -n "개발 서버 대기 중"
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "http://127.0.0.1:5173/"; then break; fi
    echo -n "."; sleep 1
  done
  echo

  # adb reverse: 기기의 localhost:5173 → PC 의 5173.
  # 10.0.2.2 는 표준 에뮬레이터에서만 통한다 — 실제 태블릿에서는 안 붙는다.
  # reverse + localhost 는 가상기기·실기기 양쪽에서 동일하게 동작한다.
  "$ADB" reverse tcp:5173 tcp:5173 >/dev/null 2>&1 \
    || echo "${YEL}!${OFF} adb reverse 실패 — 라이브 리로드가 안 붙으면 --apk 로 실행하세요."

  npx cap run android --live-reload --host localhost --port 5173
  wait $VITE_PID
else
  echo "${DIM}번들 빌드 — 배포본과 같은 조건(백그라운드 재생·오프라인 캐시 확인용).${OFF}"
  npm run build:no-lint
  npx cap sync android
  npx cap run android
fi
