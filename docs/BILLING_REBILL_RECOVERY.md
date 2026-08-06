# 정기결제(rebill) 실행 계층 — 복구 & 운영 Runbook

Phase **BILLING-SCHEDULER-RECOVERY-1**. PayApp 정기결제 자동 재청구를 안전하게
재개하기 위한 구성요소, 활성화 절차, 롤백을 정의한다.

> ⚠️ 이 문서의 코드는 **기본 비활성(fail-closed)** 이다. 실제 청구는 운영자 승인 +
> Kill Switch(`BILLING_REBILL_ENABLED=true`) + Cron 등록이 **모두** 충족될 때만 발생한다.
> 과거 누락분(LEGACY_OVERDUE, 감사 시점 11~12건)은 어떤 경우에도 자동 청구되지 않는다.

---

## 1. 구성요소

| 구성요소 | 경로 | 역할 |
|---|---|---|
| 순수 판정 로직(테스트됨) | `src/lib/billingRebill.ts` (+ `.test.ts`) | 분류/금액/멱등키/dry_run/kill-switch/마스킹 단일 참조 구현 |
| 분류 RPC | `admin_list_rebill_due_v2()` (mig 0465) | 서버에서 `chargeable` 확정. FUTURE_DUE만 청구 가능. PII 미반환 |
| Cutover 상수 | `billing_rebill_cutover_ts()` (mig 0465) | 과거/미래 경계 고정 = `2026-08-06 00:00:00+09` |
| 청구 시도 기록 | `record_rebill_charge_attempt()` (mig 0465) | `(subscription_id, cycle_period_end)` 멱등 |
| 결과 마킹 | `mark_rebill_charge_result()` (mig 0465) | 상태머신 전이 기록 |
| 원장 테이블 | `subscription_rebill_charges` (mig 0465) | 청구 시도/결과 감사 로그 |
| 운영 지표 | `admin_rebill_ops_metrics()` (mig 0465) | 모니터링 집계(PII 없음) |
| 디스패처 | `supabase/functions/dispatch-subscription-rebill/index.ts` | chargeable 대상만 PayApp `rebillPay` |
| 스케줄러(미등록) | `api/cron/subscription-rebill.ts` | Vercel Cron 핸들러. `vercel.json` 미등록 = 자동 실행 안 됨 |

## 2. 대상 분류 (`admin_list_rebill_due_v2`)

활성·자동갱신·결제일 경과 구독을 다음으로 분류하며, **FUTURE_DUE 만 `chargeable=true`**.

- **FUTURE_DUE** — Cutover 이후 도래한 정상 갱신분. 유일한 청구 대상.
- **LEGACY_OVERDUE** — Cutover 이전 종료분(과거 장애 누락). 자동 청구 금지 → `LEGACY-BILLING-RECONCILIATION-1` 에서 별도 처리.
- **INVALID_REBILL** — rebill_no 없음 / 금액 불일치 / 미청구 tier / 데모 계정(정확 UUID) / 해지요청 등.
- **DUPLICATE_BLOCKED** — 동일 (구독, 주기)에 진행/성공 이력 존재.

금액은 항상 서버 `subscription_plans.price` 기준(요청 Body 금액 미사용). 개인정보(email/phone/nickname)는 반환하지 않는다.

## 3. 결제 실행 상태머신 (`subscription_rebill_charges.status`)

```
eligible → attempted → requesting → provider_accepted/awaiting_webhook → (webhook) paid
requesting → provider_rejected → failed
requesting → (timeout/네트워크 불명확) → unknown → reconciled | failed | paid
```

- **`paid` 는 webhook(payapp-feedback)만 확정.** 디스패처는 PayApp API 응답만으로 subscription 기간을 연장하지 않는다.
- Timeout/불명확 응답은 즉시 재시도하지 않고 `unknown` 으로 두어 reconciliation 대상화.

## 4. 멱등성

- DB: `uq_rebill_charge_cycle (subscription_id, cycle_period_end)` UNIQUE + `record_rebill_charge_attempt` 의 `ON CONFLICT DO NOTHING`.
- 동일 주기에 `attempted/requesting/accepted/provider_accepted/awaiting_webhook/paid` 이력이 있으면 재청구 안 함.

## 5. Kill Switch (fail-closed)

`BILLING_REBILL_ENABLED` 가 정확히 `true`/`1` 이 아니면(미설정 포함) **항상 dry-run**.
디스패처와 Cron 양쪽에서 독립 검증하므로 한쪽만 열려도 실청구되지 않는다.

## 6. 요청 스키마 (디스패처)

```jsonc
{ "dry_run": true, "mode": "future_due|legacy_review", "limit": 20,
  "subscription_ids": ["<uuid>"], "execution_id": "..." }
```
- `dry_run` 기본 `true`. `legacy_review` 는 청구하지 않고 격리 목록만 반환.
- `subscription_ids` 지정 시에도 서버 `chargeable` 재검증(FUTURE_DUE 아니면 제외).

## 7. 활성화 절차 (운영자 승인 필수 — 이 Phase 에서는 실행하지 않음)

1. **Provider 대조** — PayApp 관리자/Read-Only API 로 가맹점 상태·`rebillPay` 권한·유효 rebill_no 확인. 불가 시 `UNVERIFIED` → 활성화 금지.
2. **Secret 확인(PRESENT/MISSING만)** — `PAYAPP_USERID`, `PAYAPP_LINKKEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **마이그레이션 0465 적용** (Preview → Production).
4. **디스패처 배포** (`BILLING_REBILL_ENABLED` 미설정 상태 = dry only).
5. **Production Read-Only Dry Run** — FUTURE_DUE / LEGACY / INVALID 건수·금액 보고 → 승인 대기.
6. **Canary** — 승인 후 `BILLING_REBILL_ENABLED=true`, 디스패처를 `{dry_run:false, limit:1}` 로 1건만. PayApp 승인 → webhook 수신 → `payment_orders` → 기간 연장 → 매출 반영 → 중복 0 확인.
7. **Scheduler 등록** — `vercel.json` crons 에 `{"path":"/api/cron/subscription-rebill","schedule":"10 0 * * *"}` 추가(= 09:10 KST). 24h 모니터링.

### 실행 주기 근거
일 1회 **09:10 KST**(`10 0 * * *` UTC). 근거: 결제일은 일 단위(KST), 기존 `daily-metrics` cron(01:00 UTC=10:00 KST)과 겹치지 않게 그 직전 실행, 한국 업무시간 시작 직전이라 이상 발생 시 당일 대응 가능. 동일 주기 중복은 멱등키로 방지.

## 8. 모니터링 & 알림

`select public.admin_rebill_ops_metrics();` — due_future/legacy/invalid/duplicate, attempts_today, paid_today, charged_amount_today, by_status_today, last_charge_at.

알림 기준(모두 PII 없이 집계만): Scheduler 미실행 / 예정>0 인데 시도 0 / `provider_accepted`↔webhook `paid` 장기 격차 / `unknown` 발생 / 실패율 임계 초과 / Secret 누락.

## 9. Rollback

**즉시 중단:** `BILLING_REBILL_ENABLED=false` (또는 env 삭제) → 다음 실행부터 dry-run. 필요 시 `vercel.json` 에서 cron 항목 제거.

트리거: 중복 청구 / 잘못된 금액 / LEGACY 청구 / webhook 미수신 / 기간 미갱신 / `unknown` 급증 / Secret·인증 오류 / 매출 불일치.

절차: ① Kill Switch off → ② cron 제거 → ③ 진행 중 `execution_id` 확인 → ④ PayApp 원장 대조 → ⑤ webhook 처리 상태 확인 → ⑥ 잘못된 청구는 **별도 승인 후** 취소/환불 → ⑦ 원인 수정 전 재활성화 금지.

마이그레이션 0465 는 additive(신규 테이블/컬럼/함수)라 데이터 손상 없이 되돌릴 수 있다(신규 함수 DROP / 신규 컬럼 무시). 기존 최초결제·webhook 상태머신·매출 집계 경로는 건드리지 않는다.

## 10. 이 Phase 가 하지 않는 것

과거 12건 실청구 없음 · Production Scheduler 활성화 없음 · Canary 실행 없음(운영자 승인 전) · 구독/결제 상태 임의 수정 없음 · Provider 설정 변경 없음.
