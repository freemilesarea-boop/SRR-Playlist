-- 0528 — incident 는 **자기 기기**만 본다 (FALSE RECOVERY 제거)
--
-- 사고: 2026-09-15 14:34:00 KST 숙대점.
--   14:05:19  매장 Android 태블릿(session 823034d7) 마지막 heartbeat
--   14:09:00  incident c3bdc4a1 열림 (session_id = 823034d7 로 정확히 기록됨)
--   14:11:00  DOWN Slack — 감지 체계는 제대로 작동했다
--   14:32:22  같은 계정으로 **Windows 데스크톱**에서 플레이어 세션 b2e9e765 생성
--   14:33:00  healthy_checks 1
--   14:34:00  healthy_checks 2 → resolved_at + "음악 재생이 복구됐습니다" Slack
--             그 시점 태블릿 침묵 **28분 41초**. 매장은 여전히 조용했다.
--
-- 원인은 한 줄이다. _brand_player_liveness 의 canonical 선택:
--
--     select distinct on (h.user_id) h.*  order by h.user_id, h.seconds_since_heartbeat asc
--
-- 매장당 한 줄로 접으면서 **heartbeat 가 가장 싱싱한 세션**을 고른다. 기기를 가리지
-- 않는다. 그래서 같은 계정으로 다른 기기에서 플레이어를 여는 것만으로 죽은 매장
-- 재생기가 가려지고 incident 가 닫힌다. 운영자가 상태를 확인하려고 플레이어를
-- 여는 그 행동이 감지기를 눈멀게 한다.
--
-- 0522 주석은 stream_sessions_v2 를 생존 판정에서 뺀 이유로 정확히 이 위험을 적었다
-- ("옛 세션이나 다른 탭에서 올라온 heartbeat 가 정작 죽은 매장 플레이어를 ONLINE 으로
--   붙잡아둘 수 있다"). 같은 구멍이 brand_player_sessions 안에도 남아 있었다.
--
-- ── 고치는 방법: 최소 변경 ──────────────────────────────────────────────────
-- detect_brand_player_incidents 는 **건드리지 않는다.** 이미 옳은 값을 갖고 있다 —
-- brand_player_incidents.session_id 에 태블릿 세션이 정확히 박혀 있었고, 판정만 그걸
-- 무시했다. 그래서 canonical 선택 한 곳만 고친다:
--
--     열린 incident 가 있는 매장은, 그 incident 가 가리키는 세션을 canonical 로 쓴다.
--
-- incident 를 **여는** 규칙은 그대로다(가장 싱싱한 세션 기준). 바뀌는 것은 열린 뒤의
-- 유지/해소 판정이고, 그것이 정확히 이번 결함이다.
--
-- ── 안정적 install 식별자로서 brand_player_sessions.id 의 범위 ──────────────
-- 사용 가능하다. 근거: 숙대 태블릿 세션 823034d7 은 2026-09-09 08:27:20 에 생성된 뒤
-- 문서 재시작 여러 번(player_instance_id 가 86ec3342 → 12d7a7b1 로 바뀜)과 원격
-- reload 1회를 모두 넘기고 동일하게 유지됐다. 세션 토큰이 기기 localStorage 에 남아
-- 있는 한(brandSession.ts, BINDING_PREFIX) 이 id 는 install 에 귀속된다.
-- 한계도 명시한다: 브라우저 저장소를 지우거나 기기를 교체하면 새 id 가 된다.
-- player_instance_id 는 문서마다 바뀌므로 **단독으로 쓰지 않는다.**
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • detect_brand_player_incidents 본문 무변경 (0527 의 frozen 경로 포함 그대로).
--   • silence / stalled / frozen 판정 규칙 무변경.
--   • 어떤 명령도 보내지 않고 Slack 규칙도 바꾸지 않는다.
--   • 세션을 revoke 하거나 정리하지 않는다.
--
-- ※ 적용 순서: 0527 → 0528. 둘 다 _brand_player_liveness 를 다시 만든다.

-- ----------------------------------------------------------------------------
-- 1) 진단 이벤트 CHECK — 27 이 추가한 두 종을 마저 넣는다
--
--    0512 의 8종에서 멈춰 있던 목록을 0527 이 13종으로 넓혔고, 여기서 15종이 된다.
--    log_store_playback_diagnostic 은 CHECK 위반을 조용히 삼키므로(exception when
--    others then return), 빠진 이벤트는 **에러 한 줄 없이 사라진다.**
-- ----------------------------------------------------------------------------
alter table public.store_playback_diagnostics
  drop constraint if exists store_playback_diagnostics_event_check;

alter table public.store_playback_diagnostics
  add constraint store_playback_diagnostics_event_check check (event in (
    'session_start', 'page_frozen', 'page_resumed', 'page_hidden',
    'autoplay_blocked', 'autoplay_recovered', 'track_cut_short', 'playback_stalled',
    'update_pending', 'update_activated', 'update_blocked',   -- 22
    'sw_controllerchange',                                    -- 24
    'audio_frozen',                                           -- 25
    'app_error',                                              -- 27 전역 예외
    'shell_health'                                            -- 27 셸 생존
  ));

-- ----------------------------------------------------------------------------
-- 2) 셸 계층 생존 시각
--
--    last_seen_at 과 **따로** 둔다. 같은 칸에 쓰면 셸이 살아 있다는 이유로 죽은
--    플레이어가 살아 있어 보인다 — 이번 Phase 가 없애려는 바로 그 오인이다.
-- ----------------------------------------------------------------------------
alter table public.brand_player_sessions
  add column if not exists shell_last_seen_at timestamptz;

comment on column public.brand_player_sessions.shell_last_seen_at is
  '앱 셸(AppShell 제어면)이 마지막으로 살아 있음을 알린 시각. last_seen_at(플레이어 계층)과 **다른 칸이다** — 2026-09-15 숙대점에서 플레이어가 멈춘 뒤에도 셸은 26분 38초 동안 5초마다 서버와 통신했다. 이 값이 싱싱한데 last_seen_at 이 낡았다면 "플레이어만 죽었다"는 뜻이고, 웹으로 복구할 수 있다.';

-- ----------------------------------------------------------------------------
-- 3) 셸 폴백 폴링 RPC — 플레이어가 멈춘 동안에만 호출된다
--
--    왜 heartbeat 를 재사용하지 않는가: brand_player_heartbeat 는 last_seen_at 과
--    last_audio_progress_at 을 갱신한다. 셸이 그걸 부르면 **죽은 플레이어가 살아
--    있는 것으로 기록된다.** 감시를 눈멀게 하지 않으려면 쓰는 칸이 달라야 한다.
--
--    명령 소비 규약(consumed_at / status / received_at / delivery_source)은
--    heartbeat 와 **정확히 같다** — exactly-once 가 두 경로로 갈라지지 않도록.
-- ----------------------------------------------------------------------------
create or replace function public.brand_player_shell_poll(
  p_brand_id uuid,
  p_session_token text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  -- 셸 생존만 찍는다. last_seen_at · last_audio_progress_at · current_track_* 은
  -- **건드리지 않는다.**
  update public.brand_player_sessions
     set shell_last_seen_at = now()
   where brand_id = p_brand_id and session_token_hash = v_hash
     and user_id = auth.uid()
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   returning id into v_sid;

  if v_sid is null then return jsonb_build_object('success', false); end if;

  with pending as (
    select id from public.brand_player_commands
     where session_id = v_sid and consumed_at is null and status = 'pending'
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
    from consumed where expires_at > now() order by issued_at desc limit 1;

  return jsonb_build_object(
    'success', true, 'command', v_cmd, 'command_id', v_cmd_id, 'session_id', v_sid);
end;
$fn$;

revoke all on function public.brand_player_shell_poll(uuid, text) from public, anon;
grant execute on function public.brand_player_shell_poll(uuid, text) to authenticated, service_role;

comment on function public.brand_player_shell_poll(uuid, text) is
  '앱 셸이 플레이어 계층 정지 중에만 부르는 폴백. 셸 생존을 찍고 대기 중인 복구 명령을 소비한다. 플레이어 생존 칸(last_seen_at, last_audio_progress_at)은 건드리지 않는다.';

-- ----------------------------------------------------------------------------
-- 4) ★ canonical 선택 — 열린 incident 는 **자기 세션**으로 판정된다
--
--    incident 를 여는 규칙은 그대로(가장 싱싱한 세션). 바뀌는 것은 열린 뒤다.
--    다른 기기 세션이 아무리 싱싱해도 그 incident 의 해소에 영향 0.
--
--    한계를 정직하게 적어둔다 — _brand_player_session_health(p_minutes) 가
--    last_seen_at 이 그 창 안인 세션만 돌려주므로, 죽은 세션이 24시간을 넘기면
--    목록에서 빠지고 그때는 다시 다른 기기가 canonical 이 된다. 24시간 넘게 열린
--    incident 는 이미 사람이 봐야 하는 건이라 여기서 더 늘리지 않는다.
-- ----------------------------------------------------------------------------
-- ★ 0527 과 같은 이유로 먼저 지운다. create or replace 는 반환 타입을 못 바꾸고,
--   여기서는 shell_age_seconds 한 칸이 더 붙는다. 빈 DB 에 0522 → 0527 → 0528
--   순서로 실제 적용해 확인했다.
drop function if exists public._brand_player_liveness(integer);

create or replace function public._brand_player_liveness(p_minutes integer default 1440)
returns table(
  brand_id uuid, brand_name text, user_id uuid, store_label text,
  heartbeat_age_seconds integer, last_signal_at timestamptz,
  session_id uuid, device text, current_track_title text,
  seconds_on_current_track integer, stall_threshold_seconds integer,
  playback_expected boolean, monitoring_exempt boolean,
  audio_progress_age_seconds integer, last_audio_progress_at timestamptz,
  shell_age_seconds integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- 매장별로 "지금 열려 있는 incident 가 지목한 세션".
  with open_inc as (
    select distinct on (i.store_user_id) i.store_user_id, i.session_id
      from public.brand_player_incidents i
     where i.resolved_at is null and i.session_id is not null
     order by i.store_user_id, i.opened_at desc
  ),
  -- _brand_player_session_health 는 이미 revoked_at is null 로 거른다.
  canonical as (
    select distinct on (h.user_id) h.*
      from public._brand_player_session_health(greatest(1, p_minutes)) h
      left join open_inc oi on oi.store_user_id = h.user_id
     order by h.user_id,
              -- ★ 열린 incident 가 가리키는 세션을 **무조건 먼저** 고른다.
              --   이 한 줄이 2026-09-15 FALSE RECOVERY 를 막는다.
              (oi.session_id is not null and h.session_id = oi.session_id) desc,
              h.seconds_since_heartbeat asc
  )
  select c.brand_id, c.brand_name, c.user_id, c.store_label,
         c.seconds_since_heartbeat,
         c.last_seen_at,
         c.session_id, c.device, c.current_track_title,
         c.seconds_on_current_track, c.stall_threshold_seconds,
         coalesce((public.resolve_brand_playback_window(c.brand_id)->>'should_play')::boolean, true),
         exists (select 1 from public.brand_player_monitoring_exempt e
                  where e.store_user_id = c.user_id),
         case when bps.last_audio_progress_at is null then null
              else extract(epoch from (now() - bps.last_audio_progress_at))::integer end,
         bps.last_audio_progress_at,
         case when bps.shell_last_seen_at is null then null
              else extract(epoch from (now() - bps.shell_last_seen_at))::integer end
    from canonical c
    left join public.brand_player_sessions bps on bps.id = c.session_id
$$;

comment on function public._brand_player_liveness(integer) is
  '매장별 canonical session 과 그 heartbeat/미디어 진행/셸 생존 나이(초). 열린 incident 가 있으면 **그 incident 가 지목한 세션**이 canonical 이다 — 다른 기기 세션이 죽은 매장 재생기를 가리지 못하게(2026-09-15 FALSE RECOVERY).';

revoke all on function public._brand_player_liveness(integer) from public, anon, authenticated;
grant execute on function public._brand_player_liveness(integer) to service_role;
