-- 0388 — Announcement exact-time trigger V2 (00초 정밀 재생)
--
-- 증상 (V1):
--   예약 시각 HH:MM 에 안내방송/광고가 HH:MM:00 에 재생되지 않고,
--   HH:MM:40 ~ HH:MM+1:00 사이 (40~60초 지연) 에 재생됨.
--
-- 원인 (V1 trigger 정책):
--   클라이언트 (AnnouncementOverlay) 가
--     (a) 10s 폴링으로 "due 여부 (boolean)" 만 받고,
--     (b) 현재 곡 자연 종료를 최대 60s (GRACE_PERIOD_MS) 기다린 뒤
--     (c) grace 초과 시에만 force-interrupt.
--   서버 _announcement_is_due_now 는 [scheduled, scheduled+15min] 구간을 boolean 으로만
--   판정하고 "정확한 scheduled_at (target epoch)" 을 반환하지 않음.
--   → 클라이언트가 00초를 알 수 없어 setTimeout 예약 불가, 폴링 + grace 로 늦게 발화.
--
-- 수정 (V2):
--   서버가 "다음/현재 occurrence 의 정확한 scheduled_at" 을 계산해서 반환.
--   클라이언트는 server_now 로 시계 오차를 보정해 scheduled_at 까지 setTimeout 을 걸고
--   00초에 즉시 interrupt 재생. (클라이언트 변경은 AnnouncementOverlay.tsx)
--
--   추가 객체:
--     helper: _announcement_next_occurrence(rule, starts_at, ends_at, now, tz, recovery_seconds)
--             → 발화 대상 occurrence 의 timestamptz (없으면 null)
--               · 미래 occurrence 중 가장 이른 것, 또는
--               · 최근 recovery_seconds 이내 과거 occurrence (놓침 복구용)
--     RPC:    store_get_upcoming_announcements(p_store_id, p_lookahead_seconds)
--             → scheduled_at + occurrence_key + server now_at 포함 due/upcoming 목록
--
-- 절대 무수정:
--   - 기존 store_get_due_announcements / store_mark_announcement_played / _announcement_is_due_now
--     signature 및 동작 100% 보존 (V1 폴링 백업 경로 그대로 유지).
--   - Player.tsx / queue / crossfade / 정산 / artist stream count / 추천 / AI 무영향.
--   - max_plays_per_day + 5min debounce 등 서버 중복 방지 정책 유지.

-- ============================================================
-- 1) Helper — 다음/현재 occurrence 의 정확한 scheduled_at 계산
-- ============================================================
-- _announcement_is_due_now 가 boolean (구간 판정) 만 주는 것과 달리,
-- 이 함수는 발화에 사용할 "정확한 occurrence timestamptz" 를 반환한다.
--
-- 반환 규칙:
--   floor := greatest(now - recovery_seconds, starts_at)
--   ceil  := ends_at (있으면)
--   floor <= occurrence (<= ceil) 인 occurrence 중 가장 이른 것.
--   없으면 null.
--
--   · occurrence 가 미래면  → 클라이언트가 setTimeout 으로 정시 예약.
--   · occurrence 가 floor..now 사이 (놓침) → 클라이언트가 즉시 복구 재생.
--
-- recurrence: once:YYYY-MM-DDTHH:MM / daily:HH:MM / weekly:DOW,...:HH:MM
create or replace function public._announcement_next_occurrence(
  p_recurrence       text,
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_now              timestamptz default now(),
  p_tz               text default 'Asia/Seoul',
  p_recovery_seconds int default 900
) returns timestamptz
language plpgsql
immutable
as $$
declare
  v_parts      text[];
  v_local      timestamp;
  v_local_date date;
  v_hour       int;
  v_minute     int;
  v_dow_tokens text[];
  v_dow        text;
  v_target_dow int;
  v_cand       timestamptz;
  v_floor      timestamptz;
  v_once       timestamp;
  v_day_date   date;
  v_day_dow    int;
  i            int;
begin
  if p_recurrence is null then return null; end if;

  -- 발화 가능 하한: now - recovery (놓침 복구 허용 범위). starts_at 이 더 늦으면 그쪽으로.
  v_floor := p_now - make_interval(secs => greatest(coalesce(p_recovery_seconds, 900), 0));
  if p_starts_at is not null and p_starts_at > v_floor then
    v_floor := p_starts_at;
  end if;

  v_parts      := string_to_array(p_recurrence, ':');
  v_local      := (p_now at time zone p_tz);
  v_local_date := v_local::date;

  -- once:YYYY-MM-DDTHH:MM  (split → ['once','YYYY-MM-DDTHH','MM'])
  if v_parts[1] = 'once' and array_length(v_parts, 1) >= 3 then
    v_once := (v_parts[2] || ':' || v_parts[3])::timestamp;
    v_cand := v_once at time zone p_tz;
    if v_cand >= v_floor and (p_ends_at is null or v_cand <= p_ends_at) then
      return v_cand;
    end if;
    return null;

  -- daily:HH:MM — 오늘부터 7일까지 중 floor 이상인 첫 occurrence
  elsif v_parts[1] = 'daily' and array_length(v_parts, 1) >= 3 then
    v_hour   := v_parts[2]::int;
    v_minute := v_parts[3]::int;
    for i in 0..7 loop
      v_cand := ((v_local_date + i) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      if v_cand >= v_floor then
        if p_ends_at is not null and v_cand > p_ends_at then return null; end if;
        return v_cand;
      end if;
    end loop;
    return null;

  -- weekly:DOW1,DOW2,...:HH:MM — 오늘부터 7일까지 중 매칭 요일의 첫 occurrence
  elsif v_parts[1] = 'weekly' and array_length(v_parts, 1) >= 4 then
    v_dow_tokens := string_to_array(v_parts[2], ',');
    v_hour       := v_parts[3]::int;
    v_minute     := v_parts[4]::int;
    for i in 0..7 loop
      v_day_date := v_local_date + i;
      v_day_dow  := extract(dow from v_day_date)::int;
      foreach v_dow in array v_dow_tokens loop
        v_target_dow := case upper(btrim(v_dow))
          when 'SUN' then 0 when 'MON' then 1 when 'TUE' then 2 when 'WED' then 3
          when 'THU' then 4 when 'FRI' then 5 when 'SAT' then 6 else -1 end;
        if v_day_dow = v_target_dow then
          v_cand := (v_day_date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
          if v_cand >= v_floor then
            if p_ends_at is not null and v_cand > p_ends_at then return null; end if;
            return v_cand;
          end if;
        end if;
      end loop;
    end loop;
    return null;
  end if;

  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function public._announcement_next_occurrence(text,timestamptz,timestamptz,timestamptz,text,int) from public, anon;
grant   execute on function public._announcement_next_occurrence(text,timestamptz,timestamptz,timestamptz,text,int) to authenticated;

-- ============================================================
-- 2) RPC — store_get_upcoming_announcements
-- ============================================================
-- store_get_due_announcements 와 동일한 eligibility (scope / status / quota / debounce)
-- 를 적용하되, _announcement_next_occurrence 로 계산한 정확한 scheduled_at 과
-- occurrence_key 를 함께 반환한다. 클라이언트가 server now_at 로 시계 오차를 보정해
-- scheduled_at 까지 setTimeout 을 걸고 00초에 정시 재생한다.
--
-- 반환 data[] 원소: store_get_due_announcements 의 모든 필드 +
--   scheduled_at   timestamptz  — occurrence 의 정확한 발화 시각
--   occurrence_key text         — '<schedule_id>:YYYYMMDDTHHMM' (in-memory 중복 방지 lock 키)
--
-- 윈도우: now - 15min (놓침 복구) <= scheduled_at <= now + lookahead.
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
  v_recovery    int := 900;  -- 과거 놓침 복구 허용 범위 (15min, _announcement_is_due_now window 와 일치)
  v_lookahead   int := least(greatest(coalesce(p_lookahead_seconds, 900), 60), 3600);
  v_horizon     timestamptz;
  v_results     jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
  v_horizon     := v_now + make_interval(secs => v_lookahead);

  with eligible as (
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
               and pl.played_at >= v_today_start
               and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
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
           'occurrence_key',    e.schedule_id::text || ':' ||
                                to_char(e.scheduled_at at time zone e.tz, 'YYYYMMDD"T"HH24MI')
         ) order by e.scheduled_at), '[]'::jsonb)
    into v_results
    from eligible e
   where e.scheduled_at is not null
     and e.scheduled_at <= v_horizon
     and e.today_count < e.max_plays_per_day
     and (e.last_played_at is null or e.last_played_at < (v_now - interval '5 minutes'));

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now,
    'lookahead_seconds', v_lookahead, 'data', v_results
  );
end;
$$;
revoke execute on function public.store_get_upcoming_announcements(uuid, int) from public, anon;
grant   execute on function public.store_get_upcoming_announcements(uuid, int) to authenticated;

-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare
  v_next timestamptz;
  v_rpc  int;
begin
  -- self-test: daily 23:59 → 다음 occurrence 가 non-null 이어야 함
  begin
    select public._announcement_next_occurrence('daily:23:59', null, null, now(), 'Asia/Seoul', 900)
      into v_next;
    raise notice '0388 — _announcement_next_occurrence(daily:23:59) → %', v_next;
  exception when others then
    raise warning '0388 — next_occurrence self-test failed: %', sqlerrm;
  end;

  select count(*) into v_rpc from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('_announcement_next_occurrence', 'store_get_upcoming_announcements');

  raise notice '====== 0388 Announcement exact-time trigger V2 ======';
  raise notice 'new functions: % / 2', v_rpc;
  if v_rpc = 2 then
    raise notice '0388 COMPLETE — next_occurrence helper + store_get_upcoming_announcements ready';
  else
    raise warning '0388 INCOMPLETE — expected 2 new functions, found %', v_rpc;
  end if;
end$$;
