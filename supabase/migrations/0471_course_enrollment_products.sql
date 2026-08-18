-- ============================================================================
-- 0471_course_enrollment_products.sql
--
-- 수강신청 상품 시스템.
--   - 관리자가 코스 상품(이름/설명/가격/카테고리/정원)을 계속 제작(CRUD)
--   - 신규 수강 유저가 활성 상품을 보고 PayApp 일회성 결제(payrequest)로 신청
--   - 결제 확인은 전용 웹훅(payapp-course-feedback)이 pay_state=64 를 paid 로 반영
--
-- 구독(subscriptions/payment_orders/subscription_plans)과 완전히 분리한다.
-- (구독 웹훅/멤버십 부여 로직과 얽히지 않도록 전용 테이블/함수 사용)
-- 가격은 서버 DB(course_products.price)만 신뢰한다.
--
-- additive only — 기존 테이블/함수/데이터 변경 없음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 코스 상품
-- ----------------------------------------------------------------------------
create table if not exists public.course_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text,
  price integer not null check (price > 0),        -- KRW, 서버 신뢰 값
  capacity integer check (capacity is null or capacity > 0), -- null = 무제한
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_course_products_active on public.course_products(is_active, sort_order, created_at desc);

-- ----------------------------------------------------------------------------
-- 2) 코스 주문(일회성 결제 1건 = 1 row) = 결제 완료 시 수강 등록
-- ----------------------------------------------------------------------------
create table if not exists public.course_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.course_products(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  order_no text not null unique,
  amount integer not null check (amount > 0),
  buyer_name text,
  recvphone text,
  recvemail text,
  status text not null default 'requested'
    check (status in ('requested','waiting','paid','canceled','failed')),
  payapp_mul_no text,
  payapp_payurl text,
  raw_request jsonb,
  raw_response jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_course_orders_user on public.course_orders(user_id);
create index if not exists idx_course_orders_product on public.course_orders(product_id);
create index if not exists idx_course_orders_status on public.course_orders(status, created_at desc);

-- ----------------------------------------------------------------------------
-- 3) PayApp 웹훅 이벤트(멱등)
-- ----------------------------------------------------------------------------
create table if not exists public.course_payapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  order_no text,
  payapp_mul_no text,
  pay_state int,
  price int,
  verified boolean not null default false,
  matched_order_id uuid,
  processing_note text,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_course_webhook_order on public.course_payapp_webhook_events(order_no);

-- updated_at 자동 갱신 트리거 (기존 _touch_updated_at 재사용)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_touch_updated_at') then
    drop trigger if exists trg_course_products_touch on public.course_products;
    create trigger trg_course_products_touch before update on public.course_products
      for each row execute function public._touch_updated_at();
    drop trigger if exists trg_course_orders_touch on public.course_orders;
    create trigger trg_course_orders_touch before update on public.course_orders
      for each row execute function public._touch_updated_at();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4) RLS
-- ----------------------------------------------------------------------------
alter table public.course_products enable row level security;
alter table public.course_orders enable row level security;
alter table public.course_payapp_webhook_events enable row level security;

-- 상품: 활성 상품은 누구나 열람, 관리자는 전체 read/write
drop policy if exists course_products_public_read on public.course_products;
create policy course_products_public_read on public.course_products for select
  using (is_active = true);
drop policy if exists course_products_admin_all on public.course_products;
create policy course_products_admin_all on public.course_products for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

-- 주문: 본인 것만 read, 관리자는 전체. (insert 는 service_role 엣지함수만)
drop policy if exists course_orders_self_read on public.course_orders;
create policy course_orders_self_read on public.course_orders for select to authenticated
  using (user_id = auth.uid());
drop policy if exists course_orders_admin_all on public.course_orders;
create policy course_orders_admin_all on public.course_orders for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists course_webhook_admin_read on public.course_payapp_webhook_events;
create policy course_webhook_admin_read on public.course_payapp_webhook_events for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

-- ----------------------------------------------------------------------------
-- 5) 공개/유저 RPC
-- ----------------------------------------------------------------------------
-- 활성 상품 + 판매/잔여좌석 (주문 테이블 노출 없이 잔여 좌석만 계산)
create or replace function public.list_active_course_products()
returns table(
  id uuid, name text, description text, category text, price integer,
  capacity integer, sold integer, remaining integer, sort_order integer
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.description, p.category, p.price, p.capacity,
         coalesce(s.sold, 0)::int as sold,
         case when p.capacity is null then null else greatest(0, p.capacity - coalesce(s.sold,0))::int end as remaining,
         p.sort_order
  from public.course_products p
  left join (
    select product_id, count(*) as sold
    from public.course_orders where status = 'paid' group by product_id
  ) s on s.product_id = p.id
  where p.is_active = true
  order by p.sort_order asc, p.created_at desc;
$$;

-- 내 주문 상태 (결제 성공 페이지 폴링용)
create or replace function public.get_my_course_order_status(p_order_no text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'order_no', o.order_no, 'status', o.status, 'paid', (o.status='paid'),
    'amount', o.amount, 'product_name', p.name, 'paid_at', o.paid_at
  ) into v
  from public.course_orders o
  join public.course_products p on p.id = o.product_id
  where o.order_no = p_order_no and o.user_id = auth.uid();
  return v;  -- 본인 주문 아니면 null
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 관리자 CRUD RPC
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_course_products()
returns table(
  id uuid, name text, description text, category text, price integer,
  capacity integer, is_active boolean, sort_order integer,
  paid_count integer, revenue bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select p.id, p.name, p.description, p.category, p.price, p.capacity, p.is_active, p.sort_order,
         coalesce(s.cnt,0)::int as paid_count, coalesce(s.rev,0)::bigint as revenue, p.created_at
  from public.course_products p
  left join (select product_id, count(*) cnt, sum(amount) rev from public.course_orders where status='paid' group by product_id) s
    on s.product_id = p.id
  order by p.sort_order asc, p.created_at desc;
end;
$$;

create or replace function public.admin_create_course_product(
  p_name text, p_description text default '', p_category text default null,
  p_price integer default null, p_capacity integer default null, p_sort_order integer default 0
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'name required'; end if;
  if p_price is null or p_price <= 0 then raise exception 'price must be > 0'; end if;
  if p_capacity is not null and p_capacity <= 0 then raise exception 'capacity must be > 0 or null'; end if;
  insert into public.course_products(name, description, category, price, capacity, sort_order, created_by)
  values (btrim(p_name), coalesce(p_description,''), nullif(btrim(coalesce(p_category,'')),''), p_price, p_capacity, coalesce(p_sort_order,0), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_update_course_product(
  p_id uuid, p_name text, p_description text default '', p_category text default null,
  p_price integer default null, p_capacity integer default null, p_sort_order integer default 0
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'name required'; end if;
  if p_price is null or p_price <= 0 then raise exception 'price must be > 0'; end if;
  if p_capacity is not null and p_capacity <= 0 then raise exception 'capacity must be > 0 or null'; end if;
  update public.course_products
     set name=btrim(p_name), description=coalesce(p_description,''),
         category=nullif(btrim(coalesce(p_category,'')),''), price=p_price,
         capacity=p_capacity, sort_order=coalesce(p_sort_order,0)
   where id=p_id;
  if not found then raise exception 'product not found'; end if;
end;
$$;

create or replace function public.admin_set_course_product_active(p_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  update public.course_products set is_active = coalesce(p_active,false) where id=p_id;
  if not found then raise exception 'product not found'; end if;
end;
$$;

create or replace function public.admin_delete_course_product(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_orders int;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select count(*) into v_orders from public.course_orders where product_id=p_id;
  if v_orders > 0 then
    raise exception '주문이 있는 상품은 삭제할 수 없습니다. 비활성화(숨김)하세요.';
  end if;
  delete from public.course_products where id=p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 수강 신청 내역(결제된 주문) — 상품/사용자 조인
create or replace function public.admin_list_course_enrollments(p_product_id uuid default null, p_limit int default 100, p_offset int default 0)
returns table(
  order_id uuid, order_no text, product_id uuid, product_name text,
  user_id uuid, email text, nickname text, amount integer, status text,
  recvphone text, paid_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select o.id, o.order_no, o.product_id, p.name, o.user_id, au.email::text, u.nickname,
         o.amount, o.status, o.recvphone, o.paid_at, o.created_at
  from public.course_orders o
  join public.course_products p on p.id = o.product_id
  left join public.users u on u.id = o.user_id
  left join auth.users au on au.id = o.user_id
  where (p_product_id is null or o.product_id = p_product_id)
  order by o.created_at desc
  limit greatest(1, coalesce(p_limit,100)) offset greatest(0, coalesce(p_offset,0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) service_role — 결제 확인 반영 (웹훅에서 호출)
-- ----------------------------------------------------------------------------
create or replace function public._apply_course_payapp_event(
  p_order_no text, p_mul_no text, p_pay_state int, p_amount int, p_raw jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_order record;
begin
  select * into v_order from public.course_orders where order_no = p_order_no limit 1;
  if v_order is null then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  -- 금액 불일치(위변조) — 반영하지 않음
  if p_amount is not null and p_amount <> v_order.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  -- 승인완료(64) = 결제 성공 → paid (멱등)
  if p_pay_state = 64 then
    if v_order.status <> 'paid' then
      update public.course_orders
         set status='paid', paid_at=now(), payapp_mul_no=coalesce(p_mul_no, payapp_mul_no),
             raw_response = coalesce(p_raw, raw_response)
       where id = v_order.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id);
  -- 취소/환불 계열 → canceled
  elsif p_pay_state in (8,9,32,70,71) then
    update public.course_orders set status='canceled', payapp_mul_no=coalesce(p_mul_no, payapp_mul_no) where id=v_order.id and status <> 'paid';
    return jsonb_build_object('ok', true, 'status', 'canceled', 'order_id', v_order.id);
  -- 대기(1,4,10)
  else
    update public.course_orders set status='waiting' where id=v_order.id and status='requested';
    return jsonb_build_object('ok', true, 'status', 'waiting', 'order_id', v_order.id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) 권한
-- ----------------------------------------------------------------------------
grant execute on function public.list_active_course_products() to anon, authenticated, service_role;
grant execute on function public.get_my_course_order_status(text) to authenticated, service_role;

grant execute on function public.admin_list_course_products() to authenticated, service_role;
grant execute on function public.admin_create_course_product(text, text, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.admin_update_course_product(uuid, text, text, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.admin_set_course_product_active(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_delete_course_product(uuid) to authenticated, service_role;
grant execute on function public.admin_list_course_enrollments(uuid, int, int) to authenticated, service_role;

revoke execute on function public._apply_course_payapp_event(text, text, int, int, jsonb) from public, anon, authenticated;
grant  execute on function public._apply_course_payapp_event(text, text, int, int, jsonb) to service_role;

-- 관리자 RPC 는 anon/public 실행 금지 (0084 하드닝 관례 — PUBLIC 기본 grant 제거).
-- 함수 내부에 admin 게이트가 있어 데이터 유출은 없으나 노출면 자체를 제거한다.
revoke execute on function public.admin_list_course_products() from public, anon;
revoke execute on function public.admin_create_course_product(text, text, text, integer, integer, integer) from public, anon;
revoke execute on function public.admin_update_course_product(uuid, text, text, text, integer, integer, integer) from public, anon;
revoke execute on function public.admin_set_course_product_active(uuid, boolean) from public, anon;
revoke execute on function public.admin_delete_course_product(uuid) from public, anon;
revoke execute on function public.admin_list_course_enrollments(uuid, int, int) from public, anon;
