# 밀린 정기결제 소급 청구 런북 (2026-09)

> 🛑 **2026-09-04 실행 결과 — 현재 이 경로는 동작하지 않습니다.**
>
> 실전 1건을 쏜 결과 PayApp 이 이렇게 응답했습니다:
> ```
> state = 0
> errorMessage = "cmd 값을 확인 하세요."
> ```
> 카드 거절이 아니라 **`cmd=rebillPay` 라는 명령을 PayApp 이 인식하지 못합니다.**
> 실제 청구는 발생하지 않았습니다(웹훅 0건 / 결제 0건).
>
> 즉 **등록된 `rebill_no` 로 가맹점이 임의 시점에 즉시 청구하는 cmd 이름을 모르는 상태**입니다.
> `rebillRegist`(등록)는 정상 동작하며, 이후 청구는 PayApp 이 자체 스케줄(운영 관찰상 매일
> 10:10 KST 배치)로 수행해 왔습니다.
>
> **다음 단계: PayApp 기술지원에 "등록된 rebill_no 로 즉시 청구하는 API cmd 가 있는지"를
> 문의해야 합니다.** cmd 이름을 추측해서 시도하는 것은 금지 — 결제·취소·환불 명령이 같은
> 엔드포인트를 공유하므로 잘못 맞으면 실제 환불/해지가 발생할 수 있습니다.
>
> ⚠️ 같은 이유로 `dispatch-subscription-rebill`(기존 디스패처)도 **Kill Switch 를 켜도
> 청구되지 않습니다.** 동일한 `cmd=rebillPay` 를 사용합니다.

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

## 4. 어디서 실행하나

**본인 PC의 터미널에서 실행한다.** 어딘가에 올리는 파일이 아니라, PayApp/Supabase 로 요청을
한 번 쏘는 명령이다. (맥: 터미널.app / 윈도우: PowerShell)

`$SUPABASE_URL`, `$CRON_SECRET` 은 각자 값으로 바꿔 넣는다.

| 값 | 어디서 확인 |
|---|---|
| `SUPABASE_URL` | `https://nsoesrvwkxqifjcxzvol.supabase.co` (운영 프로젝트) |
| `CRON_SECRET` | Supabase Dashboard → Project Settings → **Edge Functions → Secrets** |

`CRON_SECRET` 이 없으면 대신 service_role 키로 호출해도 된다 (Project Settings → API →
`service_role`). 헤더만 바꾼다:

```
-H "Authorization: Bearer <service_role 키>"
```

> ⚠️ **Kill Switch 는 Supabase Edge Functions Secrets 에 넣어야 한다.** 이 함수는 Supabase
> 에서 돌기 때문에 Vercel 환경변수는 읽지 않는다. (Vercel 쪽 `BILLING_REBILL_ENABLED` 는
> `/api/cron/subscription-rebill` 핸들러 전용이라 이 작업과 무관하다.)

## 5. 실행 절차

### (1) dry run — 지금 바로 가능, 돈 안 나감

```bash
curl -X POST "https://nsoesrvwkxqifjcxzvol.supabase.co/functions/v1/dispatch-rebill-catchup" \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "content-type: application/json" \
  -d '{"dry_run":true,"limit":100,"max_cycles":6}'
```

`summary.chargeable_cycles` / `chargeable_amount` / `would_charge[]` 를 확인한다.
`excluded` 에 잡힌 사유별 건수도 같이 본다.

### (2) 실청구

1. Supabase Dashboard → Project Settings → Edge Functions → Secrets 에
   `BILLING_REBILL_ENABLED = true` 추가
   (CLI 로는 `supabase secrets set BILLING_REBILL_ENABLED=true`)
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

## 6. 실패 처리

| status | 대응 |
|---|---|
| `accepted_awaiting_webhook` | 정상. webhook 으로 확정 |
| `provider_rejected` | PayApp 거절(카드 한도/유효기간/정기결제 해지 등) → 회원에게 결제수단 재등록 안내 |
| `unknown_pending_reconciliation` | 타임아웃. **재시도 금지** — PayApp 콘솔에서 실제 승인 여부 확인 후 수동 정리 |
| `skipped_missing_rebill_no` | 청구 직전 상태 변경(해지 등). 정상 동작 |
| `skipped_duplicate_cycle` | 이미 처리된 회차. 정상 동작 |

## 7. 상시 자동청구(월 정기)로 전환할 때

`dispatch-rebill-catchup` 은 밀린 회차가 1건뿐인 정상 상태에서는 일반 월 청구와 동일하게
동작하므로, 일 1회 스케줄로 걸면 그대로 월 정기청구가 된다.

기존 `dispatch-subscription-rebill` 을 쓰려면 **재배포가 먼저 필요하다** — `rebillPay` 에
`rebill_no` 를 전달하지 않아 빈 값으로 보내던 버그를 저장소에서 고쳐 두었고(모든 청구가
PayApp 에서 거절됐을 값), 아직 배포되지 않았다. Kill Switch 가 꺼져 있어 운영에는 노출된
적이 없다.
