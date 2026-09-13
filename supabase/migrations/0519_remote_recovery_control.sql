-- 0519 — 원격 복구 제어 (STORE-REMOTE-RECOVERY-CONTROL-10A)
--
-- 0518 의 brand_player_commands 를 **확장**한다. 병렬 시스템을 새로 만들지 않는다.
--
-- 왜:
--   숙대점 장애에서 자동 복구가 실패하면 지금은 점주에게 전화하는 것 외에 방법이 없다.
--   운영자가 Slack 알림 → Recovery Console → 특정 매장 · 특정 플레이어를 지목해
--   HARD_RECOVERY 를 한 번 눌러 되살릴 수 있어야 한다.
--
-- 설계 원칙:
--   • 전 매장 broadcast 불가. target 이 없는 명령은 만들 수 없다.
--   • target 우선순위: player_instance_id → session_id → store_user_id
--   • TTL 2분. 몇 시간 꺼져 있던 기기가 켜지면서 옛 reload 를 실행하면 안 된다.
--   • 상태 전이는 역전 불가 (SUCCEEDED → EXECUTING 같은 되돌림 금지)
--   • 서버측 쿨다운: hard_recovery 60초 / reload 10분. 운영자 연타 방어.
--   • ACK 는 해당 세션의 소유자만. admin 도 남의 결과를 위조하지 않는다.
--
-- 기존 호환:
--   컬럼은 전부 nullable 또는 default 를 가진 추가분이라 기존 행/클라이언트에 영향 없다.
--   command CHECK 는 값을 늘리기만 한다. reload/play/next 는 그대로 동작한다.

/* ─────────────────────────────────────────────────────────────────────────
 * 1. 컬럼 확장
 * ───────────────────────────────────────────────────────────────────────── */

alter table public.brand_player_commands
  add column if not exists store_user_id              uuid references auth.users(id) on delete cascade,
  add column if not exists target_player_instance_id  text,
  add column if not exists status                     text not null default 'pending',
  add column if not exists received_at                timestamptz,
  add column if not exists executing_at               timestamptz,
  add column if not exists completed_at               timestamptz,
  add column if not exists result_code                text,
  add column if not exists client_build_hash          text,
  add column if not exists client_player_instance_id  text;

-- 기존 행 backfill — session 으로부터 매장 소유자를 채운다.
update public.brand_player_commands c
   set store_user_id = s.user_id
  from public.brand_player_sessions s
 where c.session_id = s.id and c.store_user_id is null;

-- 이미 배달된 옛 명령은 소비 완료로 본다(상태 이력이 없던 시절 것).
update public.brand_player_commands
   set status = 'succeeded', completed_at = consumed_at
 where consumed_at is not null and status = 'pending';

update public.brand_player_commands
   set status = 'expired'
 where consumed_at is null and expires_at <= now() and status = 'pending';

/* ─────────────────────────────────────────────────────────────────────────
 * 2. 명령 종류 / 상태 제약
 * ───────────────────────────────────────────────────────────────────────── */

alter table public.brand_player_commands
  drop constraint if exists brand_player_commands_command_check;

-- app_restart / device_reboot 는 **자리만** 만든다. 웹 클라이언트는 실행하지 않고,
-- 아래 request_store_recovery 도 거부한다. 향후 Android/Windows Agent 용 예약.
alter table public.brand_player_commands
  add constraint brand_player_commands_command_check
  check (command in ('reload', 'play', 'next', 'hard_recovery', 'app_restart', 'device_reboot'));

alter table public.brand_player_commands
  drop constraint if exists brand_player_commands_status_check;

alter table public.brand_player_commands
  add constraint brand_player_commands_status_check
  check (status in ('pending', 'received', 'executing', 'succeeded', 'failed', 'expired', 'rejected'));

-- TTL 기본값을 2분으로 줄인다. 기존 행의 expires_at 은 건드리지 않는다.
alter table public.brand_player_commands
  alter column expires_at set default (now() + interval '2 minutes');

create index if not exists idx_brand_player_commands_store
  on public.brand_player_commands (store_user_id, issued_at desc);

/* ─────────────────────────────────────────────────────────────────────────
 * 3. 상태 전이 검증 — 역전 금지
 * ───────────────────────────────────────────────────────────────────────── */

create or replace function public._recovery_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'pending'   then 0
    when 'received'  then 1
    when 'executing' then 2
    else 3                     -- succeeded / failed / expired / rejected = 종결
  end;
$$;

create or replace function public._brand_player_commands_status_guard()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  -- 종결 상태에서는 어떤 상태로도 되돌아갈 수 없다.
  if public._recovery_status_rank(old.status) >= 3 then
    raise exception 'invalid status transition: % -> %', old.status, new.status;
  end if;
  -- 뒤로 가는 전이 금지 (executing -> received 등).
  if public._recovery_status_rank(new.status) < public._recovery_status_rank(old.status) then
    raise exception 'invalid status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists brand_player_commands_status_guard on public.brand_player_commands;
create trigger brand_player_commands_status_guard
  before update of status on public.brand_player_commands
  for each row execute function public._brand_player_commands_status_guard();

/* ─────────────────────────────────────────────────────────────────────────
 * 4. RLS — 매장은 자기 명령만 읽는다 (Realtime 구독용)
 * ───────────────────────────────────────────────────────────────────────── */

drop policy if exists brand_player_commands_store_read on public.brand_player_commands;
create policy brand_player_commands_store_read
  on public.brand_player_commands for select
  using (store_user_id = auth.uid());

-- 쓰기 정책은 만들지 않는다. insert/update 는 아래 SECURITY DEFINER RPC 로만.

/* ─────────────────────────────────────────────────────────────────────────
 * 5. 운영자 명령 생성 — target 필수, 쿨다운, admin 전용
 * ───────────────────────────────────────────────────────────────────────── */

create or replace function public.request_store_recovery(
  p_store_user_id uuid,
  p_command text,
  p_target_session_id uuid default null,
  p_target_player_instance_id text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session uuid;
  v_brand uuid;
  v_cooldown interval;
  v_recent timestamptz;
  v_id uuid;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  -- 웹 클라이언트가 실행하지 않는 명령은 애초에 만들지 않는다.
  if p_command not in ('reload', 'play', 'next', 'hard_recovery') then
    raise exception 'unsupported command: %', p_command;
  end if;

  if p_store_user_id is null then
    raise exception 'store_user_id required — broadcast is not allowed';
  end if;

  -- target 해석: session 이 지정되면 그것, 아니면 그 매장의 최신 heartbeat 세션 1개.
  -- **여러 세션에 뿌리지 않는다.**
  if p_target_session_id is not null then
    select s.id, s.brand_id into v_session, v_brand
      from public.brand_player_sessions s
     where s.id = p_target_session_id
       and s.user_id = p_store_user_id           -- 남의 매장 세션 지목 차단
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now());
  else
    select s.id, s.brand_id into v_session, v_brand
      from public.brand_player_sessions s
     where s.user_id = p_store_user_id
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
     order by s.last_seen_at desc nulls last
     limit 1;
  end if;

  if v_session is null then
    raise exception 'no active session for this store';
  end if;

  -- 쿨다운 — 운영자 연타 방어. 서버가 1차, 클라이언트가 2차.
  v_cooldown := case p_command
                  when 'hard_recovery' then interval '60 seconds'
                  when 'reload'        then interval '10 minutes'
                  else interval '10 seconds'
                end;

  select max(issued_at) into v_recent
    from public.brand_player_commands
   where store_user_id = p_store_user_id
     and command = p_command
     and status <> 'rejected';

  if v_recent is not null and now() - v_recent < v_cooldown then
    return jsonb_build_object(
      'success', false,
      'reason', 'cooldown',
      'retry_after_seconds', ceil(extract(epoch from (v_cooldown - (now() - v_recent))))
    );
  end if;

  insert into public.brand_player_commands
    (session_id, brand_id, command, issued_by, note,
     store_user_id, target_player_instance_id, status)
  values
    (v_session, v_brand, p_command, auth.uid(), p_note,
     p_store_user_id, p_target_player_instance_id, 'pending')
  returning id into v_id;

  return jsonb_build_object(
    'success', true,
    'command_id', v_id,
    'session_id', v_session,
    'command', p_command,
    'expires_in_seconds', 120
  );
end;
$$;

revoke all on function public.request_store_recovery(uuid, text, uuid, text, text) from public;
grant execute on function public.request_store_recovery(uuid, text, uuid, text, text) to authenticated;

/* ─────────────────────────────────────────────────────────────────────────
 * 6. 클라이언트 ACK — 해당 매장 본인만
 * ───────────────────────────────────────────────────────────────────────── */

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

revoke all on function public.ack_store_recovery(uuid, text, text, text, text) from public;
grant execute on function public.ack_store_recovery(uuid, text, text, text, text) to authenticated;

/* ─────────────────────────────────────────────────────────────────────────
 * 7. 만료 청소 — 실행되지 않은 채 TTL 이 지난 명령
 * ───────────────────────────────────────────────────────────────────────── */

create or replace function public.expire_stale_recovery_commands()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.brand_player_commands
     set status = 'expired', completed_at = now()
   where consumed_at is null
     and expires_at <= now()
     and status in ('pending', 'received');
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'expired', v_n);
end;
$$;

revoke all on function public.expire_stale_recovery_commands() from public, anon, authenticated;

/* ─────────────────────────────────────────────────────────────────────────
 * 8. heartbeat 확장 — 배달 시 status 를 received 로.
 *    반환 키는 그대로 유지한다(구버전 클라이언트 호환).
 *    ⚠ 파라미터 default 를 반드시 보존할 것 (42P13).
 * ───────────────────────────────────────────────────────────────────────── */

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
     where session_id = v_sid and consumed_at is null
     for update skip locked
  ), consumed as (
    update public.brand_player_commands c
       set consumed_at = now(),
           -- 배달됨. 아직 실행 전이므로 received.
           status = case when c.expires_at > now() and c.status = 'pending'
                         then 'received' else c.status end,
           received_at = coalesce(c.received_at, now())
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
    'command_id', v_cmd_id
  );
end;
$function$;

/* ─────────────────────────────────────────────────────────────────────────
 * 9. Realtime — 매장 클라이언트가 자기 명령을 즉시 받도록
 * ───────────────────────────────────────────────────────────────────────── */

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'brand_player_commands'
  ) then
    alter publication supabase_realtime add table public.brand_player_commands;
  end if;
exception when others then
  -- publication 이 없는 환경(로컬 등)에서는 조용히 넘어간다.
  null;
end $$;

notify pgrst, 'reload schema';
