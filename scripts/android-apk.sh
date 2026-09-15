#!/usr/bin/env bash
#
# android-apk.sh — 실기기(갤럭시 등)에 그냥 넣어서 켤 수 있는 파일을 만든다.
#
#   npm run apk                  디버그 APK — 키 없이 바로 됨. 실기기 확인용.
#   npm run apk -- --install     만든 뒤 USB 로 연결된 기기에 바로 설치
#   npm run apk -- --release     서명된 릴리스 APK (npm run keystore 먼저)
#   npm run aab                  Play 업로드용 .aab (서명 필요)
#
# 결과물은 dist-apk/ 에 두고, 맥이면 바탕화면에도 복사한다 — 폰으로 옮기기 쉬우라고.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

die() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }
ok()  { echo "✓ $1"; }

MODE=debug
BUNDLE=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --release) MODE=release ;;
    --debug)   MODE=debug ;;
    --aab)     MODE=release; BUNDLE=1 ;;
    --install) INSTALL=1 ;;
    *) die "알 수 없는 옵션: $arg" "쓸 수 있는 것: --release · --install · --aab" ;;
  esac
done

if [[ "$MODE" == release && ! -f android/keystore.properties ]]; then
  die "릴리스 서명 키가 없습니다." \
    "먼저 만드세요:  npm run keystore" \
    "(실기기에서 동작만 확인할 거라면 키 없이:  npm run apk)"
fi

. scripts/pick-jdk.sh
. scripts/require-env.sh

npm run build:no-lint
npx cap sync android

if [[ $BUNDLE == 1 ]]; then
  TASK=bundleRelease
  BUILT="android/app/build/outputs/bundle/release/app-release.aab"
  EXT=aab
elif [[ "$MODE" == release ]]; then
  TASK=assembleRelease
  BUILT="android/app/build/outputs/apk/release/app-release.apk"
  EXT=apk
else
  TASK=assembleDebug
  BUILT="android/app/build/outputs/apk/debug/app-debug.apk"
  EXT=apk
fi

( cd android && ./gradlew --console=plain "$TASK" )
[[ -f "$BUILT" ]] || die "빌드는 끝났는데 파일이 없습니다: $BUILT" "위 Gradle 출력을 확인하세요."

VER="$(sed -n 's/.*versionName "\([^"]*\)".*/\1/p' android/app/build.gradle | head -1)"
NAME="deudda-${VER:-0}-${MODE}.${EXT}"

mkdir -p dist-apk
cp "$BUILT" "dist-apk/$NAME"
ok "$(du -h "dist-apk/$NAME" | cut -f1) — dist-apk/$NAME"

if [[ -d "$HOME/Desktop" ]]; then
  cp "$BUILT" "$HOME/Desktop/$NAME"
  ok "바탕화면에도 복사: ~/Desktop/$NAME"
fi

if [[ $INSTALL == 1 ]]; then
  ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  ADB="$ANDROID_HOME/platform-tools/adb"
  [[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
  [[ -n "$ADB" && -x "$ADB" ]] || die "adb 를 찾지 못했습니다." "ANDROID_HOME 을 확인하세요."
  DEV="$("$ADB" devices | awk '/\tdevice$/ {print $1; exit}')"
  [[ -n "$DEV" ]] || die "연결된 기기가 없습니다." \
    "갤럭시: 설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호 7번 탭 → 개발자 옵션 → USB 디버깅 ON" \
    "USB 로 연결한 뒤 폰에 뜨는 '이 컴퓨터를 허용' 을 눌러주세요."
  echo "설치 중… ($DEV)"
  # 디버그와 릴리스는 서명이 달라서 -r 로 덮어쓸 수 없다. 그럴 땐 지우고 다시 넣는다.
  if ! "$ADB" -s "$DEV" install -r "$BUILT"; then
    echo "덮어쓰기 실패 — 서명이 다른 버전이 이미 깔려 있습니다. 지우고 다시 설치합니다."
    "$ADB" -s "$DEV" uninstall com.deudda.app || true
    "$ADB" -s "$DEV" install "$BUILT"
  fi
  ok "설치 완료 — 앱 목록에서 '듣다' 를 찾으세요."
  exit 0
fi

[[ $BUNDLE == 1 ]] && exit 0

cat <<NEXT

갤럭시에 넣는 법 — 셋 중 아무거나:

  1) USB 로 연결했다면        npm run apk -- --install
  2) 파일을 폰으로 보내고(카톡 나에게 보내기 · 구글 드라이브 · 에어드롭 대신 USB 복사)
     폰에서 그 파일을 탭 → "이 출처의 앱 설치 허용" 을 켜고 설치
  3) 갤럭시를 USB 로 연결하고 파일을 '내 파일 > Download' 에 복사한 뒤 탭

설치가 거부되면 대개 이유는 하나입니다 — 서명이 다른 '듣다' 가 이미 깔려 있는 것.
폰에서 기존 앱을 지우고 다시 설치하세요.

NEXT
