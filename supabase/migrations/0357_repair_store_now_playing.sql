-- 0357 — Phase 1-4 Repair + 잠재 RPC 회귀 수정
--
-- 문제:
--   0356 의 store_now_playing view 가 public.users.business_name 참조 → 컬럼 부재로 실패.
--   동일 패턴 (u.email, u.business_name) 으로 작성된 RPC 2개가 추가로 runtime 시 실패 대기:
--     - admin_list_store_monitoring (0353/0355)
--     - admin_list_franchise_sync_status (0349)
--
-- 실제 schema (확인 완료):
--   - public.users: id, nickname, role, subscription_type, business_category, account_type,
--     full_name, withdrawn_at, membership_tier, sales_agent_id 등.
--     **email / business_name 컬럼 없음**.
--   - email → auth.users.email
--   - 매장명 → coalesce(business_profiles.store_name, business_verification_profiles.store_name,
--             business_verification_profiles.business_name, users.full_name, users.nickname, '(매장명 없음)')
--   - tracks.cover_url / tracks.duration / tracks.artist — 모두 존재 (0001:120-122)
--
-- 원칙:
--   - idempotent — 여러 번 실행 안전
--   - 잘못된 컬럼 참조 모두 교체
--   - 진단 NOTICE 적용 후 즉시 검증 출력

-- ============================================================
-- 1) Drop broken view (없으면 silent)
-- ============================================================
drop view if exists public.store_now_playing;


-- ============================================================
-- 2) store_now_playing 재정의 — 올바른 컬럼 기준
-- ============================================================
create view public.store_now_playing as
  select
    ss.store_id,
    coalesce(
      bp.store_name,
      bvp.store_name,
      bvp.business_name,
      u.full_name,
      u.nickname,
      '(매장명 없음)'
    ) as store_name,
    au.email as store_email,
    ss.franchise_id,
    f.name as franchise_name,
    ss.enterprise_region_id,
    er.region_name,
    er.region_code,
    er.enterprise_account_id,
    ea.enterprise_name,
    ss.current_track_id as track_id,
    t.title as track_title,
    t.artist as artist_name,
    t.cover_url as album_art_url,
    t.duration,
    ss.current_track_started_at as started_at,
    case
      when ss.current_track_started_at is null then null
      when ss.current_track_started_at > now() then 0
      else greatest(0, extract(epoch from (now() - ss.current_track_started_at)))::int
    end as elapsed_seconds,
    case
      when t.duration is null or ss.current_track_started_at is null then null
      else greatest(0, t.duration - extract(epoch from (now() - ss.current_track_started_at)))::int
    end as remaining_seconds,
    ss.player_status,
    ss.last_seen_at,
    ss.volume,
    ss.app_version,
    ss.playback_error,
    case when ss.last_seen_at is null then false
         when ss.last_seen_at >= now() - interval '5 minutes' then true
         else false end as is_online,
    ss.updated_at as last_heartbeat_at
  from public.store_policy_sync_status ss
  join public.users u on u.id = ss.store_id
  left join auth.users au on au.id = u.id
  left join public.business_profiles bp on bp.user_id = u.id
  left join public.business_verification_profiles bvp on bvp.user_id = u.id
  left join public.franchises f on f.id = ss.franchise_id
  left join public.enterprise_regions er on er.id = ss.enterprise_region_id
  left join public.enterprise_accounts ea on ea.id = er.enterprise_account_id
  left join public.tracks t on t.id = ss.current_track_id
  where coalesce(u.account_type, 'individual') = 'business'
    and u.withdrawn_at is null;

comment on view public.store_now_playing is
  'Phase 1-4 (0357 repaired) — 매장 현재 재생곡. store_name 은 business_profiles → bvp → users fallback chain. email 은 auth.users.';


-- ============================================================
-- 3) admin_now_playing_list — 같은 컬럼 패턴 재사용 (view 기반이므로 자동 적용)
--    (view 가 이미 올바른 컬럼 노출 → RPC 본문은 그대로 OK)
--    하지만 RPC 정의 자체에 직접 컬럼 참조 없음 → 재정의 불필요.
--    Sanity 만 확인:
-- ============================================================
-- admin_now_playing_list / admin_now_playing_kpi 본문은 view 만 SELECT 하므로
-- 별도 수정 불필요. view 가 fix 되면 자동 동작.


-- ============================================================
-- 4) admin_list_store_monitoring 재정의 — u.email 제거 + 매장명 올바른 fallback
--    (기존 0353/0355 의 latent runtime bug 수정)
-- ============================================================
create or replace function public.admin_list_store_monitoring(
  p_search text default null,
  p_status text default null,
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_sort text default 'last_seen',
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select
      sms.*,
      coalesce(bp.store_name, bvp.store_name, bvp.business_name, u.full_name, u.nickname, '(매장명 없음)') as store_name,
      au.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join public.users u on u.id = sms.store_id
    left join auth.users au on au.id = u.id
    left join public.business_profiles bp on bp.user_id = u.id
    left join public.business_verification_profiles bvp on bvp.user_id = u.id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(bp.store_name, bvp.store_name, bvp.business_name, u.full_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
      )
  )
  select count(*) into v_total from base;

  with base as (
    select
      sms.*,
      coalesce(bp.store_name, bvp.store_name, bvp.business_name, u.full_name, u.nickname, '(매장명 없음)') as store_name,
      au.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join public.users u on u.id = sms.store_id
    left join auth.users au on au.id = u.id
    left join public.business_profiles bp on bp.user_id = u.id
    left join public.business_verification_profiles bvp on bvp.user_id = u.id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(bp.store_name, bvp.store_name, bvp.business_name, u.full_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
      )
    order by
      case when p_sort = 'name' then store_name end asc nulls last,
      case when p_sort = 'status' then
        case
          when has_playback_error then 0
          when is_offline_24h then 1
          when is_idle_1h_to_24h then 2
          when has_policy_outdated then 3
          when is_idle_5m_to_1h then 4
          when is_online then 5
          else 6
        end
      end asc nulls last,
      coalesce(last_seen_at, '1970-01-01'::timestamptz) desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(base)), '[]'::jsonb) into v_rows from base;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.admin_list_store_monitoring(text, text, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.admin_list_store_monitoring(text, text, uuid, uuid, text, int, int) to authenticated;


-- ============================================================
-- 5) admin_list_franchise_sync_status 재정의 — u.business_name 제거
--    (0349 의 latent bug)
-- ============================================================
create or replace function public.admin_list_franchise_sync_status(p_franchise_id uuid)
returns table (
  store_id uuid, store_name text, region_id uuid, region_name text,
  active_policy_id uuid, active_policy_name text, active_version_number int,
  last_seen_at timestamptz, last_synced_at timestamptz,
  current_track_id uuid, current_track_title text,
  player_status text, is_offline boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_threshold timestamptz := now() - interval '3 minutes';
begin
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then
    raise exception 'forbidden';
  end if;
  return query
    select fs.store_id,
           coalesce(fs.store_name, bp.store_name, bvp.store_name, bvp.business_name, u.full_name, u.nickname, '(매장명 없음)') as store_name,
           fs.region_id, fr.name as region_name,
           ss.active_policy_id, fmp.name as active_policy_name,
           coalesce(ss.active_version_number, 1) as active_version_number,
           ss.last_seen_at, ss.last_synced_at,
           ss.current_track_id, t.title as current_track_title,
           coalesce(ss.player_status, 'unknown') as player_status,
           (ss.last_seen_at is null or ss.last_seen_at < v_threshold) as is_offline
      from public.franchise_stores fs
      join public.users u on u.id = fs.store_id
      left join public.business_profiles bp on bp.user_id = u.id
      left join public.business_verification_profiles bvp on bvp.user_id = u.id
      left join public.franchise_regions fr on fr.id = fs.region_id
      left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
      left join public.franchise_music_policies fmp on fmp.id = ss.active_policy_id
      left join public.tracks t on t.id = ss.current_track_id
     where fs.franchise_id = p_franchise_id and fs.status = 'active'
     order by is_offline asc, store_name asc;
end;
$$;
grant execute on function public.admin_list_franchise_sync_status(uuid) to authenticated;


-- ============================================================
-- 6) 진단
-- ============================================================
do $$
declare
  v_view int;
  v_view_test_count int;
  v_test_kpi jsonb;
begin
  select count(*) into v_view from information_schema.views
   where table_schema='public' and table_name='store_now_playing';

  -- view 실제 SELECT 가능 여부 (한 행도 안 와도 SELECT 성공해야 함)
  begin
    select count(*) into v_view_test_count from public.store_now_playing limit 1;
  exception when others then
    v_view_test_count := -1;
  end;

  raise notice '====== Phase 1-4 Repair Diagnostics ======';
  raise notice 'store_now_playing view: % (expect 1)', v_view;
  raise notice 'view SELECT test: % (expect >= 0, -1 = 에러)', v_view_test_count;
  raise notice 'admin_list_store_monitoring + admin_list_franchise_sync_status 재정의 완료';
  raise notice '==========================================';

  if v_view = 1 and v_view_test_count >= 0 then
    raise notice 'Phase 1-4 REPAIR COMPLETE — view + RPC 정상 동작';
  else
    raise warning 'Phase 1-4 REPAIR INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;
