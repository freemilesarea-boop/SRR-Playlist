#!/usr/bin/env bash
#
# android-korean.sh — 가상기기에서 한글을 입력할 수 있게 만든다.
#
#   npm run android:korean
#
# 기본 AVD 는 영어만 올라와 있어서 회원가입·매장명 같은 한글 입력이 필요한 화면을
# 아예 테스트할 수 없다. 맥 키보드로 한글을 쳐도 에뮬레이터에는 안 들어간다 —
# 에뮬레이터는 조합된 글자가 아니라 키코드를 그대로 넘기기 때문이다.
#
# 시스템 언어에 한국어를 추가하면 Gboard 가 한글 자판을 같이 올린다.
# 이미지 종류에 따라 adb 로 바로 되기도 하고, 설정 화면을 거쳐야 하기도 한다.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -n "$ADB" && -x "$ADB" ]] || { echo "✗ adb 를 찾지 못했습니다." >&2; exit 1; }

DEV="$("$ADB" devices | awk '/\tdevice$/ {print $1; exit}')"
[[ -n "$DEV" ]] || { echo "✗ 실행 중인 가상기기가 없습니다. npm run android:emu 로 먼저 켜세요." >&2; exit 1; }

echo "기기: $DEV"

current_locale() {
  "$ADB" -s "$DEV" shell getprop persist.sys.locale 2>/dev/null | tr -d '\r'
}

if [[ "$(current_locale)" == ko* ]]; then
  echo "${GRN}✓${OFF} 이미 시스템 언어가 한국어입니다."
  echo "  ${DIM}입력란을 길게 눌러 자판 아이콘 → 한국어를 고르면 한글이 써집니다.${OFF}"
  exit 0
fi

# Google Play 이미지는 adb root 를 막아둔다. 되는 이미지에서만 한 번에 끝난다.
echo "시스템 언어에 한국어를 추가하는 중…"
if "$ADB" -s "$DEV" root >/dev/null 2>&1 \
  && "$ADB" -s "$DEV" shell "setprop persist.sys.locale ko-KR" >/dev/null 2>&1; then
  "$ADB" -s "$DEV" shell "setprop ctl.restart zygote" >/dev/null 2>&1 || true
  echo "${GRN}✓${OFF} 한국어로 바꿨습니다. 화면이 한 번 껌뻑인 뒤 적용됩니다."
  echo "  ${DIM}입력란을 누르면 Gboard 에 한글 자판이 같이 올라옵니다."
  echo "  자판 왼쪽 아래 지구본(또는 스페이스바 길게 누르기)으로 한/영 전환.${OFF}"
  exit 0
fi

# 여기까지 왔으면 root 가 막힌 이미지(대개 Google Play 이미지)다. 설정 화면으로 안내한다.
echo "${YEL}!${OFF} 이 이미지는 adb 로 언어를 바꿀 수 없습니다(Google Play 이미지)."
echo "  설정 화면을 열어드립니다 — 아래 순서로 한 번만 해두시면 됩니다."
echo
echo "  ${BOLD}1${OFF} 언어 추가 (Add a language) 를 누릅니다"
echo "  ${BOLD}2${OFF} 목록에서 ${BOLD}한국어${OFF} (Korean) 를 고릅니다"
echo "  ${BOLD}3${OFF} 대한민국 (South Korea) 을 고릅니다"
echo "  ${BOLD}4${OFF} 뒤로 나와서 앱으로 돌아옵니다"
echo
echo "  ${DIM}입력란을 누르면 Gboard 에 한글 자판이 같이 올라옵니다."
echo "  자판 왼쪽 아래 지구본(또는 스페이스바 길게 누르기)으로 한/영 전환.${OFF}"
echo

"$ADB" -s "$DEV" shell am start -a android.settings.LOCALE_SETTINGS >/dev/null 2>&1 \
  || "$ADB" -s "$DEV" shell am start -a android.settings.SETTINGS >/dev/null 2>&1 \
  || echo "  ${YEL}설정 앱을 직접 열어 시스템 → 언어 로 가세요.${OFF}"

echo "${DIM}────────────────────────────────────────────────────────${OFF}"
echo "${BOLD}자판 설정 없이 지금 당장 입력하려면 — 복사·붙여넣기${OFF}"
echo "  맥에서 한글을 복사한 뒤, 에뮬레이터 입력란을 ${BOLD}길게 눌러${OFF} 붙여넣기."
echo "  ${DIM}Android Studio 에뮬레이터는 맥 클립보드를 공유합니다."
echo "  안 되면 에뮬레이터 오른쪽 '...' → Settings → Clipboard sharing 을 켜세요.${OFF}"
