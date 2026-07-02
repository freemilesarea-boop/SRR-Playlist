-- 0397 — 정기결제 자동 재청구(rebillPay) 인프라
--
-- 배경 (운영 진단, 추측 아님):
--   구독 등록 시 create-payapp-subscription 이 PayApp rebillRegist 로 정기결제 빌링키
--   (subscriptions.payapp_rebill_no)를 저장하지만, 이후 "그 키로 실제 재청구(rebillPay)"
--   를 호출하는 코드/스케줄러가 전무했음. 결과:
--     - 만료 도래 구독이 자동 재청구되지 않고 랩스(등급은 유지되나 결제는 안 됨).
--     - renewal payment_orders 0건, 재청구 웹훅 0건(대상 사용자 기준).
--   → 매월 만료 도래 구독을 rebillPay 로 자동 청구하는 실행 레이어가 필요.
--
-- 본 migration 이 추가하는 것 (전부 additive):
--   1) subscription_rebill_charges — 재청구 시도/결과 원장 (cycle 단위 중복청구 차단).
--   2) admin_list_rebill_due_subscriptions(p_grace_days) — 재청구 대상 조회 RPC.
--   3) record_rebill_charge_attempt(...) — cycle 단위 멱등 예약(insert-or-skip) RPC.
--   4) mark_rebill_charge_result(...) — PayApp 응답 반영 RPC.
--
-- 실제 청구는 edge function dispatch-subscription-rebill 이 위 RPC + PayApp rebillPay 를
-- 호출하고, 결제 확정은 기존 payapp-feedback 웹훅(state=64)이 처리(기간연장/등급유지).
--
-- 절대 무수정:
--   - 결제/정산/재생/정책 계산 로직, 기존 payapp RPC/웹훅/구독 상태머신 무수정.
--   - subscriptions/payment_orders/users 스키마 무변경(원장 테이블만 신규).

-- ============================================================
-- 1) 재청구 원장 (cycle 단위 멱등)
-- ============================================================
create table if not exists public.subscription_rebill_charges (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid not null references public.subscriptions(id) on delete cascade,
  user_id           uuid not null,
  rebill_no         text not null,
  order_no          text,
  amount            integer not null check (amount >= 0),
  plan_type         text,
  -- 재청구 대상 "주기 키" = 갱신하려는 기존 current_period_end (날짜). 같은 주기 중복청구 차단.
  cycle_period_end  timestamptz not null,
  status            text not null default 'attempted'
                      check (status in ('attempted','accepted','paid','failed')),
  payapp_state      text,
  payapp_raw        jsonb,
  error_message     text,
  requested_at      timestamptz not null default now(),
  resolved_at       timestamptz
);

-- 같은 구독의 같은 주기(cycle_period_end)에 대해 단 1건만 → 중복 재청구 물리 차단.
create unique index if not exists uq_rebill_charge_cycle
  on public.subscription_rebill_charges (subscription_id, cycle_period_end);

create index if not exists idx_rebill_charge_status
  on public.subscription_rebill_charges (status, requested_at desc);

alter table public.subscription_rebill_charges enable row level security;
-- service_role(edge)만 접근. authenticated/anon 은 접근 불가(민감 결제 원장).
revoke all on table public.subscription_rebill_charges from anon, authenticated;

-- ============================================================
-- 2) 재청구 대상 조회 — auto_renew + 만료 + 유료등급 + 빌링키 보유 + 미청구
-- ============================================================
-- p_grace_days: 만료 후 며칠까지 대상에 포함할지(기본 0 = 이미 만료된 전부).
create or replace function public.admin_list_rebill_due_subscriptions(
  p_grace_days int default 0
) returns table (
  subscription_id  uuid,
  user_id          uuid,
  email            text,
  nickname         text,
  phone            text,
  plan_type        text,
  plan_name        text,
  amount           integer,
  current_period_end timestamptz,
  rebill_no        text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.id, s.user_id, au.email::text, u.nickname, u.phone,
    s.plan_type, sp.name,
    coalesce(s.current_amount, s.price)::int as amount,
    s.current_period_end, s.payapp_rebill_no
  from public.subscriptions s
  join public.users u  on u.id = s.user_id
  join auth.users  au on au.id = s.user_id
  left join public.subscription_plans sp on sp.plan_type = s.plan_type
  where public._is_super_admin()               -- service_role(cron) 또는 admin 만
    and s.status = 'active'
    and s.auto_renew = true
    and s.payapp_rebill_no is not null
    and u.membership_tier in ('individual','business','artist_general','artist_student')
    and s.current_period_end is not null
    -- 만료된 지 최소 p_grace_days 지난 구독만 (기본 0 = 만료 즉시 대상)
    and s.current_period_end < now() - make_interval(days => greatest(coalesce(p_grace_days,0),0))
    and au.email is not null
    and length(au.email::text) > 3
    -- 같은 주기 이미 재청구(accepted/paid) 됐으면 제외
    and not exists (
      select 1 from public.subscription_rebill_charges c
       where c.subscription_id = s.id
         and c.cycle_period_end = s.current_period_end
         and c.status in ('accepted','paid')
    )
  order by s.current_period_end;
$$;
revoke all on function public.admin_list_rebill_due_subscriptions(int) from public, anon, authenticated;
grant execute on function public.admin_list_rebill_due_subscriptions(int) to authenticated, service_role;

-- ============================================================
-- 3) 멱등 예약 — 같은 (subscription, cycle) 이면 skip, 신규면 attempted row 생성
-- ============================================================
-- 반환: 새로 예약했으면 charge_id, 이미 있으면 null (edge 가 skip).
create or replace function public.record_rebill_charge_attempt(
  p_subscription_id uuid,
  p_user_id         uuid,
  p_rebill_no       text,
  p_amount          integer,
  p_plan_type       text,
  p_cycle_period_end timestamptz,
  p_order_no        text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.subscription_rebill_charges
    (subscription_id, user_id, rebill_no, order_no, amount, plan_type, cycle_period_end, status)
  values
    (p_subscription_id, p_user_id, p_rebill_no, p_order_no, p_amount, p_plan_type, p_cycle_period_end, 'attempted')
  on conflict (subscription_id, cycle_period_end) do nothing
  returning id into v_id;
  return v_id;  -- null → 이미 예약됨(중복) → 호출측 skip
end;
$$;
revoke all on function public.record_rebill_charge_attempt(uuid,uuid,text,integer,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.record_rebill_charge_attempt(uuid,uuid,text,integer,text,timestamptz,text) to authenticated, service_role;

-- ============================================================
-- 4) PayApp 응답 반영
-- ============================================================
create or replace function public.mark_rebill_charge_result(
  p_charge_id     uuid,
  p_status        text,
  p_payapp_state  text default null,
  p_payapp_raw    jsonb default null,
  p_error         text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('attempted','accepted','paid','failed') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.subscription_rebill_charges
     set status = p_status,
         payapp_state = coalesce(p_payapp_state, payapp_state),
         payapp_raw = coalesce(p_payapp_raw, payapp_raw),
         error_message = p_error,
         resolved_at = case when p_status in ('accepted','paid','failed') then now() else resolved_at end
   where id = p_charge_id;
end;
$$;
revoke all on function public.mark_rebill_charge_result(uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.mark_rebill_charge_result(uuid,text,text,jsonb,text) to authenticated, service_role;

-- ============================================================
-- 5) Diagnostics
-- ============================================================
do $$
declare v_tbl int; v_fn int;
begin
  select count(*) into v_tbl from information_schema.tables
   where table_schema='public' and table_name='subscription_rebill_charges';
  select count(*) into v_fn from pg_proc
   where pronamespace='public'::regnamespace
     and proname in ('admin_list_rebill_due_subscriptions','record_rebill_charge_attempt','mark_rebill_charge_result');
  raise notice '====== 0397 subscription rebill autocharge ======';
  raise notice 'ledger table: % / 1 ; rpcs: % / 3', v_tbl, v_fn;
  if v_tbl = 1 and v_fn = 3 then
    raise notice '0397 COMPLETE — rebillPay 재청구 인프라 준비(원장+대상조회+멱등예약+결과반영)';
  else
    raise warning '0397 INCOMPLETE — table=% rpcs=%', v_tbl, v_fn;
  end if;
end$$;
