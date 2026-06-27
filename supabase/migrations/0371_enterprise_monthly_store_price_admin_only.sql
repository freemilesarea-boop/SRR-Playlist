-- 0371 — Phase 1-10 §3: 매장당 기준 금액 (monthly_store_price) admin-only
--
-- 정책 변경:
--   기존 0370 은 monthly_store_price 를 RPC 상수 4,900원 으로 hard-code.
--   본사별 계약 단가가 다르므로 본사 단위로 admin 만 변경 가능하도록 컬럼화.
--   HQ 는 dashboard 에서 read-only 로만 확인.
--
-- 변경:
--   1) enterprise_settlement_profiles +1 column: monthly_store_price int default 4900 check >= 0
--   2) admin_update_enterprise_payment_settings 시그니처 확장 (+ p_monthly_store_price int default null)
--   3) get_my_enterprise_dashboard commission_preview 계산식 — 컬럼 값 사용
--   4) audit log details 에 monthly_store_price 변경 전/후 값 포함
--
-- 절대 원칙 (Phase 1-10 §3):
--   - 신규 table 0 (ALTER ADD + RPC replace 만)
--   - HQ upsert RPC 의 무수정 정책 유지 — monthly_store_price / commission_rate /
--     minimum_payout / settlement_method 모두 HQ 측 수정 불가
--   - artist / store / player / heartbeat / policy / business subs 무관
--   - 실제 월마감 / 지급확정은 다음 Phase

-- ============================================================
-- 1) enterprise_settlement_profiles +monthly_store_price
-- ============================================================
alter table public.enterprise_settlement_profiles
  add column if not exists monthly_store_price int not null default 4900;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'enterprise_settlement_profiles_monthly_store_price_check'
  ) then
    alter table public.enterprise_settlement_profiles
      add constraint enterprise_settlement_profiles_monthly_store_price_check
      check (monthly_store_price >= 0);
  end if;
end$$;

comment on column public.enterprise_settlement_profiles.monthly_store_price is
  'Phase 1-10 §3 — 본사별 매장당 월 기준 금액(원). admin 만 변경. HQ read-only.';


-- ============================================================
-- 2) admin_update_enterprise_payment_settings — 시그니처 확장
--    기존 0370 (uuid, text, int, numeric) DROP 후 (uuid, text, int, numeric, int) 재생성.
--    p_monthly_store_price null 이면 기존 값 유지.
-- ============================================================
drop function if exists public.admin_update_enterprise_payment_settings(uuid, text, int, numeric);

create or replace function public.admin_update_enterprise_payment_settings(
  p_enterprise_account_id uuid,
  p_settlement_method text,
  p_minimum_payout int,
  p_commission_rate numeric default null,
  p_monthly_store_price int default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.enterprise_settlement_profiles;
  v_row public.enterprise_settlement_profiles;
  v_ea public.enterprise_accounts;
  v_new_commission numeric(5,2);
  v_new_monthly_price int;
  v_prev_monthly_price int;
  v_prev_commission numeric(5,2);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_settlement_method is null or p_settlement_method not in ('monthly','weekly','manual') then
    raise exception 'invalid settlement_method: %', p_settlement_method;
  end if;
  if p_minimum_payout is null or p_minimum_payout < 0 then
    raise exception 'minimum_payout must be >= 0';
  end if;
  if p_commission_rate is not null and (p_commission_rate < 0 or p_commission_rate > 100) then
    raise exception 'commission_rate must be between 0 and 100';
  end if;
  if p_monthly_store_price is not null and p_monthly_store_price < 0 then
    raise exception 'monthly_store_price must be >= 0';
  end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_account_id;
  if v_ea.id is null then
    raise exception 'enterprise not found: %', p_enterprise_account_id;
  end if;

  select * into v_existing from public.enterprise_settlement_profiles
    where enterprise_account_id = p_enterprise_account_id;

  v_prev_commission    := coalesce(v_existing.commission_rate, 20.00);
  v_prev_monthly_price := coalesce(v_existing.monthly_store_price, 4900);
  v_new_commission     := coalesce(p_commission_rate, v_prev_commission);
  v_new_monthly_price  := coalesce(p_monthly_store_price, v_prev_monthly_price);

  if v_existing.id is null then
    insert into public.enterprise_settlement_profiles
      (enterprise_account_id, settlement_method, minimum_payout,
       commission_rate, monthly_store_price)
    values
      (p_enterprise_account_id, p_settlement_method, p_minimum_payout,
       v_new_commission, v_new_monthly_price)
    returning * into v_row;
  else
    update public.enterprise_settlement_profiles
       set settlement_method    = p_settlement_method,
           minimum_payout       = p_minimum_payout,
           commission_rate      = v_new_commission,
           monthly_store_price  = v_new_monthly_price,
           updated_at           = now()
     where enterprise_account_id = p_enterprise_account_id
    returning * into v_row;
  end if;

  perform public.admin_log_operation(
    'enterprise_settlement_profiles', 'admin', 'success', 'payment_settings_update',
    format('Enterprise payment settings → method=%s min=%s commission=%s price=%s (ea=%s)',
      p_settlement_method, p_minimum_payout, v_new_commission,
      v_new_monthly_price, p_enterprise_account_id),
    jsonb_build_object(
      'action', 'enterprise_settlement.payment_settings_update',
      'target_id', p_enterprise_account_id,
      'settlement_method', p_settlement_method,
      'minimum_payout', p_minimum_payout,
      'commission_rate', v_new_commission,
      'monthly_store_price', v_new_monthly_price,
      'commission_rate_before', v_prev_commission,
      'monthly_store_price_before', v_prev_monthly_price
    ),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_row.enterprise_account_id,
    'settlement_method', v_row.settlement_method,
    'minimum_payout', v_row.minimum_payout,
    'commission_rate', v_row.commission_rate,
    'monthly_store_price', v_row.monthly_store_price,
    'updated_at', v_row.updated_at
  );
end;
$$;
revoke execute on function public.admin_update_enterprise_payment_settings(uuid, text, int, numeric, int) from public, anon;
grant execute on function public.admin_update_enterprise_payment_settings(uuid, text, int, numeric, int) to authenticated;


-- ============================================================
-- 3) get_my_enterprise_dashboard — monthly_store_price 컬럼화
--    기존 RPC 상수 4900 제거. enterprise_settlement_profiles.monthly_store_price 사용.
--    profile 미존재 시 default 4900.
-- ============================================================
create or replace function public.get_my_enterprise_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
  v_franchises jsonb;
  v_regions jsonb;
  v_store_count int;
  v_recent_stores jsonb;
  v_business_profile jsonb;
  v_store_stats jsonb;
  v_region_distribution jsonb;
  -- Phase 1-10 §3
  v_monthly_price int;
  v_commission_rate numeric(5,2);
  v_per_store_commission int;
  v_active_store_count int;
  v_commission_preview jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select * into v_ea
    from public.enterprise_accounts
   where auth_user_id = v_uid
     and deleted_at is null
     and status in ('active','invited')
   limit 1;
  if v_ea.id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'slug', f.slug, 'status', f.status,
    'role', ef.role,
    'store_count', (
      select count(*) from public.franchise_stores fs
       where fs.franchise_id = f.id and fs.status = 'active'
    )
  ) order by ef.role, f.name), '[]'::jsonb)
    into v_franchises
    from public.enterprise_franchises ef
    join public.franchises f on f.id = ef.franchise_id
   where ef.enterprise_account_id = v_ea.id and ef.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
    'status', r.status
  ) order by r.region_name), '[]'::jsonb)
    into v_regions
    from public.enterprise_regions r
   where r.enterprise_account_id = v_ea.id and r.deleted_at is null;

  select count(*) into v_store_count
    from public.franchise_stores fs
    join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
      and ef.deleted_at is null
   where ef.enterprise_account_id = v_ea.id and fs.status = 'active';

  with my_stores as (
    select fs.*
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id
  )
  select jsonb_build_object(
    'total',     count(*),
    'active',    count(*) filter (where status = 'active'),
    'inactive',  count(*) filter (where status = 'inactive'),
    'suspended', count(*) filter (where status = 'suspended'),
    'joined_7d', count(*) filter (where joined_at is not null
                                    and joined_at >= now() - interval '7 days')
  ) into v_store_stats from my_stores;

  with my_stores as (
    select fs.*
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id
  ),
  by_region as (
    select er.id as region_id,
           er.region_name,
           er.region_code,
           er.status as region_status,
           coalesce(count(ms.store_id) filter (where ms.status = 'active'), 0)::int as active_count,
           coalesce(count(ms.store_id), 0)::int as total_count
      from public.enterprise_regions er
      left join my_stores ms on ms.enterprise_region_id = er.id
     where er.enterprise_account_id = v_ea.id and er.deleted_at is null
     group by er.id, er.region_name, er.region_code, er.status
  ),
  unassigned as (
    select null::uuid as region_id,
           '(지역 미지정)'::text as region_name,
           null::text as region_code,
           'unassigned'::text as region_status,
           coalesce(count(*) filter (where status = 'active'), 0)::int as active_count,
           coalesce(count(*), 0)::int as total_count
      from my_stores
     where enterprise_region_id is null
     having count(*) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'region_id', region_id,
    'region_name', region_name,
    'region_code', region_code,
    'region_status', region_status,
    'active_count', active_count,
    'total_count', total_count
  ) order by total_count desc, region_name), '[]'::jsonb)
    into v_region_distribution
    from (
      select * from by_region
      union all
      select * from unassigned
    ) merged;

  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', fs.store_id,
    'store_name', fs.store_name,
    'franchise_name', f.name,
    'region_name', er.region_name,
    'joined_at', fs.joined_at,
    'status', fs.status
  ) order by fs.joined_at desc), '[]'::jsonb)
    into v_recent_stores
    from (
      select fs2.* from public.franchise_stores fs2
        join public.enterprise_franchises ef2 on ef2.franchise_id = fs2.franchise_id
          and ef2.deleted_at is null
       where ef2.enterprise_account_id = v_ea.id
       order by fs2.joined_at desc nulls last
       limit 10
    ) fs
    join public.franchises f on f.id = fs.franchise_id
    left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

  select to_jsonb(ebp) into v_business_profile
    from public.enterprise_business_profiles ebp
   where ebp.enterprise_account_id = v_ea.id;

  -- ============================================================
  -- Phase 1-10 §3 — Commission Preview (단가 컬럼화)
  -- monthly_store_price = enterprise_settlement_profiles.monthly_store_price (본사별, default 4900)
  -- commission_rate     = enterprise_settlement_profiles.commission_rate (본사별, default 20.00)
  -- per_store_commission = floor(monthly_store_price * commission_rate / 100)
  -- active_store_count   = franchise_stores.status='active' (Q1=A)
  -- estimated_monthly_commission = active_store_count * per_store_commission
  -- ============================================================
  select coalesce(monthly_store_price, 4900),
         coalesce(commission_rate, 20.00)
    into v_monthly_price, v_commission_rate
    from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea.id;
  if v_monthly_price  is null then v_monthly_price  := 4900;   end if;
  if v_commission_rate is null then v_commission_rate := 20.00; end if;

  v_active_store_count   := v_store_count;
  v_per_store_commission := floor(v_monthly_price * v_commission_rate / 100)::int;

  v_commission_preview := jsonb_build_object(
    'monthly_store_price', v_monthly_price,
    'commission_rate', v_commission_rate,
    'per_store_commission', v_per_store_commission,
    'active_store_count', v_active_store_count,
    'paid_store_count', v_active_store_count,
    'estimated_monthly_commission', v_active_store_count * v_per_store_commission,
    'computed_at', now()
  );

  return jsonb_build_object(
    'success', true,
    'enterprise_account', jsonb_build_object(
      'id', v_ea.id,
      'enterprise_name', v_ea.enterprise_name,
      'brand_code', v_ea.brand_code,
      'manager_name', v_ea.manager_name,
      'manager_email', v_ea.manager_email,
      'manager_phone', v_ea.manager_phone,
      'role', v_ea.role,
      'status', v_ea.status,
      'onboarding_enabled', v_ea.onboarding_enabled,
      'allow_self_register_region', v_ea.allow_self_register_region,
      'hq_invite_code', v_ea.hq_invite_code,
      'store_invite_code', v_ea.store_invite_code,
      'invite_code_rotated_at', v_ea.invite_code_rotated_at,
      'last_login_at', v_ea.last_login_at
    ),
    'franchises', v_franchises,
    'regions', v_regions,
    'store_count', v_store_count,
    'store_stats', v_store_stats,
    'region_distribution', v_region_distribution,
    'recent_stores', v_recent_stores,
    'business_profile', v_business_profile,
    'business_profile_present', v_business_profile is not null,
    'commission_preview', v_commission_preview,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_dashboard() from public, anon;
grant execute on function public.get_my_enterprise_dashboard() to authenticated;

comment on function public.get_my_enterprise_dashboard() is
  'Phase 1-10 §3 — HQ dashboard + commission_preview (monthly_store_price 컬럼화).';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_col int;
  v_check int;
  v_rpc_admin int;
  v_rpc_dash int;
  v_admin_sig_new int;
begin
  select count(*) into v_col from information_schema.columns
    where table_schema='public'
      and table_name='enterprise_settlement_profiles'
      and column_name='monthly_store_price';
  select count(*) into v_check from pg_constraint
    where conname='enterprise_settlement_profiles_monthly_store_price_check';
  select count(*) into v_rpc_admin from pg_proc
    where proname='admin_update_enterprise_payment_settings';
  select count(*) into v_admin_sig_new from pg_proc
    where proname='admin_update_enterprise_payment_settings'
      and pg_get_function_identity_arguments(oid) =
          'p_enterprise_account_id uuid, p_settlement_method text, p_minimum_payout integer, p_commission_rate numeric, p_monthly_store_price integer';
  select count(*) into v_rpc_dash from pg_proc
    where proname='get_my_enterprise_dashboard';

  raise notice '====== 0371 monthly_store_price Diagnostics ======';
  raise notice 'enterprise_settlement_profiles.monthly_store_price: % / 1', v_col;
  raise notice 'check constraint (>= 0): % / 1', v_check;
  raise notice 'admin_update_enterprise_payment_settings (any): % / 1', v_rpc_admin;
  raise notice 'admin_update_enterprise_payment_settings (new sig 5 args): % / 1', v_admin_sig_new;
  raise notice 'get_my_enterprise_dashboard: % / 1', v_rpc_dash;
  raise notice '=================================================';

  if v_col=1 and v_check=1 and v_rpc_admin=1 and v_admin_sig_new=1 and v_rpc_dash=1 then
    raise notice '0371 COMPLETE — monthly_store_price admin-only ready';
  else
    raise warning '0371 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
