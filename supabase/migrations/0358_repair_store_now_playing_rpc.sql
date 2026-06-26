-- 0358 — Phase 1-4 RPC 단독 복구
--
-- 문제:
--   0356 의 store_now_playing view 생성이 실패하면서
--   같은 migration 내 후속 admin_now_playing_list / admin_now_playing_kpi RPC 도
--   cascade fail. 0357 에서 view 는 복구했으나 두 RPC 는 의도적으로 skip
--   (이미 생성됐다고 잘못 가정) → 결과적으로 두 RPC 미생성 상태.
--
-- 수정:
--   2개 RPC 만 CREATE OR REPLACE.
--   view 는 절대 건드리지 않음 (0357 에서 정상 복구됨).
--
-- 의존:
--   - public.store_now_playing view (0357 에서 정상 생성)
--   - public._is_super_admin() (X6.89)
--
-- 검증 (적용 후):
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_now_playing_kpi','admin_now_playing_list');
--   → 2 rows

-- ============================================================
-- 1) admin_now_playing_kpi
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
-- 2) admin_now_playing_list
-- ============================================================
create or replace function public.admin_now_playing_list(
  p_search text default null,
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_status text default null,
  p_sort text default 'started_at_desc',
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
-- 3) 진단 — 적용 직후 NOTICE 로 결과 출력
-- ============================================================
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc
   where proname in ('admin_now_playing_kpi','admin_now_playing_list');

  raise notice '====== 0358 RPC 단독 복구 진단 ======';
  raise notice 'RPC count: % / 2', v_count;
  if v_count = 2 then
    raise notice '0358 COMPLETE — admin_now_playing_kpi + admin_now_playing_list 생성 완료';
  else
    raise warning '0358 INCOMPLETE — RPC 누락. 수동 확인 필요';
  end if;
end$$;
