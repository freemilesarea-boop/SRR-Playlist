-- 0521 — 원격 APP_RESTART 를 실제로 발행할 수 있게 한다 (ANDROID-STORE-PLAYER-HARDENING-13)
--
-- 0519 에서 command CHECK 에 app_restart / device_reboot 자리를 만들어 뒀지만,
-- request_store_recovery() 는 두 값을 모두 거부하고 있었다. 이제 네이티브 안드로이드
-- 쉘이 app_restart 를 실행할 수 있으므로 **발행만** 열어준다.
--
-- app_restart = WebView/Activity 재생성. **기기 재부팅이 아니다.**
--   웹/PWA 클라이언트가 받으면 실행하지 않고 APP_RESTART_WEB_UNSUPPORTED 로 거부 ACK 한다
--   (조용히 무시하면 운영자가 "보냈는데 아무 일도 안 난다" 로 시간을 쓴다).
--
-- device_reboot 는 **계속 거부한다.** Device Owner / MDM 없이 일반 앱이 기기를
-- 재부팅할 수 없다. 자리만 남겨두고 될 것처럼 열지 않는다.
--
-- 쿨다운: app_restart 5분. 네이티브 워치독의 재실행 쿨다운(5분)과 같은 값이다 —
-- 서버와 기기가 다른 값을 쓰면 한쪽이 무의미해진다.

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
  v_id uuid;
  v_cooldown interval;
  v_recent timestamptz;
begin
  if not public._is_super_admin() then
    return jsonb_build_object('success', false, 'reason', 'forbidden: admin only');
  end if;

  -- device_reboot 는 여전히 발행할 수 없다. 될 것처럼 두지 않는다.
  if p_command not in ('reload', 'play', 'next', 'hard_recovery', 'app_restart') then
    return jsonb_build_object('success', false, 'reason', 'unsupported command');
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
                  when 'app_restart'   then interval '5 minutes'
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

revoke all on function public.request_store_recovery(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.request_store_recovery(uuid, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
