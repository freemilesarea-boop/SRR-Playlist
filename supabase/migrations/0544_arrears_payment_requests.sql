-- 연체분 회수: 회차별 개별 결제요청(payrequest) 으로 받는다.
--
-- 배경: PayApp 에는 등록된 rebill_no 에 임의 시점·임의 금액으로 결제를 일으키는
-- API 가 없다(0543 참고). 밀린 회차를 받으려면 회차마다 결제요청을 만들어
-- 결제링크를 보내고 회원이 직접 결제하는 수밖에 없다.
--
-- 정기결제(rebill) 와 다른 점:
--   - 카드 등록(rebill_no) 이 필요 없다 → 카드 미등록 회원도 대상이다.
--   - 수신 휴대폰번호가 필수다 → 번호가 없거나 형식이 깨지면 보낼 수 없다.
--   - 금액은 구독 계약가를 쓴다(0541 과 동일 원칙).
--
-- 적용 기록: 원격에 arrears_payment_requests 로 적용 완료.

create table if not exists public.arrears_payment_requests (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- 어느 회차에 대한 청구인지. (구독, 회차) 로 중복 발송을 막는다.
  cycle_period_end timestamptz not null,
  -- 'YYYY-MM' (KST). 상품명 "듣다 N월 이용료" 의 근거.
  cycle_month text not null,
  amount integer not null,
  goodname text not null,
  -- payment_orders.order_no 와 같은 값. PayApp var1 로 실어 기존 결제 파이프라인을 탄다.
  order_no text not null unique,
  payapp_mul_no text,
  payurl text,
  -- requested: 링크 생성됨 / failed: PayApp 이 거절 / sent: 회원에게 전달함
  status text not null default 'requested',
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (subscription_id, cycle_period_end)
);

create index if not exists idx_arrears_requests_user
  on public.arrears_payment_requests (user_id, cycle_period_end);
create index if not exists idx_arrears_requests_status
  on public.arrears_payment_requests (status, created_at desc);

alter table public.arrears_payment_requests enable row level security;
revoke all on public.arrears_payment_requests from anon, authenticated;

-- 휴대폰번호 정규화. PayApp 은 01012345678 형태를 기대한다.
-- 국가번호(82)가 붙었거나 앞의 0 이 빠진 값이 실제로 섞여 있다.
create or replace function public._normalize_kr_mobile(p_raw text)
returns text
language sql
immutable
as $function$
  with d as (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as p)
  select case
    when p ~ '^01[016789][0-9]{7,8}$' then p
    when p ~ '^8201[016789][0-9]{7,8}$' then substr(p, 3)
    when p ~ '^821[016789][0-9]{7,8}$'  then '0' || substr(p, 3)
    when p ~ '^1[016789][0-9]{7,8}$'    then '0' || p
    else null
  end
  from d;
$function$;

-- 아직 받지 못한 회차 목록. 0543 으로 막은 rebill 경로와 달리 여기서는
-- rebill_no 유무를 따지지 않는다 — 결제링크는 카드 등록과 무관하다.
create or replace function public.admin_list_arrears_cycles(p_max_cycles integer default 6)
returns table(
  subscription_id uuid, user_id uuid, plan_type text, amount integer,
  cycle_period_end timestamptz, cycle_month text, cycle_index integer, cycles_owed integer,
  recvphone text, eligible boolean, exclude_reason text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_max integer := least(greatest(coalesce(p_max_cycles, 6), 1), 24);
  v_demo uuid[] := array[
    'de700001-0000-0000-0000-000000000001',
    'de700002-0000-0000-0000-000000000001',
    'de700002-0000-0000-0000-000000000002',
    'de700002-0000-0000-0000-000000000003'
  ]::uuid[];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  return query
  with pool as (
    select s.id, s.user_id, s.plan_type, s.cancel_requested_at,
           s.current_period_end as period_end,
           coalesce(s.current_amount, s.price) as sub_amount,
           sp.price as plan_price, u.role, u.membership_tier,
           public._normalize_kr_mobile(coalesce(nullif(btrim(u.phone), ''), ap.phone)) as phone
    from public.subscriptions s
    join public.users u on u.id = s.user_id
    left join public.subscription_plans sp on sp.plan_type = s.plan_type
    left join public.artist_profiles ap on ap.user_id = s.user_id
    where s.status = 'active'
      and s.auto_renew = true
      and s.current_period_end is not null
      and s.current_period_end < v_now
  ),
  judged as (
    select p.*,
      case
        when p.user_id = any(v_demo)                            then 'demo_account_excluded'
        when p.role = 'admin'                                   then 'admin_account'
        when p.cancel_requested_at is not null                  then 'cancel_requested'
        when p.membership_tier not in ('individual','business') then 'non_chargeable_tier'
        when p.sub_amount is null or p.sub_amount <= 0          then 'invalid_amount'
        -- 정가 초과는 사람이 확인해야 한다(0541 과 같은 기준).
        when p.plan_price is not null and p.sub_amount > p.plan_price then 'amount_above_list'
        when p.phone is null                                    then 'invalid_phone'
        else null
      end as excl
    from pool p
  ),
  expanded as (
    select j.*, k.k as idx, (j.period_end + make_interval(months => k.k)) as cyc_end
    from judged j
    cross join lateral generate_series(0, v_max - 1) as k(k)
    where j.period_end + make_interval(months => k.k) < v_now
  ),
  marked as (
    select e.*,
      -- 이미 결제요청을 보낸 회차는 다시 만들지 않는다.
      exists (select 1 from public.arrears_payment_requests a
               where a.subscription_id = e.id and a.cycle_period_end = e.cyc_end
                 and a.status <> 'failed') as already_requested
    from expanded e
  )
  select
    m.id, m.user_id, m.plan_type, m.sub_amount::int,
    m.cyc_end,
    to_char(m.cyc_end at time zone 'Asia/Seoul', 'YYYY-MM'),
    (m.idx + 1)::int,
    (count(*) over (partition by m.id))::int,
    m.phone,
    (m.excl is null and not m.already_requested),
    coalesce(m.excl, case when m.already_requested then 'already_requested' else 'due' end)
  from marked m
  order by m.id, m.idx;
end;
$function$;
