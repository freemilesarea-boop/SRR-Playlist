# SETTLEMENT-AUDIT-1 — 정산 시스템 전체 구조·계산식·이월금·지급상태 감사 보고서

> 범위: **읽기 전용 코드/스키마 정적 분석**. 코드·스키마·데이터 변경 없음. Migration/RPC 실행 없음. PR·배포 없음.
> 민감정보: 실제 회원 PII 미포함. 식별은 내부 `artist_user_id`/익명 라벨. 계좌·주민번호는 존재 여부 또는 마스킹 규칙만 기술.
> 기준 코드: `supabase/migrations/*` (~0453까지), `src/components/admin/ArtistSettlement*.tsx`, `src/lib/artistSettlementApi.ts` 등.
> 작성일 컨텍스트: 2026-07 기준 정책 활성.

---

## 0. Executive Summary (최종 요약)

현재 "듣다" 아티스트 정산은 **단일 권위 시스템(v1 `artist_settlements`)** 위에서 동작하며, 계산 로직 자체(pool 분배 → 수수료 → 원천징수 → 이월)는 **결정적이고 감사 가능**하다. 버전 관리(supersede + `version+1`), 지급 immutability, advisory lock, append-only 감사 로그, PII 암호화/마스킹, 이월 auto-merge 소비 추적 등 **핵심 안전장치는 상당히 성숙**하다. 화면 표시값 대부분은 DB 저장값을 그대로 렌더링하므로 표시-원본 일치도가 높다.

그러나 **정산 확정 전 지급을 무제한 신뢰하기에는 몇 가지 로직·표시 리스크가 존재**한다. 가장 중요한 것은 **(1) `payable` 상태를 수동 이월할 때 원천징수 후 금액(`final_payout_amount`)을 이월 원금으로 저장 → 다음 달 재과세(이중 원천징수) 경로**, **(2) refund adjustment로 인한 음수 이월 가능성(0323에서 `>=0` CHECK 제거됨)**, **(3) 화면 2곳에 "5만원 미만" 최소지급 기준이 하드코딩되어 현행 정책(10,000원)과 불일치**하는 표시 오류다. 이월금이 신규 발생액과 시각적으로 잘 구분되지 않고, 이월 최초 발생월/추적이 상세에 노출되지 않는 등 UI/UX 상 운영자 오지급 위험도 남아 있다.

**최종 판정: `SAFE WITH UI IMPROVEMENT` (단, 이중 원천징수·음수 이월 경로는 다음 Phase에서 로직 검증/보정 필요 — 조건부).** 즉시 지급 중단 수준의 CRITICAL은 발견되지 않았으나, 수동 이월/adjustment를 사용하는 운영 흐름에 한해 `REQUIRES LOGIC FIX` 성격의 항목이 있다. 상세는 §9·§15.

---

## 1. 현재 계산 구조 (정산 시스템 구조)

### 1.1 공존하는 3개 정산 시스템

| 시스템 | 목적 | 권위 | 핵심 테이블 | 화면 |
|---|---|---|---|---|
| **v1 `artist_settlements`** | 아티스트 월별 스트리밍 정산·지급 | **권위 (실지급 경로)** | `artist_settlements`, `settlement_items`, `streaming_revenues`, `settlement_policies`, `settlement_adjustments`, `settlement_admin_audit_logs` | 관리자 "아티스트 정산" 탭 |
| **v2 shadow (0420)** | 차세대 엔진(수익가중 pro-rata + explain) | **비권위 (관측/비교 전용)** | `*_v2` 테이블 4종 | 관리자 "정산 v2 (Shadow)" 탭(super-admin) |
| **enterprise 월정산 (0372/0390/0399/0400)** | 본사/프랜차이즈 매장수 커미션 청구 | **자기 도메인 한정 권위** | `enterprise_monthly_settlements(_items)` | 관리자/HQ 화면 |

- **v2는 코드/UI 배너·migration 주석·RPC 반환 JSON(`SHADOW ONLY — not used for payout`)에서 명시적으로 "실지급 금지"**. 아티스트 정산 화면과 무관.
- **enterprise는 아티스트가 아닌 "본사(HQ)"를 지급 대상으로 하는 별개 청구 시스템** — 원천징수 없음, 이월은 self-FK 체인 방식. 아티스트 정산과 직교(orthogonal).
- **본 보고서의 대상 = v1 `artist_settlements`** (관리자 정산 화면). v2/enterprise는 §참고로만 기술.

### 1.2 v1 데이터 흐름 (DB → RPC → UI)

```
payment_orders(status='paid', settlement_period_month)         ← 원천 매출
stream_events(milestone_30s, is_effective, eligible_for_payout) ← 스트리밍 유효건
eligible_settlement_tracks                                      ← 정산 대상 트랙
        │
        ▼  admin_generate_monthly_settlement(p_month, p_dry_run)   (SECURITY DEFINER, admin only, advisory lock)
        │     - settlement_policies 에서 effective_from<=월 최신 정책 선택
        │     - artist_settlements 행 생성/재생성(version+1), settlement_items 박제
        │     - streaming_revenues snapshot, settlement_generation_runs 감사
        ▼
artist_settlements (버전관리: is_current=true 만 활성)
        │
   admin_finalize_settlement → payable | carried_over
   admin_mark_settlement_paid → paid (immutable)
   admin_mark_settlement_held → held
   admin_carryover_settlement → carried_over (수동)
        │
        ▼  admin_settlement_list / admin_settlement_detail (RPC, PII 복호+마스킹)
        ▼
ArtistSettlementsList.tsx / ArtistSettlementDetail.tsx / CarryoverModal.tsx
```

정산은 **스케줄러/크론으로 자동 생성되지 않는다** (`api/cron`, `.github/workflows`, `supabase/functions` 어디에도 v1 정산 생성 트리거 없음). 관리자가 화면에서 `dry-run` → `실제 생성` 을 수동 실행하는 구조.

### 1.3 정산 대상 식별 기준

- **아티스트=회원 계정**: `artist_settlements.artist_user_id` = `users.id` = `auth.users.id`. 별도 아티스트 엔티티가 아니라 아티스트 권한을 가진 회원 계정. 트랙은 `eligible_settlement_tracks.artist_user_id` 로 연결.
- 대상 loop(0348)는 3 집합의 UNION: ① 해당 월 유효 스트림이 있는 아티스트, ② 직전월 이하 미지급/미소비 정산 보유 아티스트(`is_current` & status ∈ {pending,held} 또는 미적용 carried_over), ③ 해당 월에 적용 예정 미적용 adjustment 보유 아티스트. → **스트림이 0이어도 미지급 잔액이 있으면 정산 생성 대상에 포함**(0315 이후 이월 보존 보장).

---

## 2. 현재 화면 각 숫자의 의미 (화면 컬럼 해석표)

### 2.1 목록 화면 — `ArtistSettlementsList.tsx` (RPC `admin_settlement_list`, `is_current=true` 만)

| 순서 | 화면 표시명 | 코드 변수 | DB/RPC 필드 | 계산식 | 부호/색 | 의미 |
|---|---|---|---|---|---|---|
| 1 | 월 | `r.settlement_month` | `artist_settlements.settlement_month` | — | — | 정산 귀속월(KST 1일) |
| 2 | 아티스트 | `artist_nickname`/`artist_email` | `users.nickname`/`auth.users.email` | — | — | 회원 식별 |
| 3 | 정산 정보 | `PiiCell` | `legal_name`/`rrn_masked`/`bank_name`/`masked_account_number`/`account_holder`/`payout_account_status` | 마스킹 | 배지색 | 실명·마스킹 주민번호·마스킹 계좌·PII 상태 배지 |
| 4 | **gross (첫 번째 금액)** | `gross_settlement_amount` | 동명 컬럼 | Σ 트랙 `floor(pool×트랙유효스트림/총유효스트림)` | 양수 | 이번 달 트랙 배분 합(수수료·세전) |
| 5 | **회사 수수료 (첫 음수 공제)** | `company_fee_amount` | 동명 | `floor(gross × company_fee_ratio[0.20])` | **−(회색)** | 플랫폼 공제 |
| 6 | **영업인 수수료 (둘째 음수 공제)** | `sales_agent_fee_amount` | 동명 | `floor(gross × commission_rate/100)` (없으면 0) | **−(회색)** | 영업 파트너 커미션 |
| 7 | **당월정산 (중간 합계)** | `artist_net_settlement` | 동명 | `greatest(gross − 회사 − 영업인, 0)` | 양수 | 이번 달 net(이월 전) |
| 8 | **이월금 (주황색 +금액)** | `previous_carried_amount` | 동명 | 직전월 이하 미지급 합(+adjustments) | **+(amber #f59e0b)** | carryover-IN. 0이면 `—` |
| 9 | **총 정산 (굵게)** | `total_settlement_amount` | 동명 | `artist_net + previous_carried` | 굵게 | 세전 총 지급 대상액 |
| 10 | 원천징수 | `withholding_tax_amount` | 동명 | meets_min 시 `floor(total × 0.033)`, 아니면 0 | −(회색), 0이면 `—` | 소득세(원천징수) |
| 11 | **최종 지급 (보라색 굵게)** | `final_payout_amount` | 동명 | meets_min 시 `greatest(total−withholding,0)`, 아니면 **0** | **accent=purple(rgb 123,63,242)** | 실제 송금 예정액. 이월/보류/기준미달이면 **₩0(보라색)** |
| 12 | 상태 | `status` | 동명 | — | 배지 | pending/payable/carried_over/paid/held/disputed |
| — | 상태 옆 배지 | `version`>1 → `v2`(indigo), `is_manual_carryover` → "수동"(amber), `paid` → "이월 대상 아님"(emerald) | — | — | 보조 배지 |
| 13 | 지급일 | `paid_at` | 동명 | — | null→`—` | 실제 지급 완료 시각 |
| 14 | 액션 | 상세/이월/지급 | — | — | — | 버튼 |

> **"보라색 ₩0" 정체**: 목록 11번 "최종 지급" 컬럼은 항상 `font-bold text-accent`(accent=보라 123,63,242). `carried_over`/`held`/기준미달 행은 `final_payout_amount=0` 이므로 **보라색 ₩0** 으로 표시됨.
> **"주황색 +금액" 정체**: 8번 "이월금"(`previous_carried_amount`)이 `>0` 일 때 `text-amber-600 font-semibold +₩...`.
> **`—` 의 의미**: 이월금(0), 원천징수(0), 지급일(null) 은 값이 없을 때 `—`. 목록에서는 null과 0을 시각적으로 동일 처리하는 지점이 있음(UX 이슈, §10).

### 2.2 상세 화면 — `ArtistSettlementDetail.tsx` (RPC `admin_settlement_detail`)

산정 내역 섹션(위→아래 순서와 부호가 화면 요구사항과 정확히 일치):

| 화면 라벨 | 변수 | 계산식 | 부호/스타일 |
|---|---|---|---|
| ① Gross (트랙별 합산) | `gross_settlement_amount` | Σ 트랙배분 | 양수(첫 금액) |
| ② 회사 수수료 (N%) | `company_fee_amount` | `floor(gross×company_fee_ratio)` | **−**, muted (음수 첫째) |
| ③ 영업인 수수료 (N%) | `sales_agent_fee_amount` | `floor(gross×rate/100)` | **−**, muted (음수 둘째) |
| = 아티스트 net (이번 달) | `artist_net_settlement` | `greatest(gross−②−③,0)` | 중간 합계 |
| ④ 직전월 이월금 | `previous_carried_amount` | carryover-IN | `>0`이면 `+금액`, 아니면 `0` |
| 총 정산액 (이월 포함) | `total_settlement_amount` | `net+④` | **굵게** (중간 합계) |
| ⑤ 원천징수 (N.N%) | `withholding_tax_amount` | `floor(total×0.033)` | **−**, muted (meets_min일 때만 표기) |
| ⑥ 최종 지급액 | `final_payout_amount` | `greatest(total−⑤,0)` | **굵게 + accent(보라)** (최종 금액) |
| (기준미달 시) 경고박스 | `carried_over_amount` | `=total` | amber 경고 "총 정산액이 {min} 미만 → {carried} 다음 달 이월" |

- 상세 경고박스의 최소지급 기준은 **`data.policy.min_payout_amount`(동적)** 사용 → 현행 정책값을 정확히 반영. (목록의 하드코딩 "5만원"과 대비, §9.)
- 트랙별 상세 테이블: `raw`(=`raw_milestone_stream_count`), `제외`(=`excluded_stream_count`, 음수 표기), `eligible`(=`eligible_stream_count`, 정산 반영), `배분액`(=`pool_revenue_share`).
- PII 섹션: 실명/주민번호(존재 시 Reveal 버튼)/은행·예금주/계좌(Reveal)/원천징수 유형/정산정보 상태 배지. **원문은 별도 감사 로그가 남는 Reveal RPC로만 노출**.

---

## 3. 실제 계산식 (완전 복원 — 0348 권위 RPC 기준)

모든 반올림은 **`floor()` (버림, 원 단위)**. 금액 타입은 `bigint`(원 정수).

```
[원천 매출]
platform_revenue = Σ payment_orders.amount
                   WHERE status='paid' AND settlement_period_month = 정산월        (0348, X6.44)

[분배 풀]
pool_revenue = floor(platform_revenue × pool_revenue_ratio)                        (현행 0.50)

[유효 스트림]
total_streams = count(stream_events
                  WHERE event_type='milestone_30s' AND is_effective AND eligible_for_payout
                    AND created_at ∈ [KST 월초, KST 익월초)  join eligible_settlement_tracks)

[트랙별 배분]  (아티스트의 각 트랙 t)
track_amount(t) = (track_streams(t)=0 or total_streams=0) ? 0
                  : floor(pool_revenue × track_streams(t) / total_streams)
gross = Σ_t track_amount(t)

[공제]
company_fee = floor(gross × company_fee_ratio)                                     (현행 0.20)
agent_fee   = 영업인 있으면 floor(gross × commission_rate/100), 없으면 0
artist_net  = greatest(gross − company_fee − agent_fee, 0)

[이월/조정 반영]
prev_carried = Σ (직전월 이하 is_current 미지급행)  coalesce(nullif(carried_over_amount,0), total_settlement_amount, 0)
             + Σ (해당 월 미적용 adjustments.amount)     ← adjustment는 음수 가능
total = artist_net + prev_carried                                                  ← 0323 이후 음수 가능

[최소지급 판정]
if total < min_payout_amount            → meets_min=false                          (현행 10,000)
elsif min_payout_basis='gross'          → meets_min=true                           (현행 'gross')
else (basis='net')                      → meets_min = (total − floor(total×tax_ratio) ≥ min)

[세금/최종/이월]
if meets_min:
    withholding   = floor(total × withholding_tax_ratio)                           (현행 0.033)
    final_payout  = greatest(total − withholding, 0)
    carried_over  = 0
else:
    withholding   = 0
    final_payout  = 0
    carried_over  = total                                                          ← 음수면 음수 이월

[상태]
status = (PII ready 아니면) 'held'(held_reason='pii_incomplete') else 'pending'
```

계산식 메타:

| 항목 | 내용 |
|---|---|
| 계산 위치 | `admin_generate_monthly_settlement` (0348; 이전 0060→0079→0281→0313→0315→0323 누적, **0348가 최종**) |
| 입력 | `p_month`, `p_dry_run`, `settlement_policies`(활성), payment_orders, stream_events, eligible_settlement_tracks, artist_payout_accounts, sales_agents, settlement_adjustments |
| 출력 | `artist_settlements` 행(+`settlement_items`, `streaming_revenues`, `settlement_generation_runs`) + 요약 JSON |
| 반올림/절삭 | 전 구간 `floor` 버림. 트랙 배분 floor 합이 pool보다 작을 수 있어 **잔여 원은 플랫폼 귀속**(과지급 없음) |
| 원 단위 | `bigint` 정수 원. 소수점 없음 |
| 음수 허용 | `artist_net`/`final_payout`은 `greatest(,0)` 로 0 하한. **`total`/`carried_over`/`previous_carried`는 0323에서 CHECK 제거 → 음수 가능** |
| null 처리 | 정책 없음→예외. `carried_over_amount` null→`total_settlement_amount` fallback. 영업인 없음→fee 0 |
| 재계산 | `pending`/`held` 만 재생성(version+1, 이전 봉인). `payable`/`carried_over`/`paid`/`disputed`는 skip(불변) |
| version별 차이 | 산정 로직은 dry-run/실제/재생성 동일 단일 함수. version은 **동일 입력 시 값 동일**, 입력(스트림/정책/이월) 변화 시에만 달라짐 |

**정책 이력(append-only, UPDATE/DELETE 트리거 차단):**

| effective_from | pool | company | withholding | min_payout | basis |
|---|---|---|---|---|---|
| 2024-01-01 | 0.70 | 0.20 | 0.033 | 50,000 | gross |
| 2026-05-01 (0137) | **0.50** | 0.20 | 0.033 | 50,000 | gross |
| 2026-07-01 (0316) | 0.50 | 0.20 | 0.033 | **10,000** | gross |

→ 2026-05/06 정산은 50,000 기준, **2026-07~ 정산은 10,000 기준**. 정책은 정산월별 `effective_from<=월` 최신을 선택.

> **주의(원천징수 유형 불일치)**: 계산 RPC의 원천징수는 **정책 단일값(3.3%)** 고정. 그러나 `artist_payout_accounts.tax_withholding_type`은 `business_income_3_3`/`other_income_8_8`/`none` 3종을 저장하고 화면에도 표시한다. 즉 **8.8%·비원천 유형이 계좌에 설정돼 있어도 실제 계산은 3.3%로 수행**된다(트랙 코드상 per-artist 세율 미반영). §9 참조.

---

## 4. PII 미완료 처리 구조

### 4.1 PII 정의·판정 컬럼

정본 저장소 = **`artist_payout_accounts`**. "PII"는 아래 4요소 + 검증상태:

| 항목 | 컬럼 | 저장 |
|---|---|---|
| 실명 | `legal_name` | 평문 |
| 주민등록번호 | `rrn_encrypted` (bytea) | **pgp_sym_encrypt (Vault `payout_pii_key`)** |
| 계좌번호 | `account_number_encrypted` (bytea) | **암호화**. 평문 `account_number`는 마스킹값만 |
| 세금동의 | `tax_consent_at` (+text/ip/ua) | 평문 타임스탬프 |
| 계좌검증 | `verification_status` ∈ pending/verified/rejected | 평문 |

(별도 인테이크 저장소 `payout_intake_submissions`도 동일 PII+신분증 문서를 암호화 저장; 승인 시 계좌로 upsert.)

### 4.2 "PII 미완료" 배지 vs 지급 게이트 (2개의 서로 다른 조건)

**(a) 지급 게이트** = 정산 생성이 실제로 사용하는 조건 — `artist_payout_account_ready(user)` (0300):
```sql
exists(select 1 from artist_payout_accounts a
  where a.user_id=? and a.verification_status='verified'
    and a.legal_name is not null and a.rrn_encrypted is not null
    and a.account_number_encrypted is not null and a.tax_consent_at is not null)
```
→ **verified + 4요소 모두 존재** 여야 "ready". 아니면 생성 시 `status='held', held_reason='pii_incomplete'`.

**(b) 화면 배지** = `admin_settlement_list`(0348)의 `payout_account_status`:
```
pa.id is null                                                     → 'missing'   (계좌 미등록)
verification_status <> 'verified'                                 → 'pending'   (심사 대기)
rrn/account_number/legal_name/tax_consent 중 하나라도 null        → 'verified_partial' (PII 미완료)
else                                                              → 'ready'     (정산 가능)
```
→ **화면의 "PII 미완료" 배지 = `verified_partial`** (계좌는 verified인데 암호화 필드/동의 누락). 단, 지급 게이트 기준으로는 `missing`·`pending`·`verified_partial` **3종 모두 held(지급 불가)**. 즉 화면 배지(4상태)와 지급가능성(2상태: ready vs not)이 **1:1로 일치하지 않음** — 운영자가 "심사 대기/계좌 미등록"도 지급 불가임을 직관적으로 알기 어려움(§10).

### 4.3 PII 미완료의 영향

- **금액은 계산됨**: PII 미완료여도 gross~final 전 계산이 수행되고 행+items가 저장됨. PII는 **상태(held)만 결정**. → 금액 유실 없음, 지급만 차단.
- **이월**: held 정산은 다음 달 생성 시 union(`status in pending,held`)에 포함되어 **auto-merge로 이월**되거나, 관리자가 수동 이월 가능(0314). 즉 **PII 미완료 잔액은 사라지지 않고 누적**.
- **PII 완료 후 과거 이월금 지급**: 승인(`admin_approve_payout_intake`)/검증 시 계좌가 verified+완비 → 이후 생성분은 `pending`으로 나오고 finalize→payable→paid 가능. 이미 held로 누적된 이월금은 다음 정산에 합산되어 지급됨.
- **강제 지급 override**: `admin_mark_settlement_paid(p_force_pii=true)` 로 held+pii_incomplete 정산을 강제 지급 가능(감사 로그에 `force_pii=true` 기록, 화면에 빨간 override 토글). — 안전장치는 있으나 **오남용 시 미검증 계좌 지급 위험**.
- **보류 사유 기록**: `held_reason='pii_incomplete'` + audit `detail.held_reason_at_mark`. 명확히 추적 가능.
- 아티스트 노출(0388): `held` 정산은 아티스트 본인에게 금액과 함께 보임(`status<>'pending'`), `pending`만 숨김.

원문(코드 위치): 판정 `0300 artist_payout_account_ready`, 생성 게이트 `0348:181,288-293`, 배지 `0348:529-535`, 강제지급 `0348:740-745`.

---

## 5. 지급 가능/보류 판단 조건 (이월금 처리 포함)

### 5.1 지급 가능 여부

지급(`mark_paid`) 허용 조건(0318/0348 `admin_mark_settlement_paid`):
1. `is_super_admin()` 관리자, advisory lock + `FOR UPDATE`
2. `is_current=true` (봉인 version 불가)
3. status ∈ {pending, payable, held} (paid는 idempotent no-op, carried_over/disputed/그외 차단)
4. `merged_into_settlement_id is null` (이미 다음 달로 흡수된 행 불가)
5. `final_payout_amount > 0` (0원 지급 불가 — UI 버튼도 disable)
6. held+`pii_incomplete` 이면 `p_force_pii=true` 필수
→ 통과 시 `status='paid', paid_at, paid_by, payout_memo`, 이후 트리거로 **영구 immutable**.

### 5.2 이월 발생 조건 (요구 항목 대조)

| 조건 | 이월 여부 | 근거 |
|---|---|---|
| 최소지급 기준 미달 | **예(자동)** — `total<min` → `carried_over=total` | 0348:265-280 |
| PII 미완료 | **예(간접)** — held로 생성 → 다음 달 union 이월/수동 이월 | 0348:288, 0315 union |
| 계좌 미인증(verified 아님) | **예(간접)** — ready=false → held → 이월 | `artist_payout_account_ready` |
| 계좌정보 오류/누락 | **예(간접)** — verified_partial/missing → held → 이월 | 상동 |
| 지급 보류(수동 held) | 자동 이월은 아니나 다음 생성 시 union 포함되어 이월됨 + 수동 이월 가능 | 0315 union, 0314 |
| 지급 실패 | 별도 "failed" 상태 없음 — 미지급으로 남아 다음 생성 시 이월 | (상태값 부재) |
| 관리자 수동 보류 | 수동 이월(0314) 또는 다음 생성 union 이월 | 0314 |
| 회원 탈퇴 | 정산행은 `on delete restrict`(users FK) — 탈퇴 시 정산 있으면 삭제 제한. 잔액 처리 명시 로직 없음 | 0060 FK |
| 다음 달 레코드 없음(스트림 0) | **보존** — 미지급 보유자는 union으로 대상 포함 | 0315 union |
| 여러 달 연속 미지급 | 누적 — 모든 직전 미지급행 SUM, 소비 시 merged_into로 표시 | 0315 |
| 일부 지급 후 잔액 이월 | **불가** — 부분 지급 개념 없음(전액 paid 또는 전액 이월) | 설계상 |
| 지급 완료 후 재이월 | **차단** — paid는 union 제외 + immutable | 0348 union/trigger |
| 중복 이월 | **방지** — 소비행 `carryover_applied=true`, `merged_into` 세팅; 재생성 시 un-merge 후 재소비 | 0315/0348:169-179,336-354 |
| 원본-대상 추적 | 가능 — `merged_into_settlement_id`(자동), `carried_over_to_month`+audit(수동) | — |

### 5.3 이월 흐름 시각화

```
2026-05 미지급(pending/held/기준미달) 정산 (is_current)
        │  carryover_amount 또는 total_settlement_amount
        ▼  [자동] 다음 달 생성 시 union 소비        [수동] admin_carryover_settlement
2026-06 정산 생성
        │  previous_carried_amount = Σ 직전 미지급행 + adjustments
        │  소비된 5월행: status=carried_over, carryover_applied=true, merged_into=6월행
        ▼
total_6월 = artist_net_6월 + previous_carried
        │  total ≥ 10,000 ? → 원천징수 후 지급(payable→paid) : 전액 carried_over → 재이월
        ▼
2026-07 로 재이월 (또는 지급)
```

---

## 6. 월별 상태 전이

**상태값(실재)**: `pending`, `payable`, `carried_over`, `paid`, `held`, `disputed`.
(예시로 언급된 `draft/calculated/eligible/on_hold/approved/scheduled/failed/cancelled`는 **v1에 존재하지 않음**. `disputed`는 enum·`dispute_reason` 컬럼은 있으나 세팅 RPC 없음 — 차단 상태로만 사용.)

| 상태 | 사용자 표시 | 진입 조건 | 다음 상태 | 변경 주체 | 금액 영향 |
|---|---|---|---|---|---|
| pending | 대기(미확정) | 생성 시 PII ready | payable/carried_over/held/paid/carried_over(수동) | generate/finalize/admin | 계산 완료, 미확정 |
| held | 보류 | 생성 시 PII 미ready, 또는 수동 보류 | paid(force)/carried_over/(재생성) | generate/admin | 계산됨, 지급차단 |
| payable | 지급 대상 | finalize(meets_min) | paid/held/carried_over(수동) | admin | 지급 예정=final_payout |
| carried_over | 이월 | finalize(기준미달)/수동/auto-merge | (terminal, 다음 달 합산) | finalize/generate/admin | 다음 달로 이관 |
| paid | 지급 완료 | mark_paid | (terminal, immutable) | admin | 지급 확정, 이월 제외 |
| disputed | 분쟁 | (RPC 없음) | 차단상태 | — | 지급/이월 불가 |

```
[생성]
 pending ──finalize(≥min)──▶ payable ──mark_paid──▶ paid(immutable)
   │  │                         │  └─hold─▶ held
   │  └finalize(<min)─▶ carried_over ─(다음 달 합산)
   │
 (PII 미ready) ─▶ held ──force_pii mark_paid──▶ paid
                   └─수동 이월──▶ carried_over
 pending/held/payable ──수동 이월(admin_carryover)──▶ carried_over
 pending/held (미지급) ──다음 달 generate──▶ carried_over(merged_into=차기행)
```

---

## 7. 익명 집계 결과 (실행 예정 쿼리 — 프로덕션 미실행)

> 본 Phase 절대조건(프로덕션 데이터 변경 금지·PII 원문 금지) 준수를 위해 **집계 쿼리를 실행하지 않고 설계안만 제시**한다. 모두 개별 PII를 노출하지 않는 순수 COUNT/SUM 집계(읽기 전용). 승인 시 read-only로 실행 가능.

```sql
-- (7-A) 전체 현황 인원 (현재 활성 version, 특정 정산월 :m)
select
  count(*)                                                     as 총_정산대상자,
  count(*) filter (where status='payable')                    as 지급가능_인원,
  count(*) filter (where held_reason='pii_incomplete')        as PII미완료_인원,
  count(*) filter (where payout_account_id is null)           as 계좌미등록_인원,
  count(*) filter (where status='held')                       as 보류_인원,
  count(*) filter (where meets_min_payout=false)              as 최소지급미달_인원,
  count(*) filter (where status='paid')                       as 지급완료_인원,
  count(*) filter (where carried_over_amount<>0)              as 이월보유_인원,
  count(*) filter (where carried_over_amount<0)               as 음수이월_인원   -- 리스크 지표
from public.artist_settlements
where is_current and settlement_month = :m;

-- (7-B) 금액 현황
select
  sum(gross_settlement_amount)   as 총_발생액,
  sum(company_fee_amount+sales_agent_fee_amount) as 총_공제액,
  sum(withholding_tax_amount)    as 총_세금,
  sum(artist_net_settlement)     as 총_당월순정산,
  sum(previous_carried_amount)   as 총_이전이월금,
  sum(final_payout_amount)       as 총_최종지급예정,
  sum(final_payout_amount) filter (where status='paid') as 총_지급완료,
  sum(carried_over_amount)       as 총_다음달이월예정
from public.artist_settlements
where is_current and settlement_month = :m;

-- (7-C) 이월 기간 분포 (최초 발생월 추적: merged_into 체인 또는 최소 미지급월 기준)
-- 정확한 "최초 발생월"은 현행 스키마에 단일 컬럼이 없어(§9-이슈) audit_logs.from_month 체인 재구성 필요.
with open as (
  select artist_user_id, min(settlement_month) as first_unpaid
  from public.artist_settlements
  where is_current and status in ('carried_over','held','pending') and carried_over_amount<>0
  group by artist_user_id)
select
  count(*) filter (where age_months=1) as m1,
  count(*) filter (where age_months=2) as m2,
  count(*) filter (where age_months=3) as m3,
  count(*) filter (where age_months between 4 and 6) as m4_6,
  count(*) filter (where age_months>=7) as m7plus
from (select (extract(year from age(:m, first_unpaid))*12
             + extract(month from age(:m, first_unpaid)))::int as age_months from open) x;
```

**무결성 대조 쿼리(§9 검증용)도 함께 제시**:

```sql
-- (7-D) 무결성 위반 후보 (건수만)
select
  count(*) filter (where status='paid' and paid_at is null)                         as paid_but_no_paidat,
  count(*) filter (where paid_at is not null and coalesce(final_payout_amount,0)=0)  as paidat_but_zero,
  count(*) filter (where status='paid' and held_reason='pii_incomplete')            as paid_but_pii_incomplete,
  count(*) filter (where total_settlement_amount
                        <> artist_net_settlement + previous_carried_amount)         as total_identity_broken,
  count(*) filter (where meets_min_payout
                        and withholding_tax_amount
                            <> floor(total_settlement_amount*0.033))                as tax_mismatch,
  count(*) filter (where status='carried_over' and merged_into_settlement_id is null
                        and coalesce(is_manual_carryover,false)=false)              as carried_without_link
from public.artist_settlements where is_current;

-- (7-E) 월·아티스트 중복 활성 정산 (0 이어야 정상)
select settlement_month, artist_user_id, count(*)
from public.artist_settlements where is_current
group by 1,2 having count(*)>1;
```

---

## 8. 무결성 검사 결과 (정적 분석 기반)

핵심 항등식(코드상 성립해야 하는 관계):
```
total_settlement_amount = artist_net_settlement + previous_carried_amount
final_payout_amount     = meets_min ? greatest(total − floor(total×0.033), 0) : 0
carried_over_amount     = meets_min ? 0 : total
```

| 검사 항목 | 정적 판정 | 근거 |
|---|---|---|
| 화면 합계 vs DB 합계 | **일치** — 화면은 저장값 렌더(재계산 없음). 단 dry-run 모달 "5만원" 라벨은 하드코딩 | list/detail |
| 세금 중복 공제 | **조건부 위험** — 일반 경로는 1회. **수동 이월(payable)만 이중과세 경로** | 0314:64-65 + 0348:274 |
| 이월금 중복 합산 | **방지됨** — carryover_applied/merged_into + 재생성 un-merge | 0315/0348 |
| 지급 완료 재이월 | **방지됨** — paid는 union 제외 + immutable | 0348 |
| 마이너스 금액 | **가능** — 0323에서 total/carried/previous의 `>=0` CHECK 제거(음수 이월) | 0323 |
| 월별 중복 정산 | **방지됨** — 부분 unique `WHERE is_current` | 0348:60-62 |
| version 불일치 | **방지됨** — is_current 가드로 봉인행 finalize/pay 차단 | 0348 |
| paid인데 paid_at 없음 | **불가** — mark_paid가 동시 세팅 | 0348:749-756 |
| paid_at 있는데 0원 | **불가** — final>0 강제 | 0348:735 |
| PII 미완료인데 지급완료 | **가능(의도적)** — force_pii override(감사됨) | 0348:740-745 |
| 계좌 미인증인데 지급완료 | **가능(force_pii 경유)** — verified 아니면 held→force 필요 | 상동 |
| 이월 원본 없는 이월행 | 수동 이월은 원본=자기행(from_month audit), 자동은 merged_into. **원본 미링크 자동이월은 이상치** | (7-D) |
| 원본-대상 이월 금액 불일치 | 자동: 소비행 amount=`coalesce(nullif(carried,0),total)`가 previous에 합산 → 일치. 수동 payable: **세후금액 이관으로 의미 불일치** | §9 |
| 반올림 1원 오차 | floor 누적으로 트랙배분 합<pool 가능(플랫폼 귀속). 과지급 없음, 과소 가능 | 설계 |

---

## 9. 발견된 오류 및 위험 (우선순위)

**[H-1] 수동 이월 `payable` 이중 원천징수 (로직 위험 · High).**
`admin_carryover_settlement`(0314:64-65)는 `payable`을 이월할 때 `carried_over_amount = final_payout_amount`(**원천징수 후**)로 저장. 다음 달 생성(0348:238-240)이 이 값을 `previous_carried`에 합산하고 `total`에 대해 `floor(total×0.033)`을 **재차 원천징수** → 동일 금액에 3.3% 이중과세. `pending`/`held` 이월은 세전(total) 이관이라 정상. **payable 수동 이월 시에만 발생**.

**[H-2] 음수 이월 가능 (로직/데이터 위험 · High).**
0323이 `total_settlement_amount`/`carried_over_amount`/`previous_carried_amount`의 `>=0` CHECK를 제거. refund adjustment(음수)가 크면 `total<0` → `carried_over=total`(음수)로 다음 달 차감. 정당한 환불 상계 목적이나, **하한/한도 없음**이라 과도한 음수 이월·연쇄 차감 위험. 최종 지급은 `greatest(,0)`로 보호되나 이월 잔액 자체는 음수 누적 가능.

**[M-1] 최소지급 기준 표시 하드코딩 불일치 (표시 오류 · Medium).**
목록 생성 모달(`ArtistSettlementsList.tsx:497`)의 `"이월 (5만원 미만)"`, 아티스트 화면(`ArtistSettlementsPage.tsx:38`)의 `"5만원 미만 → 이월"`이 **하드코딩**. 현행 정책 min_payout=**10,000**(2026-07~)과 불일치 → 운영자/아티스트에게 잘못된 기준 안내. 상세 화면은 동적(`policy.min_payout_amount`)이라 정상.

**[M-2] 원천징수 유형 미반영 (로직/정합성 · Medium).**
`artist_payout_accounts.tax_withholding_type`에 `other_income_8_8`/`none`이 설정·표시되어도, 계산 RPC는 **정책 단일 3.3% 고정** 적용. 8.8% 대상 또는 비원천 대상 아티스트에게 세액 오산 위험.

**[M-3] force_pii 강제 지급 (통제 위험 · Medium).**
미검증 계좌 held 정산을 `p_force_pii=true`로 지급 가능. 감사 로그는 남지만 **2차 승인/사유 강제 없음** → 오지급/규정위반 여지.

**[L-1] 배지 상태 ↔ 지급가능성 비일치 (UX · Low).** `missing/pending/verified_partial` 모두 지급 불가지만 배지는 4상태로 분산 → 운영자 오해 여지(§10).

**[L-2] 이월 최초 발생월 추적 부재 (관측성 · Low).** 단일 "origin_month" 컬럼 없음. audit `from_month` 체인으로만 재구성 → 상세 화면에 노출 안 됨.

**[L-3] pending 상태의 조용한 흡수 (운영 위험 · Low).** finalize 안 한 `pending`(기준 충족 잠재 payable 포함)은 다음 달 생성 시 union으로 **자동 흡수(carried_over)**됨. 운영자가 finalize 전에 차월 생성하면 의도치 않게 이월될 수 있음(금액 유실은 아님).

---

## 10. UI 개선안 (현행 화면 문제)

| 기준 | 현행 | 문제 |
|---|---|---|
| 이월금 한눈 파악 | 8번 컬럼(주황 +) | 신규/누적 이월이 한 값(`previous_carried`)으로만 노출, 최초월·구성 미표시 |
| 신규 vs 누적 구분 | 당월정산 / 이월금 분리됨 | 비교적 양호하나 "총 정산=당월+이월" 관계가 헤더만으로 불명확 |
| 세전/세후 구분 | 총정산(세전)/최종(세후) | 원천징수 컬럼이 `—`(0)와 null 혼동 |
| 지급예정 vs 완료 | 최종지급 컬럼 + 상태배지 | `final_payout`이 예정/완료 공용 → paid 후에도 동일 컬럼, 잔여미지급 컬럼 없음 |
| 지급 불가 이유 | 배지(missing/pending/verified_partial/held) | 4~5개 신호 분산, "왜 지급 못하나"가 한 컬럼에 없음 |
| "PII 미완료" 용어 | verified_partial 라벨 | 비직관적("주민번호/계좌 미등록"이 명확) |
| 배지 ↔ 실제 지급상태 | 불일치 | pending/missing도 사실상 지급불가인데 별도 신호 |
| 헤더만으로 계산흐름 | gross/수수료/당월/이월/총/원천/최종 | 부호·순서는 좋으나 "= / −" 기호 미표기(상세엔 있음) |
| 월별 이력 추적 | 상세의 version 이력만 | 한 회원의 월별 정산 타임라인 화면 부재 |
| 이월 최초월 | 없음 | origin month 미표시 |
| 부분지급/잔여 | 없음 | 전액 paid/이월만 — 잔여 미지급 컬럼 없음 |
| 중복지급 위험 | 상태·final=0 disable·immutable | 안전장치는 강함. 다만 force_pii 오지급 여지 |

**개선 설계(코드 변경 없이 제안)** — 목록 컬럼안: 회원/정산월/**신규발생액**/플랫폼공제/세금/**당월순정산**/**이전이월금(최초월 tooltip)**/**총지급대상액**/**지급완료액**/**잔여미지급액**/**다음달이월액**/지급가능여부(단일 사유칩)/PII상태/계좌상태/지급상태/지급일. 상세: ①금액요약(당월신규 −공제 −세금 =당월순 +이월 =총대상 −완료 =잔여) ②이월금 추적표(발생월·원금·지급·이월·상태) ③지급차단 사유(주민번호/계좌/기준미달/보류/실패 체크리스트).

---

## 11. DB 변경 필요 여부 (다음 Phase, 미실행)

| 항목 | 필요성 | 성격 |
|---|---|---|
| H-1 이중과세 | 이월 원금 규약 통일(항상 세전 이관) 또는 "이미 과세됨" 플래그 컬럼 | **로직 수정 + (선택)컬럼 추가** |
| H-2 음수 이월 | 음수 상한/정책 + (선택)CHECK 재도입 또는 상계 전용 컬럼 | 로직/제약 |
| L-2 최초 발생월 | `carryover_origin_month` 컬럼(옵션) | 스키마 추가(비파괴) |
| M-2 세율 | per-artist 세율 반영은 계산 RPC 변경(스키마는 이미 존재) | RPC 로직 |
| 잔여미지급/부분지급 | 부분지급 도입 시 컬럼·상태 확장 | 스키마+로직(대규모) |

> 위 변경은 모두 **다음 Phase 대상**. 본 Phase에서 실행/적용하지 않음.

---

## 12. 코드 변경 필요 여부

- **표시 버그(M-1)**: 프론트 하드코딩 문자열 2곳을 동적 정책값으로 교체 — 저위험, 우선.
- **세율(M-2)/이중과세(H-1)/음수이월(H-2)**: DB RPC(`admin_generate_monthly_settlement`, `admin_carryover_settlement`) 로직 검토 — 고위험, 회귀 테스트 필수.
- **UI 개선(§10)**: 컬럼 재구성·사유칩·이월추적 섹션 — 중위험, 데이터 무변경.
- 본 Phase: **코드 변경 없음**.

---

## 13. 수정 대상 파일 (다음 Phase 후보 — 이번 Phase 미수정)

| 파일 | 사유 |
|---|---|
| `src/components/admin/ArtistSettlementsList.tsx` | "5만원" 하드코딩(M-1), 컬럼 재구성(§10), 사유칩 |
| `src/pages/ArtistSettlementsPage.tsx` | "5만원 미만" 하드코딩(M-1) |
| `src/components/admin/ArtistSettlementDetail.tsx` | 이월 추적/잔여미지급/지급차단 체크리스트 섹션 |
| `src/components/admin/CarryoverModal.tsx` | payable 세후 이월 안내/이중과세 방지 규약 |
| `src/lib/artistSettlementApi.ts` | 신규 필드(잔여/최초월) 타입 |
| `supabase/migrations/*` (신규) | `admin_generate_monthly_settlement`/`admin_carryover_settlement` 로직 보정, (선택)스키마 |

---

## 14. 다음 Phase 권장 범위 (우선순위)

1. **P0 표시 정합성(M-1)** — 최소지급 기준 하드코딩 제거(동적 정책값). 저위험 즉시.
2. **P0 이중과세 검증·보정(H-1)** — payable 수동 이월의 세후 이관 규약 재정의(세전 통일 or 과세완료 플래그). 실데이터 재현 + 무결성 쿼리(7-D) 선검증.
3. **P1 음수 이월 가드(H-2)** — 상계 정책·상한, 관측 대시보드.
4. **P1 세율 반영(M-2)** — per-artist 원천징수 유형 계산 반영.
5. **P1 force_pii 통제(M-3)** — 2차 승인/사유 필수화.
6. **P2 UI 개편(§10)** — 잔여미지급·이월추적·단일 사유칩·월별 타임라인.
7. **관측**: 매 정산월 (7-D)/(7-E) 무결성 쿼리 정기 실행(read-only).

---

## 15. 최종 판정

### `SAFE WITH UI IMPROVEMENT`  *(조건부: 수동 이월/adjustment 운영 흐름에 한해 `REQUIRES LOGIC FIX`)*

- **근거(SAFE 측면)**: 계산은 결정적·감사 가능. 버전 봉인, 지급 immutability, advisory lock, append-only 감사, PII 암호화/마스킹/Reveal 감사, 이월 소비 추적, 월·아티스트 활성 유일성 등 핵심 안전장치 성숙. 화면-DB 표시 일치도 높음. 즉시 지급 중단 수준 CRITICAL 미발견.
- **근거(개선 필요)**: 최소지급 기준 표시 하드코딩 불일치(M-1), 배지-지급가능성 비일치·이월 관측성 부족 등 **운영자 오지급 유발 가능한 UI/UX 결함**.
- **조건부 LOGIC FIX**: **payable 수동 이월 이중 원천징수(H-1)**, **음수 이월 무한계(H-2)**, **세율 미반영(M-2)** 은 해당 운영 경로 사용 시 금액 오류를 낳으므로 다음 Phase에서 **실데이터 무결성 대조 후 로직 보정** 권장. 자동 정산·정상 지급 경로만 사용하는 한 현 시스템은 안전 운용 가능.

> 본 판정은 정적 코드/스키마 분석 기반이며, §7 익명 집계 쿼리를 read-only로 실행해 실데이터 무결성(특히 7-D/7-E, 음수 이월·이중과세 실제 발생 건수)을 확인하면 판정을 `SAFE WITH UI IMPROVEMENT`로 확정 또는 `REQUIRES DATA RECONCILIATION`로 상향할 수 있다. 현재 미실행이므로 실데이터 위험은 **INSUFFICIENT EVIDENCE**로 병기.
</content>
</invoke>
