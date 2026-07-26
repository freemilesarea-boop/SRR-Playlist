-- HQ 진입(CTA) RPC — exact from migrations 0364 / 0371.
-- ProfilePage(get_my_enterprise_role) + /enterprise/me(get_my_enterprise_dashboard) 지원.

create or replace function public.get_my_enterprise_role()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
begin
  if v_uid is null then return jsonb_build_object('is_hq', false); end if;
  select * into v_ea from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea.id is null then return jsonb_build_object('is_hq', false); end if;
  return jsonb_build_object('is_hq', true, 'enterprise_account_id', v_ea.id,
    'enterprise_name', v_ea.enterprise_name, 'brand_code', v_ea.brand_code, 'status', v_ea.status);
end;$$;
revoke execute on function public.get_my_enterprise_role() from public, anon;
grant execute on function public.get_my_enterprise_role() to authenticated;

create or replace function public.get_my_enterprise_store_info()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then return jsonb_build_object('is_store', false); end if;
  select fs.store_name, fs.status as store_status, fs.enterprise_region_id, f.id as franchise_id,
    f.name as franchise_name, er.region_name, er.region_code, ea.id as enterprise_account_id,
    ea.enterprise_name, ea.brand_code
  into v_row
  from public.users u
  join public.franchise_stores fs on fs.store_id = u.id
  join public.franchises f on f.id = fs.franchise_id
  left join public.enterprise_regions er on er.id = fs.enterprise_region_id
  left join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
  left join public.enterprise_accounts ea on ea.id = ef.enterprise_account_id and ea.deleted_at is null
  where u.id = v_uid and coalesce(u.account_type, 'individual') = 'business' and u.withdrawn_at is null and fs.status = 'active'
  order by case ef.role when 'primary' then 0 else 1 end nulls last limit 1;
  if v_row.franchise_id is null then return jsonb_build_object('is_store', false); end if;
  return jsonb_build_object('is_store', true, 'store_name', v_row.store_name, 'store_status', v_row.store_status,
    'franchise_id', v_row.franchise_id, 'franchise_name', v_row.franchise_name, 'region_name', v_row.region_name,
    'region_code', v_row.region_code, 'enterprise_account_id', v_row.enterprise_account_id,
    'enterprise_name', v_row.enterprise_name, 'brand_code', v_row.brand_code);
end;$$;
revoke execute on function public.get_my_enterprise_store_info() from public, anon;
grant execute on function public.get_my_enterprise_store_info() to authenticated;

create or replace function public.get_my_enterprise_dashboard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
  v_franchises jsonb; v_regions jsonb; v_store_count int; v_recent_stores jsonb;
  v_business_profile jsonb; v_store_stats jsonb; v_region_distribution jsonb;
  v_monthly_price int; v_commission_rate numeric(5,2); v_per_store_commission int;
  v_active_store_count int; v_commission_preview jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_ea from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea.id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'slug', f.slug, 'status', f.status,
    'role', ef.role, 'store_count', (select count(*) from public.franchise_stores fs where fs.franchise_id = f.id and fs.status = 'active')
  ) order by ef.role, f.name), '[]'::jsonb) into v_franchises
  from public.enterprise_franchises ef join public.franchises f on f.id = ef.franchise_id
  where ef.enterprise_account_id = v_ea.id and ef.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
    'status', r.status) order by r.region_name), '[]'::jsonb) into v_regions
  from public.enterprise_regions r where r.enterprise_account_id = v_ea.id and r.deleted_at is null;

  select count(*) into v_store_count from public.franchise_stores fs
    join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
   where ef.enterprise_account_id = v_ea.id and fs.status = 'active';

  with my_stores as (select fs.* from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id)
  select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'active'),
    'inactive', count(*) filter (where status = 'inactive'), 'suspended', count(*) filter (where status = 'suspended'),
    'joined_7d', count(*) filter (where joined_at is not null and joined_at >= now() - interval '7 days')
  ) into v_store_stats from my_stores;

  with my_stores as (select fs.* from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id),
  by_region as (select er.id as region_id, er.region_name, er.region_code, er.status as region_status,
      coalesce(count(ms.store_id) filter (where ms.status = 'active'), 0)::int as active_count,
      coalesce(count(ms.store_id), 0)::int as total_count
    from public.enterprise_regions er left join my_stores ms on ms.enterprise_region_id = er.id
    where er.enterprise_account_id = v_ea.id and er.deleted_at is null
    group by er.id, er.region_name, er.region_code, er.status),
  unassigned as (select null::uuid as region_id, '(지역 미지정)'::text as region_name, null::text as region_code,
      'unassigned'::text as region_status, coalesce(count(*) filter (where status = 'active'), 0)::int as active_count,
      coalesce(count(*), 0)::int as total_count from my_stores where enterprise_region_id is null having count(*) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('region_id', region_id, 'region_name', region_name, 'region_code', region_code,
    'region_status', region_status, 'active_count', active_count, 'total_count', total_count
  ) order by total_count desc, region_name), '[]'::jsonb) into v_region_distribution
  from (select * from by_region union all select * from unassigned) merged;

  select coalesce(jsonb_agg(jsonb_build_object('store_id', fs.store_id, 'store_name', fs.store_name,
    'franchise_name', f.name, 'region_name', er.region_name, 'joined_at', fs.joined_at, 'status', fs.status
  ) order by fs.joined_at desc), '[]'::jsonb) into v_recent_stores
  from (select fs2.* from public.franchise_stores fs2
      join public.enterprise_franchises ef2 on ef2.franchise_id = fs2.franchise_id and ef2.deleted_at is null
     where ef2.enterprise_account_id = v_ea.id order by fs2.joined_at desc nulls last limit 10) fs
  join public.franchises f on f.id = fs.franchise_id
  left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

  select to_jsonb(ebp) into v_business_profile from public.enterprise_business_profiles ebp where ebp.enterprise_account_id = v_ea.id;

  select coalesce(monthly_store_price, 4900), coalesce(commission_rate, 20.00) into v_monthly_price, v_commission_rate
  from public.enterprise_settlement_profiles where enterprise_account_id = v_ea.id;
  if v_monthly_price is null then v_monthly_price := 4900; end if;
  if v_commission_rate is null then v_commission_rate := 20.00; end if;
  v_active_store_count := v_store_count;
  v_per_store_commission := floor(v_monthly_price * v_commission_rate / 100)::int;
  v_commission_preview := jsonb_build_object('monthly_store_price', v_monthly_price, 'commission_rate', v_commission_rate,
    'per_store_commission', v_per_store_commission, 'active_store_count', v_active_store_count,
    'paid_store_count', v_active_store_count, 'estimated_monthly_commission', v_active_store_count * v_per_store_commission,
    'computed_at', now());

  return jsonb_build_object('success', true, 'enterprise_account', jsonb_build_object('id', v_ea.id,
    'enterprise_name', v_ea.enterprise_name, 'brand_code', v_ea.brand_code, 'manager_name', v_ea.manager_name,
    'manager_email', v_ea.manager_email, 'manager_phone', v_ea.manager_phone, 'role', v_ea.role, 'status', v_ea.status,
    'onboarding_enabled', v_ea.onboarding_enabled, 'allow_self_register_region', v_ea.allow_self_register_region,
    'hq_invite_code', v_ea.hq_invite_code, 'store_invite_code', v_ea.store_invite_code,
    'invite_code_rotated_at', v_ea.invite_code_rotated_at, 'last_login_at', v_ea.last_login_at),
    'franchises', v_franchises, 'regions', v_regions, 'store_count', v_store_count, 'store_stats', v_store_stats,
    'region_distribution', v_region_distribution, 'recent_stores', v_recent_stores, 'business_profile', v_business_profile,
    'business_profile_present', v_business_profile is not null, 'commission_preview', v_commission_preview, 'computed_at', now());
end;$$;
revoke execute on function public.get_my_enterprise_dashboard() from public, anon;
grant execute on function public.get_my_enterprise_dashboard() to authenticated;
