#!/usr/bin/env bash
#
# run-emulator.sh — 안드로이드 에뮬레이터(가상기기)에서 "듣다" 앱 실행.
#
#   npm run android:emu          라이브 리로드 (코드 고치면 바로 반영 — 기본, 확인용 권장)
#   npm run android:emu -- --apk 번들 빌드 (dist 를 APK 에 넣어 설치 — 배포본과 동일 조건)
#
# 백그라운드 재생을 확인하려면 --apk 모드가 정확하다. 라이브 리로드는 개발 서버에
# 의존하므로 회선 차단(오프라인 캐시) 테스트에는 맞지 않는다.
set -euo pipefail

MODE="live"
[[ "${1:-}" == "--apk" ]] && MODE="apk"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
die() { echo "${RED}✗ $1${OFF}" >&2; shift; for l in "$@"; do echo "  ${DIM}$l${OFF}" >&2; done; exit 1; }
ok()  { echo "${GRN}✓${OFF} $1"; }

# ---------- 1. 사전 점검 ----------
command -v node >/dev/null || die "Node.js 가 필요합니다 (>=20)."

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
[[ -d "$SDK" ]] || die "Android SDK 를 찾을 수 없습니다: $SDK" \
  "Android Studio 설치 후 SDK Manager 에서 'Android SDK Platform 35' 를 받으세요." \
  "다른 위치라면: export ANDROID_HOME=/path/to/Sdk"

ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
[[ -x "$ADB" ]] || die "adb 가 없습니다: $ADB" "SDK Manager → SDK Tools → 'Android SDK Platform-Tools' 설치."
ok "Android SDK: $SDK"

[[ -f .env ]] || die ".env 가 없습니다." \
  "cp .env.example .env  후 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 채우세요." \
  "(값이 없으면 앱이 '설정 필요' 화면만 보여줍니다)"
grep -q '^VITE_SUPABASE_URL=https' .env || echo "${YEL}!${OFF} .env 의 VITE_SUPABASE_URL 이 비어 보입니다 — 앱이 설정 안내 화면을 띄울 수 있습니다."
ok ".env 확인"

# ---------- 2. 가상기기 준비 ----------
running_devices() { "$ADB" devices | awk '/\tdevice$/ {print $1}'; }

if [[ -z "$(running_devices)" ]]; then
  echo "${YEL}실행 중인 가상기기가 없습니다. 사용 가능한 목록:${OFF}"
  AVDS="$("$EMULATOR" -list-avds 2>/dev/null || true)"
  if [[ -z "$AVDS" ]]; then
    die "생성된 가상기기(AVD)가 없습니다." \
      "Android Studio → Device Manager → Create Device 로 하나 만드세요." \
      "권장: Pixel 7 / API 34 이상 (Google Play 이미지 — 푸시 테스트까지 하려면 필수)"
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
fi
ok "가상기기 준비됨: $(running_devices | head -1)"

# ---------- 3. 빌드 & 설치 ----------
if [[ "$MODE" == "live" ]]; then
  echo "${DIM}라이브 리로드 모드 — 개발 서버를 띄우고 앱이 그걸 바라보게 합니다.${OFF}"
  npm run build:no-lint            # 네이티브 자산 1회 채우기(첫 실행 대비)
  npx cap sync android
  # 10.0.2.2 = 에뮬레이터에서 본 호스트 PC 의 localhost.
  npx vite --host 0.0.0.0 --port 5173 &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT
  sleep 3
  npx cap run android --live-reload --host 10.0.2.2 --port 5173 --forwardPorts 5173:5173
  wait $VITE_PID
else
  echo "${DIM}번들 빌드 모드 — 배포본과 같은 조건(오프라인 캐시·백그라운드 재생 확인용).${OFF}"
  npm run build:no-lint
  npx cap sync android
  npx cap run android
fi
