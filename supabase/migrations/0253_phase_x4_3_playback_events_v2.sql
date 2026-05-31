-- 0253 — Phase X4.3 Playback Event Standardization (v2)
--
-- 목표: 기존 stream_events / track_play_events / playlist_track_skip_events 가
--       서로 다른 schema 와 이벤트 vocabulary 를 사용 → DSP급 학습 데이터로 부적합.
-- 해결: 표준 이벤트 vocabulary + 통합 schema (playback_events_v2).
-- 정책: 기존 시스템 변경 없음. v2 를 parallel layer 로 추가.
--   - fit_score / behavior_score / track_store_behavior_score 변경 금지
--   - 데이터 수집 표준화 + 품질 검증만

-- ===== A. playback_events_v2 =====
create table if not exists public.playback_events_v2 (
  id                      bigserial primary key,
  user_id                 uuid,
  anonymous_id            text,
  business_id             uuid,
  playlist_id             uuid,
  track_id                uuid references public.tracks(id) on delete cascade,
  event_type              text not null check (event_type in (
    'play_start','play_progress','play_25','play_50','play_75','play_complete',
    'skip','replay','like','unlike','volume_low','muted','player_error'
  )),
  listened_seconds        numeric,
  track_duration_seconds  numeric,
  completion_percent      numeric,
  volume                  numeric,
  muted                   boolean,
  device_type             text,
  browser                 text,
  os                      text,
  store_type_slug         text,
  session_id              text,
  created_at              timestamptz not null default now()
);

create index if not exists ix_pev2_track_session on public.playback_events_v2(track_id, session_id, event_type);
create index if not exists ix_pev2_created on public.playback_events_v2(created_at desc);
create index if not exists ix_pev2_store on public.playback_events_v2(store_type_slug, created_at desc) where store_type_slug is not null;
create index if not exists ix_pev2_event on public.playback_events_v2(event_type, created_at desc);

-- 중복 방지: milestone 이벤트는 같은 session × track × event_type 으로 1회만
create unique index if not exists uq_pev2_milestone
  on public.playback_events_v2(session_id, track_id, event_type)
  where event_type in ('play_start','play_25','play_50','play_75','play_complete');

alter table public.playback_events_v2 enable row level security;
drop policy if exists "pev2 insert authenticated" on public.playback_events_v2;
drop policy if exists "pev2 insert anon" on public.playback_events_v2;
drop policy if exists "pev2 admin read" on public.playback_events_v2;
-- 모든 사용자 INSERT 허용 (anon 포함, 익명 재생도 수집)
create policy "pev2 insert authenticated" on public.playback_events_v2
  for insert to authenticated with check (true);
create policy "pev2 insert anon" on public.playback_events_v2
  for insert to anon with check (true);
-- 관리자만 read
create policy "pev2 admin read" on public.playback_events_v2
  for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. log_playback_event_v2 =====
-- 프론트엔드에서 호출. store_type_slug 는 playlist 의 business_category 로부터 자동 derive.
-- milestone 이벤트는 중복 시 silently skip (unique index 충돌 무시).
create or replace function public.log_playback_event_v2(
  p_track_id               uuid,
  p_event_type             text,
  p_session_id             text default null,
  p_listened_seconds       numeric default null,
  p_track_duration_seconds numeric default null,
  p_completion_percent     numeric default null,
  p_volume                 numeric default null,
  p_muted                  boolean default null,
  p_playlist_id            uuid default null,
  p_business_id            uuid default null,
  p_device_type            text default null,
  p_browser                text default null,
  p_os                     text default null,
  p_anonymous_id           text default null
) returns jsonb
language plpgsql
security invoker  -- RLS 적용 (insert policy 통과)
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_store_slug text;
  v_inserted boolean := false;
begin
  -- store_slug derive from playlist
  if p_playlist_id is not null then
    select public.normalize_store_label(pl.business_category) into v_store_slug
      from public.playlists pl where pl.id = p_playlist_id;
  end if;

  insert into public.playback_events_v2(
    user_id, anonymous_id, business_id, playlist_id, track_id, event_type,
    listened_seconds, track_duration_seconds, completion_percent,
    volume, muted, device_type, browser, os, store_type_slug, session_id
  ) values (
    v_user, p_anonymous_id, p_business_id, p_playlist_id, p_track_id, p_event_type,
    p_listened_seconds, p_track_duration_seconds, p_completion_percent,
    p_volume, p_muted, p_device_type, p_browser, p_os, v_store_slug, p_session_id
  )
  on conflict (session_id, track_id, event_type) where event_type in
    ('play_start','play_25','play_50','play_75','play_complete')
  do nothing;
  v_inserted := found;

  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'store_slug', v_store_slug);
exception when others then
  -- 실패해도 silent (재생 흐름 차단 금지)
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end; $$;

-- ===== C. admin_playback_event_summary =====
create or replace function public.admin_playback_event_summary(p_days int default 1)
returns jsonb language sql security definer set search_path = public stable as $$
  with windowed as (
    select * from public.playback_events_v2
    where created_at > now() - (p_days || ' days')::interval
  )
  select jsonb_build_object(
    'window_days', p_days,
    'total_events', (select count(*) from windowed),
    'distinct_users', (select count(distinct coalesce(user_id::text, anonymous_id, session_id)) from windowed),
    'distinct_tracks', (select count(distinct track_id) from windowed),
    'distinct_sessions', (select count(distinct session_id) from windowed where session_id is not null),
    'by_event_type', coalesce((
      select jsonb_object_agg(event_type, cnt) from (
        select event_type, count(*) as cnt from windowed group by event_type
      ) s), '{}'::jsonb),
    'by_store_slug', coalesce((
      select jsonb_object_agg(coalesce(store_type_slug,'(null)'), cnt) from (
        select store_type_slug, count(*) as cnt from windowed group by store_type_slug
      ) s), '{}'::jsonb),
    'muted_events', (select count(*) from windowed where muted = true),
    'volume_low_events', (select count(*) from windowed where event_type='volume_low' or volume < 0.1),
    'null_store_slug_pct', round(
      100.0 * (select count(*) from windowed where store_type_slug is null) /
      nullif((select count(*) from windowed), 0), 2),
    'null_duration_pct', round(
      100.0 * (select count(*) from windowed where track_duration_seconds is null) /
      nullif((select count(*) from windowed), 0), 2)
  );
$$;

-- ===== D. admin_list_event_quality_issues =====
create or replace function public.admin_list_event_quality_issues(p_days int default 7, p_limit int default 100)
returns table (
  issue_type text, event_id bigint, track_id uuid, session_id text,
  event_type text, listened_seconds numeric, track_duration_seconds numeric,
  completion_percent numeric, created_at timestamptz, evidence jsonb
)
language sql security definer set search_path = public stable as $$
  -- duration_missing
  (select 'duration_missing'::text, id, track_id, session_id, event_type,
          listened_seconds, track_duration_seconds, completion_percent, created_at,
          jsonb_build_object('note', 'track_duration_seconds is null')
   from public.playback_events_v2
   where created_at > now() - (p_days || ' days')::interval
     and event_type in ('play_progress','play_25','play_50','play_75','play_complete','skip')
     and track_duration_seconds is null
   limit p_limit)
  union all
  -- completion > 100
  (select 'completion_over_100', id, track_id, session_id, event_type,
          listened_seconds, track_duration_seconds, completion_percent, created_at,
          jsonb_build_object('completion_percent', completion_percent)
   from public.playback_events_v2
   where created_at > now() - (p_days || ' days')::interval
     and completion_percent > 100
   limit p_limit)
  union all
  -- listened > duration * 1.2
  (select 'listened_exceeds_duration', id, track_id, session_id, event_type,
          listened_seconds, track_duration_seconds, completion_percent, created_at,
          jsonb_build_object('overage_ratio',
            round(listened_seconds::numeric / nullif(track_duration_seconds, 0), 2))
   from public.playback_events_v2
   where created_at > now() - (p_days || ' days')::interval
     and listened_seconds is not null and track_duration_seconds is not null
     and listened_seconds > track_duration_seconds * 1.2
   limit p_limit)
  union all
  -- play_complete without play_start in same session
  (select 'complete_without_start', e.id, e.track_id, e.session_id, e.event_type,
          e.listened_seconds, e.track_duration_seconds, e.completion_percent, e.created_at,
          jsonb_build_object('note', 'no play_start record for this session+track')
   from public.playback_events_v2 e
   where e.created_at > now() - (p_days || ' days')::interval
     and e.event_type = 'play_complete' and e.session_id is not null
     and not exists (
       select 1 from public.playback_events_v2 s
       where s.session_id = e.session_id and s.track_id = e.track_id
         and s.event_type = 'play_start'
     )
   limit p_limit)
  union all
  -- muted plays (informational, severity LOW)
  (select 'muted_play', id, track_id, session_id, event_type,
          listened_seconds, track_duration_seconds, completion_percent, created_at,
          jsonb_build_object('muted', muted, 'volume', volume)
   from public.playback_events_v2
   where created_at > now() - (p_days || ' days')::interval
     and event_type in ('play_25','play_50','play_75','play_complete')
     and (muted = true or volume < 0.1)
   limit p_limit);
$$;

-- ===== E. 권한 =====
revoke all on function public.log_playback_event_v2(uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text) from public;
revoke all on function public.admin_playback_event_summary(int) from public, anon;
revoke all on function public.admin_list_event_quality_issues(int, int) from public, anon;

-- 익명 사용자도 이벤트 로깅 (RLS policy 가 insert 통제)
grant execute on function public.log_playback_event_v2(uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.admin_playback_event_summary(int) to authenticated, service_role;
grant execute on function public.admin_list_event_quality_issues(int, int) to authenticated, service_role;
