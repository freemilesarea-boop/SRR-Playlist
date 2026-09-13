-- 0518: 브랜드 플레이어 원격 제어 (명령 큐)
--
-- 배경: 매장 플레이어가 stalled(세션은 살아있는데 곡이 안 넘어감) 상태가 돼도
-- 서버에서 손쓸 방법이 없어 점주에게 F5 를 부탁하는 것 외에 방법이 없었다.
-- 플레이어는 Realtime 을 구독하지 않으므로, 이미 60초마다 도는 heartbeat 응답에
-- 명령을 실어보내는 방식으로 통로를 만든다(새 폴링 추가 없음).
--
-- 안전장치
--  - 명령은 만료된다(기본 10분). 새벽에 몇 시간 묵은 reload 가 터지면 안 된다.
--  - 배달 시점에 소비 처리하고, 같은 세션의 대기 명령은 함께 정리한다(중복 실행 방지).
--  - 명령 종류는 화이트리스트. 임의 문자열을 플레이어로 흘려보내지 않는다.
--  - 발급은 super admin 만. 조회는 발급자/관리자만.

create table if not exists public.brand_player_commands (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.brand_player_sessions(id) on delete cascade,
  brand_id     uuid not null,
  command      text not null check (command in ('reload','play','next')),
  issued_by    uuid references auth.users(id) on delete set null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes',
  consumed_at  timestamptz,
  note         text
);

-- 대기 중인 명령만 빠르게 찾는다.
create index if not exists idx_brand_player_commands_pending
  on public.brand_player_commands (session_id, issued_at desc)
  where consumed_at is null;

alter table public.brand_player_commands enable row level security;

-- 플레이어는 이 테이블을 직접 읽지 않는다(heartbeat RPC 가 security definer 로 전달).
create policy brand_player_commands_admin_read
  on public.brand_player_commands for select
  using (public._is_super_admin());

comment on table public.brand_player_commands is
  '매장 플레이어 원격 제어 명령 큐. heartbeat 응답으로 1회 배달되고 만료된다.';

-- ── heartbeat: 기존 동작 유지 + 대기 명령 배달 ────────────────────────────
-- 반환에 command/command_id 키가 추가된다. 구버전 클라이언트는 무시하므로 호환된다.
-- 기존 시그니처의 기본값을 그대로 유지해야 한다(defaults 제거 시 CREATE OR REPLACE 실패).
create or replace function public.brand_player_heartbeat(
  p_brand_id uuid,
  p_session_token text,
  p_current_track_id uuid default null,
  p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
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

  -- 이 세션의 대기 명령을 한 번에 소비한다. 살아남는 건 가장 최근 것 하나뿐 —
  -- 관리자가 버튼을 두 번 눌렀다고 리로드가 두 번 돌면 안 된다.
  with pending as (
    select id, command, issued_at
      from public.brand_player_commands
     where session_id = v_sid and consumed_at is null
     for update skip locked
  ), consumed as (
    update public.brand_player_commands c
       set consumed_at = now()
      from pending p
     where c.id = p.id
    returning c.id, c.command, c.issued_at, c.expires_at
  )
  select id, command into v_cmd_id, v_cmd
    from consumed
   where expires_at > now()          -- 만료된 명령은 소비만 하고 배달하지 않는다
   order by issued_at desc
   limit 1;

  return jsonb_build_object(
    'success', true,
    'command', v_cmd,
    'command_id', v_cmd_id
  );
end;
$fn$;

-- ── 발급 (super admin) ────────────────────────────────────────────────────
create or replace function public.admin_enqueue_brand_player_command(
  p_session_id uuid,
  p_command text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare v_brand uuid; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_command not in ('reload','play','next') then
    raise exception 'invalid command: %', p_command;
  end if;

  select brand_id into v_brand
    from public.brand_player_sessions
   where id = p_session_id
     and revoked_at is null
     and (expires_at is null or expires_at > now());
  if v_brand is null then
    raise exception 'session not found or inactive';
  end if;

  insert into public.brand_player_commands (session_id, brand_id, command, issued_by, note)
  values (p_session_id, v_brand, p_command, auth.uid(), nullif(btrim(p_note),''))
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'command', p_command);
end;
$fn$;

revoke all on function public.admin_enqueue_brand_player_command(uuid, text, text) from public;
grant execute on function public.admin_enqueue_brand_player_command(uuid, text, text) to authenticated;
