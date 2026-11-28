-- 0570 — 브랜드 플레이어가 "화면을 눌러 음악을 이어주세요"(자동재생 막힘)에 5분 넘게 멈추면 알림.
--
-- 왜: 2026-11-27 10:55 KST 이루밍 아이폰(홈 화면 웹앱)이 배포 후 스스로 새로고침했고,
--   아이폰은 새로고침한 페이지가 터치 없이 소리 내는 것을 막아 다음 날 10:13 까지 약 23시간 무음이었다.
--   플레이어는 1분마다 gate_blocked(autoplay_blocked) 진단을 보내고 있었지만 아무도 받지 않았고,
--   같은 브랜드에 다른 기기의 장애(brand_player_incidents)가 이미 열려 있어 새 알림도 나가지 않았다.
--
-- 기기(세션) 단위로 본다. 판정 근거:
--   · 세션이 살아 있다(3분 안에 신호, 해제 안 됨)
--   · 5분 넘게 소리 진행 기록이 없다
--   · 그 기기(playerInstanceId)가 최근 6분 동안 autoplay_blocked 게이트를 5번 이상 보냈다(1분 간격)
-- 한 번 알린 기기는 소리가 다시 진행된 뒤에야 다시 알린다.

create table if not exists public.brand_player_touch_alerts (
  session_id uuid primary key references public.brand_player_sessions(id) on delete cascade,
  notified_at timestamptz not null default now()
);
alter table public.brand_player_touch_alerts enable row level security;
revoke all on public.brand_player_touch_alerts from anon, authenticated;

create or replace function public.cron_check_brand_player_touch_wait()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_n int := 0;
begin
  -- 소리가 다시 진행된 기기는 알림 기록을 지운다(다음 막힘 때 다시 알린다).
  delete from public.brand_player_touch_alerts a
   using public.brand_player_sessions s
   where s.id = a.session_id
     and s.last_audio_progress_at is not null
     and s.last_audio_progress_at > a.notified_at;

  for r in
    select s.id as session_id, s.brand_id, s.enterprise_account_id, s.last_audio_progress_at,
           left(coalesce(s.user_agent, ''), 200) as ua, s.device_label,
           ea.auth_user_id, ea.enterprise_name
      from public.brand_player_sessions s
      left join public.enterprise_accounts ea on ea.id = s.enterprise_account_id
     where s.revoked_at is null
       and s.last_seen_at > now() - interval '3 minutes'
       and s.player_instance_id is not null
       and (s.last_audio_progress_at is null or s.last_audio_progress_at < now() - interval '5 minutes')
       and not exists (select 1 from public.brand_player_touch_alerts a where a.session_id = s.id)
       and (
         select count(*) from public.store_playback_diagnostics d
          where d.event = 'playback_stalled'
            and d.created_at > now() - interval '6 minutes'
            and d.context->>'gate' = 'autoplay_blocked'
            and d.context->>'playerInstanceId' = s.player_instance_id::text
       ) >= 5
  loop
    begin
      if r.auth_user_id is not null then
        insert into public.enterprise_notifications (
          enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
          title, message, severity, status, action_url, metadata)
        values (r.enterprise_account_id, 'user', r.auth_user_id, r.auth_user_id, 'brand_player_touch_wait',
          '매장 플레이어가 화면 터치를 기다리고 있어요',
          format('%s 기기에서 음악이 멈춰 있어요. 기기 화면을 한 번 눌러 주세요. (마지막 재생 %s)',
                 coalesce(r.device_label, case when r.ua ilike '%iphone%' then '아이폰'
                                               when r.ua ilike '%ipad%' then '아이패드'
                                               when r.ua ilike '%android%' then '안드로이드' else '매장' end),
                 coalesce(to_char(r.last_audio_progress_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '기록 없음')),
          'high', 'unread', '/enterprise/ops',
          jsonb_build_object('session_id', r.session_id, 'brand_id', r.brand_id));
      end if;
      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('brand_player_touch_wait', 'warning',
        format('[화면 터치 대기] %s', coalesce(r.enterprise_name, '브랜드')),
        format('자동재생이 막혀 5분 넘게 무음입니다. 마지막 재생 %s (KST). 기기: %s',
               coalesce(to_char(r.last_audio_progress_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '기록 없음'),
               r.ua),
        jsonb_build_object('session_id', r.session_id, 'brand_id', r.brand_id,
                           'enterprise_account_id', r.enterprise_account_id, 'tab', 'brand-player'),
        0, now());
    exception when others then null;
    end;
    insert into public.brand_player_touch_alerts (session_id) values (r.session_id)
    on conflict (session_id) do update set notified_at = now();
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('touch_wait_alerts', v_n);
end;
$$;
revoke all on function public.cron_check_brand_player_touch_wait() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'srr-brand-player-touch-wait';
    perform cron.schedule('srr-brand-player-touch-wait', '* * * * *', 'select public.cron_check_brand_player_touch_wait();');
  end if;
end;
$$;
