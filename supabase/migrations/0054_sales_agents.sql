-- ============================================
-- 0054_sales_agents.sql
--
-- 영업인(sales agent) 관리 + 사업자 가입/결제 추적:
--   1) sales_agents 테이블
--   2) users / payment_orders / subscriptions 에 sales_agent_id + sales_agent_code 추가
--   3) BEFORE INSERT 트리거 — payment_orders / subscriptions 생성 시
--      해당 사용자의 sales_agent 정보를 자동 복사 (Edge Function 수정 불필요)
--   4) 가입 단계에서 호출 가능한 공개 RPC verify_sales_agent_code(text)
--   5) 관리자 전용 RPC: admin_sales_agent_list / detail / upsert / generate_code
--   6) admin_member_detail 에 sales_agent 섹션 추가 (0042 위에 재배포)
--
-- 정책:
--   - 일반 회원은 sales_agents 테이블에 직접 접근 불가 (RLS 차단)
--   - 가입 시 코드 검증은 verify_sales_agent_code RPC 만 노출
--     → 활성 코드의 id/name 만 반환, 이메일/전화/수수료율 등은 비공개
--   - 코드 unique. 비활성 코드로는 가입 불가.
-- ============================================

-- ----------------------
-- 1) sales_agents 테이블
-- ----------------------
create table if not exists public.sales_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  code text unique not null,
  commission_rate numeric(5,2) not null default 0
    check (commission_rate >= 0 and commission_rate <= 100),
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 한 명의 회원은 한 영업인 슬롯에만 연결 (관리자가 기존 계정을 영업인으로 지정하는 케이스)
create unique index if not exists idx_sales_agents_user_id_unique
  on public.sales_agents(user_id) where user_id is not null;
create index if not exists idx_sales_agents_code_active
  on public.sales_agents(code) where is_active;
create index if not exists idx_sales_agents_is_active
  on public.sales_agents(is_active);

-- updated_at 자동 갱신 (0015 의 _touch_updated_at 재사용)
drop trigger if exists trg_sales_agents_updated_at on public.sales_agents;
create trigger trg_sales_agents_updated_at
  before update on public.sales_agents
  for each row execute function public._touch_updated_at();

-- RLS — 관리자만 read/write. 일반 사용자는 접근 차단.
alter table public.sales_agents enable row level security;

drop policy if exists "sales_agents_admin_all" on public.sales_agents;
create policy "sales_agents_admin_all" on public.sales_agents
  for all using (
    exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 2) users / payment_orders / subscriptions 에 sales_agent 연결
-- ----------------------
alter table public.users
  add column if not exists sales_agent_id uuid references public.sales_agents(id) on delete set null,
  add column if not exists sales_agent_code text;

create index if not exists idx_users_sales_agent
  on public.users(sales_agent_id) where sales_agent_id is not null;

alter table public.payment_orders
  add column if not exists sales_agent_id uuid references public.sales_agents(id) on delete set null,
  add column if not exists sales_agent_code text;

create index if not exists idx_payment_orders_sales_agent
  on public.payment_orders(sales_agent_id) where sales_agent_id is not null;

alter table public.subscriptions
  add column if not exists sales_agent_id uuid references public.sales_agents(id) on delete set null,
  add column if not exists sales_agent_code text;

create index if not exists idx_subscriptions_sales_agent
  on public.subscriptions(sales_agent_id) where sales_agent_id is not null;

-- ----------------------
-- 3) BEFORE INSERT 트리거 — 결제/구독 생성 시 사용자의 sales_agent 정보 자동 복사
--    (create-payapp-subscription Edge Function 수정 없이도 자동 추적됨)
-- ----------------------
create or replace function public._sales_agent_copy_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_agent_code text;
begin
  -- 명시적으로 set 했으면 그대로 사용
  if NEW.sales_agent_id is not null then
    return NEW;
  end if;
  select u.sales_agent_id, u.sales_agent_code
    into v_agent_id, v_agent_code
  from public.users as u
  where u.id = NEW.user_id;
  if v_agent_id is not null then
    NEW.sales_agent_id := v_agent_id;
    NEW.sales_agent_code := coalesce(NEW.sales_agent_code, v_agent_code);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_payment_orders_sales_agent on public.payment_orders;
create trigger trg_payment_orders_sales_agent
  before insert on public.payment_orders
  for each row execute function public._sales_agent_copy_on_insert();

drop trigger if exists trg_subscriptions_sales_agent on public.subscriptions;
create trigger trg_subscriptions_sales_agent
  before insert on public.subscriptions
  for each row execute function public._sales_agent_copy_on_insert();

-- ----------------------
-- 4) verify_sales_agent_code — 가입 단계 공개 RPC
--    활성 코드의 id/name 만 노출 (이메일/전화/수수료율 등은 비공개)
-- ----------------------
create or replace function public.verify_sales_agent_code(p_code text)
returns table(
  id uuid,
  name text,
  code text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is null or length(btrim(p_code)) = 0 then
    return;
  end if;
  return query
  select sa.id, sa.name, sa.code, sa.is_active
  from public.sales_agents as sa
  where sa.code = btrim(p_code) and sa.is_active = true
  limit 1;
end;
$$;

grant execute on function public.verify_sales_agent_code(text) to anon, authenticated;

-- ----------------------
-- 5) admin_generate_sales_agent_code — 6자 영숫자 코드 자동 생성
--    헷갈리는 문자(0/O/1/I) 제외
-- ----------------------
create or replace function public.admin_generate_sales_agent_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempts int := 0;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  loop
    v_attempts := v_attempts + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.sales_agents where code = v_code);
    if v_attempts > 50 then
      raise exception 'sales_agent code generation failed (too many collisions)';
    end if;
  end loop;
  return v_code;
end;
$$;

grant execute on function public.admin_generate_sales_agent_code() to authenticated;

-- ----------------------
-- 6) admin_sales_agent_list — 메트릭 포함 리스트
-- ----------------------
create or replace function public.admin_sales_agent_list()
returns table(
  id uuid,
  user_id uuid,
  name text,
  email text,
  phone text,
  code text,
  commission_rate numeric,
  is_active boolean,
  linked_business_count bigint,
  paid_business_count bigint,
  total_paid_amount bigint,
  estimated_commission bigint,
  created_at timestamptz,
  updated_at timestamptz,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  with linked as (
    select u.sales_agent_id as agent_id, count(*)::bigint as cnt
    from public.users as u
    where u.sales_agent_id is not null
    group by u.sales_agent_id
  ),
  paid_summary as (
    select po.sales_agent_id as agent_id,
           count(distinct po.user_id)::bigint as paid_count,
           coalesce(sum(po.amount), 0)::bigint as total_amount,
           max(coalesce(po.paid_at, po.created_at)) as last_paid
    from public.payment_orders as po
    where po.status = 'paid' and po.sales_agent_id is not null
    group by po.sales_agent_id
  )
  select
    sa.id,
    sa.user_id,
    sa.name,
    sa.email,
    sa.phone,
    sa.code,
    sa.commission_rate,
    sa.is_active,
    coalesce(l.cnt, 0)::bigint as linked_business_count,
    coalesce(p.paid_count, 0)::bigint as paid_business_count,
    coalesce(p.total_amount, 0)::bigint as total_paid_amount,
    floor(coalesce(p.total_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as estimated_commission,
    sa.created_at,
    sa.updated_at,
    p.last_paid as last_activity_at
  from public.sales_agents as sa
  left join linked as l on l.agent_id = sa.id
  left join paid_summary as p on p.agent_id = sa.id
  order by sa.created_at desc;
end;
$$;

grant execute on function public.admin_sales_agent_list() to authenticated;

-- ----------------------
-- 7) admin_sales_agent_upsert — 생성/수정 (중복 코드 사전 검증 포함)
-- ----------------------
create or replace function public.admin_sales_agent_upsert(
  p_id uuid default null,
  p_user_id uuid default null,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_code text default null,
  p_commission_rate numeric default null,
  p_is_active boolean default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_name_in text := nullif(btrim(coalesce(p_name, '')), '');
  v_email_in text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone_in text := nullif(btrim(coalesce(p_phone, '')), '');
  v_code_in text := nullif(btrim(coalesce(p_code, '')), '');
  v_note_in text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  -- 코드 중복 검증
  if v_code_in is not null then
    if exists (
      select 1 from public.sales_agents
      where code = v_code_in
        and (p_id is null or id <> p_id)
    ) then
      raise exception 'duplicate sales_agent code: %', v_code_in using errcode = '23505';
    end if;
  end if;

  if p_id is null then
    -- 신규 생성
    if v_name_in is null then
      raise exception 'name required';
    end if;
    v_code := coalesce(v_code_in, public.admin_generate_sales_agent_code());
    insert into public.sales_agents (
      user_id, name, email, phone, code, commission_rate, is_active, note
    ) values (
      p_user_id, v_name_in, v_email_in, v_phone_in, v_code,
      coalesce(p_commission_rate, 0),
      coalesce(p_is_active, true),
      v_note_in
    )
    returning id into v_id;
  else
    -- 수정
    update public.sales_agents set
      user_id = case when p_user_id is not null then p_user_id else user_id end,
      name = coalesce(v_name_in, name),
      email = coalesce(v_email_in, email),
      phone = coalesce(v_phone_in, phone),
      code = coalesce(v_code_in, code),
      commission_rate = coalesce(p_commission_rate, commission_rate),
      is_active = coalesce(p_is_active, is_active),
      note = coalesce(v_note_in, note)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'sales_agent not found: %', p_id;
    end if;
  end if;

  return v_id;
end;
$$;

grant execute on function public.admin_sales_agent_upsert(uuid, uuid, text, text, text, text, numeric, boolean, text)
  to authenticated;

-- ----------------------
-- 8) admin_sales_agent_detail — 상세 + 연결된 사업자/결제
-- ----------------------
create or replace function public.admin_sales_agent_detail(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'agent', jsonb_build_object(
      'id', sa.id,
      'user_id', sa.user_id,
      'name', sa.name,
      'email', sa.email,
      'phone', sa.phone,
      'code', sa.code,
      'commission_rate', sa.commission_rate,
      'is_active', sa.is_active,
      'note', sa.note,
      'created_at', sa.created_at,
      'updated_at', sa.updated_at
    ),
    'businesses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'email', au.email,
        'nickname', u.nickname,
        'full_name', u.full_name,
        'phone', u.phone,
        'account_type', u.account_type,
        'membership_tier', u.membership_tier,
        'subscription_type', u.subscription_type,
        'business_number', bvp.business_number,
        'store_name', bvp.store_name,
        'created_at', u.created_at
      ) order by u.created_at desc), '[]'::jsonb)
      from public.users as u
      left join auth.users as au on au.id = u.id
      left join public.business_verification_profiles as bvp on bvp.user_id = u.id
      where u.sales_agent_id = p_id
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', po.id,
        'user_id', po.user_id,
        'order_no', po.order_no,
        'plan_type', po.plan_type,
        'amount', po.amount,
        'status', po.status,
        'paid_at', po.paid_at,
        'created_at', po.created_at
      ) order by coalesce(po.paid_at, po.created_at) desc), '[]'::jsonb)
      from public.payment_orders as po
      where po.sales_agent_id = p_id
    ),
    'summary', (
      select jsonb_build_object(
        'linked_business_count', (
          select count(*) from public.users where sales_agent_id = p_id
        ),
        'paid_business_count', (
          select count(distinct user_id) from public.payment_orders
          where sales_agent_id = p_id and status = 'paid'
        ),
        'total_paid_amount', (
          select coalesce(sum(amount), 0) from public.payment_orders
          where sales_agent_id = p_id and status = 'paid'
        ),
        'estimated_commission', floor(
          (select coalesce(sum(amount), 0) from public.payment_orders
            where sales_agent_id = p_id and status = 'paid')
          * coalesce((select commission_rate from public.sales_agents where id = p_id), 0) / 100.0
        )::bigint
      )
    )
  )
  into v_result
  from public.sales_agents as sa
  where sa.id = p_id;

  return v_result;
end;
$$;

grant execute on function public.admin_sales_agent_detail(uuid) to authenticated;

-- ----------------------
-- 9) admin_member_detail 재배포 — sales_agent 섹션 추가
--    (0042 의 모든 기존 필드 유지 + sales_agent 추가)
-- ----------------------
drop function if exists public.admin_member_detail(uuid);

create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users as u
      where u.id = auth.uid() and u.role = 'admin'
    ) then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', au.email,
      'nickname', u.nickname,
      'role', u.role,
      'subscription_type', u.subscription_type,
      'account_type', u.account_type,
      'membership_tier', u.membership_tier,
      'business_category', u.business_category,
      'created_at', u.created_at
    ),
    'sales_agent', (
      select case when sa.id is null then null else jsonb_build_object(
        'id', sa.id,
        'name', sa.name,
        'code', sa.code,
        'is_active', sa.is_active,
        'commission_rate', sa.commission_rate,
        'linked_at', u.created_at
      ) end
      from public.users as u2
      left join public.sales_agents as sa on sa.id = u2.sales_agent_id
      where u2.id = p_user_id
    ),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'status', s.status,
        'plan_type', s.plan_type,
        'price', s.price,
        'auto_renew', s.auto_renew,
        'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'canceled_at', s.canceled_at,
        'cancel_reason', s.cancel_reason,
        'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no,
        'payapp_rebill_no', s.payapp_rebill_no,
        'sales_agent_id', s.sales_agent_id,
        'sales_agent_code', s.sales_agent_code,
        'created_at', s.created_at
      ) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (
      select count(*) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type = 'milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id
    ),
    'recent_visits', (
      select coalesce(
        jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc),
        '[]'::jsonb
      )
      from (
        select ve.path, ve.created_at from public.visitor_events as ve
        where ve.user_id = p_user_id order by ve.created_at desc limit 10
      ) as v
    ),
    'recent_plays', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'track_title', rp.track_title,
          'playlist_title', rp.playlist_title,
          'completed', rp.completed,
          'created_at', rp.created_at
        ) order by rp.created_at desc),
        '[]'::jsonb
      )
      from (
        select t.title as track_title, p.title as playlist_title,
               se.completed, se.created_at
        from public.stream_events as se
        left join public.tracks as t on t.id = se.track_id
        left join public.playlists as p on p.id = se.playlist_id
        where se.user_id = p_user_id and se.event_type = 'milestone_30s'
        order by se.created_at desc limit 10
      ) as rp
    ),
    -- 결제: payment_orders 기반 (0042 와 동일) + sales_agent_id/code 추가
    'revenue', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'id', po.id,
          'amount', po.amount,
          'status', po.status,
          'plan_type', po.plan_type,
          'subscription_type', po.plan_type,
          'payapp_mul_no', po.payapp_mul_no,
          'approval_no', po.approval_no,
          'paid_at', po.paid_at,
          'canceled_at', po.canceled_at,
          'refunded_at', po.refunded_at,
          'cancel_reason', po.cancel_reason,
          'sales_agent_id', po.sales_agent_id,
          'sales_agent_code', po.sales_agent_code,
          'created_at', po.created_at
        ) order by coalesce(po.paid_at, po.created_at) desc),
        '[]'::jsonb
      )
      from public.payment_orders as po where po.user_id = p_user_id
    ),
    'subscription_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requested_plan', sr.requested_plan,
        'status', sr.status,
        'created_at', sr.created_at
      ) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests as sr where sr.user_id = p_user_id
    )
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;

-- ----------------------
-- 10) 확인
-- ----------------------
select
  (select count(*) from public.sales_agents) as agent_count,
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='sales_agent_id')
    then 'OK' else 'MISSING' end) as users_col,
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_orders' and column_name='sales_agent_id')
    then 'OK' else 'MISSING' end) as orders_col,
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='verify_sales_agent_code')
    then 'OK' else 'MISSING' end) as verify_rpc,
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_sales_agent_list')
    then 'OK' else 'MISSING' end) as list_rpc;
