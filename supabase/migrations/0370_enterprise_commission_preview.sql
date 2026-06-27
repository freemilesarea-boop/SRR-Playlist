-- 0370 — Phase 1-10: Enterprise HQ 예상 정산금 (commission preview)
--
-- 정책:
--   매장 1개당 월 구독료 4,900원 × 본사별 수수료율 = 본사 정산금.
--   기본 수수료율 20% (본사별 변경 가능 — admin only).
--   per_store_commission = floor(4900 * commission_rate / 100)
--   estimated_monthly_commission = active_store_count * per_store_commission
--
--   현재 매장별 결제 데이터가 없으므로 "active paid store" 는
--   franchise_stores.status = 'active' 로 정의 (Phase 1-10, Q1=A).
--   추후 매장별 결제 도입 시 별도 Phase 에서 paid 기준 교체.
--
--   monthly_store_price 4,900원 은 전사 일괄 상수 (RPC 내 hard-code, Q2=A).
--   향후 요금제/본사별 단가 도입 시 system_settings 또는 컬럼으로 분리.
--
-- 변경:
--   1) enterprise_settlement_profiles +1 column: commission_rate numeric(5,2) default 20.00 check 0~100
--   2) admin_update_enterprise_payment_settings 시그니처 확장 (+ p_commission_rate numeric default null)
--   3) get_my_enterprise_dashboard 본문 교체 — commission_preview 반환 추가
--
-- 절대 원칙 (Phase 1-10):
--   - 신규 table 0 (ALTER ADD + RPC replace 만)
--   - artist settlement / payout 무관
--   - store / player / heartbeat / policy 무관
--   - business subscriptions / 결제 무관
--   - 실제 월마감 / 지급확정 / 세금계산서 발행은 다음 Phase

-- ============================================================
-- 1) enterprise_settlement_profiles +commission_rate
-- ============================================================
alter table public.enterprise_settlement_profiles
  add column if not exists commission_rate numeric(5,2) not null default 20.00;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'enterprise_settlement_profiles_commission_rate_check'
  ) then
    alter table public.enterprise_settlement_profiles
      add constraint enterprise_settlement_profiles_commission_rate_check
      check (commission_rate >= 0 and commission_rate <= 100);
  end if;
end$$;

comment on column public.enterprise_settlement_profiles.commission_rate is
  'Phase 1-10 — 본사별 정산 수수료율 (%). admin 만 변경. HQ read-only.';


-- ============================================================
-- 2) admin_update_enterprise_payment_settings — 시그니처 확장
--    기존 0369 (uuid, text, int) DROP 후 (uuid, text, int, numeric) 재생성.
--    p_commission_rate null 이면 기존 값 유지.
-- ============================================================
drop function if exists public.admin_update_enterprise_payment_settings(uuid, text, int);

create or replace function public.admin_update_enterprise_payment_settings(
  p_enterprise_account_id uuid,
  p_settlement_method text,
  p_minimum_payout int,
  p_commission_rate numeric default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.enterprise_settlement_profiles;
  v_row public.enterprise_settlement_profiles;
  v_ea public.enterprise_accounts;
  v_new_commission numeric(5,2);
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

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_account_id;
  if v_ea.id is null then
    raise exception 'enterprise not found: %', p_enterprise_account_id;
  end if;

  select * into v_existing from public.enterprise_settlement_profiles
    where enterprise_account_id = p_enterprise_account_id;

  v_new_commission := coalesce(p_commission_rate, v_existing.commission_rate, 20.00);

  if v_existing.id is null then
    insert into public.enterprise_settlement_profiles
      (enterprise_account_id, settlement_method, minimum_payout, commission_rate)
    values
      (p_enterprise_account_id, p_settlement_method, p_minimum_payout, v_new_commission)
    returning * into v_row;
  else
    update public.enterprise_settlement_profiles
       set settlement_method = p_settlement_method,
           minimum_payout    = p_minimum_payout,
           commission_rate   = v_new_commission,
           updated_at        = now()
     where enterprise_account_id = p_enterprise_account_id
    returning * into v_row;
  end if;

  perform public.admin_log_operation(
    'enterprise_settlement_profiles', 'admin', 'success', 'payment_settings_update',
    format('Enterprise payment settings → method=%s min=%s commission=%s (ea=%s)',
      p_settlement_method, p_minimum_payout, v_new_commission, p_enterprise_account_id),
    jsonb_build_object(
      'action', 'enterprise_settlement.payment_settings_update',
      'target_id', p_enterprise_account_id,
      'settlement_method', p_settlement_method,
      'minimum_payout', p_minimum_payout,
      'commission_rate', v_new_commission
    ),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_row.enterprise_account_id,
    'settlement_method', v_row.settlement_method,
    'minimum_payout', v_row.minimum_payout,
    'commission_rate', v_row.commission_rate,
    'updated_at', v_row.updated_at
  );
end;
$$;
revoke execute on function public.admin_update_enterprise_payment_settings(uuid, text, int, numeric) from public, anon;
grant execute on function public.admin_update_enterprise_payment_settings(uuid, text, int, numeric) to authenticated;


-- ============================================================
-- 3) get_my_enterprise_dashboard 본문 교체 — commission_preview 추가
--    기존 반환 필드 모두 유지. commission_preview 만 추가.
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
  -- Phase 1-10
  v_monthly_price constant int := 4900;
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

  -- 매장 현황
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

  -- 지역별 매장 분포
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

  -- 최근 매장
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

  -- business profile
  select to_jsonb(ebp) into v_business_profile
    from public.enterprise_business_profiles ebp
   where ebp.enterprise_account_id = v_ea.id;

  -- ============================================================
  -- Phase 1-10 — Commission Preview
  -- monthly_store_price = 4,900 (전사 상수)
  -- commission_rate = enterprise_settlement_profiles.commission_rate (본사별, default 20.00)
  -- per_store_commission = floor(monthly_store_price * commission_rate / 100)
  -- active_store_count = franchise_stores.status='active' (Q1=A)
  -- estimated_monthly_commission = active_store_count * per_store_commission
  -- ============================================================
  select coalesce(commission_rate, 20.00) into v_commission_rate
    from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea.id;
  if v_commission_rate is null then v_commission_rate := 20.00; end if;

  v_active_store_count := v_store_count;  -- status='active' 이미 위에서 집계
  v_per_store_commission := floor(v_monthly_price * v_commission_rate / 100)::int;

  v_commission_preview := jsonb_build_object(
    'monthly_store_price', v_monthly_price,
    'commission_rate', v_commission_rate,
    'per_store_commission', v_per_store_commission,
    'active_store_count', v_active_store_count,
    'paid_store_count', v_active_store_count,  -- Q1=A: paid := active
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
    'commission_preview', v_commission_preview,  -- Phase 1-10 신규
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_dashboard() from public, anon;
grant execute on function public.get_my_enterprise_dashboard() to authenticated;

comment on function public.get_my_enterprise_dashboard() is
  'Phase 1-10 — HQ dashboard + commission_preview (active_store_count * per_store_commission).';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_col int;
  v_check int;
  v_rpc_admin int;
  v_rpc_dash int;
begin
  select count(*) into v_col from information_schema.columns
    where table_schema='public'
      and table_name='enterprise_settlement_profiles'
      and column_name='commission_rate';
  select count(*) into v_check from pg_constraint
    where conname='enterprise_settlement_profiles_commission_rate_check';
  select count(*) into v_rpc_admin from pg_proc
    where proname='admin_update_enterprise_payment_settings';
  select count(*) into v_rpc_dash from pg_proc
    where proname='get_my_enterprise_dashboard';

  raise notice '====== 0370 Commission Preview Diagnostics ======';
  raise notice 'enterprise_settlement_profiles.commission_rate: % / 1', v_col;
  raise notice 'check constraint (0~100): % / 1', v_check;
  raise notice 'admin_update_enterprise_payment_settings (uuid,text,int,numeric): % / 1', v_rpc_admin;
  raise notice 'get_my_enterprise_dashboard: % / 1', v_rpc_dash;
  raise notice '=================================================';

  if v_col = 1 and v_check = 1 and v_rpc_admin = 1 and v_rpc_dash = 1 then
    raise notice '0370 COMPLETE — commission_preview ready';
  else
    raise warning '0370 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
