#!/usr/bin/env bash
#
# pick-jdk.sh — Gradle 이 실제로 쓸 수 있는 JDK 를 골라 JAVA_HOME 에 넣는다.
#
#   . scripts/pick-jdk.sh     (source 해서 쓴다 — JAVA_HOME 을 호출한 쉘에 남겨야 하므로)
#
# 부르는 쪽에 die() / ok() 가 있으면 그걸 쓰고, 없으면 기본 구현을 쓴다.
type die >/dev/null 2>&1 || die() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }
type ok  >/dev/null 2>&1 || ok()  { echo "✓ $1"; }
JDK_MIN=21
JDK_MAX=23

java_major() {  # $1 = JDK 홈. 못 읽으면 아무것도 출력하지 않는다.
  local home="$1"
  [[ -n "$home" && -x "$home/bin/java" ]] || return 0
  "$home/bin/java" -version 2>&1 \
    | sed -n 's/^[^"]*"\([0-9][0-9]*\)\(\..*\)\{0,1\}".*/\1/p' | head -1
}

jdk_ok() {  # $1 = JDK 홈
  local v; v="$(java_major "$1")"
  [[ -n "$v" && "$v" -ge "$JDK_MIN" && "$v" -le "$JDK_MAX" ]]
}

# 찾아볼 JDK 후보를 한 줄에 하나씩 낸다.
# 부르는 쪽에서 미리 정의해 두면 그걸 쓴다(테스트에서 실제 설치본을 배제하는 용도).
type jdk_candidates >/dev/null 2>&1 || jdk_candidates() {
  # macOS: java_home 이 설치된 JDK 를 버전별로 알려준다. 21 을 먼저 본다.
  if [[ -x /usr/libexec/java_home ]]; then
    for v in 21 23 22; do
      /usr/libexec/java_home -v "$v" 2>/dev/null || true
    done
  fi
  # 흔한 설치 경로들. Android Studio JBR 도 후보에 넣되 버전 검사를 통과할 때만 쓴다.
  cat <<'CANDIDATES'
/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
/Library/Java/JavaVirtualMachines/temurin-23.jdk/Contents/Home
/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
/usr/lib/jvm/java-21-openjdk-amd64
/usr/lib/jvm/java-21-openjdk-arm64
/Applications/Android Studio.app/Contents/jbr/Contents/Home
CANDIDATES
}

pick_jdk() {
  # 이미 맞는 걸 잡고 있으면 그대로 둔다.
  if jdk_ok "${JAVA_HOME:-}"; then echo "$JAVA_HOME"; return 0; fi

  local cand
  while IFS= read -r cand; do
    [[ -n "$cand" ]] || continue
    if jdk_ok "$cand"; then echo "$cand"; return 0; fi
  done < <(jdk_candidates)
  return 1
}

if JDK="$(pick_jdk)"; then
  export JAVA_HOME="$JDK"
  export PATH="$JAVA_HOME/bin:$PATH"
  ok "JDK: $JAVA_HOME (Java $(java_major "$JAVA_HOME"))"
else
  CURRENT_JDK_NOTE="현재 JAVA_HOME: ${JAVA_HOME:-(설정 안 됨)}"
  if [[ -n "$(java_major "${JAVA_HOME:-}")" ]]; then
    CURRENT_JDK_NOTE="$CURRENT_JDK_NOTE → Java $(java_major "$JAVA_HOME") (안 됨)"
  fi
  die "Gradle 이 쓸 수 있는 JDK(${JDK_MIN}~${JDK_MAX})가 없습니다." \
    "$CURRENT_JDK_NOTE" \
    "Android Studio 2026 이 들고 오는 JDK 25 로는 빌드가 안 됩니다" \
    "('Unsupported class file major version 69' 오류)." \
    "JDK 17 도 안 됩니다 ('invalid source release: 21')." \
    "" \
    "맥에서 설치:" \
    "  brew install --cask temurin@21" \
    "설치 후 이 명령을 다시 실행하면 알아서 찾습니다." \
    "(수동 지정: export JAVA_HOME=\$(/usr/libexec/java_home -v 21))"
fi
