-- 0094 — 브랜딩 교체: subscription_plans.name 'SRR Playlist' → '듣다'
--
-- SubscriptionPage 결제 카드 / 결제 요약은 DB 의 subscription_plans.name 을 그대로 노출.
-- 0026 에서 seed 한 "SRR Playlist 정기이용권" 류 텍스트를 사용자에게 보이는
-- 새 브랜드 "듣다" 로 갱신.
--
-- ⚠ 마이그레이션 history (0026 등) 는 건드리지 않고, 데이터만 UPDATE 한다.
-- ⚠ plan_type / price 등 비즈니스 필드는 변경 없음.

update public.subscription_plans
  set name = '듣다 정기이용권'
  where plan_type = 'individual'
    and name in ('SRR Playlist 정기이용권', 'SWK monthly subscription');

update public.subscription_plans
  set name = '듣다 사업자 정기이용권'
  where plan_type = 'business'
    and name in ('SRR Playlist 사업자 정기이용권', 'SWK business subscription');

-- 결과 확인용 noop (마이그레이션 로그에 남기기 위해 RAISE NOTICE)
do $$
declare
  v_ind text;
  v_biz text;
begin
  select name into v_ind from public.subscription_plans where plan_type = 'individual';
  select name into v_biz from public.subscription_plans where plan_type = 'business';
  raise notice '[0094 rebrand] individual.name = %', v_ind;
  raise notice '[0094 rebrand] business.name = %', v_biz;
end$$;
