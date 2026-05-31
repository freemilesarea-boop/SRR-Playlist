-- 0254 — Phase X4.3.1 Playback Event Coverage Patch
--
-- 목표: X4.3 에서 정의된 13 event_type 중 실제 emit 미연결 항목 추가:
--   - like / unlike (TrackLikeButton)
--   - replay (같은 session 에서 동일 track 두 번째 이상 play_start)
--   - player_error (HTMLAudioElement onerror)
--
-- 정책: 추천 점수/behavior_score/fit_score 변경 금지. 수집 범위 보강만.

-- ===== A. evidence_json 컬럼 추가 =====
-- player_error 의 error.code/message/audio_url/networkState/readyState 저장용
alter table public.playback_events_v2
  add column if not exists evidence_json jsonb;

create index if not exists ix_pev2_error_recent on public.playback_events_v2(created_at desc)
  where event_type = 'player_error';

-- ===== B. log_playback_event_v2 v2: evidence_json 인자 추가 =====
-- 기존 시그니처는 그대로 유지 (default null). evidence_json 만 추가.
create or replace function public.log_playback_event_v2(
  p_track_id uuid, p_event_type text, p_session_id text default null,
  p_listened_seconds numeric default null, p_track_duration_seconds numeric default null,
  p_completion_percent numeric default null, p_volume numeric default null,
  p_muted boolean default null, p_playlist_id uuid default null,
  p_business_id uuid default null, p_device_type text default null,
  p_browser text default null, p_os text default null, p_anonymous_id text default null,
  p_evidence_json jsonb default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_user uuid := auth.uid(); v_store_slug text; v_inserted boolean := false;
begin
  if p_playlist_id is not null then
    select public.normalize_store_label(pl.business_category) into v_store_slug
      from public.playlists pl where pl.id = p_playlist_id;
  end if;
  insert into public.playback_events_v2(
    user_id, anonymous_id, business_id, playlist_id, track_id, event_type,
    listened_seconds, track_duration_seconds, completion_percent,
    volume, muted, device_type, browser, os, store_type_slug, session_id, evidence_json
  ) values (
    v_user, p_anonymous_id, p_business_id, p_playlist_id, p_track_id, p_event_type,
    p_listened_seconds, p_track_duration_seconds, p_completion_percent,
    p_volume, p_muted, p_device_type, p_browser, p_os, v_store_slug, p_session_id, p_evidence_json
  )
  on conflict (session_id, track_id, event_type) where event_type in
    ('play_start','play_25','play_50','play_75','play_complete')
  do nothing;
  v_inserted := found;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'store_slug', v_store_slug);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end; $$;

-- ===== C. admin_recent_player_errors (디버깅 도우미) =====
create or replace function public.admin_recent_player_errors(p_days int default 7, p_limit int default 50)
returns table (
  id bigint, track_id uuid, session_id text,
  user_or_anon text, evidence_json jsonb, created_at timestamptz,
  device_type text, browser text, os text
)
language sql security definer set search_path = public stable as $$
  select e.id, e.track_id, e.session_id,
         coalesce(e.user_id::text, e.anonymous_id, '(unknown)') as user_or_anon,
         e.evidence_json, e.created_at,
         e.device_type, e.browser, e.os
  from public.playback_events_v2 e
  where e.event_type = 'player_error'
    and e.created_at > now() - (p_days || ' days')::interval
  order by e.created_at desc
  limit greatest(p_limit, 1);
$$;

-- ===== D. 권한 =====
revoke all on function public.log_playback_event_v2(uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text, jsonb) from public;
revoke all on function public.admin_recent_player_errors(int, int) from public, anon;

grant execute on function public.log_playback_event_v2(uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.admin_recent_player_errors(int, int) to authenticated, service_role;
