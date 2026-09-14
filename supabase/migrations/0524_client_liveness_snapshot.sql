-- 0524 — 매 heartbeat 가 "그 순간 클라이언트가 어떤 상태였는지" 를 남긴다
--
-- 왜 — 2026-09-14 숙대점. 17:29:15 heartbeat 를 끝으로 34분 완전 침묵.
-- 서버가 가진 단서는 `last_seen_at` 하나였다. 화면이 켜져 있었는지, 온라인이었는지,
-- Realtime 이 이미 끊겨 있었는지, 소리는 나고 있었는지 — 전부 몰랐다.
--
-- 그리고 그날 page_frozen · page_hidden 은 **한 줄도 남지 않았다**. listener 는
-- 멀쩡히 달려 있었고 다른 날엔 5번 기록됐다. 즉 프로세스가 OS 에 끊길 때
-- 클라이언트는 아무것도 보내지 못한다. "죽을 때 신고하게 만들자" 는 불가능하다.
--
-- 그래서 방향을 뒤집는다: **매 heartbeat 가 스냅샷을 남긴다.** 죽으면 마지막
-- heartbeat 가 부검 소견서가 된다. 최대 60초 전의 상태지만, 지금은 0 이다.
--
-- 함께 해결하는 것 — playerInstanceId 가 서버에서 보이지 않던 문제.
-- 오늘 원격 reload 를 보낼 때 가장 구체적인 target 인 player_instance_id 를
-- 쓸 수 없었다. 그 값은 Flight Recorder 가 flush 될 때만 서버에 닿았기 때문이다
-- (= 장애가 나야 알 수 있는 값이었다). 이제 heartbeat 마다 온다.
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • _brand_player_session_health / admin_brand_player_health 를 건드리지 않는다.
--     0522 감지 체계가 오늘 실전에서 처음 작동했다. 지금 그 경로를 재정의하지 않는다.
--   • 어떤 명령도 보내지 않고 Slack 도 울리지 않는다. 기록만 한다.
--   • 구버전 클라이언트를 끊지 않는다 — 새 인자는 전부 nullable default 다.
--   • 기존 컬럼을 지우거나 형을 바꾸지 않는다.

-- ----------------------------------------------------------------------------
-- 1) 세션 행에 liveness 스냅샷 칸 (전부 nullable)
-- ----------------------------------------------------------------------------
alter table public.brand_player_sessions
  add column if not exists player_instance_id     text,
  add column if not exists last_audio_progress_at timestamptz,
  add column if not exists visibility_state       text,
  add column if not exists client_online          boolean,
  add column if not exists realtime_status        text,
  add column if not exists wake_lock_active       boolean;

comment on column public.brand_player_sessions.player_instance_id is
  '이 문서에서 돌고 있는 플레이어 인스턴스 id. 원격 복구의 가장 구체적인 target — 지금까지는 Flight Recorder 가 flush 될 때만 알 수 있었다.';
comment on column public.brand_player_sessions.last_audio_progress_at is
  'currentTime 이 **실제로 늘어난** 마지막 시각. paused=false 나 audioActive 가 아니다 — 멈춘 채 재생 중이라 우기는 플레이어를 살아있다고 세지 않기 위해서다.';
comment on column public.brand_player_sessions.visibility_state is
  '마지막 heartbeat 시점의 document.visibilityState — visible | hidden | prerender | unloaded.';
comment on column public.brand_player_sessions.client_online is
  '마지막 heartbeat 시점의 navigator.onLine.';
comment on column public.brand_player_sessions.realtime_status is
  '마지막 heartbeat 시점의 Realtime 채널 상태 — SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR. 명령이 안 갔을 때 "채널이 끊겨서" 인지 "프로세스가 없어서" 인지 가른다.';
comment on column public.brand_player_sessions.wake_lock_active is
  '화면 꺼짐 방지가 실제로 잡혀 있었는가. PWA 에서는 navigator.wakeLock, 네이티브 쉘에서는 KeepAwake.';

-- ----------------------------------------------------------------------------
-- 2) heartbeat — 인자 6개 추가. **전부 default null.**
--
--    옛 8인자 시그니처는 **먼저 지운다.** 둘이 공존하면 8개짜리 호출이 두 후보를
--    다 만족해 ambiguous 로 실패한다 — 그러면 정작 보호하려던 구버전 매장의
--    heartbeat 가 끊긴다(0523 에서 같은 이유로 같은 순서를 썼다).
-- ----------------------------------------------------------------------------
drop function if exists public.brand_player_heartbeat(uuid, text, uuid, text, text, text, boolean, text);

create or replace function public.brand_player_heartbeat(
  p_brand_id uuid,
  p_session_token text,
  p_current_track_id uuid default null,
  p_user_agent text default null,
  p_page_build_hash text default null,
  p_sw_build_hash text default null,
  p_sw_controlled boolean default null,
  p_navigation_type text default null,
  p_player_instance_id text default null,
  p_last_audio_progress_at timestamptz default null,
  p_visibility_state text default null,
  p_client_online boolean default null,
  p_realtime_status text default null,
  p_wake_lock_active boolean default null
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
  v_nav text;
  v_vis text;
  v_rt text;
  v_progress timestamptz;
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  if auth.uid() is null then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');

  -- 알려진 값만 받는다. 클라이언트 자유 텍스트를 그대로 쌓지 않는다.
  v_nav := case when p_navigation_type in ('navigate','reload','back_forward','prerender','unknown')
                then p_navigation_type else null end;
  v_vis := case when p_visibility_state in ('visible','hidden','prerender','unloaded')
                then p_visibility_state else null end;
  v_rt  := case when p_realtime_status in ('SUBSCRIBED','TIMED_OUT','CLOSED','CHANNEL_ERROR')
                then p_realtime_status else null end;

  -- 미래 시각은 받지 않는다. 기기 시계가 틀어져도 죽은 플레이어가 싱싱해 보이면 안 된다.
  v_progress := case when p_last_audio_progress_at is null then null
                     else least(p_last_audio_progress_at, now()) end;

  update public.brand_player_sessions
     set last_seen_at = now(),
         current_track_id = coalesce(p_current_track_id, current_track_id),
         current_track_started_at = case
           when p_current_track_id is not null
                and p_current_track_id is distinct from current_track_id then now()
           else coalesce(current_track_started_at, now())
         end,
         playback_started_at = coalesce(playback_started_at, now()),
         user_agent = coalesce(nullif(p_user_agent,''), user_agent),
         -- 16A build identity — 보낸 경우에만 덮어쓴다(구버전의 null 이 지우지 않게).
         page_build_hash = coalesce(nullif(btrim(p_page_build_hash),''), page_build_hash),
         sw_build_hash   = coalesce(nullif(btrim(p_sw_build_hash),''),   sw_build_hash),
         sw_controlled   = coalesce(p_sw_controlled, sw_controlled),
         navigation_type = coalesce(v_nav, navigation_type),
         -- 17 liveness 스냅샷 — 같은 규칙. null 은 지우지 않는다.
         player_instance_id = coalesce(nullif(btrim(p_player_instance_id),''), player_instance_id),
         visibility_state   = coalesce(v_vis, visibility_state),
         client_online      = coalesce(p_client_online, client_online),
         realtime_status    = coalesce(v_rt, realtime_status),
         wake_lock_active   = coalesce(p_wake_lock_active, wake_lock_active),
         -- 진행 시각은 **뒤로 가지 않는다.** 늦게 도착한 heartbeat 가 되감으면
         -- 마지막으로 소리가 난 순간을 잃는다.
         last_audio_progress_at = case
           when v_progress is null then last_audio_progress_at
           when last_audio_progress_at is null then v_progress
           else greatest(last_audio_progress_at, v_progress)
         end
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
       and status = 'pending'
     for update skip locked
  ), consumed as (
    update public.brand_player_commands c
       set consumed_at = now(),
           status = case when c.expires_at > now() and c.status = 'pending'
                         then 'received' else c.status end,
           received_at = coalesce(c.received_at, now()),
           delivery_source = coalesce(c.delivery_source, 'heartbeat')
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
    'session_id', v_sid
  );
end;
$function$;

-- 기존과 동일한 권한 — 매장 클라이언트가 부른다.
revoke all on function public.brand_player_heartbeat(
  uuid, text, uuid, text, text, text, boolean, text, text, timestamptz, text, boolean, text, boolean)
  from public, anon;
grant execute on function public.brand_player_heartbeat(
  uuid, text, uuid, text, text, text, boolean, text, text, timestamptz, text, boolean, text, boolean)
  to authenticated, service_role;
