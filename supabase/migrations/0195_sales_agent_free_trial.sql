-- ============================================
-- 0195_sales_agent_free_trial.sql
--
-- 영업인 코드 입력 시 3일 무료 재생 체험.
--   사업자 회원이 유효한(활성) 영업인 코드로 체험을 시작하면
--   3일간 실제 매장 재생이 가능해지고, 만료 시 자동 종료 + 결제 유도.
--
-- 설계 원칙:
--   - 체험 판정은 100% 서버 기준 (free_trial_ends_at 가 단일 진실 원천).
--     클라이언트는 표시/UX 용으로만 사용. is_trial_active / playback_enabled 는
--     서버(시작 RPC / 만료 sweep / lazy-expire)가 유지.
--   - membership_tier(결제 webhook 의 진실 원천)는 절대 건드리지 않는다.
--     체험은 별도 트랙으로, 유료 결제가 들어오면 그대로 'active' 가 우선.
--   - 중복 악용 방지: free_trial_redemptions 원장(ledger)이 사업자번호/전화번호
--     기준으로 1회만 허용. user 가 탈퇴(삭제)돼도 원장은 남아 재가입 재체험 차단.
-- ============================================

-- ----------------------
-- 1) users 체험 컬럼
-- ----------------------
alter table public.users
  add column if not exists free_trial_started_at timestamptz,
  add column if not exists free_trial_ends_at timestamptz,
  add column if not exists trial_source text
    check (trial_source is null or trial_source in ('sales_agent')),
  add column if not exists trial_sales_agent_id uuid
    references public.sales_agents(id) on delete set null,
  add column if not exists is_trial_active boolean not null default false,
  -- 유료 회원/일반 회원의 기존 게이팅(membership_tier 기준)은 그대로.
  -- 이 플래그는 "체험 만료 시 false 로 내려 재생 차단" 용도로만 의미를 가짐.
  add column if not exists playback_enabled boolean not null default true;

create index if not exists idx_users_trial_active
  on public.users(free_trial_ends_at) where is_trial_active;

-- ----------------------
-- 2) 체험 사용 원장 (악용 방지 / 로그)
--    user 삭제와 무관하게 사업자번호·전화번호 기준 1회 사용을 영구 기록.
-- ----------------------
create table if not exists public.free_trial_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  business_number text,
  phone text,
  sales_agent_id uuid references public.sales_agents(id) on delete set null,
  sales_agent_code text,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active','expired','revoked')),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now()
);

-- 사업자번호 / 전화번호 기준 1회 (탈퇴 후 재가입 재체험도 차단)
create unique index if not exists uq_ftr_business_number
  on public.free_trial_redemptions(business_number) where business_number is not null;
create unique index if not exists uq_ftr_phone
  on public.free_trial_redemptions(phone) where phone is not null;
create index if not exists idx_ftr_agent on public.free_trial_redemptions(sales_agent_id);
create index if not exists idx_ftr_status on public.free_trial_redemptions(status);

alter table public.free_trial_redemptions enable row level security;

drop policy if exists ftr_admin_all on public.free_trial_redemptions;
create policy ftr_admin_all on public.free_trial_redemptions
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists ftr_self_read on public.free_trial_redemptions;
create policy ftr_self_read on public.free_trial_redemptions
  for select using (auth.uid() = user_id);

-- 전화번호 정규화 (숫자만)
create or replace function public._normalize_phone(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

-- ----------------------
-- 3) start_sales_agent_trial — 사업자 본인이 호출. 모든 검증은 서버에서.
-- ----------------------
create or replace function public.start_sales_agent_trial(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_agent_id uuid;
  v_agent record;
  v_bn text;
  v_phone text;
  v_now timestamptz := now();
  v_ends timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select u.id, u.account_type, u.membership_tier, u.phone,
         u.free_trial_started_at, u.withdrawn_at
    into v_user
  from public.users u where u.id = v_uid;
  if v_user.id is null then
    raise exception 'user not found';
  end if;

  -- 사업자 회원만 체험 가능
  if coalesce(v_user.account_type, 'individual') <> 'business' then
    raise exception '사업자 회원만 무료 체험을 이용할 수 있습니다.';
  end if;

  -- 이미 유료 회원이면 체험 불필요
  if v_user.membership_tier in ('individual','business') then
    raise exception '이미 유료 이용 중입니다. 체험이 필요하지 않습니다.';
  end if;

  -- 영업인 코드 검증 (활성 코드만)
  v_agent_id := public._resolve_active_sales_agent(p_code);
  if v_agent_id is null then
    raise exception '유효하지 않은 영업인 코드입니다.';
  end if;
  select * into v_agent from public.sales_agents where id = v_agent_id;

  -- 이미 체험을 시작한 적이 있으면 차단 (동일 계정 반복)
  if v_user.free_trial_started_at is not null then
    raise exception '무료 체험은 이미 사용되었습니다.';
  end if;

  -- 사업자번호 / 전화번호 기준 중복 사용 차단 (탈퇴 후 재가입 포함)
  select bvp.business_number into v_bn
  from public.business_verification_profiles bvp where bvp.user_id = v_uid;
  v_phone := public._normalize_phone(v_user.phone);

  if v_bn is not null and exists (
    select 1 from public.free_trial_redemptions r where r.business_number = v_bn
  ) then
    raise exception '무료 체험은 이미 사용되었습니다.';
  end if;
  if v_phone is not null and exists (
    select 1 from public.free_trial_redemptions r where r.phone = v_phone
  ) then
    raise exception '무료 체험은 이미 사용되었습니다.';
  end if;

  v_ends := v_now + interval '3 days';

  update public.users u set
    free_trial_started_at = v_now,
    free_trial_ends_at = v_ends,
    trial_source = 'sales_agent',
    trial_sales_agent_id = v_agent_id,
    is_trial_active = true,
    playback_enabled = true,
    sales_agent_id = coalesce(u.sales_agent_id, v_agent_id),
    sales_agent_code = coalesce(u.sales_agent_code, v_agent.code)
  where u.id = v_uid;

  -- 원장 기록 (악용 방지 + 로그)
  insert into public.free_trial_redemptions (
    user_id, business_number, phone, sales_agent_id, sales_agent_code, started_at, ends_at, status
  ) values (
    v_uid, v_bn, v_phone, v_agent_id, v_agent.code, v_now, v_ends, 'active'
  );

  return jsonb_build_object(
    'ok', true,
    'subscription_status', 'trial',
    'free_trial_started_at', v_now,
    'free_trial_ends_at', v_ends,
    'sales_agent_name', v_agent.name,
    'sales_agent_code', v_agent.code
  );
end;
$$;

grant execute on function public.start_sales_agent_trial(text) to authenticated;

-- ----------------------
-- 4) get_my_trial_status — 본인 체험 상태 (만료 시 lazy-expire 후 반환)
--    서버 기준 판정. 클라이언트는 이 값을 신뢰.
-- ----------------------
create or replace function public.get_my_trial_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_status text;
  v_paid boolean;
  v_active boolean;
  v_remaining bigint;
begin
  if v_uid is null then
    return jsonb_build_object('subscription_status', 'anonymous');
  end if;

  select u.membership_tier, u.free_trial_started_at, u.free_trial_ends_at,
         u.is_trial_active, u.playback_enabled
    into v_user from public.users u where u.id = v_uid;

  v_paid := v_user.membership_tier in ('individual','business');
  v_active := v_user.free_trial_ends_at is not null and v_user.free_trial_ends_at > now();

  -- lazy-expire: 만료됐는데 플래그가 아직 active 면 내려준다.
  if v_user.is_trial_active and not v_active then
    update public.users u set
      is_trial_active = false,
      playback_enabled = v_paid
    where u.id = v_uid;
    update public.free_trial_redemptions r set status = 'expired'
      where r.user_id = v_uid and r.status = 'active' and r.ends_at <= now();
  end if;

  if v_paid then
    v_status := 'active';
  elsif v_active then
    v_status := 'trial';
  elsif v_user.free_trial_started_at is not null then
    v_status := 'expired';
  else
    v_status := 'free';
  end if;

  v_remaining := case when v_active
    then greatest(0, floor(extract(epoch from (v_user.free_trial_ends_at - now())))::bigint)
    else 0 end;

  return jsonb_build_object(
    'subscription_status', v_status,
    'has_trial', v_user.free_trial_started_at is not null,
    'is_trial_active', v_active,
    'playback_enabled', v_paid or v_active,
    'free_trial_started_at', v_user.free_trial_started_at,
    'free_trial_ends_at', v_user.free_trial_ends_at,
    'remaining_seconds', v_remaining
  );
end;
$$;

grant execute on function public.get_my_trial_status() to authenticated;

-- ----------------------
-- 5) expire_free_trials — 만료 sweep (cron / 관리자). 멱등.
-- ----------------------
create or replace function public.expire_free_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  update public.users u set
    is_trial_active = false,
    playback_enabled = (u.membership_tier in ('individual','business'))
  where u.is_trial_active and u.free_trial_ends_at <= now();
  get diagnostics v_count = row_count;

  update public.free_trial_redemptions r set status = 'expired'
  where r.status = 'active' and r.ends_at <= now();

  return v_count;
end;
$$;

grant execute on function public.expire_free_trials() to service_role;

-- ----------------------
-- 6) 관리자: 체험 연장 / 강제 종료 / 목록
-- ----------------------
create or replace function public.admin_extend_trial(p_user_id uuid, p_days integer default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ends timestamptz; v_base timestamptz;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_days is null or p_days <= 0 then raise exception 'p_days must be positive'; end if;

  select greatest(now(), coalesce(free_trial_ends_at, now())) into v_base
    from public.users where id = p_user_id;
  if v_base is null then raise exception 'user not found'; end if;
  v_ends := v_base + make_interval(days => p_days);

  update public.users u set
    free_trial_started_at = coalesce(u.free_trial_started_at, now()),
    free_trial_ends_at = v_ends,
    trial_source = coalesce(u.trial_source, 'sales_agent'),
    is_trial_active = true,
    playback_enabled = true
  where u.id = p_user_id;

  update public.free_trial_redemptions r set status = 'active', ends_at = v_ends, revoked_at = null
    where r.user_id = p_user_id;

  return jsonb_build_object('ok', true, 'free_trial_ends_at', v_ends);
end;
$$;
grant execute on function public.admin_extend_trial(uuid, integer) to authenticated;

create or replace function public.admin_end_trial(p_user_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_paid boolean;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select (membership_tier in ('individual','business')) into v_paid from public.users where id = p_user_id;
  if v_paid is null then raise exception 'user not found'; end if;

  update public.users u set
    is_trial_active = false,
    free_trial_ends_at = now(),
    playback_enabled = v_paid
  where u.id = p_user_id;

  update public.free_trial_redemptions r set
    status = 'revoked', revoked_at = now(), revoked_by = v_uid, revoke_reason = p_reason
    where r.user_id = p_user_id and r.status = 'active';

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_end_trial(uuid, text) to authenticated;

-- 관리자: 체험 목록 (로그 — 누가/어떤 코드/어떤 사업자/언제 시작/종료/전환여부)
create or replace function public.admin_list_free_trials(p_limit integer default 200, p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.started_at desc), '[]'::jsonb) into v_result from (
    select
      r.id, r.user_id, r.business_number, r.phone, r.sales_agent_code,
      sa.name as sales_agent_name,
      r.started_at, r.ends_at,
      -- 실시간 상태: ends_at 기준으로 active/expired 재판정 (sweep 지연 무관)
      case when r.status = 'revoked' then 'revoked'
           when r.ends_at > now() then 'active'
           else 'expired' end as status,
      au.email,
      coalesce(bvp.store_name, u.nickname) as store_name,
      u.membership_tier,
      -- 전환: 체험 시작 후 유료 결제(paid) 존재
      exists (select 1 from public.payment_orders po
              where po.user_id = r.user_id and po.status = 'paid') as converted,
      greatest(0, ceil(extract(epoch from (r.ends_at - now())) / 86400.0)::int) as days_left
    from public.free_trial_redemptions r
    left join public.users u on u.id = r.user_id
    left join auth.users au on au.id = r.user_id
    left join public.sales_agents sa on sa.id = r.sales_agent_id
    left join public.business_verification_profiles bvp on bvp.user_id = r.user_id
    where p_status is null
       or (p_status = 'active' and r.status = 'active' and r.ends_at > now())
       or (p_status = 'expired' and r.status = 'active' and r.ends_at <= now())
       or (p_status = r.status)
    order by r.started_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) x;
  return v_result;
end;
$$;
grant execute on function public.admin_list_free_trials(integer, text) to authenticated;

-- ----------------------
-- 7) 영업인 본인 체험 통계 (체험중 / 이번달 체험시작 / 유료전환 / 전환율 / 종료예정 / 미결제)
-- ----------------------
create or replace function public.salesperson_my_trial_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_agent record; v_ms timestamptz; v_me timestamptz;
  v_active int; v_started_month int; v_converted int; v_converted_month int;
  v_ending_soon int; v_unpaid int; v_total_started int;
begin
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  if v_agent.id is null then return jsonb_build_object('is_agent', false); end if;

  v_ms := (date_trunc('month', (now() at time zone 'Asia/Seoul'))) at time zone 'Asia/Seoul';
  v_me := v_ms + interval '1 month';

  select
    count(*) filter (where r.status <> 'revoked' and r.ends_at > now()),
    count(*) filter (where r.started_at >= v_ms and r.started_at < v_me),
    count(*),
    count(*) filter (where r.ends_at > now() and r.ends_at <= now() + interval '1 day' and r.status <> 'revoked'),
    count(*) filter (where exists (
      select 1 from public.payment_orders po where po.user_id = r.user_id and po.status = 'paid')),
    count(*) filter (where r.started_at >= v_ms and r.started_at < v_me and exists (
      select 1 from public.payment_orders po where po.user_id = r.user_id and po.status = 'paid')),
    count(*) filter (where r.ends_at <= now() and r.status <> 'revoked' and not exists (
      select 1 from public.payment_orders po where po.user_id = r.user_id and po.status = 'paid'))
  into v_active, v_started_month, v_total_started, v_ending_soon, v_converted, v_converted_month, v_unpaid
  from public.free_trial_redemptions r
  where r.sales_agent_id = v_agent.id;

  return jsonb_build_object(
    'is_agent', true,
    'trial_active', coalesce(v_active, 0),
    'trial_started_this_month', coalesce(v_started_month, 0),
    'trial_total_started', coalesce(v_total_started, 0),
    'converted', coalesce(v_converted, 0),
    'converted_this_month', coalesce(v_converted_month, 0),
    'conversion_rate', case when coalesce(v_total_started, 0) > 0
      then round(100.0 * coalesce(v_converted, 0) / v_total_started)::int else 0 end,
    'ending_soon', coalesce(v_ending_soon, 0),
    'trial_unpaid', coalesce(v_unpaid, 0)
  );
end;
$$;
grant execute on function public.salesperson_my_trial_stats() to authenticated;

-- ----------------------
-- 8) 확인
-- ----------------------
select
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='free_trial_ends_at')
    then 'OK' else 'MISSING' end) as users_trial_col,
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='free_trial_redemptions')
    then 'OK' else 'MISSING' end) as ledger_table,
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='start_sales_agent_trial')
    then 'OK' else 'MISSING' end) as start_rpc,
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='salesperson_my_trial_stats')
    then 'OK' else 'MISSING' end) as agent_stats_rpc;
