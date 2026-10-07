#!/usr/bin/env bash
#
# android-audio-probe.sh — "소리가 작다" 를 기기에서 갈라내는 A/B 하네스
#                          (npm run audio-probe)
#
# 앱 코드만 봐서는 HTMLAudioElement 단계까지밖에 못 본다. 그 아래
# Chromium → AudioTrack → AudioFlinger → 제조사 DSP 는 기기에 물어봐야 안다.
# 이 스크립트는 같은 기기 · 같은 음원 · 같은 시스템 볼륨에서 세 경로를
# 차례로 틀어보게 하고, 그 사이의 안드로이드 오디오 상태를 통째로 찍는다.
#
#   DEUDDA        듣다 앱 WebView
#   CHROME        같은 URL 을 크롬에서 직접
#   NATIVE PLAYER 같은 URL 을 VIEW 인텐트로 기본 플레이어에서
#
# 셋을 같은 조건에서 들어봐야 범위가 줄어든다:
#   듣다만 작다          → 앱/WebView 경로
#   크롬도 같이 작다      → WebView/기기 경로
#   전부 똑같이 작다      → 기기/음원 경로
#
# 아무것도 바꾸지 않는다. 읽기만 한다.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# 기본 테스트 음원 — 공개 버킷이라 로그인 없이 열린다.
# 카탈로그 중앙값(-11.6 LUFS)에 가까운 곡으로 골랐다.
DEFAULT_URL="https://nsoesrvwkxqifjcxzvol.supabase.co/storage/v1/object/public/audio/artist_uploads/ac463c55-4e0f-4592-b9be-29d1c0e83319/d96a32eb-bc23-4e87-9ef7-b83652e034ba.mp3"
DEFAULT_LUFS="-11.9"
APP_ID="com.deudda.app"

URL="$DEFAULT_URL"
MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)    URL="${2:-}"; shift 2 ;;
    --chrome) MODE="chrome"; shift ;;
    --native) MODE="native"; shift ;;
    --app)    MODE="app"; shift ;;
    --state)  MODE="state"; shift ;;
    -h|--help)
      cat <<'USAGE'
사용법: npm run audio-probe -- [옵션]

  (옵션 없음)   오디오 상태만 출력 — A/B 사이사이에 찍어라
  --app         듣다 앱 실행
  --chrome      테스트 음원을 크롬에서 열기
  --native      테스트 음원을 기본 플레이어에서 열기
  --url <URL>   테스트 음원 바꾸기 (기본: 카탈로그 중앙값 근처 곡)

권장 순서 (기기 미디어 볼륨은 끝까지 손대지 말 것):
  1) npm run audio-probe                 # 기준 상태
  2) npm run audio-probe -- --native     # 듣고 크기 기억
  3) npm run audio-probe                 # 재생 중 상태
  4) npm run audio-probe -- --chrome     # 듣고 크기 비교
  5) npm run audio-probe                 # 재생 중 상태
  6) npm run audio-probe -- --app        # 듣고 크기 비교
  7) npm run audio-probe                 # 재생 중 상태
USAGE
      exit 0 ;;
    *) echo "모르는 옵션: $1 (--help)" >&2; exit 1 ;;
  esac
done

command -v adb >/dev/null || { echo "✗ adb 가 없습니다. Android Platform Tools 를 설치하세요." >&2; exit 1; }
DEV_COUNT="$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
[[ "$DEV_COUNT" == "1" ]] || {
  echo "✗ 연결된 기기가 $DEV_COUNT 대입니다. 정확히 1대만 연결하세요." >&2
  adb devices >&2; exit 1
}

sh()  { adb shell "$@" 2>/dev/null; }
hdr() { echo; echo "──────── $1 ────────"; }

# 패키지 버전 — 없으면 '미설치'.
pkg_version() {
  local v
  v="$(sh dumpsys package "$1" | sed -n 's/.*versionName=\([^ ]*\).*/\1/p' | head -n 1)"
  echo "${v:-미설치}"
}

print_state() {
  hdr "기기"
  echo "모델      : $(sh getprop ro.product.manufacturer) $(sh getprop ro.product.model)"
  echo "안드로이드: $(sh getprop ro.build.version.release) (API $(sh getprop ro.build.version.sdk))"
  echo "빌드      : $(sh getprop ro.build.display.id)"

  hdr "WEBVIEW ENVIRONMENT"
  # 어느 WebView 구현이 실제로 쓰이는지. 삼성 기기는 삼성 빌드를 쓰기도 한다.
  echo "Android System WebView : $(pkg_version com.google.android.webview)"
  echo "Samsung WebView        : $(pkg_version com.samsung.android.webview)"
  echo "Chrome(=WebView 제공자): $(pkg_version com.android.chrome)"
  echo "현재 WebView 제공자    : $(sh cmd webviewupdate get-webview-packagename)"

  hdr "ANDROID AUDIO STATE"
  # STREAM_MUSIC 현재/최대 — '100%' 라는 체감과 실제 눈금을 맞춰본다.
  echo "volume_music(설정값)   : $(sh settings get system volume_music)"
  echo "volume_music_speaker   : $(sh settings get system volume_music_speaker)"
  echo "volume_music_bt_a2dp   : $(sh settings get system volume_music_bt_a2dp)"
  echo "-- STREAM_MUSIC 상세 --"
  sh dumpsys audio | sed -n '/- STREAM_MUSIC:/,/^- STREAM/p' | head -n 18
  echo "-- AudioManager mode / 기타 --"
  sh dumpsys audio | grep -iE "^ *mode:|Audio mode|ringer mode|Muted|Master volume|mMasterMute" | head -n 8

  hdr "AUDIO FOCUS / DUCKING"
  # 듣다는 포커스를 요청하지 않는다. 다른 앱이 스택을 잡고 있는지 본다.
  local focus
  focus="$(sh dumpsys audio | sed -n '/Audio Focus stack/,/^$/p' | head -n 25)"
  if [[ -z "${focus// }" ]]; then
    echo "(포커스 스택 비어 있음 — 아무 앱도 오디오 포커스를 쥐고 있지 않음)"
  else
    echo "$focus"
  fi
  echo "-- duck/transient 흔적 --"
  sh dumpsys audio | grep -iE "duck|transient" | head -n 10 || echo "(없음)"

  hdr "OUTPUT ROUTE"
  sh dumpsys audio | grep -iE "Device currently connected|routed|mDeviceType|Hdmi|BluetoothA2dp|wired" | head -n 12
  echo "-- AudioFlinger 출력 스레드(권한 없으면 비어 있음) --"
  sh dumpsys media.audio_flinger | grep -iE "Output thread|sample rate|Channel|Format|standby|volume" | head -n 14 \
    || echo "(접근 불가 — 비루팅 기기에서는 정상)"

  hdr "제조사 음량 제한 / 사운드 효과"
  for k in volume_limit media_volume_limit safe_media_volume_state adapt_sound dolby_atmos sound_effect; do
    printf '%-26s: %s\n' "$k" "$(sh settings get global "$k")/$(sh settings get system "$k")"
  done
  echo "※ '커스텀/null' 이 많은 건 정상. 삼성은 설정 UI(사운드 품질 및 효과)에만 있는 값이 있다."
}

case "$MODE" in
  app)
    echo "▶ 듣다 앱 실행 — 재생 버튼을 직접 누르고 크기를 기억하세요."
    sh monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "  logcat 을 같이 띄워두면 좋습니다:"
    echo "    adb logcat | grep -E '레벨진단|볼륨이 설정값과 다름|silent silence'"
    ;;
  chrome)
    echo "▶ 크롬에서 테스트 음원 재생"
    echo "  URL: $URL"
    sh am start -a android.intent.action.VIEW -d "'$URL'" -n com.android.chrome/com.google.android.apps.chrome.Main >/dev/null \
      || sh am start -a android.intent.action.VIEW -d "'$URL'" >/dev/null
    ;;
  native)
    echo "▶ 기본 플레이어에서 테스트 음원 재생 (기준 음량)"
    echo "  URL: $URL  (측정 LUFS ${DEFAULT_LUFS})"
    sh am start -a android.intent.action.VIEW -d "'$URL'" -t audio/mpeg >/dev/null
    ;;
  *)
    print_state
    exit 0
    ;;
esac

echo
echo "재생이 시작되면 다른 터미널에서 상태를 찍으세요:  npm run audio-probe"
