-- 0526 — "교체가 필요한가" 에 측정으로 답하기 위한 값들
--
-- 왜 — 2026-09-14 숙대점 프로세스가 사라졌을 때, 우리는 그 기기의 저장공간도
-- 힙도 **전혀 몰랐다.** 그래서 "메모리가 부족했다" 도 "저장공간이 찼다" 도
-- 증거 없이 말할 수만 있었다. 태블릿 교체 판단을 추측으로 하지 않으려면
-- 그 숫자가 서버에 남아 있어야 한다.
--
-- 전부 optional API 다. Samsung Internet 30 에 없는 것도 있다.
-- **null 은 "모른다" 이지 "정상" 이 아니다.**
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • 0522 감지 · 0525 전달 경로 무변경. 명령도 Slack 도 없다.
--   • 임계값/알림 규칙을 만들지 않는다 — 기록만 한다.
--   • 구버전 클라이언트를 끊지 않는다(새 인자 전부 nullable default).

alter table public.brand_player_sessions
  add column if not exists storage_usage_bytes  bigint,
  add column if not exists storage_quota_bytes  bigint,
  add column if not exists js_heap_used_bytes   bigint,
  add column if not exists audio_ready_state    smallint,
  add column if not exists audio_network_state  smallint;

comment on column public.brand_player_sessions.storage_usage_bytes is
  'navigator.storage.estimate().usage — 이 기기가 쓴 저장공간. 저장공간 압박을 측정으로 말하기 위한 값.';
comment on column public.brand_player_sessions.storage_quota_bytes is
  'navigator.storage.estimate().quota — 브라우저가 허용한 총량. usage/quota 가 1 에 가까우면 압박이다.';
comment on column public.brand_player_sessions.js_heap_used_bytes is
  'performance.memory.usedJSHeapSize. Chromium 계열 전용 비표준 — 없으면 null.';
comment on column public.brand_player_sessions.audio_ready_state is
  '마지막으로 **실제 재생이 진행되던 순간**의 HTMLMediaElement.readyState (0..4). 멈춘 뒤에는 마지막 정상 상태를 가리킨다.';
comment on column public.brand_player_sessions.audio_network_state is
  '같은 순간의 networkState (0..3). 소리가 멈춘 원인이 버퍼였는지 네트워크였는지를 가른다.';

drop function if exists public.brand_player_heartbeat(
  uuid, text, uuid, text, text, text, boolean, text, text, timestamptz, text, boolean, text, boolean);

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
  p_wake_lock_active boolean default null,
  p_storage_usage_bytes bigint default null,
  p_storage_quota_bytes bigint default null,
  p_js_heap_used_bytes bigint default null,
  p_audio_ready_state smallint default null,
  p_audio_network_state smallint default null
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

  v_nav := case when p_navigation_type in ('navigate','reload','back_forward','prerender','unknown')
                then p_navigation_type else null end;
  v_vis := case when p_visibility_state in ('visible','hidden','prerender','unloaded')
                then p_visibility_state else null end;
  v_rt  := case when p_realtime_status in ('SUBSCRIBED','TIMED_OUT','CLOSED','CHANNEL_ERROR')
                then p_realtime_status else null end;

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
         page_build_hash = coalesce(nullif(btrim(p_page_build_hash),''), page_build_hash),
         sw_build_hash   = coalesce(nullif(btrim(p_sw_build_hash),''),   sw_build_hash),
         sw_controlled   = coalesce(p_sw_controlled, sw_controlled),
         navigation_type = coalesce(v_nav, navigation_type),
         player_instance_id = coalesce(nullif(btrim(p_player_instance_id),''), player_instance_id),
         visibility_state   = coalesce(v_vis, visibility_state),
         client_online      = coalesce(p_client_online, client_online),
         realtime_status    = coalesce(v_rt, realtime_status),
         wake_lock_active   = coalesce(p_wake_lock_active, wake_lock_active),
         -- 18 기기 자원 — 음수는 받지 않는다. 범위 밖 media state 도 버린다.
         storage_usage_bytes = coalesce(nullif(greatest(p_storage_usage_bytes, 0), 0), storage_usage_bytes),
         storage_quota_bytes = coalesce(nullif(greatest(p_storage_quota_bytes, 0), 0), storage_quota_bytes),
         js_heap_used_bytes  = coalesce(nullif(greatest(p_js_heap_used_bytes, 0), 0), js_heap_used_bytes),
         audio_ready_state   = coalesce(
           case when p_audio_ready_state between 0 and 4 then p_audio_ready_state end, audio_ready_state),
         audio_network_state = coalesce(
           case when p_audio_network_state between 0 and 3 then p_audio_network_state end, audio_network_state),
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

revoke all on function public.brand_player_heartbeat(
  uuid, text, uuid, text, text, text, boolean, text, text, timestamptz, text, boolean, text, boolean,
  bigint, bigint, bigint, smallint, smallint) from public, anon;
grant execute on function public.brand_player_heartbeat(
  uuid, text, uuid, text, text, text, boolean, text, text, timestamptz, text, boolean, text, boolean,
  bigint, bigint, bigint, smallint, smallint) to authenticated, service_role;
