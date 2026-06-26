-- 0356 — Enterprise Phase 1-4: Real-time Now Playing
--
-- 목표:
--   전국 모든 매장의 현재 재생 중인 곡을 관리자가 실시간 확인.
--
-- 설계 결정 (사용자 spec 준수):
--   - 새 테이블 X (기존 store_policy_sync_status 재사용)
--   - track metadata 중복 저장 X (JOIN 으로 해결)
--   - 새 heartbeat 시스템 X (Phase 1-3 store_heartbeat 재사용)
--   - elapsed_seconds 는 view 에서 동적 계산 (now() - current_track_started_at)
--   - Realtime 사용 (supabase_realtime publication 에 store_policy_sync_status 추가)
--
-- 의존: 0353 + 0355 (Phase 1-3)

-- ============================================================
-- 1) Index for join performance (current_track_id)
-- ============================================================
create index if not exists idx_sync_status_current_track
  on public.store_policy_sync_status (current_track_id) where current_track_id is not null;


-- ============================================================
-- 2) store_now_playing VIEW
--    JOIN: store_policy_sync_status × users × franchises × enterprise_regions
--          × enterprise_accounts × tracks
-- ============================================================
create or replace view public.store_now_playing as
  select
    ss.store_id,
    coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
    u.email as store_email,
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
    -- 동적 계산: elapsed (clamp 0..duration)
    case
      when ss.current_track_started_at is null then null
      when ss.current_track_started_at > now() then 0
      else greatest(0, extract(epoch from (now() - ss.current_track_started_at)))::int
    end as elapsed_seconds,
    -- remaining
    case
      when t.duration is null or ss.current_track_started_at is null then null
      else greatest(0, t.duration - extract(epoch from (now() - ss.current_track_started_at)))::int
    end as remaining_seconds,
    ss.player_status,
    ss.last_seen_at,
    ss.volume,
    ss.app_version,
    ss.playback_error,
    -- 5분 임계값 기반 online 여부 (UI 일관성)
    case when ss.last_seen_at is null then false
         when ss.last_seen_at >= now() - interval '5 minutes' then true
         else false end as is_online,
    ss.updated_at as last_heartbeat_at
  from public.store_policy_sync_status ss
  join public.users u on u.id = ss.store_id
  left join public.franchises f on f.id = ss.franchise_id
  left join public.enterprise_regions er on er.id = ss.enterprise_region_id
  left join public.enterprise_accounts ea on ea.id = er.enterprise_account_id
  left join public.tracks t on t.id = ss.current_track_id
  where coalesce(u.account_type, 'individual') = 'business'
    and u.withdrawn_at is null;

comment on view public.store_now_playing is
  'Phase 1-4 — 매장 현재 재생곡 실시간 view. JOIN 1회 (N+1 없음). elapsed/remaining 동적 계산.';


-- ============================================================
-- 3) admin_now_playing_list RPC (검색 + 필터 + 정렬 + 페이지네이션)
-- ============================================================
create or replace function public.admin_now_playing_list(
  p_search text default null,                       -- 매장명/본사/지역/곡명/아티스트
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_status text default null,                       -- online | playing | offline
  p_sort text default 'started_at_desc',            -- started_at_desc | name
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
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with filtered as (
    select * from public.store_now_playing snp
     where (p_franchise_id is null or snp.franchise_id = p_franchise_id)
       and (p_enterprise_region_id is null or snp.enterprise_region_id = p_enterprise_region_id)
       and (
         v_search is null
         or coalesce(snp.store_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.franchise_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.region_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.track_title, '') ilike '%' || v_search || '%'
         or coalesce(snp.artist_name, '') ilike '%' || v_search || '%'
       )
       and (
         p_status is null
         or (p_status = 'online' and snp.is_online)
         or (p_status = 'playing' and snp.player_status = 'playing')
         or (p_status = 'offline' and not snp.is_online)
       )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select * from public.store_now_playing snp
     where (p_franchise_id is null or snp.franchise_id = p_franchise_id)
       and (p_enterprise_region_id is null or snp.enterprise_region_id = p_enterprise_region_id)
       and (
         v_search is null
         or coalesce(snp.store_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.franchise_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.region_name, '') ilike '%' || v_search || '%'
         or coalesce(snp.track_title, '') ilike '%' || v_search || '%'
         or coalesce(snp.artist_name, '') ilike '%' || v_search || '%'
       )
       and (
         p_status is null
         or (p_status = 'online' and snp.is_online)
         or (p_status = 'playing' and snp.player_status = 'playing')
         or (p_status = 'offline' and not snp.is_online)
       )
    order by
      case when p_sort = 'name' then store_name end asc nulls last,
      case when p_sort = 'started_at_desc' then started_at end desc nulls last,
      coalesce(last_seen_at, '1970-01-01'::timestamptz) desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(filtered)), '[]'::jsonb) into v_rows from filtered;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_now_playing_list(text, uuid, uuid, text, text, int, int) from public, anon;
grant execute on function public.admin_now_playing_list(text, uuid, uuid, text, text, int, int) to authenticated;


-- ============================================================
-- 4) admin_now_playing_kpi
-- ============================================================
create or replace function public.admin_now_playing_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_recent_change timestamptz := now() - interval '5 minutes';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.store_now_playing),
    'playing', (select count(*) from public.store_now_playing where player_status = 'playing' and is_online),
    'paused', (select count(*) from public.store_now_playing where player_status = 'paused' and is_online),
    'stopped', (select count(*) from public.store_now_playing where player_status = 'stopped' and is_online),
    'offline', (select count(*) from public.store_now_playing where not is_online),
    'recent_track_changes_5m', (
      select count(*) from public.store_now_playing
       where started_at is not null and started_at >= v_recent_change
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_now_playing_kpi() from public, anon;
grant execute on function public.admin_now_playing_kpi() to authenticated;


-- ============================================================
-- 5) Realtime publication — store_policy_sync_status
--    변경 시 관리자 UI 가 Realtime subscribe 해서 즉시 반영.
--    중복 추가 방지 위해 DO block 으로 conditional.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'store_policy_sync_status'
  ) then
    alter publication supabase_realtime add table public.store_policy_sync_status;
    raise notice 'Phase 1-4: supabase_realtime publication 에 store_policy_sync_status 추가됨';
  else
    raise notice 'Phase 1-4: store_policy_sync_status 는 이미 supabase_realtime 에 포함됨 (skip)';
  end if;
exception
  when undefined_object then
    -- supabase_realtime publication 자체가 없는 경우 (자체호스팅 등)
    raise warning 'Phase 1-4: supabase_realtime publication 없음 — Realtime 미지원 환경. UI 가 polling fallback 사용.';
end$$;


-- ============================================================
-- 6) 진단
-- ============================================================
do $$
declare
  v_view int;
  v_rpc_count int;
  v_index int;
  v_realtime int;
begin
  select count(*) into v_view from information_schema.views
   where table_schema='public' and table_name='store_now_playing';
  select count(*) into v_rpc_count from pg_proc
   where proname in ('admin_now_playing_list','admin_now_playing_kpi');
  select count(*) into v_index from pg_indexes
   where tablename='store_policy_sync_status' and indexname='idx_sync_status_current_track';
  select count(*) into v_realtime from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='store_policy_sync_status';

  raise notice '====== Phase 1-4 Diagnostics ======';
  raise notice 'store_now_playing view: % (expect 1)', v_view;
  raise notice 'RPC count: % / 2', v_rpc_count;
  raise notice 'current_track_id index: % (expect 1)', v_index;
  raise notice 'Realtime publication: % (expect 1, 자체호스팅 시 0)', v_realtime;
  raise notice '===================================';

  if v_view = 1 and v_rpc_count = 2 and v_index = 1 then
    raise notice 'Phase 1-4 COMPLETE — view/RPC/index 정상 (Realtime publication 별도 확인)';
  else
    raise warning 'Phase 1-4 INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;
