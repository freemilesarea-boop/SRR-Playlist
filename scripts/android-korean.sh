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
# 시스템 언어에 한국어가 올라가야 Gboard 가 한글 자판을 같이 띄운다. 그런데 부팅 후에는
# 그걸 바꿀 수 없다 — Google Play 이미지는 adb root 를 막아둬서 setprop 이 통하지 않는다.
#
# root 없이 쓸 수 있는 두 경로를 다 시도하고(설정 제공자에 언어 목록 쓰기 + 에뮬레이터
# -prop), 기기를 껐다 켠다. 둘 다 무시하는 이미지가 있으므로 결과를 반드시 확인하고,
# 안 됐으면 설정 화면을 열어 네 번 누르는 방법과 복사·붙여넣기를 안내한다.
# 정직하게 말해서, 이 조합이 통하지 않는 이미지에서는 사람이 한 번 눌러야 한다.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$EMULATOR" ]] || EMULATOR="$(command -v emulator || true)"
[[ -n "$ADB" && -x "$ADB" ]] || { echo "${RED}✗ adb 를 찾지 못했습니다.${OFF}" >&2; exit 1; }
[[ -n "$EMULATOR" && -x "$EMULATOR" ]] || { echo "${RED}✗ emulator 를 찾지 못했습니다.${OFF}" >&2; exit 1; }

running_devices() { "$ADB" devices | awk '/\tdevice$/ {print $1}'; }

DEV="$(running_devices | head -1)"
[[ -n "$DEV" ]] || { echo "${RED}✗ 실행 중인 가상기기가 없습니다.${OFF} npm run android:emu 로 먼저 켜세요." >&2; exit 1; }

if [[ "$DEV" != emulator-* ]]; then
  echo "${YEL}!${OFF} 연결된 것이 실제 기기입니다($DEV)."
  echo "  ${DIM}실제 기기는 설정 → 시스템 → 언어에서 한국어를 추가하세요.${OFF}"
  exit 0
fi

# 언어를 어디서 읽느냐가 이미지마다 다르다. persist.sys.locale 은 Google Play
# 이미지에서 아예 비어 있어서, 그것만 보면 "바꿨는지" 를 판정할 수 없다(빈 문자열을
# 한국어가 아니라고 읽어 매번 실패로 보고했다). 세 곳을 순서대로 본다.
locale_now() {
  local v
  v="$("$ADB" -s "$DEV" shell getprop persist.sys.locale 2>/dev/null | tr -d '\r')"
  if [[ -z "$v" ]]; then
    v="$("$ADB" -s "$DEV" shell settings get system system_locales 2>/dev/null | tr -d '\r')"
    [[ "$v" == "null" ]] && v=""
  fi
  [[ -n "$v" ]] || v="$("$ADB" -s "$DEV" shell getprop ro.product.locale 2>/dev/null | tr -d '\r')"
  echo "$v"
}

if [[ "$(locale_now)" == ko* ]]; then
  echo "${GRN}✓${OFF} 이미 한국어입니다. 입력란을 누르면 한글 자판이 올라옵니다."
  echo "  ${DIM}한/영 전환은 스페이스바 옆 지구본(또는 스페이스바 길게 누르기).${OFF}"
  exit 0
fi

AVD="$("$ADB" -s "$DEV" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
[[ -n "$AVD" ]] || { echo "${RED}✗ 실행 중인 AVD 이름을 알아내지 못했습니다.${OFF}" >&2; exit 1; }

echo "가상기기 ${BOLD}$AVD${OFF} 를 한국어로 다시 켭니다."
echo "${DIM}(부팅 시점에만 심을 수 있어서 한 번 껐다 켜야 합니다. 앱과 데이터는 그대로입니다.)${OFF}"

# 설정 제공자에 언어 목록을 직접 써둔다. shell 사용자에게 허용된 경로라 root 가
# 필요 없고, -prop 을 무시하는 이미지에서도 통하는 경우가 있다. 적용은 재부팅 때.
"$ADB" -s "$DEV" shell settings put system system_locales "ko-KR,en-US" >/dev/null 2>&1 || true

"$ADB" -s "$DEV" emu kill >/dev/null 2>&1 || true

# 완전히 내려갈 때까지 기다린다. 안 기다리면 포트가 겹쳐 새로 띄운 기기가 죽는다.
for _ in $(seq 1 30); do
  [[ -z "$(running_devices)" ]] && break
  sleep 1
done
if [[ -n "$(running_devices)" ]]; then
  echo "${RED}✗ 가상기기가 내려가지 않았습니다.${OFF} 창을 직접 닫고 다시 실행하세요." >&2
  exit 1
fi

nohup "$EMULATOR" -avd "$AVD" -netdelay none -netspeed full \
  -prop persist.sys.locale=ko-KR >/dev/null 2>&1 &

echo -n "부팅 대기 중"
"$ADB" wait-for-device
until [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
  echo -n "."; sleep 2
done
echo

DEV="$(running_devices | head -1)"
# 하드웨어 키보드가 켜져 있으면 안드로이드가 화면 자판을 숨긴다. 한글은 화면 자판으로
# 쳐야 하므로 둘 다 뜨게 해둔다.
"$ADB" -s "$DEV" shell settings put secure show_ime_with_hard_keyboard 1 >/dev/null 2>&1 || true

if [[ "$(locale_now)" == ko* ]]; then
  echo "${GRN}✓${OFF} 한국어로 켜졌습니다 ($(locale_now))."
  echo "  ${DIM}입력란을 누르면 한글 자판이 올라옵니다."
  echo "  한/영 전환은 스페이스바 옆 지구본(또는 스페이스바 길게 누르기).${OFF}"
  echo
  echo "  ${DIM}앱을 다시 설치하려면: npm run android:emu -- --apk${OFF}"
else
  NOW="$(locale_now)"
  echo "${YEL}!${OFF} 자동으로는 안 됐습니다(현재 언어: ${BOLD}${NOW:-알 수 없음}${OFF})."
  echo "  ${DIM}이 이미지는 adb 로 언어를 바꿀 수 없습니다. 설정 화면을 열어드립니다 —${OFF}"
  echo "  ${DIM}네 번만 누르면 끝이고, 한 번 해두면 계속 유지됩니다.${OFF}"
  echo
  echo "  ${BOLD}1${OFF} 언어 추가 (Add a language)"
  echo "  ${BOLD}2${OFF} 목록에서 ${BOLD}한국어${OFF} (Korean)"
  echo "  ${BOLD}3${OFF} 대한민국 (South Korea)"
  echo "  ${BOLD}4${OFF} 뒤로 나와서 앱으로"
  echo
  echo "  ${DIM}그 뒤 입력란을 누르면 한글 자판이 같이 올라옵니다."
  echo "  한/영 전환은 스페이스바 옆 지구본(또는 스페이스바 길게 누르기).${OFF}"
  "$ADB" -s "$DEV" shell am start -a android.settings.LOCALE_SETTINGS >/dev/null 2>&1 \
    || "$ADB" -s "$DEV" shell am start -a android.settings.SETTINGS >/dev/null 2>&1 || true
  echo
  echo "${DIM}────────────────────────────────────────────────────────${OFF}"
  echo "${BOLD}자판 설정이 귀찮으면 — 복사·붙여넣기가 제일 빠릅니다${OFF}"
  echo "  ${DIM}맥에서 한글을 복사하고, 에뮬레이터 입력란을 길게 눌러 붙여넣으세요."
  echo "  에뮬레이터가 맥 클립보드를 공유합니다. 안 되면 에뮬레이터 오른쪽 '...' →"
  echo "  Settings → Clipboard sharing 을 켜세요.${OFF}"
fi
