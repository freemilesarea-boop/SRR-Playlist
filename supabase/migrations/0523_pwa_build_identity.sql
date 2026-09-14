-- 0523 — 매장이 **어떤 코드**를 돌고 있는지 서버가 매분 안다
--
-- 왜 — 2026-09-14 숙대점. 06:44 에 최신 번들(837a38cbe9ec)로 떴던 기기가
-- 09:52 fresh_load 에서 2026-09-10~09-12 사이 번들로 되살아났다. 그걸 우리가
-- 알아낸 방법은 session_start context 가 `{}` 라는 **부재**였다. 관측이 아니라
-- 추리였고, "그때 SW 는 어느 빌드였나" 는 끝내 답하지 못했다.
--
-- 그래서 heartbeat 에 실린 build identity 를 세션 행에 남긴다. 이제 매분,
-- 강제 새로고침 없이, 매장이 무슨 코드를 돌고 있는지 보인다.
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • navigation caching 전략을 바꾸지 않는다 (NetworkFirst/navigateFallback 무변경)
--   • stale 을 발견해도 명령을 보내지 않는다. Slack 자동 발송도 없다. 관측만.
--   • 구버전 클라이언트를 끊지 않는다 — 새 인자는 전부 nullable default 다.

-- ----------------------------------------------------------------------------
-- 1) 세션 행에 build identity 칸 (전부 nullable — 구버전은 그냥 null 로 남는다)
-- ----------------------------------------------------------------------------
alter table public.brand_player_sessions
  add column if not exists page_build_hash  text,
  add column if not exists sw_build_hash    text,
  add column if not exists sw_controlled    boolean,
  add column if not exists navigation_type  text;

comment on column public.brand_player_sessions.page_build_hash is
  '이 세션의 페이지가 실제로 실행 중인 번들 build hash. null = 보고할 줄 모르는 구버전(UNKNOWN, CURRENT 아님).';
comment on column public.brand_player_sessions.sw_build_hash is
  '페이지를 제어하는 Service Worker 의 compile-time build hash. /sw.js URL 은 모든 배포가 같아 구분이 안 되므로 SW 에게 직접 물어 받은 값.';
comment on column public.brand_player_sessions.sw_controlled is
  '이 페이지가 SW 의 제어를 받고 있는가. false 면 controller 없는 문서.';
comment on column public.brand_player_sessions.navigation_type is
  'PerformanceNavigationTiming.type — navigate | reload | back_forward | prerender | unknown.';

-- ----------------------------------------------------------------------------
-- 2) heartbeat — 인자 4개 추가. **전부 default null.**
--
--    구버전 클라이언트는 앞의 4개만 named arg 로 보낸다. 새 인자에 기본값이
--    있으므로 그대로 성공한다.
--
--    옛 4인자 시그니처는 **먼저 지운다.** 둘이 공존하면 4개짜리 호출이 두 후보를
--    다 만족해 ambiguous 로 실패한다 — 그러면 정작 보호하려던 구버전 매장의
--    heartbeat 가 끊긴다(지금 숙대점이 구버전이다).
-- ----------------------------------------------------------------------------
drop function if exists public.brand_player_heartbeat(uuid, text, uuid, text);

create or replace function public.brand_player_heartbeat(
  p_brand_id uuid,
  p_session_token text,
  p_current_track_id uuid default null,
  p_user_agent text default null,
  p_page_build_hash text default null,
  p_sw_build_hash text default null,
  p_sw_controlled boolean default null,
  p_navigation_type text default null
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
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  if auth.uid() is null then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');

  -- navigation_type 은 알려진 값만 받는다. 모르는 문자열은 저장하지 않는다
  -- (클라이언트가 보낸 자유 텍스트를 그대로 쌓지 않기 위해서).
  v_nav := case when p_navigation_type in ('navigate','reload','back_forward','prerender','unknown')
                then p_navigation_type else null end;

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
         -- build identity — 보낸 경우에만 덮어쓴다. 구버전이 null 을 보내도
         -- 마지막으로 알던 값을 지우지 않는다(관측 연속성).
         page_build_hash = coalesce(nullif(btrim(p_page_build_hash),''), page_build_hash),
         sw_build_hash   = coalesce(nullif(btrim(p_sw_build_hash),''),   sw_build_hash),
         sw_controlled   = coalesce(p_sw_controlled, sw_controlled),
         navigation_type = coalesce(v_nav, navigation_type)
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
revoke all on function public.brand_player_heartbeat(uuid, text, uuid, text, text, text, boolean, text)
  from public, anon;
grant execute on function public.brand_player_heartbeat(uuid, text, uuid, text, text, text, boolean, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) 관측용 뷰 함수 — stale 분류 (§8)
--
--    **UNKNOWN 을 CURRENT 로 취급하지 않는다.** 값을 안 보낸 클라이언트는
--    "최신"이 아니라 "모른다" 다. 2026-09-14 09:52 숙대점이 정확히 그 경우이며,
--    CURRENT 로 세면 그날의 사고가 통계에서 사라진다.
--
--    이 함수는 **아무 명령도 보내지 않고 Slack 도 울리지 않는다.** 읽기 전용이다.
-- ----------------------------------------------------------------------------
create or replace function public.brand_player_build_identity(
  p_expected_build_hash text default null,
  p_minutes integer default 1440
)
returns table(
  user_id uuid, store_label text, session_id uuid,
  seconds_since_heartbeat integer,
  page_build_hash text, sw_build_hash text,
  sw_controlled boolean, navigation_type text,
  freshness text, page_sw_mismatch boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with canonical as (
    select distinct on (h.user_id) h.*
      from public._brand_player_session_health(greatest(1, p_minutes)) h
     order by h.user_id, h.seconds_since_heartbeat asc
  )
  select c.user_id, c.store_label, c.session_id, c.seconds_since_heartbeat,
         s.page_build_hash, s.sw_build_hash, s.sw_controlled, s.navigation_type,
         case
           when coalesce(btrim(s.page_build_hash),'') = '' then 'UNKNOWN'
           when coalesce(btrim(p_expected_build_hash),'') = '' then 'UNKNOWN'
           when btrim(s.page_build_hash) = btrim(p_expected_build_hash) then 'CURRENT'
           else 'STALE'
         end::text,
         -- 둘 다 알 때만 mismatch 라고 말한다.
         (coalesce(btrim(s.page_build_hash),'') <> ''
          and coalesce(btrim(s.sw_build_hash),'') <> ''
          and btrim(s.page_build_hash) <> btrim(s.sw_build_hash))
    from canonical c
    join public.brand_player_sessions s on s.id = c.session_id
$$;

comment on function public.brand_player_build_identity(text, integer) is
  '매장별 실행 중인 번들 신원과 stale 분류(CURRENT/STALE/UNKNOWN). 관측 전용 — 명령도 Slack 도 없다.';

revoke all on function public.brand_player_build_identity(text, integer) from public, anon, authenticated;
grant execute on function public.brand_player_build_identity(text, integer) to service_role;
