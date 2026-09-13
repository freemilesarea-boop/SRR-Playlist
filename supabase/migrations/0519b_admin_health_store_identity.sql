-- 0519b — Recovery Console 이 매장을 정확히 지목할 수 있도록 식별자를 노출한다.
--
-- 운영자 화면에서 "숙대점 / 세션 XXX" 를 확인하고 명령을 보내려면 store_user_id 가
-- 필요하다. request_store_recovery 가 store_user_id 를 필수로 받기 때문이다
-- (전 매장 broadcast 금지). admin 전용 함수이므로 노출 범위는 admin 에 한정된다.
--
-- 반환 컬럼을 추가하므로 CREATE OR REPLACE 로는 안 되고 DROP 이 필요하다.
drop function if exists public.admin_brand_player_health(integer);

create function public.admin_brand_player_health(p_minutes integer default 1440)
returns table(
  session_id uuid,
  store_user_id uuid,
  brand_id uuid,
  brand_name text,
  store_label text,
  status text,
  seconds_since_heartbeat integer,
  seconds_on_current_track integer,
  current_track_title text,
  current_track_duration integer,
  stall_threshold_seconds integer,
  session_age_hours numeric,
  device text,
  last_seen_at timestamptz,
  pending_command text,
  pending_command_id uuid,
  pending_command_status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select h.session_id,
         s.user_id  as store_user_id,
         s.brand_id,
         h.brand_name, h.store_label, h.status,
         h.seconds_since_heartbeat, h.seconds_on_current_track,
         h.current_track_title, h.current_track_duration,
         h.stall_threshold_seconds, h.session_age_hours,
         h.device, h.last_seen_at,
         c.command      as pending_command,
         c.id           as pending_command_id,
         c.status       as pending_command_status
    from public._brand_player_session_health(p_minutes) h
    join public.brand_player_sessions s on s.id = h.session_id
    -- 가장 최근에 발행된, 아직 종결되지 않은 명령 1건 (운영자가 상태를 보게)
    left join lateral (
      select bc.id, bc.command, bc.status
        from public.brand_player_commands bc
       where bc.session_id = h.session_id
         and bc.status in ('pending', 'received', 'executing')
       order by bc.issued_at desc
       limit 1
    ) c on true;
end;
$function$;

revoke all on function public.admin_brand_player_health(integer) from public, anon;
grant execute on function public.admin_brand_player_health(integer) to authenticated;

notify pgrst, 'reload schema';
