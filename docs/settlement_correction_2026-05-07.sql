-- ============================================================================
-- 정산 조정 스크립트 — 2026-05 ~ 2026-07 재청구 매출 과소집계 보정
--
-- 배경: PayApp 정기 재청구는 정상 작동했으나, 재청구 dispatcher 미가동으로
--   재청구 사이클이 payment_orders에 paid로 기록되지 않아(마이그레이션 0472로 백필 완료),
--   그 사이 생성된 5·6·7월 아티스트 정산의 매출 pool이 과소 계산됨.
--   정산/정산매출 테이블은 불변(immutable) 보호가 걸려 소급 재계산이 불가하므로,
--   시스템 정식 경로인 settlement_adjustments(정산 조정 원장)로 보정한다.
--
-- 방식: 아티스트별 (보정 pool 기준 net) − (기존 net) = 추가 지급 delta 를 계산하여
--   apply_to_month = 2026-08-01(다음 정산월) 로 등록(applied=false). 다음 정산 생성 시
--   admin_generate_monthly_settlement 이 자동으로 읽어 해당 아티스트 정산에 가산한다.
--
-- ⚠️ 실행 전 반드시 확인 (회계):
--   1) 아래 pool_map(월별 기존/보정 pool)이 현재 실제 매출과 일치하는지:
--        보정 pool = floor( (해당월 settlement_period_month paid 합계) * 0.5 )
--   2) 기존 5·6·7월 정산(과소집계분)이 이월체인으로 흘러가 이 조정(delta)과 합산되어야
--      최종 정확 금액이 됨. 기존 정산이 '잘못된 금액으로 먼저 지급'되지 않도록 순서 확인.
--   3) settlement_adjustments 는 DELETE 불가(불변 감사원장). 넣기 전 (STEP 1) 미리보기로 검증.
--   4) apply_to_month(2026-08-01) 가 다음에 생성할 정산월과 일치하는지.
--   5) created_by 를 실행 관리자 UUID 로 채울 것(선택; nullable).
-- ============================================================================

-- 공통 계산 CTE (STEP 1 미리보기 / STEP 2 등록 모두 이 로직 사용)
--   corrected_gross = round(old_gross * 보정pool / 기존pool)   -- 스트림 고정, pool 비례
--   corrected_net   = corrected_gross - 회사수수료(20%) - 영업수당(rate%)
--   delta           = corrected_net - old_net
--   pool ratio 0.5, company_fee 0.2 는 해당 기간 정산정책 값.

-- ---------------------------------------------------------------------------
-- STEP 1) 미리보기 — 반드시 먼저 실행해서 금액/대상 확인 (읽기 전용)
-- ---------------------------------------------------------------------------
with pool_map(smonth, old_pool, corrected_pool) as (
  values ('2026-05-01'::date, 90650::numeric, 151900::numeric),
         ('2026-06-01'::date,  4900::numeric, 103900::numeric),
         ('2026-07-01'::date, 81850::numeric, 167600::numeric)
),
delta as (
  select s.artist_user_id,
         greatest(
           round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool)
           - floor(round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool) * 0.20)
           - floor(round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool) * coalesce(s.sales_agent_commission_rate,0) / 100.0)
           - s.artist_net_settlement, 0)::bigint as month_delta
  from public.artist_settlements s
  join pool_map pm on pm.smonth = s.settlement_month
  where s.settlement_month in ('2026-05-01','2026-06-01','2026-07-01')
)
select artist_user_id, sum(month_delta) as adjustment_amount
from delta
group by artist_user_id
having sum(month_delta) > 0
order by adjustment_amount desc;
-- 기대: 34행, 합계 173,341원. 값이 다르면 pool_map을 실제 매출로 갱신 후 재확인.


-- ---------------------------------------------------------------------------
-- STEP 2) 등록 — STEP 1 검증 후에만 실행 (settlement_adjustments 는 삭제 불가!)
--   중복 방지: 동일 (artist, apply_to_month, reason) 이 있으면 건너뜀.
-- ---------------------------------------------------------------------------
with pool_map(smonth, old_pool, corrected_pool) as (
  values ('2026-05-01'::date, 90650::numeric, 151900::numeric),
         ('2026-06-01'::date,  4900::numeric, 103900::numeric),
         ('2026-07-01'::date, 81850::numeric, 167600::numeric)
),
delta as (
  select s.artist_user_id,
         greatest(
           round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool)
           - floor(round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool) * 0.20)
           - floor(round(s.gross_settlement_amount * pm.corrected_pool / pm.old_pool) * coalesce(s.sales_agent_commission_rate,0) / 100.0)
           - s.artist_net_settlement, 0)::bigint as month_delta
  from public.artist_settlements s
  join pool_map pm on pm.smonth = s.settlement_month
  where s.settlement_month in ('2026-05-01','2026-06-01','2026-07-01')
),
per_artist as (
  select artist_user_id, sum(month_delta) as adjustment_amount
  from delta group by artist_user_id having sum(month_delta) > 0
)
insert into public.settlement_adjustments
  (id, artist_user_id, apply_to_month, amount, reason, applied, created_by, created_at)
select
  gen_random_uuid(),
  pa.artist_user_id,
  '2026-08-01'::date,
  pa.adjustment_amount,
  'revenue backfill 0472: recurring-payment under-count 2026-05~07 (pool recomputed, net delta)',
  false,
  null,                       -- TODO(회계): 실행 관리자 UUID 로 교체 가능
  now()
from per_artist pa
where not exists (
  select 1 from public.settlement_adjustments a
  where a.artist_user_id = pa.artist_user_id
    and a.apply_to_month = '2026-08-01'::date
    and a.reason = 'revenue backfill 0472: recurring-payment under-count 2026-05~07 (pool recomputed, net delta)'
);
-- 기대: 34행 INSERT. 다음 2026-08 정산 생성 시 자동 반영(applied=false → 소비되면 true).
