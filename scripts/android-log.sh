#!/usr/bin/env bash
#
# android-log.sh — 기기에서 일어나는 일을 사람이 읽을 수 있게 보여준다.
#
#   npm run android:log
#
# 앱이 흰 화면이거나, 눌렀는데 아무 반응이 없거나, 로그인이 안 넘어갈 때 쓴다.
# 화면만 봐서는 "멈춘 것" 과 "에러가 났는데 안 보이는 것" 을 구분할 수 없는데,
# WebView 안의 console 과 예외는 전부 logcat 으로 나오므로 여기서 보인다.
#
# 관련 태그만 남긴다. 전체 logcat 은 초당 수백 줄이라 사람이 읽을 수 없다.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -n "$ADB" && -x "$ADB" ]] || {
  echo "✗ adb 를 찾지 못했습니다. ANDROID_HOME 을 확인하세요." >&2
  exit 1
}

DEV="$("$ADB" devices | awk '/\tdevice$/ {print $1; exit}')"
[[ -n "$DEV" ]] || {
  echo "✗ 연결된 기기가 없습니다. 가상기기를 켜거나 태블릿을 USB 로 연결하세요." >&2
  exit 1
}

echo "기기: $DEV — 로그를 봅니다. 멈추려면 Ctrl+C."
echo "지금부터 앱에서 문제를 재현하세요(로그인 누르기 등)."
echo

# 지난 로그는 지우고 지금부터만 본다 — 재현한 것만 보이게.
"$ADB" -s "$DEV" logcat -c || true

# Capacitor : 플러그인 호출/오류 (Browser.open, PushNotifications 등)
# chromium  : WebView 안의 console.* 와 자바스크립트 예외
# 미디어    : 음악이 안 나오거나 길이가 --:-- 로 멈추면 디코더가 답을 준다.
#             (WebView 는 오디오를 MediaCodec 으로 푼다 — 코덱이 없거나 실패하면
#              loadedmetadata 가 영영 안 오고, 그 이유는 이 태그들에만 남는다.)
# 그 외 태그는 앱 크래시(AndroidRuntime)와 액티비티 전환(ActivityManager).
"$ADB" -s "$DEV" logcat \
  Capacitor:V Capacitor/Console:V Capacitor/Plugin:V \
  chromium:V AndroidRuntime:E ActivityManager:I \
  cr_MediaCodecBridge:V cr_media:V MediaCodec:W MediaCodecList:W \
  ACodec:W CCodec:W OMXClient:W AudioTrack:W MediaPlayer:W \
  '*:S'
