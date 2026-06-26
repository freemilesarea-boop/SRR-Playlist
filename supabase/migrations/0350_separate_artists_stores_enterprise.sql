-- 0350 — 아티스트/매장/엔터프라이즈 계정 분리
--
-- 1) /sales 매장 리스트 (salesperson_my_stores) — artist/admin/탈퇴회원 제외 (BUG FIX)
-- 2) Enterprise Admin Dashboard RPC (super admin 전용, cross-franchise 집계)
-- 3) Franchise HQ Dashboard RPC (본사 계정 자기 브랜드 only)
-- 4) get_my_franchise_admin() 헬퍼 (프론트 권한 게이팅)
--
-- 절대 금지:
--   - artist_settlement / store player 로직 무수정
--   - users 스키마 변경 X (account_type / role / withdrawn_at 기존 컬럼 활용)
--   - 기존 salesperson_my_stores 시그니처/return 모양 보존 (필터만 추가)

-- ============================================================
-- 1) salesperson_my_stores — 매장 리스트 필터 강화
--    BUG: 기존엔 sales_agent_id 만 매칭 → artist 계정도 포함
--    FIX: account_type='business' AND withdrawn_at IS NULL AND role != 'admin'
--         AND artist_profiles 에 없음 (이중 안전장치)
-- ============================================================
create or replace function public.salesperson_my_stores()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent record; v jsonb;
begin
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  if v_agent.id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.last_play_at desc nulls last, x.joined_at desc), '[]'::jsonb) into v from (
    select u.id as store_user_id,
      coalesce(bp.store_name, u.nickname, '(매장명 없음)') as store_name,
      coalesce(u.full_name, u.nickname) as owner_name,
      u.created_at as joined_at,
      (select s.status from public.subscriptions s where s.user_id=u.id order by s.created_at desc limit 1) as subscription_status,
      (select po.status from public.payment_orders po where po.user_id=u.id order by coalesce(po.paid_at,po.created_at) desc limit 1) as payment_status,
      (select max(e.created_at) from public.track_play_events e where e.user_id=u.id) as last_play_at,
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at > now()-interval '30 days') as plays_30d,
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at > now()-interval '14 days') as plays_14d,
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at <= now()-interval '14 days' and e.created_at > now()-interval '28 days') as plays_prev_14d,
      (select coalesce(jsonb_agg(distinct pl.title), '[]'::jsonb) from public.track_play_events e join public.playlists pl on pl.id=e.playlist_id
        where e.user_id=u.id and e.created_at > now()-interval '30 days' and pl.title is not null) as recent_playlists,
      (select coalesce(s.current_amount, s.price, 0) from public.subscriptions s where s.user_id=u.id order by s.created_at desc limit 1) as monthly_amount,
      floor(coalesce((select sum(po.amount) from public.payment_orders po where po.user_id=u.id and po.status='paid' and po.sales_agent_id=v_agent.id),0) * coalesce(v_agent.commission_rate,0) / 100.0)::bigint as est_commission
    from public.users u
    left join public.business_profiles bp on bp.user_id = u.id
    where u.sales_agent_id = v_agent.id
      -- X6.90 BUG FIX: artist / admin / 탈퇴회원 제외
      and coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and coalesce(u.role, 'user') <> 'admin'
      -- 이중 안전장치: artist_profiles 에 등록된 계정 제외
      and not exists (select 1 from public.artist_profiles ap where ap.user_id = u.id)
  ) x;
  return v;
end; $$;

comment on function public.salesperson_my_stores() is
  'X6.90 — /sales 매장 리스트. account_type=business + 탈퇴/admin/artist 제외 (X6.90 BUG FIX).';


-- ============================================================
-- 2) get_my_franchise_admin() — 프론트 권한 게이팅
-- ============================================================
create or replace function public.get_my_franchise_admin()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_row record;
begin
  if auth.uid() is null then
    return jsonb_build_object('is_franchise_admin', false);
  end if;

  select fa.franchise_id, fa.role as admin_role,
         f.name as franchise_name, f.slug as franchise_slug, f.status as franchise_status
    into v_row
    from public.franchise_admins fa
    join public.franchises f on f.id = fa.franchise_id
   where fa.user_id = auth.uid()
   order by case fa.role when 'owner' then 1 when 'admin' then 2 else 3 end
   limit 1;

  if v_row.franchise_id is null then
    return jsonb_build_object('is_franchise_admin', false);
  end if;

  return jsonb_build_object(
    'is_franchise_admin', true,
    'franchise_id', v_row.franchise_id,
    'franchise_name', v_row.franchise_name,
    'franchise_slug', v_row.franchise_slug,
    'franchise_status', v_row.franchise_status,
    'admin_role', v_row.admin_role
  );
end; $$;
grant execute on function public.get_my_franchise_admin() to authenticated;


-- ============================================================
-- 3) admin_enterprise_overview() — super admin cross-franchise 집계
-- ============================================================
create or replace function public.admin_enterprise_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_offline_threshold timestamptz := now() - interval '3 minutes';
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return jsonb_build_object(
    'total_franchises', (select count(*) from public.franchises where status = 'active'),
    'total_brands', (select count(*) from public.franchises),  -- archived 포함 brand 수
    'total_linked_stores', (select count(*) from public.franchise_stores where status='active'),
    'online_stores', (
      select count(*) from public.franchise_stores fs
        left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
       where fs.status='active'
         and ss.last_seen_at is not null and ss.last_seen_at >= v_offline_threshold
    ),
    'offline_stores', (
      select count(*) from public.franchise_stores fs
        left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
       where fs.status='active'
         and (ss.last_seen_at is null or ss.last_seen_at < v_offline_threshold)
    ),
    'active_policies', (select count(*) from public.franchise_music_policies where status='active'),
    'recent_policy_updates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'policy_id', p.id, 'policy_name', p.name,
        'franchise_id', p.franchise_id, 'franchise_name', f.name,
        'updated_at', p.updated_at
      ) order by p.updated_at desc), '[]'::jsonb)
      from (
        select * from public.franchise_music_policies
         where status='active' order by updated_at desc limit 10
      ) p
      left join public.franchises f on f.id = p.franchise_id
    ),
    'per_franchise', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'franchise_id', f.id, 'name', f.name, 'slug', f.slug, 'status', f.status,
        'store_count', (select count(*) from public.franchise_stores where franchise_id=f.id and status='active'),
        'online_count', (
          select count(*) from public.franchise_stores fs
            left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
           where fs.franchise_id=f.id and fs.status='active'
             and ss.last_seen_at is not null and ss.last_seen_at >= v_offline_threshold
        ),
        'active_policy_count', (select count(*) from public.franchise_music_policies where franchise_id=f.id and status='active'),
        'current_default_policy', (
          select jsonb_build_object('id', p.id, 'name', p.name)
            from public.franchise_music_policies p
           where p.franchise_id=f.id and p.status='active' and p.is_default=true
           limit 1
        ),
        -- 월 예상 매출: 본 franchise 의 모든 active store user 의 최근 구독료 합계
        'estimated_monthly_revenue', (
          select coalesce(sum(coalesce(s.current_amount, s.price, 0)), 0)::bigint
            from public.franchise_stores fs
            left join lateral (
              select current_amount, price from public.subscriptions
               where user_id = fs.store_id order by created_at desc limit 1
            ) s on true
           where fs.franchise_id=f.id and fs.status='active'
        )
      ) order by f.created_at desc), '[]'::jsonb)
      from public.franchises f
    ),
    'offline_threshold_seconds', 180,
    'computed_at', now()
  );
end; $$;
grant execute on function public.admin_enterprise_overview() to authenticated;


-- ============================================================
-- 4) get_my_franchise_hq_dashboard() — 본사 계정 자기 브랜드 only
--    auth.uid() 의 franchise_admins 행을 우선 찾고, 그 franchise 만 반환
-- ============================================================
create or replace function public.get_my_franchise_hq_dashboard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_franchise_id uuid; v_admin_role text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;

  select franchise_id, role into v_franchise_id, v_admin_role
    from public.franchise_admins
   where user_id = auth.uid()
   order by case role when 'owner' then 1 when 'admin' then 2 else 3 end
   limit 1;

  if v_franchise_id is null then
    raise exception 'forbidden: not a franchise admin';
  end if;

  -- get_franchise_dashboard 재사용 (이미 자기 franchise 권한 체크 + 데이터 반환)
  return public.get_franchise_dashboard(v_franchise_id)
    || jsonb_build_object('admin_role', v_admin_role);
end; $$;
grant execute on function public.get_my_franchise_hq_dashboard() to authenticated;


-- ============================================================
-- 5) get_my_franchise_sync_status() — 본사 계정 자기 매장 sync
-- ============================================================
create or replace function public.get_my_franchise_sync_status()
returns table (
  store_id uuid, store_name text, region_id uuid, region_name text,
  active_policy_id uuid, active_policy_name text, active_version_number int,
  last_seen_at timestamptz, last_synced_at timestamptz,
  current_track_id uuid, current_track_title text,
  player_status text, is_offline boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_franchise_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise_id
    from public.franchise_admins
   where user_id = auth.uid() limit 1;
  if v_franchise_id is null then raise exception 'forbidden: not a franchise admin'; end if;
  return query
    select * from public.admin_list_franchise_sync_status(v_franchise_id);
end; $$;
grant execute on function public.get_my_franchise_sync_status() to authenticated;


-- ============================================================
-- 6) get_my_franchise_policies() — 본사 계정 자기 정책 목록
-- ============================================================
create or replace function public.get_my_franchise_policies()
returns setof public.franchise_music_policies
language plpgsql stable security definer set search_path to 'public' as $$
declare v_franchise_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise_id
    from public.franchise_admins
   where user_id = auth.uid() limit 1;
  if v_franchise_id is null then raise exception 'forbidden: not a franchise admin'; end if;
  return query
    select * from public.franchise_music_policies
     where franchise_id = v_franchise_id
     order by updated_at desc;
end; $$;
grant execute on function public.get_my_franchise_policies() to authenticated;
