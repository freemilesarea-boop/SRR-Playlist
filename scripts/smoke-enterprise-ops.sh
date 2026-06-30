#!/usr/bin/env bash
# smoke-enterprise-ops.sh — Phase 1 배포 후 스모크 테스트 헬퍼 (read-only)
#
# enterprise-ops cron 수동 호출 + 검증용 SQL 안내를 출력합니다.
# DB 를 직접 변경하지 않습니다(읽기/호출만).
#
# 필요 환경변수:
#   APP_URL        배포된 앱 URL            (예: https://deudda.com)
#   CRON_SECRET    Vercel Cron 시크릿       (cron 호출 인증)
# 선택:
#   SUPABASE_URL   계약 버킷 public 403 확인용
#
# 사용:
#   APP_URL=https://deudda.com CRON_SECRET=xxxxx bash scripts/smoke-enterprise-ops.sh
#
# 자세한 절차/체크리스트: docs/PHASE1_DEPLOY_CHECKLIST.md

set -euo pipefail

err=0
need() { if [ -z "${!1:-}" ]; then echo "  ✗ env $1 미설정"; err=1; fi; }

echo "== Phase 1 smoke: env 확인 =="
need APP_URL
need CRON_SECRET
if [ "$err" -ne 0 ]; then
  echo "필수 환경변수를 설정 후 다시 실행하세요. (docs/PHASE1_DEPLOY_CHECKLIST.md)"
  exit 1
fi
has_jq=1; command -v jq >/dev/null 2>&1 || has_jq=0

echo
echo "== 1) enterprise-ops cron 수동 호출 =="
echo "GET ${APP_URL%/}/api/cron/enterprise-ops"
code=$(curl -sS -o /tmp/eops_smoke.json -w "%{http_code}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${APP_URL%/}/api/cron/enterprise-ops" || true)
echo "HTTP ${code}"
if [ "$has_jq" -eq 1 ]; then
  jq '{ok, ran_at, failed, results: (.results | map_values({ok, status, ms}))}' /tmp/eops_smoke.json 2>/dev/null \
    || cat /tmp/eops_smoke.json
else
  cat /tmp/eops_smoke.json; echo
  echo "(jq 설치 시 더 보기 좋게 출력됩니다)"
fi
echo
echo "기대: HTTP 200, results 에 policy_automation / billing_overdue / noc_alert_sync / notifications_dispatch 4개, 각 ok=true"

if [ -n "${SUPABASE_URL:-}" ]; then
  echo
  echo "== 2) 계약 버킷 private 확인 (0394) =="
  echo "과거 public 경로 접근 시 403/400 이어야 정상(비공개):"
  echo "  curl -s -o /dev/null -w '%{http_code}' \"${SUPABASE_URL%/}/storage/v1/object/public/enterprise-contracts/<path>\""
fi

cat <<'SQL'

== 3) DB 검증 (Supabase SQL Editor / service_role) ==
-- 3-1) NOC 알림 생성 + 중복 방지 (동일 dedup_key 6h 내 1건)
select context->>'noc_dedup_key' as k, count(*)
  from public.admin_notifications
 where kind='noc_alert' and created_at >= now() - interval '6 hours'
 group by 1 having count(*) > 1;   -- 결과 없어야 정상

-- 3-2) dispatch 멱등 (재실행해도 재발송 안 함)
select id, kind, dispatched_at, dispatch_slack_at, dispatch_email_at, dispatch_attempts
  from public.admin_notifications order by created_at desc limit 20;
select count(*) as pending from public.admin_notifications where dispatched_at is null;

-- 3-3) cron 실행 로그
select created_at, level, status, message
  from public.admin_operation_logs
 where source='cron' and category='enterprise_ops'
 order by created_at desc limit 10;
SQL

echo
echo "== 4) 계약 파일 signed URL =="
echo "관리자 패널 → 계약 상세 → 파일 클릭 → 새 탭 정상 열림(TTL 5분) 확인 (UI 수동)"
echo
echo "스모크 완료. 상세: docs/PHASE1_DEPLOY_CHECKLIST.md"
