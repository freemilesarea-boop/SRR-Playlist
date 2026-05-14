-- ============================================
-- 0028_payapp_diagnostics.sql
--
-- PayApp 결제 자동 동기화 진단/복구 보강:
--   1) payapp_api_sync_attempts — list API 호출별 raw response 보존
--   2) list_recent_webhook_events RPC — admin 진단용 webhook 조회
--   3) admin_sync_payapp_payment 강화 — phone 직접 매칭 5순위 추가
--      (users.phone 정확 매칭 → artist_profiles.phone 정확 매칭)
--
-- 모든 RPC admin only. 모든 컬럼 alias prefix qualify.
-- ============================================

-- ----------------------
-- 1) payapp_api_sync_attempts
-- ----------------------
create table if not exists public.payapp_api_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  requested_cmd text not null,
  date_from date,
  date_to date,
  http_status int,
  raw_response text,
  parsed_count int not null default 0,
  success boolean not null default false,
  error_message text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_attempts_created on public.payapp_api_sync_attempts(created_at desc);
create index if not exists idx_sync_attempts_cmd on public.payapp_api_sync_attempts(requested_cmd);

alter table public.payapp_api_sync_attempts enable row level security;

drop policy if exists "sync_attempts_admin_all" on public.payapp_api_sync_attempts;
create policy "sync_attempts_admin_all" on public.payapp_api_sync_attempts
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 2) RPC: list_recent_sync_attempts (admin only)
-- ----------------------
create or replace function public.list_recent_sync_attempts(p_limit int default 20)
returns table(
  id uuid,
  requested_cmd text,
  date_from date,
  date_to date,
  http_status int,
  parsed_count int,
  success boolean,
  error_message text,
  raw_preview text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select a.id, a.requested_cmd, a.date_from, a.date_to, a.http_status, a.parsed_count, a.success,
         a.error_message, left(coalesce(a.raw_response,''), 2000) as raw_preview, a.created_at
  from public.payapp_api_sync_attempts a
  order by a.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_sync_attempts(int) to authenticated;

-- ----------------------
-- 3) RPC: list_recent_webhook_events — admin 진단용 webhook 조회
-- ----------------------
create or replace function public.list_recent_webhook_events(
  p_search text default null,
  p_minutes int default 60,
  p_limit int default 50
)
returns table(
  id uuid,
  event_key text,
  order_no text,
  user_id uuid,
  payapp_mul_no text,
  payapp_rebill_no text,
  pay_state integer,
  price integer,
  linkval_verified boolean,
  processed_at timestamptz,
  reasons text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select e.id, e.event_key, e.order_no, e.user_id, e.payapp_mul_no, e.payapp_rebill_no,
         e.pay_state, e.price, e.linkval_verified, e.processed_at,
         coalesce(e.raw_payload->'_verification'->>'reasons', '')::text as reasons,
         e.created_at
  from public.payapp_webhook_events e
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (
      v_search = '' or
      e.payapp_mul_no = v_search or
      e.order_no = v_search or
      e.raw_payload::text ilike '%' || v_search || '%'
    )
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_webhook_events(text, int, int) to authenticated;

-- ----------------------
-- 4) admin_sync_payapp_payment — phone 매칭 5순위 추가
--    기존 4단계: mul_no / raw_response in / email / phone in raw_request
--    추가 5단계: users.phone 정확 매칭 (010-XXXX-XXXX / 01012345678 둘 다)
--    추가 6단계: artist_profiles.phone 정확 매칭
--    추가 7단계: business_verification_profiles.phone (있을 경우)
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
  v_phone_hyphen text;
  v_existing public.payapp_manual_payment_imports%rowtype;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  v_email text := lower(btrim(coalesce(p_buyer_email, '')));
  v_payload jsonb;
begin
  select exists(
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  ) into v_admin;
  if not v_admin then raise exception 'admin only'; end if;

  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  if p_plan_type not in ('individual','business') then raise exception 'invalid plan_type'; end if;
  v_expected_price := case when p_plan_type = 'individual' then 4900 else 6900 end;
  if p_amount <> v_expected_price then
    raise exception 'amount mismatch: expected %, got %', v_expected_price, p_amount;
  end if;

  -- 멱등 — 같은 mul_no 가 이미 동기화되었으면 기존 결과 반환
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

  -- phone 정규화: 숫자만 추출 + 하이픈 포맷 둘 다 준비
  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '\D', '', 'g');
  v_phone_hyphen :=
    case
      when length(v_phone_clean) = 11 then
        substr(v_phone_clean,1,3) || '-' || substr(v_phone_clean,4,4) || '-' || substr(v_phone_clean,8,4)
      when length(v_phone_clean) = 10 then
        substr(v_phone_clean,1,3) || '-' || substr(v_phone_clean,4,3) || '-' || substr(v_phone_clean,7,4)
      else v_phone_clean
    end;

  -- 4a) payment_orders.payapp_mul_no
  select po.user_id into v_user_id
  from public.payment_orders po
  where po.payapp_mul_no = v_mul_no
  limit 1;

  -- 4b) raw_response 안의 mul_no
  if v_user_id is null then
    select po.user_id into v_user_id
    from public.payment_orders po
    where po.raw_response::text ilike '%' || v_mul_no || '%'
    order by po.created_at desc
    limit 1;
  end if;

  -- 4c) auth.users.email
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users au
    join public.users u on u.id = au.id
    where lower(au.email) = v_email
    limit 1;
  end if;

  -- 4d) raw_request 안의 phone (요청 시 사용자가 입력한 알림 전화)
  if v_user_id is null and v_phone_clean <> '' then
    select po.user_id into v_user_id
    from public.payment_orders po
    where po.status in ('requested','waiting','failed')
      and po.raw_request::text ilike '%' || v_phone_clean || '%'
    order by po.created_at desc
    limit 1;
  end if;

  -- 5) users.phone 정확 매칭 (하이픈/숫자만 둘 다)
  if v_user_id is null and v_phone_clean <> '' then
    select u.id into v_user_id
    from public.users u
    where regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = v_phone_clean
    limit 1;
  end if;

  -- 6) artist_profiles.phone
  if v_user_id is null and v_phone_clean <> '' then
    select ap.user_id into v_user_id
    from public.artist_profiles ap
    where regexp_replace(coalesce(ap.phone,''), '\D', '', 'g') = v_phone_clean
    limit 1;
  end if;

  -- 7) business_verification_profiles.phone (테이블 존재 시)
  if v_user_id is null and v_phone_clean <> '' then
    begin
      select bvp.user_id into v_user_id
      from public.business_verification_profiles bvp
      where regexp_replace(coalesce(bvp.phone,''), '\D', '', 'g') = v_phone_clean
      limit 1;
    exception when undefined_table then
      -- bvp 테이블 없으면 무시
      null;
    end;
  end if;

  -- 8) unmatched → 로그만 저장
  if v_user_id is null then
    insert into public.payapp_manual_payment_imports
      (payapp_mul_no, approval_no, buyer_email, buyer_phone, amount, plan_type, goodname,
       paid_at, status, raw_payload, created_by)
    values
      (v_mul_no, p_approval_no, p_buyer_email, p_buyer_phone, p_amount, p_plan_type, p_goodname,
       p_paid_at, 'unmatched',
       v_payload || jsonb_build_object('phone_clean', v_phone_clean, 'phone_hyphen', v_phone_hyphen),
       auth.uid())
    returning public.payapp_manual_payment_imports.id into v_import_id;

    return query select 'unmatched'::text, null::uuid, null::uuid, null::uuid,
      v_import_id, '매칭되는 사용자를 찾지 못했습니다 — 미매칭 목록에서 직접 연결 필요'::text;
    return;
  end if;

  -- 매칭됨 — order/subscription 적용
  select po.id into v_order_id
  from public.payment_orders po
  where po.payapp_mul_no = v_mul_no and po.user_id = v_user_id
  limit 1;

  if v_order_id is null then
    select po.id into v_order_id
    from public.payment_orders po
    where po.user_id = v_user_id
      and po.status in ('requested','waiting','failed')
    order by po.created_at desc
    limit 1;
  end if;

  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (v_user_id, 'manual_' || v_mul_no, p_plan_type, p_amount, 'paid', v_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

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

-- 확인
select
  'sync_attempts_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='payapp_api_sync_attempts')
    then 'OK' else 'MISSING' end) as check_1,
  'list_webhook_events_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_recent_webhook_events')
    then 'OK' else 'MISSING' end) as check_2,
  'list_sync_attempts_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_recent_sync_attempts')
    then 'OK' else 'MISSING' end) as check_3;
