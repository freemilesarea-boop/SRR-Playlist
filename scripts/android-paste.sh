#!/usr/bin/env bash
#
# android-paste.sh — 가상기기에 한글을 넣는다(자판 설정 없이).
#
#   npm run android:paste -- "쿠우쿠우 강남점"    넘긴 글자를 붙여넣을 준비
#   npm run android:paste                         테스트용 값 목록을 보여준다
#
# 에뮬레이터에서 한글이 안 써지는 건 자판 문제다. 그런데 붙여넣기는 자판을 거치지
# 않으므로 항상 된다 — 에뮬레이터가 맥 클립보드를 공유하기 때문이다.
# 그래서 이 스크립트는 맥 클립보드에 글자를 넣어두기만 한다. 기기에서는
# 입력란을 길게 눌러 "붙여넣기" 를 고르면 된다.
#
# adb 로 직접 넣을 수는 없다. adb shell input text 는 ASCII 만 보내고
# (한글은 그냥 사라진다), 클립보드 쓰기는 root 없이는 막혀 있다.
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'

command -v pbcopy >/dev/null || {
  echo "${YEL}!${OFF} pbcopy 가 없습니다(맥이 아닌 환경)." >&2
  echo "  ${DIM}쓰시는 OS 의 복사 도구로 직접 복사한 뒤 기기에 붙여넣으세요.${OFF}" >&2
  exit 1
}

if [[ $# -gt 0 ]]; then
  TEXT="$*"
  printf '%s' "$TEXT" | pbcopy
  echo "${GRN}✓${OFF} 복사됨: ${BOLD}$TEXT${OFF}"
  echo "  ${DIM}기기에서 입력란을 ${BOLD}길게 눌러${OFF}${DIM} 붙여넣기를 고르세요.${OFF}"
  exit 0
fi

cat <<INFO
${BOLD}한글을 기기에 넣는 법${OFF}

  ${BOLD}npm run android:paste -- "넣을 글자"${OFF}
  맥 클립보드에 넣어둡니다. 기기에서 입력란을 ${BOLD}길게 눌러${OFF} 붙여넣기.

${DIM}붙여넣기가 안 되면 에뮬레이터 오른쪽 '...' → Settings → Clipboard sharing 을 켜세요.${OFF}

${BOLD}테스트용 값${OFF} ${DIM}(그대로 복사해 쓰세요)${OFF}

  브랜드명      npm run android:paste -- "쿠우쿠우"
  매장명        npm run android:paste -- "쿠우쿠우 강남점"
  담당자명      npm run android:paste -- "홍길동"
  사업자명      npm run android:paste -- "주식회사 듣다"
  주소          npm run android:paste -- "서울특별시 강남구 테헤란로 1"
  플레이리스트  npm run android:paste -- "오전 매장 음악"

${DIM}자판으로 직접 치고 싶으면: npm run android:korean${OFF}
INFO
