-- 0520 — 원격 복구 명령을 Realtime 으로 즉시 배달한다 (STORE-REMOTE-RECOVERY-REALTIME-SLACK-11)
--
-- 0518/0519 의 brand_player_commands 를 그대로 쓴다. 새 명령 시스템을 만들지 않는다.
--
-- 지금까지의 한계:
--   명령은 heartbeat 응답에만 실려 갔다. heartbeat 는 60초 주기라 최악 60초가 걸린다.
--   매장이 멈춰 있는 60초는 그대로 무음이다. 테이블은 이미 supabase_realtime
--   publication 에 올라가 있었지만(0519 §9) 클라이언트가 구독하지 않아 쓰이지 않았다.
--
-- 이 마이그레이션이 하는 일:
--   1. 매장 클라이언트가 자기 명령 row 를 SELECT 할 수 있게 테이블 권한을 명시한다.
--      (RLS 정책 brand_player_commands_store_read 는 0519 에서 이미 만들었다.
--       정책만 있고 GRANT 가 암묵적이면 환경에 따라 Realtime 이 조용히 0건이 된다.)
--   2. heartbeat 가 **이미 Realtime 으로 배달된 명령을 다시 배달하지 않게** 한다.
--      이게 없으면 원격 reload 가 리로드 후 heartbeat 로 재배달되어 무한 리로드가 된다.
--   3. delivery_source 를 남긴다 — Realtime 이 실제로 동작했는지 사후에 알 수 있어야 한다.
--   4. heartbeat 응답에 session_id 를 실어 준다. 클라이언트가 자기 세션을 알아야
--      session 지목 명령(다른 탭 대상)을 걸러낼 수 있다.
--
-- 호환:
--   컬럼은 nullable 추가 1개. 함수는 반환 키 추가만(기존 키 불변).
--   구버전 클라이언트는 session_id 를 무시하므로 그대로 동작한다.

/* ─────────────────────────────────────────────────────────────────────────
 * 1. 배달 경로 기록 + 매장 SELECT 권한
 * ───────────────────────────────────────────────────────────────────────── */

alter table public.brand_player_commands
  add column if not exists delivery_source text;

alter table public.brand_player_commands
  drop constraint if exists brand_player_commands_delivery_source_check;

alter table public.brand_player_commands
  add constraint brand_player_commands_delivery_source_check
  check (delivery_source is null or delivery_source in ('realtime', 'heartbeat'));

comment on column public.brand_player_commands.delivery_source is
  '명령이 실제로 어느 경로로 클라이언트에 닿았는가. heartbeat=폴링 fallback, realtime=WebSocket.';

-- 매장 클라이언트의 Realtime 구독용. 행 범위는 RLS(store_user_id = auth.uid()) 가 정한다.
-- 쓰기 권한은 주지 않는다 — insert/update 는 SECURITY DEFINER RPC 로만.
grant select on public.brand_player_commands to authenticated;
revoke insert, update, delete on public.brand_player_commands from authenticated;
revoke all on public.brand_player_commands from anon;

/* ─────────────────────────────────────────────────────────────────────────
 * 2. heartbeat — fallback 유지 + 중복 배달 차단 + session_id 반환
 * ───────────────────────────────────────────────────────────────────────── */
--
-- 변경점은 세 줄뿐이다:
--   (a) pending CTE 에 status = 'pending' 조건 → Realtime 이 먼저 집어간(received/
--       executing) 명령을 heartbeat 가 다시 주지 않는다. 기존 경로는 삽입 직후 항상
--       'pending' 이므로 동작이 달라지지 않는다.
--   (b) delivery_source 를 'heartbeat' 로 각인 (이미 값이 있으면 유지)
--   (c) 반환에 session_id 추가
create or replace function public.brand_player_heartbeat(
  p_brand_id uuid,
  p_session_token text,
  p_current_track_id uuid default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_sid uuid;
  v_cmd_id uuid;
  v_cmd text;
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  if auth.uid() is null then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');

  update public.brand_player_sessions
     set last_seen_at = now(),
         current_track_id = coalesce(p_current_track_id, current_track_id),
         current_track_started_at = case
           when p_current_track_id is not null
                and p_current_track_id is distinct from current_track_id then now()
           else coalesce(current_track_started_at, now())
         end,
         playback_started_at = coalesce(playback_started_at, now()),
         user_agent = coalesce(nullif(p_user_agent,''), user_agent)
   where brand_id = p_brand_id and session_token_hash = v_hash
     and user_id = auth.uid()
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   returning id into v_sid;

  if v_sid is null then
    return jsonb_build_object('success', false);
  end if;

  with pending as (
    select id
      from public.brand_player_commands
     where session_id = v_sid
       and consumed_at is null
       and status = 'pending'          -- (a) Realtime 이 집어간 건은 건드리지 않는다
     for update skip locked
  ), consumed as (
    update public.brand_player_commands c
       set consumed_at = now(),
           -- 배달됨. 아직 실행 전이므로 received.
           status = case when c.expires_at > now() and c.status = 'pending'
                         then 'received' else c.status end,
           received_at = coalesce(c.received_at, now()),
           delivery_source = coalesce(c.delivery_source, 'heartbeat')   -- (b)
      from pending p
     where c.id = p.id
    returning c.id, c.command, c.issued_at, c.expires_at
  )
  select id, command into v_cmd_id, v_cmd
    from consumed
   where expires_at > now()
   order by issued_at desc
   limit 1;

  return jsonb_build_object(
    'success', true,
    'command', v_cmd,
    'command_id', v_cmd_id,
    'session_id', v_sid                                                 -- (c)
  );
end;
$function$;

/* ─────────────────────────────────────────────────────────────────────────
 * 3. ACK — 어느 경로로 닿았는지 각인
 * ───────────────────────────────────────────────────────────────────────── */
--
-- heartbeat 는 배달 시점에 'heartbeat' 를 각인한다. 따라서 ACK 시점에 아직 비어
-- 있다면 그 명령은 heartbeat 를 거치지 않은 것 = Realtime 으로 닿은 것이다.
-- 클라이언트가 스스로 신고하는 값이 아니므로 위조할 수 없다.
create or replace function public.ack_store_recovery(
  p_command_id uuid,
  p_status text,
  p_result_code text default null,
  p_build_hash text default null,
  p_player_instance_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason', 'unauthenticated');
  end if;
  if p_status not in ('received', 'executing', 'succeeded', 'failed', 'expired', 'rejected') then
    raise exception 'invalid status: %', p_status;
  end if;

  select store_user_id into v_owner
    from public.brand_player_commands where id = p_command_id;

  -- 남의 매장 명령 결과를 위조할 수 없다.
  if v_owner is null or v_owner <> auth.uid() then
    return jsonb_build_object('success', false, 'reason', 'not_found');
  end if;

  begin
    update public.brand_player_commands
       set status       = p_status,
           result_code  = coalesce(p_result_code, result_code),
           client_build_hash = coalesce(p_build_hash, client_build_hash),
           client_player_instance_id = coalesce(p_player_instance_id, client_player_instance_id),
           delivery_source = coalesce(delivery_source, 'realtime'),
           received_at  = coalesce(received_at,  case when p_status = 'received'  then now() end),
           executing_at = coalesce(executing_at, case when p_status = 'executing' then now() end),
           completed_at = case when p_status in ('succeeded','failed','expired','rejected')
                               then now() else completed_at end
     where id = p_command_id;
  exception when others then
    -- 상태 역전 트리거에 걸린 경우 — 조용히 무시한다(중복 ACK).
    return jsonb_build_object('success', false, 'reason', 'invalid_transition');
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.ack_store_recovery(uuid, text, text, text, text) from public, anon;
grant execute on function public.ack_store_recovery(uuid, text, text, text, text) to authenticated;

/* ─────────────────────────────────────────────────────────────────────────
 * 4. Recovery Console 관측 — 어느 경로로 갔고 언제 닿았는가
 * ───────────────────────────────────────────────────────────────────────── */
-- 반환 컬럼 추가라 DROP 이 필요하다.
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
  pending_command_status text,
  pending_command_delivery_source text,
  last_command_received_at timestamptz,
  last_command_delivery_source text
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
         c.command         as pending_command,
         c.id              as pending_command_id,
         c.status          as pending_command_status,
         c.delivery_source as pending_command_delivery_source,
         d.received_at     as last_command_received_at,
         d.delivery_source as last_command_delivery_source
    from public._brand_player_session_health(p_minutes) h
    join public.brand_player_sessions s on s.id = h.session_id
    -- 가장 최근에 발행된, 아직 종결되지 않은 명령 1건 (운영자가 상태를 보게)
    left join lateral (
      select bc.id, bc.command, bc.status, bc.delivery_source
        from public.brand_player_commands bc
       where bc.session_id = h.session_id
         and bc.status in ('pending', 'received', 'executing')
       order by bc.issued_at desc
       limit 1
    ) c on true
    -- 마지막으로 실제 클라이언트에 닿은 명령 1건 — Realtime 이 도는지 판단 근거.
    left join lateral (
      select bc.received_at, bc.delivery_source
        from public.brand_player_commands bc
       where bc.session_id = h.session_id
         and bc.received_at is not null
       order by bc.received_at desc
       limit 1
    ) d on true;
end;
$function$;

revoke all on function public.admin_brand_player_health(integer) from public, anon;
grant execute on function public.admin_brand_player_health(integer) to authenticated;

notify pgrst, 'reload schema';
