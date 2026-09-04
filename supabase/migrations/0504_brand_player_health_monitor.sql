-- ============================================================================
-- 0504_brand_player_health_monitor.sql
-- Phase BRAND-PLAYER-HEALTH-MONITOR-1
--
-- 문제: 지금은 "매장 음악이 실제로 나오고 있는지" 를 서버에서 확인할 방법이 없다.
--   brand_player_heartbeat 는 60초 타이머라 오디오가 멈춰 있어도 계속 날아온다.
--   그래서 last_seen_at 만 보면 정지한 매장도 "정상" 으로 보인다.
--   (실제로 재생이 멈춘 세션이 heartbeat 를 계속 보내는 것을 프로덕션에서 확인)
--
-- 해결: 곡이 실제로 바뀐 시각(current_track_started_at)을 기록하고,
--   "곡 길이 대비 얼마나 오래 같은 곡에 머물러 있는가" 로 stalled 를 판정한다.
--   heartbeat 가 살아 있는데 곡이 안 넘어가면 = 오디오만 죽은 상태.
--
-- additive only. 기존 컬럼/함수 시그니처 무변경, 재생 흐름 무영향.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 곡 전환 시각 컬럼
-- ----------------------------------------------------------------------------
alter table public.brand_player_sessions
  add column if not exists current_track_started_at timestamptz;

-- 기존 세션 백필 — 알 수 없으므로 last_seen_at 기준(첫 판정만 보수적으로 나온다)
update public.brand_player_sessions
   set current_track_started_at = coalesce(last_seen_at, created_at)
 where current_track_started_at is null;

-- ----------------------------------------------------------------------------
-- 2) heartbeat — 곡이 "실제로 바뀔 때만" current_track_started_at 갱신
--    prod 정의를 그대로 옮기고 컬럼 하나만 추가한다.
-- ----------------------------------------------------------------------------
create or replace function public.brand_player_heartbeat(
  p_brand_id uuid, p_session_token text,
  p_current_track_id uuid default null, p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare v_hash text; v_sid uuid;
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  if auth.uid() is null then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  update public.brand_player_sessions
     set last_seen_at = now(),
         current_track_id = coalesce(p_current_track_id, current_track_id),
         -- 🆕 0504: 곡이 실제로 바뀐 순간만 기록. 같은 곡이면 그대로 둔다.
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
  return jsonb_build_object('success', v_sid is not null);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 관리자 — 브랜드 플레이어 실시간 상태
--
--    status 판정 (순서대로):
--      offline  : heartbeat 가 10분 이상 끊김 (탭 종료 / PC 절전 / 네트워크 단절)
--      stalled  : heartbeat 는 살아 있는데 곡이 안 넘어감
--                 = 페이지는 떠 있고 오디오만 죽은 상태 (우리가 고친 그 증상)
--                 임계값: max(곡 길이 x 2, 8분) — 백그라운드 탭 타이머 지연 감안
--      playing  : 정상
-- ----------------------------------------------------------------------------
create or replace function public.admin_brand_player_health(p_minutes int default 1440)
returns table (
  session_id uuid,
  brand_name text,
  status text,
  seconds_since_heartbeat int,
  seconds_on_current_track int,
  current_track_title text,
  current_track_duration int,
  stall_threshold_seconds int,
  session_age_hours numeric,
  device text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;

  return query
  with s as (
    select bps.id, ba.name as brand,
           bps.last_seen_at, bps.created_at,
           bps.current_track_started_at, bps.user_agent,
           t.title as track_title, t.duration as track_duration,
           greatest(coalesce(t.duration, 180) * 2, 480) as stall_secs
    from public.brand_player_sessions bps
    join public.brand_accounts ba on ba.id = bps.brand_id
    left join public.tracks t on t.id = bps.current_track_id
    where bps.revoked_at is null
      and bps.last_seen_at > now() - make_interval(mins => greatest(1, p_minutes))
  )
  select s.id,
         s.brand,
         case
           when s.last_seen_at < now() - interval '10 minutes' then 'offline'
           when coalesce(s.current_track_started_at, s.created_at) < now() - make_interval(secs => s.stall_secs) then 'stalled'
           else 'playing'
         end::text,
         extract(epoch from (now() - s.last_seen_at))::int,
         extract(epoch from (now() - coalesce(s.current_track_started_at, s.created_at)))::int,
         s.track_title,
         s.track_duration,
         s.stall_secs::int,
         round(extract(epoch from (now() - s.created_at)) / 3600.0, 1),
         case
           when s.user_agent ilike '%iphone%' or s.user_agent ilike '%android%' then 'mobile'
           when s.user_agent ilike '%ipad%' or s.user_agent ilike '%tablet%' then 'tablet'
           when s.user_agent ilike '%mac os%' then 'mac'
           when s.user_agent ilike '%windows%' then 'windows'
           else 'other'
         end::text,
         s.last_seen_at
  from s
  order by s.last_seen_at desc;
end;
$$;

-- 한 줄 요약 — "지금 매장들 괜찮은가?" 에 바로 답하는 용도
create or replace function public.admin_brand_player_health_summary(p_minutes int default 1440)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  select jsonb_build_object(
    'checked_at', now(),
    'window_minutes', p_minutes,
    'total', count(*),
    'playing', count(*) filter (where h.status = 'playing'),
    'stalled', count(*) filter (where h.status = 'stalled'),
    'offline', count(*) filter (where h.status = 'offline'),
    'stalled_sessions', coalesce(jsonb_agg(
        jsonb_build_object('session_id', h.session_id, 'brand', h.brand_name,
                           'track', h.current_track_title,
                           'stuck_seconds', h.seconds_on_current_track,
                           'device', h.device)
      ) filter (where h.status = 'stalled'), '[]'::jsonb)
  ) into v
  from public.admin_brand_player_health(p_minutes) h;
  return v;
end;
$$;

revoke execute on function public.admin_brand_player_health(int) from public, anon;
grant  execute on function public.admin_brand_player_health(int) to authenticated, service_role;
revoke execute on function public.admin_brand_player_health_summary(int) from public, anon;
grant  execute on function public.admin_brand_player_health_summary(int) to authenticated, service_role;
