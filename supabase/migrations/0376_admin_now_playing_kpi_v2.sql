-- 0376 — admin_now_playing_kpi v2: error_count + recent_1m_updates 추가
--
-- 목표 (Priority 2-4):
--   사용자 명시 6 KPI (전체/재생중/일시정지/오프라인/오류/최근 1분 업데이트)
--   현재 (0356): total/playing/paused/stopped/offline/recent_track_changes_5m
--   gap: error_count 미존재, 1분 단위 업데이트 카운트 부재
--
-- 변경:
--   - 함수 시그니처 동일 (admin_now_playing_kpi())
--   - 반환 JSON 에 error_count, recent_track_changes_1m 추가 (기존 필드 보존)
--
-- 절대 원칙:
--   - 시그니처 보존
--   - 기존 store_now_playing view / store_policy_sync_status 무수정
--   - 모든 기존 KPI 필드 그대로 (recent_track_changes_5m 유지 — backward compat)
--   - artist/settlement/payment/player/queue/crossfade 무관

create or replace function public.admin_now_playing_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_recent_5m timestamptz := now() - interval '5 minutes';
  v_recent_1m timestamptz := now() - interval '1 minute';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total',   (select count(*) from public.store_now_playing),
    'playing', (select count(*) from public.store_now_playing where player_status = 'playing' and is_online),
    'paused',  (select count(*) from public.store_now_playing where player_status = 'paused'  and is_online),
    'stopped', (select count(*) from public.store_now_playing where player_status = 'stopped' and is_online),
    'offline', (select count(*) from public.store_now_playing where not is_online),
    'error_count', (
      select count(*) from public.store_now_playing
       where playback_error is not null and length(btrim(playback_error)) > 0
    ),
    'recent_track_changes_5m', (
      select count(*) from public.store_now_playing
       where started_at is not null and started_at >= v_recent_5m
    ),
    'recent_track_changes_1m', (
      select count(*) from public.store_now_playing
       where started_at is not null and started_at >= v_recent_1m
    ),
    -- 최근 1분 heartbeat (모든 매장의 sync_status.updated_at 기반)
    'recent_updates_1m', (
      select count(*) from public.store_now_playing
       where last_heartbeat_at is not null and last_heartbeat_at >= v_recent_1m
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_now_playing_kpi() from public, anon;
grant execute on function public.admin_now_playing_kpi() to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_rpc int;
begin
  select count(*) into v_rpc from pg_proc
    where proname='admin_now_playing_kpi' and pronamespace='public'::regnamespace;
  raise notice '====== 0376 Now Playing KPI v2 ======';
  raise notice 'admin_now_playing_kpi: % / 1', v_rpc;
  raise notice '   +error_count, +recent_track_changes_1m, +recent_updates_1m';
  raise notice '======================================';
  if v_rpc = 1 then
    raise notice '0376 COMPLETE — Now Playing KPI v2 ready';
  else
    raise warning '0376 INCOMPLETE';
  end if;
end$$;
