# 밀린 정기결제 소급 청구 런북 (2026-09)

미청구로 밀린 구독의 **밀린 회차 전부**를 소급 청구하는 절차.

> ⚠️ 이 문서의 명령은 **실제로 고객 카드에서 돈이 빠져나간다.** dry run 결과를 눈으로
> 확인한 뒤에만 `dry_run:false` 로 실행할 것.

---

## 1. 왜 필요했나

`current_period_end` 는 "마지막 결제 주기 종료일" 이자 다음 청구 예정일이다. 결제 성공
webhook 이 이 값을 **결제시각 + 1개월** 로 밀어버리기 때문에, 기존 디스패처
(`dispatch-subscription-rebill`, 현재 1회차만 청구)를 아무리 다시 돌려도 **밀린 과거 회차는
영원히 청구되지 않는다.**

그래서 회차를 명시적으로 전개하는 경로를 따로 만들었다.

| 구성 | 역할 |
|---|---|
| `admin_list_catchup_cycles(ids, max_cycles)` (0501) | 밀린 회차 전개 + 청구 가능 여부 확정 (조회 전용) |
| `dispatch-rebill-catchup` (Edge Function) | 확정된 회차만 PayApp `rebillPay` 로 청구 |

회차 키: `cycle_period_end = current_period_end + k months` (그 값이 `now()` 미만인 동안).
이 값이 `subscription_rebill_charges` 의 멱등키라 **같은 회차 중복 청구는 구조적으로 불가능**하다.

## 2. 안전 게이트 (전부 fail-closed)

1. `x-cron-secret` 또는 service_role Bearer 없으면 401
2. `dry_run` 기본값 true — `BILLING_REBILL_ENABLED` 가 `true`/`1` 이 아니면 요청과 무관하게 dry run 으로 강등
3. 청구 대상은 SQL RPC 가 `chargeable=true` 로 확정한 회차만 (Edge 는 좁히기만 가능)
4. `(구독, 회차)` 멱등키로 중복 차단
5. 청구 직전 구독 상태 재확인 — `active` / `auto_renew` / 해지요청 없음 / `rebill_no` 존재가
   아니면 그 건은 건너뛴다

## 3. 제외 규칙

| exclude_reason | 의미 |
|---|---|
| `cancel_requested` | 해지 요청된 구독 — **본인이 해지한 회원은 청구하지 않는다** |
| `missing_rebill_no` | PayApp 정기결제 미등록 → 결제수단 재등록 안내 대상 |
| `amount_mismatch` | 구독 저장 금액 ≠ 플랜 정가 → 데이터 점검 후 수동 처리 |
| `admin_account` / `demo_account_excluded` | 관리자·데모 계정 |
| `non_chargeable_tier` | `membership_tier='free'` |
| `cycle_already_processed` | 이미 시도/성공한 회차 |

## 4. 실행 절차

### (1) dry run — 지금 바로 가능, 돈 안 나감

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-rebill-catchup" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"dry_run":true,"limit":100,"max_cycles":6}'
```

`summary.chargeable_cycles` / `chargeable_amount` / `would_charge[]` 를 확인한다.
`excluded` 에 잡힌 사유별 건수도 같이 본다.

### (2) 실청구

1. Vercel(또는 Supabase Functions) 환경변수에 `BILLING_REBILL_ENABLED=true` 설정
2. 소수 건으로 먼저 확인:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-rebill-catchup" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"dry_run":false,"limit":2,"max_cycles":6}'
```

3. 결과가 `accepted_awaiting_webhook` 이면 PayApp 이 접수한 것이다. 몇 초 뒤 webhook 이
   도착하면 `payment_orders.status='paid'` + 구독 기간이 갱신된다. 아래로 확인:

```sql
select order_no, status, amount, paid_at
from public.payment_orders
where order_no like 'swk_catchup_%'
order by created_at desc;
```

4. 정상 확인되면 나머지를 `limit` 을 올려 실행

### (3) 실행 후 정리

**작업이 끝나면 `BILLING_REBILL_ENABLED` 를 다시 끄거나**, 상시 자동청구로 전환할지 결정한다.
켜둔 채로 두면 이 함수가 언제든 실청구 가능한 상태가 된다.

## 5. 실패 처리

| status | 대응 |
|---|---|
| `accepted_awaiting_webhook` | 정상. webhook 으로 확정 |
| `provider_rejected` | PayApp 거절(카드 한도/유효기간/정기결제 해지 등) → 회원에게 결제수단 재등록 안내 |
| `unknown_pending_reconciliation` | 타임아웃. **재시도 금지** — PayApp 콘솔에서 실제 승인 여부 확인 후 수동 정리 |
| `skipped_missing_rebill_no` | 청구 직전 상태 변경(해지 등). 정상 동작 |
| `skipped_duplicate_cycle` | 이미 처리된 회차. 정상 동작 |

## 6. 상시 자동청구(월 정기)로 전환할 때

`dispatch-rebill-catchup` 은 밀린 회차가 1건뿐인 정상 상태에서는 일반 월 청구와 동일하게
동작하므로, 일 1회 스케줄로 걸면 그대로 월 정기청구가 된다.

기존 `dispatch-subscription-rebill` 을 쓰려면 **재배포가 먼저 필요하다** — `rebillPay` 에
`rebill_no` 를 전달하지 않아 빈 값으로 보내던 버그를 저장소에서 고쳐 두었고(모든 청구가
PayApp 에서 거절됐을 값), 아직 배포되지 않았다. Kill Switch 가 꺼져 있어 운영에는 노출된
적이 없다.
