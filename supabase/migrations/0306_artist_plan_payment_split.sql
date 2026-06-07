-- 0306 — 아티스트 플랜별 결제 금액 분기 (X6.22)
--
-- 정책:
--   general_artist  → artist_general (6,900원)
--   student_artist  → artist_student (4,900원)
--   legacy NULL     → individual     (4,900원, 기존 유지)
--   business        → 매장 전용 (영향 없음)
--
-- 변경 사항:
--   A. subscription_plans 에 artist_general / artist_student 추가
--   B. get_my_artist_plan RPC 에 monthly_price + payment_plan_type 추가
--      (프론트가 결제 호출 시 plan_type 분기 단일 진입점)
--
-- 안전: 기존 subscription/payment 데이터 무변경. legacy individual=4900 유지.

-- ===== A. subscription_plans CHECK + 신규 plan_type 추가 =====
alter table public.subscription_plans
  drop constraint if exists subscription_plans_plan_type_check;
alter table public.subscription_plans
  add constraint subscription_plans_plan_type_check
  check (plan_type = any (array[
    'individual'::text, 'business'::text,
    'artist_general'::text, 'artist_student'::text
  ]));

insert into public.subscription_plans (plan_type, name, price, billing_cycle, is_active)
values
  ('artist_general', '듣다 아티스트 (일반)', 6900, 'monthly', true),
  ('artist_student', '듣다 아티스트 PRO (수강생)', 4900, 'monthly', true)
on conflict (plan_type) do update set
  name = excluded.name,
  price = excluded.price,
  is_active = excluded.is_active;

-- ===== B. get_my_artist_plan 확장 — monthly_price + payment_plan_type =====
-- 기존 7개 컬럼에 2개 추가. 호출처 (artistPlanApi.ts) 도 동일하게 갱신 필요.
drop function if exists public.get_my_artist_plan();

create or replace function public.get_my_artist_plan()
returns table(
  plan_type text,
  plan_label text,
  monthly_quota integer,
  can_create_playlist boolean,
  can_apply_curator boolean,
  is_verified_pro boolean,
  is_legacy boolean,
  -- X6.22 신규
  monthly_price integer,
  payment_plan_type text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select u.plan_type into v_plan from public.users u where u.id = v_uid;

  return query select
    v_plan as plan_type,
    case coalesce(v_plan, 'legacy')
      when 'general_artist'  then '일반 아티스트'
      when 'student_artist'  then '수강생 아티스트 PRO'
      when 'admin'           then '관리자'
      when 'legacy_student'  then '기존 아티스트'
      else                        '기존 아티스트'
    end as plan_label,
    public._plan_monthly_quota(v_plan) as monthly_quota,
    case when v_plan = 'general_artist' then false else true end as can_create_playlist,
    case when v_plan = 'general_artist' then false else true end as can_apply_curator,
    case when v_plan = 'student_artist' then true else false end as is_verified_pro,
    (v_plan is null or v_plan = 'legacy_student') as is_legacy,
    -- ✅ 결제 금액 단일 진입점 (subscription_plans 와 동기화)
    case coalesce(v_plan, 'legacy')
      when 'general_artist'  then 6900
      when 'student_artist'  then 4900
      when 'admin'           then 0
      when 'legacy_student'  then 4900
      else                        4900   -- NULL legacy → 4900
    end as monthly_price,
    case coalesce(v_plan, 'legacy')
      when 'general_artist'  then 'artist_general'
      when 'student_artist'  then 'artist_student'
      when 'legacy_student'  then 'individual'
      else                        'individual'
    end as payment_plan_type;
end; $$;

revoke all on function public.get_my_artist_plan() from public, anon;
grant execute on function public.get_my_artist_plan() to authenticated, service_role;
