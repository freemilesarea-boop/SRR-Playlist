-- 0379 — Deployable Playlist from Source (Priority 4)
--
-- 목표:
--   기존 모든 playlist (AI/큐레이션/업종/수동) 을 그대로 "배포 플레이리스트" 로
--   등록 가능하게 한다. 자동 음악 스케줄 dropdown 은 동일한 admin_list_deployable_policies
--   를 source 로 사용하므로, 본 migration 이후 등록된 항목이 즉시 노출된다.
--
-- 절대 원칙:
--   - 기존 franchise_music_policies / _slots / _versions / apply_franchise_policy /
--     get_store_active_music_policy / store_heartbeat / store_now_playing 무수정
--   - apply / deploy / automation / settlement / payment / artist / queue / crossfade / AI 무관
--   - playlists / playlist_tracks 스키마 무수정 (조회만)
--
-- 변경:
--   1) franchise_music_policies ALTER — source 추적 컬럼 3개 추가 (nullable, 기본값 안전)
--   2) NEW RPC: admin_list_available_playlists_for_deployment(...)
--      → playlists pool 조회 + source_type 분류 + track_count + deployable_count
--   3) NEW RPC: admin_create_franchise_music_policy_from_playlist(...)
--      → playlist 1개를 정책으로 wrap (00:00-23:59 단일 slot) + audit log
--   4) admin_list_deployable_policies — 시그니처 보존, 응답 확장 (source_playlist_id /
--      source_playlist_title / source_type / track_count_snapshot)
--
-- 기존 데이터 영향: 0건 (column 추가는 nullable + default; 기존 fmp 행은 source_playlist_id=null).
--
-- 의존: 0001 (playlists), 0013 (curator_profiles), 0103 (is_auto/auto_rule),
--      0349 (franchise_music_policies, _slots, _versions, _is_super_admin),
--      0360 (admin_list_deployable_policies).

-- ============================================================
-- 1) ALTER franchise_music_policies — additive only
-- ============================================================
alter table public.franchise_music_policies
  add column if not exists source_playlist_id    uuid references public.playlists(id) on delete set null;

alter table public.franchise_music_policies
  add column if not exists source_type           text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'fmp_source_type_check'
       and conrelid = 'public.franchise_music_policies'::regclass
  ) then
    alter table public.franchise_music_policies
      add constraint fmp_source_type_check
      check (source_type is null or source_type in ('manual','curated','auto','business','user','legacy'));
  end if;
end$$;

alter table public.franchise_music_policies
  add column if not exists track_count_snapshot  integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'fmp_track_count_snapshot_nonneg'
       and conrelid = 'public.franchise_music_policies'::regclass
  ) then
    alter table public.franchise_music_policies
      add constraint fmp_track_count_snapshot_nonneg check (track_count_snapshot >= 0);
  end if;
end$$;

create index if not exists idx_fmp_source_playlist
  on public.franchise_music_policies(source_playlist_id)
  where source_playlist_id is not null;
create index if not exists idx_fmp_source_type
  on public.franchise_music_policies(source_type)
  where source_type is not null;


-- ============================================================
-- 2) admin_list_available_playlists_for_deployment — 모든 playlist pool
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
  v_total  bigint;
  v_rows   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

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
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select * from filtered
       order by created_at desc nulls last
       limit v_limit offset v_offset
    ) f;

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
-- 3) admin_create_franchise_music_policy_from_playlist — wrap playlist as policy
-- ============================================================
create or replace function public.admin_create_franchise_music_policy_from_playlist(
  p_playlist_id   uuid,
  p_franchise_id  uuid,
  p_name          text    default null,
  p_description   text    default null,
  p_status        text    default 'active',
  p_is_default    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pl          record;
  v_source_type text;
  v_track_count int := 0;
  v_policy_id   uuid;
  v_slot_id     uuid;
  v_name        text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_playlist_id  is null then raise exception 'playlist_id required'; end if;
  if p_franchise_id is null then raise exception 'franchise_id required'; end if;
  if coalesce(p_status, 'active') not in ('draft','active','archived') then
    raise exception 'invalid status: %', p_status;
  end if;

  -- playlist 조회 + 분류
  select id, title, description, coalesce(is_auto, false) as is_auto,
         created_by_user_id, coalesce(is_business_only, false) as is_business_only
    into v_pl
    from public.playlists where id = p_playlist_id;
  if v_pl.id is null then raise exception 'playlist not found: %', p_playlist_id; end if;

  v_source_type := case
    when v_pl.is_auto = true                            then 'auto'
    when v_pl.created_by_user_id is not null            then 'curated'
    when v_pl.is_business_only = true                   then 'business'
    else                                                     'manual'
  end;

  if not v_pl.is_auto then
    select count(*) into v_track_count
      from public.playlist_tracks where playlist_id = p_playlist_id;
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), v_pl.title);

  -- 정책 생성
  insert into public.franchise_music_policies (
    franchise_id, name, description, status, is_default,
    source_playlist_id, source_type, track_count_snapshot,
    created_by
  ) values (
    p_franchise_id, v_name,
    coalesce(p_description, v_pl.description),
    coalesce(p_status, 'active'),
    coalesce(p_is_default, false),
    p_playlist_id, v_source_type, v_track_count,
    auth.uid()
  ) returning id into v_policy_id;

  -- 단일 슬롯 (전요일 00:00-23:59) — 기존 slot 머신러리 그대로 활용
  insert into public.franchise_music_policy_slots (
    policy_id, slot_name, start_time, end_time, playlist_id, days_of_week, sort_order
  ) values (
    v_policy_id, '기본 시간대 (00:00–23:59)',
    '00:00:00'::time, '23:59:00'::time,
    p_playlist_id, ARRAY[1,2,3,4,5,6,7], 0
  ) returning id into v_slot_id;

  -- audit log
  perform public.admin_log_operation(
    'franchise_music_policy',
    'franchise_music_policy.create_from_playlist',
    'info', 'created',
    format('배포 플레이리스트 등록 — %s (source=%s)', v_name, v_source_type),
    jsonb_build_object(
      'policy_id', v_policy_id, 'slot_id', v_slot_id,
      'playlist_id', p_playlist_id, 'franchise_id', p_franchise_id,
      'source_type', v_source_type, 'track_count_snapshot', v_track_count
    ),
    auth.uid(), v_policy_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'policy_id', v_policy_id,
    'slot_id', v_slot_id,
    'source_type', v_source_type,
    'track_count', v_track_count
  );
end;
$$;
revoke execute on function public.admin_create_franchise_music_policy_from_playlist(uuid, uuid, text, text, text, boolean) from public, anon;
grant   execute on function public.admin_create_franchise_music_policy_from_playlist(uuid, uuid, text, text, text, boolean) to authenticated;


-- ============================================================
-- 4) admin_list_deployable_policies — 시그니처 보존, source_* 필드 추가
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
  v_total            bigint;
  v_rows             jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not v_is_admin then
    select ea.auth_user_id into v_ent_uid
      from public.enterprise_accounts ea
     where ea.auth_user_id = v_uid and ea.deleted_at is null
     limit 1;
    if v_ent_uid is null then raise exception 'forbidden: admin only'; end if;
  end if;

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
      -- 0379 — source linkage
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
  )
  select count(*) into v_total from base;

  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into v_rows
    from (
      select * from base
       order by is_default desc, updated_at desc nulls last
       limit v_limit offset v_offset
    ) b;

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
  '0379 — 배포 가능 정책 목록. source_playlist_id / source_type / track_count_snapshot / source_playlist_title 포함.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_col_src int; v_col_type int; v_col_cnt int;
  v_rpc_avail int; v_rpc_create int; v_rpc_list int;
begin
  select count(*) into v_col_src  from information_schema.columns
   where table_schema = 'public' and table_name = 'franchise_music_policies' and column_name = 'source_playlist_id';
  select count(*) into v_col_type from information_schema.columns
   where table_schema = 'public' and table_name = 'franchise_music_policies' and column_name = 'source_type';
  select count(*) into v_col_cnt  from information_schema.columns
   where table_schema = 'public' and table_name = 'franchise_music_policies' and column_name = 'track_count_snapshot';
  select count(*) into v_rpc_avail  from pg_proc where pronamespace='public'::regnamespace and proname='admin_list_available_playlists_for_deployment';
  select count(*) into v_rpc_create from pg_proc where pronamespace='public'::regnamespace and proname='admin_create_franchise_music_policy_from_playlist';
  select count(*) into v_rpc_list   from pg_proc where pronamespace='public'::regnamespace and proname='admin_list_deployable_policies';
  raise notice '====== 0379 Deployable Playlist from Source ======';
  raise notice 'fmp.source_playlist_id   : % / 1', v_col_src;
  raise notice 'fmp.source_type          : % / 1', v_col_type;
  raise notice 'fmp.track_count_snapshot : % / 1', v_col_cnt;
  raise notice 'admin_list_available_playlists_for_deployment        : % / 1', v_rpc_avail;
  raise notice 'admin_create_franchise_music_policy_from_playlist    : % / 1', v_rpc_create;
  raise notice 'admin_list_deployable_policies (v0379 — extended)    : % / 1', v_rpc_list;
  if v_col_src=1 and v_col_type=1 and v_col_cnt=1 and v_rpc_avail=1 and v_rpc_create=1 and v_rpc_list=1 then
    raise notice '0379 COMPLETE — playlist → deployable policy chain ready';
  else
    raise warning '0379 INCOMPLETE';
  end if;
end$$;
