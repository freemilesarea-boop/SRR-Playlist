#!/usr/bin/env bash
#
# android-keystore.sh — 릴리스 서명 키를 만든다 (npm run keystore).
#
# Play 스토어는 앱을 패키지 이름이 아니라 **서명 키**로 식별한다. 그래서 이 키는
# 한 번 만들면 앱이 살아있는 동안 계속 같은 것을 써야 하고, 잃어버리면 같은 앱으로
# 업데이트를 올릴 수 없다. 새 앱으로 다시 올려야 하고 기존 사용자는 따라오지 않는다.
#
# 그래서 이 스크립트는 이미 있는 키를 절대 덮어쓰지 않는다.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

die() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }
ok()  { echo "✓ $1"; }

. scripts/pick-jdk.sh   # keytool 도 JDK 에 들어있다

KEYSTORE="android/deudda-release.jks"
PROPS="android/keystore.properties"
ALIAS="deudda"

[[ -f "$KEYSTORE" ]] && die "이미 키가 있습니다: $KEYSTORE" \
  "덮어쓰면 기존 키를 잃습니다. 정말 새로 만들려면 먼저 그 파일을 안전한 곳으로 옮기세요."
[[ -f "$PROPS" ]] && die "이미 설정이 있습니다: $PROPS" \
  "키 파일만 지워졌다면 백업에서 되살리세요. 설정만 다시 쓰려면 이 파일을 지우고 실행하세요."

cat <<'INTRO'

릴리스 서명 키를 만듭니다.

  • 비밀번호는 화면에 보이지 않습니다. 그대로 입력하고 Enter 를 누르세요.
  • 만든 뒤 키 파일과 비밀번호를 반드시 따로 백업하세요(비밀번호 관리자 등).
  • 이 둘을 잃으면 이 앱으로는 업데이트를 영영 올릴 수 없습니다.

INTRO

read -r -s -p "키 비밀번호(6자 이상): " PW1; echo
[[ ${#PW1} -ge 6 ]] || die "6자 이상이어야 합니다 (keytool 요구사항)."
read -r -s -p "한 번 더 확인: " PW2; echo
[[ "$PW1" == "$PW2" ]] || die "두 번 입력한 비밀번호가 다릅니다."

# dname 을 직접 준다 — 대화형으로 물으면 10문항을 한글 입력 없이 넘겨야 해서 사고가 난다.
# 이 값은 앱 동작과 무관하다. 스토어에 노출되지도 않는다.
keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -storepass "$PW1" -keypass "$PW1" \
  -dname "CN=DEUDDA, OU=DEUDDA, O=DEUDDA, L=Seoul, S=Seoul, C=KR" >/dev/null

cat > "$PROPS" <<PROPSEOF
# 릴리스 서명 설정 — 커밋되지 않습니다(.gitignore).
# 이 파일과 $KEYSTORE 를 함께 백업하세요. 둘 중 하나만 있으면 소용없습니다.
storeFile=$(basename "$KEYSTORE")
storePassword=$PW1
keyAlias=$ALIAS
keyPassword=$PW1
PROPSEOF
chmod 600 "$PROPS"

ok "키 생성: $KEYSTORE"
ok "설정 저장: $PROPS (600, 커밋 안 됨)"

echo
echo "지문 — 카카오/구글 로그인, Firebase 에 등록할 때 씁니다:"
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$PW1" \
  | sed -n '/SHA1:/p;/SHA256:/p' | sed 's/^/  /'
# 카카오는 SHA-1 을 base64 로 인코딩한 "키 해시" 를 쓴다. 손으로 변환하면 꼭 틀린다.
KEYHASH="$(keytool -exportcert -alias "$ALIAS" -keystore "$KEYSTORE" -storepass "$PW1" 2>/dev/null \
  | openssl sha1 -binary | openssl base64)"
echo "  카카오 키 해시: $KEYHASH"

cat <<'NEXT'

이제 릴리스 빌드가 자동으로 서명됩니다:

  npm run apk -- --release     실기기용 서명된 APK
  npm run aab                  Play 스토어 업로드용 .aab

NEXT
