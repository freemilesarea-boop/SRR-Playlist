-- ============================================
-- 0026_admin_payment_sync.sql
--
-- PayApp webhook 미반영 케이스를 위한 관리자 수동 결제 동기화.
--   1) subscription_plans 상품명 변경:
--        individual → 'SRR Playlist 정기이용권'
--        business   → 'SRR Playlist 사업자 정기이용권'
--   2) payapp_manual_payment_imports 테이블 (수동 동기화 감사 로그)
--   3) RPC admin_sync_payapp_payment — 결제건 수동 동기화 (멱등)
--   4) RPC list_manual_payment_imports — 관리자 조회
--
-- 보안:
--   - admin only (auth.uid().role='admin')
--   - 금액 검증: individual=4900 / business=6900 와 정확 일치해야 함
--   - 동일 payapp_mul_no 재호출 시 기존 결과 반환 (중복 생성 방지)
--   - 매칭 실패 시 unmatched 로 로그만 저장 (DB 변경 없음)
-- ============================================

-- ----------------------
-- 1) subscription_plans 상품명 변경
-- ----------------------
update public.subscription_plans
  set name = 'SRR Playlist 정기이용권'
  where plan_type = 'individual';

update public.subscription_plans
  set name = 'SRR Playlist 사업자 정기이용권'
  where plan_type = 'business';

-- 신규 환경 대비: 이미 있는 plan 은 위에서 update, 없으면 insert
insert into public.subscription_plans (plan_type, name, price, billing_cycle)
values
  ('individual', 'SRR Playlist 정기이용권', 4900, 'monthly'),
  ('business',   'SRR Playlist 사업자 정기이용권', 6900, 'monthly')
on conflict (plan_type) do update set
  name = excluded.name,
  price = excluded.price,
  billing_cycle = excluded.billing_cycle;

-- ----------------------
-- 2) payapp_manual_payment_imports
-- ----------------------
create table if not exists public.payapp_manual_payment_imports (
  id uuid primary key default gen_random_uuid(),
  payapp_mul_no text unique not null,
  approval_no text,
  buyer_email text,
  buyer_phone text,
  amount integer not null,
  plan_type text not null check (plan_type in ('individual','business')),
  goodname text,
  paid_at timestamptz not null default now(),
  matched_user_id uuid references public.users(id) on delete set null,
  matched_order_id uuid references public.payment_orders(id) on delete set null,
  matched_subscription_id uuid references public.subscriptions(id) on delete set null,
  status text not null check (status in ('matched','unmatched','failed')),
  raw_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_imports_status on public.payapp_manual_payment_imports(status);
create index if not exists idx_manual_imports_user on public.payapp_manual_payment_imports(matched_user_id);

alter table public.payapp_manual_payment_imports enable row level security;

drop policy if exists "manual_imports_admin_all" on public.payapp_manual_payment_imports;
create policy "manual_imports_admin_all" on public.payapp_manual_payment_imports
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 3) RPC: admin_sync_payapp_payment
--
-- 모든 SELECT/UPDATE/INSERT 에 테이블 alias 명시 + 컬럼 prefix qualification.
-- RETURNS TABLE 의 OUT 컬럼 (status, user_id, order_id, subscription_id, import_id,
-- message) 가 본문의 컬럼 참조와 충돌(ambiguous) 하지 않도록 모든 컬럼은 명시적으로
-- 테이블 alias 로 qualify 한다.
-- ----------------------
create or replace function public.admin_sync_payapp_payment(
  p_payapp_mul_no text,
  p_amount integer,
  p_plan_type text default 'individual',
  p_approval_no text default null,
  p_buyer_email text default null,
  p_buyer_phone text default null,
  p_paid_at timestamptz default now(),
  p_goodname text default null
)
returns table(
  status text,
  user_id uuid,
  order_id uuid,
  subscription_id uuid,
  import_id uuid,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_expected_price integer;
  v_user_id uuid;
  v_order_id uuid;
  v_sub_id uuid;
  v_import_id uuid;
  v_phone_clean text;
  v_existing public.payapp_manual_payment_imports%rowtype;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  v_email text := lower(btrim(coalesce(p_buyer_email, '')));
  v_payload jsonb;
begin
  -- (1) admin only
  select exists(
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  ) into v_admin;
  if not v_admin then raise exception 'admin only'; end if;

  -- (2) input validation
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  if p_plan_type not in ('individual','business') then raise exception 'invalid plan_type'; end if;
  v_expected_price := case when p_plan_type = 'individual' then 4900 else 6900 end;
  if p_amount <> v_expected_price then
    raise exception 'amount mismatch: expected %, got %', v_expected_price, p_amount;
  end if;

  -- (3) idempotency: existing import row?
  select mpi.* into v_existing
  from public.payapp_manual_payment_imports mpi
  where mpi.payapp_mul_no = v_mul_no;
  if found then
    return query select
      v_existing.status,
      v_existing.matched_user_id,
      v_existing.matched_order_id,
      v_existing.matched_subscription_id,
      v_existing.id,
      'already synced'::text;
    return;
  end if;

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no,
    'approval_no', p_approval_no,
    'buyer_email', p_buyer_email,
    'buyer_phone', p_buyer_phone,
    'amount', p_amount,
    'plan_type', p_plan_type,
    'goodname', p_goodname,
    'paid_at', p_paid_at,
    'manual_sync', true,
    'synced_at', now()
  );

  -- (4) Match user_id — multiple strategies
  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '\D', '', 'g');

  -- 4a) existing payment_orders.payapp_mul_no
  select po.user_id into v_user_id
  from public.payment_orders po
  where po.payapp_mul_no = v_mul_no
  limit 1;

  -- 4b) existing payment_orders.raw_response 안의 mul_no
  if v_user_id is null then
    select po.user_id into v_user_id
    from public.payment_orders po
    where po.raw_response::text ilike '%' || v_mul_no || '%'
    order by po.created_at desc
    limit 1;
  end if;

  -- 4c) buyer_email 매칭 (auth.users.email)
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users au
    join public.users u on u.id = au.id
    where lower(au.email) = v_email
    limit 1;
  end if;

  -- 4d) 최근 requested/waiting/failed 주문 중 phone 매칭
  if v_user_id is null and v_phone_clean <> '' then
    select po.user_id into v_user_id
    from public.payment_orders po
    where po.status in ('requested','waiting','failed')
      and po.raw_request::text ilike '%' || v_phone_clean || '%'
    order by po.created_at desc
    limit 1;
  end if;

  -- (5) unmatched → 로그만 저장
  if v_user_id is null then
    insert into public.payapp_manual_payment_imports
      (payapp_mul_no, approval_no, buyer_email, buyer_phone, amount, plan_type, goodname,
       paid_at, status, raw_payload, created_by)
    values
      (v_mul_no, p_approval_no, p_buyer_email, p_buyer_phone, p_amount, p_plan_type, p_goodname,
       p_paid_at, 'unmatched', v_payload, auth.uid())
    returning public.payapp_manual_payment_imports.id into v_import_id;

    return query select 'unmatched'::text, null::uuid, null::uuid, null::uuid,
      v_import_id, '매칭되는 사용자를 찾지 못했습니다 — 관리자가 직접 연결 필요'::text;
    return;
  end if;

  -- (6) Found user — order/subscription 매칭 또는 생성
  --   6a) 동일 mul_no 의 기존 주문
  select po.id into v_order_id
  from public.payment_orders po
  where po.payapp_mul_no = v_mul_no and po.user_id = v_user_id
  limit 1;

  --   6b) 최신 pending/requested/waiting/failed 주문 재활용
  if v_order_id is null then
    select po.id into v_order_id
    from public.payment_orders po
    where po.user_id = v_user_id
      and po.status in ('requested','waiting','failed')
    order by po.created_at desc
    limit 1;
  end if;

  --   6c) 없으면 새 주문 생성
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (v_user_id, 'manual_' || v_mul_no, p_plan_type, p_amount, 'paid', v_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

  -- subscription 매칭 또는 생성 — active > pending > others
  select s.id into v_sub_id
  from public.subscriptions s
  where s.user_id = v_user_id
  order by
    case s.status
      when 'active' then 0
      when 'pending' then 1
      when 'payment_waiting' then 2
      else 3
    end,
    s.created_at desc
  limit 1;

  if v_sub_id is null then
    insert into public.subscriptions
      (user_id, plan_type, price, status)
    values
      (v_user_id, p_plan_type, p_amount, 'active')
    returning public.subscriptions.id into v_sub_id;
  end if;

  -- (7) 실제 업데이트
  --     UPDATE 의 SET RHS / WHERE 모두 테이블명 prefix 로 qualify
  update public.payment_orders as po
  set status = 'paid',
      payapp_mul_no = v_mul_no,
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status = 'active',
      plan_type = p_plan_type,
      price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month'
  where s.id = v_sub_id;

  update public.users as u
  set membership_tier = p_plan_type
  where u.id = v_user_id;

  -- (8) 감사 로그
  insert into public.payapp_manual_payment_imports
    (payapp_mul_no, approval_no, buyer_email, buyer_phone, amount, plan_type, goodname,
     paid_at, matched_user_id, matched_order_id, matched_subscription_id,
     status, raw_payload, created_by)
  values
    (v_mul_no, p_approval_no, p_buyer_email, p_buyer_phone, p_amount, p_plan_type, p_goodname,
     p_paid_at, v_user_id, v_order_id, v_sub_id, 'matched', v_payload, auth.uid())
  returning public.payapp_manual_payment_imports.id into v_import_id;

  return query select 'matched'::text, v_user_id, v_order_id, v_sub_id, v_import_id,
    'sync ok — membership_tier 활성화 + subscription active'::text;
end;
$$;

grant execute on function public.admin_sync_payapp_payment(text, integer, text, text, text, text, timestamptz, text) to authenticated;

-- ----------------------
-- 4) RPC: list_manual_payment_imports (admin only)
--    OUT 컬럼들과 본문 컬럼 명이 겹치므로 모든 컬럼에 alias prefix 명시.
-- ----------------------
create or replace function public.list_manual_payment_imports(p_limit int default 50)
returns table(
  id uuid,
  payapp_mul_no text,
  approval_no text,
  buyer_email text,
  buyer_phone text,
  amount integer,
  plan_type text,
  goodname text,
  paid_at timestamptz,
  matched_user_id uuid,
  matched_user_email text,
  matched_order_id uuid,
  matched_subscription_id uuid,
  status text,
  error_message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
  ) then
    raise exception 'admin only';
  end if;

  return query
  select i.id, i.payapp_mul_no, i.approval_no, i.buyer_email, i.buyer_phone,
         i.amount, i.plan_type, i.goodname, i.paid_at,
         i.matched_user_id, au.email::text as matched_user_email,
         i.matched_order_id, i.matched_subscription_id,
         i.status, i.error_message, i.created_at
  from public.payapp_manual_payment_imports i
  left join auth.users au on au.id = i.matched_user_id
  order by i.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_manual_payment_imports(int) to authenticated;

-- ----------------------
-- 확인
-- ----------------------
select
  'plan_individual_name=' ||
  (select name from public.subscription_plans where plan_type = 'individual') as check_1,
  'plan_business_name=' ||
  (select name from public.subscription_plans where plan_type = 'business') as check_2,
  'manual_imports_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='payapp_manual_payment_imports')
    then 'OK' else 'MISSING' end) as check_3,
  'sync_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_sync_payapp_payment')
    then 'OK' else 'MISSING' end) as check_4;
