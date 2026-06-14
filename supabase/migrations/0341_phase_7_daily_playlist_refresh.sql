-- 0341 — Phase 7: 매일 아침 플레이리스트 자동 갱신 + 신곡 자동 주입 (X6.75)
--
-- 배경:
--   현재 17개 released 플리는 admin 수동 큐레이션 후 정적.
--   최근 14일 715곡 신규 발매 → 플리 회전 없으면 매장 청취 경험이 같은 곡 반복.
--   playlists 테이블에 auto_attach_enabled / auto_attach_threshold 컬럼은 이미 존재 →
--   실제로 사용하는 job 만 부재. 매일 08:00 KST 자동 실행.
--
-- 정책 (안전성 최우선):
--   - 신곡 주입만, 기존 트랙 자동 evict 없음 (다음 PR 에서 신중히)
--   - 후보 = released + audio_url + 최근 14일 발매 + 매장 제외(X6.72) 없음 + 플리 미수록
--   - 후보 중 fit_score (없으면 즉시 계산) ≥ threshold (기본 70) 상위 max_inject (기본 3) 만
--   - placement_reason='auto_daily' 로 audit (사후 admin 이 evict 가능)
--   - is_recommendable=false 또는 archived 플리는 skip
--   - playlist_track_skip_events 등 다른 제약 무시 (보수적)

-- =============================================================================
-- 1. 추가 컬럼 (이미 일부 있음 — 누락분 보강 + 기본값 정렬)
-- =============================================================================
alter table public.playlists
  add column if not exists auto_refresh_max_inject int default 3,
  add column if not exists auto_refresh_lookback_days int default 14,
  add column if not exists last_auto_refresh_at timestamptz,
  add column if not exists last_auto_refresh_added int;

-- auto_attach_enabled 기본값을 활성으로 보정 (운영자가 끄려면 끄게)
update public.playlists
   set auto_attach_enabled = true
 where auto_attach_enabled is null;

update public.playlists
   set auto_attach_threshold = 70
 where auto_attach_threshold is null or auto_attach_threshold <= 0;


-- =============================================================================
-- 2. playlist_auto_refresh_runs audit
-- =============================================================================
create table if not exists public.playlist_auto_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by text not null default 'cron',
  total_playlists int default 0,
  total_added int default 0,
  total_skipped int default 0,
  details jsonb,                 -- per-playlist result
  error text
);
create index if not exists pl_refresh_runs_started_idx
  on public.playlist_auto_refresh_runs (started_at desc);

alter table public.playlist_auto_refresh_runs enable row level security;
drop policy if exists pl_refresh_runs_admin_read on public.playlist_auto_refresh_runs;
create policy pl_refresh_runs_admin_read on public.playlist_auto_refresh_runs for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 3. _auto_refresh_one_playlist(playlist_id) — 한 플리 처리
-- =============================================================================
create or replace function public._auto_refresh_one_playlist(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pl record;
  v_min_fit numeric;
  v_max_inject int;
  v_lookback int;
  v_added int := 0;
  v_evaluated int := 0;
  v_next_order int;
  v_cand record;
  v_fit_score numeric;
  v_added_track_ids uuid[] := '{}';
begin
  select id, business_category, title, archived_at,
         coalesce(is_recommendable, true) as is_recommendable,
         coalesce(auto_attach_enabled, false) as auto_enabled,
         coalesce(auto_attach_threshold, 70) as threshold,
         coalesce(auto_refresh_max_inject, 3) as max_inject,
         coalesce(auto_refresh_lookback_days, 14) as lookback_days
    into v_pl from public.playlists where id = p_playlist_id;
  if v_pl.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_pl.archived_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'archived', 'added', 0);
  end if;
  if not v_pl.auto_enabled then
    return jsonb_build_object('ok', true, 'reason', 'auto_disabled', 'added', 0);
  end if;
  if not v_pl.is_recommendable then
    return jsonb_build_object('ok', true, 'reason', 'not_recommendable', 'added', 0);
  end if;

  v_min_fit := v_pl.threshold;
  v_max_inject := v_pl.max_inject;
  v_lookback := v_pl.lookback_days;

  select coalesce(max(order_index), 0) + 1 into v_next_order
    from public.playlist_tracks where playlist_id = p_playlist_id;

  -- 후보: 최근 lookback 일 released + audio_url + 미수록 + 매장제외 없음
  -- 매장 제외 (track_store_exclusions) 는 normalize_store_label(business_category) 매칭
  for v_cand in
    select t.id as track_id, t.title
    from public.tracks t
    where t.release_status='released'
      and t.audio_url is not null and t.audio_url <> ''
      and t.released_at >= now() - (v_lookback || ' days')::interval
      and not exists (
        -- removed 포함 — 한번 빠진 곡은 자동 재주입 안 함 (admin 수동 재추가만)
        select 1 from public.playlist_tracks pt
        where pt.playlist_id = p_playlist_id
          and pt.track_id = t.id
      )
      and not exists (
        select 1 from public.track_store_exclusions ex
        where ex.track_id = t.id
          and ex.is_active = true
          and ex.store_type_slug = public.normalize_store_label(v_pl.business_category)
      )
    order by t.released_at desc
    limit 200  -- candidate pool cap (성능)
  loop
    v_evaluated := v_evaluated + 1;

    -- fit_score 없으면 계산 (on-demand)
    select final_fit_score into v_fit_score
      from public.playlist_track_fit_scores
     where playlist_id = p_playlist_id and track_id = v_cand.track_id;

    if v_fit_score is null then
      perform public._ai_compute_fit(p_playlist_id, v_cand.track_id);
      select final_fit_score into v_fit_score
        from public.playlist_track_fit_scores
       where playlist_id = p_playlist_id and track_id = v_cand.track_id;
    end if;

    if v_fit_score is null or v_fit_score < v_min_fit then continue; end if;

    -- 주입 (placement_reason='auto_daily')
    insert into public.playlist_tracks
      (playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
    values
      (p_playlist_id, v_cand.track_id, v_next_order, v_fit_score, 'auto_daily', 'system')
    on conflict (playlist_id, track_id) do nothing;

    v_added := v_added + 1;
    v_next_order := v_next_order + 1;
    v_added_track_ids := v_added_track_ids || v_cand.track_id;

    exit when v_added >= v_max_inject;
  end loop;

  update public.playlists
     set last_auto_refresh_at = now(),
         last_auto_refresh_added = v_added
   where id = p_playlist_id;

  return jsonb_build_object(
    'ok', true,
    'playlist_id', p_playlist_id,
    'title', v_pl.title,
    'evaluated', v_evaluated,
    'added', v_added,
    'min_fit', v_min_fit,
    'max_inject', v_max_inject,
    'added_tracks', to_jsonb(v_added_track_ids)
  );
end; $$;

revoke execute on function public._auto_refresh_one_playlist(uuid) from public, anon;


-- =============================================================================
-- 4. cron_daily_playlist_refresh — 모든 자동 활성 플리 일괄 처리
-- =============================================================================
create or replace function public.cron_daily_playlist_refresh()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run_id uuid;
  v_pl record;
  v_one jsonb;
  v_details jsonb := '[]'::jsonb;
  v_total_added int := 0;
  v_total_skipped int := 0;
  v_total_pls int := 0;
begin
  insert into public.playlist_auto_refresh_runs (triggered_by)
  values ('cron') returning id into v_run_id;

  for v_pl in
    select id from public.playlists
    where status='released'
      and archived_at is null
      and coalesce(auto_attach_enabled, false) = true
      and coalesce(is_recommendable, true) = true
    order by coalesce(recommendation_priority, 0) desc, id
  loop
    v_total_pls := v_total_pls + 1;
    begin
      v_one := public._auto_refresh_one_playlist(v_pl.id);
      v_details := v_details || jsonb_build_array(v_one);
      if (v_one->>'added')::int > 0 then
        v_total_added := v_total_added + (v_one->>'added')::int;
      else
        v_total_skipped := v_total_skipped + 1;
      end if;
    exception when others then
      v_details := v_details || jsonb_build_array(
        jsonb_build_object('playlist_id', v_pl.id, 'error', SQLERRM)
      );
    end;
  end loop;

  update public.playlist_auto_refresh_runs
     set finished_at = now(),
         total_playlists = v_total_pls,
         total_added = v_total_added,
         total_skipped = v_total_skipped,
         details = v_details
   where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'playlists', v_total_pls,
    'added', v_total_added,
    'skipped', v_total_skipped
  );
exception when others then
  update public.playlist_auto_refresh_runs
     set finished_at = now(), error = SQLERRM, details = v_details
   where id = v_run_id;
  raise;
end; $$;

revoke execute on function public.cron_daily_playlist_refresh() from public, anon;
grant execute on function public.cron_daily_playlist_refresh() to service_role, postgres;


-- =============================================================================
-- 5. admin RPCs — 토글 / 수동 트리거 / 이력 조회
-- =============================================================================
create or replace function public.admin_set_playlist_auto_refresh(
  p_playlist_id uuid,
  p_enabled boolean,
  p_threshold numeric default null,
  p_max_inject int default null,
  p_lookback_days int default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.playlists
     set auto_attach_enabled = p_enabled,
         auto_attach_threshold = coalesce(p_threshold, auto_attach_threshold),
         auto_refresh_max_inject = coalesce(p_max_inject, auto_refresh_max_inject),
         auto_refresh_lookback_days = coalesce(p_lookback_days, auto_refresh_lookback_days)
   where id = p_playlist_id;
  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'enabled', p_enabled);
end; $$;

grant execute on function public.admin_set_playlist_auto_refresh(uuid, boolean, numeric, int, int) to authenticated;


create or replace function public.admin_run_playlist_refresh(p_playlist_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_r jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  if p_playlist_id is null then
    v_r := public.cron_daily_playlist_refresh();
  else
    v_r := public._auto_refresh_one_playlist(p_playlist_id);
  end if;
  return v_r;
end; $$;

grant execute on function public.admin_run_playlist_refresh(uuid) to authenticated;


create or replace function public.admin_list_playlist_refresh_runs(p_limit int default 30)
returns table(
  id uuid, started_at timestamptz, finished_at timestamptz,
  triggered_by text, total_playlists int, total_added int, total_skipped int,
  details jsonb, error text
) language sql stable security definer set search_path to 'public' as $$
  select r.id, r.started_at, r.finished_at,
         r.triggered_by, r.total_playlists, r.total_added, r.total_skipped,
         r.details, r.error
  from public.playlist_auto_refresh_runs r
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  order by r.started_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_playlist_refresh_runs(int) to authenticated;


create or replace function public.admin_list_playlist_auto_status()
returns table(
  id uuid, title text, business_category text,
  auto_attach_enabled boolean, auto_attach_threshold numeric,
  auto_refresh_max_inject int, auto_refresh_lookback_days int,
  last_auto_refresh_at timestamptz, last_auto_refresh_added int,
  current_track_count int
) language sql stable security definer set search_path to 'public' as $$
  select p.id, p.title, p.business_category,
         coalesce(p.auto_attach_enabled, false),
         coalesce(p.auto_attach_threshold, 70),
         coalesce(p.auto_refresh_max_inject, 3),
         coalesce(p.auto_refresh_lookback_days, 14),
         p.last_auto_refresh_at, p.last_auto_refresh_added,
         (select count(*)::int from public.playlist_tracks pt
          where pt.playlist_id = p.id and pt.removed_at is null)
  from public.playlists p
  where p.status='released' and p.archived_at is null
    and exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  order by p.sort_order, p.title;
$$;
grant execute on function public.admin_list_playlist_auto_status() to authenticated;
