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
# 대신 에뮬레이터의 -prop 플래그로 "부팅 시점에" 심는다. root 가 필요 없다.
#
# 그래서 하는 일은 하나다: 기기를 껐다가, 한국어를 심어서 다시 켠다.
# (run-emulator.sh 도 같은 플래그로 띄우므로, 다음부터는 이 스크립트가 필요 없다.)
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

locale_now() { "$ADB" -s "$DEV" shell getprop persist.sys.locale 2>/dev/null | tr -d '\r'; }

if [[ "$(locale_now)" == ko* ]]; then
  echo "${GRN}✓${OFF} 이미 한국어입니다. 입력란을 누르면 한글 자판이 올라옵니다."
  echo "  ${DIM}한/영 전환은 스페이스바 옆 지구본(또는 스페이스바 길게 누르기).${OFF}"
  exit 0
fi

AVD="$("$ADB" -s "$DEV" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
[[ -n "$AVD" ]] || { echo "${RED}✗ 실행 중인 AVD 이름을 알아내지 못했습니다.${OFF}" >&2; exit 1; }

echo "가상기기 ${BOLD}$AVD${OFF} 를 한국어로 다시 켭니다."
echo "${DIM}(부팅 시점에만 심을 수 있어서 한 번 껐다 켜야 합니다. 앱과 데이터는 그대로입니다.)${OFF}"

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
  echo "${YEL}!${OFF} 언어가 그대로입니다($(locale_now)). 이 이미지는 -prop 을 무시하는 듯합니다."
  echo "  ${DIM}설정 → 시스템 → 언어 → 언어 추가 → 한국어 로 직접 추가하세요.${OFF}"
  "$ADB" -s "$DEV" shell am start -a android.settings.LOCALE_SETTINGS >/dev/null 2>&1 || true
  echo
  echo "  ${BOLD}그 전에 당장 입력해야 하면 복사·붙여넣기${OFF}"
  echo "  ${DIM}맥에서 한글을 복사하고 입력란을 길게 눌러 붙여넣으세요."
  echo "  (에뮬레이터가 맥 클립보드를 공유합니다.)${OFF}"
fi
