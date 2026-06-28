-- 0380 — Hotfix: CTE scope bug in 0379 RPCs
--
-- 증상:
--   ERROR: relation "filtered" does not exist
--     (admin_list_available_playlists_for_deployment)
--   ERROR: relation "base" does not exist
--     (admin_list_deployable_policies)
--
-- 원인:
--   0379 본문에서 CTE 를 정의한 SELECT 문과, jsonb_agg 를 모으는 SELECT 문이
--   서로 다른 statement 로 분리되어 있었음. Postgres 의 WITH 절은 statement
--   scope — 두 번째 statement 에서 CTE 를 참조할 수 없음.
--
-- 수정:
--   CREATE OR REPLACE FUNCTION (시그니처 보존) — count + rows 를 단일
--   statement 안에서 처리. WITH 절에 paged CTE 와 total 카운트를 함께 정의.
--
-- 절대 원칙:
--   - 시그니처 보존 (signature 변경 금지)
--   - DB 스키마 / playlist / policy 구조 변경 금지
--   - 본 hotfix 는 두 RPC 의 본문만 교체

-- ============================================================
-- 1) admin_list_available_playlists_for_deployment — CTE scope fix
-- ============================================================
create or replace function public.admin_list_available_playlists_for_deployment(
  p_search       text default null,
  p_source_type  text default null,
  p_limit        int  default 50,
  p_offset       int  default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint := 0;
  v_rows   jsonb  := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  -- 단일 statement — CTE scope 안전 (count + paged 모두 같은 WITH 절에서 참조)
  with classified as (
    select
      p.id                                                  as playlist_id,
      p.title                                               as playlist_title,
      p.description,
      p.category,
      p.business_category,
      p.is_business_only,
      coalesce(p.is_auto, false)                            as is_auto,
      p.time_slot,
      p.thumbnail_url,
      p.created_at,
      p.created_by_user_id,
      case
        when coalesce(p.is_auto, false) = true                   then 'auto'
        when p.created_by_user_id is not null                    then 'curated'
        when coalesce(p.is_business_only, false) = true          then 'business'
        else 'manual'
      end                                                   as source_type,
      case when coalesce(p.is_auto, false) = true then 0
           else coalesce(
             (select count(*) from public.playlist_tracks pt where pt.playlist_id = p.id),
             0)
      end::int                                              as track_count,
      coalesce(
        (select count(*) from public.franchise_music_policies fmp
          where fmp.source_playlist_id = p.id),
        0)::int                                             as deployable_count,
      (select cp.display_name from public.curator_profiles cp
        where cp.user_id = p.created_by_user_id)            as curator_name
      from public.playlists p
  ),
  filtered as (
    select * from classified
     where (p_source_type is null or source_type = p_source_type)
       and (
         p_search is null
         or playlist_title ilike '%' || p_search || '%'
         or coalesce(description, '')        ilike '%' || p_search || '%'
         or coalesce(business_category, '')  ilike '%' || p_search || '%'
         or coalesce(category, '')           ilike '%' || p_search || '%'
       )
  ),
  total_cte as (
    select count(*)::bigint as c from filtered
  ),
  paged as (
    select * from filtered
     order by created_at desc nulls last
     limit v_limit offset v_offset
  )
  select
    coalesce((select c from total_cte), 0),
    coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc nulls last), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_available_playlists_for_deployment(text, text, int, int) from public, anon;
grant   execute on function public.admin_list_available_playlists_for_deployment(text, text, int, int) to authenticated;


-- ============================================================
-- 2) admin_list_deployable_policies — CTE scope fix
-- ============================================================
create or replace function public.admin_list_deployable_policies(
  p_search                text default null,
  p_franchise_id          uuid default null,
  p_enterprise_account_id uuid default null,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search           text       := nullif(btrim(coalesce(p_search, '')), '');
  v_limit            int        := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset           int        := greatest(coalesce(p_offset, 0), 0);
  v_uid              uuid       := auth.uid();
  v_is_admin         boolean    := public._is_super_admin();
  v_online_threshold timestamptz := now() - interval '3 minutes';
  v_ent_uid          uuid;
  v_total            bigint := 0;
  v_rows             jsonb  := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not v_is_admin then
    select ea.auth_user_id into v_ent_uid
      from public.enterprise_accounts ea
     where ea.auth_user_id = v_uid and ea.deleted_at is null
     limit 1;
    if v_ent_uid is null then raise exception 'forbidden: admin only'; end if;
  end if;

  -- 단일 statement — base / total_cte / paged 모두 같은 WITH 절에서 참조
  with base as (
    select
      p.id                                                       as policy_id,
      p.name                                                     as policy_name,
      p.description                                              as policy_description,
      p.status                                                   as policy_status,
      p.is_default,
      p.effective_from,
      p.effective_until,
      p.updated_at,
      p.created_at,
      p.franchise_id,
      f.name                                                     as franchise_name,
      p.source_playlist_id,
      p.source_type,
      p.track_count_snapshot,
      pl.title                                                   as source_playlist_title,
      coalesce(
        (select max(v.version_number) from public.franchise_policy_versions v where v.policy_id = p.id),
        1)                                                       as latest_version_number,
      (select count(*) from public.franchise_stores fs
        where fs.franchise_id = p.franchise_id and fs.status = 'active')::int as target_store_count,
      (select count(*) from public.franchise_stores fs
         left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
        where fs.franchise_id = p.franchise_id and fs.status = 'active'
          and ss.last_seen_at is not null and ss.last_seen_at >= v_online_threshold)::int as active_store_count
      from public.franchise_music_policies p
      left join public.franchises f  on f.id  = p.franchise_id
      left join public.playlists  pl on pl.id = p.source_playlist_id
     where p.status in ('active','draft')
       and (p_franchise_id is null or p.franchise_id = p_franchise_id)
       and (
         v_is_admin
         or exists (
           select 1 from public.franchise_admins fa
            where fa.franchise_id = p.franchise_id and fa.user_id = v_uid
         )
       )
       and (
         p_enterprise_account_id is null
         or exists (
           select 1
             from public.enterprise_accounts ea
             join public.franchise_admins fa on fa.user_id = ea.auth_user_id
            where ea.id = p_enterprise_account_id
              and ea.deleted_at is null
              and fa.franchise_id = p.franchise_id
         )
       )
       and (
         v_search is null
         or p.name        ilike '%' || v_search || '%'
         or coalesce(p.description, '') ilike '%' || v_search || '%'
         or coalesce(f.name, '')        ilike '%' || v_search || '%'
         or coalesce(pl.title, '')      ilike '%' || v_search || '%'
       )
  ),
  total_cte as (
    select count(*)::bigint as c from base
  ),
  paged as (
    select * from base
     order by is_default desc, updated_at desc nulls last
     limit v_limit offset v_offset
  )
  select
    coalesce((select c from total_cte), 0),
    coalesce(jsonb_agg(to_jsonb(b) order by b.is_default desc, b.updated_at desc nulls last), '[]'::jsonb)
    into v_total, v_rows
    from paged b;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) from public, anon;
grant   execute on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) to authenticated;

comment on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) is
  '0380 — CTE scope hotfix. 시그니처 보존. source_playlist_id / source_playlist_title / source_type / track_count_snapshot 포함.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_avail jsonb; v_list jsonb;
  v_avail_err text; v_list_err text;
begin
  begin
    select public.admin_list_available_playlists_for_deployment(null, null, 5, 0) into v_avail;
  exception when others then
    v_avail_err := sqlerrm;
  end;
  begin
    select public.admin_list_deployable_policies(null, null, null, 5, 0) into v_list;
  exception when others then
    v_list_err := sqlerrm;
  end;

  raise notice '====== 0380 RPC CTE scope hotfix ======';
  raise notice 'admin_list_available_playlists_for_deployment: %',
    coalesce(v_avail_err, 'OK (rows=' || coalesce(jsonb_array_length(v_avail->'data'), 0)::text || ')');
  raise notice 'admin_list_deployable_policies              : %',
    coalesce(v_list_err,  'OK (rows=' || coalesce(jsonb_array_length(v_list->'data'),  0)::text || ')');
  raise notice '======================================';
  -- NOTE: super admin 권한이 없는 do block 컨텍스트에서는 'forbidden' 또는
  --       'unauthorized' 메시지가 정상. relation/CTE 에러만 아니면 OK.
end$$;
