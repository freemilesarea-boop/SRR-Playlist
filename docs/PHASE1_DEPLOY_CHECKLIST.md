# Phase 1 — Enterprise 운영 자동화/보안 prod 배포 체크리스트

migrations **0388 ~ 0394** + cron(`api/cron/enterprise-ops.ts`) + edge(`dispatch-admin-notifications`)
+ 계약 버킷 보안(0394) 을 prod 에 안전하게 적용하기 위한 순서/검증 문서.

> **상태 (2026-07-01)** — **조건부 완료 (Conditional Complete)**
>
> DB migration / cron 코드 / 알림 dispatch 멱등 / announcement V2 / 계약 버킷 private
> 은 prod 반영됨. 다만 아래 항목은 sandbox 환경 제약으로 **자동 검증 불가**,
> 사용자 로컬 또는 대시보드 승인이 필요합니다. §11 요약 참조.
>
> 세부 상태:
> - ✅ **완료**: 0388~0394 prod DB 적용 / cron 동작 간접 확인
>   (`enterprise_policy_automation_runs=78`) / announcement play_log 생성 확인
>   (0→4 rows) / admin_notifications 존재(40 rows) / 계약 버킷 private
>   코드+DB 정책 확인 / 정산 snapshot UI 코드 확인 (`ContractSnapshotCard`).
> - ⚠️ **사용자 직접 확인 필요**: dispatch-admin-notifications 재배포 승인,
>   Vercel 최신 dev 배포, Vercel env 5종, `scripts/smoke-enterprise-ops.sh`
>   로컬 실행, Supabase SQL Editor read-only 쿼리, 실제 계약 파일
>   403/signed URL 실증.

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

- [x] 0388 안내방송 exact-timer  *(prod 적용, play_logs 4 rows 발생 확인)*
- [x] 0389 안내방송 중복 차단
- [x] 0390 정산 계약 snapshot
- [x] **0391** `_is_super_admin` service_role 분기 — **0393/cron 동작 선결**
- [x] 0392 알림 dispatch 멱등 (`dispatched_at` 등) + 기존 row backfill
- [x] 0393 NOC alert sync RPC + dedup index
- [x] 0394 계약 버킷 private (아래 §4 동시 배포 주의)

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

---

## 10. Prod 스모크 실측 결과 (2026-07-01)

sandbox 환경 제약으로 아래 신호는 `list_tables` (row count) + 정적 코드 확인 기반.

| 지표 | 값 | 해석 |
|------|----|------|
| `enterprise_policy_automation_runs` | **78 rows** | cron 지속 발화 중 (15min × 24h 상한 96회 기준) → `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` / cron 등록 사실상 정상 |
| `enterprise_announcement_play_logs` | **4 rows** (PR #222 시점 0) | 0388 exact-time V2 + 0389 dedup 적용 후 실제 재생 성공 발생 |
| `admin_notifications` | **40 rows** | 알림 시스템 active |
| `enterprise_monthly_settlements` / items | **1 / 5 rows** | Phase 1-11 정산 snapshot 데이터 존재 |
| `enterprise_contracts` / files | 0 / 0 rows | 계약 데이터 아직 없음 → 계약 signed URL 실증은 실제 파일 생성 후 가능 |
| `storage.buckets(id='enterprise-contracts').public` | (코드 상 `false`) | 0394 apply 반영 예상. SQL Editor 로 실증 필요 |

**직접 검증 실패로 판정된 항목 없음.** 실측 신호는 전부 정상 방향.

---

## 11. 사용자 직접 확인 필요 (Conditional 완료 근거)

sandbox egress + MCP approval 게이트로 이 세션에서 자동 실행 불가한 항목:

- [ ] **dispatch-admin-notifications edge function 재배포 승인**
      — MCP `deploy_edge_function` 실행 시 approval prompt 승인 (코드 변경 없음, version bump 만)
      대안: `supabase functions deploy dispatch-admin-notifications` CLI 로컬 실행.
- [ ] **Vercel 대시보드 최신 dev 배포 확인**
      — merge commit `623ec16` (PR #231) 자동 배포 여부 확인.
- [ ] **Vercel Environment Variables 5종 실측**
      `CRON_SECRET` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
      `RESEND_API_KEY` / `RESEND_FROM` — Project Settings → Environment Variables.
- [ ] **`bash scripts/smoke-enterprise-ops.sh` 로컬 실행**
      기대: HTTP 200 + `results = {policy_automation, billing_overdue, noc_alert_sync, notifications_dispatch}` 4개 각 `ok: true`.
- [ ] **Supabase SQL Editor read-only 쿼리 실행** (§7-2, §7-3, §11-a 참조)
- [ ] **실제 계약 파일 1건 생성 후** 과거 public URL → 403 / 관리자 signed URL → 다운로드 확인.

### §11-a — 사용자용 read-only SQL 세트

```sql
-- 종합 지표
select
  (select count(*) from public.admin_notifications
    where kind='noc_alert' and created_at >= now() - interval '6 hours') as noc_alert_6h,
  (select count(*) from public.admin_notifications where dispatched_at is null) as pending_dispatch,
  (select count(*) from public.admin_operation_logs
    where source='cron' and category='enterprise_ops'
    and created_at >= now() - interval '1 hour') as cron_runs_1h,
  (select public from storage.buckets where id='enterprise-contracts') as contracts_bucket_public;
-- 기대: contracts_bucket_public=false, cron_runs_1h ≥ 1

-- NOC dedup 위반 (결과 0건 = 정상)
select coalesce((context->>'noc_dedup_key'), 'null') as dedup_key, count(*) c
  from public.admin_notifications
 where kind='noc_alert' and created_at >= now() - interval '6 hours'
 group by 1 having count(*) > 1;

-- Announcement occurrence 중복 (결과 0건 = 정상)
select context->>'occurrence_key' as occ, count(*)
  from public.enterprise_announcement_play_logs
 where status='played' and created_at >= now() - interval '24 hours'
 group by 1 having count(*) > 1;
```

---

## 12. Phase 2 후보 (우선순위)

Phase 1 조건부 완료 후 다음 파도. 각 항목은 별도 계획/PR 로 진행. **본 문서는 후보만 정리**하며
설계/구현은 별도 킥오프에서 확정합니다.

### P0 — Phase 1 마무리 · 즉시

| # | 항목 | 근거 |
|---|------|------|
| P0-1 | Phase 1 사용자 직접 확인 6개 (위 §11) 완료 | 이 문서 승인 이후 최우선 |
| P0-2 | 실측 후 발견된 실패/이상은 최소 수정 PR 로 hotfix | smoke 결과 기반 |
| P0-3 | Migration numbering CI Guard (PR #231) merge 후 회귀 없음 재확인 | 이미 merge — 후속 PR 에서 실제 감지되는지 관찰 |

### P1 진행 상태 (Phase 2 실장)

| 항목 | 상태 | 근거 |
|------|------|------|
| **Phase 2-1** Enterprise Operations Center | ✅ **완료** (2026-07-01) | PR #234 merge (`8047bbc`) + migration 0395 prod apply + 6개 검증 통과 |
| **Phase 2-2** Quick Actions 활성화 | 🟡 **킥오프 대기** | `docs/PHASE2_2_QUICK_ACTIONS_KICKOFF.md` 참조 |
| Phase 2-3+ | ⚪ 대기 | Phase 2-2 완료 후 재우선순위화 |

### P1 — Enterprise 운영 관제 강화 (Phase 2 본편 후보)

| # | 항목 | 배경 |
|---|------|------|
| P1-1 | **HQ Preview**: Enterprise HQ 계정용 안내음/긴급방송 미리듣기 UI + RPC | PR #223 후 남은 gap — HQ 는 매장 아님, 별도 preview RPC 필요 |
| P1-2 | **Announcement 정각성 (drift) 대시보드** | 0388 V2 log `drift_ms` 를 admin 화면에 집계 표시 |
| P1-3 | **NOC alert 사후 분석**: dedup_key 별 반복률 / 알림 소음 지표 | 0393 sync 후 알림 폭주 방지 |
| P1-4 | **Cron 결과 상시 노출**: `admin_operation_logs(source='cron')` 대시보드 카드 | 운영자가 매번 SQL 안 짜도 되도록 |

### P2 — 정산·청구·계약 강화

| # | 항목 | 배경 |
|---|------|------|
| P2-1 | **Enterprise 청구 자동 생성 스케줄** — 월초 자동 invoice draft | 현재는 수동 생성만 |
| P2-2 | **HQ 계약 파일 업로드 UX 개선** — TTL 자동 갱신 + 서명 상태 timeline | 0394 private 전환 후 필요 |
| P2-3 | **Artist 정산 hold_status 확장** — 이월 자동 해소 / 재계산 예약 | PR #224 (artist visibility) 후속 |
| P2-4 | **Admin 대시보드 timeout 최적화** — `admin_enterprise_overview` per-franchise lateral join precompute | 0387 인덱스 후 남은 병목 |

### P3 — 매장 플레이어 안정성

| # | 항목 | 배경 |
|---|------|------|
| P3-1 | **AnnouncementOverlay 시계 오차 자동 보정** — NTP-style server offset 실시간 갱신 | 0388 V2 후속 정밀도 개선 |
| P3-2 | **Emergency Broadcast dedup 재확인** — occurrence-level dedup 를 emergency 에도 적용 | announcement 0389 패턴 확장 |
| P3-3 | **Store player heartbeat 감쇠 감지** — offline 매장 자동 알림 | NOC 카드 재활용 |

### P4 — 보안·거버넌스

| # | 항목 | 배경 |
|---|------|------|
| P4-1 | **RLS-disabled 테이블 정리** (`_x5_*`, `orphaned_storage_paths`, `_x54_*` 등 10개) | Supabase advisory critical |
| P4-2 | **Migration duplicate legacy allowlist 축소** (0068 / 0214 / 0388 → 3 → 2 → 1 → 0) | 신규 duplicate 재발 방지 이후 legacy 도 서서히 해소 |
| P4-3 | **service_role 사용처 audit** — 0391 이후 확대된 접근면 리뷰 | cron/edge 게이트 최소 권한 원칙 |

### 우선순위 결정 원칙

1. **P0 (§11 finalize) 먼저** — Phase 1 실제 완료 확정 없이 Phase 2 착수 금지.
2. **P1 은 관제/가시성** — 이미 완성된 자동화의 관제 눈이 없어 신뢰가 안 쌓임.
3. **P2 는 매출/청구 회로** — 청구 자동화 후 정산·계약 흐름 완결.
4. **P3 은 매장 실사용 안정성** — 정각성/장애 감지.
5. **P4 는 지속적 보안 부채 청산** — 다른 파도와 병행 가능.

각 후보는 아직 착수 승인 전 — 사용자가 P1-1 / P2-1 등을 지목하면 별도 킥오프 문서로 확장.
