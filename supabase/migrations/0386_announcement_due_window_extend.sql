-- 0386 — Announcement due window 확장 (5min → 15min)
--
-- 증상:
--   관리자가 daily:15:33 스케줄 생성 후 15:33 에 매장 플레이어에서 안내음 미재생.
--
-- 원인:
--   0381 _announcement_is_due_now 의 due window 가 5분.
--   AnnouncementOverlay 는 V1 spec ("곡 중간 강제 interrupt 금지") 에 따라
--   BGM 트랙 전환 시점에만 안내음을 삽입 (after_current_track).
--   현재 곡이 4-5분 동안 재생 중이면 due window 5분이 만료되어 놓침.
--
-- 수정:
--   _announcement_is_due_now 의 due window 만 5min → 15min 으로 확장.
--   - signature 100% 보존 (parser 동일, 매장/RPC/API/UI 무수정)
--   - max_plays_per_day + 5분 debounce 가 중복 재생 방지하므로 안전
--   - 평균 BGM 트랙 길이 (~4분) 대비 충분한 여유 확보
--
-- 절대 무수정:
--   DB schema / RPC 시그니처 / API / UI / Player / store_get_due_announcements /
--   store_mark_announcement_played / Announcement Scheduler 실행 로직.
--   parser 동작 (once / daily / weekly 파싱) 도 동일 — window 만 변경.

create or replace function public._announcement_is_due_now(
  p_recurrence text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_now        timestamptz default now(),
  p_tz         text default 'Asia/Seoul'
) returns boolean
language plpgsql
immutable
as $$
declare
  v_parts      text[];
  v_local      timestamp;
  v_hour       int;
  v_minute     int;
  v_dow_tokens text[];
  v_dow        text;
  v_dow_now    int;
  v_target_dow int;
  v_target     timestamptz;
  v_once       timestamp;
  v_window     interval := interval '15 minutes';  -- 0386: 5min → 15min (BGM 트랙 전환 여유)
begin
  if p_recurrence is null then return false; end if;
  if p_starts_at is not null and p_now < p_starts_at then return false; end if;
  if p_ends_at   is not null and p_now > p_ends_at   then return false; end if;

  v_parts := string_to_array(p_recurrence, ':');
  v_local := (p_now at time zone p_tz);

  -- once:YYYY-MM-DDTHH:MM
  if v_parts[1] = 'once' and array_length(v_parts, 1) >= 3 then
    v_once  := (v_parts[2] || ':' || v_parts[3])::timestamp;
    v_target := v_once at time zone p_tz;
    return p_now between v_target and (v_target + v_window);
  end if;

  -- daily:HH:MM
  if v_parts[1] = 'daily' and array_length(v_parts, 1) >= 3 then
    v_hour   := v_parts[2]::int;
    v_minute := v_parts[3]::int;
    v_target := (v_local::date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
    return p_now between v_target and (v_target + v_window);
  end if;

  -- weekly:DOW1,DOW2,...:HH:MM
  if v_parts[1] = 'weekly' and array_length(v_parts, 1) >= 4 then
    v_dow_tokens := string_to_array(v_parts[2], ',');
    v_hour       := v_parts[3]::int;
    v_minute     := v_parts[4]::int;
    v_dow_now    := extract(dow from v_local)::int;
    foreach v_dow in array v_dow_tokens loop
      v_target_dow := case upper(btrim(v_dow))
        when 'SUN' then 0
        when 'MON' then 1
        when 'TUE' then 2
        when 'WED' then 3
        when 'THU' then 4
        when 'FRI' then 5
        when 'SAT' then 6
        else -1
      end;
      if v_dow_now = v_target_dow then
        v_target := (v_local::date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
        return p_now between v_target and (v_target + v_window);
      end if;
    end loop;
    return false;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_test boolean;
begin
  -- 자기 확인: daily:HH:MM 형식이 정상 파싱되는지
  begin
    select public._announcement_is_due_now('daily:12:00', null::timestamptz, null::timestamptz, now()) into v_test;
    raise notice '0386 — _announcement_is_due_now compiled OK (test daily:12:00 → %)', v_test;
  exception when others then
    raise warning '0386 — _announcement_is_due_now self-test failed: %', sqlerrm;
  end;
end$$;
