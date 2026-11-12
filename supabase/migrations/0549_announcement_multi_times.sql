-- 0549_announcement_multi_times.sql
--
-- 안내방송 예약 시간을 여러 개 + 시간 반복(구간 안에서 N분마다)으로.
--
-- 왜
--   recurrence_rule 이 'daily:HH:MM' / 'weekly:DOW:HH:MM' 처럼 시간 하나만 받아서
--   "오픈·점심·마감에 각각" 이나 "10시~22시 매 1시간" 을 하려면 일정을 여러 개 만들어야 했다.
--
-- 문법 (기존 규칙은 항목 1개짜리로 그대로 해석 — 하위 호환)
--   once:YYYY-MM-DDTHH:MM
--   daily:<시간들>
--   weekly:MON,WED:<시간들>
--   <시간들> = 항목(,항목)*
--   항목     = HH:MM               그 시각 1회
--            | HH:MM-HH:MM/N       시작~끝(포함) N분마다 (15 ≤ N ≤ 720)
--   하루 최대 96회.
--   예) daily:10:00,14:00,18:30 · daily:10:00-22:00/60 · weekly:SAT,SUN:11:00-20:00/30,21:30
--
-- 바뀌는 것
--   · _announcement_parse_times / _announcement_rule_parts / _announcement_rule_valid /
--     _announcement_slots_per_day / _announcement_occurrences 신설 (해석기 한 곳)
--   · _announcement_is_due_now / _announcement_next_occurrence 를 위 해석기로 재작성.
--     next_occurrence 는 재생 허용창(복구 구간) 안의 "가장 최근" 회차를 우선 고른다 —
--     회차가 여러 개일 때 이미 나간 이전 회차가 다음 회차를 가리지 않게.
--   · store_get_due_announcements: 하루 횟수 상한 = greatest(max_plays_per_day, 하루 회차 수).
--     본사 요청 경로는 상한 10 고정이라 회차가 더 많으면 오후 방송이 끊기던 것을 막는다.
--   · _hq_validate_content_request: 규칙 검사를 정규식 → _announcement_rule_valid.
--   · '테스트 음악' 안내 음원(루베르 콘텐츠 스튜디오, 예약 0개) 소프트 삭제.

-- ============================================================
-- 1) 해석기
-- ============================================================
create or replace function public._announcement_parse_times(p_items text)
returns int[]
language plpgsql
immutable
as $$
declare
  v_item text;
  v_m    text[];
  v_out  int[] := '{}';
  v_s    int;
  v_e    int;
  v_step int;
  v_t    int;
begin
  if p_items is null or btrim(p_items) = '' then return null; end if;
  foreach v_item in array string_to_array(p_items, ',') loop
    v_item := btrim(v_item);
    v_m := regexp_match(v_item, '^(\d{1,2}):(\d{2})$');
    if v_m is not null then
      if v_m[1]::int > 23 or v_m[2]::int > 59 then return null; end if;
      v_out := v_out || (v_m[1]::int * 60 + v_m[2]::int);
      continue;
    end if;
    v_m := regexp_match(v_item, '^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/(\d{1,3})$');
    if v_m is null then return null; end if;
    if v_m[1]::int > 23 or v_m[2]::int > 59 or v_m[3]::int > 23 or v_m[4]::int > 59 then return null; end if;
    v_s    := v_m[1]::int * 60 + v_m[2]::int;
    v_e    := v_m[3]::int * 60 + v_m[4]::int;
    v_step := v_m[5]::int;
    if v_step < 15 or v_step > 720 or v_e < v_s then return null; end if;
    v_t := v_s;
    while v_t <= v_e loop
      v_out := v_out || v_t;
      v_t := v_t + v_step;
    end loop;
  end loop;
  select array_agg(distinct x order by x) into v_out from unnest(v_out) x;
  if v_out is null or cardinality(v_out) = 0 or cardinality(v_out) > 96 then return null; end if;
  return v_out;
end;
$$;

-- kind: 'once' | 'daily' | 'weekly' | null(해석 불가)
-- dows: 0(일)~6(토), minutes: 하루 중 분 (오름차순)
create or replace function public._announcement_rule_parts(
  p_rule text,
  out o_kind text, out o_dows int[], out o_minutes int[], out o_once timestamp)
language plpgsql
immutable
as $$
declare
  v_m   text[];
  v_tok text;
  v_d   int;
begin
  if p_rule is null then return; end if;

  v_m := regexp_match(btrim(p_rule), '^once:(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$');
  if v_m is not null then
    o_once := (v_m[1] || ' ' || v_m[2] || ':' || v_m[3])::timestamp;
    o_kind := 'once';
    return;
  end if;

  v_m := regexp_match(btrim(p_rule), '^daily:(.+)$');
  if v_m is not null then
    o_minutes := public._announcement_parse_times(v_m[1]);
    if o_minutes is null then return; end if;
    o_dows := array[0,1,2,3,4,5,6];
    o_kind := 'daily';
    return;
  end if;

  v_m := regexp_match(btrim(p_rule), '^weekly:([A-Za-z,]+):(.+)$');
  if v_m is not null then
    o_dows := '{}';
    foreach v_tok in array string_to_array(v_m[1], ',') loop
      v_d := case upper(btrim(v_tok))
        when 'SUN' then 0 when 'MON' then 1 when 'TUE' then 2 when 'WED' then 3
        when 'THU' then 4 when 'FRI' then 5 when 'SAT' then 6 else -1 end;
      if v_d < 0 then o_dows := null; return; end if;
      if not v_d = any(o_dows) then o_dows := o_dows || v_d; end if;
    end loop;
    o_minutes := public._announcement_parse_times(v_m[2]);
    if o_minutes is null or cardinality(o_dows) = 0 then o_dows := null; o_minutes := null; return; end if;
    o_kind := 'weekly';
    return;
  end if;
exception when others then
  o_kind := null; o_dows := null; o_minutes := null; o_once := null;
end;
$$;

create or replace function public._announcement_rule_valid(p_rule text)
returns boolean
language sql
immutable
as $$
  select (public._announcement_rule_parts(p_rule)).o_kind is not null;
$$;

create or replace function public._announcement_slots_per_day(p_rule text)
returns int
language sql
immutable
as $$
  select case r.o_kind when 'once' then 1 when 'daily' then cardinality(r.o_minutes)
                       when 'weekly' then cardinality(r.o_minutes) else 0 end
    from public._announcement_rule_parts(p_rule) r;
$$;

-- p_from ~ p_to (매장 local date, 포함) 사이의 회차를 시간순으로.
create or replace function public._announcement_occurrences(p_rule text, p_from date, p_to date, p_tz text)
returns setof timestamptz
language plpgsql
immutable
as $$
declare
  r   record;
  d   date;
  m   int;
begin
  select * into r from public._announcement_rule_parts(p_rule);
  if r.o_kind is null then return; end if;
  if r.o_kind = 'once' then
    if r.o_once::date between p_from and p_to then
      return next (r.o_once at time zone p_tz);
    end if;
    return;
  end if;
  d := p_from;
  while d <= p_to loop
    if extract(dow from d)::int = any(r.o_dows) then
      foreach m in array r.o_minutes loop
        return next ((d + make_interval(mins => m)) at time zone p_tz);
      end loop;
    end if;
    d := d + 1;
  end loop;
end;
$$;

-- ============================================================
-- 2) due / next — 해석기 기반 재작성 (시그니처 동일)
-- ============================================================
create or replace function public._announcement_is_due_now(
  p_recurrence text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_now timestamptz default now(), p_tz text default 'Asia/Seoul')
returns boolean
language plpgsql
immutable
as $$
declare
  v_window interval := interval '15 minutes';  -- 0386 과 동일
  v_date   date;
begin
  if p_recurrence is null then return false; end if;
  if p_starts_at is not null and p_now < p_starts_at then return false; end if;
  if p_ends_at   is not null and p_now > p_ends_at   then return false; end if;
  v_date := (p_now at time zone p_tz)::date;
  return exists (
    select 1 from public._announcement_occurrences(p_recurrence, v_date - 1, v_date, p_tz) t
     where p_now between t and t + v_window);
exception when others then
  return false;
end;
$$;

create or replace function public._announcement_next_occurrence(
  p_recurrence text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_now timestamptz default now(), p_tz text default 'Asia/Seoul',
  p_recovery_seconds integer default 900)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_floor timestamptz;
  v_date  date;
  v_cand  timestamptz;
begin
  if p_recurrence is null then return null; end if;

  v_floor := p_now - make_interval(secs => greatest(coalesce(p_recovery_seconds, 900), 0));
  if p_starts_at is not null and p_starts_at > v_floor then
    v_floor := p_starts_at;
  end if;
  v_date := (p_now at time zone p_tz)::date;

  -- 복구 구간 안에서 이미 지난 회차 중 가장 최근 것
  select max(t) into v_cand
    from public._announcement_occurrences(p_recurrence, v_date - 1, v_date, p_tz) t
   where t >= v_floor and t <= p_now
     and (p_ends_at is null or t <= p_ends_at);
  if v_cand is not null then return v_cand; end if;

  -- 없으면 다음 회차 (7일 앞까지)
  select min(t) into v_cand
    from public._announcement_occurrences(p_recurrence, v_date, v_date + 7, p_tz) t
   where t > p_now and t >= v_floor
     and (p_ends_at is null or t <= p_ends_at);
  return v_cand;
exception when others then
  return null;
end;
$$;

-- ============================================================
-- 3) store_get_due_announcements — 하루 상한을 회차 수 이상으로
-- ============================================================
create or replace function public.store_get_due_announcements(p_store_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
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
           greatest(s.max_plays_per_day, public._announcement_slots_per_day(s.recurrence_rule)) as max_plays_per_day,
           coalesce(s.timezone, 'Asia/Seoul') as tz,
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
         (s.scope_type = 'enterprise' and (s.enterprise_account_id is null
              or public._store_in_enterprise(v_uid, s.enterprise_account_id)))
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

-- ============================================================
-- 4) 본사 요청 검증 — 규칙 검사만 교체
-- ============================================================
create or replace function public._hq_validate_content_request(p_ea_id uuid, p_kind text, p_payload jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_brand uuid := public._hq_my_brand_id(p_ea_id);
  v_scope text;
  v_rule text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  if p_kind in ('music_policy', 'playback_policy', 'media_add', 'media_update', 'media_delete') and v_brand is null then
    raise exception 'no_brand: 연결된 브랜드 플레이어가 없습니다';
  end if;

  if p_kind = 'music_policy' then
    if coalesce(p_payload->>'policy_mode', '') not in ('inherit', 'custom') then
      raise exception 'invalid_policy_mode';
    end if;
    if p_payload->>'vocal_policy' is not null
       and p_payload->>'vocal_policy' not in ('any', 'vocal_ok', 'prefer_instrumental', 'instrumental_only') then
      raise exception 'invalid_vocal_policy';
    end if;

  elsif p_kind = 'playback_policy' then
    if coalesce(p_payload->>'playback_mode', '') not in ('always_on', 'business_hours') then
      raise exception 'invalid_playback_mode';
    end if;
    if p_payload->>'playback_mode' = 'business_hours' then
      if p_payload->>'open_time' is null or p_payload->>'close_time' is null then
        raise exception '영업시간 모드는 시작/종료 시각이 필요합니다.';
      end if;
      perform (p_payload->>'open_time')::time, (p_payload->>'close_time')::time;
    end if;

  elsif p_kind = 'media_add' then
    if not public._hq_valid_upload('brand-media', p_ea_id, p_payload->>'file_path', p_payload->>'url') then
      raise exception 'invalid_file';
    end if;
    if coalesce(p_payload->>'asset_type', 'image') not in ('image', 'video') then
      raise exception 'invalid_asset_type';
    end if;

  elsif p_kind in ('media_update', 'media_delete') then
    if not exists (select 1 from public.brand_media_assets m
                    where m.id = (p_payload->>'asset_id')::uuid and m.brand_id = v_brand and m.deleted_at is null) then
      raise exception 'media_not_found';
    end if;
    if p_kind = 'media_update' and p_payload->>'status' is not null
       and p_payload->>'status' not in ('active', 'inactive') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'announcement_asset_add' then
    if nullif(btrim(coalesce(p_payload->>'title', '')), '') is null then
      raise exception 'title_required';
    end if;
    if not public._hq_valid_upload('enterprise-announcements', p_ea_id, p_payload->>'file_path', p_payload->>'file_url') then
      raise exception 'invalid_file';
    end if;

  elsif p_kind = 'announcement_asset_delete' then
    if not exists (select 1 from public.enterprise_announcement_assets a
                    where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                      and a.deleted_at is null) then
      raise exception 'asset_not_found';
    end if;

  elsif p_kind in ('schedule_create', 'schedule_update') then
    if p_kind = 'schedule_update' then
      if not exists (select 1 from public.enterprise_announcement_schedules s
                      where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                        and s.deleted_at is null) then
        raise exception 'schedule_not_found';
      end if;
    else
      if nullif(btrim(coalesce(p_payload->>'name', '')), '') is null then
        raise exception 'name_required';
      end if;
      if p_payload->>'asset_id' is not null then
        if not exists (select 1 from public.enterprise_announcement_assets a
                        where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                          and a.deleted_at is null) then
          raise exception 'asset_not_found';
        end if;
      elsif p_payload->>'asset_request_id' is not null then
        if not exists (select 1 from public.hq_content_requests r
                        where r.id = (p_payload->>'asset_request_id')::uuid and r.enterprise_account_id = p_ea_id
                          and r.kind = 'announcement_asset_add' and r.status in ('pending', 'approved')) then
          raise exception 'asset_not_found';
        end if;
      else
        raise exception 'asset_required';
      end if;
      if p_payload->>'scope_type' is null then
        raise exception 'scope_required';
      end if;
    end if;

    v_scope := p_payload->>'scope_type';
    if v_scope is not null then
      if v_scope not in ('enterprise', 'region', 'store') then
        raise exception 'invalid_scope';
      end if;
      if v_scope = 'region' and not exists (
           select 1 from public.enterprise_regions r
            where r.id = (p_payload->>'region_id')::uuid and r.enterprise_account_id = p_ea_id and r.deleted_at is null) then
        raise exception 'region_not_found';
      end if;
      if v_scope = 'store' then
        if jsonb_typeof(p_payload->'store_ids') is distinct from 'array' or jsonb_array_length(p_payload->'store_ids') = 0 then
          raise exception 'stores_required';
        end if;
        if exists (select 1 from jsonb_array_elements_text(p_payload->'store_ids') x
                    where not public._store_in_enterprise(x::uuid, p_ea_id)) then
          raise exception 'store_not_in_enterprise';
        end if;
      end if;
    end if;

    -- 0549: 여러 시간 · 시간 반복 문법 — 서버 해석기로 검사.
    v_rule := p_payload->>'recurrence_rule';
    if v_rule is not null and not public._announcement_rule_valid(v_rule) then
      raise exception 'invalid_recurrence_rule';
    end if;
    if p_payload->>'status' is not null and p_payload->>'status' not in ('active', 'paused') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'schedule_delete' then
    if not exists (select 1 from public.enterprise_announcement_schedules s
                    where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                      and s.deleted_at is null) then
      raise exception 'schedule_not_found';
    end if;

  else
    raise exception 'invalid_kind';
  end if;

  return v_brand;
end;
$$;

-- ============================================================
-- 5) '테스트 음악' 안내 음원 정리 (예약 0개 · 운영 데이터 아님)
-- ============================================================
update public.enterprise_announcement_assets
   set deleted_at = now(), status = 'disabled', updated_at = now()
 where title = '테스트 음악' and deleted_at is null
   and not exists (select 1 from public.enterprise_announcement_schedules s
                    where s.asset_id = enterprise_announcement_assets.id and s.deleted_at is null);
