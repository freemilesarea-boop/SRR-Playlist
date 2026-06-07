-- 0317 — 기존 5월/6월 정산 중복 보정 (X6.28)
--
-- 대상:
--   동일 아티스트가 2026-05 (pending) + 2026-06 (held/pending) 으로 동시에
--   존재하는 7건. 6월 row 가 5월 미지급 금액을 흡수하지 못함.
--
-- 보정 방식:
--   for 각 아티스트:
--     1) 6월 row 의 previous_carried_amount = 5월 total_settlement_amount
--     2) 6월 row 의 total_settlement_amount = 기존 + previous_carried
--     3) 6월 row 의 carried_over_amount/final_payout/meets_min/withholding 재계산
--     4) 5월 row → status='carried_over', merged_into_settlement_id=<6월 id>,
--        carryover_applied=true, carried_over_to_month='2026-06-01',
--        pre_merge_status='pending', auto_merged_at=now()
--     5) settlement_admin_audit_logs 에 'manual_carryover' 기록
--
-- 트리거 우회:
--   6월 row 의 previous_carried/total/final/carry/withholding/meets_min 변경은
--   _artist_settlements_protect 가 status != 'pending' 일 때 차단. 이 보정
--   1회성이라 미그레이션 트랜잭션 동안 트리거 임시 비활성. 보정 후 즉시 복구.

-- 트리거 임시 비활성 (이 마이그레이션 트랜잭션 전용)
alter table public.artist_settlements disable trigger trg_artist_settlements_protect;

with may_unpaid as (
  select id as may_id, artist_user_id,
         total_settlement_amount as may_total,
         status as may_status
  from public.artist_settlements
  where settlement_month = '2026-05-01' and status in ('pending','held')
),
jun_target as (
  select s.id as jun_id, s.artist_user_id,
         s.total_settlement_amount as jun_current_total,
         s.artist_net_settlement as jun_net,
         s.previous_carried_amount as jun_prev_carried,
         s.status as jun_status,
         p.min_payout_amount, p.min_payout_basis, p.withholding_tax_ratio
  from public.artist_settlements s
  join public.settlement_policies p on p.id = s.policy_id
  where s.settlement_month = '2026-06-01'
),
pairs as (
  select m.may_id, m.artist_user_id, m.may_total, m.may_status,
         j.jun_id, j.jun_net,
         j.min_payout_amount, j.min_payout_basis, j.withholding_tax_ratio
  from may_unpaid m
  join jun_target j on j.artist_user_id = m.artist_user_id
),
recalc as (
  select *,
         (jun_net + may_total) as new_total,
         case
           when min_payout_basis = 'gross' then ((jun_net + may_total) >= min_payout_amount)
           else ((jun_net + may_total) - floor((jun_net + may_total) * withholding_tax_ratio)) >= min_payout_amount
         end as new_meets_min
  from pairs
),
final_calc as (
  select *,
         case when new_meets_min then floor(new_total * withholding_tax_ratio)::bigint else 0 end as new_withholding,
         case when new_meets_min then (new_total - floor(new_total * withholding_tax_ratio))::bigint else 0 end as new_final_payout,
         case when new_meets_min then 0 else new_total end as new_carried_over
  from recalc
)
-- 1) 6월 row 업데이트
update public.artist_settlements as s
set previous_carried_amount = fc.may_total,
    total_settlement_amount = fc.new_total,
    meets_min_payout = fc.new_meets_min,
    withholding_tax_amount = fc.new_withholding,
    final_payout_amount = fc.new_final_payout,
    carried_over_amount = fc.new_carried_over,
    updated_at = now()
from final_calc fc
where s.id = fc.jun_id;

-- 2) 5월 row 들을 merged_into 6월 row 로 표시
with pairs as (
  select m.id as may_id, m.status as may_status, j.id as jun_id,
         m.total_settlement_amount as may_total
  from public.artist_settlements m
  join public.artist_settlements j on j.artist_user_id = m.artist_user_id
  where m.settlement_month = '2026-05-01' and m.status in ('pending','held')
    and j.settlement_month = '2026-06-01'
)
update public.artist_settlements as s
set status = 'carried_over',
    pre_merge_status = pairs.may_status,
    is_manual_carryover = false,
    carryover_applied = true,
    merged_into_settlement_id = pairs.jun_id,
    carried_over_amount = coalesce(nullif(s.carried_over_amount, 0), pairs.may_total, 0),
    carried_over_to_month = '2026-06-01',
    carried_over_at = coalesce(s.carried_over_at, now()),
    auto_merged_at = now(),
    held_reason = 'auto_merged_into_2026-06',
    updated_at = now()
from pairs
where s.id = pairs.may_id;

-- 3) audit log 기록
insert into public.settlement_admin_audit_logs (
  settlement_id, artist_id, action, amount, from_month, to_month,
  admin_user_id, reason, detail
)
select m.id, m.artist_user_id, 'manual_carryover',
       coalesce(nullif(m.carried_over_amount, 0), m.total_settlement_amount, 0),
       '2026-05-01', '2026-06-01',
       null,
       'X6.28 data correction migration — 5월 미흡수 정산 6월로 일괄 이월',
       jsonb_build_object(
         'migration', '0317',
         'merged_into_settlement_id', m.merged_into_settlement_id,
         'pre_merge_status', m.pre_merge_status
       )
from public.artist_settlements m
where m.settlement_month = '2026-05-01'
  and m.auto_merged_at is not null
  and m.merged_into_settlement_id is not null
  and not exists (
    select 1 from public.settlement_admin_audit_logs al
    where al.settlement_id = m.id and al.action = 'manual_carryover'
  );

-- 트리거 복구
alter table public.artist_settlements enable trigger trg_artist_settlements_protect;
