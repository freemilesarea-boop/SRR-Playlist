-- 0387 — Announcement audio URL freshness + perf indexes
--
-- 증상 1: 매장 플레이어가 안내음 audio_url 호출 시 403 (MEDIA_ERR_SRC_NOT_SUPPORTED).
--         URL 패턴이 /storage/v1/object/sign/...?token=... 로 SIGNED URL.
--         signed URL 은 TTL 이 있어 만료되면 영구 403.
--
-- 원인 1: enterprise-announcements bucket 은 public=true 이지만 (0381),
--         일부 자산이 업로드 시점에 signed URL 로 file_url 컬럼에 저장됨.
--         RPC store_get_due_announcements 가 file_url 을 그대로 반환하고
--         AnnouncementOverlay 가 audio.src = ann.asset_file_url 로 직결.
--
-- 수정 1:
--   (a) DB 백필 — file_url 이 /object/sign/ 인 레코드를 /object/public/ 로 재작성
--   (b) RPC store_get_due_announcements 에 asset_file_path 필드 추가
--       → 클라이언트가 file_path 로 fresh public URL 을 재생성 가능
--   (c) signature 100% 보존 (parameter 동일) — UI/Player/queue/crossfade 무수정
--
-- 증상 2: 관리자 대시보드 일부 RPC 가 57014 (statement timeout) 발생.
--         특히 admin_list_announcement_schedules / admin_list_announcement_assets
--         의 N+1 correlated subquery (played_at, 7d count, schedule_count) 와
--         admin_operation_logs(created_at, level, category) 의 full scan 가 의심.
--
-- 수정 2: 인덱스 추가 (timeout 늘리지 않고 쿼리 비용 절감).
--   (a) idx_eapl_schedule_played    on enterprise_announcement_play_logs(schedule_id, played_at desc)
--   (b) idx_eas_asset_alive          on enterprise_announcement_schedules(asset_id) WHERE deleted_at IS NULL
--       (이미 0381 에 idx_eas_asset 존재 — concurrent 시 skip)
--   (c) idx_aol_created_level_cat    on admin_operation_logs(created_at desc, level, category)
--       (관리자 NOC KPI / 대시보드 카운트 쿼리에 사용)
--
-- 절대 무수정:
--   - DB schema column drop/rename 없음 (file_url 컬럼은 그대로, signed→public 만 백필)
--   - RPC signature 100% 보존 (return shape 만 asset_file_path 추가)
--   - Player.tsx / queue / crossfade / artist settlement / stream count 영향 0
--   - 기존 client 가 asset_file_path 를 모르더라도 asset_file_url 은 동작 (backward compat)

-- ============================================================
-- §1. file_url backfill — signed URL → public URL
-- ============================================================
-- 동작: https://<host>/storage/v1/object/sign/<bucket>/<path>?token=...
--    → https://<host>/storage/v1/object/public/<bucket>/<path>
-- (이미 /object/public/ 로 저장된 레코드는 영향 없음)

update public.enterprise_announcement_assets
   set file_url = regexp_replace(
         file_url,
         '/storage/v1/object/sign/([^/]+)/([^?]+)(\?.*)?$',
         '/storage/v1/object/public/\1/\2'
       )
 where file_url ~ '/storage/v1/object/sign/';

-- 진단 로그
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.enterprise_announcement_assets
   where file_url ~ '/storage/v1/object/sign/';
  raise notice '0387 — signed URLs remaining after backfill: %', v_count;
end$$;


-- ============================================================
-- §2. store_get_due_announcements — asset_file_path 추가
-- ============================================================
-- signature (parameter) 동일. return jsonb 의 data[] 각 element 에
-- 'asset_file_path' 필드만 추가. 기존 키 (asset_file_url 포함) 전부 유지.

create or replace function public.store_get_due_announcements(
  p_store_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid          uuid := coalesce(p_store_id, auth.uid());
  v_now          timestamptz := now();
  v_today_start  timestamptz;
  v_results      jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';

  with eligible as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, s.timezone, s.recurrence_rule, s.starts_at, s.ends_at,
           a.title as asset_title,
           a.file_url  as asset_file_url,
           a.file_path as asset_file_path,    -- 0387 추가: 클라이언트가 fresh URL 재생성
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start
               and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and public._announcement_is_due_now(s.recurrence_rule, s.starts_at, s.ends_at, v_now, coalesce(s.timezone, 'Asia/Seoul'))
       and (
         (s.scope_type = 'enterprise')
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id
            ))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',     e.schedule_id,
           'asset_id',        e.asset_id,
           'schedule_name',   e.schedule_name,
           'asset_title',     e.asset_title,
           'asset_file_url',  e.asset_file_url,
           'asset_file_path', e.asset_file_path,    -- 0387 추가
           'asset_duration',  e.asset_duration,
           'asset_mime_type', e.asset_mime_type,
           'play_mode',       e.play_mode,
           'today_count',     e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',  e.last_played_at
         ) order by e.schedule_id), '[]'::jsonb)
    into v_results
    from eligible e
   where e.today_count < e.max_plays_per_day
     and (e.last_played_at is null or e.last_played_at < (v_now - interval '5 minutes'));

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now, 'data', v_results
  );
end;
$$;
revoke execute on function public.store_get_due_announcements(uuid) from public, anon;
grant   execute on function public.store_get_due_announcements(uuid) to authenticated;


-- ============================================================
-- §3. Perf 인덱스 — admin 대시보드 timeout 완화
-- ============================================================
-- admin_list_announcement_schedules / admin_list_announcement_assets 의
-- correlated subquery (played_at desc, 7d count) 가 매 row 마다 발생.
-- (schedule_id, played_at desc) WHERE status='played' 부분 인덱스로 비용 절감.
create index if not exists idx_eapl_schedule_played_filtered
  on public.enterprise_announcement_play_logs (schedule_id, played_at desc)
  where status = 'played';

-- admin_operation_logs 가 NOC KPI / 대시보드 카운트 (created_at >= today + level + category) 에서
-- full table scan 발생. (created_at desc, level) 복합 인덱스로 해소.
do $$
begin
  if exists (select 1 from pg_class where relname = 'admin_operation_logs' and relkind = 'r') then
    if not exists (
      select 1 from pg_indexes
       where schemaname = 'public'
         and tablename = 'admin_operation_logs'
         and indexname = 'idx_aol_created_level'
    ) then
      execute 'create index idx_aol_created_level
                 on public.admin_operation_logs (created_at desc, level)';
      raise notice '0387 — created idx_aol_created_level';
    end if;
  else
    raise notice '0387 — admin_operation_logs table not found (skip)';
  end if;
end$$;


-- ============================================================
-- §4. Diagnostics
-- ============================================================
do $$
declare
  v_url_ok      int;
  v_url_signed  int;
  v_path_null   int;
begin
  select count(*) into v_url_ok
    from public.enterprise_announcement_assets where file_url ~ '/storage/v1/object/public/';
  select count(*) into v_url_signed
    from public.enterprise_announcement_assets where file_url ~ '/storage/v1/object/sign/';
  select count(*) into v_path_null
    from public.enterprise_announcement_assets where file_path is null or btrim(file_path) = '';

  raise notice '0387 — assets file_url state: public=%, signed=%, missing_path=%',
    v_url_ok, v_url_signed, v_path_null;

  if v_url_signed > 0 then
    raise warning '0387 — % asset(s) still have signed URLs after backfill (regex mismatch?)', v_url_signed;
  end if;
  if v_path_null > 0 then
    raise warning '0387 — % asset(s) have empty file_path — client cannot regenerate fresh URL', v_path_null;
  end if;

  raise notice '0387 — store_get_due_announcements regenerated with asset_file_path field';
end$$;
