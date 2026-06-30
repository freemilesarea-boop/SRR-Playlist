-- 0389 — Announcement occurrence-level 중복 재생 차단
--
-- 증상:
--   예약 안내방송이 정상 재생 + BGM 복귀까지 성공한 뒤, 같은 회차가 수 분 후
--   다시 재생됨. (live 확인: daily:12:22 schedule 이 12:25:15 / 12:32:35 KST 두 번 played)
--
-- 원인 (live DB 추적, 추측 아님):
--   store_get_due_announcements / store_get_upcoming_announcements 의 중복 차단이
--     (a) max_plays_per_day (하루 총 횟수, 기본 10 — 거의 안 걸림)
--     (b) last_played_at 기준 5분 debounce
--   둘 뿐이라, "같은 occurrence (schedule + 날짜 + HH:MM)" 단위 차단이 없음.
--   _announcement_is_due_now / next_occurrence 의 due window 는 15분이라,
--   재생 후 5분 debounce 가 풀리면 12:37 까지 같은 occurrence 가 다시 due 로 반환됨.
--   mark_played 는 정상 동작 (row 생성됨) 하지만 "이 회차 이미 재생" 기록이 없어
--   RPC 가 같은 회차를 다시 내려줌.
--
-- 수정:
--   1) enterprise_announcement_play_logs 에 occurrence_key / scheduled_for 컬럼 추가.
--      status 에 'started' 추가 (재생 시작 시점 durable lock).
--   2) partial unique index — (schedule_id, store_id, occurrence_key) where status='played'
--      → 같은 회차 played 중복 물리 차단.
--   3) store_mark_announcement_played — occurrence_key / scheduled_for 기록 +
--      played 멱등 처리 (이미 played 면 기존 log_id 반환).
--   4) store_get_upcoming_announcements / store_get_due_announcements —
--      같은 occurrence_key 가 status in ('played','started','failed') 로 기록돼 있으면 제외.
--      (failed 도 제외 → 무한 재시도 방지; 다음 날 occurrence 는 key 가 달라 정상 재생.)
--   5) 기존 played row backfill — occurrence_key/scheduled_for 채워 배포 직후 회차 보호.
--
-- 중복 방지 key 구조:
--   occurrence_key = '<schedule_id>:YYYY-MM-DD:HH24:MI'  (schedule timezone 기준 local)
--   예: 'bf53b422-...:2026-06-30:12:22'
--   클라이언트 in-memory/sessionStorage lock 도 동일 key 사용 (서버가 내려준 값 그대로).
--
-- 절대 무수정:
--   Player / queue / crossfade / 정산 / artist stream count / 추천 / AI.
--   _announcement_is_due_now / _announcement_next_occurrence 동작 무변경 (호출만 추가).

-- ============================================================
-- 1) play_logs 스키마 확장
-- ============================================================
alter table public.enterprise_announcement_play_logs
  add column if not exists occurrence_key text,
  add column if not exists scheduled_for  timestamptz;

-- status 에 'started' 추가
alter table public.enterprise_announcement_play_logs
  drop constraint if exists enterprise_announcement_play_logs_status_check;
alter table public.enterprise_announcement_play_logs
  add constraint enterprise_announcement_play_logs_status_check
  check (status in ('queued','started','played','skipped','failed'));

-- ============================================================
-- 2) 기존 row backfill — occurrence_key / scheduled_for
-- ============================================================
-- daily:HH:MM / weekly:DOW,...:HH:MM / once:YYYY-MM-DDTHH:MM 의 occurrence 시각을
-- played_at 의 local date 기준으로 재구성. malformed rule 은 per-row skip.
do $$
declare
  r        record;
  v_tz     text;
  v_kind   text;
  v_occ    timestamptz;
  v_hh     int;
  v_mi     int;
  v_done   int := 0;
begin
  for r in
    select pl.id as log_id, pl.played_at, pl.created_at, s.recurrence_rule, s.timezone
      from public.enterprise_announcement_play_logs pl
      join public.enterprise_announcement_schedules s on s.id = pl.schedule_id
     where pl.occurrence_key is null
  loop
    begin
      v_tz   := coalesce(r.timezone, 'Asia/Seoul');
      v_kind := split_part(r.recurrence_rule, ':', 1);
      v_occ  := null;

      if v_kind = 'daily' then
        v_hh := split_part(r.recurrence_rule, ':', 2)::int;
        v_mi := split_part(r.recurrence_rule, ':', 3)::int;
        v_occ := ((coalesce(r.played_at, r.created_at) at time zone v_tz)::date
                   + make_time(v_hh, v_mi, 0)) at time zone v_tz;
      elsif v_kind = 'weekly' then
        v_hh := split_part(r.recurrence_rule, ':', 3)::int;
        v_mi := split_part(r.recurrence_rule, ':', 4)::int;
        v_occ := ((coalesce(r.played_at, r.created_at) at time zone v_tz)::date
                   + make_time(v_hh, v_mi, 0)) at time zone v_tz;
      elsif v_kind = 'once' then
        v_occ := (split_part(r.recurrence_rule, ':', 2) || ':' || split_part(r.recurrence_rule, ':', 3))::timestamp
                   at time zone v_tz;
      end if;

      if v_occ is not null then
        update public.enterprise_announcement_play_logs
           set scheduled_for  = v_occ,
               occurrence_key = schedule_id::text || ':' || to_char(v_occ at time zone v_tz, 'YYYY-MM-DD:HH24:MI')
         where id = r.log_id;
        v_done := v_done + 1;
      end if;
    exception when others then
      -- malformed rule → skip this row
      null;
    end;
  end loop;
  raise notice '0389 — backfilled occurrence_key on % play_log row(s)', v_done;
end$$;

-- ============================================================
-- 3) 중복 차단 인덱스
-- ============================================================
-- (a) played 회차 물리적 unique — 같은 occurrence 두 번 played 불가
create unique index if not exists uq_eapl_played_occurrence
  on public.enterprise_announcement_play_logs (schedule_id, store_id, occurrence_key)
  where status = 'played' and occurrence_key is not null;

-- (b) RPC 제외 EXISTS 조회용
create index if not exists idx_eapl_occurrence_lookup
  on public.enterprise_announcement_play_logs (schedule_id, store_id, occurrence_key, status)
  where occurrence_key is not null;

-- ============================================================
-- 4) store_mark_announcement_played — occurrence_key 기록 + played 멱등
-- ============================================================
-- 기존 4-arg signature 제거 후 6-arg 로 교체 (client 가 항상 새 param 전달).
drop function if exists public.store_mark_announcement_played(uuid, uuid, text, text);

create or replace function public.store_mark_announcement_played(
  p_schedule_id    uuid,
  p_asset_id       uuid,
  p_status         text default 'played',
  p_error_message  text default null,
  p_occurrence_key text default null,
  p_scheduled_for  timestamptz default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_log_id   uuid;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_status not in ('queued','started','played','skipped','failed') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_schedule_id is null then raise exception 'schedule_id required'; end if;
  if p_asset_id    is null then raise exception 'asset_id required';    end if;

  -- played 멱등: 같은 occurrence 가 이미 played 면 기존 log 반환 (중복 insert 방지)
  if p_status = 'played' and p_occurrence_key is not null then
    select id into v_existing
      from public.enterprise_announcement_play_logs
     where schedule_id = p_schedule_id and store_id = v_uid
       and occurrence_key = p_occurrence_key and status = 'played'
     limit 1;
    if v_existing is not null then
      return jsonb_build_object('success', true, 'log_id', v_existing, 'status', 'played', 'deduped', true);
    end if;
  end if;

  begin
    insert into public.enterprise_announcement_play_logs (
      schedule_id, asset_id, store_id, status, played_at, error_message,
      occurrence_key, scheduled_for
    ) values (
      p_schedule_id, p_asset_id, v_uid, p_status,
      case when p_status = 'played' then now() else null end,
      p_error_message, p_occurrence_key, p_scheduled_for
    ) returning id into v_log_id;
  exception when unique_violation then
    -- 동시 double-fire 백스톱 (uq_eapl_played_occurrence)
    select id into v_log_id
      from public.enterprise_announcement_play_logs
     where schedule_id = p_schedule_id and store_id = v_uid
       and occurrence_key = p_occurrence_key and status = 'played'
     limit 1;
    return jsonb_build_object('success', true, 'log_id', v_log_id, 'status', 'played', 'deduped', true);
  end;

  if p_status = 'played' then
    update public.enterprise_announcement_schedules
       set last_triggered_at = now()
     where id = p_schedule_id;
  end if;

  return jsonb_build_object('success', true, 'log_id', v_log_id, 'status', p_status);
end;
$$;
revoke execute on function public.store_mark_announcement_played(uuid,uuid,text,text,text,timestamptz) from public, anon;
grant   execute on function public.store_mark_announcement_played(uuid,uuid,text,text,text,timestamptz) to authenticated;

-- ============================================================
-- 5) store_get_upcoming_announcements — occurrence_key 제외 추가
-- ============================================================
create or replace function public.store_get_upcoming_announcements(
  p_store_id          uuid default null,
  p_lookahead_seconds int  default 900
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid         uuid := coalesce(p_store_id, auth.uid());
  v_now         timestamptz := now();
  v_today_start timestamptz;
  v_recovery    int := 900;
  v_lookahead   int := least(greatest(coalesce(p_lookahead_seconds, 900), 60), 3600);
  v_horizon     timestamptz;
  v_results     jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
  v_horizon     := v_now + make_interval(secs => v_lookahead);

  with base as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, coalesce(s.timezone, 'Asia/Seoul') as tz,
           public._announcement_next_occurrence(
             s.recurrence_rule, s.starts_at, s.ends_at, v_now,
             coalesce(s.timezone, 'Asia/Seoul'), v_recovery
           ) as scheduled_at,
           a.title     as asset_title,
           a.file_url  as asset_file_url,
           a.file_path as asset_file_path,
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and (
         (s.scope_type = 'enterprise')
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  ),
  eligible as (
    select b.*,
           b.schedule_id::text || ':' ||
           to_char(b.scheduled_at at time zone b.tz, 'YYYY-MM-DD:HH24:MI') as occurrence_key
      from base b
     where b.scheduled_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',       e.schedule_id,
           'asset_id',          e.asset_id,
           'schedule_name',     e.schedule_name,
           'asset_title',       e.asset_title,
           'asset_file_url',    e.asset_file_url,
           'asset_file_path',   e.asset_file_path,
           'asset_duration',    e.asset_duration,
           'asset_mime_type',   e.asset_mime_type,
           'play_mode',         e.play_mode,
           'today_count',       e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',    e.last_played_at,
           'scheduled_at',      e.scheduled_at,
           'occurrence_key',    e.occurrence_key
         ) order by e.scheduled_at), '[]'::jsonb)
    into v_results
    from eligible e
   where e.scheduled_at <= v_horizon
     and e.today_count < e.max_plays_per_day
     and not exists (
       select 1 from public.enterprise_announcement_play_logs pl
        where pl.schedule_id = e.schedule_id and pl.store_id = v_uid
          and pl.occurrence_key = e.occurrence_key
          and pl.status in ('played','started','failed')
     );

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now,
    'lookahead_seconds', v_lookahead, 'data', v_results
  );
end;
$$;
revoke execute on function public.store_get_upcoming_announcements(uuid, int) from public, anon;
grant   execute on function public.store_get_upcoming_announcements(uuid, int) to authenticated;

-- ============================================================
-- 6) store_get_due_announcements (백업 경로) — occurrence_key 제외 추가
-- ============================================================
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

  with base as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, coalesce(s.timezone, 'Asia/Seoul') as tz,
           public._announcement_next_occurrence(
             s.recurrence_rule, s.starts_at, s.ends_at, v_now,
             coalesce(s.timezone, 'Asia/Seoul'), 900
           ) as scheduled_at,
           a.title     as asset_title,
           a.file_url  as asset_file_url,
           a.file_path as asset_file_path,
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and public._announcement_is_due_now(s.recurrence_rule, s.starts_at, s.ends_at, v_now, coalesce(s.timezone, 'Asia/Seoul'))
       and (
         (s.scope_type = 'enterprise')
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  ),
  eligible as (
    select b.*,
           case when b.scheduled_at is null then null
                else b.schedule_id::text || ':' ||
                     to_char(b.scheduled_at at time zone b.tz, 'YYYY-MM-DD:HH24:MI') end as occurrence_key
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',     e.schedule_id,
           'asset_id',        e.asset_id,
           'schedule_name',   e.schedule_name,
           'asset_title',     e.asset_title,
           'asset_file_url',  e.asset_file_url,
           'asset_file_path', e.asset_file_path,
           'asset_duration',  e.asset_duration,
           'asset_mime_type', e.asset_mime_type,
           'play_mode',       e.play_mode,
           'today_count',     e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',  e.last_played_at,
           'scheduled_at',    e.scheduled_at,
           'occurrence_key',  e.occurrence_key
         ) order by e.schedule_id), '[]'::jsonb)
    into v_results
    from eligible e
   where e.today_count < e.max_plays_per_day
     and (e.last_played_at is null or e.last_played_at < (v_now - interval '5 minutes'))
     and (
       e.occurrence_key is null
       or not exists (
         select 1 from public.enterprise_announcement_play_logs pl
          where pl.schedule_id = e.schedule_id and pl.store_id = v_uid
            and pl.occurrence_key = e.occurrence_key
            and pl.status in ('played','started','failed')
       )
     );

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now, 'data', v_results
  );
end;
$$;
revoke execute on function public.store_get_due_announcements(uuid) from public, anon;
grant   execute on function public.store_get_due_announcements(uuid) to authenticated;

-- ============================================================
-- 7) Diagnostics
-- ============================================================
do $$
declare
  v_cols int;
  v_uq   int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_announcement_play_logs'
     and column_name in ('occurrence_key','scheduled_for');
  select count(*) into v_uq from pg_indexes
   where schemaname='public' and indexname='uq_eapl_played_occurrence';

  raise notice '====== 0389 Announcement occurrence dedup ======';
  raise notice 'new columns: % / 2, unique index: % / 1', v_cols, v_uq;
  if v_cols = 2 and v_uq = 1 then
    raise notice '0389 COMPLETE — occurrence_key dedup ready (mark_played + due/upcoming RPC)';
  else
    raise warning '0389 INCOMPLETE';
  end if;
end$$;
