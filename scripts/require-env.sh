#!/usr/bin/env bash
#
# require-env.sh — .env 가 실제로 채워졌는지 확인한다. 다른 스크립트에서 source 해서 쓴다.
#
# 이 검사가 없으면 빌드는 성공하고 APK 도 정상적으로 나오는데, 기기에서 켜면
# "Supabase 환경 변수가 설정되지 않았어요" 화면만 뜬다. 빌드에 몇 분을 쓰고
# 에뮬레이터를 켜서야 아는 게 최악이라 빌드 전에 여기서 끊는다.
#
# 부르는 쪽에 die()/ok() 가 있으면 그걸 쓰고, 없으면 기본 구현을 쓴다(pick-jdk.sh 와 같은 방식).
type die >/dev/null 2>&1 || die() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }
type ok  >/dev/null 2>&1 || ok()  { echo "✓ $1"; }

[[ -f .env ]] || die ".env 가 없습니다." \
  "cp .env.example .env  후 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 채우세요." \
  "(값이 없으면 앱이 '설정 필요' 화면만 보여줍니다)"

# 템플릿 그대로면 앱이 "설정 필요" 화면만 띄운다. 값이 채워졌는지 실제로 확인한다
# (예전 검사는 '^VITE_SUPABASE_URL=https' 였는데 템플릿의 your-project-ref 도 https 라 통과했다).
if grep -qE '^VITE_SUPABASE_URL=.*your-project-ref' .env \
   || grep -qE '^VITE_SUPABASE_ANON_KEY=your-anon-key' .env \
   || ! grep -qE '^VITE_SUPABASE_URL=https://[a-z0-9]+\.supabase\.co' .env \
   || ! grep -qE '^VITE_SUPABASE_ANON_KEY=ey' .env; then
  die ".env 가 아직 채워지지 않았습니다 (템플릿 상태)." \
    "터미널에 값을 입력하면 파일이 바뀌지 않습니다 — 파일에 직접 써야 합니다." \
    "아래를 통째로 복사해 붙여넣으세요(값은 본인 프로젝트 것으로):" \
    "" \
    "  cat > .env <<'ENVEOF'" \
    "  VITE_SUPABASE_URL=https://<프로젝트ref>.supabase.co" \
    "  VITE_SUPABASE_ANON_KEY=<anon public key>" \
    "  ENVEOF" \
    "" \
    "anon key: Supabase 대시보드 → Project Settings → API → anon public"
fi
ok ".env 확인"
