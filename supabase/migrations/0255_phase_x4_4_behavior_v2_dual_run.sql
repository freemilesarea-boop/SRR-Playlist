-- 0255 — Phase X4.4 Behavior Score v2 Dual-Run
--
-- 목표: playback_events_v2 기반 behavior_score 를 별도 컬럼/테이블에 계산 → v1 과 drift 비교만.
-- 정책: fit_score / behavior_score (v1) / final_fit_score 변경 금지. dual-run only.

-- ===== A. track_behavior_scores_v2 =====
create table if not exists public.track_behavior_scores_v2 (
  track_id               uuid not null references public.tracks(id) on delete cascade,
  window_days            int not null,
  play_count             int not null default 0,
  unique_listener_count  int not null default 0,
  completion_rate        numeric default 0,
  skip_rate              numeric default 0,
  replay_rate            numeric default 0,
  like_rate              numeric default 0,
  save_rate              numeric default 0,
  avg_listen_seconds     numeric default 0,
  avg_completion_percent numeric default 0,
  behavior_score_v2      numeric default 0,
  confidence_v2          numeric default 0,
  -- v1 미존재 신호들 (quality signals 만 저장, score 반영 X)
  muted_play_count       int default 0,
  volume_low_play_count  int default 0,
  player_error_count     int default 0,
  calculated_at          timestamptz not null default now(),
  primary key (track_id, window_days)
);

create index if not exists ix_tbs_v2_window on public.track_behavior_scores_v2(window_days, behavior_score_v2 desc);

alter table public.track_behavior_scores_v2 enable row level security;
drop policy if exists "tbs_v2 admin read" on public.track_behavior_scores_v2;
create policy "tbs_v2 admin read" on public.track_behavior_scores_v2 for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. recompute_track_behavior_scores_v2 =====
-- playback_events_v2 단일 소스에서 모든 메트릭 집계.
-- like_rate: COUNT(like) / unique_listener_count (track-level like 동일).
-- save_rate: like_rate proxy (save 이벤트 아직 없음, X4.0 정책 동일).
create or replace function public.recompute_track_behavior_scores_v2(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int := 0;
  v_start timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with windowed as (
    select * from public.playback_events_v2
    where created_at > now() - (p_window_days || ' days')::interval
      and track_id is not null
  ),
  per_track as (
    select track_id,
      count(*) filter (where event_type='play_start')::int as play_count,
      count(distinct coalesce(user_id::text, anonymous_id, session_id))
        filter (where event_type='play_start')::int as unique_listeners,
      count(*) filter (where event_type='play_complete')::int as complete_count,
      count(*) filter (where event_type='skip')::int as skip_count,
      count(*) filter (where event_type='replay')::int as replay_count,
      count(distinct user_id) filter (where event_type='like')::int as like_count_distinct_users,
      coalesce(avg(listened_seconds) filter (where event_type='play_complete' or event_type='skip'), 0) as avg_listen,
      coalesce(avg(completion_percent) filter (where event_type in ('play_complete','play_25','play_50','play_75','skip')), 0) as avg_completion_pct,
      count(*) filter (where muted = true) as muted_count,
      count(*) filter (where (volume is not null and volume < 0.1) or event_type='volume_low') as volume_low_count,
      count(*) filter (where event_type='player_error') as player_error_count
    from windowed
    group by track_id
  ),
  scored as (
    select track_id, play_count, unique_listeners,
      complete_count, skip_count, replay_count,
      like_count_distinct_users, avg_listen, avg_completion_pct,
      muted_count, volume_low_count, player_error_count,
      coalesce(complete_count::numeric / nullif(play_count, 0), 0) as completion_rate,
      least(1.0, coalesce(skip_count::numeric / nullif(play_count, 0), 0)) as skip_rate,
      least(1.0, coalesce(replay_count::numeric / nullif(play_count, 0), 0)) as replay_rate,
      least(1.0, coalesce(like_count_distinct_users::numeric / nullif(unique_listeners, 0), 0)) as like_rate
    from per_track
    where play_count > 0
  )
  insert into public.track_behavior_scores_v2 (
    track_id, window_days, play_count, unique_listener_count,
    completion_rate, skip_rate, replay_rate, like_rate, save_rate,
    avg_listen_seconds, avg_completion_percent,
    behavior_score_v2, confidence_v2,
    muted_play_count, volume_low_play_count, player_error_count,
    calculated_at
  )
  select s.track_id, p_window_days, s.play_count, s.unique_listeners,
    round(s.completion_rate, 4),
    round(s.skip_rate, 4),
    round(s.replay_rate, 4),
    round(s.like_rate, 4),
    round(s.like_rate, 4),  -- save_rate = like_rate proxy (v1 동일 정책)
    round(s.avg_listen, 2),
    round(s.avg_completion_pct, 4),
    -- v1 와 동일 공식 (입력 source 만 v2 로 교체)
    round(
      s.completion_rate * 35
      + s.replay_rate * 20
      + s.like_rate * 20
      + s.like_rate * 15  -- save_rate (proxy)
      - s.skip_rate * 25
      + least(10, s.play_count::numeric / 10), 2),
    round(least(1.0, s.play_count::numeric / 100), 4),
    s.muted_count::int, s.volume_low_count::int, s.player_error_count::int,
    now()
  from scored s
  on conflict (track_id, window_days) do update set
    play_count = excluded.play_count,
    unique_listener_count = excluded.unique_listener_count,
    completion_rate = excluded.completion_rate,
    skip_rate = excluded.skip_rate,
    replay_rate = excluded.replay_rate,
    like_rate = excluded.like_rate,
    save_rate = excluded.save_rate,
    avg_listen_seconds = excluded.avg_listen_seconds,
    avg_completion_percent = excluded.avg_completion_percent,
    behavior_score_v2 = excluded.behavior_score_v2,
    confidence_v2 = excluded.confidence_v2,
    muted_play_count = excluded.muted_play_count,
    volume_low_play_count = excluded.volume_low_play_count,
    player_error_count = excluded.player_error_count,
    calculated_at = now();
  get diagnostics v_count = row_count;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'recompute_behavior_v2', v_count,
    jsonb_build_object('window_days', p_window_days),
    jsonb_build_object('rows_upserted', v_count,
      'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int),
    'completed', now()
  );

  return jsonb_build_object('ok', true, 'rows_upserted', v_count,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int);
end; $$;

-- ===== C. admin_compare_behavior_v1_v2 =====
-- v1 (track_behavior_scores) vs v2 (track_behavior_scores_v2) full outer join + drift flags.
create or replace function public.admin_compare_behavior_v1_v2(p_window_days int default 30)
returns table (
  track_id uuid, title text, artist text,
  v1_play_count int, v2_play_count int,
  v1_completion_rate numeric, v2_completion_rate numeric,
  v1_skip_rate numeric, v2_skip_rate numeric,
  v1_behavior_score numeric, v2_behavior_score numeric,
  v1_confidence numeric, v2_confidence numeric,
  score_delta numeric, completion_delta numeric, skip_delta numeric,
  play_count_delta_pct numeric,
  v2_muted_play_count int, v2_player_error_count int,
  issue_flags text[]
)
language sql security definer set search_path = public stable as $$
  with merged as (
    select
      coalesce(v1.track_id, v2.track_id) as track_id,
      v1.play_count as v1_play, v2.play_count as v2_play,
      v1.completion_rate as v1_comp, v2.completion_rate as v2_comp,
      v1.skip_rate as v1_skip, v2.skip_rate as v2_skip,
      v1.behavior_score as v1_score, v2.behavior_score_v2 as v2_score,
      v1.confidence as v1_conf, v2.confidence_v2 as v2_conf,
      v2.muted_play_count, v2.player_error_count
    from public.track_behavior_scores v1
    full outer join public.track_behavior_scores_v2 v2
      on v1.track_id = v2.track_id and v1.window_days = v2.window_days
    where coalesce(v1.window_days, v2.window_days) = p_window_days
  )
  select m.track_id, t.title, t.artist,
    coalesce(m.v1_play, 0)::int, coalesce(m.v2_play, 0)::int,
    coalesce(m.v1_comp, 0), coalesce(m.v2_comp, 0),
    coalesce(m.v1_skip, 0), coalesce(m.v2_skip, 0),
    coalesce(m.v1_score, 0), coalesce(m.v2_score, 0),
    coalesce(m.v1_conf, 0), coalesce(m.v2_conf, 0),
    round(coalesce(m.v2_score, 0) - coalesce(m.v1_score, 0), 2) as score_delta,
    round(coalesce(m.v2_comp, 0) - coalesce(m.v1_comp, 0), 4) as completion_delta,
    round(coalesce(m.v2_skip, 0) - coalesce(m.v1_skip, 0), 4) as skip_delta,
    case
      when greatest(coalesce(m.v1_play, 0), coalesce(m.v2_play, 0)) = 0 then 0
      else round(100.0 * abs(coalesce(m.v1_play, 0) - coalesce(m.v2_play, 0))::numeric
                 / greatest(coalesce(m.v1_play, 0), coalesce(m.v2_play, 0)), 2)
    end as play_count_delta_pct,
    coalesce(m.muted_play_count, 0), coalesce(m.player_error_count, 0),
    array_remove(array[
      case when m.v2_play is null or m.v2_play = 0 then 'v2_missing' end,
      case when m.v1_play is null or m.v1_play = 0 then 'v1_missing' end,
      case when greatest(coalesce(m.v1_play, 0), coalesce(m.v2_play, 0)) >= 5
                and abs(coalesce(m.v1_play, 0) - coalesce(m.v2_play, 0))::numeric
                    / nullif(greatest(coalesce(m.v1_play, 0), coalesce(m.v2_play, 0)), 0) >= 0.30
           then 'play_count_delta_high' end,
      case when abs(coalesce(m.v1_comp, 0) - coalesce(m.v2_comp, 0)) >= 0.2
           then 'completion_delta_high' end,
      case when abs(coalesce(m.v1_skip, 0) - coalesce(m.v2_skip, 0)) >= 0.2
           then 'skip_delta_high' end,
      case when abs(coalesce(m.v1_score, 0) - coalesce(m.v2_score, 0)) >= 10
           then 'score_delta_high' end
    ], null) as issue_flags
  from merged m
  left join public.tracks t on t.id = m.track_id and t.removed_at is null
  order by abs(coalesce(m.v2_score, 0) - coalesce(m.v1_score, 0)) desc;
$$;

-- ===== D. admin_behavior_dual_run_summary =====
create or replace function public.admin_behavior_dual_run_summary(p_window_days int default 30)
returns jsonb language sql security definer set search_path = public stable as $$
  with c as (select * from public.admin_compare_behavior_v1_v2(p_window_days))
  select jsonb_build_object(
    'window_days', p_window_days,
    'v1_rows', (select count(*) from c where v1_play_count > 0),
    'v2_rows', (select count(*) from c where v2_play_count > 0),
    'both_rows', (select count(*) from c where v1_play_count > 0 and v2_play_count > 0),
    'v2_only_rows', (select count(*) from c where (v1_play_count is null or v1_play_count = 0) and v2_play_count > 0),
    'v1_only_rows', (select count(*) from c where v1_play_count > 0 and (v2_play_count is null or v2_play_count = 0)),
    'avg_score_delta', (select round(avg(abs(score_delta)), 2) from c where v1_play_count > 0 and v2_play_count > 0),
    'drift_high_count', (select count(*) from c where 'score_delta_high' = any(issue_flags)),
    'completion_drift_count', (select count(*) from c where 'completion_delta_high' = any(issue_flags)),
    'skip_drift_count', (select count(*) from c where 'skip_delta_high' = any(issue_flags)),
    'play_count_drift_count', (select count(*) from c where 'play_count_delta_high' = any(issue_flags)),
    'v2_missing_count', (select count(*) from c where 'v2_missing' = any(issue_flags)),
    'v1_missing_count', (select count(*) from c where 'v1_missing' = any(issue_flags)),
    'v2_total_muted', (select sum(v2_muted_play_count) from c),
    'v2_total_errors', (select sum(v2_player_error_count) from c)
  );
$$;

-- ===== E. 권한 =====
revoke all on function public.recompute_track_behavior_scores_v2(int) from public, anon;
revoke all on function public.admin_compare_behavior_v1_v2(int) from public, anon;
revoke all on function public.admin_behavior_dual_run_summary(int) from public, anon;

grant execute on function public.recompute_track_behavior_scores_v2(int) to authenticated, service_role;
grant execute on function public.admin_compare_behavior_v1_v2(int) to authenticated, service_role;
grant execute on function public.admin_behavior_dual_run_summary(int) to authenticated, service_role;
