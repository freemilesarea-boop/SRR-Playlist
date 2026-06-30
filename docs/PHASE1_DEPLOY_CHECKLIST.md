# Phase 1 — Enterprise 운영 자동화/보안 prod 배포 체크리스트

migrations **0388 ~ 0394** + cron(`api/cron/enterprise-ops.ts`) + edge(`dispatch-admin-notifications`)
+ 계약 버킷 보안(0394) 을 prod 에 안전하게 적용하기 위한 순서/검증 문서.

> 본 문서는 **문서/검증용**입니다. 실제 마이그레이션 적용은 배포 담당자가 파이프라인으로 수행하세요.
> (이 PR 시점에는 prod 미적용 상태)

---

## 0. 대상 변경 요약

| migration | 내용 | 동작 변경 | 의존 |
|---|---|---|---|
| 0388 | 안내방송 exact-timer V2 (`store_get_upcoming_announcements` 등) | additive | 0381/0386/0387 |
| 0389 | 안내방송 occurrence 중복 차단 | additive | 0388 |
| 0390 | 정산 계약 snapshot (EMS 컬럼 + generate 계약값 반영) | additive | 0383 헬퍼(prod 존재) |
| 0391 | `_is_super_admin()` 에 service_role 분기 (**cron 게이트**) | 함수 1줄 OR | — |
| 0392 | `admin_notifications` dispatch 멱등 컬럼 + backfill | additive | 0083 |
| 0393 | `admin_noc_sync_alerts_to_notifications` + dedup index | additive | 0385(NOC), 0391, 0392 |
| 0394 | enterprise-contracts 버킷 private + storage 정책 교체 | **버킷/정책 변경** | — |

`api/cron/enterprise-ops.ts` (신규 Vercel cron) · `dispatch-admin-notifications` (멱등화 재배포) ·
계약 패널 signed URL (0394 동반).

---

## 1. DB 마이그레이션 (순서대로 적용)

```
0388 → 0389 → 0390 → 0391 → 0392 → 0393 → 0394
```

- [ ] 0388 안내방송 exact-timer
- [ ] 0389 안내방송 중복 차단
- [ ] 0390 정산 계약 snapshot
- [ ] **0391** `_is_super_admin` service_role 분기 — **0393/cron 동작 선결**
- [ ] 0392 알림 dispatch 멱등 (`dispatched_at` 등) + 기존 row backfill
- [ ] 0393 NOC alert sync RPC + dedup index
- [ ] 0394 계약 버킷 private (아래 §4 동시 배포 주의)

전부 additive/idempotent (0394 만 동작 변경). 모든 migration 은 `BEGIN..ROLLBACK` dry-run 으로
사전 검증 완료(각 PR 본문 참조).

---

## 2. Edge Function 재배포

```bash
supabase functions deploy dispatch-admin-notifications
```
- [ ] 0392 멱등 로직(`dispatched_at IS NULL` + 채널별 마커) 반영본 배포 확인
- (참고) 다른 함수는 미변경

---

## 3. Vercel 배포 (서버리스 + 프론트)

- [ ] 최신 dev 빌드 배포 — `api/cron/enterprise-ops.ts`(신규 cron), 정산/계약 UI 포함
- [ ] `vercel.json` cron 2개 등록 확인: `daily-metrics`(0 1 * * *), `enterprise-ops`(*/15 * * * *)
- [ ] **Vercel cron plan**: `*/15` 분단위 cron 은 **Pro 이상** 필요.
      Hobby 면 daily 한정 → 외부 스케줄러(GitHub Actions cron 등)로 `/api/cron/enterprise-ops` 호출 대체.

---

## 4. ⚠️ 0394 계약 버킷 — 동시 배포 주의

`0394` 적용 즉시 `enterprise-contracts` 버킷이 private 가 되어 **기존 저장된 public `file_url` 직링크가 403** 이 됩니다.
다운로드는 새 클라이언트의 **signed URL** 경로(`getContractFileSignedUrl`)로만 동작합니다.

- [ ] **0394 마이그레이션 + 프론트 배포를 같은 릴리즈로** 진행 (불일치 시 관리자 계약 다운로드 일시 실패)
- [ ] 배포 후 §7 의 계약 파일 검증 수행
- [ ] (롤백) 문제 시: `update storage.buckets set public=true where id='enterprise-contracts';`
      + `enterprise_contracts_public_read` 정책 재생성

---

## 5. 환경변수 / 시크릿

`.env.example` 의 "서버 전용 시크릿" 섹션 참조.

Vercel (서버리스 cron 용):
- [ ] `CRON_SECRET`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

Supabase Edge Functions (`supabase secrets set`):
- [ ] `CRON_SECRET` (Vercel 과 **동일 값**)
- [ ] `RESEND_API_KEY` (+ `RESEND_FROM`) — 이메일 발송
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (보통 자동 주입)

---

## 6. 운영 알림 채널 설정 (admin_settings — env 아님)

미설정 시 알림은 **생성만 되고 발송은 skip**(안전 동작).
- [ ] `notification_slack_webhook_url` (Slack Incoming Webhook)
- [ ] `notification_email_enabled` = true / `notification_email_to` = 수신 주소
- [ ] `notification_min_severity` = warning (기본; noc_alert major→warning/critical→error 모두 발송)

---

## 7. 배포 후 스모크 테스트

자동 헬퍼: `bash scripts/smoke-enterprise-ops.sh` (환경변수 필요 — 스크립트 상단 주석 참조).
수동 절차:

### 7-1. cron 수동 호출
```bash
curl -sS -X GET "$APP_URL/api/cron/enterprise-ops" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```
- [ ] HTTP 200 + `ok` / `results` 에 4작업(policy_automation, billing_overdue, noc_alert_sync, notifications_dispatch) 존재
- [ ] 각 작업 `ok:true` (실패 시 `failed[]` 확인)

### 7-2. NOC 알림 생성/중복 방지 (SQL, 관리자/service_role)
```sql
-- 최근 noc_alert 생성 확인
select id, severity, title, context->>'noc_dedup_key' as dedup_key, created_at, dispatched_at
from public.admin_notifications where kind='noc_alert' order by created_at desc limit 20;
-- 동일 dedup_key 가 6h 내 1건만 있어야 함(중복 생성 없음)
select context->>'noc_dedup_key' as k, count(*)
from public.admin_notifications
where kind='noc_alert' and created_at >= now() - interval '6 hours'
group by 1 having count(*) > 1;   -- 결과가 없어야 정상
```

### 7-3. 알림 dispatch 멱등 (SQL)
```sql
-- dispatch 후 dispatched_at 채워짐 + 재실행해도 재발송 안 됨
select id, kind, dispatched_at, dispatch_slack_at, dispatch_email_at, dispatch_attempts
from public.admin_notifications order by created_at desc limit 20;
-- 미발송(대기) 건수
select count(*) from public.admin_notifications where dispatched_at is null;
```
- [ ] cron 2회 실행 사이 동일 알림이 Slack/이메일로 **중복 수신되지 않음**

### 7-4. 계약 파일 보안 (0394)
- [ ] 기존 public URL 직접 접근 → **403/400** (비공개 전환 확인)
```bash
# 과거 public URL 패턴 예시 — 403 이어야 함
curl -s -o /dev/null -w "%{http_code}\n" "$SUPABASE_URL/storage/v1/object/public/enterprise-contracts/<path>"
```
- [ ] 관리자 패널 → 계약 상세 → 파일 클릭 → **signed URL 새 탭 정상 열림** (TTL 5분)

---

## 8. 검증 명령 (코드 레벨, 사전)
```bash
npm run lint            # eslint 0 warn
npm run build           # tsc + vite + PWA
npm run lint:migrations # 0 violations
```

---

## 9. 롤백 포인트 요약
- 0388~0393: additive — 기능 미사용 시 영향 없음(함수/컬럼만 추가). cron 비활성(vercel cron 제거 또는 CRON_SECRET 미설정)으로 자동 실행만 중단 가능.
- 0394: 유일한 동작 변경 — §4 롤백 SQL 로 버킷 public 복구 가능.
